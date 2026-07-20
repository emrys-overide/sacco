import 'dotenv/config';
import express from 'express';
import path from 'path';
import crypto from 'node:crypto';
import type { Pool } from 'pg';
import { createDatabasePool } from './database-config.mjs';
import {
  PersistenceError,
  correctPostgresTransaction,
  assignPostgresDriver,
  createPostgresMember,
  createPostgresTransaction,
  createPostgresVehicle,
  getPostgresMember,
  listPostgresDriverAssignmentsByOwner,
  listPostgresLoansByMember,
  listPostgresMembers,
  listPostgresPayments,
  listPostgresPaymentsByMember,
  listPostgresTransactions,
  listPostgresTransactionsByMember,
  listPostgresUsers,
  listPostgresVehicles,
  listPostgresVehiclesByOwner,
  reconcilePostgresCoopBankEvent,
  reconcilePostgresPayment,
  reversePostgresTransaction,
  savePostgresPayment
} from './src/server/postgresStore';
import {
  LedgerPolicyError,
  getDailyContributionBalanceDelta,
  normalizeRefCode,
  normalizeTransactionInput,
  type LedgerInput
} from './src/server/ledgerPolicy';
import {
  isValidKenyanVehiclePlate,
  isValidPersonName,
  isValidPhoneNumber,
  sanitizeIntegerInput,
  sanitizePersonName,
  sanitizePhoneNumber,
  sanitizeVehiclePlate
} from './src/lib/inputValidation';
import { requiresRegisteredMember } from './src/lib/transactionPolicy';
import {
  hasActiveAccount,
  hasPermission,
  isMemberUser,
  memberOwnsId,
  memberScopeId,
  type AccountStatus,
  type SaccoPermission
} from './src/server/accessControl';
import { createBase32Secret, createTotpUri, verifyTotpCode } from './src/server/totp';
import { COOP_BANK_NAME } from './src/lib/collectionAccounts';
import { startBackgroundProcessor } from './src/server/backgroundProcessor';
import { configureProxyTrust, securityHeaders } from './src/server/securityMiddleware';
import { registerSystemRoutes } from './src/server/systemRoutes';
import { sendRecoveryCode } from './src/server/emailService';
import { canReviewLoanStage } from './src/server/loanWorkflow';
import { isSessionIdle } from './src/server/sessionPolicy';
import {
  CoopIpnError,
  assertCoopIpnAuthentication,
  assertCoopIpnConfiguration,
  classifyEventType,
  loadCoopIpnConfig,
  maskAccountNumber,
  normalizeCoopIpnPayload,
  normalizeReference,
  referenceCandidates,
  type CoopReconciliationStatus,
  type NormalizedCoopEvent
} from './src/server/coopBankIpn';
import type {
  CoopBankEvent,
  Member,
  MemberPortalData,
  PaymentRecord,
  Transaction,
  UserRole,
  Vehicle
} from './src/types';

class HttpError extends Error {
  status: number;
  code: string;

  constructor(status: number, message: string, code = 'REQUEST_FAILED') {
    super(message);
    this.name = 'HttpError';
    this.status = status;
    this.code = code;
  }
}

type AuthorizedUser = {
  id: string;
  name: string;
  email: string;
  role: UserRole;
  phone: string;
  isActive?: boolean;
  accountStatus?: AccountStatus;
  linkedMemberId?: string;
  devPassword?: string;
  totpSecret?: string;
  totpEnabledAt?: string;
  mustChangePassword?: boolean;
  temporaryPasswordExpiresAt?: string;
  lastActivityAt?: string;
};

type PasswordAuthenticatedUser = AuthorizedUser & {
  totpSecretCiphertext?: string;
  totpEnabledAt?: string;
};

const TOTP_REQUIRED_ROLES: readonly UserRole[] = ['Chairman', 'Treasurer', 'Secretary', 'Auditor', 'Accountant'];

const initialUsers: AuthorizedUser[] = [];
const initialMembers: Member[] = [];
const initialVehicles: any[] = [];
const initialTransactions: Transaction[] = [];

const JWT_ISSUER = 'matatu-sacco-management-system';
const JWT_AUDIENCE = 'sacco-api';
const DEFAULT_JWT_EXPIRES_SECONDS = 60 * 60 * 8;
const isProduction = process.env.NODE_ENV === 'production' || Boolean(process.env.K_SERVICE);
const postgresPool = createDatabasePool() as Pool | null;

function mapDbUser(row: any): AuthorizedUser {
  return {
    id: String(row.id),
    name: row.full_name,
    email: row.email || '',
    role: row.role as UserRole,
    phone: row.phone || '',
    isActive: row.is_active !== false,
    accountStatus: (row.account_status || 'Active') as AccountStatus,
    linkedMemberId: row.linked_member_id ? String(row.linked_member_id) : undefined,
    mustChangePassword: row.must_change_password === true,
    temporaryPasswordExpiresAt: row.temporary_password_expires_at ? new Date(row.temporary_password_expires_at).toISOString() : undefined,
    lastActivityAt: row.last_activity_at ? new Date(row.last_activity_at).toISOString() : undefined
  };
}

function mapPasswordAuthenticatedUser(row: any): PasswordAuthenticatedUser {
  return {
    ...mapDbUser(row),
    totpSecretCiphertext: row.totp_secret_ciphertext || undefined,
    totpEnabledAt: row.totp_enabled_at ? new Date(row.totp_enabled_at).toISOString() : undefined
  };
}

function normalizedEmail(value: unknown): string {
  return String(value || '').trim().toLowerCase();
}

function normalizedPersonName(value: unknown): string {
  return sanitizePersonName(value).trim().replace(/\s+/g, ' ').toLocaleLowerCase();
}

