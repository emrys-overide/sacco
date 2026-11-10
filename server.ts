import 'dotenv/config';
import express from 'express';
import path from 'path';
import fs from 'node:fs';
import crypto from 'node:crypto';
import type { Pool } from 'pg';
import {
  initiateStkPush,
  queryDarajaStkStatus,
  parseCallbackMetadata,
  normalizeMpesaPhoneNumber,
  getDarajaConfig
} from './src/server/darajaMpesa';
import {
  createPendingStkTransaction,
  completeStkTransaction,
  failStkTransaction,
  flagDelayedStkTransaction,
  getSaccoTransactionByCheckoutId,
  listPendingStkTransactionsForReconciliation,
  resolveReconciledStkTransaction,
  listMemberSaccoTransactions
} from './src/server/postgresStore';
import {
  processMemberChat,
  type MemberFinancialContext,
  type ChatMessage
} from './src/server/conversationalCollections';
import {
  runNightlyReconciliation,
  startNightlyReconciliationScheduler
} from './src/server/nightlyReconciliation';
import type { SaccoTransaction, SaccoTransactionType, SaccoTransactionStatus } from './src/types';

import { createDatabasePool } from './database-config.mjs';
import {
  PersistenceError,
  correctPostgresTransaction,
  deletePostgresTransaction,
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
  savePostgresPayment,
  updatePostgresVehicle
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
  isValidMemberNumber,
  isValidPhoneNumber,
  sanitizeIntegerInput,
  sanitizeMemberNumber,
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
import { isApprovedVehicleRoute, isSupportedVehicleCapacity } from './src/lib/vehicleRegistration';
import { startBackgroundProcessor } from './src/server/backgroundProcessor';
import { configureProxyTrust, securityHeaders } from './src/server/securityMiddleware';
import { registerSystemRoutes } from './src/server/systemRoutes';
import { canReviewLoanStage } from './src/server/loanWorkflow';
import { isSessionIdle } from './src/server/sessionPolicy';
import { canViewDeveloperErrorLog, redactErrorText, safeErrorPath } from './src/server/developerErrorLog';
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
import {
  MpesaError,
  initiateStkPush as initiateMpesaDarajaStkPush,
  loadMpesaConfig,
  matchMpesaReference,
  parseMpesaC2bPayload,
  parseMpesaStkCallback
} from './src/server/mpesaDaraja';
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
const localLoginRateLimits = new Map<string, { attempts: number; windowStartedAt: number; lockedUntil?: number }>();
const localClientErrorReportLimits = new Map<string, { count: number; windowStartedAt: number }>();
const localPasswordResetRequests: Array<{ id: string; userId: string; status: 'Pending' | 'Completed' | 'Cancelled'; createdAt: string; reviewedAt?: string; reviewedBy?: string }> = [];
const localChairmanRecoveryRequests: Array<{ id: string; userId: string; status: 'Pending' | 'Completed' | 'Cancelled'; requestedIp?: string; createdAt: string; reviewedAt?: string; reviewedBy?: string }> = [];
const localAppNotifications: Array<{ id: string; recipientUserId: string; category: string; title: string; message: string; destination?: string; createdAt: string; readAt?: string }> = [];
const liveNotificationStreams = new Map<string, Set<express.Response>>();
const localApplicationErrorLogs: Array<{
  id: string;
  occurred_at: string;
  source: 'server' | 'client';
  severity: 'warning' | 'error' | 'critical';
  request_id?: string;
  method?: string;
  path?: string;
  status_code?: number;
  error_code?: string;
  message: string;
  stack_trace?: string;
  context: Record<string, string>;
  actor_user_id?: string;
  resolved_at?: string;
  resolved_by?: string;
  resolution_note?: string;
}> = [];

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

async function registerPasswordMemberAccount(input: { memberNumber: unknown; fullName: unknown; phone: unknown; email: unknown; password: unknown }): Promise<AuthorizedUser> {
  const memberNumber = sanitizeMemberNumber(input.memberNumber);
  const fullName = sanitizePersonName(input.fullName).trim();
  const phone = sanitizePhoneNumber(input.phone).trim();
  const phoneDigits = normalizedPhone(phone);
  const email = normalizedEmail(input.email);
  const password = String(input.password || '');
  if (!isValidMemberNumber(memberNumber) || !isValidPersonName(fullName) || !isValidPhoneNumber(phone) || !/^\S+@\S+\.\S+$/.test(email) || password.length < 8) {
    throw new HttpError(400, 'Enter your member number, full name, registered phone and email, plus a password of at least 8 characters.', 'MEMBER_REGISTRATION_INVALID');
  }

  if (postgresPool) {
    const client = await postgresPool.connect();
    let committed = false;
    try {
      await client.query('BEGIN');
      const memberResult = await client.query(
        `SELECT id, member_number, full_name, phone, email
         FROM members
         WHERE status = 'Active'
           AND upper(member_number) = $1
           AND regexp_replace(COALESCE(phone, ''), '\\D', '', 'g') = $2
           AND lower(COALESCE(email, '')) = $3
         FOR UPDATE`,
        [memberNumber, phoneDigits, email]
      );
      if (memberResult.rowCount !== 1) {
        throw new HttpError(403, 'The member number, phone and email must match one active SACCO member record.', 'MEMBER_EMAIL_PHONE_MISMATCH');
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
    && sanitizeMemberNumber(item.membershipNumber) === memberNumber
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

type ApplicationErrorInput = {
  req?: express.Request;
  source: 'server' | 'client';
  severity?: 'warning' | 'error' | 'critical';
  statusCode?: number;
  errorCode?: string;
  message: unknown;
  stack?: unknown;
  context?: Record<string, string>;
  actorUserId?: string;
};

async function recordApplicationError(input: ApplicationErrorInput): Promise<void> {
  const requestUser = input.req ? (input.req as any).user as AuthorizedUser | undefined : undefined;
  const actorUserId = input.actorUserId || requestUser?.id;
  const requestId = input.req ? String((input.req as any).requestId || '') : '';
  const entry = {
    id: crypto.randomUUID(),
    occurred_at: new Date().toISOString(),
    source: input.source,
    severity: input.severity || 'error',
    request_id: requestId.match(/^[0-9a-f-]{36}$/i) ? requestId : undefined,
    method: input.req?.method?.slice(0, 10),
    path: safeErrorPath(input.req?.originalUrl || input.req?.path || '/'),
    status_code: input.statusCode,
    error_code: input.errorCode ? redactErrorText(input.errorCode, 100) : undefined,
    message: redactErrorText(input.message, 2_000) || 'Unspecified application error.',
    stack_trace: input.stack ? redactErrorText(input.stack, 8_000) : undefined,
    context: Object.fromEntries(Object.entries(input.context || {}).map(([key, value]) => [key.slice(0, 80), redactErrorText(value, 500)])),
    actor_user_id: actorUserId?.match(/^[0-9a-f-]{36}$/i) ? actorUserId : undefined
  };

  try {
    if (postgresPool) {
      await postgresPool.query(
        `INSERT INTO application_error_logs (
          id, occurred_at, source, severity, request_id, method, path, status_code,
          error_code, message, stack_trace, context, actor_user_id
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12::jsonb, $13)`,
        [
          entry.id, entry.occurred_at, entry.source, entry.severity, entry.request_id || null,
          entry.method || null, entry.path, entry.status_code || null, entry.error_code || null,
          entry.message, entry.stack_trace || null, JSON.stringify(entry.context), entry.actor_user_id || null
        ]
      );
      return;
    }
    localApplicationErrorLogs.unshift(entry);
    localApplicationErrorLogs.splice(200);
  } catch {
    // Diagnostics must never make the original request fail or reveal details.
    console.error('[Sacco Diagnostics] Error log persistence failed.');
  }
}

function requireDeveloperErrorLogAccess(req: express.Request): AuthorizedUser {
  const user = requireAuthenticatedUser(req);
  if (!canViewDeveloperErrorLog(user.email)) {
    throw new HttpError(403, 'Developer diagnostics access is not enabled for this account.', 'DEVELOPER_DIAGNOSTICS_ACCESS_DENIED');
  }
  return user;
}

function allowClientErrorReport(userId: string): boolean {
  const now = Date.now();
  const existing = localClientErrorReportLimits.get(userId);
  if (!existing || now - existing.windowStartedAt >= 15 * 60 * 1000) {
    localClientErrorReportLimits.set(userId, { count: 1, windowStartedAt: now });
    return true;
  }
  if (existing.count >= 20) return false;
  existing.count += 1;
  return true;
}

type AppNotificationInput = {
  category: string;
  title: string;
  message: string;
  destination?: string;
};

type DeliveredNotification = {
  id: string;
  category: string;
  title: string;
  message: string;
  destination?: string | null;
  created_at: string;
  read_at?: string | null;
};

function broadcastNotification(userId: string, notification: DeliveredNotification): void {
  const streams = liveNotificationStreams.get(userId);
  if (!streams?.size) return;
  const packet = `event: notification\ndata: ${JSON.stringify(notification)}\n\n`;
  for (const stream of streams) {
    try {
      stream.write(packet);
    } catch {
      streams.delete(stream);
    }
  }
  if (!streams.size) liveNotificationStreams.delete(userId);
}

function normalizedNotification(input: AppNotificationInput): AppNotificationInput {
  return {
    category: String(input.category || 'SYSTEM').slice(0, 80),
    title: String(input.title || 'SACCO notification').slice(0, 180),
    message: String(input.message || '').slice(0, 1_000),
    destination: input.destination ? String(input.destination).slice(0, 100) : undefined
  };
}

async function notifyUser(userId: string, input: AppNotificationInput): Promise<void> {
  const notification = normalizedNotification(input);
  try {
    if (postgresPool) {
      if (!userId.match(/^[0-9a-f-]{36}$/i)) return;
      const result = await postgresPool.query(
        `INSERT INTO app_notifications (recipient_user_id, category, title, message, destination)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING id, category, title, message, destination, created_at, read_at`,
        [userId, notification.category, notification.title, notification.message, notification.destination || null]
      );
      if (result.rowCount) broadcastNotification(userId, result.rows[0] as DeliveredNotification);
      return;
    }
    const local = { id: crypto.randomUUID(), recipientUserId: userId, ...notification, createdAt: new Date().toISOString() };
    localAppNotifications.unshift(local);
    broadcastNotification(userId, { id: local.id, category: local.category, title: local.title, message: local.message, destination: local.destination, created_at: local.createdAt, read_at: null });
    localAppNotifications.splice(500);
  } catch {
    console.error('[Sacco Notifications] Notification persistence failed.');
  }
}

async function notifyRole(role: UserRole, input: AppNotificationInput): Promise<void> {
  const notification = normalizedNotification(input);
  try {
    if (postgresPool) {
      const result = await postgresPool.query(
        `INSERT INTO app_notifications (recipient_user_id, category, title, message, destination)
         SELECT id, $2, $3, $4, $5
         FROM users
         WHERE role = $1 AND is_active = TRUE AND account_status = 'Active'
         RETURNING recipient_user_id, id, category, title, message, destination, created_at, read_at`,
        [role, notification.category, notification.title, notification.message, notification.destination || null]
      );
      result.rows.forEach(row => broadcastNotification(String(row.recipient_user_id), row as DeliveredNotification));
      return;
    }
    localStore.users.filter(user => user.role === role && user.isActive !== false && user.accountStatus === 'Active')
      .forEach(user => {
        const local = { id: crypto.randomUUID(), recipientUserId: user.id, ...notification, createdAt: new Date().toISOString() };
        localAppNotifications.unshift(local);
        broadcastNotification(user.id, { id: local.id, category: local.category, title: local.title, message: local.message, destination: local.destination, created_at: local.createdAt, read_at: null });
      });
    localAppNotifications.splice(500);
  } catch {
    console.error('[Sacco Notifications] Role notification persistence failed.');
  }
}

async function notifyMember(memberId: string, input: AppNotificationInput): Promise<void> {
  try {
    if (postgresPool) {
      const recipient = await postgresPool.query(
        `SELECT id FROM users
         WHERE role = 'Member' AND linked_member_id = $1 AND is_active = TRUE AND account_status = 'Active'
         LIMIT 1`,
        [memberId]
      );
      if (recipient.rowCount) await notifyUser(String(recipient.rows[0].id), input);
      return;
    }
    const recipient = localStore.users.find(user => user.role === 'Member' && user.linkedMemberId === memberId && user.isActive !== false && user.accountStatus === 'Active');
    if (recipient) await notifyUser(recipient.id, input);
  } catch {
    console.error('[Sacco Notifications] Member notification persistence failed.');
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

const LOAN_TYPES = new Set(['General', 'Emergency', 'Development', 'Education', 'Business', 'Vehicle']);
const REPAYMENT_METHODS = new Set(['SACCO collection', 'Salary deduction', 'Bank standing order', 'Mobile money', 'Other']);

function requiredRejectionReason(value: unknown): string {
  const reason = String(value || '').trim().replace(/\s+/g, ' ');
  if (reason.length < 5) {
    throw new HttpError(400, 'Give the member a clear rejection reason before rejecting this loan.', 'LOAN_REJECTION_REASON_REQUIRED');
  }
  return reason.slice(0, 1000);
}

function loginAttemptKey(requestIp: string | undefined, identifier: unknown): string {
  const normalizedIdentifier = String(identifier || '').trim().toLowerCase().slice(0, 200);
  return crypto.createHash('sha256').update(`${requestIp || 'unknown'}:${normalizedIdentifier}`).digest('hex');
}

const DAY_MS = 24 * 60 * 60 * 1000;

function memberInactivityDays(member: Member, now = Date.now()): number {
  const baseline = member.lastDailyCollectionAt || member.dateRegistered;
  const time = baseline ? new Date(baseline).getTime() : now;
  return Math.max(0, Math.floor((now - time) / DAY_MS));
}

async function processMemberInactivity(): Promise<void> {
  if (postgresPool) {
    const warningCandidates = await postgresPool.query(
      `UPDATE members
       SET status = 'Inactive', inactivity_warned_at = now(), updated_at = now()
       WHERE deleted_at IS NULL
         AND status = 'Active'
         AND COALESCE(last_daily_collection_at, date_registered::timestamptz, created_at) <= now() - interval '30 days'
         AND COALESCE(last_daily_collection_at, date_registered::timestamptz, created_at) > now() - interval '90 days'
       RETURNING id, member_number, full_name`
    );
    for (const member of warningCandidates.rows) {
      await notifyMember(String(member.id), {
        category: 'MEMBER_INACTIVITY_WARNING',
        title: 'Daily collections overdue',
        message: `No daily collection has been recorded for 30 days. Your member account (${member.member_number || member.full_name}) is now inactive and will be deactivated after 90 days without a collection.`,
        destination: 'My Account'
      });
    }

    const deactivated = await postgresPool.query(
      `UPDATE members
       SET status = 'Pending', suspended_at = now(),
           suspension_reason = 'Automatically deactivated after 90 days without a daily collection',
           updated_at = now()
       WHERE deleted_at IS NULL
         AND status IN ('Active', 'Inactive')
         AND COALESCE(last_daily_collection_at, date_registered::timestamptz, created_at) <= now() - interval '90 days'
       RETURNING id`
    );
    if (deactivated.rowCount) {
      await postgresPool.query(
        `UPDATE users
         SET account_status = 'Disabled', updated_at = now()
         WHERE role = 'Member' AND linked_member_id = ANY($1::uuid[])`,
        [deactivated.rows.map(row => row.id)]
      );
    }
    return;
  }

  const now = Date.now();
  for (const member of localStore.members) {
    const days = memberInactivityDays(member, now);
    member.inactivityDays = days;
    if (days >= 90 && (member.status === 'Active' || member.status === 'Inactive')) {
      member.status = 'Pending';
      member.suspendedAt = new Date(now).toISOString();
      member.suspensionReason = 'Automatically deactivated after 90 days without a daily collection';
      localStore.users.filter(user => user.role === 'Member' && user.linkedMemberId === member.id)
        .forEach(user => { user.accountStatus = 'Disabled'; });
    } else if (days >= 30 && member.status === 'Active') {
      member.status = 'Inactive';
      await notifyMember(member.id, {
        category: 'MEMBER_INACTIVITY_WARNING',
        title: 'Daily collections overdue',
        message: 'No daily collection has been recorded for 30 days. Your account will be deactivated after 90 days without a collection.',
        destination: 'My Account'
      });
    }
  }
}

function loginIpAttemptKey(requestIp: string | undefined): string {
  return crypto.createHash('sha256').update(`ip:${requestIp || 'unknown'}`).digest('hex');
}

async function assertLoginIsAllowed(attemptKeys: string[]): Promise<void> {
  const now = Date.now();
  if (!postgresPool) {
    const state = attemptKeys.map(key => localLoginRateLimits.get(key)).find(item => item?.lockedUntil && item.lockedUntil > now);
    if (state?.lockedUntil) {
      throw new HttpError(429, 'Too many sign-in attempts. Wait 15 minutes and try again.', 'LOGIN_RATE_LIMITED');
    }
    return;
  }
  const result = await postgresPool.query(
    'SELECT max(locked_until) AS locked_until FROM login_rate_limits WHERE attempt_key = ANY($1::text[])',
    [attemptKeys]
  );
  const lockedUntil = result.rows[0]?.locked_until ? new Date(result.rows[0].locked_until).getTime() : 0;
  if (lockedUntil > now) {
    throw new HttpError(429, 'Too many sign-in attempts. Wait 15 minutes and try again.', 'LOGIN_RATE_LIMITED');
  }
}

async function recordFailedLogin(attemptKey: string, limit = 10): Promise<void> {
  const now = Date.now();
  const windowMs = 15 * 60 * 1000;
  if (!postgresPool) {
    const previous = localLoginRateLimits.get(attemptKey);
    const state = !previous || previous.windowStartedAt + windowMs <= now
      ? { attempts: 1, windowStartedAt: now }
      : { ...previous, attempts: previous.attempts + 1 };
    if (state.attempts >= limit) state.lockedUntil = now + windowMs;
    localLoginRateLimits.set(attemptKey, state);
    return;
  }
  await postgresPool.query(
    `INSERT INTO login_rate_limits (attempt_key, attempt_count, window_started_at, locked_until, updated_at)
     VALUES ($1, 1, now(), NULL, now())
     ON CONFLICT (attempt_key) DO UPDATE SET
       attempt_count = CASE WHEN login_rate_limits.window_started_at < now() - interval '15 minutes' THEN 1 ELSE login_rate_limits.attempt_count + 1 END,
       window_started_at = CASE WHEN login_rate_limits.window_started_at < now() - interval '15 minutes' THEN now() ELSE login_rate_limits.window_started_at END,
       locked_until = CASE
         WHEN login_rate_limits.window_started_at < now() - interval '15 minutes' THEN NULL
         WHEN login_rate_limits.attempt_count + 1 >= $2 THEN now() + interval '15 minutes'
         ELSE login_rate_limits.locked_until
       END,
       updated_at = now()`,
    [attemptKey, limit]
  );
}

async function clearLoginFailures(attemptKey: string): Promise<void> {
  if (!postgresPool) {
    localLoginRateLimits.delete(attemptKey);
    return;
  }
  await postgresPool.query('DELETE FROM login_rate_limits WHERE attempt_key = $1', [attemptKey]);
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
  saccoTransactions: [] as SaccoTransaction[],
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
              u.linked_member_id, u.totp_secret_ciphertext, u.totp_enabled_at,
              u.must_change_password, u.temporary_password_expires_at
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
  if (!tx.memberId) return;

  const member = localStore.members.find(m => m.id === tx.memberId);
  if (!member) {
    throw new HttpError(404, 'Linked Sacco member profile was not found.', 'MEMBER_NOT_FOUND');
  }

  member.sharesAmount = Math.max(0, (member.sharesAmount || 0) + delta.shares);
  member.savingsAmount = Math.max(0, (member.savingsAmount || 0) + delta.savings);
  const currentLoan = Number(member.loanBalance || 0);
  const loanCeiling = Math.max(Number(member.initialLoanAmount || 0), currentLoan + Math.max(0, delta.loan));
  if (!member.initialLoanAmount && currentLoan > 0) {
    member.initialLoanAmount = currentLoan;
  }
  member.loanBalance = Math.min(loanCeiling, Math.max(0, currentLoan + delta.loan));
}

async function assertLedgerMonthIsOpen(timestamp: string): Promise<void> {
  if (!postgresPool) return;
  const result = await postgresPool.query(
    `SELECT closing_month FROM monthly_closings
     WHERE closing_month = date_trunc('month', $1::timestamptz)::date
     LIMIT 1`,
    [timestamp]
  );
  if (result.rowCount) {
    throw new HttpError(409, 'This accounting month is closed. Use a Chairman-authorised corrective process before changing it.', 'ACCOUNTING_MONTH_CLOSED');
  }
}

async function createLedgerTransaction(input: LedgerInput): Promise<Transaction> {
  const tx = normalizeTransactionInput(input);
  await validateLedgerRegistration(tx);

  if (postgresPool) {
    await assertLedgerMonthIsOpen(tx.timestamp);
    return createPostgresTransaction(postgresPool, tx);
  }

  await Promise.resolve((() => {
      const duplicate = localStore.transactions.some(t => normalizeRefCode(t.refCode) === tx.refCode);
      if (duplicate) {
        throw new HttpError(409, `Reference code ${tx.refCode} already exists in the ledger.`, 'DUPLICATE_LEDGER_REF');
      }

      applyLocalMemberBalance(tx);
      if (tx.memberId && tx.category === 'Daily Contribution' && tx.type === 'Credit' && !tx.reversalOf) {
        const member = localStore.members.find(item => item.id === tx.memberId);
        if (member) {
          member.lastDailyCollectionAt = tx.timestamp;
          member.inactivityDays = 0;
        }
      }
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
    await assertLedgerMonthIsOpen(original.timestamp);
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
    const original = (await listPostgresTransactions(postgresPool)).find(transaction => transaction.id === transactionId);
    if (!original) throw new HttpError(404, 'Transaction to reverse was not found.', 'TRANSACTION_NOT_FOUND');
    await assertLedgerMonthIsOpen(original.timestamp);
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

async function deleteLedgerTransaction(transactionId: string): Promise<Transaction> {
  if (postgresPool) {
    const original = (await listPostgresTransactions(postgresPool)).find(transaction => transaction.id === transactionId);
    if (!original) throw new HttpError(404, 'Transaction to delete was not found.', 'TRANSACTION_NOT_FOUND');
    await assertLedgerMonthIsOpen(original.timestamp);
    return deletePostgresTransaction(postgresPool, transactionId);
  }
  const original = await Promise.resolve((() => localStore.transactions.find(tx => tx.id === transactionId) || null)());
  if (!original) {
    throw new HttpError(404, 'Transaction to delete was not found.', 'TRANSACTION_NOT_FOUND');
  }
  await assertLedgerMonthIsOpen(original.timestamp);

  const reverseOriginal = { ...original, type: original.type === 'Credit' ? 'Debit' : 'Credit' } as Transaction;
  applyLocalMemberBalance(reverseOriginal);

  localStore.transactions = localStore.transactions.filter(tx => tx.id !== transactionId && tx.reversalOf !== transactionId);
  return original;
}

function sendApiError(res: express.Response, error: any) {
  const knownError = error instanceof HttpError || error instanceof PersistenceError || error instanceof LedgerPolicyError;
  const status = knownError ? error.status : 500;
  const code = knownError ? error.code : 'INTERNAL_ERROR';
  if (status >= 500) {
    void recordApplicationError({
      req: res.req as express.Request,
      source: 'server',
      severity: status >= 500 ? 'critical' : 'error',
      statusCode: status,
      errorCode: code,
      message: error instanceof Error ? error.message : 'Unexpected server error.',
      stack: error instanceof Error ? error.stack : undefined
    });
  }
  if (knownError) return res.status(status).json({ error: error.message, code });
  console.error('[Sacco API] Unexpected request failure.');
  return res.status(status).json({ error: 'Unexpected server error.', code });
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
    const [member, vehicles, driverAssignments, transactions, payments, loans, saccoTransactions, profileResult] = await Promise.all([
      getPostgresMember(postgresPool, linkedMemberId),
      listPostgresVehiclesByOwner(postgresPool, linkedMemberId),
      listPostgresDriverAssignmentsByOwner(postgresPool, linkedMemberId),
      listPostgresTransactionsByMember(postgresPool, linkedMemberId),
      listPostgresPaymentsByMember(postgresPool, linkedMemberId),
      listPostgresLoansByMember(postgresPool, linkedMemberId),
      listMemberSaccoTransactions(postgresPool, linkedMemberId).catch(() => []),
      postgresPool.query('SELECT email, phone, profile_photo_data FROM users WHERE id = $1 LIMIT 1', [user.id])
    ]);
    if (!member) {
      throw new HttpError(403, 'This member account is not linked to an active SACCO member record.', 'MEMBER_LINK_INVALID');
    }
    return {
      member: toMemberPortalProfile(member),
      profile: {
        fullName: member.name,
        email: String(profileResult.rows[0]?.email || member.email || ''),
        phone: String(profileResult.rows[0]?.phone || member.phoneNumber || ''),
        nationalId: member.idNumber,
        membershipNumber: member.membershipNumber,
        profilePhotoData: profileResult.rows[0]?.profile_photo_data || undefined
      },
      vehicles,
      driverAssignments,
      transactions: transactions.map(toMemberPortalTransaction),
      payments: payments.map(toMemberPortalPayment),
      loans,
      saccoTransactions
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
  const principalLoan = Math.max(Number(member.initialLoanAmount || 0), Number(member.loanBalance || 0));
  const outstandingLoan = Number(member.loanBalance || 0);
  const paidSoFar = Math.max(0, principalLoan - outstandingLoan);
  const syntheticLoans = principalLoan > 0 ? [{
    id: `loan-${member.id}`,
    principalAmount: principalLoan,
    outstandingBalance: outstandingLoan,
    amountPaid: paidSoFar,
    issueDate: member.dateRegistered || new Date().toISOString().slice(0, 10),
    status: outstandingLoan <= 0 ? 'Cleared' : 'Active',
    loanType: 'Development',
    repaymentPeriodMonths: 12,
    repaymentMethod: 'M-Pesa / SACCO collection',
    repayments: transactions
      .filter(tx => Number(tx.loanRepay || 0) > 0)
      .map(tx => ({ id: tx.id, repaymentDate: tx.timestamp.slice(0, 10), amount: Number(tx.loanRepay || 0) }))
  }] : [];
  return {
    member: toMemberPortalProfile(member),
    profile: {
      fullName: member.name,
      email: user.email || member.email || '',
      phone: user.phone || member.phoneNumber || '',
      nationalId: member.idNumber,
      membershipNumber: member.membershipNumber
    },
    vehicles: ownedVehicles,
    driverAssignments: [],
    transactions: transactions
      .filter(transaction => transaction.memberId === linkedMemberId || ownedVehicles.some(vehicle => vehicle.plateNumber === transaction.vehiclePlate))
      .map(toMemberPortalTransaction),
    payments: payments
      .filter(payment => payment.memberId === linkedMemberId || (payment.vehiclePlate && ownedVehicles.some(vehicle => vehicle.plateNumber === payment.vehiclePlate)))
      .map(toMemberPortalPayment),
    loans: syntheticLoans,
    saccoTransactions: localStore.saccoTransactions
      .filter(tx => tx.memberId === linkedMemberId)
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
  };
}

async function validateLedgerRegistration(tx: Transaction): Promise<void> {
  if (!requiresRegisteredMember(tx.category) || tx.reversalOf) return;

  const typedName = tx.memberName?.trim() || '';
  const plate = tx.vehiclePlate?.trim() || '';
  if (!tx.memberId && !typedName && !plate) {
    throw new HttpError(400, 'Enter a registered vehicle plate or member name before posting this transaction.', 'REGISTERED_MEMBER_REQUIRED');
  }

  if (postgresPool) {
    if (plate) {
      const normalizedPlate = plate.replace(/\s+/g, '').toUpperCase();
      const vehicleResult = await postgresPool.query(
        `SELECT id, member_id, plate_number, status, owner_name
         FROM vehicles
         WHERE upper(replace(plate_number, ' ', '')) = $1
         LIMIT 1`,
        [normalizedPlate]
      );
      if (!vehicleResult.rowCount) {
        throw new HttpError(400, `Car/V.REG "${tx.vehiclePlate}" is not registered. Register the vehicle first.`, 'VEHICLE_NOT_REGISTERED');
      }
      const vehicle = vehicleResult.rows[0];
      if (vehicle.status !== 'Active') {
        throw new HttpError(409, `Car/V.REG "${vehicle.plate_number}" is not active.`, 'VEHICLE_NOT_ACTIVE');
      }
      tx.vehiclePlate = vehicle.plate_number;

      const targetMemberId = tx.memberId || (vehicle.member_id ? String(vehicle.member_id) : undefined);
      const memberResult = targetMemberId
        ? await postgresPool.query(
            'SELECT id, full_name, status FROM members WHERE id::text = $1 LIMIT 1',
            [targetMemberId]
          )
        : await postgresPool.query(
            'SELECT id, full_name, status FROM members WHERE lower(trim(full_name)) = lower($1) LIMIT 1',
            [typedName || vehicle.owner_name]
          );
      if (!memberResult.rowCount) {
        if (!vehicle.member_id && (vehicle.owner_name || typedName)) {
          tx.memberId = '';
          tx.memberName = vehicle.owner_name || typedName;
          return;
        }
        throw new HttpError(400, `Member registered for plate "${vehicle.plate_number}" was not found.`, 'MEMBER_NAME_NOT_REGISTERED');
      }
      const member = memberResult.rows[0];
      if (member.status !== 'Active') {
        throw new HttpError(409, `Member "${member.full_name}" is ${String(member.status).toLowerCase()}. Activate the member before recording a collection.`, 'MEMBER_ACTIVATION_REQUIRED');
      }
      if (vehicle.member_id && String(vehicle.member_id) !== String(member.id)) {
        throw new HttpError(400, `Car/V.REG "${vehicle.plate_number}" is not registered under ${member.full_name}.`, 'MEMBER_VEHICLE_MISMATCH');
      }
      tx.memberId = String(member.id);
      tx.memberName = member.full_name;
      return;
    }

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
      throw new HttpError(409, `Member "${member.full_name}" is ${String(member.status).toLowerCase()}. Activate the member before recording a collection.`, 'MEMBER_ACTIVATION_REQUIRED');
    }
    tx.memberId = String(member.id);
    tx.memberName = member.full_name;
    return;
  }

  const [members, vehicles] = await Promise.all([getAllMembers(), getAllVehicles()]);
  if (plate) {
    const normalizedPlate = plate.replace(/\s+/g, '').toUpperCase();
    const vehicle = vehicles.find(item => item.plateNumber.replace(/\s+/g, '').toUpperCase() === normalizedPlate);
    if (!vehicle) {
      throw new HttpError(400, `Car/V.REG "${tx.vehiclePlate}" is not registered. Register the vehicle first.`, 'VEHICLE_NOT_REGISTERED');
    }
    if (vehicle.status !== 'Active') {
      throw new HttpError(409, `Car/V.REG "${vehicle.plateNumber}" is not active.`, 'VEHICLE_NOT_ACTIVE');
    }
    tx.vehiclePlate = vehicle.plateNumber;

    const targetMemberId = tx.memberId || vehicle.ownerId;
    const member = targetMemberId
      ? members.find(item => item.id === targetMemberId)
      : members.find(item => item.name.trim().toLowerCase() === (typedName || vehicle.ownerName || '').toLowerCase());
    if (!member) {
      if (!vehicle.ownerId && (vehicle.ownerName || typedName)) {
        tx.memberId = '';
        tx.memberName = vehicle.ownerName || typedName;
        return;
      }
      throw new HttpError(400, `Member registered for plate "${vehicle.plateNumber}" was not found.`, 'MEMBER_NAME_NOT_REGISTERED');
    }
    if (member.status !== 'Active') {
      throw new HttpError(409, `Member "${member.name}" is ${member.status.toLowerCase()}. Activate the member before recording a collection.`, 'MEMBER_ACTIVATION_REQUIRED');
    }
    if (vehicle.ownerId && vehicle.ownerId !== member.id) {
      throw new HttpError(400, `Car/V.REG "${vehicle.plateNumber}" is not registered under ${member.name}.`, 'MEMBER_VEHICLE_MISMATCH');
    }
    tx.memberId = member.id;
    tx.memberName = member.name;
    return;
  }

  const member = tx.memberId
    ? members.find(item => item.id === tx.memberId)
    : members.find(item => item.name.trim().toLowerCase() === typedName.toLowerCase());
  if (!member) {
    throw new HttpError(400, `Name "${typedName || tx.memberId}" is not registered. Register the member first.`, 'MEMBER_NAME_NOT_REGISTERED');
  }
  if (member.status !== 'Active') {
    throw new HttpError(409, `Member "${member.name}" is ${member.status.toLowerCase()}. Activate the member before recording a collection.`, 'MEMBER_ACTIVATION_REQUIRED');
  }
  tx.memberId = member.id;
  tx.memberName = member.name;
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

async function deliverMemberOtp(phone: string, otp: string): Promise<void> {
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
      purpose: 'member-account-activation'
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

function genericChairmanResetResponse() {
  return {
    message: 'If the submitted details match an active member account, the Chairman or SACCO Administrator will receive the request. Contact them directly to confirm your identity.'
  };
}

function genericChairmanRecoveryResponse() {
  return {
    message: 'If the submitted details match an active Chairman account, the Secretary will receive the recovery request. Contact the Secretary directly to confirm your identity.'
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
      await deliverMemberOtp(String(candidate.rows[0].phone), otp);
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

async function requestChairmanPasswordReset(identifierValue: unknown, requestIp?: string): Promise<{ message: string; created: boolean }> {
  const response = genericChairmanResetResponse();
  const identifier = String(identifierValue || '').trim();
  const phone = normalizedPhone(identifier);
  const email = normalizedEmail(identifier);
  if (!identifier || (!phone && !email.includes('@'))) return { ...response, created: false };

  try {
    if (postgresPool) {
      const candidate = await postgresPool.query(
        `SELECT id FROM users
         WHERE role = 'Member' AND is_active = TRUE AND account_status = 'Active'
           AND (($1 <> '' AND regexp_replace(COALESCE(phone, ''), '\\D', '', 'g') = $1)
             OR ($2 LIKE '%@%' AND lower(COALESCE(email, '')) = $2))
         LIMIT 1`,
        [phone, email]
      );
      if (!candidate.rowCount) return { ...response, created: false };
      const userId = String(candidate.rows[0].id);
      const recent = await postgresPool.query(
        `SELECT COUNT(*)::int AS count FROM password_reset_requests
         WHERE created_at > now() - interval '15 minutes'
           AND (user_id = $1 OR ($2 <> '' AND requested_ip = $2))`,
        [userId, requestIp || '']
      );
      if (Number(recent.rows[0]?.count || 0) >= 3) return { ...response, created: false };
      const inserted = await postgresPool.query(
        `INSERT INTO password_reset_requests (user_id, requested_ip)
         VALUES ($1, NULLIF($2, ''))
         ON CONFLICT DO NOTHING
         RETURNING id`,
        [userId, requestIp || '']
      );
      return { ...response, created: Boolean(inserted.rowCount) };
    }

    const user = localStore.users.find(item => item.role === 'Member' && item.isActive !== false && item.accountStatus === 'Active' && (
      (phone && normalizedPhone(item.phone) === phone) || (email.includes('@') && normalizedEmail(item.email) === email)
    ));
    if (user && !localPasswordResetRequests.some(request => request.userId === user.id && request.status === 'Pending')) {
      localPasswordResetRequests.unshift({ id: crypto.randomUUID(), userId: user.id, status: 'Pending', createdAt: new Date().toISOString() });
      return { ...response, created: true };
    }
  } catch {
    // Keep this public response identical whether or not a member exists.
  }
  return { ...response, created: false };
}

/**
 * A narrow break-glass path: the public response is privacy-safe, only an
 * active Chairman can create the request, and only a Secretary can resolve it.
 */
async function requestChairmanAccountRecovery(identifierValue: unknown, requestIp?: string): Promise<{ message: string; created: boolean }> {
  const response = genericChairmanRecoveryResponse();
  const identifier = String(identifierValue || '').trim();
  const phone = normalizedPhone(identifier);
  const email = normalizedEmail(identifier);
  if (!identifier || (!phone && !email.includes('@'))) return { ...response, created: false };

  try {
    if (postgresPool) {
      const candidate = await postgresPool.query(
        `SELECT id FROM users
         WHERE role = 'Chairman' AND is_active = TRUE AND account_status = 'Active'
           AND (($1 <> '' AND regexp_replace(COALESCE(phone, ''), '\\D', '', 'g') = $1)
             OR ($2 LIKE '%@%' AND lower(COALESCE(email, '')) = $2))
         LIMIT 1`,
        [phone, email]
      );
      if (!candidate.rowCount) return { ...response, created: false };
      const userId = String(candidate.rows[0].id);
      const recent = await postgresPool.query(
        `SELECT COUNT(*)::int AS count FROM chairman_recovery_requests
         WHERE created_at > now() - interval '15 minutes'
           AND (user_id = $1 OR ($2 <> '' AND requested_ip = $2))`,
        [userId, requestIp || '']
      );
      if (Number(recent.rows[0]?.count || 0) >= 3) return { ...response, created: false };
      const inserted = await postgresPool.query(
        `INSERT INTO chairman_recovery_requests (user_id, requested_ip)
         VALUES ($1, NULLIF($2, ''))
         ON CONFLICT DO NOTHING
         RETURNING id`,
        [userId, requestIp || '']
      );
      return { ...response, created: Boolean(inserted.rowCount) };
    }

    const user = localStore.users.find(item => item.role === 'Chairman' && item.isActive !== false && item.accountStatus === 'Active' && (
      (phone && normalizedPhone(item.phone) === phone) || (email.includes('@') && normalizedEmail(item.email) === email)
    ));
    const cutoff = Date.now() - 15 * 60_000;
    const recent = user ? localChairmanRecoveryRequests.filter(request => new Date(request.createdAt).getTime() > cutoff && (
      request.userId === user.id || (Boolean(requestIp) && request.requestedIp === requestIp)
    )).length : 0;
    if (user && recent < 3 && !localChairmanRecoveryRequests.some(request => request.userId === user.id && request.status === 'Pending')) {
      localChairmanRecoveryRequests.unshift({ id: crypto.randomUUID(), userId: user.id, status: 'Pending', requestedIp: requestIp || undefined, createdAt: new Date().toISOString() });
      return { ...response, created: true };
    }
  } catch {
    // Keep this public response identical whether or not a Chairman exists.
  }
  return { ...response, created: false };
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
    if (process.env.SEED_DEMO_DATA === 'true' && localStore.users.length === 0) {
      const chairmanId = 'u-demo-chairman';
      const secretaryId = 'u-demo-secretary';
      const memberId = 'm-demo-grace-042';
      const memberUserId = 'u-demo-grace-042';
      const today = new Date().toISOString().slice(0, 10);

      localStore.users.push(
        {
          id: chairmanId,
          name: 'Samuel Kariuki (Chairman)',
          email: 'chairman@sowetamu.co.ke',
          phone: '0711000001',
          role: 'Chairman',
          isActive: true,
          accountStatus: 'Active',
          devPassword: 'AdminPassword123!'
        },
        {
          id: secretaryId,
          name: 'Demo Secretary',
          email: 'demo@sowetamu.co.ke',
          phone: '0712345678',
          role: 'Secretary',
          isActive: true,
          accountStatus: 'Active',
          devPassword: 'DemoPassword123!'
        },
        {
          id: memberUserId,
          name: 'Grace Wanjiku',
          email: 'grace@example.com',
          phone: '0722112233',
          role: 'Member',
          isActive: true,
          accountStatus: 'Active',
          linkedMemberId: memberId,
          devPassword: 'DemoPassword123!'
        }
      );

      localStore.members.push({
        id: memberId,
        membershipNumber: 'SOW042',
        name: 'Grace Wanjiku',
        idNumber: '29384756',
        phoneNumber: '0722112233',
        email: 'grace@example.com',
        status: 'Active',
        dateRegistered: today,
        vehicleAssigned: 'KDA 123A',
        sharesAmount: 20000,
        savingsAmount: 45000,
        initialLoanAmount: 15000,
        loanBalance: 15000
      });

      localStore.vehicles.push({
        id: 'v-demo-kda123a',
        plateNumber: 'KDA 123A',
        ownerId: memberId,
        ownerName: 'Grace Wanjiku',
        ownerPhone: '0722112233',
        ownerIdNumber: '29384756',
        driverName: 'Peter Njoroge',
        driverPhone: '0733445566',
        route: 'Nairobi - Thika (Route 237)',
        capacity: 14,
        status: 'Active',
        dateRegistered: today
      });
    }
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
  app.use((req, res, next) => {
    const supplied = String(req.headers['x-request-id'] || '');
    const requestId = supplied.match(/^[0-9a-f-]{36}$/i) ? supplied : crypto.randomUUID();
    (req as any).requestId = requestId;
    res.setHeader('X-Request-Id', requestId);
    next();
  });
  // Profile photos are deliberately small and stored only after strict data-URL
  // validation below. Bank callbacks and every other JSON API remain bounded.
  app.use(express.json({ limit: '300kb' }));

  // Run database seeding
  await seedDatabaseIfEmpty();
  const coopStartupConfig = loadCoopIpnConfig();
  assertCoopIpnConfiguration(coopStartupConfig);
  if (isProduction && coopStartupConfig.enabled) {
    const publicUrl = String(process.env.APP_URL || '').trim();
    if (!publicUrl.startsWith('https://')) throw new Error('APP_URL must be HTTPS when Co-op Bank IPN is enabled in production.');
  }
  await resumePendingCoopBankEvents();
  await processMemberInactivity();
  if (options.runBackgroundProcessor !== false) {
    startBackgroundProcessor(processMemberInactivity, 6 * 60 * 60 * 1000);
  }
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
        memberNumber: req.body?.memberNumber,
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
      const identifier = req.body?.identifier ?? req.body?.email;
      const attemptKey = loginAttemptKey(req.ip, identifier);
      const ipAttemptKey = loginIpAttemptKey(req.ip);
      await assertLoginIsAllowed([attemptKey, ipAttemptKey]);
      const user = await authenticatePasswordUser(identifier, String(req.body?.password || ''));
      if (!user || !hasActiveAccount(user) || (isMemberUser(user) && !user.linkedMemberId)) {
        await Promise.all([
          recordFailedLogin(attemptKey, 10),
          recordFailedLogin(ipAttemptKey, 20)
        ]);
        return res.status(401).json({ error: 'Invalid Sacco profile or password.' });
      }
      await clearLoginFailures(attemptKey);
      res.json(await completePasswordAuthentication(user));
    } catch (error: any) {
      if (error?.code === 'LOGIN_RATE_LIMITED') {
        res.setHeader('Retry-After', '900');
      }
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
      res.json({ user: publicUser(user), token: signed.token, expiresAt: signed.expiresAt, tokenType: 'Bearer', authProvider: 'password-totp', passwordChangeRequired: user.mustChangePassword === true });
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

  app.post('/api/auth/password-reset-request', async (req, res) => {
    try {
      const result = await requestChairmanPasswordReset(req.body?.identifier, req.ip);
      if (result.created) {
        await notifyRole('Chairman', {
          category: 'PASSWORD_RESET_REQUEST',
          title: 'Member password reset needs Chairman review',
          message: 'A member has requested a password reset and has been told to contact the SACCO Administrator. Verify their identity and issue a temporary password from Account Access.',
          destination: 'Account Access'
        });
      }
      res.json({ message: result.message });
    } catch (error: any) {
      sendApiError(res, error);
    }
  });

  app.post('/api/auth/chairman-recovery-request', async (req, res) => {
    try {
      const result = await requestChairmanAccountRecovery(req.body?.identifier, req.ip);
      if (result.created) {
        await notifyRole('Secretary', {
          category: 'CHAIRMAN_RECOVERY_REQUEST',
          title: 'Chairman recovery needs Secretary review',
          message: 'A Chairman recovery request is pending. Verify their identity, then issue a temporary recovery password from Chairman Recovery.',
          destination: 'Chairman Recovery'
        });
      }
      res.json({ message: result.message });
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
      if (postgresPool) {
        await postgresPool.query(
          `UPDATE users SET password_hash = crypt($1, gen_salt('bf')), must_change_password = FALSE,
             temporary_password_expires_at = NULL, updated_at = now() WHERE id = $2`,
          [password, user.id]
        );
      } else {
        const localUser = localStore.users.find(item => item.id === user.id);
        if (!localUser) throw new HttpError(404, 'Account was not found.', 'USER_NOT_FOUND');
        localUser.devPassword = password;
        localUser.mustChangePassword = false;
        localUser.temporaryPasswordExpiresAt = undefined;
      }
      await recordAuditLog(req, 'TEMPORARY_PASSWORD_CHANGED', 'users', user.id);
      const updated = { ...user, mustChangePassword: false, temporaryPasswordExpiresAt: undefined };
      res.json({ user: publicUser(updated), ...signJwt(updated), passwordUpdated: true });
    } catch (error: any) {
      sendApiError(res, error);
    }
  });

  app.post('/api/auth/change-password', authenticateSaccoUser, async (req, res) => {
    try {
      const user = requireAuthenticatedUser(req);
      const currentPassword = String(req.body?.currentPassword || '');
      const newPassword = String(req.body?.newPassword || '');
      if (!currentPassword || newPassword.length < 8 || newPassword.length > 128) {
        throw new HttpError(400, 'Enter your current password and a new password containing 8 to 128 characters.', 'ACCOUNT_PASSWORD_INVALID');
      }
      if (currentPassword === newPassword) {
        throw new HttpError(400, 'Choose a password that is different from your current one.', 'ACCOUNT_PASSWORD_REUSED');
      }

      if (postgresPool) {
        const result = await postgresPool.query(
          `UPDATE users SET password_hash = crypt($1, gen_salt('bf')), must_change_password = FALSE,
             temporary_password_expires_at = NULL, updated_at = now()
           WHERE id = $2 AND password_hash = crypt($3, password_hash)`,
          [newPassword, user.id, currentPassword]
        );
        if (!result.rowCount) {
          throw new HttpError(400, 'Your current password is incorrect.', 'ACCOUNT_PASSWORD_INCORRECT');
        }
      } else {
        const localUser = localStore.users.find(item => item.id === user.id);
        if (!localUser) throw new HttpError(404, 'Account was not found.', 'USER_NOT_FOUND');
        if (!localUser.devPassword || localUser.devPassword !== currentPassword) {
          throw new HttpError(400, 'Your current password is incorrect.', 'ACCOUNT_PASSWORD_INCORRECT');
        }
        localUser.devPassword = newPassword;
        localUser.mustChangePassword = false;
        localUser.temporaryPasswordExpiresAt = undefined;
      }

      await recordAuditLog(req, 'ACCOUNT_PASSWORD_CHANGED', 'users', user.id, undefined, { role: user.role });
      res.json({ passwordUpdated: true });
    } catch (error: any) {
      sendApiError(res, error);
    }
  });

  const validateProfilePhotoData = (value: unknown): string | null => {
    if (value == null || value === '') return null;
    if (typeof value !== 'string') throw new HttpError(400, 'Upload a valid PNG, JPEG, or WebP profile photo.', 'PROFILE_PHOTO_INVALID');
    const match = value.match(/^data:image\/(png|jpeg|webp);base64,([A-Za-z0-9+/=]+)$/i);
    if (!match) throw new HttpError(400, 'Upload a valid PNG, JPEG, or WebP profile photo.', 'PROFILE_PHOTO_INVALID');
    const imageBytes = Buffer.from(match[2], 'base64');
    if (!imageBytes.length || imageBytes.length > 180 * 1024) {
      throw new HttpError(400, 'Profile photos must be 180 KB or smaller.', 'PROFILE_PHOTO_TOO_LARGE');
    }
    return value;
  };

  app.patch('/api/member-portal/profile', authenticateSaccoUser, requirePermission('member.portal.read'), async (req, res) => {
    try {
      const user = requireAuthenticatedUser(req);
      const memberId = requireLinkedMember(user);
      if (!postgresPool) throw new HttpError(503, 'Profile changes require the PostgreSQL SACCO database.', 'PROFILE_UPDATE_UNAVAILABLE');
      const email = normalizedEmail(req.body?.email);
      if (!/^\S+@\S+\.\S+$/.test(email)) throw new HttpError(400, 'Enter a valid email address.', 'PROFILE_EMAIL_INVALID');
      const profilePhotoData = validateProfilePhotoData(req.body?.profilePhotoData);
      const client = await postgresPool.connect();
      try {
        await client.query('BEGIN');
        const duplicate = await client.query(
          'SELECT 1 FROM users WHERE lower(email) = $1 AND id <> $2 LIMIT 1',
          [email, user.id]
        );
        if (duplicate.rowCount) throw new HttpError(409, 'That email address is already linked to another SACCO account.', 'PROFILE_EMAIL_EXISTS');
        await client.query(
          `UPDATE users SET email = $1, profile_photo_data = $2, updated_at = now() WHERE id = $3`,
          [email, profilePhotoData, user.id]
        );
        await client.query('UPDATE members SET email = $1, updated_at = now() WHERE id = $2', [email, memberId]);
        await client.query('COMMIT');
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      } finally {
        client.release();
      }
      await recordAuditLog(req, 'MEMBER_PROFILE_UPDATED', 'members', memberId, undefined, {
        emailUpdated: true,
        profilePhotoUpdated: req.body?.profilePhotoData !== undefined
      });
      res.json(await getMemberPortalData({ ...user, email }));
    } catch (error: any) {
      sendApiError(res, error);
    }
  });

  app.post('/api/member-portal/change-password', authenticateSaccoUser, requirePermission('member.portal.read'), async (req, res) => {
    try {
      const user = requireAuthenticatedUser(req);
      const currentPassword = String(req.body?.currentPassword || '');
      const newPassword = String(req.body?.newPassword || '');
      if (!currentPassword || newPassword.length < 8) {
        throw new HttpError(400, 'Enter your current password and a new password of at least 8 characters.', 'PROFILE_PASSWORD_INVALID');
      }
      if (currentPassword === newPassword) throw new HttpError(400, 'Choose a password that is different from your current one.', 'PROFILE_PASSWORD_REUSED');
      if (!postgresPool) throw new HttpError(503, 'Password changes require the PostgreSQL SACCO database.', 'PASSWORD_CHANGE_UNAVAILABLE');
      const result = await postgresPool.query(
        `UPDATE users SET password_hash = crypt($1, gen_salt('bf')), must_change_password = FALSE,
           temporary_password_expires_at = NULL, updated_at = now()
         WHERE id = $2 AND password_hash = crypt($3, password_hash)`,
        [newPassword, user.id, currentPassword]
      );
      if (!result.rowCount) throw new HttpError(400, 'Your current password is incorrect.', 'PROFILE_PASSWORD_INCORRECT');
      await recordAuditLog(req, 'MEMBER_PASSWORD_CHANGED', 'users', user.id);
      res.json({ passwordUpdated: true });
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
    app.post('/api/testing/member-inactivity', authenticateSaccoUser, requirePermission('members.write'), async (req, res) => {
      try {
        if (postgresPool || !allowInMemoryStore) throw new HttpError(404, 'Not found.', 'NOT_FOUND');
        const member = localStore.members.find(item => item.id === String(req.body?.memberId || ''));
        const days = Number(req.body?.days);
        if (!member || !Number.isInteger(days) || days < 0 || days > 3650) {
          throw new HttpError(400, 'Invalid inactivity fixture.', 'INVALID_TEST_FIXTURE');
        }
        member.status = 'Active';
        member.lastDailyCollectionAt = new Date(Date.now() - days * DAY_MS).toISOString();
        await processMemberInactivity();
        res.json(member);
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
  app.use('/api/monthly-closings', authenticateSaccoUser);
  app.use('/api/developer-errors', authenticateSaccoUser);
  app.use('/api/password-reset-requests', authenticateSaccoUser);
  app.use('/api/chairman-recovery-requests', authenticateSaccoUser);
  app.use('/api/notifications', authenticateSaccoUser);
  app.use('/api/historical-manifests', authenticateSaccoUser);

  app.get('/api/developer-errors/access', (req, res) => {
    const user = requireAuthenticatedUser(req);
    res.json({ allowed: canViewDeveloperErrorLog(user.email) });
  });

  app.get('/api/password-reset-requests', requirePermission('users.write'), async (req, res) => {
    try {
      if (requireAuthenticatedUser(req).role !== 'Chairman') {
        throw new HttpError(403, 'Only the Chairman can review password reset requests.', 'PASSWORD_RESET_CHAIRMAN_ONLY');
      }
      if (postgresPool) {
        const result = await postgresPool.query(
          `SELECT r.id, r.user_id, r.status, r.created_at,
                  u.full_name, u.email, u.phone, m.member_number
           FROM password_reset_requests r
           JOIN users u ON u.id = r.user_id
           LEFT JOIN members m ON m.id = u.linked_member_id
           WHERE r.status = 'Pending'
           ORDER BY r.created_at ASC`
        );
        return res.json(result.rows);
      }
      const users = new Map(localStore.users.map(user => [user.id, user]));
      return res.json(localPasswordResetRequests.filter(request => request.status === 'Pending').map(request => {
        const user = users.get(request.userId);
        return {
          id: request.id,
          user_id: request.userId,
          status: request.status,
          created_at: request.createdAt,
          full_name: user?.name || 'Member',
          email: user?.email || '',
          phone: user?.phone || ''
        };
      }));
    } catch (error: any) {
      return sendApiError(res, error);
    }
  });

  app.get('/api/chairman-recovery-requests', async (req, res) => {
    try {
      if (requireAuthenticatedUser(req).role !== 'Secretary') {
        throw new HttpError(403, 'Only the Secretary can review Chairman recovery requests.', 'CHAIRMAN_RECOVERY_SECRETARY_ONLY');
      }
      if (postgresPool) {
        const result = await postgresPool.query(
          `SELECT r.id, r.user_id, r.status, r.created_at, u.full_name, u.email, u.phone
           FROM chairman_recovery_requests r
           JOIN users u ON u.id = r.user_id
           WHERE r.status = 'Pending' AND u.role = 'Chairman'
           ORDER BY r.created_at ASC`
        );
        return res.json(result.rows);
      }
      const users = new Map(localStore.users.map(user => [user.id, user]));
      return res.json(localChairmanRecoveryRequests
        .filter(request => request.status === 'Pending' && users.get(request.userId)?.role === 'Chairman')
        .map(request => {
          const user = users.get(request.userId);
          return {
            id: request.id,
            user_id: request.userId,
            status: request.status,
            created_at: request.createdAt,
            full_name: user?.name || 'Chairman',
            email: user?.email || '',
            phone: user?.phone || ''
          };
        }));
    } catch (error: any) {
      return sendApiError(res, error);
    }
  });

  app.post('/api/chairman-recovery-requests/:id/approve', async (req, res) => {
    try {
      const secretary = requireAuthenticatedUser(req);
      if (secretary.role !== 'Secretary') {
        throw new HttpError(403, 'Only the Secretary can approve Chairman recovery.', 'CHAIRMAN_RECOVERY_SECRETARY_ONLY');
      }
      const recoveryRequestId = String(req.params.id || '').trim();
      const password = String(req.body?.password || '');
      if (!recoveryRequestId.match(/^[0-9a-f-]{36}$/i)) {
        throw new HttpError(400, 'The Chairman recovery request is invalid.', 'CHAIRMAN_RECOVERY_REQUEST_INVALID');
      }
      if (password.length < 8) {
        throw new HttpError(400, 'Choose a temporary recovery password of at least 8 characters.', 'PASSWORD_INVALID');
      }

      let updated: AuthorizedUser | undefined;
      if (postgresPool) {
        const client = await postgresPool.connect();
        let committed = false;
        try {
          await client.query('BEGIN');
          const request = await client.query(
            `SELECT r.id, r.user_id
             FROM chairman_recovery_requests r
             JOIN users u ON u.id = r.user_id
             WHERE r.id = $1 AND r.status = 'Pending' AND u.role = 'Chairman'
               AND u.is_active = TRUE AND u.account_status = 'Active'
             FOR UPDATE`,
            [recoveryRequestId]
          );
          if (!request.rowCount) {
            throw new HttpError(409, 'This Chairman recovery request is no longer pending.', 'CHAIRMAN_RECOVERY_REQUEST_NOT_PENDING');
          }
          const userId = String(request.rows[0].user_id);
          const result = await client.query(
            `UPDATE users SET password_hash = crypt($1, gen_salt('bf')),
               totp_secret_ciphertext = CASE WHEN $2 THEN NULL ELSE totp_secret_ciphertext END,
               totp_enabled_at = CASE WHEN $2 THEN NULL ELSE totp_enabled_at END,
               must_change_password = TRUE,
               temporary_password_expires_at = now() + interval '24 hours',
               updated_at = now()
             WHERE id = $3 AND role = 'Chairman' AND is_active = TRUE
             RETURNING id, full_name, email, phone, role, is_active, account_status, linked_member_id`,
            [password, process.env.OFFICER_TOTP_REQUIRED !== 'true', userId]
          );
          if (!result.rowCount) throw new HttpError(404, 'Chairman account was not found.', 'CHAIRMAN_RECOVERY_ACCOUNT_NOT_FOUND');
          await client.query(
            `UPDATE chairman_recovery_requests
             SET status = 'Completed', reviewed_at = now(), reviewed_by = $2
             WHERE id = $1`,
            [recoveryRequestId, secretary.id]
          );
          await client.query('COMMIT');
          committed = true;
          updated = mapDbUser(result.rows[0]);
        } catch (error) {
          if (!committed) await client.query('ROLLBACK');
          throw error;
        } finally {
          client.release();
        }
      } else {
        const request = localChairmanRecoveryRequests.find(item => item.id === recoveryRequestId && item.status === 'Pending');
        const chairman = request && localStore.users.find(user => user.id === request.userId && user.role === 'Chairman' && user.isActive !== false && user.accountStatus === 'Active');
        if (!request || !chairman) {
          throw new HttpError(409, 'This Chairman recovery request is no longer pending.', 'CHAIRMAN_RECOVERY_REQUEST_NOT_PENDING');
        }
        chairman.devPassword = password;
        chairman.mustChangePassword = true;
        chairman.temporaryPasswordExpiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
        if (process.env.OFFICER_TOTP_REQUIRED !== 'true') {
          chairman.totpSecret = undefined;
          chairman.totpEnabledAt = undefined;
        }
        request.status = 'Completed';
        request.reviewedAt = new Date().toISOString();
        request.reviewedBy = secretary.id;
        updated = chairman;
      }

      await recordAuditLog(req, 'CHAIRMAN_RECOVERY_APPROVED_BY_SECRETARY', 'users', updated.id, undefined, { recoveryRequestId });
      await notifyUser(updated.id, {
        category: 'CHAIRMAN_RECOVERY_APPROVED',
        title: 'Chairman recovery was approved',
        message: 'The Secretary issued a temporary recovery password. Sign in and immediately create a new private password.',
        destination: 'Dashboard'
      });
      res.json({ recoveryApproved: true });
    } catch (error: any) {
      return sendApiError(res, error);
    }
  });

  app.get('/api/notifications', async (req, res) => {
    try {
      const user = requireAuthenticatedUser(req);
      const limit = Math.min(Math.max(Number(req.query.limit) || 20, 1), 100);
      if (postgresPool) {
        const [items, unread] = await Promise.all([
          postgresPool.query(
            `SELECT id, category, title, message, destination, created_at, read_at
             FROM app_notifications WHERE recipient_user_id = $1
             ORDER BY created_at DESC LIMIT $2`,
            [user.id, limit]
          ),
          postgresPool.query('SELECT COUNT(*)::int AS count FROM app_notifications WHERE recipient_user_id = $1 AND read_at IS NULL', [user.id])
        ]);
        return res.json({ items: items.rows, unreadCount: Number(unread.rows[0]?.count || 0) });
      }
      const items = localAppNotifications.filter(item => item.recipientUserId === user.id).slice(0, limit).map(item => ({
        id: item.id, category: item.category, title: item.title, message: item.message, destination: item.destination,
        created_at: item.createdAt, read_at: item.readAt
      }));
      return res.json({ items, unreadCount: localAppNotifications.filter(item => item.recipientUserId === user.id && !item.readAt).length });
    } catch (error: any) {
      return sendApiError(res, error);
    }
  });

  app.get('/api/notifications/stream', (req, res) => {
    const user = requireAuthenticatedUser(req);
    res.status(200);
    res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders();
    res.write('event: connected\ndata: {}\n\n');
    const streams = liveNotificationStreams.get(user.id) || new Set<express.Response>();
    streams.add(res);
    liveNotificationStreams.set(user.id, streams);
    const keepalive = setInterval(() => {
      try { res.write(': keepalive\n\n'); } catch { /* close handler removes the stream */ }
    }, 25_000);
    req.on('close', () => {
      clearInterval(keepalive);
      streams.delete(res);
      if (!streams.size) liveNotificationStreams.delete(user.id);
    });
  });

  // This heartbeat is sent only while an authenticated browser is actively
  // using the live notification stream. It gives a free Render service normal
  // inbound activity during an active session; it is not an external uptime ping.
  app.post('/api/notifications/heartbeat', (req, res) => {
    requireAuthenticatedUser(req);
    res.json({ active: true });
  });

  app.post('/api/notifications/read-all', async (req, res) => {
    try {
      const user = requireAuthenticatedUser(req);
      if (postgresPool) {
        await postgresPool.query('UPDATE app_notifications SET read_at = now() WHERE recipient_user_id = $1 AND read_at IS NULL', [user.id]);
      } else {
        localAppNotifications.filter(item => item.recipientUserId === user.id && !item.readAt).forEach(item => { item.readAt = new Date().toISOString(); });
      }
      res.json({ updated: true });
    } catch (error: any) {
      sendApiError(res, error);
    }
  });

  app.post('/api/notifications/:id/read', async (req, res) => {
    try {
      const user = requireAuthenticatedUser(req);
      const notificationId = String(req.params.id || '');
      if (!notificationId.match(/^[0-9a-f-]{36}$/i)) throw new HttpError(404, 'Notification was not found.', 'NOTIFICATION_NOT_FOUND');
      if (postgresPool) {
        const updated = await postgresPool.query(
          `UPDATE app_notifications SET read_at = COALESCE(read_at, now())
           WHERE id = $1 AND recipient_user_id = $2 RETURNING id`,
          [notificationId, user.id]
        );
        if (!updated.rowCount) throw new HttpError(404, 'Notification was not found.', 'NOTIFICATION_NOT_FOUND');
      } else {
        const item = localAppNotifications.find(notification => notification.id === notificationId && notification.recipientUserId === user.id);
        if (!item) throw new HttpError(404, 'Notification was not found.', 'NOTIFICATION_NOT_FOUND');
        item.readAt ||= new Date().toISOString();
      }
      res.json({ updated: true });
    } catch (error: any) {
      sendApiError(res, error);
    }
  });

  app.post('/api/developer-errors/client', async (req, res) => {
    try {
      const user = requireAuthenticatedUser(req);
      if (!allowClientErrorReport(user.id)) {
        throw new HttpError(429, 'Too many client error reports. Try again later.', 'CLIENT_ERROR_REPORT_RATE_LIMITED');
      }
      const message = String(req.body?.message || '').trim();
      if (message.length < 3) throw new HttpError(400, 'A client error message is required.', 'CLIENT_ERROR_MESSAGE_REQUIRED');
      await recordApplicationError({
        req,
        source: 'client',
        severity: 'error',
        errorCode: 'CLIENT_RUNTIME_ERROR',
        message,
        stack: req.body?.stack,
        context: {
          component: String(req.body?.component || '').slice(0, 300),
          page: safeErrorPath(req.body?.page),
          browser: String(req.body?.browser || '').slice(0, 300)
        },
        actorUserId: user.id
      });
      res.status(202).json({ recorded: true, requestId: (req as any).requestId });
    } catch (error: any) {
      sendApiError(res, error);
    }
  });

  app.get('/api/developer-errors', async (req, res) => {
    try {
      requireDeveloperErrorLogAccess(req);
      const limit = Math.min(Math.max(Number(req.query.limit) || 100, 1), 200);
      const openOnly = String(req.query.status || 'open') !== 'all';
      if (postgresPool) {
        const result = await postgresPool.query(
          `SELECT e.*, resolver.full_name AS resolved_by_name
           FROM application_error_logs e
           LEFT JOIN users resolver ON resolver.id = e.resolved_by
           WHERE ($1::boolean = FALSE OR e.resolved_at IS NULL)
           ORDER BY e.occurred_at DESC
           LIMIT $2`,
          [openOnly, limit]
        );
        return res.json(result.rows);
      }
      const rows = localApplicationErrorLogs.filter(entry => !openOnly || !entry.resolved_at).slice(0, limit);
      return res.json(rows);
    } catch (error: any) {
      return sendApiError(res, error);
    }
  });

  app.patch('/api/developer-errors/:id', async (req, res) => {
    try {
      const user = requireDeveloperErrorLogAccess(req);
      const id = String(req.params.id || '');
      if (!id.match(/^[0-9a-f-]{36}$/i)) throw new HttpError(404, 'Diagnostic entry was not found.', 'ERROR_LOG_NOT_FOUND');
      const resolved = req.body?.resolved !== false;
      const note = redactErrorText(req.body?.resolutionNote, 1_000);
      if (postgresPool) {
        const result = await postgresPool.query(
          `UPDATE application_error_logs
           SET resolved_at = CASE WHEN $2 THEN now() ELSE NULL END,
               resolved_by = CASE WHEN $2 THEN $3 ELSE NULL END,
               resolution_note = CASE WHEN $2 THEN NULLIF($4, '') ELSE NULL END
           WHERE id = $1
           RETURNING *`,
          [id, resolved, user.id, note]
        );
        if (!result.rowCount) throw new HttpError(404, 'Diagnostic entry was not found.', 'ERROR_LOG_NOT_FOUND');
        await recordAuditLog(req, resolved ? 'DEVELOPER_ERROR_RESOLVED' : 'DEVELOPER_ERROR_REOPENED', 'application_error_logs', id, undefined, { resolutionNote: note || null });
        return res.json(result.rows[0]);
      }
      const local = localApplicationErrorLogs.find(entry => entry.id === id);
      if (!local) throw new HttpError(404, 'Diagnostic entry was not found.', 'ERROR_LOG_NOT_FOUND');
      local.resolved_at = resolved ? new Date().toISOString() : undefined;
      local.resolved_by = resolved ? user.id : undefined;
      local.resolution_note = resolved ? note || undefined : undefined;
      return res.json(local);
    } catch (error: any) {
      return sendApiError(res, error);
    }
  });

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
      if (requireAuthenticatedUser(req).role !== 'Chairman') {
        throw new HttpError(403, 'Only the Chairman can issue a temporary password.', 'PASSWORD_RESET_CHAIRMAN_ONLY');
      }
      const password = String(req.body?.password || '');
      if (password.length < 8) throw new HttpError(400, 'Choose a temporary password of at least 8 characters.', 'PASSWORD_INVALID');
      const resetRequestId = String(req.body?.resetRequestId || '').trim();
      if (resetRequestId && !resetRequestId.match(/^[0-9a-f-]{36}$/i)) {
        throw new HttpError(400, 'The password reset request is invalid.', 'PASSWORD_RESET_REQUEST_INVALID');
      }
      let updated: AuthorizedUser | undefined;
      if (postgresPool) {
        if (!req.params.id.match(/^[0-9a-f-]{36}$/i)) throw new HttpError(404, 'Account was not found.', 'USER_NOT_FOUND');
        const client = await postgresPool.connect();
        let committed = false;
        try {
          await client.query('BEGIN');
          if (resetRequestId) {
            const request = await client.query(
              `SELECT id FROM password_reset_requests
               WHERE id = $1 AND user_id = $2 AND status = 'Pending'
               FOR UPDATE`,
              [resetRequestId, req.params.id]
            );
            if (!request.rowCount) throw new HttpError(409, 'This password reset request is no longer pending.', 'PASSWORD_RESET_REQUEST_NOT_PENDING');
          }
          const result = await client.query(
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
          if (resetRequestId) {
            await client.query(
              `UPDATE password_reset_requests
               SET status = 'Completed', reviewed_at = now(), reviewed_by = $2
               WHERE id = $1`,
              [resetRequestId, requireAuthenticatedUser(req).id]
            );
          }
          await client.query('COMMIT');
          committed = true;
          updated = mapDbUser(result.rows[0]);
        } catch (error) {
          if (!committed) await client.query('ROLLBACK');
          throw error;
        } finally {
          client.release();
        }
      } else {
        const user = localStore.users.find(item => item.id === req.params.id);
        if (!user) throw new HttpError(404, 'Account was not found.', 'USER_NOT_FOUND');
        const request = resetRequestId ? localPasswordResetRequests.find(item => item.id === resetRequestId && item.userId === user.id && item.status === 'Pending') : undefined;
        if (resetRequestId && !request) throw new HttpError(409, 'This password reset request is no longer pending.', 'PASSWORD_RESET_REQUEST_NOT_PENDING');
        user.devPassword = password;
        user.mustChangePassword = true;
        user.temporaryPasswordExpiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
        if (request) {
          request.status = 'Completed';
          request.reviewedAt = new Date().toISOString();
          request.reviewedBy = requireAuthenticatedUser(req).id;
        }
        updated = user;
      }
      await recordAuditLog(req, resetRequestId ? 'MEMBER_PASSWORD_RESET_REQUEST_APPROVED' : 'ACCOUNT_PASSWORD_RESET_BY_CHAIRMAN', 'users', updated.id, undefined, { role: updated.role, resetRequestId: resetRequestId || null });
      if (resetRequestId) {
        await notifyUser(updated.id, {
          category: 'PASSWORD_RESET_APPROVED',
          title: 'Your password reset was approved',
          message: 'The Chairman has issued a temporary password. Sign in and immediately create your own private password.',
          destination: 'My Account'
        });
      }
      res.json({ passwordUpdated: true });
    } catch (error: any) {
      sendApiError(res, error);
    }
  });

  // Officer deletion is separate from member removal. Only another officer
  // can be removed here; Chairman and Member profiles remain protected.
  app.delete('/api/users/:id', requirePermission('users.write'), async (req, res) => {
    try {
      const chairman = requireAuthenticatedUser(req);
      if (chairman.role !== 'Chairman') {
        throw new HttpError(403, 'Only the Chairman can delete an officer account.', 'OFFICER_DELETE_CHAIRMAN_ONLY');
      }

      const targetId = String(req.params.id || '').trim();
      const deletableOfficerRoles: readonly UserRole[] = ['Secretary', 'Treasurer', 'Accountant', 'Auditor'];
      let deleted: AuthorizedUser;

      if (postgresPool) {
        if (!targetId.match(/^[0-9a-f-]{36}$/i)) {
          throw new HttpError(404, 'Officer account was not found.', 'OFFICER_NOT_FOUND');
        }
        const existing = await postgresPool.query(
          `SELECT id, full_name, email, phone, role, is_active, account_status, linked_member_id
           FROM users WHERE id = $1`,
          [targetId]
        );
        if (!existing.rowCount) throw new HttpError(404, 'Officer account was not found.', 'OFFICER_NOT_FOUND');
        const target = mapDbUser(existing.rows[0]);
        if (!deletableOfficerRoles.includes(target.role)) {
          throw new HttpError(
            409,
            target.role === 'Chairman'
              ? 'The Chairman account cannot be deleted from officer account management.'
              : 'Member accounts must be removed from the Members page.',
            'OFFICER_DELETE_ROLE_PROTECTED'
          );
        }
        const result = await postgresPool.query(
          `DELETE FROM users
           WHERE id = $1 AND role = ANY($2::user_role[])
           RETURNING id, full_name, email, phone, role, is_active, account_status, linked_member_id`,
          [targetId, deletableOfficerRoles]
        );
        if (!result.rowCount) throw new HttpError(409, 'The officer account could not be deleted.', 'OFFICER_DELETE_CONFLICT');
        deleted = mapDbUser(result.rows[0]);
      } else {
        const targetIndex = localStore.users.findIndex(user => user.id === targetId);
        if (targetIndex < 0) throw new HttpError(404, 'Officer account was not found.', 'OFFICER_NOT_FOUND');
        const target = localStore.users[targetIndex];
        if (!deletableOfficerRoles.includes(target.role)) {
          throw new HttpError(
            409,
            target.role === 'Chairman'
              ? 'The Chairman account cannot be deleted from officer account management.'
              : 'Member accounts must be removed from the Members page.',
            'OFFICER_DELETE_ROLE_PROTECTED'
          );
        }
        deleted = { ...target };
        localStore.users.splice(targetIndex, 1);
        localStore.mfaChallenges.splice(
          0,
          localStore.mfaChallenges.length,
          ...localStore.mfaChallenges.filter(challenge => challenge.userId !== targetId)
        );
      }

      const openStreams = liveNotificationStreams.get(targetId);
      openStreams?.forEach(stream => stream.end());
      liveNotificationStreams.delete(targetId);
      await recordAuditLog(req, 'OFFICER_ACCOUNT_DELETED', 'users', targetId, {
        name: deleted.name,
        email: deleted.email,
        role: deleted.role
      }, {
        deleted: true,
        role: deleted.role
      });
      return res.json({ deleted: true, userId: targetId, role: deleted.role });
    } catch (error: any) {
      return sendApiError(res, error);
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
        `SELECT l.*, m.full_name AS member_name, m.member_number, m.status AS member_status,
           secretary_user.full_name AS secretary_reviewed_by_name,
           treasurer_user.full_name AS treasurer_reviewed_by_name,
           chairman_user.full_name AS approved_by_name,
           COALESCE(fin.savings, 0) AS member_savings,
           CURRENT_DATE - COALESCE(m.date_registered, CURRENT_DATE) AS membership_days,
           COALESCE(repayments.amount_paid, 0) AS amount_paid,
           l.principal_amount * (1 + l.interest_rate / 100) AS total_payable,
           GREATEST(0, l.principal_amount * (1 + l.interest_rate / 100) - COALESCE(repayments.amount_paid, 0)) AS outstanding_balance
         FROM loans l JOIN members m ON m.id = l.member_id
         LEFT JOIN users secretary_user ON secretary_user.id = l.secretary_reviewed_by
         LEFT JOIN users treasurer_user ON treasurer_user.id = l.treasurer_reviewed_by
         LEFT JOIN users chairman_user ON chairman_user.id = l.approved_by
         LEFT JOIN LATERAL (
           SELECT SUM(CASE WHEN le.account_type IN ('Savings','DailyContribution') AND le.transaction_type = 'Credit' THEN
             CASE WHEN le.account_type = 'Savings' THEN le.amount ELSE COALESCE((le.metadata->>'savingsContribution')::numeric, le.amount * .70) END ELSE 0 END) AS savings
           FROM ledger_entries le WHERE le.member_id = m.id AND le.status = 'Posted'
         ) fin ON TRUE
         LEFT JOIN LATERAL (
           SELECT SUM(amount) AS amount_paid FROM loan_repayments WHERE loan_id = l.id
         ) repayments ON TRUE
         ORDER BY l.created_at DESC`
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
      if (!isMemberUser(user) && user.role !== 'Chairman') throw new HttpError(403, 'Only a member or the Chairman can submit a loan application.', 'LOAN_APPLICATION_ACCESS_DENIED');
      const principal = Number(req.body?.principalAmount);
      const loanType = String(req.body?.loanType || 'General').trim();
      const repaymentPeriodMonths = Number(req.body?.repaymentPeriodMonths);
      const repaymentMethod = String(req.body?.repaymentMethod || '').trim();
      const incomeSource = String(req.body?.incomeSource || '').trim().slice(0, 250) || null;
      const monthlyIncomeValue = req.body?.monthlyIncome;
      const monthlyIncome = monthlyIncomeValue === '' || monthlyIncomeValue == null ? null : Number(monthlyIncomeValue);
      const guarantorDetails = String(req.body?.guarantorDetails || '').trim().slice(0, 1000) || null;
      const collateralDetails = String(req.body?.collateralDetails || '').trim().slice(0, 1000) || null;
      const notes = String(req.body?.notes || '').trim().slice(0, 1000) || null;
      if (!memberId.match(/^[0-9a-f-]{36}$/i) || !Number.isFinite(principal) || principal <= 0 ||
        !LOAN_TYPES.has(loanType) || !Number.isInteger(repaymentPeriodMonths) || repaymentPeriodMonths < 1 || repaymentPeriodMonths > 84 ||
        !REPAYMENT_METHODS.has(repaymentMethod) || (monthlyIncome !== null && (!Number.isFinite(monthlyIncome) || monthlyIncome < 0))) {
        throw new HttpError(400, 'Complete the loan type, amount, repayment period, repayment method, and valid optional income details.', 'LOAN_INPUT_INVALID');
      }
      if (!postgresPool) throw new HttpError(503, 'Loan records require PostgreSQL.', 'LOANS_UNAVAILABLE');
      const policy = await postgresPool.query('SELECT * FROM loan_policy WHERE id = TRUE');
      const interestRate = Number(policy.rows[0]?.default_interest_rate || 0);
      if (policy.rows[0]?.maximum_principal && principal > Number(policy.rows[0].maximum_principal)) throw new HttpError(400, 'The requested amount exceeds the Chairman’s loan limit.', 'LOAN_ABOVE_POLICY_LIMIT');
      const existing = await postgresPool.query(`SELECT 1 FROM loans WHERE member_id=$1 AND status IN ('Applied','SecretaryReview','TreasurerReview','ChairmanReview','Approved','Active','Defaulted') LIMIT 1`, [memberId]);
      if (existing.rowCount) throw new HttpError(409, 'This member already has a pending or active loan.', 'LOAN_ALREADY_OPEN');
      const memberResult = await postgresPool.query(
        `SELECT full_name, member_number, national_id, phone, email
         FROM members WHERE id = $1 AND status = 'Active' LIMIT 1`,
        [memberId]
      );
      if (!memberResult.rowCount) throw new HttpError(404, 'Active member was not found.', 'MEMBER_NOT_FOUND');
      const member = memberResult.rows[0];
      const applicationSnapshot = {
        fullName: member.full_name,
        membershipNumber: member.member_number || null,
        nationalId: member.national_id || null,
        phone: member.phone || null,
        email: member.email || user.email || null
      };
      const result = await postgresPool.query(
        `INSERT INTO loans (
           member_id, principal_amount, interest_rate, application_date, issue_date, due_date, status, notes,
           loan_type, repayment_period_months, repayment_method, income_source, monthly_income, guarantor_details, collateral_details, application_snapshot
         ) VALUES ($1, $2, $3, CURRENT_DATE, CURRENT_DATE, NULL, 'SecretaryReview', $4, $5, $6, $7, $8, $9, $10, $11, $12::jsonb)
         RETURNING id, member_id, principal_amount, interest_rate, application_date, due_date, status, notes,
                   loan_type, repayment_period_months, repayment_method, income_source, monthly_income, guarantor_details, collateral_details`,
        [memberId, principal, interestRate, notes, loanType, repaymentPeriodMonths, repaymentMethod, incomeSource, monthlyIncome, guarantorDetails, collateralDetails, JSON.stringify(applicationSnapshot)]
      );
      await recordAuditLog(req, 'LOAN_APPLICATION_CREATED', 'loans', String(result.rows[0].id), undefined, result.rows[0]);
      await notifyRole('Secretary', {
        category: 'LOAN_SECRETARY_REVIEW',
        title: 'New loan application needs review',
        message: 'A member loan application is waiting for Secretary eligibility review.',
        destination: 'Loans'
      });
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
      const rejectionReason = eligible ? null : requiredRejectionReason(req.body?.reason ?? notes);
      const status = eligible ? 'TreasurerReview' : 'Rejected';
      const result = await postgresPool.query(
        `UPDATE loans SET status=$1, secretary_reviewed_by=$2, secretary_reviewed_at=now(), secretary_eligible=$3,
          secretary_notes=$4, rejection_reason=CASE WHEN $3 THEN NULL ELSE $5 END,
          rejected_by=CASE WHEN $3 THEN NULL ELSE $2 END, rejected_at=CASE WHEN $3 THEN NULL ELSE now() END, updated_at=now()
         WHERE id=$6 AND status='SecretaryReview' RETURNING *`, [status, user.id, eligible, notes, rejectionReason, req.params.id]
      );
      if (!result.rowCount) throw new HttpError(409, 'This loan is not awaiting Secretary review.', 'LOAN_STAGE_MISMATCH');
      await recordAuditLog(req, eligible ? 'LOAN_SECRETARY_APPROVED' : 'LOAN_SECRETARY_REJECTED', 'loans', req.params.id, undefined, result.rows[0]);
      if (eligible) {
        await notifyRole('Treasurer', {
          category: 'LOAN_TREASURER_REVIEW',
          title: 'Loan application needs financial review',
          message: 'A loan application has passed Secretary eligibility review and is ready for Treasurer review.',
          destination: 'Loans'
        });
      } else {
        await notifyMember(String(result.rows[0].member_id), {
          category: 'LOAN_REJECTED',
          title: 'Loan request was rejected',
          message: `Your loan request was rejected. Reason: ${rejectionReason}`,
          destination: 'My Account'
        });
      }
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
      const rejectionReason = approved ? null : requiredRejectionReason(req.body?.reason ?? notes);
      const result = await postgresPool.query(
        `UPDATE loans SET status=$1, treasurer_reviewed_by=$2, treasurer_reviewed_at=now(), treasurer_notes=$3,
          rejection_reason=CASE WHEN $4 THEN NULL ELSE $5 END, rejected_by=CASE WHEN $4 THEN NULL ELSE $2 END,
          rejected_at=CASE WHEN $4 THEN NULL ELSE now() END, updated_at=now()
         WHERE id=$6 AND status='TreasurerReview' RETURNING *`,
        [approved ? 'ChairmanReview' : 'Rejected', user.id, notes, approved, rejectionReason, req.params.id]
      );
      if (!result.rowCount) throw new HttpError(409, 'This loan is not awaiting Treasurer review.', 'LOAN_STAGE_MISMATCH');
      await recordAuditLog(req, approved ? 'LOAN_TREASURER_APPROVED' : 'LOAN_TREASURER_REJECTED', 'loans', req.params.id, undefined, result.rows[0]);
      if (approved) {
        await notifyRole('Chairman', {
          category: 'LOAN_CHAIRMAN_REVIEW',
          title: 'Loan application needs final decision',
          message: 'A loan application has passed financial review and is waiting for the Chairman’s final decision.',
          destination: 'Loans'
        });
      } else {
        await notifyMember(String(result.rows[0].member_id), {
          category: 'LOAN_REJECTED',
          title: 'Loan request was rejected',
          message: `Your loan request was rejected. Reason: ${rejectionReason}`,
          destination: 'My Account'
        });
      }
      res.json(result.rows[0]);
    } catch (error: any) { sendApiError(res, error); }
  });

  app.post('/api/loans/:id/approve', requirePermission('loans.approve'), async (req, res) => {
    try {
      if (!postgresPool) throw new HttpError(503, 'Loan records require PostgreSQL.', 'LOANS_UNAVAILABLE');
      const user = requireAuthenticatedUser(req);
      const result = await postgresPool.query(
        `UPDATE loans SET status = 'Active', approved_by = $1, approved_at = now(),
           disbursed_at = now(), issue_date = CURRENT_DATE,
           due_date = (CURRENT_DATE + (repayment_period_months * INTERVAL '1 month'))::date, updated_at = now()
         WHERE id = $2 AND status = 'ChairmanReview'
         RETURNING id, member_id, principal_amount, interest_rate, issue_date, due_date, repayment_period_months, status`,
        [user.id, req.params.id]
      );
      if (!result.rowCount) throw new HttpError(409, 'Only an applied loan can be approved.', 'LOAN_NOT_APPROVABLE');
      await recordAuditLog(req, 'LOAN_APPROVED_AND_DISBURSED', 'loans', String(result.rows[0].id), undefined, result.rows[0]);
      await notifyMember(String(result.rows[0].member_id), {
        category: 'LOAN_APPROVED',
        title: 'Your loan was approved',
        message: `Your loan has been approved. The repayment due date is ${String(result.rows[0].due_date).slice(0, 10)}.`,
        destination: 'My Account'
      });
      res.json(result.rows[0]);
    } catch (error: any) { sendApiError(res, error); }
  });

  app.post('/api/loans/:id/reject', requirePermission('loans.approve'), async (req, res) => {
    try {
      if (!postgresPool) throw new HttpError(503, 'Loan records require PostgreSQL.', 'LOANS_UNAVAILABLE');
      const user = requireAuthenticatedUser(req);
      const reason = requiredRejectionReason(req.body?.reason);
      const result = await postgresPool.query(
        `UPDATE loans SET status = 'Rejected', rejected_at = now(), rejected_by = $1, rejection_reason = $2,
           notes = concat_ws(E'\n', notes, $2), updated_at = now()
         WHERE id = $3 AND status = 'ChairmanReview' RETURNING id, member_id, status, rejection_reason`,
        [user.id, reason, req.params.id]
      );
      if (!result.rowCount) throw new HttpError(409, 'Only an applied loan can be rejected.', 'LOAN_NOT_REJECTABLE');
      await recordAuditLog(req, 'LOAN_REJECTED', 'loans', String(result.rows[0].id), undefined, result.rows[0]);
      await notifyMember(String(result.rows[0].member_id), {
        category: 'LOAN_REJECTED',
        title: 'Loan request was rejected',
        message: `Your loan request was rejected. Reason: ${reason}`,
        destination: 'My Account'
      });
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

  app.get('/api/monthly-closings', requirePermission('reports.read.all'), async (_req, res) => {
    try {
      if (!postgresPool) throw new HttpError(503, 'Month-end closing requires PostgreSQL.', 'MONTHLY_CLOSING_UNAVAILABLE');
      const result = await postgresPool.query(
        `SELECT c.*, u.full_name AS closed_by_name,
           COALESCE(json_agg(json_build_object('accountType', l.account_type, 'totalCredit', l.total_credit, 'totalDebit', l.total_debit, 'netAmount', l.net_amount)
             ORDER BY l.account_type) FILTER (WHERE l.id IS NOT NULL), '[]'::json) AS lines
         FROM monthly_closings c
         LEFT JOIN users u ON u.id = c.closed_by
         LEFT JOIN monthly_closing_lines l ON l.monthly_closing_id = c.id
         GROUP BY c.id, u.full_name
         ORDER BY c.closing_month DESC`
      );
      res.json(result.rows);
    } catch (error: any) { sendApiError(res, error); }
  });

  app.post('/api/monthly-closings', requirePermission('loans.approve'), async (req, res) => {
    const client = postgresPool ? await postgresPool.connect() : null;
    try {
      const user = requireAuthenticatedUser(req);
      if (user.role !== 'Chairman') throw new HttpError(403, 'Only the Chairman can close an accounting month.', 'MONTHLY_CLOSING_ACCESS_DENIED');
      if (!client) throw new HttpError(503, 'Month-end closing requires PostgreSQL.', 'MONTHLY_CLOSING_UNAVAILABLE');
      const closingMonth = String(req.body?.closingMonth || '').trim();
      const notes = String(req.body?.notes || '').trim().slice(0, 1000) || null;
      if (!/^\d{4}-\d{2}$/.test(closingMonth)) throw new HttpError(400, 'Choose the month to close in YYYY-MM format.', 'MONTHLY_CLOSING_MONTH_INVALID');
      const monthStart = `${closingMonth}-01`;
      if (new Date(`${monthStart}T00:00:00Z`).getTime() >= new Date(new Date().getFullYear(), new Date().getMonth(), 1).getTime()) {
        throw new HttpError(400, 'Only a completed past month can be closed.', 'MONTHLY_CLOSING_MONTH_OPEN');
      }
      await client.query('BEGIN');
      const totals = await client.query(
        `SELECT
           COALESCE(SUM(CASE WHEN transaction_type = 'Credit' THEN amount ELSE 0 END), 0) AS total_credit,
           COALESCE(SUM(CASE WHEN transaction_type = 'Debit' THEN amount ELSE 0 END), 0) AS total_debit,
           COALESCE(SUM(CASE WHEN till_type IN ('VehicleTill', 'UtilityTill') AND transaction_type = 'Credit' THEN amount ELSE 0 END), 0) AS mpesa_total,
           COALESCE(SUM(CASE WHEN till_type = 'None' AND transaction_type = 'Credit' THEN amount ELSE 0 END), 0) AS cash_total
         FROM ledger_entries
         WHERE entry_date >= $1::date AND entry_date < ($1::date + INTERVAL '1 month') AND status = 'Posted'`,
        [monthStart]
      );
      const total = totals.rows[0];
      const created = await client.query(
        `INSERT INTO monthly_closings (closing_month, total_credit, total_debit, net_balance, mpesa_total, cash_total, closed_by, notes)
         VALUES ($1::date, $2, $3, $2 - $3, $4, $5, $6, $7)
         RETURNING *`,
        [monthStart, total.total_credit, total.total_debit, total.mpesa_total, total.cash_total, user.id, notes]
      );
      await client.query(
        `INSERT INTO monthly_closing_lines (monthly_closing_id, account_type, total_credit, total_debit, net_amount)
         SELECT $1, account_type,
           COALESCE(SUM(CASE WHEN transaction_type = 'Credit' THEN amount ELSE 0 END), 0),
           COALESCE(SUM(CASE WHEN transaction_type = 'Debit' THEN amount ELSE 0 END), 0),
           COALESCE(SUM(CASE WHEN transaction_type = 'Credit' THEN amount ELSE -amount END), 0)
         FROM ledger_entries
         WHERE entry_date >= $2::date AND entry_date < ($2::date + INTERVAL '1 month') AND status = 'Posted'
         GROUP BY account_type`,
        [created.rows[0].id, monthStart]
      );
      await client.query('COMMIT');
      await recordAuditLog(req, 'MONTH_CLOSED', 'monthly_closings', String(created.rows[0].id), undefined, created.rows[0]);
      res.status(201).json(created.rows[0]);
    } catch (error: any) {
      if (client) await client.query('ROLLBACK').catch(() => undefined);
      if ((error as any)?.code === '23505') return sendApiError(res, new HttpError(409, 'This accounting month has already been closed.', 'MONTHLY_CLOSING_EXISTS'));
      sendApiError(res, error);
    } finally { client?.release(); }
  });

  // API 3: Get Sacco Members
  app.get('/api/members', async (req, res) => {
    try {
      await processMemberInactivity();
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
      const creator = requireAuthenticatedUser(req);
      const memberData = req.body;
      if (!memberData.membershipNumber || !memberData.name || !memberData.idNumber) {
        return res.status(400).json({ error: 'Member Number, Name and National ID Number are required.', code: 'MEMBER_NUMBER_REQUIRED' });
      }
      const membershipNumber = sanitizeMemberNumber(memberData.membershipNumber);
      const name = sanitizePersonName(memberData.name).trim();
      const idNumber = sanitizeIntegerInput(memberData.idNumber, 12);
      const phoneNumber = sanitizePhoneNumber(memberData.phoneNumber);
      const email = normalizedEmail(memberData.email);
      const vehicleAssigned = sanitizeVehiclePlate(memberData.vehicleAssigned).trim();
      if (!isValidMemberNumber(membershipNumber) || String(memberData.membershipNumber).trim().toUpperCase() !== membershipNumber) {
        return res.status(400).json({ error: 'Member Number must contain letters and numbers only (maximum 30 characters).', code: 'MEMBER_NUMBER_INVALID' });
      }
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
      if (registeredMembers.some(member => sanitizeMemberNumber(member.membershipNumber) === membershipNumber)) {
        return res.status(409).json({ error: `Member Number ${membershipNumber} is already registered.`, code: 'MEMBER_NUMBER_ALREADY_REGISTERED' });
      }
      if (memberData.id && registeredMembers.some(member => member.id === memberData.id)) {
        return res.status(409).json({ error: 'This member profile already exists.', code: 'MEMBER_ALREADY_REGISTERED' });
      }
      const memberId = memberData.id || 'm-' + Date.now();
      const newMember = {
        id: memberId,
        membershipNumber,
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
        loanBalance: Math.max(0, Number(memberData.loanBalance) || 0),
        createdByUserId: creator.id,
        lastDailyCollectionAt: new Date().toISOString()
      };

      if (postgresPool) {
        const created = await createPostgresMember(postgresPool, newMember, creator.id);
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
      if (error?.code === '23505' && String(error?.constraint || '').includes('member_number')) {
        return sendApiError(res, new HttpError(409, 'That Member Number is already registered. Enter a different unique number.', 'MEMBER_NUMBER_ALREADY_REGISTERED'));
      }
      sendApiError(res, error);
    }
  });

  // Removing a member retains financial history. The Chairman or Secretary
  // may remove any registered member, including legacy records that predate
  // creator tracking. History is retained under an anonymized, inactive
  // profile so ledger and loan audit trails are never silently destroyed.
  app.delete('/api/members/:id', requirePermission('members.write'), async (req, res) => {
    const actor = requireAuthenticatedUser(req);
    if (actor.role !== 'Chairman' && actor.role !== 'Secretary') {
      return sendApiError(res, new HttpError(403, 'Only the Chairman or Secretary can delete a member account.', 'MEMBER_DELETE_ACCESS_DENIED'));
    }

    const memberId = String(req.params.id || '').trim();
    let before: Member | undefined;
    try {
      if (postgresPool) {
        if (!memberId.match(/^[0-9a-f-]{36}$/i)) {
          throw new HttpError(404, 'Member was not found.', 'MEMBER_NOT_FOUND');
        }
        const visibleMember = await getPostgresMember(postgresPool, memberId);
        if (!visibleMember) throw new HttpError(404, 'Member was not found.', 'MEMBER_NOT_FOUND');
        before = visibleMember;

        const client = await postgresPool.connect();
        let committed = false;
        try {
          await client.query('BEGIN');
          const locked = await client.query(
            `SELECT id, member_number, full_name, deleted_at
             FROM members WHERE id = $1 FOR UPDATE`,
            [memberId]
          );
          if (!locked.rowCount || locked.rows[0].deleted_at) {
            throw new HttpError(404, 'Member was not found.', 'MEMBER_NOT_FOUND');
          }

          await client.query(
            `UPDATE driver_assignments
             SET status = 'Closed', end_date_time = now(),
                 reason = COALESCE(NULLIF(reason, ''), 'Member account removed by authorised officer'), updated_at = now()
             WHERE owner_member_id = $1 AND status = 'Active'`,
            [memberId]
          );
          await client.query(
            `UPDATE vehicles SET status = 'Exited', updated_at = now()
             WHERE member_id = $1 AND status <> 'Exited'`,
            [memberId]
          );
          await client.query(
            `UPDATE member_activation_challenges SET used_at = COALESCE(used_at, now())
             WHERE member_id = $1`,
            [memberId]
          );
          const removedAccounts = await client.query(
            `DELETE FROM users
             WHERE role = 'Member' AND linked_member_id = $1
             RETURNING id`,
            [memberId]
          );
          await client.query(
            `UPDATE members
             SET full_name = 'Deleted member ' || COALESCE(member_number, substring(id::text, 1, 8)),
                 national_id = NULL, phone = NULL, email = NULL, status = 'Inactive',
                 deleted_at = now(), deleted_by = $2, updated_at = now()
             WHERE id = $1`,
            [memberId, actor.id]
          );
          await client.query('COMMIT');
          committed = true;
          await recordAuditLog(req, 'MEMBER_AND_ACCOUNT_DELETED', 'members', memberId, before, {
            deleted: true,
            removedAccountCount: removedAccounts.rowCount || 0,
            financialHistoryRetained: true
          });
        } catch (error) {
          if (!committed) await client.query('ROLLBACK');
          throw error;
        } finally {
          client.release();
        }
      } else {
        const memberIndex = localStore.members.findIndex(member => member.id === memberId);
        if (memberIndex < 0) throw new HttpError(404, 'Member was not found.', 'MEMBER_NOT_FOUND');
        before = { ...localStore.members[memberIndex] };
        const accountIds = new Set(localStore.users.filter(user => user.role === 'Member' && user.linkedMemberId === memberId).map(user => user.id));
        localStore.users.splice(0, localStore.users.length, ...localStore.users.filter(user => !accountIds.has(user.id)));
        localStore.mfaChallenges.splice(0, localStore.mfaChallenges.length, ...localStore.mfaChallenges.filter(challenge => !accountIds.has(challenge.userId)));
        localStore.members.splice(memberIndex, 1);
        localStore.vehicles.filter(vehicle => vehicle.ownerId === memberId).forEach(vehicle => { vehicle.status = 'Exited'; });
        await recordAuditLog(req, 'MEMBER_AND_ACCOUNT_DELETED', 'members', memberId, before, {
          deleted: true,
          removedAccountCount: accountIds.size,
          financialHistoryRetained: true
        });
      }

      return res.json({ deleted: true, memberId, financialHistoryRetained: true });
    } catch (error: any) {
      return sendApiError(res, error);
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

  // API 6: Register Vehicle (Authorized roles: Chairman, Secretary)
  app.post('/api/vehicles', requirePermission('vehicles.write'), async (req, res) => {
    try {
      const vehicleData = req.body;
      if (!vehicleData.plateNumber) {
        return res.status(400).json({ error: 'Plate Number is required.' });
      }
      const plateNumber = sanitizeVehiclePlate(vehicleData.plateNumber).trim();
      const driverName = sanitizePersonName(vehicleData.driverName).trim();
      const driverPhone = sanitizePhoneNumber(vehicleData.driverPhone);
      const ownerId = String(vehicleData.ownerId || '').trim();
      const typedOwnerName = sanitizePersonName(vehicleData.ownerName).trim();
      const typedOwnerPhone = sanitizePhoneNumber(vehicleData.ownerPhone);
      const typedOwnerIdNumber = String(vehicleData.ownerIdNumber || '').replace(/\D/g, '').slice(0, 12);
      const route = String(vehicleData.route || '').trim();
      const capacity = Number(vehicleData.capacity);
      const dateRegistered = String(vehicleData.dateRegistered || '').trim();
      if (!isValidKenyanVehiclePlate(plateNumber)) {
        return res.status(400).json({ error: 'Plate Number must use a valid Kenyan plate format.' });
      }
      if (!isValidPersonName(driverName)) {
        return res.status(400).json({ error: 'Driver name must contain letters only.' });
      }
      if (!isValidPhoneNumber(driverPhone)) {
        return res.status(400).json({ error: 'Enter a valid driver phone number using digits only.' });
      }
      if (!isApprovedVehicleRoute(route)) {
        return res.status(400).json({ error: 'Select one of the approved SACCO vehicle routes.', code: 'VEHICLE_ROUTE_INVALID' });
      }
      if (!isSupportedVehicleCapacity(capacity)) {
        return res.status(400).json({ error: 'Select a supported vehicle capacity.', code: 'VEHICLE_CAPACITY_INVALID' });
      }
      if (!/^\d{4}-\d{2}-\d{2}$/.test(dateRegistered) || dateRegistered > new Date().toISOString().slice(0, 10)) {
        return res.status(400).json({ error: 'Select a valid registration date that is not in the future.', code: 'VEHICLE_DATE_INVALID' });
      }
      const [registeredMembers, registeredVehicles] = await Promise.all([getAllMembers(), getAllVehicles()]);
      const owner = ownerId ? registeredMembers.find(member => member.id === ownerId) : undefined;
      if (ownerId && !owner) {
        return res.status(400).json({ error: 'The selected registered member was not found.', code: 'MEMBER_NOT_FOUND' });
      }
      if (owner && owner.status !== 'Active') {
        return res.status(409).json({ error: `Member "${owner.name}" is not active.`, code: 'MEMBER_NOT_ACTIVE' });
      }
      const ownerName = owner?.name || typedOwnerName;
      if (!isValidPersonName(ownerName)) {
        return res.status(400).json({ error: 'Enter a valid vehicle owner name or select a registered member.', code: 'VEHICLE_OWNER_INVALID' });
      }
      const ownerPhone = owner?.phoneNumber || typedOwnerPhone;
      const ownerIdNumber = owner?.idNumber || typedOwnerIdNumber;
      if (!owner && (!isValidPhoneNumber(ownerPhone) || !/^\d{5,12}$/.test(ownerIdNumber))) {
        return res.status(400).json({ error: 'Enter a valid phone number and ID number for the unregistered owner.', code: 'VEHICLE_OWNER_DETAILS_INVALID' });
      }
      const normalizedPlate = plateNumber.replace(/\s+/g, '');
      if (registeredVehicles.some(vehicle => vehicle.plateNumber.replace(/\s+/g, '').toUpperCase() === normalizedPlate)) {
        return res.status(409).json({ error: `Vehicle ${plateNumber} is already registered.`, code: 'VEHICLE_ALREADY_REGISTERED' });
      }

      const vehicleId = vehicleData.id || 'v-' + Date.now();
      const newVehicle = {
        id: vehicleId,
        plateNumber,
        ownerId: owner?.id || '',
        ownerName,
        ownerPhone,
        ownerIdNumber,
        driverName,
        driverPhone,
        route,
        status: 'Active' as const,
        capacity,
        dateRegistered
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

  app.post('/api/vehicles/:id/offboard', requirePermission('vehicles.write'), async (req, res) => {
    try {
      const actor = requireAuthenticatedUser(req);
      if (actor.role !== 'Chairman' && actor.role !== 'Secretary') {
        throw new HttpError(403, 'Only the Chairman or Secretary can offboard a matatu.', 'VEHICLE_OFFBOARD_ACCESS_DENIED');
      }
      const vehicleId = String(req.params.id || '').trim();
      const reason = String(req.body?.reason || '').trim().slice(0, 1000);
      let updated: Vehicle;
      if (postgresPool) {
        const client = await postgresPool.connect();
        try {
          await client.query('BEGIN');
          const result = await client.query(
            `UPDATE vehicles
             SET status = 'Exited', offboarded_at = now(), offboarded_by = $2,
                 offboarding_reason = NULLIF($3, ''), updated_at = now()
             WHERE id = $1 AND status <> 'Exited'
             RETURNING *`,
            [vehicleId, actor.id, reason]
          );
          if (!result.rowCount) throw new HttpError(409, 'This matatu is already offboarded or was not found.', 'VEHICLE_ALREADY_OFFBOARDED');
          await client.query(
            `UPDATE driver_assignments
             SET status = 'Closed', end_date_time = now(),
                 reason = COALESCE(NULLIF($2, ''), 'Vehicle offboarded'), updated_at = now()
             WHERE vehicle_id = $1 AND status = 'Active'`,
            [vehicleId, reason]
          );
          await client.query('COMMIT');
        } catch (error) {
          await client.query('ROLLBACK');
          throw error;
        } finally {
          client.release();
        }
        updated = (await listPostgresVehicles(postgresPool)).find(vehicle => vehicle.id === vehicleId)!;
      } else {
        const vehicle = localStore.vehicles.find(item => item.id === vehicleId);
        if (!vehicle || vehicle.status === 'Exited') throw new HttpError(409, 'This matatu is already offboarded or was not found.', 'VEHICLE_ALREADY_OFFBOARDED');
        vehicle.status = 'Exited';
        vehicle.offboardedAt = new Date().toISOString();
        vehicle.offboardingReason = reason || undefined;
        updated = vehicle;
      }
      await recordAuditLog(req, 'VEHICLE_OFFBOARDED', 'vehicles', vehicleId, undefined, { reason });
      res.json(updated);
    } catch (error: any) {
      sendApiError(res, error);
    }
  });

  app.patch('/api/vehicles/:id', requirePermission('vehicles.write'), async (req, res) => {
    try {
      const actor = requireAuthenticatedUser(req);
      if (actor.role !== 'Chairman' && actor.role !== 'Secretary') {
        throw new HttpError(403, 'Only the Chairman or Secretary can edit vehicle details.', 'VEHICLE_EDIT_ACCESS_DENIED');
      }
      const vehicleId = String(req.params.id || '').trim();
      const plateNumber = sanitizeVehiclePlate(req.body?.plateNumber).trim();
      const driverName = sanitizePersonName(req.body?.driverName).trim();
      const driverPhone = sanitizePhoneNumber(req.body?.driverPhone);
      const ownerId = String(req.body?.ownerId || '').trim();
      const typedOwnerName = sanitizePersonName(req.body?.ownerName).trim();
      const typedOwnerPhone = sanitizePhoneNumber(req.body?.ownerPhone);
      const typedOwnerIdNumber = String(req.body?.ownerIdNumber || '').replace(/\D/g, '').slice(0, 12);
      const route = String(req.body?.route || '').trim();
      const capacity = Number(req.body?.capacity);
      const dateRegistered = String(req.body?.dateRegistered || '').trim();
      if (!isValidKenyanVehiclePlate(plateNumber)) {
        throw new HttpError(400, 'Plate Number must use a valid Kenyan plate format.', 'VEHICLE_PLATE_INVALID');
      }
      if (!isValidPersonName(driverName) || !isValidPhoneNumber(driverPhone)) {
        throw new HttpError(400, 'Enter a valid driver name and phone number.', 'VEHICLE_DRIVER_INVALID');
      }
      if (!isApprovedVehicleRoute(route)) {
        throw new HttpError(400, 'Select one of the approved SACCO vehicle routes.', 'VEHICLE_ROUTE_INVALID');
      }
      if (!isSupportedVehicleCapacity(capacity)) {
        throw new HttpError(400, 'Select a supported vehicle capacity.', 'VEHICLE_CAPACITY_INVALID');
      }
      if (!/^\d{4}-\d{2}-\d{2}$/.test(dateRegistered) || dateRegistered > new Date().toISOString().slice(0, 10)) {
        throw new HttpError(400, 'Select a valid registration date that is not in the future.', 'VEHICLE_DATE_INVALID');
      }
      const [registeredMembers, registeredVehicles] = await Promise.all([getAllMembers(), getAllVehicles()]);
      const owner = ownerId ? registeredMembers.find(member => member.id === ownerId) : undefined;
      if (ownerId && !owner) {
        throw new HttpError(400, 'The selected registered member was not found.', 'MEMBER_NOT_FOUND');
      }
      if (owner && owner.status !== 'Active') {
        throw new HttpError(409, `Member "${owner.name}" is not active.`, 'MEMBER_NOT_ACTIVE');
      }
      const ownerName = owner?.name || typedOwnerName;
      if (!isValidPersonName(ownerName)) {
        throw new HttpError(400, 'Enter a valid vehicle owner name or select a registered member.', 'VEHICLE_OWNER_INVALID');
      }
      const ownerPhone = owner?.phoneNumber || typedOwnerPhone;
      const ownerIdNumber = owner?.idNumber || typedOwnerIdNumber;
      if (!owner && (!isValidPhoneNumber(ownerPhone) || !/^\d{5,12}$/.test(ownerIdNumber))) {
        throw new HttpError(400, 'Enter a valid phone number and ID number for the unregistered owner.', 'VEHICLE_OWNER_DETAILS_INVALID');
      }
      const normalizedPlate = plateNumber.replace(/\s+/g, '').toUpperCase();
      if (registeredVehicles.some(vehicle => vehicle.id !== vehicleId && vehicle.plateNumber.replace(/\s+/g, '').toUpperCase() === normalizedPlate)) {
        throw new HttpError(409, `Vehicle ${plateNumber} is already registered.`, 'VEHICLE_ALREADY_REGISTERED');
      }
      const changes = { plateNumber, ownerId: owner?.id || '', ownerName, ownerPhone, ownerIdNumber, driverName, driverPhone, route, capacity: capacity as Vehicle['capacity'], dateRegistered };
      let updated: Vehicle;
      if (postgresPool) {
        updated = await updatePostgresVehicle(postgresPool, vehicleId, changes, actor.id);
      } else {
        const vehicle = localStore.vehicles.find(item => item.id === vehicleId);
        if (!vehicle) throw new HttpError(404, 'Vehicle was not found.', 'VEHICLE_NOT_FOUND');
        Object.assign(vehicle, changes);
        updated = vehicle;
      }
      await recordAuditLog(req, 'VEHICLE_DETAILS_UPDATED', 'vehicles', vehicleId, undefined, changes);
      res.json(updated);
    } catch (error: any) {
      sendApiError(res, error);
    }
  });

  app.post('/api/vehicles/:id/onboard', requirePermission('vehicles.write'), async (req, res) => {
    try {
      const actor = requireAuthenticatedUser(req);
      if (actor.role !== 'Chairman' && actor.role !== 'Secretary') {
        throw new HttpError(403, 'Only the Chairman or Secretary can onboard a vehicle.', 'VEHICLE_ONBOARD_ACCESS_DENIED');
      }
      const vehicleId = String(req.params.id || '').trim();
      let updated: Vehicle;
      if (postgresPool) {
        const client = await postgresPool.connect();
        try {
          await client.query('BEGIN');
          const existingResult = await client.query(
            `SELECT * FROM vehicles WHERE id = $1 FOR UPDATE`,
            [vehicleId]
          );
          if (!existingResult.rowCount) throw new HttpError(404, 'Vehicle was not found.', 'VEHICLE_NOT_FOUND');
          const vehicle = existingResult.rows[0];
          if (vehicle.status === 'Active') {
            throw new HttpError(409, 'This vehicle is already onboarded.', 'VEHICLE_ALREADY_ONBOARDED');
          }
          await client.query(
            `UPDATE vehicles
             SET status = 'Active', offboarded_at = NULL, offboarded_by = NULL,
                 offboarding_reason = NULL, updated_at = now()
             WHERE id = $1`,
            [vehicleId]
          );
          const activeAssignment = await client.query(
            `SELECT 1 FROM driver_assignments WHERE vehicle_id = $1 AND status = 'Active' LIMIT 1`,
            [vehicleId]
          );
          if (!activeAssignment.rowCount && vehicle.driver_name) {
            const existingDriver = await client.query(
              `SELECT id FROM drivers
               WHERE ($1 <> '' AND phone = $1) OR ($1 = '' AND full_name = $2)
               ORDER BY created_at
               LIMIT 1`,
              [vehicle.driver_phone || '', vehicle.driver_name]
            );
            const driverId = existingDriver.rowCount
              ? existingDriver.rows[0].id
              : (await client.query(
                  `INSERT INTO drivers (full_name, phone)
                   VALUES ($1, NULLIF($2, ''))
                   RETURNING id`,
                  [vehicle.driver_name, vehicle.driver_phone || '']
                )).rows[0].id;
            await client.query(
              `INSERT INTO driver_assignments (
                 vehicle_id, driver_id, owner_member_id, start_date_time, status, assigned_by, reason
               ) VALUES ($1, $2, $3, now(), 'Active', $4, 'Vehicle onboarded')`,
              [vehicleId, driverId, vehicle.member_id || null, actor.id]
            );
          }
          await client.query('COMMIT');
        } catch (error) {
          await client.query('ROLLBACK');
          throw error;
        } finally {
          client.release();
        }
        updated = (await listPostgresVehicles(postgresPool)).find(vehicle => vehicle.id === vehicleId)!;
      } else {
        const vehicle = localStore.vehicles.find(item => item.id === vehicleId);
        if (!vehicle) throw new HttpError(404, 'Vehicle was not found.', 'VEHICLE_NOT_FOUND');
        if (vehicle.status === 'Active') throw new HttpError(409, 'This vehicle is already onboarded.', 'VEHICLE_ALREADY_ONBOARDED');
        vehicle.status = 'Active';
        vehicle.offboardedAt = undefined;
        vehicle.offboardingReason = undefined;
        updated = vehicle;
      }
      await recordAuditLog(req, 'VEHICLE_ONBOARDED', 'vehicles', vehicleId, undefined, { status: 'Active' });
      res.json(updated);
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

  // API 8B2: Hard delete a transaction completely from ledger and database
  app.delete('/api/transactions/:id', requirePermission('ledger.write'), async (req, res) => {
    try {
      const deleted = await deleteLedgerTransaction(req.params.id);
      await recordAuditLog(req, 'LEDGER_ENTRY_DELETED', 'ledger_entries', deleted.id, undefined, deleted);
      res.json({ message: 'Transaction deleted successfully.', transaction: deleted });
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

  // API 8D: Isolated Historical Manifest Archives (2025 Collections)
  app.get('/api/historical-manifests/dates', async (req, res) => {
    try {
      requireAuthenticatedUser(req);
      if (!postgresPool) return res.json([]);
      const result = await postgresPool.query(`
        SELECT 
          to_char(record_date, 'YYYY-MM-DD') AS "recordDate",
          nissan_total::numeric AS "nissanTotal",
          sienta_total::numeric AS "sientaTotal",
          gross_total::numeric AS "grossTotal",
          total_expenses::numeric AS "totalExpenses",
          net_vault_inflow::numeric AS "netVaultInflow"
        FROM historical_manifest_days
        ORDER BY record_date ASC
      `);
      res.json(result.rows);
    } catch (error: any) {
      sendApiError(res, error);
    }
  });

  app.get('/api/historical-manifests/day/:date', async (req, res) => {
    try {
      requireAuthenticatedUser(req);
      const date = req.params.date;
      if (!postgresPool) throw new HttpError(503, 'Database not connected');

      const [dayRes, entriesRes, expensesRes] = await Promise.all([
        postgresPool.query(
          `SELECT 
             to_char(record_date, 'YYYY-MM-DD') AS "recordDate",
             nissan_total::numeric AS "nissanTotal",
             sienta_total::numeric AS "sientaTotal",
             gross_total::numeric AS "grossTotal",
             total_expenses::numeric AS "totalExpenses",
             net_vault_inflow::numeric AS "netVaultInflow"
           FROM historical_manifest_days
           WHERE record_date = $1::date`,
          [date]
        ),
        postgresPool.query(
          `SELECT 
             id,
             to_char(record_date, 'YYYY-MM-DD') AS "recordDate",
             fleet,
             row_no AS "rowNo",
             plate_number AS "plateNumber",
             operation::numeric,
             entrance::numeric,
             loan_repay AS "loanRepay",
             savings::numeric,
             s_ticket AS "sTicket",
             legal_fee AS "legalFee",
             total_amount AS "totalAmount"
           FROM historical_manifest_entries
           WHERE record_date = $1::date
           ORDER BY fleet ASC, row_no ASC, id ASC`,
          [date]
        ),
        postgresPool.query(
          `SELECT 
             id,
             to_char(record_date, 'YYYY-MM-DD') AS "recordDate",
             item_no AS "itemNo",
             description,
             amount::numeric
           FROM historical_manifest_expenses
           WHERE record_date = $1::date
           ORDER BY item_no ASC, id ASC`,
          [date]
        )
      ]);

      const nissan = entriesRes.rows.filter(r => r.fleet === 'Nissan');
      const sienta = entriesRes.rows.filter(r => r.fleet === 'Sienta');

      res.json({
        day: dayRes.rows[0] || {
          recordDate: date,
          nissanTotal: 0,
          sientaTotal: 0,
          grossTotal: 0,
          totalExpenses: 0,
          netVaultInflow: 0
        },
        nissan,
        sienta,
        expenses: expensesRes.rows
      });
    } catch (error: any) {
      sendApiError(res, error);
    }
  });

  app.put('/api/historical-manifests/day/:date', requirePermission('ledger.write'), async (req, res) => {
    try {
      requireAuthenticatedUser(req);
      const date = req.params.date;
      const { nissan = [], sienta = [], expenses = [] } = req.body;

      if (!postgresPool) throw new HttpError(503, 'Database not connected');

      const client = await postgresPool.connect();
      try {
        await client.query('BEGIN');

        await client.query('DELETE FROM historical_manifest_entries WHERE record_date = $1::date', [date]);
        await client.query('DELETE FROM historical_manifest_expenses WHERE record_date = $1::date', [date]);

        let nissanSum = 0;
        let sientaSum = 0;

        for (let i = 0; i < nissan.length; i++) {
          const r = nissan[i];
          const op = Math.max(0, Number(r.operation || 0));
          const ent = Math.max(0, Number(r.entrance || 0));
          const loan = Math.max(0, Number(r.loanRepay || r.loan_repay || 0));
          const sav = Math.max(0, Number(r.savings || 0));
          const st = Math.max(0, Number(r.sTicket || r.s_ticket || 0));
          const leg = Math.max(0, Number(r.legalFee || r.legal_fee || 0));
          const tot = op + ent + loan + sav + st + leg;
          nissanSum += tot;

          await client.query(
            `INSERT INTO historical_manifest_entries (
               record_date, fleet, row_no, plate_number, operation, entrance, loan_repay, savings, s_ticket, legal_fee, total_amount
             ) VALUES ($1::date, 'Nissan', $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
            [date, i + 1, (r.plateNumber || r.plate_number || '').trim().toUpperCase(), op, ent, loan, sav, st, leg, tot]
          );
        }

        for (let i = 0; i < sienta.length; i++) {
          const r = sienta[i];
          const op = Math.max(0, Number(r.operation || 0));
          const ent = Math.max(0, Number(r.entrance || 0));
          const loan = Math.max(0, Number(r.loanRepay || r.loan_repay || 0));
          const sav = Math.max(0, Number(r.savings || 0));
          const st = Math.max(0, Number(r.sTicket || r.s_ticket || 0));
          const leg = Math.max(0, Number(r.legalFee || r.legal_fee || 0));
          const tot = op + ent + loan + sav + st + leg;
          sientaSum += tot;

          await client.query(
            `INSERT INTO historical_manifest_entries (
               record_date, fleet, row_no, plate_number, operation, entrance, loan_repay, savings, s_ticket, legal_fee, total_amount
             ) VALUES ($1::date, 'Sienta', $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
            [date, i + 1, (r.plateNumber || r.plate_number || '').trim().toUpperCase(), op, ent, loan, sav, st, leg, tot]
          );
        }

        let expenseSum = 0;
        for (let i = 0; i < expenses.length; i++) {
          const e = expenses[i];
          const amt = Math.max(0, Number(e.amount || 0));
          expenseSum += amt;
          await client.query(
            `INSERT INTO historical_manifest_expenses (
               record_date, item_no, description, amount
             ) VALUES ($1::date, $2, $3, $4)`,
            [date, i + 1, (e.description || '').trim(), amt]
          );
        }

        const gross = nissanSum + sientaSum;
        const net = gross - expenseSum;

        await client.query(
          `INSERT INTO historical_manifest_days (
             record_date, nissan_total, sienta_total, gross_total, total_expenses, net_vault_inflow, updated_at
           ) VALUES ($1::date, $2, $3, $4, $5, $6, now())
           ON CONFLICT (record_date) DO UPDATE SET
             nissan_total = EXCLUDED.nissan_total,
             sienta_total = EXCLUDED.sienta_total,
             gross_total = EXCLUDED.gross_total,
             total_expenses = EXCLUDED.total_expenses,
             net_vault_inflow = EXCLUDED.net_vault_inflow,
             updated_at = now()`,
          [date, nissanSum, sientaSum, gross, expenseSum, net]
        );

        await client.query('COMMIT');
        await recordAuditLog(req, 'HISTORICAL_MANIFEST_SAVED', 'historical_manifest_days', date, undefined, {
          date,
          nissanEntries: nissan.length,
          sientaEntries: sienta.length,
          expenses: expenses.length,
          grossTotal: gross,
          totalExpenses: expenseSum,
          netVaultInflow: net
        });

        res.json({
          success: true,
          date,
          day: {
            recordDate: date,
            nissanTotal: nissanSum,
            sientaTotal: sientaSum,
            grossTotal: gross,
            totalExpenses: expenseSum,
            netVaultInflow: net
          }
        });
      } catch (innerError) {
        await client.query('ROLLBACK');
        throw innerError;
      } finally {
        client.release();
      }
    } catch (error: any) {
      sendApiError(res, error);
    }
  });

  // API 8E: Crop-Alongside-Cell Verification Endpoints
  app.get('/api/historical-manifests/crop/:date/:fleet/:rowNo', async (req, res) => {
    try {
      requireAuthenticatedUser(req);
      const { date, fleet, rowNo } = req.params;
      const normalizedFleet = fleet.toLowerCase().includes('nissan') ? 'Nissan' : 'Sienta';
      const cropFilename = `${date}_${normalizedFleet}_r${rowNo}.jpg`;
      const possiblePaths = [
        path.join(process.cwd(), 'public', 'manifest_crops', cropFilename),
        path.join(process.cwd(), 'dist', 'client', 'manifest_crops', cropFilename),
        path.join(process.cwd(), 'manifest_crops', cropFilename)
      ];
      for (const p of possiblePaths) {
        if (fs.existsSync(p)) {
          res.setHeader('Content-Type', 'image/jpeg');
          res.setHeader('Cache-Control', 'public, max-age=86400');
          return res.sendFile(p);
        }
      }
      res.status(404).json({ error: 'Crop image not found for this row' });
    } catch (error: any) {
      sendApiError(res, error);
    }
  });

  app.get('/api/historical-manifests/footer-crop/:date/:fleet', async (req, res) => {
    try {
      requireAuthenticatedUser(req);
      const { date, fleet } = req.params;
      const normalizedFleet = fleet.toLowerCase().includes('nissan') ? 'Nissan' : 'Sienta';
      const cropFilename = `${date}_${normalizedFleet}_footer.jpg`;
      const possiblePaths = [
        path.join(process.cwd(), 'public', 'manifest_crops', cropFilename),
        path.join(process.cwd(), 'dist', 'client', 'manifest_crops', cropFilename),
        path.join(process.cwd(), 'manifest_crops', cropFilename)
      ];
      for (const p of possiblePaths) {
        if (fs.existsSync(p)) {
          res.setHeader('Content-Type', 'image/jpeg');
          res.setHeader('Cache-Control', 'public, max-age=86400');
          return res.sendFile(p);
        }
      }
      res.status(404).json({ error: 'Footer crop image not found' });
    } catch (error: any) {
      sendApiError(res, error);
    }
  });

  app.get('/api/historical-manifests/crops-index', async (req, res) => {
    try {
      requireAuthenticatedUser(req);
      const indexPath = path.join(process.cwd(), 'public', 'manifest_crops', 'manifest_crops_index.json');
      if (fs.existsSync(indexPath)) {
        return res.sendFile(indexPath);
      }
      res.json({});
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
          totalFleetCount: portal.vehicles.filter(vehicle => vehicle.status !== 'Exited').length,
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
          totalFleetCount: vehicles.filter(vehicle => vehicle.status !== 'Exited').length,
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
            totalFleetCount: localStore.vehicles.filter(vehicle => vehicle.status !== 'Exited').length,
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

  // --- M-Pesa Daraja Integration Endpoints ---
  app.post('/api/mpesa/stk-push', authenticateSaccoUser, async (req, res) => {
    try {
      const { phone, amount, accountReference, transactionDesc } = req.body || {};
      const result = await initiateMpesaDarajaStkPush({
        phone: String(phone || ''),
        amount: Number(amount || 0),
        accountReference: String(accountReference || ''),
        transactionDesc: String(transactionDesc || '')
      });
      res.json({ success: true, result });
    } catch (error: any) {
      sendApiError(res, error);
    }
  });

  app.post('/api/mpesa/callback', async (req, res) => {
    try {
      console.info('[M-Pesa STK Callback Received]', JSON.stringify(req.body));
      const parsed = parseMpesaStkCallback(req.body);
      if (parsed.isSuccess && parsed.amount > 0) {
        const [members, vehicles] = await Promise.all([getAllMembers(), getAllVehicles()]);
        const match = matchMpesaReference(parsed.accountReference, members, vehicles);
        const record: PaymentRecord = {
          id: `mpesa-${crypto.randomUUID()}`,
          timestamp: parsed.transactionTime,
          source: 'Webhook',
          status: 'Pending',
          refCode: parsed.transId,
          amount: parsed.amount,
          tillNumber: 'VehicleTill',
          category: 'Daily Contribution',
          accountReference: parsed.accountReference || parsed.transId,
          payerName: match.memberName || 'M-Pesa Payer',
          payerPhone: parsed.phoneNumber,
          memberId: match.memberId,
          memberName: match.memberName,
          vehiclePlate: match.vehiclePlate,
          matchMethod: match.matchMethod,
          rawPayload: req.body
        };
        await savePaymentRecord(record);
      }
      res.status(200).json({ ResultCode: 0, ResultDesc: 'Callback processed successfully' });
    } catch (error: any) {
      console.warn('[M-Pesa Callback Error]', error?.message);
      res.status(200).json({ ResultCode: 0, ResultDesc: 'Callback received with warnings' });
    }
  });

  app.post('/api/mpesa/c2b/validation', async (_req, res) => {
    res.status(200).json({ ResultCode: 0, ResultDesc: 'Accepted' });
  });

  app.post('/api/mpesa/c2b/confirmation', async (req, res) => {
    try {
      console.info('[M-Pesa C2B Confirmation Received]', JSON.stringify(req.body));
      const parsed = parseMpesaC2bPayload(req.body);
      if (parsed.isSuccess && parsed.amount > 0) {
        const [members, vehicles] = await Promise.all([getAllMembers(), getAllVehicles()]);
        const match = matchMpesaReference(parsed.accountReference, members, vehicles);
        const record: PaymentRecord = {
          id: `mpesa-${crypto.randomUUID()}`,
          timestamp: parsed.transactionTime,
          source: 'Webhook',
          status: 'Pending',
          refCode: parsed.transId,
          amount: parsed.amount,
          tillNumber: 'VehicleTill',
          category: 'Daily Contribution',
          accountReference: parsed.accountReference || parsed.transId,
          payerName: match.memberName || 'M-Pesa Payer',
          payerPhone: parsed.phoneNumber,
          memberId: match.memberId,
          memberName: match.memberName,
          vehiclePlate: match.vehiclePlate,
          matchMethod: match.matchMethod,
          rawPayload: req.body
        };
        await savePaymentRecord(record);
      }
      res.status(200).json({ ResultCode: 0, ResultDesc: 'Accepted' });
    } catch (error: any) {
      console.warn('[M-Pesa C2B Error]', error?.message);
      res.status(200).json({ ResultCode: 0, ResultDesc: 'Accepted' });
    }
  });

  app.use((error: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
    if (error?.type === 'entity.too.large') return res.status(413).json({ MessageCode: '413', Message: 'Request body is too large' });
    if (error instanceof SyntaxError && 'body' in error) return res.status(400).json({ MessageCode: '400', Message: 'Malformed JSON payload' });
    void recordApplicationError({
      req,
      source: 'server',
      severity: 'critical',
      statusCode: 500,
      errorCode: 'UNHANDLED_REQUEST_ERROR',
      message: error instanceof Error ? error.message : 'Unhandled request error.',
      stack: error instanceof Error ? error.stack : undefined
    });
    console.error('[Sacco API] Unhandled request failure.');
    return res.status(500).json({ error: 'Unexpected server error.', code: 'INTERNAL_ERROR' });
  });

  app.patch('/api/members/:id', requirePermission('members.write'), async (req, res) => {
    try {
      const actor = requireAuthenticatedUser(req);
      if (actor.role !== 'Chairman' && actor.role !== 'Secretary') {
        throw new HttpError(403, 'Only the Chairman or Secretary can edit member details.', 'MEMBER_EDIT_ACCESS_DENIED');
      }
      const memberId = String(req.params.id || '').trim();
      const membershipNumber = sanitizeMemberNumber(req.body?.membershipNumber);
      const name = sanitizePersonName(req.body?.name).trim();
      const idNumber = sanitizeIntegerInput(req.body?.idNumber, 12);
      const phoneNumber = sanitizePhoneNumber(req.body?.phoneNumber);
      const email = normalizedEmail(req.body?.email);
      if (!isValidMemberNumber(membershipNumber)) {
        throw new HttpError(400, 'Member Number must contain letters and numbers only (maximum 30 characters).', 'MEMBER_NUMBER_INVALID');
      }
      if (!isValidPersonName(name) || !idNumber || !isValidPhoneNumber(phoneNumber) || !/^\S+@\S+\.\S+$/.test(email)) {
        throw new HttpError(400, 'Enter a valid member number, name, National ID, phone number and email address.', 'MEMBER_DETAILS_INVALID');
      }
      let updated: Member;
      if (postgresPool) {
        const client = await postgresPool.connect();
        try {
          await client.query('BEGIN');
          const existing = await client.query('SELECT * FROM members WHERE id = $1 AND deleted_at IS NULL FOR UPDATE', [memberId]);
          if (!existing.rowCount) throw new HttpError(404, 'Member was not found.', 'MEMBER_NOT_FOUND');
          const current = existing.rows[0];
          const memberNumberChanged = sanitizeMemberNumber(current.member_number) !== membershipNumber;
          const idNumberChanged = sanitizeIntegerInput(current.national_id, 12) !== idNumber;
          const emailChanged = normalizedEmail(current.email) !== email;

          if (memberNumberChanged) {
            const memberNumberConflict = await client.query(
              `SELECT 1 FROM members
               WHERE id <> $1 AND upper(member_number) = $2
               LIMIT 1`,
              [memberId, membershipNumber]
            );
            if (memberNumberConflict.rowCount) {
              throw new HttpError(409, `Member Number ${membershipNumber} is already registered.`, 'MEMBER_NUMBER_ALREADY_REGISTERED');
            }
          }

          if (idNumberChanged) {
            const nationalIdConflict = await client.query(
              `SELECT 1 FROM members
               WHERE id <> $1 AND deleted_at IS NULL AND national_id = $2
               LIMIT 1`,
              [memberId, idNumber]
            );
            if (nationalIdConflict.rowCount) {
              throw new HttpError(409, `National ID ${idNumber} is already registered to another member.`, 'MEMBER_NATIONAL_ID_ALREADY_REGISTERED');
            }
          }

          if (emailChanged) {
            const memberEmailConflict = await client.query(
              `SELECT 1 FROM members
               WHERE id <> $1 AND deleted_at IS NULL AND lower(COALESCE(email, '')) = $2
               LIMIT 1`,
              [memberId, email]
            );
            if (memberEmailConflict.rowCount) {
              throw new HttpError(409, `Email ${email} is already registered to another member.`, 'MEMBER_EMAIL_ALREADY_REGISTERED');
            }
            const userConflict = await client.query(
              `SELECT 1 FROM users
               WHERE linked_member_id IS DISTINCT FROM $1::uuid AND lower(email) = $2
               LIMIT 1`,
              [memberId, email]
            );
            if (userConflict.rowCount) {
              throw new HttpError(409, `Email ${email} is already used by another SACCO login.`, 'MEMBER_EMAIL_CONFLICT');
            }
          }

          await client.query(
            `UPDATE members
             SET member_number = $2, full_name = $3, national_id = $4, phone = $5, email = $6, updated_at = now()
             WHERE id = $1`,
            [memberId, membershipNumber, name, idNumber, phoneNumber, email]
          );
          await client.query(
            `UPDATE users SET full_name = $2, phone = $3, email = $4, updated_at = now()
             WHERE role = 'Member' AND linked_member_id = $1`,
            [memberId, name, phoneNumber, email]
          );
          await client.query('COMMIT');
        } catch (error) {
          await client.query('ROLLBACK');
          throw error;
        } finally {
          client.release();
        }
        updated = (await getPostgresMember(postgresPool, memberId))!;
      } else {
        const member = localStore.members.find(item => item.id === memberId);
        if (!member) throw new HttpError(404, 'Member was not found.', 'MEMBER_NOT_FOUND');
        const memberNumberChanged = sanitizeMemberNumber(member.membershipNumber) !== membershipNumber;
        const idNumberChanged = sanitizeIntegerInput(member.idNumber, 12) !== idNumber;
        const emailChanged = normalizedEmail(member.email) !== email;
        if (memberNumberChanged && localStore.members.some(item => item.id !== memberId && sanitizeMemberNumber(item.membershipNumber) === membershipNumber)) {
          throw new HttpError(409, `Member Number ${membershipNumber} is already registered.`, 'MEMBER_NUMBER_ALREADY_REGISTERED');
        }
        if (idNumberChanged && localStore.members.some(item => item.id !== memberId && item.idNumber === idNumber)) {
          throw new HttpError(409, `National ID ${idNumber} is already registered to another member.`, 'MEMBER_NATIONAL_ID_ALREADY_REGISTERED');
        }
        if (emailChanged && localStore.members.some(item => item.id !== memberId && normalizedEmail(item.email) === email)) {
          throw new HttpError(409, `Email ${email} is already registered to another member.`, 'MEMBER_EMAIL_ALREADY_REGISTERED');
        }
        if (emailChanged && localStore.users.some(user => user.linkedMemberId !== memberId && normalizedEmail(user.email) === email)) {
          throw new HttpError(409, `Email ${email} is already used by another SACCO login.`, 'MEMBER_EMAIL_CONFLICT');
        }
        Object.assign(member, { membershipNumber, name, idNumber, phoneNumber, email });
        localStore.users.filter(user => user.role === 'Member' && user.linkedMemberId === memberId)
          .forEach(user => Object.assign(user, { name, phone: phoneNumber, email }));
        updated = member;
      }
      await recordAuditLog(req, 'MEMBER_DETAILS_UPDATED', 'members', memberId, undefined, { membershipNumber, name, idNumber, phoneNumber, email });
      res.json(updated);
    } catch (error: any) {
      if (error?.code === '23505' && String(error?.constraint || '').includes('member_number')) {
        return sendApiError(res, new HttpError(409, 'That Member Number is already registered. Enter a different unique number.', 'MEMBER_NUMBER_ALREADY_REGISTERED'));
      }
      if (error?.code === '23505' && String(error?.constraint || '').includes('national_id')) {
        return sendApiError(res, new HttpError(409, 'That National ID is already registered to another member.', 'MEMBER_NATIONAL_ID_ALREADY_REGISTERED'));
      }
      if (error?.code === '23505' && String(error?.constraint || '').includes('email')) {
        return sendApiError(res, new HttpError(409, 'That email is already used by another SACCO account.', 'MEMBER_EMAIL_CONFLICT'));
      }
      sendApiError(res, error);
    }
  });

  app.patch('/api/members/:id/status', requirePermission('members.write'), async (req, res) => {
    try {
      const actor = requireAuthenticatedUser(req);
      if (actor.role !== 'Chairman' && actor.role !== 'Secretary') {
        throw new HttpError(403, 'Only the Chairman or Secretary can suspend or reactivate members.', 'MEMBER_STATUS_ACCESS_DENIED');
      }
      const memberId = String(req.params.id || '').trim();
      const action = String(req.body?.action || '').trim();
      const reason = String(req.body?.reason || '').trim().slice(0, 1000);
      if (action !== 'suspend' && action !== 'activate') {
        throw new HttpError(400, 'Choose suspend or activate.', 'MEMBER_STATUS_ACTION_INVALID');
      }
      let updated: Member;
      if (postgresPool) {
        const status = action === 'activate' ? 'Active' : 'Pending';
        const result = await postgresPool.query(
          `UPDATE members
           SET status = $2::member_status,
               suspended_at = CASE WHEN $2 = 'Pending' THEN now() ELSE NULL END,
               suspended_by = CASE WHEN $2 = 'Pending' THEN $3::uuid ELSE NULL END,
               suspension_reason = CASE WHEN $2 = 'Pending' THEN NULLIF($4, '') ELSE NULL END,
               last_daily_collection_at = CASE WHEN $2 = 'Active' THEN now() ELSE last_daily_collection_at END,
               inactivity_warned_at = CASE WHEN $2 = 'Active' THEN NULL ELSE inactivity_warned_at END,
               updated_at = now()
           WHERE id = $1 AND deleted_at IS NULL
           RETURNING id`,
          [memberId, status, actor.id, reason]
        );
        if (!result.rowCount) throw new HttpError(404, 'Member was not found.', 'MEMBER_NOT_FOUND');
        await postgresPool.query(
          `UPDATE users
           SET account_status = $2, is_active = TRUE, updated_at = now()
           WHERE role = 'Member' AND linked_member_id = $1`,
          [memberId, action === 'activate' ? 'Active' : 'Suspended']
        );
        updated = (await getPostgresMember(postgresPool, memberId))!;
      } else {
        const member = localStore.members.find(item => item.id === memberId);
        if (!member) throw new HttpError(404, 'Member was not found.', 'MEMBER_NOT_FOUND');
        member.status = action === 'activate' ? 'Active' : 'Pending';
        member.suspensionReason = action === 'suspend' ? reason || undefined : undefined;
        member.suspendedAt = action === 'suspend' ? new Date().toISOString() : undefined;
        if (action === 'activate') member.lastDailyCollectionAt = new Date().toISOString();
        localStore.users.filter(user => user.role === 'Member' && user.linkedMemberId === memberId)
          .forEach(user => { user.accountStatus = action === 'activate' ? 'Active' : 'Suspended'; user.isActive = true; });
        updated = member;
      }
      await recordAuditLog(req, action === 'activate' ? 'MEMBER_REACTIVATED' : 'MEMBER_SUSPENDED', 'members', memberId, undefined, { reason });
      res.json(updated);
    } catch (error: any) {
      sendApiError(res, error);
    }
  });

  app.post('/api/member-portal/suspend', requirePermission('member.portal.read'), async (req, res) => {
    try {
      const user = requireAuthenticatedUser(req);
      if (!isMemberUser(user)) throw new HttpError(403, 'Only a member can suspend their own account.', 'MEMBER_SELF_SUSPEND_ONLY');
      const memberId = requireLinkedMember(user);
      const reason = String(req.body?.reason || '').trim().slice(0, 1000);
      if (postgresPool) {
        await postgresPool.query(
          `UPDATE members
           SET status = 'Pending', suspended_at = now(), suspended_by = $2,
               suspension_reason = NULLIF($3, ''), updated_at = now()
           WHERE id = $1 AND deleted_at IS NULL`,
          [memberId, user.id, reason]
        );
        await postgresPool.query(
          `UPDATE users SET account_status = 'Suspended', updated_at = now() WHERE id = $1`,
          [user.id]
        );
      } else {
        const member = localStore.members.find(item => item.id === memberId);
        if (!member) throw new HttpError(404, 'Member was not found.', 'MEMBER_NOT_FOUND');
        member.status = 'Pending';
        member.suspensionReason = reason || undefined;
        member.suspendedAt = new Date().toISOString();
        const account = localStore.users.find(item => item.id === user.id);
        if (account) account.accountStatus = 'Suspended';
      }
      await notifyRole('Secretary', {
        category: 'MEMBER_SELF_SUSPENDED',
        title: 'Member requested suspension',
        message: `${user.name} suspended their member account${reason ? `: ${reason}` : '.'}`,
        destination: 'Members'
      });
      await recordAuditLog(req, 'MEMBER_SELF_SUSPENDED', 'members', memberId, undefined, { reason });
      res.json({ suspended: true });
    } catch (error: any) {
      sendApiError(res, error);
    }
  });

  
  // ==========================================
  // SACCO M-PESA EXPRESS (STK PUSH) & RECONCILIATION
  // ==========================================

  const settleStkPayment = async (input: {
    checkoutRequestId: string;
    mpesaReceiptNumber: string;
    amount?: number;
    resultCode?: number;
    resultDescription?: string;
    finalStatus?: 'SUCCESS' | 'RESOLVED_RECONCILED';
    metadataPatch?: Record<string, unknown>;
  }): Promise<SaccoTransaction | null> => {
    if (postgresPool) {
      const completed = await completeStkTransaction(postgresPool, input);
      const isLoan = completed.transactionType === 'LOAN_REPAYMENT';
      void notifyMember(completed.memberId, {
        category: 'PAYMENT',
        title: isLoan ? 'M-Pesa Loan Repayment Credited' : 'M-Pesa Savings Deposit Credited',
        message: `KES ${completed.amount.toLocaleString('en-KE')} (${input.mpesaReceiptNumber}) has been ${isLoan ? 'deducted from your loan balance' : 'added to your SACCO savings'}.`,
        destination: 'My Account'
      });
      void notifyRole('Treasurer', {
        category: 'PAYMENT',
        title: 'M-Pesa STK Payment Reconciled',
        message: `Member payment of KES ${completed.amount.toLocaleString('en-KE')} (${input.mpesaReceiptNumber}) posted to ledger.`,
        destination: 'Daily Collections'
      });
      return completed;
    }

    const localTx = localStore.saccoTransactions.find(t => t.checkoutRequestId === input.checkoutRequestId);
    if (!localTx) return null;
    if (['SUCCESS', 'RESOLVED_RECONCILED'].includes(localTx.status)) {
      return localTx;
    }

    const effectiveAmount = Number(input.amount || localTx.amount);
    const txMeta = (localTx.metadata && typeof localTx.metadata === 'object' ? localTx.metadata : {}) as Record<string, unknown>;
    const vehiclePlate = String(txMeta.vehiclePlate || '').trim();
    const member = localStore.members.find(m => m.id === localTx.memberId);
    const isLoan = localTx.transactionType === 'LOAN_REPAYMENT';
    const nowIso = new Date().toISOString();
    const payerName = String(txMeta.payerName || member?.name || 'Member');

    const creditTx: Transaction = {
      id: `TX-MPESA-${Date.now()}-${crypto.randomUUID().slice(0, 6)}`,
      memberId: localTx.memberId,
      memberName: payerName,
      vehiclePlate: vehiclePlate || '',
      timestamp: nowIso,
      entryDate: nowIso.slice(0, 10),
      type: 'Credit',
      category: isLoan ? 'Daily Contribution' : 'Savings Contribution',
      amount: effectiveAmount,
      grossAmount: effectiveAmount,
      description: isLoan
        ? `M-Pesa STK Loan Repayment [${input.mpesaReceiptNumber}]${vehiclePlate ? ` — ${vehiclePlate}` : ` — ${payerName}`}`
        : `M-Pesa STK Savings Deposit [${input.mpesaReceiptNumber}]${vehiclePlate ? ` — ${vehiclePlate}` : ` — ${payerName}`}`,
      refCode: input.mpesaReceiptNumber,
      recorderName: 'M-Pesa Daraja STK',
      tillNumber: isLoan ? 'VehicleTill' : 'UtilityTill',
      ...(isLoan
        ? { savingsContribution: 0, loanRepay: effectiveAmount }
        : { savingsContribution: effectiveAmount })
    };

    applyLocalMemberBalance(creditTx);
    if (member) {
      member.lastDailyCollectionAt = nowIso;
      member.inactivityDays = 0;
    }
    localStore.transactions.unshift(creditTx);

    const paymentRecord: PaymentRecord = {
      id: `PAY-MPESA-${Date.now()}-${crypto.randomUUID().slice(0, 6)}`,
      timestamp: nowIso,
      source: 'Webhook',
      status: 'Reconciled',
      refCode: input.mpesaReceiptNumber,
      amount: effectiveAmount,
      tillNumber: isLoan ? 'VehicleTill' : 'UtilityTill',
      category: isLoan ? 'Daily Contribution' : 'Savings Contribution',
      accountReference: localTx.accountReference,
      payerName: member?.name || 'SACCO Member',
      payerPhone: localTx.phoneNumber,
      memberId: localTx.memberId,
      memberName: member?.name,
      vehiclePlate: creditTx.vehiclePlate,
      matchMethod: creditTx.vehiclePlate ? 'Vehicle Plate' : 'Phone Number',
      transactionId: creditTx.id,
      note: input.finalStatus === 'RESOLVED_RECONCILED'
        ? 'Reconciled via active Daraja status verification after callback lag.'
        : 'Captured automatically via Safaricom Daraja STK callback.'
    };
    localStore.payments.unshift(paymentRecord);

    localTx.status = input.finalStatus || 'SUCCESS';
    localTx.mpesaReceiptNumber = input.mpesaReceiptNumber;
    localTx.resultCode = input.resultCode ?? 0;
    localTx.resultDescription = input.resultDescription || 'The service request is processed successfully.';
    localTx.ledgerEntryId = creditTx.id;
    localTx.metadata = {
      ...txMeta,
      ...(input.metadataPatch || {})
    };
    localTx.updatedAt = nowIso;

    void notifyMember(localTx.memberId, {
      category: 'PAYMENT',
      title: isLoan ? 'M-Pesa Loan Repayment Credited' : 'M-Pesa Savings Deposit Credited',
      message: `KES ${effectiveAmount.toLocaleString('en-KE')} (Receipt: ${input.mpesaReceiptNumber}) has been ${isLoan ? 'deducted from your loan balance' : 'added to your SACCO savings'}.`,
      destination: 'My Account'
    });
    void notifyRole('Treasurer', {
      category: 'PAYMENT',
      title: 'M-Pesa STK Payment Reconciled',
      message: `${member?.name || 'Member'} paid KES ${effectiveAmount.toLocaleString('en-KE')} (${input.mpesaReceiptNumber}) for ${isLoan ? 'Loan Repayment' : 'Savings'}.`,
      destination: 'Daily Collections'
    });

    return localTx;
  };

  app.post('/api/v1/mpesa/stk-push', authenticateSaccoUser, async (req, res) => {
    try {
      const user = requireAuthenticatedUser(req);
      const { memberId, transactionType, accountReference, amount, phoneNumber, vehiclePlate, simulateLag, payerName } = req.body;
      if (!amount || Number(amount) <= 0) {
        throw new HttpError(400, 'Amount must be greater than zero.', 'INVALID_AMOUNT');
      }
      const resolvedMemberId = isMemberUser(user) ? (user.linkedMemberId || memberId) : memberId;
      if (!resolvedMemberId) {
        throw new HttpError(400, 'A valid member ID is required.', 'MEMBER_REQUIRED');
      }
      const normalizedPhone = normalizeMpesaPhoneNumber(phoneNumber || user.phone || '');
      const cleanPlate = sanitizeVehiclePlate(vehiclePlate || '');
      const resolvedType: SaccoTransactionType = transactionType === 'LOAN_REPAYMENT' ? 'LOAN_REPAYMENT' : 'SAVINGS';
      const resolvedAccountRef = String(
        accountReference || `${(cleanPlate || payerName || 'SACCO').replace(/[^a-zA-Z0-9]/g, '')}-${resolvedType === 'LOAN_REPAYMENT' ? 'LOAN' : 'SAV'}`
      ).slice(0, 12);

      const pushResult = await initiateStkPush({
        phoneNumber: normalizedPhone,
        amount: Number(amount),
        accountReference: resolvedAccountRef,
        transactionDesc: `Sowetamu ${resolvedType === 'LOAN_REPAYMENT' ? 'Loan' : 'Savings'}`
      });

      const txMetadata: Record<string, unknown> = {
        vehiclePlate: cleanPlate || null,
        payerName: payerName || user.name,
        simulateLag: Boolean(simulateLag),
        flaggedDelayedCallback: false,
        initiatedByUserId: user.id
      };

      let savedTx: SaccoTransaction;
      if (postgresPool) {
        savedTx = await createPendingStkTransaction(postgresPool, {
          memberId: resolvedMemberId,
          transactionType: resolvedType,
          accountReference: resolvedAccountRef,
          amount: Number(amount),
          phoneNumber: normalizedPhone,
          merchantRequestId: pushResult.merchantRequestId,
          checkoutRequestId: pushResult.checkoutRequestId,
          metadata: txMetadata
        });
      } else {
        savedTx = {
          id: crypto.randomUUID(),
          memberId: resolvedMemberId,
          transactionType: resolvedType,
          accountReference: resolvedAccountRef,
          amount: Number(amount),
          phoneNumber: normalizedPhone,
          merchantRequestId: pushResult.merchantRequestId,
          checkoutRequestId: pushResult.checkoutRequestId,
          status: 'PENDING',
          metadata: txMetadata,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString()
        };
        localStore.saccoTransactions.push(savedTx);
      }

      // In local development / sandbox mode (when live Daraja credentials are not set)
      // and when not explicitly simulating a delayed callback, simulate the handset PIN
      // entry + Safaricom webhook return after a 2.5s real-time delay.
      const darajaCfg = getDarajaConfig();
      const isMockDaraja = !darajaCfg.consumerKey || !darajaCfg.consumerSecret;
      if (isMockDaraja && !simulateLag && process.env.NODE_ENV !== 'test' && process.env.SACCO_TEST_MODE !== 'true') {
        const autoReceipt = `SOW${Date.now().toString(36).toUpperCase().slice(-5)}${Math.random().toString(36).substring(2, 5).toUpperCase()}`;
        setTimeout(() => {
          void settleStkPayment({
            checkoutRequestId: pushResult.checkoutRequestId,
            mpesaReceiptNumber: autoReceipt,
            amount: Number(amount),
            resultCode: 0,
            resultDescription: 'The service request is processed successfully (Safaricom Callback).',
            finalStatus: 'SUCCESS',
            metadataPatch: { capturedBy: 'SAFARICOM_CALLBACK' }
          }).catch(err => console.error('[M-Pesa Auto Sandbox Callback Error]', err));
        }, 2500);
      }

      res.json({
        success: true,
        message: pushResult.customerMessage,
        checkoutRequestId: pushResult.checkoutRequestId,
        merchantRequestId: pushResult.merchantRequestId,
        transaction: savedTx
      });
    } catch (error: any) {
      sendApiError(res, error);
    }
  });

  // Secure Render Webhook Callback Handler
  app.post('/api/v1/mpesa/callback', async (req, res) => {
    // 1. Immediately acknowledge within < 2 seconds to prevent Safaricom retry storms
    res.status(200).json({ ResultCode: 0, ResultDesc: 'Accepted' });

    // 2. Process callback asynchronously in background
    setImmediate(async () => {
      try {
        const callback = req.body?.Body?.stkCallback;
        if (!callback) {
          console.warn('[M-Pesa Webhook] Empty or invalid stkCallback body received.');
          return;
        }
        const { CheckoutRequestID, ResultCode, ResultDesc, CallbackMetadata } = callback;
        console.log(`[M-Pesa Webhook] Received callback: CheckoutRequestID=${CheckoutRequestID}, ResultCode=${ResultCode}`);

        const meta = parseCallbackMetadata(CallbackMetadata);

        if (ResultCode === 0 && meta.mpesaReceiptNumber) {
          await settleStkPayment({
            checkoutRequestId: CheckoutRequestID,
            mpesaReceiptNumber: meta.mpesaReceiptNumber,
            amount: meta.amount,
            resultCode: ResultCode,
            resultDescription: ResultDesc,
            finalStatus: 'SUCCESS',
            metadataPatch: { capturedBy: 'SAFARICOM_WEBHOOK' }
          });
        } else {
          // Failed or cancelled
          if (postgresPool) {
            await failStkTransaction(postgresPool, {
              checkoutRequestId: CheckoutRequestID,
              resultCode: ResultCode,
              resultDescription: ResultDesc || 'M-Pesa transaction was cancelled or failed.'
            });
          } else {
            const localTx = localStore.saccoTransactions.find(t => t.checkoutRequestId === CheckoutRequestID);
            if (localTx && localTx.status === 'PENDING') {
              localTx.status = 'FAILED';
              localTx.resultCode = ResultCode;
              localTx.resultDescription = ResultDesc;
              localTx.updatedAt = new Date().toISOString();
            }
          }
        }
      } catch (err) {
        console.error('[M-Pesa Webhook] Asynchronous processing failure:', err);
      }
    });
  });

  // Polling endpoint for frontend status
  app.get('/api/v1/mpesa/transactions/:checkoutRequestId', authenticateSaccoUser, async (req, res) => {
    try {
      const { checkoutRequestId } = req.params;
      let tx: SaccoTransaction | null = null;
      if (postgresPool) {
        tx = await getSaccoTransactionByCheckoutId(postgresPool, checkoutRequestId);
      } else {
        tx = localStore.saccoTransactions.find(t => t.checkoutRequestId === checkoutRequestId) || null;
      }
      if (!tx) {
        throw new HttpError(404, 'Transaction was not found.', 'TX_NOT_FOUND');
      }
      res.json({ transaction: tx });
    } catch (error: any) {
      sendApiError(res, error);
    }
  });

  // Active Database & Daraja Query Fallback when Safaricom callback lags or fails to arrive
  app.post('/api/v1/mpesa/transactions/:checkoutRequestId/verify', authenticateSaccoUser, async (req, res) => {
    try {
      const { checkoutRequestId } = req.params;
      const reason = String(req.body?.reason || 'Safaricom callback delayed; active database & Daraja status query triggered.');

      // Step 1: Query SACCO database first to see if transaction was already captured
      let tx: SaccoTransaction | null = null;
      if (postgresPool) {
        tx = await getSaccoTransactionByCheckoutId(postgresPool, checkoutRequestId);
      } else {
        tx = localStore.saccoTransactions.find(t => t.checkoutRequestId === checkoutRequestId) || null;
      }
      if (!tx) {
        throw new HttpError(404, 'STK Push transaction was not found in the SACCO database.', 'TX_NOT_FOUND');
      }

      if (['SUCCESS', 'RESOLVED_RECONCILED'].includes(tx.status)) {
        return res.json({
          verified: true,
          alreadyCaptured: true,
          flaggedDelayedCallback: Boolean(tx.metadata?.flaggedDelayedCallback),
          message: `Payment of KES ${tx.amount.toLocaleString('en-KE')} (Receipt: ${tx.mpesaReceiptNumber}) is already captured and reconciled in your SACCO account.`,
          transaction: tx
        });
      }

      // Step 2: Flag the transaction in the database because Safaricom notification lagged / did not return on time
      const flaggedAt = new Date().toISOString();
      if (postgresPool) {
        tx = (await flagDelayedStkTransaction(postgresPool, checkoutRequestId, reason)) || tx;
      } else {
        tx.metadata = {
          ...(tx.metadata || {}),
          flaggedDelayedCallback: true,
          flaggedAt,
          flagReason: reason
        };
        tx.updatedAt = flaggedAt;
      }

      // Step 3: Query Safaricom Daraja STK Status API directly
      const statusResult = await queryDarajaStkStatus(checkoutRequestId);
      if (statusResult.resultCode === 0) {
        const receipt = statusResult.mpesaReceiptNumber || `SOWR${Date.now().toString(36).toUpperCase().slice(-6)}`;
        const reconciledTx = await settleStkPayment({
          checkoutRequestId,
          mpesaReceiptNumber: receipt,
          amount: tx.amount,
          resultCode: 0,
          resultDescription: `${statusResult.resultDesc} (Recovered via Active Database & Daraja Status Query)`,
          finalStatus: 'RESOLVED_RECONCILED',
          metadataPatch: {
            flaggedDelayedCallback: true,
            flaggedAt,
            flagReason: reason,
            capturedBy: 'ACTIVE_DB_DARAJA_QUERY_FALLBACK'
          }
        });
        return res.json({
          verified: true,
          flaggedDelayedCallback: true,
          message: `Delayed Safaricom callback flagged and resolved! Payment of KES ${tx.amount.toLocaleString('en-KE')} (Receipt: ${receipt}) was verified with Safaricom and applied to your SACCO account.`,
          transaction: reconciledTx
        });
      }

      // If Safaricom reports failure/cancellation
      if (postgresPool) {
        tx = await failStkTransaction(postgresPool, {
          checkoutRequestId,
          resultCode: statusResult.resultCode,
          resultDescription: statusResult.resultDesc || 'Transaction not completed on handset.'
        });
      } else {
        tx.status = 'FAILED';
        tx.resultCode = statusResult.resultCode;
        tx.resultDescription = statusResult.resultDesc || 'Transaction not completed on handset.';
        tx.updatedAt = new Date().toISOString();
      }

      return res.json({
        verified: false,
        flaggedDelayedCallback: true,
        message: `Transaction flagged and queried: Safaricom reported status ${statusResult.resultCode} (${statusResult.resultDesc}).`,
        transaction: tx
      });
    } catch (error: any) {
      sendApiError(res, error);
    }
  });

  // Member transaction list
  app.get('/api/v1/mpesa/transactions/member/:memberId', authenticateSaccoUser, async (req, res) => {
    try {
      const user = requireAuthenticatedUser(req);
      const targetMemberId = isMemberUser(user) ? (user.linkedMemberId || req.params.memberId) : req.params.memberId;
      let list: SaccoTransaction[] = [];
      if (postgresPool) {
        list = await listMemberSaccoTransactions(postgresPool, targetMemberId);
      } else {
        list = localStore.saccoTransactions.filter(t => t.memberId === targetMemberId);
      }
      res.json({ transactions: list });
    } catch (error: any) {
      sendApiError(res, error);
    }
  });

  // Conversational Collections Assistant endpoint
  app.post('/api/v1/mpesa/conversational-assistant', authenticateSaccoUser, async (req, res) => {
    try {
      const user = requireAuthenticatedUser(req);
      const { message, history } = req.body;
      if (!message || typeof message !== 'string') {
        throw new HttpError(400, 'A message string is required.', 'INVALID_MESSAGE');
      }

      let member: Member | null = null;
      let loans: any[] = [];
      let savingsBalance = 0;
      let loanBalance = 0;

      if (postgresPool) {
        const memberId = user.linkedMemberId;
        if (memberId) {
          member = await getPostgresMember(postgresPool, memberId);
          loans = await listPostgresLoansByMember(postgresPool, memberId);
          loanBalance = Number(member?.loanBalance || 0);
          savingsBalance = Number(member?.savingsAmount || 0);
        }
      } else {
        member = localStore.members.find(m => m.id === user.linkedMemberId) || null;
        loanBalance = Number(member?.loanBalance || 0);
        savingsBalance = Number(member?.savingsAmount || 0);
      }

      if (!member) {
        throw new HttpError(400, 'Member context could not be identified.', 'MEMBER_NOT_FOUND');
      }

      const context: MemberFinancialContext = {
        memberId: member.id,
        fullName: member.name,
        phoneNumber: member.phoneNumber || user.phone || '',
        membershipNumber: member.membershipNumber,
        savingsBalance,
        loanBalance,
        activeLoans: loans.map(l => ({
          id: String(l.id || l.loanId),
          amount: Number(l.loanAmount || l.amount || 0),
          remainingBalance: Number(l.remainingBalance || l.balance || 0),
          dueDate: l.dueDate
        }))
      };

      const chatResponse = await processMemberChat(message, history || [], context);
      res.json(chatResponse);
    } catch (error: any) {
      sendApiError(res, error);
    }
  });

  // On-demand reconciliation trigger
  app.post('/api/v1/mpesa/reconciliation/run', authenticateSaccoUser, requirePermission('payments.reconcile'), async (_req, res) => {
    try {
      if (!postgresPool) {
        return res.json({ message: 'PostgreSQL inactive; running in mock local mode.', report: { totalPendingScanned: 0 } });
      }
      const report = await runNightlyReconciliation(postgresPool, async (rep) => {
        await notifyRole('Chairman', {
          category: 'AUDIT',
          title: 'Nightly M-Pesa Reconciliation Complete',
          message: `Audited ${rep.totalPendingScanned} pending items: ${rep.reconciledSuccessCount} auto-reconciled, ${rep.expiredUnpaidCount} expired.`,
          destination: '/payments'
        });
      });
      res.json({ success: true, report });
    } catch (error: any) {
      sendApiError(res, error);
    }
  });

  app.use('/api', (req, res) => {
    res.status(404).json({
      error: 'The requested API endpoint does not exist.',
      code: 'API_ROUTE_NOT_FOUND',
      method: req.method,
      path: req.originalUrl.split('?')[0]
    });
  });

  // The standalone Node runtime serves the SPA with Vite in development and
  // from its production static build in deployed environments.
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