async function registerPasswordMemberAccount(input: { fullName: unknown; phone: unknown; email: unknown; password: unknown }): Promise<AuthorizedUser> {
  const fullName = sanitizePersonName(input.fullName).trim();
  const phone = sanitizePhoneNumber(input.phone).trim();
  const phoneDigits = normalizedPhone(phone);
  const email = normalizedEmail(input.email);
  const password = String(input.password || '');
  if (!isValidPersonName(fullName) || !isValidPhoneNumber(phone) || !/^\S+@\S+\.\S+$/.test(email) || password.length < 8) {
    throw new HttpError(400, 'Enter your full name, registered phone number and email, plus a password of at least 8 characters.', 'MEMBER_REGISTRATION_INVALID');
  }

  if (postgresPool) {
    const client = await postgresPool.connect();
    let committed = false;
    try {
      await client.query('BEGIN');
      const memberResult = await client.query(
        `SELECT id, full_name, phone, email
         FROM members
         WHERE status = 'Active'
           AND regexp_replace(COALESCE(phone, ''), '\\D', '', 'g') = $1
           AND lower(COALESCE(email, '')) = $2
         FOR UPDATE`,
        [phoneDigits, email]
      );
      if (memberResult.rowCount !== 1) {
        throw new HttpError(403, 'The phone number and email must match one active SACCO member record.', 'MEMBER_EMAIL_PHONE_MISMATCH');
      }
      const member = memberResult.rows[0];
      if (normalizedPersonName(member.full_name) !== normalizedPersonName(fullName)) {
        throw new HttpError(403, 'Your name, phone number, and email must match the same active SACCO member record.', 'MEMBER_IDENTITY_MISMATCH');
      }

      const existing = await client.query(
        `SELECT id, full_name, email, phone, role, is_active, account_status,
                linked_member_id, password_hash
         FROM users
         WHERE linked_member_id = $1 OR lower(COALESCE(email, '')) = $2
         LIMIT 1 FOR UPDATE`,
        [member.id, email]
      );
      let user: AuthorizedUser;
      if (existing.rowCount) {
        const row = existing.rows[0];
        if (row.role !== 'Member' || (row.linked_member_id && String(row.linked_member_id) !== String(member.id))) {
          throw new HttpError(409, 'This email is already assigned to another SACCO account.', 'MEMBER_PROFILE_CONFLICT');
        }
        if (row.password_hash) {
          throw new HttpError(409, 'An online account already exists for this member. Sign in or ask the Chairman to reset it.', 'MEMBER_ACCOUNT_EXISTS');
        }
        const updated = await client.query(
          `UPDATE users
           SET full_name = $1, phone = $2, email = $3, linked_member_id = $4,
               password_hash = crypt($5, gen_salt('bf')), is_active = TRUE,
               account_status = 'Active', approved_at = COALESCE(approved_at, now()), updated_at = now()
           WHERE id = $6
           RETURNING id, full_name, email, phone, role, is_active, account_status, linked_member_id`,
          [member.full_name, member.phone || phone, email, member.id, password, row.id]
        );
        user = mapDbUser(updated.rows[0]);
      } else {
        const created = await client.query(
          `INSERT INTO users (
             full_name, email, phone, role, password_hash, is_active,
             linked_member_id, account_status, approved_at
           ) VALUES ($1, $2, $3, 'Member', crypt($4, gen_salt('bf')), TRUE, $5, 'Active', now())
           RETURNING id, full_name, email, phone, role, is_active, account_status, linked_member_id`,
          [member.full_name, email, member.phone || phone, password, member.id]
        );
        user = mapDbUser(created.rows[0]);
      }
      await client.query('COMMIT');
      committed = true;
      return user;
    } catch (error) {
      if (!committed) await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  if (!allowInMemoryStore) {
    throw new HttpError(503, 'Member registration requires the SACCO database.', 'MEMBER_REGISTRATION_UNAVAILABLE');
  }
  const member = localStore.members.find(item =>
    item.status === 'Active'
    && normalizedPhone(item.phoneNumber) === phoneDigits
    && normalizedEmail(item.email) === email
    && normalizedPersonName(item.name) === normalizedPersonName(fullName)
  );
  if (!member) {
    throw new HttpError(403, 'Your name, phone number, and email must match the same active SACCO member record.', 'MEMBER_IDENTITY_MISMATCH');
  }
  const existing = localStore.users.find(item => item.linkedMemberId === member.id || normalizedEmail(item.email) === email);
  if (existing) throw new HttpError(409, 'An online account already exists for this member.', 'MEMBER_ACCOUNT_EXISTS');
  const user: AuthorizedUser = {
    id: `member-${crypto.randomUUID()}`,
    name: member.name,
    email,
    phone: member.phoneNumber,
    role: 'Member',
    isActive: true,
    accountStatus: 'Active',
    linkedMemberId: member.id,
    devPassword: password
  };
  localStore.users.push(user);
  return user;
}

async function recordAuditLog(req: express.Request, action: string, entityTable: string, entityId?: string, oldData?: unknown, newData?: unknown) {
  const user = (req as any).user as AuthorizedUser | undefined;
  const authContext = (req as any).authContext || {};
  if (!postgresPool) {
    return;
  }

  try {
    await postgresPool.query(
      `INSERT INTO audit_logs (
        actor_user_id, action, entity_table, entity_id, old_data, new_data,
        auth_provider, ip_address, user_agent
      )
      VALUES (
        $1, $2, $3, $4, $5::jsonb, $6::jsonb, $7, $8, $9
      )`,
      [
        user?.id?.match(/^[0-9a-f-]{36}$/i) ? user.id : null,
        action,
        entityTable,
        entityId?.match(/^[0-9a-f-]{36}$/i) ? entityId : null,
        oldData ? JSON.stringify(oldData) : null,
        newData ? JSON.stringify(newData) : null,
        authContext.provider || null,
        req.ip,
        req.headers['user-agent'] || null
      ]
    );
  } catch (error: any) {
    console.warn('[Sacco Audit] Failed to write audit log.');
  }
}

async function countSaccoAdmins(): Promise<number> {
  if (postgresPool) {
    const result = await postgresPool.query("SELECT COUNT(*)::int AS count FROM users WHERE role = 'Chairman'");
    return Number(result.rows[0]?.count || 0);
  }

  return localStore.users.filter(user => user.role === 'Chairman').length;
}

async function createFirstAdminProfile(input: {
  email: string;
  fullName: string;
  phone?: string;
  password: string;
}): Promise<AuthorizedUser> {
  const email = input.email.trim().toLowerCase();
  const fullName = input.fullName.trim();
  if (!email || !fullName || input.password.length < 8) {
    throw new HttpError(400, 'Full name, email, and a password of at least 8 characters are required to create the first SACCO admin.', 'BOOTSTRAP_FIELDS_REQUIRED');
  }

  if (postgresPool) {
    const result = await postgresPool.query(
      `INSERT INTO users (full_name, email, phone, role, password_hash, is_active, account_status, approved_at)
       VALUES ($1, $2, $3, 'Chairman', crypt($4, gen_salt('bf')), TRUE, 'Active', now())
       ON CONFLICT (email) DO NOTHING
       RETURNING id, full_name, email, phone, role, is_active, account_status, linked_member_id`,
      [fullName, email, input.phone || null, input.password]
    );
    if (!result.rowCount) {
      throw new HttpError(409, 'That email already belongs to a SACCO profile. Ask an existing admin for help.', 'BOOTSTRAP_EMAIL_EXISTS');
    }
    return mapDbUser(result.rows[0]);
  }

  if (await findDevelopmentUserByEmail(email)) {
    throw new HttpError(409, 'That email already belongs to a SACCO profile. Ask an existing admin for help.', 'BOOTSTRAP_EMAIL_EXISTS');
  }

  const newUser: AuthorizedUser = {
    id: `u-${Date.now()}`,
    name: fullName,
    email,
    phone: input.phone || '',
    role: 'Chairman',
    isActive: true,
    accountStatus: 'Active',
    devPassword: input.password
  };

  localStore.users.push(newUser);

  return newUser;
}

function base64Url(input: string | Buffer): string {
  return Buffer.from(input)
    .toString('base64')
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
}

function decodeBase64Url(input: string): Buffer {
  const normalized = input.replace(/-/g, '+').replace(/_/g, '/');
  return Buffer.from(normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '='), 'base64');
}

function getJwtSecret(): string {
  const secret = process.env.JWT_SECRET;
  if (!secret) {
    throw new HttpError(500, 'JWT_SECRET must be configured when development JWT authentication is enabled.', 'JWT_SECRET_MISSING');
  }
  return secret;
}

function getJwtExpiresSeconds(): number {
  const seconds = Number(process.env.JWT_EXPIRES_SECONDS || DEFAULT_JWT_EXPIRES_SECONDS);
  return Number.isFinite(seconds) && seconds > 0 ? Math.floor(seconds) : DEFAULT_JWT_EXPIRES_SECONDS;
}

function signJwt(user: AuthorizedUser): { token: string; expiresAt: string } {
  const now = Math.floor(Date.now() / 1000);
  const exp = now + getJwtExpiresSeconds();
  const header = { alg: 'HS256', typ: 'JWT' };
  const payload = {
    iss: JWT_ISSUER,
    aud: JWT_AUDIENCE,
    sub: user.id,
    email: user.email,
    role: user.role,
    name: user.name,
    iat: now,
    exp
  };

  const encodedHeader = base64Url(JSON.stringify(header));
  const encodedPayload = base64Url(JSON.stringify(payload));
  const signingInput = `${encodedHeader}.${encodedPayload}`;
  const signature = crypto.createHmac('sha256', getJwtSecret()).update(signingInput).digest();

  return {
    token: `${signingInput}.${base64Url(signature)}`,
    expiresAt: new Date(exp * 1000).toISOString()
  };
}

async function findDevelopmentUserByEmail(email: string): Promise<AuthorizedUser | null> {
  if (postgresPool) {
    const result = await postgresPool.query(
      `SELECT id, full_name, email, phone, role, is_active, account_status, linked_member_id
       FROM users
       WHERE lower(email) = $1
       LIMIT 1`,
      [email]
    );
    return result.rowCount ? mapDbUser(result.rows[0]) : null;
  }

  return localStore.users.find(item => item.email && item.email.toLowerCase() === email) || null;
}

async function findSaccoUserById(id: string): Promise<AuthorizedUser | null> {
  if (postgresPool) {
    const result = await postgresPool.query(
      `SELECT id, full_name, email, phone, role, is_active, account_status, linked_member_id,
              must_change_password, temporary_password_expires_at, last_activity_at
       FROM users WHERE id = $1 LIMIT 1`,
      [id]
    );
    return result.rowCount ? mapDbUser(result.rows[0]) : null;
  }
  return localStore.users.find(item => item.id === id) || null;
}

function normalizedPhone(value: unknown): string {
  return sanitizePhoneNumber(value).replace(/\D/g, '');
}

async function authenticatePasswordUser(identifierValue: unknown, password: string): Promise<PasswordAuthenticatedUser | null> {
  const identifier = String(identifierValue || '').trim();
  const phone = normalizedPhone(identifier);
  const email = identifier.toLowerCase();
  if (!identifier || !password || (!phone && !email.includes('@'))) return null;

  if (postgresPool) {
    const result = await postgresPool.query(
      `SELECT id, full_name, email, phone, role, is_active, account_status, linked_member_id,
              totp_secret_ciphertext, totp_enabled_at, must_change_password,
              temporary_password_expires_at, last_activity_at
       FROM users
       WHERE (($1 <> '' AND regexp_replace(COALESCE(phone, ''), '\\D', '', 'g') = $1)
          OR ($2 LIKE '%@%' AND lower(COALESCE(email, '')) = $2))
       AND password_hash IS NOT NULL
         AND password_hash = crypt($3, password_hash)
       LIMIT 1`,
      [phone, email, password]
    );
    return result.rowCount ? mapPasswordAuthenticatedUser(result.rows[0]) : null;
  }

  const user = localStore.users.find(item => {
    const itemPhone = normalizedPhone(item.phone);
    return (phone && itemPhone === phone) || (email.includes('@') && item.email?.toLowerCase() === email);
  });
  return user?.devPassword && password === user.devPassword ? { ...user, totpSecretCiphertext: user.totpSecret, totpEnabledAt: user.totpEnabledAt } : null;
}

async function verifyJwt(token: string): Promise<AuthorizedUser> {
  const parts = token.split('.');
  if (parts.length !== 3) {
    throw new HttpError(401, 'Invalid authentication token format.', 'INVALID_JWT');
  }

  const [encodedHeader, encodedPayload, encodedSignature] = parts;
  const header = JSON.parse(decodeBase64Url(encodedHeader).toString('utf8'));
  if (header.alg !== 'HS256' || header.typ !== 'JWT') {
    throw new HttpError(401, 'Unsupported authentication token algorithm.', 'INVALID_JWT_ALG');
  }

  const expectedSignature = crypto
    .createHmac('sha256', getJwtSecret())
    .update(`${encodedHeader}.${encodedPayload}`)
    .digest();
  const suppliedSignature = decodeBase64Url(encodedSignature);

  if (
    suppliedSignature.length !== expectedSignature.length ||
    !crypto.timingSafeEqual(suppliedSignature, expectedSignature)
  ) {
    throw new HttpError(401, 'Authentication token signature validation failed.', 'INVALID_JWT_SIGNATURE');
  }

  const payload = JSON.parse(decodeBase64Url(encodedPayload).toString('utf8'));
  const now = Math.floor(Date.now() / 1000);
  if (payload.iss !== JWT_ISSUER || payload.aud !== JWT_AUDIENCE || Number(payload.exp) <= now) {
    throw new HttpError(401, 'Authentication token is expired or not valid for this API.', 'JWT_EXPIRED');
  }

  const user = await findSaccoUserById(String(payload.sub || ''));
  if (!user || user.role !== payload.role || !hasActiveAccount(user)) {
    throw new HttpError(401, 'Authentication token user is no longer authorized.', 'JWT_USER_REVOKED');
  }

  if (isMemberUser(user) && !user.linkedMemberId) {
    throw new HttpError(401, 'Authentication token user is no longer authorized.', 'JWT_USER_REVOKED');
  }
  if (isSessionIdle(user.lastActivityAt)) {
    throw new HttpError(401, 'Your session expired after one hour of inactivity. Sign in again.', 'SESSION_IDLE_TIMEOUT');
  }
  if (postgresPool) {
    await postgresPool.query('UPDATE users SET last_activity_at = now() WHERE id = $1', [user.id]);
    user.lastActivityAt = new Date().toISOString();
  }
  return user;
}

// Disposable in-memory store, available only through an explicit development flag.
const localStore = {
  users: [...initialUsers],
  members: [...initialMembers],
  vehicles: [...initialVehicles],
  transactions: [...initialTransactions],
  payments: [] as PaymentRecord[],
  coopBankEvents: [] as Array<CoopBankEvent & { rawPayload: unknown }>,
  mfaChallenges: [] as Array<{
    id: string;
    userId: string;
    purpose: 'TotpLogin' | 'TotpEnrollment';
    expiresAt: string;
    attemptCount: number;
    maxAttempts: number;
    usedAt?: string;
  }>
};

const allowInMemoryStore = !isProduction && process.env.ALLOW_IN_MEMORY_DB === 'true';

const COOP_EVENT_PUBLIC_SELECT = `
  SELECT e.*, m.full_name AS matched_member_name, v.plate_number AS matched_vehicle_plate
  FROM coop_bank_ipn_events e
  LEFT JOIN members m ON m.id = e.matched_member_id
  LEFT JOIN vehicles v ON v.id = e.matched_vehicle_id`;

function toPublicCoopBankEvent(event: CoopBankEvent & { rawPayload?: unknown }): CoopBankEvent {
  const { rawPayload: _rawPayload, ...safe } = event;
  return safe;
}

function mapCoopBankEvent(row: any): CoopBankEvent {
  return {
    id: String(row.id),
    transactionId: String(row.transaction_id),
    paymentRef: row.payment_ref || undefined,
    accountNumber: maskAccountNumber(row.account_number),
    amount: Number(row.amount),
    currency: String(row.currency),
    eventType: String(row.event_type),
    narration: row.narration || '',
    customerMemoLine1: row.customer_memo_line1 || undefined,
    customerMemoLine2: row.customer_memo_line2 || undefined,
    customerMemoLine3: row.customer_memo_line3 || undefined,
    bookedBalance: row.booked_balance == null ? undefined : Number(row.booked_balance),
    clearedBalance: row.cleared_balance == null ? undefined : Number(row.cleared_balance),
    exchangeRate: row.exchange_rate == null ? undefined : Number(row.exchange_rate),
    postingDate: row.posting_date || undefined,
    valueDate: row.value_date || undefined,
    transactionDate: row.transaction_date || undefined,
    processingStatus: row.processing_status,
    reconciliationStatus: row.reconciliation_status,
    matchedMemberId: row.matched_member_id ? String(row.matched_member_id) : undefined,
    matchedMemberName: row.matched_member_name || undefined,
    matchedVehicleId: row.matched_vehicle_id ? String(row.matched_vehicle_id) : undefined,
    matchedVehiclePlate: row.matched_vehicle_plate || undefined,
    ledgerEntryId: row.ledger_entry_id ? String(row.ledger_entry_id) : undefined,
    matchMethod: row.match_method || undefined,
    matchConfidence: row.match_confidence == null ? undefined : Number(row.match_confidence),
    manualReviewReason: row.manual_review_reason || undefined,
    processingAttempts: Number(row.processing_attempts || 0),
    duplicateCount: Number(row.duplicate_count || 0),
    lastProcessingError: row.last_processing_error || undefined,
    receivedAt: new Date(row.received_at).toISOString(),
    processedAt: row.processed_at ? new Date(row.processed_at).toISOString() : undefined,
    reconciledAt: row.reconciled_at ? new Date(row.reconciled_at).toISOString() : undefined
  };
}

async function recordCoopBankAudit(input: {
  eventId?: string; action: string; actorType: 'SYSTEM' | 'BANK_CALLBACK' | 'USER'; actorUserId?: string;
  previousStatus?: string; newStatus?: string; reason?: string; correlationId: string; metadata?: unknown;
}): Promise<void> {
  if (!postgresPool) return;
  await postgresPool.query(
    `INSERT INTO coop_bank_event_audit (
       bank_event_id, action, actor_type, actor_user_id, previous_status,
       new_status, reason, correlation_id, metadata
     ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb)`,
    [input.eventId || null, input.action, input.actorType, input.actorUserId || null,
      input.previousStatus || null, input.newStatus || null, input.reason || null,
      input.correlationId, JSON.stringify(input.metadata || {})]
  );
}

async function persistCoopBankEvent(event: NormalizedCoopEvent, authenticationMode: string, correlationId: string): Promise<{ created: boolean; eventId: string }> {
  if (postgresPool) {
    const inserted = await postgresPool.query(
      `INSERT INTO coop_bank_ipn_events (
         provider, transaction_id, idempotency_key, payment_ref, account_number,
         amount, currency, event_type, narration, customer_memo_line1,
         customer_memo_line2, customer_memo_line3, booked_balance, cleared_balance,
         exchange_rate, posting_date, value_date, transaction_date, status,
         authentication_mode, processing_status, reconciliation_status, raw_payload
       ) VALUES (
         $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14,
         $15, $16, $17, $18, 'PendingReview', $19, 'RECEIVED', 'NOT_EVALUATED', $20::jsonb
       ) ON CONFLICT (idempotency_key) DO NOTHING RETURNING id`,
      [event.provider, event.externalTransactionId, event.idempotencyKey, event.paymentReference || null,
        event.accountNumber, event.amount, event.currency, event.eventType, event.narration,
        event.customerMemoLine1 || null, event.customerMemoLine2 || null, event.customerMemoLine3 || null,
        event.bookedBalance || null, event.clearedBalance || null, event.exchangeRate || null,
        event.postingDate || null, event.valueDate || null, event.transactionDate || null,
        authenticationMode, JSON.stringify(event.rawPayload)]
    );
    if (inserted.rowCount) {
      const eventId = String(inserted.rows[0].id);
      await recordCoopBankAudit({ eventId, action: 'CALLBACK_RECEIVED', actorType: 'BANK_CALLBACK', newStatus: 'RECEIVED', correlationId, metadata: { externalTransactionId: event.externalTransactionId } });
      return { created: true, eventId };
    }
    const duplicate = await postgresPool.query(
      `UPDATE coop_bank_ipn_events SET duplicate_count = duplicate_count + 1
       WHERE idempotency_key = $1 RETURNING id`,
      [event.idempotencyKey]
    );
    if (!duplicate.rowCount) throw new Error('Duplicate bank event could not be reloaded.');
    const eventId = String(duplicate.rows[0].id);
    await recordCoopBankAudit({ eventId, action: 'DUPLICATE_DETECTED', actorType: 'BANK_CALLBACK', correlationId, metadata: { externalTransactionId: event.externalTransactionId } });
    return { created: false, eventId };
  }

  if (!allowInMemoryStore) throw new HttpError(503, 'Durable bank event storage is unavailable.', 'COOP_IPN_PERSISTENCE_UNAVAILABLE');
  const existing = localStore.coopBankEvents.find(item => item.transactionId === event.externalTransactionId);
  if (existing) {
    existing.duplicateCount += 1;
    return { created: false, eventId: existing.id };
  }
  const receivedAt = new Date().toISOString();
  const stored: CoopBankEvent & { rawPayload: unknown } = {
    id: `coop-event-${crypto.randomUUID()}`,
    transactionId: event.externalTransactionId,
    paymentRef: event.paymentReference,
    accountNumber: maskAccountNumber(event.accountNumber),
    amount: Number(event.amount), currency: event.currency, eventType: event.eventType,
    narration: event.narration, customerMemoLine1: event.customerMemoLine1,
    customerMemoLine2: event.customerMemoLine2, customerMemoLine3: event.customerMemoLine3,
    bookedBalance: event.bookedBalance ? Number(event.bookedBalance) : undefined,
    clearedBalance: event.clearedBalance ? Number(event.clearedBalance) : undefined,
    exchangeRate: event.exchangeRate ? Number(event.exchangeRate) : undefined,
    postingDate: event.postingDate, valueDate: event.valueDate, transactionDate: event.transactionDate,
    processingStatus: 'RECEIVED', reconciliationStatus: 'NOT_EVALUATED', processingAttempts: 0,
    duplicateCount: 0, receivedAt, rawPayload: event.rawPayload
  };
  localStore.coopBankEvents.push(stored);
  return { created: true, eventId: stored.id };
}

function coopMatchCandidates(event: any, members: any[], vehicles: any[]) {
  const candidates = referenceCandidates({
    paymentReference: event.payment_ref,
    customerMemoLine1: event.customer_memo_line1,
    customerMemoLine2: event.customer_memo_line2,
    customerMemoLine3: event.customer_memo_line3,
    narration: event.narration
  });
  const matches = new Map<string, { memberId: string; vehicleId?: string; method: string }>();
  for (const candidate of candidates) {
    for (const member of members) {
      const fields: Array<[unknown, string]> = [[member.member_number, 'MEMBER_NUMBER'], [member.id, 'MEMBER_ID'], [member.phone, 'PHONE']];
      const matched = fields.find(([value]) => value && normalizeReference(value) === candidate);
      if (matched) matches.set(String(member.id), { memberId: String(member.id), method: matched[1] });
    }
    for (const vehicle of vehicles) {
      if (normalizeReference(vehicle.plate_number) === candidate && vehicle.member_id) {
        matches.set(String(vehicle.member_id), { memberId: String(vehicle.member_id), vehicleId: String(vehicle.id), method: 'VEHICLE_PLATE' });
      }
    }
  }
  return [...matches.values()];
}

async function processCoopBankEvent(eventId: string, correlationId: string = crypto.randomUUID()): Promise<void> {
  if (!postgresPool) {
    const event = localStore.coopBankEvents.find(item => item.id === eventId);
    if (!event || ['MANUALLY_RECONCILED', 'POSTED'].includes(event.reconciliationStatus)) return;
    event.processingAttempts += 1;
    const classification = classifyEventType(event.eventType);
    event.processingStatus = classification.processingStatus;
    event.reconciliationStatus = classification.reconciliationStatus;
    event.manualReviewReason = classification.reason;
    if (event.eventType === 'CREDIT') {
      const raw = (event.rawPayload && typeof event.rawPayload === 'object' ? event.rawPayload : {}) as Record<string, unknown>;
      const matches = coopMatchCandidates(
        {
          payment_ref: raw.PaymentRef, customer_memo_line1: raw.CustMemoLine1,
          customer_memo_line2: raw.CustMemoLine2, customer_memo_line3: raw.CustMemoLine3,
          narration: raw.Narration
        },
        localStore.members.map(member => ({ id: member.id, member_number: member.membershipNumber, phone: member.phoneNumber })),
        localStore.vehicles.map(vehicle => ({ id: vehicle.id, member_id: vehicle.ownerId, plate_number: vehicle.plateNumber }))
      );
      if (matches.length === 1) {
        event.matchedMemberId = matches[0].memberId;
        event.matchedVehicleId = matches[0].vehicleId;
        event.matchMethod = matches[0].method;
        event.matchConfidence = 1;
        event.reconciliationStatus = 'PENDING_ALLOCATION';
        event.manualReviewReason = 'Member matched exactly; an officer must choose the ledger allocation.';
      } else if (matches.length > 1) {
        event.reconciliationStatus = 'AMBIGUOUS';
        event.manualReviewReason = 'More than one member matched the supplied references.';
      } else {
        event.reconciliationStatus = 'UNMATCHED';
        event.manualReviewReason = 'No exact member, phone, or vehicle reference match was found.';
      }
    }
    event.processedAt = new Date().toISOString();
    return;
  }

  const leased = await postgresPool.query(
    `UPDATE coop_bank_ipn_events
     SET processing_status = 'PROCESSING', processing_attempts = processing_attempts + 1,
         last_processing_error = NULL
     WHERE id = $1 AND ledger_entry_id IS NULL
       AND reconciliation_status NOT IN ('POSTED','MANUALLY_RECONCILED')
       AND processing_status <> 'PROCESSING'
     RETURNING *`,
    [eventId]
  );
  if (!leased.rowCount) return;
  const event = leased.rows[0];
  try {
    await recordCoopBankAudit({ eventId, action: 'PROCESSING_STARTED', actorType: 'SYSTEM', previousStatus: event.processing_status, newStatus: 'PROCESSING', correlationId });
    const classification = classifyEventType(event.event_type);
    let reconciliationStatus: CoopReconciliationStatus = classification.reconciliationStatus;
    let matchedMemberId: string | null = null;
    let matchedVehicleId: string | null = null;
    let matchMethod: string | null = null;
    let confidence: number | null = null;
    let reason = classification.reason || null;
    if (event.event_type === 'CREDIT') {
      const [memberResult, vehicleResult] = await Promise.all([
        postgresPool.query(`SELECT id, member_number, phone FROM members WHERE status = 'Active'`),
        postgresPool.query(`SELECT id, member_id, plate_number FROM vehicles WHERE status = 'Active'`)
      ]);
      const matches = coopMatchCandidates(event, memberResult.rows, vehicleResult.rows);
      if (matches.length === 1) {
        matchedMemberId = matches[0].memberId;
        matchedVehicleId = matches[0].vehicleId || null;
        matchMethod = matches[0].method;
        confidence = 1;
        reconciliationStatus = 'PENDING_ALLOCATION';
        reason = 'Member matched exactly; an officer must choose the ledger allocation.';
      } else if (matches.length > 1) {
        reconciliationStatus = 'AMBIGUOUS';
        reason = 'More than one member matched the supplied references.';
      } else {
        reconciliationStatus = 'UNMATCHED';
        reason = 'No exact member, phone, or vehicle reference match was found.';
      }
    }
    await postgresPool.query(
      `UPDATE coop_bank_ipn_events
       SET processing_status = $2, reconciliation_status = $3, matched_member_id = $4,
           matched_vehicle_id = $5, match_method = $6, match_confidence = $7,
           manual_review_reason = $8, processed_at = now()
       WHERE id = $1`,
      [eventId, classification.processingStatus, reconciliationStatus, matchedMemberId,
        matchedVehicleId, matchMethod, confidence, reason]
    );
    await recordCoopBankAudit({ eventId, action: reconciliationStatus, actorType: 'SYSTEM', previousStatus: 'NOT_EVALUATED', newStatus: reconciliationStatus, reason: reason || undefined, correlationId });
  } catch (error: any) {
    const safeError = String(error?.message || 'Bank event processing failed.').slice(0, 500);
    await postgresPool.query(
      `UPDATE coop_bank_ipn_events SET processing_status = 'FAILED', last_processing_error = $2 WHERE id = $1`,
      [eventId, safeError]
    );
    await recordCoopBankAudit({ eventId, action: 'PROCESSING_FAILED', actorType: 'SYSTEM', previousStatus: 'PROCESSING', newStatus: 'FAILED', reason: safeError, correlationId });
  }
}

export async function resumePendingCoopBankEvents(): Promise<void> {
  if (!postgresPool) return;
  const config = loadCoopIpnConfig();
  if (!config.enabled) return;
  await postgresPool.query(
    `UPDATE coop_bank_ipn_events SET processing_status = 'RECEIVED',
       last_processing_error = COALESCE(last_processing_error, 'Recovered an expired processing lease.')
     WHERE processing_status = 'PROCESSING' AND updated_at < now() - interval '5 minutes'
       AND ledger_entry_id IS NULL`
  );
  const pending = await postgresPool.query(
    `SELECT id FROM coop_bank_ipn_events
     WHERE processing_status IN ('RECEIVED','FAILED') AND ledger_entry_id IS NULL
       AND reconciliation_status NOT IN ('POSTED','MANUALLY_RECONCILED')
     ORDER BY received_at LIMIT 100`
  );
  for (const row of pending.rows) await processCoopBankEvent(String(row.id));
}

async function listCoopBankEvents(filters: Record<string, unknown> = {}): Promise<CoopBankEvent[]> {
  if (!postgresPool) return localStore.coopBankEvents.map(toPublicCoopBankEvent).sort((a, b) => Date.parse(b.receivedAt) - Date.parse(a.receivedAt));
  const clauses: string[] = [];
  const values: unknown[] = [];
  const add = (sql: string, value: unknown) => { values.push(value); clauses.push(sql.replace('?', `$${values.length}`)); };
  if (filters.status) add(`e.reconciliation_status = ?`, String(filters.status));
  if (filters.eventType) add(`e.event_type = ?`, String(filters.eventType).toUpperCase());
  if (filters.memberId) add(`e.matched_member_id = ?::uuid`, String(filters.memberId));
  if (filters.reference) {
    values.push(String(filters.reference).slice(0, 100));
    clauses.push(`(e.payment_ref ILIKE '%' || $${values.length} || '%' OR e.transaction_id ILIKE '%' || $${values.length} || '%')`);
  }
  if (filters.dateFrom) add(`e.received_at >= ?::date`, String(filters.dateFrom));
  if (filters.dateTo) add(`e.received_at < (?::date + interval '1 day')`, String(filters.dateTo));
  if (filters.amount) add(`e.amount = ?::numeric`, String(filters.amount));
  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
  const result = await postgresPool.query(`${COOP_EVENT_PUBLIC_SELECT} ${where} ORDER BY e.received_at DESC LIMIT 250`, values);
  return result.rows.map(mapCoopBankEvent);
}

async function coopBankOperationalCounts() {
  if (!postgresPool) {
    return { total: localStore.coopBankEvents.length, receivedToday: localStore.coopBankEvents.length,
      unmatched: localStore.coopBankEvents.filter(item => item.reconciliationStatus === 'UNMATCHED').length,
      ambiguous: localStore.coopBankEvents.filter(item => item.reconciliationStatus === 'AMBIGUOUS').length,
      pendingAllocation: localStore.coopBankEvents.filter(item => item.reconciliationStatus === 'PENDING_ALLOCATION').length,
      posted: localStore.coopBankEvents.filter(item => ['POSTED', 'MANUALLY_RECONCILED'].includes(item.reconciliationStatus)).length,
      failed: localStore.coopBankEvents.filter(item => item.processingStatus === 'FAILED').length,
      quarantined: localStore.coopBankEvents.filter(item => item.processingStatus === 'QUARANTINED').length,
      duplicates: localStore.coopBankEvents.reduce((sum, item) => sum + item.duplicateCount, 0), lastSuccessfulCallbackAt: null };
  }
  const result = await postgresPool.query(
    `SELECT count(*)::int AS total,
       count(*) FILTER (WHERE received_at::date = current_date)::int AS received_today,
       count(*) FILTER (WHERE reconciliation_status = 'UNMATCHED')::int AS unmatched,
       count(*) FILTER (WHERE reconciliation_status = 'AMBIGUOUS')::int AS ambiguous,
       count(*) FILTER (WHERE reconciliation_status = 'PENDING_ALLOCATION')::int AS pending_allocation,
       count(*) FILTER (WHERE reconciliation_status IN ('POSTED','MANUALLY_RECONCILED'))::int AS posted,
       count(*) FILTER (WHERE processing_status = 'FAILED')::int AS failed,
       count(*) FILTER (WHERE processing_status = 'QUARANTINED')::int AS quarantined,
       COALESCE(sum(duplicate_count), 0)::int AS duplicates,
       max(received_at) AS last_successful_callback_at
     FROM coop_bank_ipn_events`
  );
  const row = result.rows[0];
  return { total: row.total, receivedToday: row.received_today, unmatched: row.unmatched,
    ambiguous: row.ambiguous, pendingAllocation: row.pending_allocation, posted: row.posted,
    failed: row.failed, quarantined: row.quarantined, duplicates: row.duplicates,
    lastSuccessfulCallbackAt: row.last_successful_callback_at ? new Date(row.last_successful_callback_at).toISOString() : null };
}

function coopBankPublicConfig() {
  const config = loadCoopIpnConfig();
  const baseUrl = String(process.env.APP_URL || '').replace(/\/+$/, '');
  const webhookPath = '/api/integrations/coop/ipn';
  return {
    provider: COOP_BANK_NAME,
    enabled: config.enabled,
    webhookPath,
    webhookUrl: baseUrl ? `${baseUrl}${webhookPath}` : '',
    authMode: config.authMode === 'TOKEN' ? 'Token' : 'Basic',
    authenticationConfigured: config.authMode === 'TOKEN' ? Boolean(config.token) : Boolean(config.basicUsername && config.basicPassword),
    configuredAccountCount: config.allowedAccountNumbers.length,
    observeOnly: config.observeOnly,
    autoPostingEnabled: config.autoPostingEnabled
  };
}

function passwordAuthenticationEnabled(): boolean {
  return process.env.PASSWORD_AUTH_ENABLED !== 'false';
}

function requiresTotp(user: AuthorizedUser): boolean {
  return process.env.OFFICER_TOTP_REQUIRED === 'true' && TOTP_REQUIRED_ROLES.includes(user.role);
}

function getTotpEncryptionKey(): Buffer {
  const configured = String(process.env.TOTP_ENCRYPTION_KEY || '').trim();
  const key = Buffer.from(configured, 'base64');
  if (key.length !== 32) {
    throw new HttpError(503, 'Officer two-factor authentication is not configured.', 'TOTP_UNAVAILABLE');
  }
  return key;
}

function encryptTotpSecret(secret: string): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', getTotpEncryptionKey(), iv);
  const encrypted = Buffer.concat([cipher.update(secret, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString('base64')}.${tag.toString('base64')}.${encrypted.toString('base64')}`;
}

function decryptTotpSecret(ciphertext: string): string {
  const [ivEncoded, tagEncoded, encryptedEncoded, ...extra] = ciphertext.split('.');
  if (!ivEncoded || !tagEncoded || !encryptedEncoded || extra.length) {
    throw new HttpError(503, 'Officer two-factor authentication needs to be reset by an administrator.', 'TOTP_SECRET_INVALID');
  }
  try {
    const decipher = crypto.createDecipheriv('aes-256-gcm', getTotpEncryptionKey(), Buffer.from(ivEncoded, 'base64'));
    decipher.setAuthTag(Buffer.from(tagEncoded, 'base64'));
    return Buffer.concat([decipher.update(Buffer.from(encryptedEncoded, 'base64')), decipher.final()]).toString('utf8');
  } catch {
    throw new HttpError(503, 'Officer two-factor authentication needs to be reset by an administrator.', 'TOTP_SECRET_INVALID');
  }
}

type TotpChallengeStart = {
  requiresTotp: true;
  challengeId: string;
  expiresAt: string;
  enrollment?: { manualKey: string; otpauthUri: string };
};

function publicUser(user: AuthorizedUser): AuthorizedUser {
  const { devPassword: _devPassword, totpSecret: _totpSecret, lastActivityAt: _lastActivityAt, ...safeUser } = user;
  return safeUser;
}

function createTotpEnrollmentDetails(user: AuthorizedUser, secret: string) {
  const issuer = String(process.env.TOTP_ISSUER || 'Sowetamu Sacco').trim() || 'Sowetamu Sacco';
  return {
    manualKey: secret,
    otpauthUri: createTotpUri(issuer, user.email || user.phone || user.name, secret)
  };
}

async function startOfficerTotpChallenge(user: PasswordAuthenticatedUser): Promise<TotpChallengeStart> {
  const challengeId = crypto.randomUUID();
  const expiresAt = new Date(Date.now() + 5 * 60_000).toISOString();
  let secret: string;
  let purpose: 'TotpLogin' | 'TotpEnrollment';

  if (postgresPool) {
    if (user.totpSecretCiphertext) {
      secret = decryptTotpSecret(user.totpSecretCiphertext);
      purpose = user.totpEnabledAt ? 'TotpLogin' : 'TotpEnrollment';
    } else {
      secret = createBase32Secret();
      purpose = 'TotpEnrollment';
      await postgresPool.query(
        'UPDATE users SET totp_secret_ciphertext = $1, totp_enabled_at = NULL, updated_at = now() WHERE id = $2',
        [encryptTotpSecret(secret), user.id]
      );
    }
    await postgresPool.query(
      `INSERT INTO auth_mfa_challenges (id, user_id, purpose, expires_at)
       VALUES ($1, $2, $3, $4)`,
      [challengeId, user.id, purpose, expiresAt]
    );
  } else {
    const stored = localStore.users.find(item => item.id === user.id);
    if (!stored) throw new HttpError(401, 'Invalid SACCO profile or password.', 'INVALID_CREDENTIALS');
    secret = stored.totpSecret || createBase32Secret();
    purpose = stored.totpEnabledAt ? 'TotpLogin' : 'TotpEnrollment';
    stored.totpSecret = secret;
    localStore.mfaChallenges.push({ id: challengeId, userId: user.id, purpose, expiresAt, attemptCount: 0, maxAttempts: 5 });
  }

  return {
    requiresTotp: true,
    challengeId,
    expiresAt,
    ...(purpose === 'TotpEnrollment' ? { enrollment: createTotpEnrollmentDetails(user, secret) } : {})
  };
}

async function verifyOfficerTotpChallenge(challengeIdValue: unknown, codeValue: unknown): Promise<AuthorizedUser> {
  const challengeId = String(challengeIdValue || '').trim();
  const code = String(codeValue || '').trim();
  if (!challengeId.match(/^[0-9a-f-]{36}$/i) || !/^\d{6}$/.test(code)) {
    throw new HttpError(400, 'The authenticator code is invalid or has expired.', 'TOTP_CODE_INVALID');
  }

  if (!postgresPool) {
    const challenge = localStore.mfaChallenges.find(item => item.id === challengeId);
    const user = challenge && localStore.users.find(item => item.id === challenge.userId);
    if (!challenge || !user || challenge.usedAt || new Date(challenge.expiresAt).getTime() <= Date.now() || challenge.attemptCount >= challenge.maxAttempts || !user.totpSecret) {
      throw new HttpError(400, 'The authenticator code is invalid or has expired.', 'TOTP_CODE_INVALID');
    }
    if (!verifyTotpCode(user.totpSecret, code)) {
      challenge.attemptCount += 1;
      throw new HttpError(400, 'The authenticator code is invalid or has expired.', 'TOTP_CODE_INVALID');
    }
    challenge.usedAt = new Date().toISOString();
    if (challenge.purpose === 'TotpEnrollment') user.totpEnabledAt = new Date().toISOString();
    return user;
  }

  const client = await postgresPool.connect();
  let committed = false;
  try {
    await client.query('BEGIN');
    const result = await client.query(
      `SELECT c.id AS challenge_id, c.purpose, c.expires_at, c.attempt_count, c.max_attempts, c.used_at,
              u.id, u.full_name, u.email, u.phone, u.role, u.is_active, u.account_status,
              u.linked_member_id, u.totp_secret_ciphertext, u.totp_enabled_at
       FROM auth_mfa_challenges c
       JOIN users u ON u.id = c.user_id
       WHERE c.id = $1
       FOR UPDATE`,
      [challengeId]
    );
    const row = result.rows[0];
    if (!row || row.used_at || new Date(row.expires_at).getTime() <= Date.now() || row.attempt_count >= row.max_attempts || !row.totp_secret_ciphertext) {
      throw new HttpError(400, 'The authenticator code is invalid or has expired.', 'TOTP_CODE_INVALID');
    }
    const user = mapPasswordAuthenticatedUser(row);
    if (!hasActiveAccount(user) || !requiresTotp(user) || !verifyTotpCode(decryptTotpSecret(row.totp_secret_ciphertext), code)) {
      await client.query('UPDATE auth_mfa_challenges SET attempt_count = attempt_count + 1 WHERE id = $1', [challengeId]);
      await client.query('COMMIT');
      committed = true;
      throw new HttpError(400, 'The authenticator code is invalid or has expired.', 'TOTP_CODE_INVALID');
    }
    if (row.purpose === 'TotpEnrollment') {
      await client.query('UPDATE users SET totp_enabled_at = now(), last_login_at = now() WHERE id = $1', [user.id]);
    } else {
      await client.query('UPDATE users SET last_login_at = now() WHERE id = $1', [user.id]);
    }
    await client.query('UPDATE auth_mfa_challenges SET used_at = now() WHERE id = $1', [challengeId]);
    await client.query('COMMIT');
    committed = true;
    return user;
  } catch (error) {
    if (!committed) await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

async function completePasswordAuthentication(user: PasswordAuthenticatedUser): Promise<Record<string, unknown>> {
  requireActiveAccount(user);
  if (isMemberUser(user)) {
    requireLinkedMember(user);
  }
  if (user.mustChangePassword && user.temporaryPasswordExpiresAt && new Date(user.temporaryPasswordExpiresAt).getTime() <= Date.now()) {
    throw new HttpError(401, 'The temporary password has expired. Ask the Chairman to issue another one.', 'TEMPORARY_PASSWORD_EXPIRED');
  }
  if (requiresTotp(user)) {
    return { user: publicUser(user), ...(await startOfficerTotpChallenge(user)) };
  }
  if (postgresPool) await postgresPool.query('UPDATE users SET last_login_at = now(), last_activity_at = now() WHERE id = $1', [user.id]);
  const signed = signJwt(user);
  return {
    user: publicUser(user),
    token: signed.token,
    expiresAt: signed.expiresAt,
    tokenType: 'Bearer',
    authProvider: 'password',
    passwordChangeRequired: user.mustChangePassword === true
  };
}

function applyLocalMemberBalance(tx: Transaction) {
  const delta = getDailyContributionBalanceDelta(tx);
  if (!delta.shares && !delta.savings && !delta.loan) return;

  const member = localStore.members.find(m => m.id === tx.memberId);
  if (!member) {
    throw new HttpError(404, 'Linked Sacco member profile was not found.', 'MEMBER_NOT_FOUND');
  }

  member.sharesAmount = Math.max(0, (member.sharesAmount || 0) + delta.shares);
  member.savingsAmount = Math.max(0, (member.savingsAmount || 0) + delta.savings);
  const loanCeiling = Number(member.initialLoanAmount ?? member.loanBalance ?? 0);
  member.loanBalance = Math.min(loanCeiling, Math.max(0, Number(member.loanBalance || 0) + delta.loan));
}

async function createLedgerTransaction(input: LedgerInput): Promise<Transaction> {
  const tx = normalizeTransactionInput(input);
  await validateLedgerRegistration(tx);

  if (postgresPool) {
    return createPostgresTransaction(postgresPool, tx);
  }

  await Promise.resolve((() => {
      const duplicate = localStore.transactions.some(t => normalizeRefCode(t.refCode) === tx.refCode);
      if (duplicate) {
        throw new HttpError(409, `Reference code ${tx.refCode} already exists in the ledger.`, 'DUPLICATE_LEDGER_REF');
      }

      applyLocalMemberBalance(tx);
      localStore.transactions.push(tx);
      return tx;
    })());

  return tx;
}

async function updateLedgerTransaction(transactionId: string, input: LedgerInput): Promise<Transaction> {
  if (postgresPool) {
    const original = (await listPostgresTransactions(postgresPool)).find(transaction => transaction.id === transactionId);
    if (!original) throw new HttpError(404, 'Transaction to edit was not found.', 'TRANSACTION_NOT_FOUND');
    const candidate = normalizeTransactionInput({
      ...original,
      ...input,
      id: original.id,
      timestamp: original.timestamp,
      refCode: original.refCode
    });
    await validateLedgerRegistration(candidate);
    return correctPostgresTransaction(postgresPool, transactionId, input);
  }
  const original = await Promise.resolve((() => localStore.transactions.find(tx => tx.id === transactionId) || null)());
  if (!original) throw new HttpError(404, 'Transaction to edit was not found.', 'TRANSACTION_NOT_FOUND');
  if (original.reversedAt || original.reversalOf) {
    throw new HttpError(409, 'Reversed ledger entries cannot be edited.', 'TRANSACTION_NOT_EDITABLE');
  }

  const updated = normalizeTransactionInput({
    ...original,
    ...input,
    id: original.id,
    timestamp: original.timestamp,
    refCode: original.refCode
  });
  await validateLedgerRegistration(updated);
  const reverseOriginal = { ...original, type: original.type === 'Credit' ? 'Debit' : 'Credit' } as Transaction;

  await Promise.resolve((() => {
      applyLocalMemberBalance(reverseOriginal);
      applyLocalMemberBalance(updated);
      const index = localStore.transactions.findIndex(tx => tx.id === transactionId);
      localStore.transactions[index] = updated;
      return updated;
    })());
  return updated;
}

async function reverseLedgerTransaction(transactionId: string, recorderName: string): Promise<Transaction> {
  if (postgresPool) {
    return reversePostgresTransaction(postgresPool, transactionId, recorderName);
  }
  const original = await Promise.resolve((() => localStore.transactions.find(tx => tx.id === transactionId) || null)());

  if (!original) {
    throw new HttpError(404, 'Transaction to reverse was not found.', 'TRANSACTION_NOT_FOUND');
  }

  const existingReversal = await Promise.resolve((() => localStore.transactions.find(tx => tx.reversalOf === original.id) || null)());

  if (existingReversal) {
    throw new HttpError(409, `Transaction ${original.refCode} has already been reversed.`, 'ALREADY_REVERSED');
  }

  return createLedgerTransaction({
    memberId: original.memberId,
    memberName: original.memberName,
    vehiclePlate: original.vehiclePlate,
    description: `Reversal of ${original.refCode}: ${original.description}`,
    refCode: `REV-${original.refCode}-${Date.now().toString().slice(-6)}`,
    type: original.type === 'Credit' ? 'Debit' : 'Credit',
    category: original.category,
    amount: original.amount,
    recorderName,
    tillNumber: original.tillNumber,
    reversalOf: original.id,
    reversedAt: new Date().toISOString(),
    reversedBy: recorderName
  });
}

function sendApiError(res: express.Response, error: any) {
  if (error instanceof HttpError || error instanceof PersistenceError || error instanceof LedgerPolicyError) {
    return res.status(error.status).json({ error: error.message, code: error.code });
  }
  console.error('[Sacco API] Unexpected request failure.');
  return res.status(500).json({ error: 'Unexpected server error.', code: 'INTERNAL_ERROR' });
}

async function listPaymentRecords(): Promise<PaymentRecord[]> {
  if (postgresPool) {
    return listPostgresPayments(postgresPool);
  }

  const list = await Promise.resolve((() => localStore.payments)());

  return [...list].sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
}

async function savePaymentRecord(record: PaymentRecord): Promise<PaymentRecord> {
  if (postgresPool) {
    return savePostgresPayment(postgresPool, record);
  }

  await Promise.resolve((() => {
      const idx = localStore.payments.findIndex(payment => payment.id === record.id);
      if (idx >= 0) {
        localStore.payments[idx] = record;
      } else {
        localStore.payments.push(record);
      }
    })());

  return record;
}

async function getAllMembers(): Promise<Member[]> {
  if (postgresPool) {
    return listPostgresMembers(postgresPool);
  }

  return Promise.resolve((() => localStore.members as Member[])());
}

async function getAllVehicles(): Promise<Vehicle[]> {
  if (postgresPool) {
    return listPostgresVehicles(postgresPool);
  }

  return Promise.resolve((() => localStore.vehicles as Vehicle[])());
}

function maskSensitiveValue(value: string, visibleSuffix = 4): string {
  const compact = String(value || '').trim();
  if (!compact) return '';
  if (compact.length <= visibleSuffix) return '••••';
  return `${'•'.repeat(Math.max(4, compact.length - visibleSuffix))}${compact.slice(-visibleSuffix)}`;
}

function toMemberPortalProfile(member: Member): Member {
  return {
    ...member,
    idNumber: maskSensitiveValue(member.idNumber),
    // A member may confirm their registered phone, but a client response does
    // not need to expose the full number after activation.
    phoneNumber: maskSensitiveValue(member.phoneNumber)
  };
}

function toMemberPortalTransaction(transaction: Transaction): Transaction {
  return {
    ...transaction,
    recorderName: 'SACCO Ledger'
  };
}

function toMemberPortalPayment(payment: PaymentRecord): PaymentRecord {
  return {
    ...payment,
    payerPhone: maskSensitiveValue(payment.payerPhone),
    rawPayload: undefined
  };
}

async function getMemberPortalData(user: AuthorizedUser): Promise<MemberPortalData> {
  const linkedMemberId = requireLinkedMember(user);
  if (postgresPool) {
    const [member, vehicles, driverAssignments, transactions, payments, loans] = await Promise.all([
      getPostgresMember(postgresPool, linkedMemberId),
      listPostgresVehiclesByOwner(postgresPool, linkedMemberId),
      listPostgresDriverAssignmentsByOwner(postgresPool, linkedMemberId),
      listPostgresTransactionsByMember(postgresPool, linkedMemberId),
      listPostgresPaymentsByMember(postgresPool, linkedMemberId),
      listPostgresLoansByMember(postgresPool, linkedMemberId)
    ]);
    if (!member) {
      throw new HttpError(403, 'This member account is not linked to an active SACCO member record.', 'MEMBER_LINK_INVALID');
    }
    return {
      member: toMemberPortalProfile(member),
      vehicles,
      driverAssignments,
      transactions: transactions.map(toMemberPortalTransaction),
      payments: payments.map(toMemberPortalPayment),
      loans
    };
  }

  const [members, vehicles, transactions, payments] = await Promise.all([
    getAllMembers(),
    getAllVehicles(),
    listPaymentRecords()
  ]).then(async ([allMembers, allVehicles, allPayments]) => [
    allMembers,
    allVehicles,
    localStore.transactions.filter(transaction => transaction.memberId === linkedMemberId),
    allPayments
  ] as const);
  const member = members.find(item => item.id === linkedMemberId);
  if (!member) {
    throw new HttpError(403, 'This member account is not linked to an active SACCO member record.', 'MEMBER_LINK_INVALID');
  }
  const ownedVehicles = vehicles.filter(vehicle => vehicle.ownerId === linkedMemberId);
  return {
    member: toMemberPortalProfile(member),
    vehicles: ownedVehicles,
    driverAssignments: [],
    transactions: transactions
      .filter(transaction => transaction.memberId === linkedMemberId || ownedVehicles.some(vehicle => vehicle.plateNumber === transaction.vehiclePlate))
      .map(toMemberPortalTransaction),
    payments: payments
      .filter(payment => payment.memberId === linkedMemberId || (payment.vehiclePlate && ownedVehicles.some(vehicle => vehicle.plateNumber === payment.vehiclePlate)))
      .map(toMemberPortalPayment),
    loans: []
  };
}

async function validateLedgerRegistration(tx: Transaction): Promise<void> {
  if (!requiresRegisteredMember(tx.category) || tx.reversalOf) return;

  const typedName = tx.memberName?.trim() || '';
  if (!tx.memberId && !typedName) {
    throw new HttpError(400, 'Type a registered member name before posting this transaction.', 'REGISTERED_MEMBER_REQUIRED');
  }

  if (postgresPool) {
    const memberResult = tx.memberId
      ? await postgresPool.query(
          'SELECT id, full_name, status FROM members WHERE id::text = $1 LIMIT 1',
          [tx.memberId]
        )
      : await postgresPool.query(
          'SELECT id, full_name, status FROM members WHERE lower(trim(full_name)) = lower($1) LIMIT 1',
          [typedName]
        );
    if (!memberResult.rowCount) {
      throw new HttpError(400, `Name "${typedName || tx.memberId}" is not registered. Register the member first.`, 'MEMBER_NAME_NOT_REGISTERED');
    }

    const member = memberResult.rows[0];
    if (member.status !== 'Active') {
      throw new HttpError(409, `Member "${member.full_name}" is not active.`, 'MEMBER_NOT_ACTIVE');
    }
    tx.memberId = String(member.id);
    tx.memberName = member.full_name;

    if (!tx.vehiclePlate?.trim()) return;
    const normalizedPlate = tx.vehiclePlate.replace(/\s+/g, '').toUpperCase();
    const vehicleResult = await postgresPool.query(
      `SELECT id, member_id, plate_number, status
       FROM vehicles
       WHERE upper(replace(plate_number, ' ', '')) = $1
       LIMIT 1`,
      [normalizedPlate]
    );
    if (!vehicleResult.rowCount) {
      throw new HttpError(400, `Car/V.REG "${tx.vehiclePlate}" is not registered. Onboard the vehicle first.`, 'VEHICLE_NOT_REGISTERED');
    }
    const vehicle = vehicleResult.rows[0];
    if (String(vehicle.member_id) !== tx.memberId) {
      throw new HttpError(400, `Car/V.REG "${vehicle.plate_number}" is not registered under ${tx.memberName}.`, 'MEMBER_VEHICLE_MISMATCH');
    }
    if (vehicle.status !== 'Active') {
      throw new HttpError(409, `Car/V.REG "${vehicle.plate_number}" is not active.`, 'VEHICLE_NOT_ACTIVE');
    }
    tx.vehiclePlate = vehicle.plate_number;
    return;
  }

  const [members, vehicles] = await Promise.all([getAllMembers(), getAllVehicles()]);
  const member = tx.memberId
    ? members.find(item => item.id === tx.memberId)
    : members.find(item => item.name.trim().toLowerCase() === typedName.toLowerCase());
  if (!member) {
    throw new HttpError(400, `Name "${typedName || tx.memberId}" is not registered. Register the member first.`, 'MEMBER_NAME_NOT_REGISTERED');
  }
  if (member.status !== 'Active') {
    throw new HttpError(409, `Member "${member.name}" is not active.`, 'MEMBER_NOT_ACTIVE');
  }
  tx.memberId = member.id;
  tx.memberName = member.name;

  if (!tx.vehiclePlate?.trim()) return;
  const normalizedPlate = tx.vehiclePlate.replace(/\s+/g, '').toUpperCase();
  const vehicle = vehicles.find(item => item.plateNumber.replace(/\s+/g, '').toUpperCase() === normalizedPlate);
  if (!vehicle) {
    throw new HttpError(400, `Car/V.REG "${tx.vehiclePlate}" is not registered. Onboard the vehicle first.`, 'VEHICLE_NOT_REGISTERED');
  }
  if (vehicle.ownerId !== member.id) {
    throw new HttpError(400, `Car/V.REG "${vehicle.plateNumber}" is not registered under ${member.name}.`, 'MEMBER_VEHICLE_MISMATCH');
  }
  if (vehicle.status !== 'Active') {
    throw new HttpError(409, `Car/V.REG "${vehicle.plateNumber}" is not active.`, 'VEHICLE_NOT_ACTIVE');
  }
  tx.vehiclePlate = vehicle.plateNumber;
}

async function reconcilePaymentRecord(paymentId: string, memberId: string, recorderName: string): Promise<PaymentRecord> {
  const payments = await listPaymentRecords();
  const payment = payments.find(item => item.id === paymentId);
  if (!payment) {
    throw new HttpError(404, 'Payment record was not found.', 'PAYMENT_NOT_FOUND');
  }
  if (payment.status === 'Reconciled') {
    throw new HttpError(409, 'Payment has already been reconciled.', 'PAYMENT_ALREADY_RECONCILED');
  }

  const [members, vehicles] = await Promise.all([getAllMembers(), getAllVehicles()]);
  const member = members.find(item => item.id === memberId);
  if (!member) {
    throw new HttpError(404, 'Selected member was not found.', 'MEMBER_NOT_FOUND');
  }
  const normalizedPaymentPlate = String(payment.vehiclePlate || '').replace(/\s+/g, '').toUpperCase();
  const memberVehicle = normalizedPaymentPlate
    ? vehicles.find(vehicle =>
        vehicle.ownerId === member.id &&
        vehicle.status === 'Active' &&
        vehicle.plateNumber.replace(/\s+/g, '').toUpperCase() === normalizedPaymentPlate
      )
    : undefined;
  if (member.status !== 'Active') {
    throw new HttpError(400, 'Select an active registered member.', 'REGISTERED_MEMBER_REQUIRED');
  }

  const transactionInput = normalizeTransactionInput({
    id: `t-coop-bank-${Date.now()}`,
    timestamp: new Date().toISOString(),
    memberId: member.id,
    memberName: member.name,
    vehiclePlate: memberVehicle?.plateNumber || '',
    description: `${COOP_BANK_NAME} historical deposit of KES ${payment.amount.toLocaleString()} assigned to ${member.name}. Original reference: ${payment.accountReference || 'N/A'}.`,
    refCode: payment.refCode,
    type: 'Credit',
    category: payment.category,
    amount: payment.amount,
    recorderName,
    tillNumber: payment.tillNumber,
    ...(payment.category === 'Savings Contribution' ? { savingsContribution: payment.amount } : {})
  });
  await validateLedgerRegistration(transactionInput);

  const reconciledPayment: PaymentRecord = {
    ...payment,
    status: 'Reconciled',
    memberId: member.id,
    memberName: member.name,
    vehiclePlate: memberVehicle?.plateNumber || '',
    matchMethod: 'Manual Assignment',
    note: `Manually reconciled by ${recorderName}.`
  };

  if (postgresPool) {
    return reconcilePostgresPayment(postgresPool, reconciledPayment, transactionInput);
  }

  const transaction = await createLedgerTransaction(transactionInput);
  return savePaymentRecord({ ...reconciledPayment, transactionId: transaction.id });
}

// Sacco Security OS Authentication Middleware
const authenticateSaccoUser = async (req: express.Request, res: express.Response, next: express.NextFunction) => {
  try {
    const authHeader = req.headers.authorization || '';
    if (authHeader.startsWith('Bearer ')) {
      const token = authHeader.slice('Bearer '.length).trim();
      (req as any).user = await verifyJwt(token);
      requireActiveAccount((req as any).user);
      if (isMemberUser((req as any).user)) requireLinkedMember((req as any).user);
      if ((req as any).user.mustChangePassword && req.path !== '/api/auth/change-temporary-password') {
        throw new HttpError(403, 'Change the temporary password before using the SACCO application.', 'PASSWORD_CHANGE_REQUIRED');
      }
      (req as any).authContext = { provider: 'password-jwt', userId: (req as any).user.id };
      await recordAuditLog(req, 'API_AUTHORIZED', req.path);
      return next();
    }

    return res.status(401).json({ error: 'A current SACCO session is required.', code: 'AUTHENTICATION_REQUIRED' });
  } catch (error: any) {
    if (error instanceof HttpError) {
      return res.status(error.status).json({ error: error.message, code: error.code });
    }
    return res.status(401).json({ error: 'Invalid authentication token.' });
  }
};

function requireAuthenticatedUser(req: express.Request): AuthorizedUser {
  const user = (req as any).user as AuthorizedUser | undefined;
  if (!user) {
    throw new HttpError(401, 'Authentication is required.', 'AUTHENTICATION_REQUIRED');
  }
  return user;
}

function requireActiveAccount(user: AuthorizedUser): AuthorizedUser {
  if (!hasActiveAccount(user)) {
    throw new HttpError(403, 'This account is not active.', 'ACCOUNT_INACTIVE');
  }
  return user;
}

function requireLinkedMember(user: AuthorizedUser): string {
  const linkedMemberId = memberScopeId(user);
  if (!linkedMemberId) {
    throw new HttpError(403, 'This member account is not linked to an approved SACCO member record.', 'MEMBER_LINK_REQUIRED');
  }
  return linkedMemberId;
}

function assertMemberOwnsRecord(user: AuthorizedUser, memberId: string | null | undefined): void {
  if (isMemberUser(user) && !memberOwnsId(user, memberId)) {
    throw new HttpError(404, 'Requested record was not found.', 'RECORD_NOT_FOUND');
  }
}

async function assertMemberOwnsVehicle(user: AuthorizedUser, vehicleId: string): Promise<void> {
  if (!isMemberUser(user)) return;
  const linkedMemberId = requireLinkedMember(user);
  if (postgresPool) {
    const vehicle = await postgresPool.query('SELECT member_id FROM vehicles WHERE id = $1 LIMIT 1', [vehicleId]);
    if (!vehicle.rowCount || !memberOwnsId(user, vehicle.rows[0].member_id ? String(vehicle.rows[0].member_id) : null)) {
      throw new HttpError(404, 'Requested vehicle was not found.', 'VEHICLE_NOT_FOUND');
    }
    return;
  }
  const vehicle = (await getAllVehicles()).find(item => item.id === vehicleId);
  if (!vehicle || vehicle.ownerId !== linkedMemberId) {
    throw new HttpError(404, 'Requested vehicle was not found.', 'VEHICLE_NOT_FOUND');
  }
}

const requirePermission = (permission: SaccoPermission) => {
  return async (req: express.Request, res: express.Response, next: express.NextFunction) => {
    const user = (req as any).user as AuthorizedUser | undefined;
    if (!user || !hasPermission(user.role, permission)) {
      await recordAuditLog(req, 'API_AUTHORIZATION_DENIED', req.path, undefined, undefined, {
        requiredPermission: permission,
        actualRole: user?.role || 'Unknown'
      });
      return res.status(403).json({ 
        error: 'Access denied.'
      });
    }
    next();
  };
};

function getActivationOtpPepper(): string {
  const pepper = String(process.env.MEMBER_OTP_PEPPER || '');
  if (pepper.length < 32) {
    throw new HttpError(503, 'Member account activation is not configured.', 'MEMBER_ACTIVATION_UNAVAILABLE');
  }
  return pepper;
}

function hashActivationOtp(challengeId: string, otp: string): string {
  return crypto
    .createHmac('sha256', getActivationOtpPepper())
    .update(`${challengeId}:${otp}`)
    .digest('hex');
}

function isPublicHttpsUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && Boolean(url.hostname) && url.hostname !== 'localhost' && !url.hostname.endsWith('.localhost');
  } catch {
    return false;
  }
}

async function deliverMemberOtp(phone: string, otp: string, purpose: 'Activation' | 'PasswordReset'): Promise<void> {
  const deliveryUrl = String(process.env.MEMBER_OTP_DELIVERY_WEBHOOK_URL || '').trim();
  if (!isPublicHttpsUrl(deliveryUrl)) {
    throw new HttpError(503, 'Member account activation is not configured.', 'MEMBER_ACTIVATION_UNAVAILABLE');
  }
  const authorization = String(process.env.MEMBER_OTP_DELIVERY_AUTHORIZATION || '').trim();
  const response = await fetch(deliveryUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(authorization ? { Authorization: authorization } : {})
    },
    body: JSON.stringify({
      to: phone,
      code: otp,
      expiresInSeconds: 600,
      purpose: purpose === 'Activation' ? 'member-account-activation' : 'member-password-reset'
    }),
    signal: AbortSignal.timeout(10_000)
  });
  if (!response.ok) {
    throw new HttpError(503, 'Member account activation is temporarily unavailable.', 'MEMBER_OTP_DELIVERY_FAILED');
  }
}

function genericMemberOtpResponse(requestId = crypto.randomUUID()) {
  return {
    requestId,
    message: 'If the submitted details match an eligible SACCO member, a verification code has been sent to the registered phone number.'
  };
}

function genericEmailRecoveryResponse(requestId = crypto.randomUUID()) {
  return {
    requestId,
    message: 'If the email matches an eligible SACCO member account, a recovery code has been sent.'
  };
}

async function requestMemberActivation(identifierValue: unknown, requestIp?: string): Promise<{ requestId: string; message: string }> {
  const requestId = crypto.randomUUID();
  if (!postgresPool) return genericMemberOtpResponse(requestId);

  const phone = normalizedPhone(identifierValue);
  if (!phone) return genericMemberOtpResponse(requestId);

  try {
    getActivationOtpPepper();
    const candidate = await postgresPool.query(
      `SELECT m.id, m.phone
       FROM members m
       LEFT JOIN users u ON u.linked_member_id = m.id
       WHERE m.status = 'Active'
         AND u.id IS NULL
         AND (
           regexp_replace(COALESCE(m.phone, ''), '\\D', '', 'g') = $1
         )
       LIMIT 1`,
      [phone]
    );
    if (!candidate.rowCount || !candidate.rows[0].phone) return genericMemberOtpResponse(requestId);

    const memberId = String(candidate.rows[0].id);
    const rateLimit = await postgresPool.query(
      `SELECT COUNT(*)::int AS count
       FROM member_activation_challenges
       WHERE created_at > now() - interval '15 minutes'
         AND purpose = 'Activation'
         AND (member_id = $1 OR ($2 <> '' AND requested_ip = $2))`,
      [memberId, requestIp || '']
    );
    if (Number(rateLimit.rows[0]?.count || 0) >= 3) return genericMemberOtpResponse(requestId);

    const otp = String(crypto.randomInt(100000, 1_000_000));
    await postgresPool.query(
      `INSERT INTO member_activation_challenges (id, member_id, otp_hash, expires_at, requested_ip, purpose)
       VALUES ($1, $2, $3, now() + interval '10 minutes', NULLIF($4, ''), 'Activation')`,
      [requestId, memberId, hashActivationOtp(requestId, otp), requestIp || '']
    );

    try {
      await deliverMemberOtp(String(candidate.rows[0].phone), otp, 'Activation');
    } catch {
      // Do not leave a code that was never delivered usable. No code, phone,
      // or provider response is logged.
      await postgresPool.query('DELETE FROM member_activation_challenges WHERE id = $1', [requestId]);
      return genericMemberOtpResponse(requestId);
    }
  } catch {
    // The response intentionally stays identical for unknown, ineligible, and
    // temporarily unavailable records to prevent account enumeration.
  }
  return genericMemberOtpResponse(requestId);
}

async function verifyMemberActivation(req: express.Request, requestIdValue: unknown, otpValue: unknown, passwordValue: unknown): Promise<AuthorizedUser> {
  if (!postgresPool) {
    throw new HttpError(503, 'Member account activation requires the PostgreSQL SACCO database.', 'MEMBER_ACTIVATION_UNAVAILABLE');
  }
  const requestId = String(requestIdValue || '').trim();
  const otp = String(otpValue || '').trim();
  const password = String(passwordValue || '');
  if (!requestId.match(/^[0-9a-f-]{36}$/i) || !otp.match(/^\d{6}$/) || password.length < 8) {
    throw new HttpError(400, 'The verification code is invalid or has expired.', 'ACTIVATION_CODE_INVALID');
  }

  const client = await postgresPool.connect();
  let committed = false;
  try {
    await client.query('BEGIN');
    const challengeResult = await client.query(
      `SELECT c.*, m.full_name, m.phone
       FROM member_activation_challenges c
       JOIN members m ON m.id = c.member_id
       WHERE c.id = $1 AND c.purpose = 'Activation'
       FOR UPDATE`,
      [requestId]
    );
    const challenge = challengeResult.rows[0];
    if (!challenge || challenge.used_at || new Date(challenge.expires_at).getTime() <= Date.now() || challenge.attempt_count >= challenge.max_attempts) {
      throw new HttpError(400, 'The verification code is invalid or has expired.', 'ACTIVATION_CODE_INVALID');
    }

    const expected = Buffer.from(String(challenge.otp_hash), 'hex');
    const supplied = Buffer.from(hashActivationOtp(requestId, otp), 'hex');
    if (expected.length !== supplied.length || !crypto.timingSafeEqual(expected, supplied)) {
      await client.query(
        `UPDATE member_activation_challenges
         SET attempt_count = attempt_count + 1
         WHERE id = $1`,
        [requestId]
      );
      await client.query('COMMIT');
      committed = true;
      throw new HttpError(400, 'The verification code is invalid or has expired.', 'ACTIVATION_CODE_INVALID');
    }

    const conflicts = await client.query(
      `SELECT id FROM users
       WHERE linked_member_id = $1
       LIMIT 1`,
      [challenge.member_id]
    );
    if (conflicts.rowCount) {
      // A correctly proven code is still one-time when a conflicting record
      // requires an administrator to complete the link manually.
      await client.query('UPDATE member_activation_challenges SET used_at = now() WHERE id = $1', [requestId]);
      await client.query('COMMIT');
      committed = true;
      throw new HttpError(409, 'This account cannot be linked automatically. Ask a SACCO administrator to review the record.', 'MEMBER_LINK_CONFLICT');
    }
    const userResult = await client.query(
      `INSERT INTO users (
         full_name, email, phone, role, password_hash, is_active,
         linked_member_id, account_status, approved_at
       ) VALUES ($1, NULL, $2, 'Member', crypt($3, gen_salt('bf')), TRUE, $4, 'Active', now())
       RETURNING id, full_name, email, phone, role, is_active, account_status, linked_member_id`,
      [challenge.full_name, challenge.phone || null, password, challenge.member_id]
    );
    await client.query('UPDATE member_activation_challenges SET used_at = now() WHERE id = $1', [requestId]);
    await client.query('COMMIT');
    committed = true;
    const user = mapDbUser(userResult.rows[0]);
    (req as any).user = user;
    (req as any).authContext = { provider: 'member-sms-activation', phone: user.phone };
    await recordAuditLog(req, 'MEMBER_ACCOUNT_ACTIVATED', 'users', user.id, undefined, { linkedMemberId: user.linkedMemberId, role: user.role });
    return user;
  } catch (error) {
    if (!committed) await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

async function requestMemberPasswordReset(emailValue: unknown, requestIp?: string): Promise<{ requestId: string; message: string }> {
  const requestId = crypto.randomUUID();
  if (!postgresPool) return genericEmailRecoveryResponse(requestId);
  const email = normalizedEmail(emailValue);
  if (!/^\S+@\S+\.\S+$/.test(email)) return genericEmailRecoveryResponse(requestId);
  try {
    getActivationOtpPepper();
    const candidate = await postgresPool.query(
      `SELECT u.linked_member_id AS member_id, COALESCE(NULLIF(u.email, ''), m.email) AS email
       FROM users u
       JOIN members m ON m.id = u.linked_member_id
       WHERE u.role = 'Member' AND u.is_active = TRUE AND u.account_status = 'Active'
         AND lower(COALESCE(NULLIF(u.email, ''), m.email, '')) = $1
       LIMIT 1`,
      [email]
    );
    if (!candidate.rowCount || !candidate.rows[0].email) return genericEmailRecoveryResponse(requestId);
    const memberId = String(candidate.rows[0].member_id);
    const rateLimit = await postgresPool.query(
      `SELECT COUNT(*)::int AS count
       FROM member_activation_challenges
       WHERE created_at > now() - interval '15 minutes'
         AND purpose = 'PasswordReset'
         AND (member_id = $1 OR ($2 <> '' AND requested_ip = $2))`,
      [memberId, requestIp || '']
    );
    if (Number(rateLimit.rows[0]?.count || 0) >= 3) return genericEmailRecoveryResponse(requestId);
    const otp = String(crypto.randomInt(100000, 1_000_000));
    await postgresPool.query(
      `INSERT INTO member_activation_challenges (id, member_id, otp_hash, expires_at, requested_ip, purpose, delivery_address)
       VALUES ($1, $2, $3, now() + interval '10 minutes', NULLIF($4, ''), 'PasswordReset', $5)`,
      [requestId, memberId, hashActivationOtp(requestId, otp), requestIp || '', email]
    );
    try {
      await sendRecoveryCode(String(candidate.rows[0].email), otp);
    } catch {
      await postgresPool.query('DELETE FROM member_activation_challenges WHERE id = $1', [requestId]);
    }
  } catch {
    // Keep the response generic for all failure and eligibility states.
  }
  return genericEmailRecoveryResponse(requestId);
}

async function verifyMemberPasswordReset(requestIdValue: unknown, otpValue: unknown, passwordValue: unknown): Promise<void> {
  if (!postgresPool) throw new HttpError(503, 'Member password reset requires the PostgreSQL SACCO database.', 'MEMBER_PASSWORD_RESET_UNAVAILABLE');
  const requestId = String(requestIdValue || '').trim();
  const otp = String(otpValue || '').trim();
  const password = String(passwordValue || '');
  if (!requestId.match(/^[0-9a-f-]{36}$/i) || !otp.match(/^\d{6}$/) || password.length < 8) {
    throw new HttpError(400, 'The verification code is invalid or has expired.', 'PASSWORD_RESET_CODE_INVALID');
  }
  const client = await postgresPool.connect();
  let committed = false;
  try {
    await client.query('BEGIN');
    const result = await client.query(
      `SELECT * FROM member_activation_challenges
       WHERE id = $1 AND purpose = 'PasswordReset'
       FOR UPDATE`,
      [requestId]
    );
    const challenge = result.rows[0];
    if (!challenge || challenge.used_at || new Date(challenge.expires_at).getTime() <= Date.now() || challenge.attempt_count >= challenge.max_attempts) {
      throw new HttpError(400, 'The verification code is invalid or has expired.', 'PASSWORD_RESET_CODE_INVALID');
    }
    const expected = Buffer.from(String(challenge.otp_hash), 'hex');
    const supplied = Buffer.from(hashActivationOtp(requestId, otp), 'hex');
    if (expected.length !== supplied.length || !crypto.timingSafeEqual(expected, supplied)) {
      await client.query('UPDATE member_activation_challenges SET attempt_count = attempt_count + 1 WHERE id = $1', [requestId]);
      await client.query('COMMIT');
      committed = true;
      throw new HttpError(400, 'The verification code is invalid or has expired.', 'PASSWORD_RESET_CODE_INVALID');
    }
    const updated = await client.query(
      `UPDATE users
       SET password_hash = crypt($1, gen_salt('bf')), must_change_password = FALSE,
           temporary_password_expires_at = NULL, updated_at = now()
       WHERE linked_member_id = $2 AND role = 'Member' AND is_active = TRUE AND account_status = 'Active'`,
      [password, challenge.member_id]
    );
    if (!updated.rowCount) throw new HttpError(400, 'The verification code is invalid or has expired.', 'PASSWORD_RESET_CODE_INVALID');
    await client.query('UPDATE member_activation_challenges SET used_at = now() WHERE id = $1', [requestId]);
    await client.query('COMMIT');
    committed = true;
  } catch (error) {
    if (!committed) await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

// Verify the selected persistence adapter before accepting requests.
async function seedDatabaseIfEmpty() {
  if (postgresPool) {
    await postgresPool.query('SELECT 1');
    console.log('PostgreSQL connection check complete.');
    return;
  }

  if (isProduction) {
    throw new Error('DATABASE_URL is required in production.');
  }

  if (allowInMemoryStore) {
    console.warn('No persistent database configured. ALLOW_IN_MEMORY_DB is enabled; all development data will be lost when the server stops.');
  } else {
    console.warn('No persistent database configured. Functional API requests will fail closed.');
  }
}

type SaccoAppOptions = {
  serveFrontend?: boolean;
  runBackgroundProcessor?: boolean;
};

export async function createSaccoApp(options: SaccoAppOptions = {}) {
  const app = express();
  configureProxyTrust(app, process.env.TRUST_PROXY);

  app.disable('x-powered-by');
  app.use(securityHeaders(isProduction));
  app.use(express.json({ limit: '64kb' }));

  // Run database seeding
  await seedDatabaseIfEmpty();
  const coopStartupConfig = loadCoopIpnConfig();
  assertCoopIpnConfiguration(coopStartupConfig);
  if (isProduction && coopStartupConfig.enabled) {
    const publicUrl = String(process.env.APP_URL || '').trim();
    if (!publicUrl.startsWith('https://')) throw new Error('APP_URL must be HTTPS when Co-op Bank IPN is enabled in production.');
  }
  await resumePendingCoopBankEvents();
  if (options.runBackgroundProcessor !== false && process.env.BACKGROUND_PROCESSOR_ENABLED === 'true') {
    startBackgroundProcessor(resumePendingCoopBankEvents);
  }

  registerSystemRoutes(app, {
    databaseStatus: () => postgresPool ? 'postgres_configured' : 'local_fallback',
    authStatus: () => process.env.OFFICER_TOTP_REQUIRED === 'true' ? 'password_with_optional_officer_totp' : 'password',
    countAdmins: countSaccoAdmins,
    onError: (error, response) => sendApiError(response, error)
  });

  app.post('/api/auth/session', async (req, res) => {
    try {
      throw new HttpError(410, 'Use /api/auth/login to create a SACCO session.', 'LEGACY_AUTH_DISABLED');
    } catch (error: any) {
      sendApiError(res, error);
    }
  });

  app.post('/api/auth/member-registration', async (req, res) => {
    try {
      const user = await registerPasswordMemberAccount({
        fullName: req.body?.fullName,
        phone: req.body?.phone,
        email: req.body?.email,
        password: req.body?.password
      });
      await recordAuditLog(req, 'MEMBER_PASSWORD_ACCOUNT_CREATED', 'users', user.id, undefined, { linkedMemberId: user.linkedMemberId });
      res.status(201).json({ accountCreated: true });
    } catch (error: any) {
      sendApiError(res, error);
    }
  });

  app.post('/api/auth/bootstrap', async (req, res) => {
    try {
      const existingAdmins = await countSaccoAdmins();
      if (existingAdmins > 0) {
        return res.status(409).json({ error: 'SACCO onboarding is already complete. Ask an existing admin to create your profile.' });
      }

      if (!passwordAuthenticationEnabled()) throw new HttpError(503, 'Password authentication is not enabled.', 'PASSWORD_AUTH_DISABLED');

      const user = await createFirstAdminProfile({
        email: String(req.body?.email || '').trim().toLowerCase(),
        fullName: String(req.body?.fullName || '').trim(),
        phone: String(req.body?.phone || '').trim(),
        password: String(req.body?.password || '')
      });
      (req as any).user = user;
      (req as any).authContext = {
        provider: 'password-bootstrap',
        email: user.email
      };
      await recordAuditLog(req, 'FIRST_ADMIN_BOOTSTRAPPED', 'users', user.id, undefined, { email: user.email, role: user.role });
      return res.status(201).json(await completePasswordAuthentication(user));
    } catch (error: any) {
      sendApiError(res, error);
    }
  });

  app.post('/api/auth/login', async (req, res) => {
    try {
      if (!passwordAuthenticationEnabled()) throw new HttpError(503, 'Password authentication is not enabled.', 'PASSWORD_AUTH_DISABLED');
      const user = await authenticatePasswordUser(req.body?.identifier ?? req.body?.email, String(req.body?.password || ''));
      if (!user || !hasActiveAccount(user) || (isMemberUser(user) && !user.linkedMemberId)) {
        return res.status(401).json({ error: 'Invalid Sacco profile or password.' });
      }
      res.json(await completePasswordAuthentication(user));
    } catch (error: any) {
      sendApiError(res, error);
    }
  });

  app.post('/api/auth/totp/verify', async (req, res) => {
    try {
      const user = await verifyOfficerTotpChallenge(req.body?.challengeId, req.body?.code);
      (req as any).user = user;
      (req as any).authContext = { provider: 'password-totp', userId: user.id };
      await recordAuditLog(req, 'USER_LOGIN_TOTP', 'users', user.id, undefined, { role: user.role });
      const signed = signJwt(user);
      res.json({ user: publicUser(user), token: signed.token, expiresAt: signed.expiresAt, tokenType: 'Bearer', authProvider: 'password-totp' });
    } catch (error: any) {
      sendApiError(res, error);
    }
  });

  app.post('/api/member-activation/request', async (req, res) => {
    try {
      res.json(await requestMemberActivation(req.body?.phone ?? req.body?.identifier, req.ip));
    } catch (error: any) {
      sendApiError(res, error);
    }
  });

  app.post('/api/member-activation/verify', async (req, res) => {
    try {
      const user = await verifyMemberActivation(req, req.body?.requestId, req.body?.code, req.body?.password);
      res.status(201).json({ user: publicUser(user), ...signJwt(user), tokenType: 'Bearer', authProvider: 'member-activation' });
    } catch (error: any) {
      sendApiError(res, error);
    }
  });

  app.post('/api/auth/member-password-reset/request', async (req, res) => {
    try {
      res.json(await requestMemberPasswordReset(req.body?.email ?? req.body?.identifier, req.ip));
    } catch (error: any) {
      sendApiError(res, error);
    }
  });

  app.post('/api/auth/member-password-reset/verify', async (req, res) => {
    try {
      await verifyMemberPasswordReset(req.body?.requestId, req.body?.code, req.body?.password);
      res.json({ passwordUpdated: true });
    } catch (error: any) {
      sendApiError(res, error);
    }
  });

  app.post('/api/auth/change-temporary-password', authenticateSaccoUser, async (req, res) => {
    try {
      const user = requireAuthenticatedUser(req);
      const password = String(req.body?.password || '');
      if (!user.mustChangePassword) throw new HttpError(409, 'This account does not require a password change.', 'PASSWORD_CHANGE_NOT_REQUIRED');
      if (password.length < 8) throw new HttpError(400, 'Choose a new password of at least 8 characters.', 'PASSWORD_INVALID');
      if (!postgresPool) throw new HttpError(503, 'Password changes require PostgreSQL.', 'PASSWORD_CHANGE_UNAVAILABLE');
      await postgresPool.query(
        `UPDATE users SET password_hash = crypt($1, gen_salt('bf')), must_change_password = FALSE,
           temporary_password_expires_at = NULL, updated_at = now() WHERE id = $2`,
        [password, user.id]
      );
      await recordAuditLog(req, 'TEMPORARY_PASSWORD_CHANGED', 'users', user.id);
      const updated = { ...user, mustChangePassword: false, temporaryPasswordExpiresAt: undefined };
      res.json({ user: publicUser(updated), ...signJwt(updated), passwordUpdated: true });
    } catch (error: any) {
      sendApiError(res, error);
    }
  });

  app.post('/api/auth/activity', authenticateSaccoUser, (_req, res) => {
    res.status(204).end();
  });

  // Test-only fixture endpoint. It is not registered unless the integration
  // test process explicitly opts in, and is unavailable in every normal or
  // production runtime. It lets the HTTP authorization tests exercise the
  // same linked-member checks used by real activated accounts.
  if (!isProduction && process.env.SACCO_TEST_MODE === 'true') {
    app.post('/api/testing/member-profile', authenticateSaccoUser, requirePermission('members.write'), async (req, res) => {
      try {
        if (postgresPool || !allowInMemoryStore) {
          throw new HttpError(404, 'Not found.', 'NOT_FOUND');
        }
        const memberId = String(req.body?.memberId || '');
        const email = String(req.body?.email || '').trim().toLowerCase();
        const password = String(req.body?.password || '');
        const member = localStore.members.find(item => item.id === memberId);
        if (!member || !email || password.length < 8 || localStore.users.some(user => user.email === email || user.linkedMemberId === memberId)) {
          throw new HttpError(400, 'Invalid test member profile request.', 'INVALID_TEST_FIXTURE');
        }
        const user: AuthorizedUser = {
          id: `test-member-${localStore.users.length + 1}`,
          name: member.name,
          email,
          phone: member.phoneNumber,
          role: 'Member',
          isActive: true,
          accountStatus: 'Active',
          linkedMemberId: member.id,
          devPassword: password
        };
        localStore.users.push(user);
        res.status(201).json({ id: user.id });
      } catch (error: any) {
        sendApiError(res, error);
      }
    });
  }

  // Protect all functional API endpoints with Sacco Zero-Trust validation
  app.use('/api/users', authenticateSaccoUser);
  app.use('/api/members', authenticateSaccoUser);
  app.use('/api/vehicles', authenticateSaccoUser);
  app.use('/api/transactions', authenticateSaccoUser);
  app.use('/api/payments', authenticateSaccoUser);
  app.use('/api/system', authenticateSaccoUser);
  app.use('/api/member-portal', authenticateSaccoUser);
  app.use('/api/loans', authenticateSaccoUser);

  // API 2: Get Users
  app.get('/api/users', requirePermission('users.read'), async (req, res) => {
    try {
      if (postgresPool) {
        return res.json(await listPostgresUsers(postgresPool));
      }
      const list = localStore.users;
      res.json(list);
    } catch (error: any) {
      sendApiError(res, error);
    }
  });

  // Officer credentials are provisioned by the Chairman. Members continue to
  // use the public member-gated registration endpoint linked to members.id.
  app.post('/api/users', requirePermission('users.write'), async (req, res) => {
    try {
      const fullName = sanitizePersonName(req.body?.fullName).trim();
      const email = String(req.body?.email || '').trim().toLowerCase();
      const phone = sanitizePhoneNumber(req.body?.phone).trim();
      const password = String(req.body?.password || '');
      const role = String(req.body?.role || '') as UserRole;
      const officerRoles: readonly UserRole[] = ['Secretary', 'Treasurer', 'Auditor', 'Accountant'];
      if (!isValidPersonName(fullName) || !email.includes('@') || (phone && !isValidPhoneNumber(phone)) || password.length < 8 || !officerRoles.includes(role)) {
        throw new HttpError(400, 'Provide an officer name, email, optional valid phone, approved officer role, and password of at least 8 characters.', 'OFFICER_PROVISIONING_INVALID');
      }

      let created: AuthorizedUser;
      if (postgresPool) {
        const existing = await postgresPool.query('SELECT 1 FROM users WHERE lower(email) = $1 LIMIT 1', [email]);
        if (existing.rowCount) throw new HttpError(409, 'An account already uses this email.', 'OFFICER_EMAIL_EXISTS');
        const result = await postgresPool.query(
          `INSERT INTO users (full_name, email, phone, role, password_hash, is_active, account_status, approved_at, approved_by)
           VALUES ($1, $2, NULLIF($3, ''), $4, crypt($5, gen_salt('bf')), TRUE, 'Active', now(), $6)
           RETURNING id, full_name, email, phone, role, is_active, account_status, linked_member_id`,
          [fullName, email, phone, role, password, requireAuthenticatedUser(req).id]
        );
        created = mapDbUser(result.rows[0]);
      } else {
        if (localStore.users.some(user => user.email?.toLowerCase() === email)) {
          throw new HttpError(409, 'An account already uses this email.', 'OFFICER_EMAIL_EXISTS');
        }
        created = {
          id: `officer-${crypto.randomUUID()}`,
          name: fullName,
          email,
          phone,
          role,
          isActive: true,
          accountStatus: 'Active',
          devPassword: password
        };
        localStore.users.push(created);
      }
      await recordAuditLog(req, 'OFFICER_ACCOUNT_PROVISIONED', 'users', created.id, undefined, { role: created.role, email: created.email });
      res.status(201).json({ user: publicUser(created), requiresTotpEnrollment: requiresTotp(created) });
    } catch (error: any) {
      sendApiError(res, error);
    }
  });

  app.post('/api/users/:id/password', requirePermission('users.write'), async (req, res) => {
    try {
      const password = String(req.body?.password || '');
      if (password.length < 8) throw new HttpError(400, 'Choose a temporary password of at least 8 characters.', 'PASSWORD_INVALID');
      let updated: AuthorizedUser | undefined;
      if (postgresPool) {
        if (!req.params.id.match(/^[0-9a-f-]{36}$/i)) throw new HttpError(404, 'Account was not found.', 'USER_NOT_FOUND');
        const result = await postgresPool.query(
          `UPDATE users SET password_hash = crypt($1, gen_salt('bf')),
             totp_secret_ciphertext = CASE WHEN $2 THEN NULL ELSE totp_secret_ciphertext END,
             totp_enabled_at = CASE WHEN $2 THEN NULL ELSE totp_enabled_at END,
             must_change_password = TRUE,
             temporary_password_expires_at = now() + interval '24 hours',
             updated_at = now()
           WHERE id = $3 AND is_active = TRUE
           RETURNING id, full_name, email, phone, role, is_active, account_status, linked_member_id`,
          [password, process.env.OFFICER_TOTP_REQUIRED !== 'true', req.params.id]
        );
        if (!result.rowCount) throw new HttpError(404, 'Account was not found.', 'USER_NOT_FOUND');
        updated = mapDbUser(result.rows[0]);
      } else {
        const user = localStore.users.find(item => item.id === req.params.id);
        if (!user) throw new HttpError(404, 'Account was not found.', 'USER_NOT_FOUND');
        user.devPassword = password;
        updated = user;
      }
      await recordAuditLog(req, 'ACCOUNT_PASSWORD_RESET_BY_CHAIRMAN', 'users', updated.id, undefined, { role: updated.role });
      res.json({ passwordUpdated: true });
    } catch (error: any) {
      sendApiError(res, error);
    }
  });

  app.get('/api/loans/member/:memberId', async (req, res) => {
    try {
      const user = requireAuthenticatedUser(req);
      const memberId = isMemberUser(user) ? requireLinkedMember(user) : req.params.memberId;
      if (!isMemberUser(user) && !hasPermission(user.role, 'loans.read.all')) throw new HttpError(403, 'Access denied.', 'ACCESS_DENIED');
      if (!postgresPool) throw new HttpError(503, 'Loan records require PostgreSQL.', 'LOANS_UNAVAILABLE');
      res.json(await listPostgresLoansByMember(postgresPool, memberId));
    } catch (error: any) { sendApiError(res, error); }
  });

  app.get('/api/loans', requirePermission('loans.read.all'), async (req, res) => {
    try {
      if (!postgresPool) throw new HttpError(503, 'Loan records require PostgreSQL.', 'LOANS_UNAVAILABLE');
      const result = await postgresPool.query(
        `SELECT l.*, m.full_name AS member_name, m.status AS member_status,
           COALESCE(fin.savings, 0) AS member_savings,
           CURRENT_DATE - COALESCE(m.date_registered, CURRENT_DATE) AS membership_days
         FROM loans l JOIN members m ON m.id = l.member_id
         LEFT JOIN LATERAL (
           SELECT SUM(CASE WHEN le.account_type IN ('Savings','DailyContribution') AND le.transaction_type = 'Credit' THEN
             CASE WHEN le.account_type = 'Savings' THEN le.amount ELSE COALESCE((le.metadata->>'savingsContribution')::numeric, le.amount * .70) END ELSE 0 END) AS savings
           FROM ledger_entries le WHERE le.member_id = m.id AND le.status = 'Posted'
         ) fin ON TRUE ORDER BY l.created_at DESC`
      );
      res.json(result.rows);
    } catch (error: any) { sendApiError(res, error); }
  });

  app.get('/api/loans-policy', authenticateSaccoUser, async (req, res) => {
    try {
      const user = requireAuthenticatedUser(req);
      if (!hasPermission(user.role, 'loans.read.all') && !isMemberUser(user)) throw new HttpError(403, 'Access denied.', 'ACCESS_DENIED');
      if (!postgresPool) throw new HttpError(503, 'Loan policy requires PostgreSQL.', 'LOANS_UNAVAILABLE');
      const result = await postgresPool.query('SELECT * FROM loan_policy WHERE id = TRUE');
      res.json(result.rows[0]);
    } catch (error: any) { sendApiError(res, error); }
  });

  app.put('/api/loans-policy', authenticateSaccoUser, requirePermission('loans.approve'), async (req, res) => {
    try {
      if (!postgresPool) throw new HttpError(503, 'Loan policy requires PostgreSQL.', 'LOANS_UNAVAILABLE');
      const rate = Number(req.body?.defaultInterestRate);
      const maximum = req.body?.maximumPrincipal === '' || req.body?.maximumPrincipal == null ? null : Number(req.body.maximumPrincipal);
      const minimumSavings = Number(req.body?.minimumSavings || 0);
      const minimumDays = Number(req.body?.minimumMembershipDays || 0);
      if (!Number.isFinite(rate) || rate < 0 || rate > 100 || (maximum !== null && (!Number.isFinite(maximum) || maximum <= 0)) || minimumSavings < 0 || !Number.isInteger(minimumDays) || minimumDays < 0) {
        throw new HttpError(400, 'Enter valid loan policy values.', 'LOAN_POLICY_INVALID');
      }
      const result = await postgresPool.query(
        `UPDATE loan_policy SET default_interest_rate=$1, maximum_principal=$2, minimum_savings=$3,
          minimum_membership_days=$4, require_active_membership=$5, updated_by=$6, updated_at=now()
         WHERE id=TRUE RETURNING *`,
        [rate, maximum, minimumSavings, minimumDays, req.body?.requireActiveMembership !== false, requireAuthenticatedUser(req).id]
      );
      await recordAuditLog(req, 'LOAN_POLICY_UPDATED', 'loan_policy', undefined, undefined, result.rows[0]);
      res.json(result.rows[0]);
    } catch (error: any) { sendApiError(res, error); }
  });

  app.post('/api/loans', async (req, res) => {
    try {
      const user = requireAuthenticatedUser(req);
      const memberId = isMemberUser(user) ? requireLinkedMember(user) : String(req.body?.memberId || '');
      if (!isMemberUser(user) && !hasPermission(user.role, 'loans.write')) throw new HttpError(403, 'Access denied.', 'ACCESS_DENIED');
      const principal = Number(req.body?.principalAmount);
      const dueDate = String(req.body?.dueDate || '').trim() || null;
      const notes = String(req.body?.notes || '').trim().slice(0, 1000) || null;
      if (!memberId.match(/^[0-9a-f-]{36}$/i) || !Number.isFinite(principal) || principal <= 0) {
        throw new HttpError(400, 'Select a member and enter a valid principal.', 'LOAN_INPUT_INVALID');
      }
      if (!postgresPool) throw new HttpError(503, 'Loan records require PostgreSQL.', 'LOANS_UNAVAILABLE');
      const policy = await postgresPool.query('SELECT * FROM loan_policy WHERE id = TRUE');
      const interestRate = Number(policy.rows[0]?.default_interest_rate || 0);
      if (policy.rows[0]?.maximum_principal && principal > Number(policy.rows[0].maximum_principal)) throw new HttpError(400, 'The requested amount exceeds the Chairman’s loan limit.', 'LOAN_ABOVE_POLICY_LIMIT');
      const existing = await postgresPool.query(`SELECT 1 FROM loans WHERE member_id=$1 AND status IN ('Applied','SecretaryReview','TreasurerReview','ChairmanReview','Approved','Active','Defaulted') LIMIT 1`, [memberId]);
      if (existing.rowCount) throw new HttpError(409, 'This member already has a pending or active loan.', 'LOAN_ALREADY_OPEN');
      const result = await postgresPool.query(
        `INSERT INTO loans (member_id, principal_amount, interest_rate, application_date, issue_date, due_date, status, notes)
         SELECT id, $2, $3, CURRENT_DATE, CURRENT_DATE, $4, 'SecretaryReview', $5 FROM members WHERE id = $1 AND status = 'Active'
         RETURNING id, member_id, principal_amount, interest_rate, application_date, due_date, status, notes`,
        [memberId, principal, interestRate, dueDate, notes]
      );
      if (!result.rowCount) throw new HttpError(404, 'Active member was not found.', 'MEMBER_NOT_FOUND');
      await recordAuditLog(req, 'LOAN_APPLICATION_CREATED', 'loans', String(result.rows[0].id), undefined, result.rows[0]);
      res.status(201).json(result.rows[0]);
    } catch (error: any) { sendApiError(res, error); }
  });

  app.post('/api/loans/:id/secretary-review', async (req, res) => {
    try {
      const user = requireAuthenticatedUser(req);
      if (!canReviewLoanStage(user.role, 'SecretaryReview')) throw new HttpError(403, 'The Secretary must complete this review.', 'SECRETARY_REVIEW_REQUIRED');
      if (!postgresPool) throw new HttpError(503, 'Loan records require PostgreSQL.', 'LOANS_UNAVAILABLE');
      const eligible = req.body?.eligible === true;
      const notes = String(req.body?.notes || '').trim().slice(0, 1000);
      const status = eligible ? 'TreasurerReview' : 'Rejected';
      const result = await postgresPool.query(
        `UPDATE loans SET status=$1, secretary_reviewed_by=$2, secretary_reviewed_at=now(), secretary_eligible=$3,
          secretary_notes=$4, rejected_at=CASE WHEN $3 THEN rejected_at ELSE now() END, updated_at=now()
         WHERE id=$5 AND status='SecretaryReview' RETURNING *`, [status, user.id, eligible, notes, req.params.id]
      );
      if (!result.rowCount) throw new HttpError(409, 'This loan is not awaiting Secretary review.', 'LOAN_STAGE_MISMATCH');
      await recordAuditLog(req, eligible ? 'LOAN_SECRETARY_APPROVED' : 'LOAN_SECRETARY_REJECTED', 'loans', req.params.id, undefined, result.rows[0]);
      res.json(result.rows[0]);
    } catch (error: any) { sendApiError(res, error); }
  });

  app.post('/api/loans/:id/treasurer-review', async (req, res) => {
    try {
      const user = requireAuthenticatedUser(req);
      if (!canReviewLoanStage(user.role, 'TreasurerReview')) throw new HttpError(403, 'The Treasurer must complete this review.', 'TREASURER_REVIEW_REQUIRED');
      if (!postgresPool) throw new HttpError(503, 'Loan records require PostgreSQL.', 'LOANS_UNAVAILABLE');
      const approved = req.body?.approved === true;
      const notes = String(req.body?.notes || '').trim().slice(0, 1000);
      const result = await postgresPool.query(
        `UPDATE loans SET status=$1, treasurer_reviewed_by=$2, treasurer_reviewed_at=now(), treasurer_notes=$3,
          rejected_at=CASE WHEN $4 THEN rejected_at ELSE now() END, updated_at=now()
         WHERE id=$5 AND status='TreasurerReview' RETURNING *`,
        [approved ? 'ChairmanReview' : 'Rejected', user.id, notes, approved, req.params.id]
      );
      if (!result.rowCount) throw new HttpError(409, 'This loan is not awaiting Treasurer review.', 'LOAN_STAGE_MISMATCH');
      await recordAuditLog(req, approved ? 'LOAN_TREASURER_APPROVED' : 'LOAN_TREASURER_REJECTED', 'loans', req.params.id, undefined, result.rows[0]);
      res.json(result.rows[0]);
    } catch (error: any) { sendApiError(res, error); }
  });

  app.post('/api/loans/:id/approve', requirePermission('loans.approve'), async (req, res) => {
    try {
      if (!postgresPool) throw new HttpError(503, 'Loan records require PostgreSQL.', 'LOANS_UNAVAILABLE');
      const user = requireAuthenticatedUser(req);
      const result = await postgresPool.query(
        `UPDATE loans SET status = 'Active', approved_by = $1, approved_at = now(),
           disbursed_at = now(), issue_date = CURRENT_DATE, updated_at = now()
         WHERE id = $2 AND status = 'ChairmanReview'
         RETURNING id, member_id, principal_amount, interest_rate, issue_date, due_date, status`,
        [user.id, req.params.id]
      );
      if (!result.rowCount) throw new HttpError(409, 'Only an applied loan can be approved.', 'LOAN_NOT_APPROVABLE');
      await recordAuditLog(req, 'LOAN_APPROVED_AND_DISBURSED', 'loans', String(result.rows[0].id), undefined, result.rows[0]);
      res.json(result.rows[0]);
    } catch (error: any) { sendApiError(res, error); }
  });

  app.post('/api/loans/:id/reject', requirePermission('loans.approve'), async (req, res) => {
    try {
      if (!postgresPool) throw new HttpError(503, 'Loan records require PostgreSQL.', 'LOANS_UNAVAILABLE');
      const result = await postgresPool.query(
        `UPDATE loans SET status = 'Rejected', rejected_at = now(), notes = concat_ws(E'\n', notes, NULLIF($1, '')), updated_at = now()
         WHERE id = $2 AND status = 'ChairmanReview' RETURNING id, member_id, status`,
        [String(req.body?.reason || '').trim().slice(0, 500), req.params.id]
      );
      if (!result.rowCount) throw new HttpError(409, 'Only an applied loan can be rejected.', 'LOAN_NOT_REJECTABLE');
      await recordAuditLog(req, 'LOAN_REJECTED', 'loans', String(result.rows[0].id), undefined, result.rows[0]);
      res.json(result.rows[0]);
    } catch (error: any) { sendApiError(res, error); }
  });

  app.post('/api/loans/:id/repayments', requirePermission('loans.write'), async (req, res) => {
    const client = postgresPool ? await postgresPool.connect() : null;
    try {
      if (!client) throw new HttpError(503, 'Loan records require PostgreSQL.', 'LOANS_UNAVAILABLE');
      const amount = Number(req.body?.amount);
      const repaymentDate = String(req.body?.repaymentDate || new Date().toISOString().slice(0, 10));
      if (!Number.isFinite(amount) || amount <= 0) throw new HttpError(400, 'Enter a valid repayment amount.', 'REPAYMENT_INVALID');
      await client.query('BEGIN');
      const loan = await client.query(
        `SELECT l.*, l.principal_amount * (1 + l.interest_rate / 100) -
           COALESCE((SELECT SUM(lr.amount) FROM loan_repayments lr WHERE lr.loan_id = l.id), 0) AS outstanding
         FROM loans l WHERE l.id = $1 FOR UPDATE`, [req.params.id]
      );
      if (!loan.rowCount || !['Active', 'Defaulted'].includes(loan.rows[0].status)) throw new HttpError(409, 'Select an active loan.', 'LOAN_NOT_ACTIVE');
      const outstanding = Number(loan.rows[0].outstanding);
      if (amount > outstanding + 0.005) throw new HttpError(400, `Repayment exceeds the outstanding balance of KES ${outstanding.toFixed(2)}.`, 'REPAYMENT_EXCEEDS_BALANCE');
      const repayment = await client.query(
        `INSERT INTO loan_repayments (loan_id, repayment_date, amount, recorded_by) VALUES ($1, $2, $3, $4)
         RETURNING id, loan_id, repayment_date, amount`,
        [req.params.id, repaymentDate, amount, requireAuthenticatedUser(req).id]
      );
      const cleared = outstanding - amount <= 0.005;
      if (cleared) await client.query(`UPDATE loans SET status = 'Cleared', updated_at = now() WHERE id = $1`, [req.params.id]);
      await client.query('COMMIT');
      await recordAuditLog(req, 'LOAN_REPAYMENT_RECORDED', 'loans', req.params.id, undefined, { ...repayment.rows[0], cleared });
      res.status(201).json({ ...repayment.rows[0], outstandingBalance: Math.max(0, outstanding - amount), loanStatus: cleared ? 'Cleared' : loan.rows[0].status });
    } catch (error: any) {
      if (client) await client.query('ROLLBACK').catch(() => undefined);
      sendApiError(res, error);
    } finally { client?.release(); }
  });

  // API 3: Get Sacco Members
  app.get('/api/members', async (req, res) => {
    try {
      const user = requireAuthenticatedUser(req);
      if (isMemberUser(user)) {
        const portal = await getMemberPortalData(user);
        return res.json([portal.member]);
      }
      if (!hasPermission(user.role, 'members.read.all')) {
        throw new HttpError(403, 'Access denied.', 'ACCESS_DENIED');
      }
      if (postgresPool) {
        return res.json(await listPostgresMembers(postgresPool));
      }
      const list = localStore.members;
      res.json(list);
    } catch (error: any) {
      sendApiError(res, error);
    }
  });

  // API 4: Register Sacco Member (Authorized roles: Chairman, Secretary, Treasurer)
  app.post('/api/members', requirePermission('members.write'), async (req, res) => {
    try {
      const memberData = req.body;
      if (!memberData.name || !memberData.idNumber) {
        return res.status(400).json({ error: 'Name and National ID Number are required.' });
      }
      const name = sanitizePersonName(memberData.name).trim();
      const idNumber = sanitizeIntegerInput(memberData.idNumber, 12);
      const phoneNumber = sanitizePhoneNumber(memberData.phoneNumber);
      const email = normalizedEmail(memberData.email);
      const vehicleAssigned = sanitizeVehiclePlate(memberData.vehicleAssigned).trim();
      if (!isValidPersonName(name)) {
        return res.status(400).json({ error: 'Member name must contain letters only.' });
      }
      if (!idNumber || String(memberData.idNumber).trim() !== idNumber) {
        return res.status(400).json({ error: 'National ID Number must contain digits only.' });
      }
      if (!isValidPhoneNumber(phoneNumber)) {
        return res.status(400).json({ error: 'Enter a valid member phone number using digits only.' });
      }
      if (!/^\S+@\S+\.\S+$/.test(email)) {
        return res.status(400).json({ error: 'Enter a valid member email address for secure account verification.', code: 'MEMBER_EMAIL_REQUIRED' });
      }
      if (vehicleAssigned && !isValidKenyanVehiclePlate(vehicleAssigned)) {
        return res.status(400).json({ error: 'Assigned vehicle plate must use a valid Kenyan plate format.' });
      }
      const registeredMembers = await getAllMembers();
      if (registeredMembers.some(member => member.idNumber === idNumber)) {
        return res.status(409).json({ error: `National ID Number ${idNumber} is already registered.`, code: 'MEMBER_ALREADY_REGISTERED' });
      }
      if (memberData.id && registeredMembers.some(member => member.id === memberData.id)) {
        return res.status(409).json({ error: 'This member profile already exists.', code: 'MEMBER_ALREADY_REGISTERED' });
      }
      const memberId = memberData.id || 'm-' + Date.now();
      const newMember = {
        id: memberId,
        name,
        idNumber,
        email,
        phoneNumber,
        status: memberData.status || 'Active',
        dateRegistered: memberData.dateRegistered || new Date().toISOString().substring(0, 10),
        vehicleAssigned,
        sharesAmount: Number(memberData.sharesAmount) || 0,
        savingsAmount: Number(memberData.savingsAmount) || 0,
        initialLoanAmount: Math.max(0, Number(memberData.initialLoanAmount ?? memberData.loanBalance) || 0),
        loanBalance: Math.max(0, Number(memberData.loanBalance) || 0)
      };

      if (postgresPool) {
        const created = await createPostgresMember(postgresPool, newMember);
        await recordAuditLog(req, 'MEMBER_CREATED', 'members', created.id, undefined, created);
        return res.status(201).json(created);
      }

      await Promise.resolve((() => {
          const idx = localStore.members.findIndex(m => m.id === memberId);
          if (idx >= 0) {
            localStore.members[idx] = newMember;
          } else {
            localStore.members.push(newMember);
          }
        })());

      await recordAuditLog(req, 'MEMBER_CREATED', 'members', newMember.id, undefined, newMember);
      res.status(201).json(newMember);
    } catch (error: any) {
      sendApiError(res, error);
    }
  });

  // API 5: Get Fleet Vehicles
  app.get('/api/vehicles', async (req, res) => {
    try {
      const user = requireAuthenticatedUser(req);
      if (isMemberUser(user)) {
        const portal = await getMemberPortalData(user);
        return res.json(portal.vehicles);
      }
      if (!hasPermission(user.role, 'vehicles.read.all')) {
        throw new HttpError(403, 'Access denied.', 'ACCESS_DENIED');
      }
      if (postgresPool) {
        return res.json(await listPostgresVehicles(postgresPool));
      }
      const list = localStore.vehicles;
      res.json(list);
    } catch (error: any) {
      sendApiError(res, error);
    }
  });

  // API 6: Register Matatu Vehicle (Authorized roles: Chairman, Secretary)
  app.post('/api/vehicles', requirePermission('vehicles.write'), async (req, res) => {
    try {
      const vehicleData = req.body;
      if (!vehicleData.plateNumber || !vehicleData.ownerId) {
        return res.status(400).json({ error: 'Plate Number and a registered owner are required.' });
      }
      const plateNumber = sanitizeVehiclePlate(vehicleData.plateNumber).trim();
      const driverName = sanitizePersonName(vehicleData.driverName).trim();
      const driverPhone = sanitizePhoneNumber(vehicleData.driverPhone);
      if (!isValidKenyanVehiclePlate(plateNumber)) {
        return res.status(400).json({ error: 'Plate Number must use a valid Kenyan plate format.' });
      }
      if (!isValidPersonName(driverName)) {
        return res.status(400).json({ error: 'Driver name must contain letters only.' });
      }
      if (!isValidPhoneNumber(driverPhone)) {
        return res.status(400).json({ error: 'Enter a valid driver phone number using digits only.' });
      }
      const [registeredMembers, registeredVehicles] = await Promise.all([getAllMembers(), getAllVehicles()]);
      const owner = registeredMembers.find(member => member.id === String(vehicleData.ownerId));
      if (!owner) {
        return res.status(400).json({ error: 'Select a registered member as the vehicle owner.', code: 'MEMBER_NOT_FOUND' });
      }
      if (owner.status !== 'Active') {
        return res.status(409).json({ error: `Member "${owner.name}" is not active.`, code: 'MEMBER_NOT_ACTIVE' });
      }
      const normalizedPlate = plateNumber.replace(/\s+/g, '');
      if (registeredVehicles.some(vehicle => vehicle.plateNumber.replace(/\s+/g, '').toUpperCase() === normalizedPlate)) {
        return res.status(409).json({ error: `Vehicle ${plateNumber} is already registered.`, code: 'VEHICLE_ALREADY_REGISTERED' });
      }

      const vehicleId = vehicleData.id || 'v-' + Date.now();
      const newVehicle = {
        id: vehicleId,
        plateNumber,
        ownerId: owner.id,
        ownerName: owner.name,
        driverName,
        driverPhone,
        route: '17 Stage & Cabbanas',
        status: vehicleData.status || 'Active',
        capacity: ([7, 14, 33, 50].includes(Number(vehicleData.capacity)) ? Number(vehicleData.capacity) : 14) as 7 | 14 | 33 | 50
      };

      if (postgresPool) {
        const created = await createPostgresVehicle(postgresPool, newVehicle, requireAuthenticatedUser(req).id);
        await recordAuditLog(req, 'VEHICLE_CREATED', 'vehicles', created.id, undefined, created);
        return res.status(201).json(created);
      }

      await Promise.resolve((() => {
          const idx = localStore.vehicles.findIndex(v => v.id === vehicleId);
          if (idx >= 0) {
            localStore.vehicles[idx] = newVehicle;
          } else {
            localStore.vehicles.push(newVehicle);
          }
          const owner = localStore.members.find(member => member.id === newVehicle.ownerId);
          if (owner) owner.vehicleAssigned = newVehicle.plateNumber;
        })());

      await recordAuditLog(req, 'VEHICLE_CREATED', 'vehicles', newVehicle.id, undefined, newVehicle);
      res.status(201).json(newVehicle);
    } catch (error: any) {
      sendApiError(res, error);
    }
  });

  // Close the previous driver assignment and create a new one. Historical
  // assignments are never overwritten.
  app.put('/api/vehicles/:id/driver', requirePermission('drivers.assign'), async (req, res) => {
    try {
      if (!postgresPool) {
        throw new HttpError(503, 'Driver assignment history requires the PostgreSQL SACCO database.', 'DRIVER_HISTORY_UNAVAILABLE');
      }
      const driverName = sanitizePersonName(req.body?.driverName).trim();
      const driverPhone = sanitizePhoneNumber(req.body?.driverPhone);
      const reason = String(req.body?.reason || '').trim().slice(0, 500);
      if (!isValidPersonName(driverName) || !isValidPhoneNumber(driverPhone)) {
        throw new HttpError(400, 'A valid driver name and phone number are required.', 'INVALID_DRIVER_ASSIGNMENT');
      }
      const assignment = await assignPostgresDriver(
        postgresPool,
        req.params.id,
        { driverName, driverPhone, reason },
        requireAuthenticatedUser(req).id
      );
      await recordAuditLog(req, 'DRIVER_ASSIGNMENT_CHANGED', 'driver_assignments', assignment.id, undefined, assignment);
      res.status(201).json(assignment);
    } catch (error: any) {
      sendApiError(res, error);
    }
  });

  // API 7: Get Ledger Transactions
  app.get('/api/transactions', async (req, res) => {
    try {
      const user = requireAuthenticatedUser(req);
      if (isMemberUser(user)) {
        const portal = await getMemberPortalData(user);
        return res.json(portal.transactions);
      }
      if (!hasPermission(user.role, 'ledger.read.all')) {
        throw new HttpError(403, 'Access denied.', 'ACCESS_DENIED');
      }
      if (postgresPool) {
        return res.json(await listPostgresTransactions(postgresPool));
      }
      const list = localStore.transactions;
      // Sort by timestamp descending
      list.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
      res.json(list);
    } catch (error: any) {
      sendApiError(res, error);
    }
  });

  // API 8: Book a transaction (Authorized roles: Chairman, Treasurer, Accountant)
  app.post('/api/transactions', requirePermission('ledger.write'), async (req, res) => {
    try {
      const newTx = await createLedgerTransaction(req.body);
      await recordAuditLog(req, 'LEDGER_ENTRY_POSTED', 'ledger_entries', newTx.id, undefined, newTx);
      res.status(201).json(newTx);
    } catch (error: any) {
      sendApiError(res, error);
    }
  });

  app.put('/api/transactions/:id', requirePermission('ledger.write'), async (req, res) => {
    try {
      const updated = await updateLedgerTransaction(req.params.id, req.body);
      await recordAuditLog(req, 'LEDGER_ENTRY_CORRECTED', 'ledger_entries', updated.id, undefined, {
        correctedEntryId: updated.id,
        originalEntryId: req.params.id
      });
      res.json(updated);
    } catch (error: any) {
      sendApiError(res, error);
    }
  });

  // API 8B: Reverse a transaction without deleting immutable ledger history
  app.post('/api/transactions/:id/reverse', requirePermission('ledger.write'), async (req, res) => {
    try {
      const user = (req as any).user;
      const reversal = await reverseLedgerTransaction(req.params.id, user?.name || 'Sacco Ledger OS');
      await recordAuditLog(req, 'LEDGER_ENTRY_REVERSED', 'ledger_entries', reversal.id, undefined, reversal);
      res.status(201).json(reversal);
    } catch (error: any) {
      sendApiError(res, error);
    }
  });

  // API 8C: Payment reconciliation register
  app.get('/api/payments', async (req, res) => {
    try {
      const user = requireAuthenticatedUser(req);
      if (isMemberUser(user)) {
        const portal = await getMemberPortalData(user);
        return res.json(portal.payments);
      }
      if (!hasPermission(user.role, 'payments.read.all')) {
        throw new HttpError(403, 'Access denied.', 'ACCESS_DENIED');
      }
      res.json(await listPaymentRecords());
    } catch (error: any) {
      sendApiError(res, error);
    }
  });

  app.post('/api/payments/:id/reconcile', requirePermission('payments.reconcile'), async (req, res) => {
    try {
      const user = (req as any).user;
      const payment = await reconcilePaymentRecord(req.params.id, req.body.memberId, user?.name || 'Sacco Ledger OS');
      res.json(payment);
    } catch (error: any) {
      sendApiError(res, error);
    }
  });

  // API 9: Sacco Dynamic Ledger Status (computed on server side)
  app.get('/api/system/status', async (req, res) => {
    try {
      const user = requireAuthenticatedUser(req);
      if (isMemberUser(user)) {
        const portal = await getMemberPortalData(user);
        const totalCredits = portal.transactions.filter(transaction => transaction.type === 'Credit').reduce((total, transaction) => total + transaction.amount, 0);
        const totalDebits = portal.transactions.filter(transaction => transaction.type === 'Debit').reduce((total, transaction) => total + transaction.amount, 0);
        return res.json({
          totalTransactionsCount: portal.transactions.length,
          totalMembersCount: 1,
          totalFleetCount: portal.vehicles.length,
          netCashFlow: totalCredits - totalDebits,
          totalCapitalReserve: portal.member.sharesAmount,
          totalMemberSavings: portal.member.savingsAmount,
          systemHealth: 'member-scope',
          auditTimestamp: new Date().toISOString()
        });
      }
      if (!hasPermission(user.role, 'system.read.all')) {
        throw new HttpError(403, 'Access denied.', 'ACCESS_DENIED');
      }
      if (postgresPool) {
        const [transactions, members, vehicles] = await Promise.all([
          listPostgresTransactions(postgresPool),
          listPostgresMembers(postgresPool),
          listPostgresVehicles(postgresPool)
        ]);
        const totalCredits = transactions.filter(tx => tx.type === 'Credit').reduce((sum, tx) => sum + tx.amount, 0);
        const totalDebits = transactions.filter(tx => tx.type === 'Debit').reduce((sum, tx) => sum + tx.amount, 0);
        return res.json({
          totalTransactionsCount: transactions.length,
          totalMembersCount: members.length,
          totalFleetCount: vehicles.length,
          netCashFlow: totalCredits - totalDebits,
          totalCapitalReserve: members.reduce((sum, member) => sum + member.sharesAmount, 0),
          totalMemberSavings: members.reduce((sum, member) => sum + member.savingsAmount, 0),
          systemHealth: 'ok',
          auditTimestamp: new Date().toISOString()
        });
      }
      const data = await Promise.resolve((() => {
          let totalCredits = 0;
          let totalDebits = 0;
          localStore.transactions.forEach(tx => {
            if (tx.type === 'Credit') {
              totalCredits += (tx.amount || 0);
            } else {
              totalDebits += (tx.amount || 0);
            }
          });

          let totalShares = 0;
          let totalSavings = 0;
          localStore.members.forEach(m => {
            totalShares += (m.sharesAmount || 0);
            totalSavings += (m.savingsAmount || 0);
          });

          return {
            totalTransactionsCount: localStore.transactions.length,
            totalMembersCount: localStore.members.length,
            totalFleetCount: localStore.vehicles.length,
            netCashFlow: totalCredits - totalDebits,
            totalCapitalReserve: totalShares,
            totalMemberSavings: totalSavings,
            systemHealth: "100%",
            auditTimestamp: new Date().toISOString()
          };
        })());

      res.json(data);
    } catch (error: any) {
      sendApiError(res, error);
    }
  });

  // A Member never selects a record ID for this view. The server resolves the
  // member identity from the authenticated SACCO profile and queries only that
  // member's records.
  app.get('/api/member-portal', requirePermission('member.portal.read'), async (req, res) => {
    try {
      res.json(await getMemberPortalData(requireAuthenticatedUser(req)));
    } catch (error: any) {
      sendApiError(res, error);
    }
  });

  // =========================================================================
  // CO-OPERATIVE BANK B2B EVENT NOTIFICATION (IPN) INGRESS
  // =========================================================================

  app.get('/api/coop-bank/config', authenticateSaccoUser, requirePermission('payments.read.all'), async (_req, res) => {
    try {
      res.json({ ...coopBankPublicConfig(), counts: await coopBankOperationalCounts() });
    } catch (error: any) {
      sendApiError(res, error);
    }
  });

  app.get('/api/coop-bank/events', authenticateSaccoUser, requirePermission('payments.read.all'), async (req, res) => {
    try {
      res.json(await listCoopBankEvents(req.query));
    } catch (error: any) {
      sendApiError(res, error);
    }
  });

  app.get('/api/coop-bank/events/:id/raw', authenticateSaccoUser, async (req, res) => {
    try {
      const user = requireAuthenticatedUser(req);
      if (user.role !== 'Chairman') throw new HttpError(403, 'Only the Chairman can view protected raw bank payloads.', 'ACCESS_DENIED');
      if (!postgresPool || !req.params.id.match(/^[0-9a-f-]{36}$/i)) throw new HttpError(404, 'Bank event was not found.', 'COOP_EVENT_NOT_FOUND');
      const result = await postgresPool.query('SELECT raw_payload FROM coop_bank_ipn_events WHERE id = $1', [req.params.id]);
      if (!result.rowCount) throw new HttpError(404, 'Bank event was not found.', 'COOP_EVENT_NOT_FOUND');
      res.json({ rawPayload: result.rows[0].raw_payload });
    } catch (error: any) {
      sendApiError(res, error);
    }
  });

  app.post('/api/coop-bank/events/:id/reprocess', authenticateSaccoUser, requirePermission('payments.reconcile'), async (req, res) => {
    try {
      if (!req.params.id.match(/^[0-9a-f-]{36}$/i)) throw new HttpError(404, 'Bank event was not found.', 'COOP_EVENT_NOT_FOUND');
      if (postgresPool) {
        const guarded = await postgresPool.query(
          `UPDATE coop_bank_ipn_events SET processing_status = 'RECEIVED', last_processing_error = NULL
           WHERE id = $1 AND ledger_entry_id IS NULL
             AND reconciliation_status NOT IN ('POSTED','MANUALLY_RECONCILED') RETURNING id`,
          [req.params.id]
        );
        if (!guarded.rowCount) throw new HttpError(409, 'Posted or manually completed events cannot be reprocessed.', 'COOP_REPROCESS_REJECTED');
      }
      const correlationId = crypto.randomUUID();
      await recordCoopBankAudit({ eventId: req.params.id, action: 'REPROCESS_REQUESTED', actorType: 'USER', actorUserId: requireAuthenticatedUser(req).id, correlationId });
      await processCoopBankEvent(req.params.id, correlationId);
      res.json({ event: (await listCoopBankEvents()).find(item => item.id === req.params.id) || null });
    } catch (error: any) {
      sendApiError(res, error);
    }
  });

  app.post('/api/coop-bank/events/:id/reconcile', authenticateSaccoUser, requirePermission('payments.reconcile'), async (req, res) => {
    try {
      const config = loadCoopIpnConfig();
      if (config.observeOnly) throw new HttpError(409, 'Observe-only mode is active. Disable it in the server environment before posting any bank event.', 'COOP_OBSERVE_ONLY');
      if (!postgresPool) throw new HttpError(503, 'Manual bank reconciliation requires PostgreSQL.', 'COOP_RECONCILIATION_UNAVAILABLE');
      if (!req.params.id.match(/^[0-9a-f-]{36}$/i)) throw new HttpError(404, 'Bank event was not found.', 'COOP_EVENT_NOT_FOUND');
      const category = String(req.body?.category || '') as Transaction['category'];
      const tillNumber = String(req.body?.tillNumber || (category === 'Savings Contribution' ? 'UtilityTill' : 'VehicleTill')) as Transaction['tillNumber'];
      const user = requireAuthenticatedUser(req);
      const result = await reconcilePostgresCoopBankEvent(postgresPool, {
        eventId: req.params.id,
        memberId: String(req.body?.memberId || ''),
        vehicleId: String(req.body?.vehicleId || '') || undefined,
        category,
        tillNumber,
        note: String(req.body?.note || '').trim().slice(0, 500),
        actorId: user.id,
        actorName: user.name,
        correlationId: crypto.randomUUID()
      });
      await recordAuditLog(req, 'COOP_BANK_EVENT_RECONCILED', 'coop_bank_ipn_events', req.params.id, undefined, result);
      res.json({ ...result, event: (await listCoopBankEvents()).find(item => item.id === req.params.id) || null });
    } catch (error: any) {
      sendApiError(res, error);
    }
  });

  app.post('/api/coop-bank/events/:id/quarantine', authenticateSaccoUser, requirePermission('payments.reconcile'), async (req, res) => {
    try {
      if (!postgresPool || !req.params.id.match(/^[0-9a-f-]{36}$/i)) throw new HttpError(404, 'Bank event was not found.', 'COOP_EVENT_NOT_FOUND');
      const reason = String(req.body?.reason || '').trim().slice(0, 500);
      if (!reason) throw new HttpError(400, 'Give a reason for quarantining this event.', 'COOP_QUARANTINE_REASON_REQUIRED');
      const previous = await postgresPool.query(
        `UPDATE coop_bank_ipn_events SET processing_status = 'QUARANTINED', manual_review_reason = $2
         WHERE id = $1 AND ledger_entry_id IS NULL AND reconciliation_status NOT IN ('POSTED','MANUALLY_RECONCILED')
         RETURNING reconciliation_status`,
        [req.params.id, reason]
      );
      if (!previous.rowCount) throw new HttpError(409, 'This event has already been completed.', 'COOP_EVENT_ALREADY_RECONCILED');
      const user = requireAuthenticatedUser(req);
      await recordCoopBankAudit({ eventId: req.params.id, action: 'EVENT_QUARANTINED', actorType: 'USER', actorUserId: user.id, previousStatus: previous.rows[0].reconciliation_status, newStatus: 'QUARANTINED', reason, correlationId: crypto.randomUUID() });
      res.json({ quarantined: true });
    } catch (error: any) {
      sendApiError(res, error);
    }
  });

  const receiveCoopBankIpn = async (req: express.Request, res: express.Response) => {
    const startedAt = Date.now();
    const suppliedCorrelation = String(req.headers['x-correlation-id'] || '');
    const correlationId = suppliedCorrelation.match(/^[0-9a-f-]{36}$/i) ? suppliedCorrelation : crypto.randomUUID();
    try {
      if (!req.is('application/json')) throw new CoopIpnError(415, 'Content-Type must be application/json.', 'COOP_IPN_CONTENT_TYPE_INVALID');
      if (isProduction && !req.secure) throw new CoopIpnError(403, 'HTTPS is required.', 'COOP_IPN_HTTPS_REQUIRED');
      const config = loadCoopIpnConfig();
      const credentialHeader = config.authMode === 'TOKEN' ? req.headers[config.tokenHeader] : req.headers.authorization;
      assertCoopIpnAuthentication(Array.isArray(credentialHeader) ? credentialHeader[0] : credentialHeader, config);
      const event = normalizeCoopIpnPayload(req.body, config);
      const result = await persistCoopBankEvent(event, config.authMode, correlationId);
      res.status(200).json({ MessageCode: config.successMessageCode, Message: 'Successfully received data' });
      console.info(JSON.stringify({ component: 'coop_ipn', correlationId, bankEventId: result.eventId,
        externalTransactionId: event.externalTransactionId, result: result.created ? 'STORED' : 'DUPLICATE', durationMs: Date.now() - startedAt }));
      if (result.created) setImmediate(() => { void processCoopBankEvent(result.eventId, correlationId); });
    } catch (error: any) {
      const status = error instanceof CoopIpnError || error instanceof HttpError ? error.status : 503;
      console.warn(JSON.stringify({ component: 'coop_ipn', correlationId, result: 'REJECTED', errorCategory: error?.code || 'PERSISTENCE_FAILED', durationMs: Date.now() - startedAt }));
      res.status(status).json({ MessageCode: String(status), Message: error instanceof CoopIpnError || error instanceof HttpError ? error.message : 'Unable to durably receive data' });
    }
  };

  // The new route is the canonical callback. The previous route remains as a
  // compatibility alias so existing bank onboarding does not break.
  app.post('/api/integrations/coop/ipn', receiveCoopBankIpn);
  app.post('/api/webhooks/coop-bank/b2b-ipn', receiveCoopBankIpn);
  app.all(['/api/integrations/coop/ipn', '/api/webhooks/coop-bank/b2b-ipn'], (_req, res) => {
    res.status(405).json({ MessageCode: '405', Message: 'Method not allowed' });
  });

  app.use((error: any, _req: express.Request, res: express.Response, next: express.NextFunction) => {
    if (error?.type === 'entity.too.large') return res.status(413).json({ MessageCode: '413', Message: 'Request body is too large' });
    if (error instanceof SyntaxError && 'body' in error) return res.status(400).json({ MessageCode: '400', Message: 'Malformed JSON payload' });
    next(error);
  });

  // Firebase Hosting serves the SPA separately. The standalone Node runtime
  // keeps the existing Vite development middleware and production static app.
  if (options.serveFrontend !== false) {
    if (!isProduction) {
      const { createServer: createViteServer } = await import('vite');
      const vite = await createViteServer({
        server: { middlewareMode: true },
        appType: 'spa',
      });
      app.use(vite.middlewares);
    } else {
      const distPath = path.join(process.cwd(), 'dist', 'client');
      app.use(express.static(distPath));
      app.get('*', (_req, res) => {
        res.sendFile(path.join(distPath, 'index.html'));
      });
    }
  }

  return app;
}
