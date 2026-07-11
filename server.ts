import 'dotenv/config';
import express from 'express';
import path from 'path';
import crypto from 'node:crypto';
import { createServer as createViteServer } from 'vite';
import { Firestore } from '@google-cloud/firestore';
import { Pool } from 'pg';
import { applicationDefault, cert, getApps, initializeApp as initializeFirebaseAdminApp } from 'firebase-admin/app';
import { getAuth, type DecodedIdToken } from 'firebase-admin/auth';
import {
  PersistenceError,
  correctPostgresTransaction,
  createPostgresMember,
  createPostgresTransaction,
  createPostgresVehicle,
  findPostgresPaymentByRef,
  listPostgresMembers,
  listPostgresPayments,
  listPostgresTransactions,
  listPostgresUsers,
  listPostgresVehicles,
  reconcilePostgresPayment,
  reversePostgresTransaction,
  savePostgresPayment
} from './src/server/postgresStore';
import {
  LedgerPolicyError,
  getDailyContributionBalanceDelta,
  matchPaymentMember,
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
import type {
  Member,
  PaymentRecord,
  PaymentSource,
  PaymentStatus,
  Transaction,
  TransactionCategory,
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

type IncomingPaymentInput = {
  source: PaymentSource;
  refCode: string;
  amount: number | string;
  shortcode: string;
  accountReference?: string;
  payerPhone?: string;
  payerName?: string;
  memberId?: string;
  category?: TransactionCategory;
  rawPayload?: unknown;
  recorderName: string;
};

type AuthorizedUser = {
  id: string;
  name: string;
  email: string;
  role: UserRole;
  phone: string;
  firebaseUid?: string;
  isActive?: boolean;
  devPassword?: string;
};

const initialUsers: AuthorizedUser[] = [];
const initialMembers: Member[] = [];
const initialVehicles: any[] = [];
const initialTransactions: Transaction[] = [];
type DarajaMode = 'sandbox' | 'production';

const JWT_ISSUER = 'matatu-sacco-management-system';
const JWT_AUDIENCE = 'sacco-api';
const DEFAULT_JWT_EXPIRES_SECONDS = 60 * 60 * 8;
const isProduction = process.env.NODE_ENV === 'production';
const postgresPool = process.env.DATABASE_URL
  ? new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: process.env.DATABASE_SSL === 'true' ? { rejectUnauthorized: false } : undefined
    })
  : null;

function getFirebaseAdminAuth() {
  const projectId = process.env.FIREBASE_PROJECT_ID || process.env.GOOGLE_CLOUD_PROJECT || process.env.GCLOUD_PROJECT;
  if (!getApps().length) {
    if (process.env.FIREBASE_SERVICE_ACCOUNT_JSON) {
      initializeFirebaseAdminApp({
        credential: cert(JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON)),
        projectId
      });
    } else if (process.env.GOOGLE_APPLICATION_CREDENTIALS) {
      initializeFirebaseAdminApp({
        credential: applicationDefault(),
        projectId
      });
    } else if (projectId) {
      // Verifying Firebase ID tokens only requires the project ID. The Admin
      // SDK fetches Google's public signing certificates without a private key.
      initializeFirebaseAdminApp({ projectId });
    } else {
      return null;
    }
  }

  return getAuth();
}

function mapDbUser(row: any): AuthorizedUser {
  return {
    id: String(row.id),
    name: row.full_name,
    email: row.email,
    role: row.role as UserRole,
    phone: row.phone || '',
    firebaseUid: row.firebase_uid || undefined,
    isActive: row.is_active !== false
  };
}

async function findSaccoUserByFirebaseToken(decodedToken: DecodedIdToken): Promise<AuthorizedUser> {
  const email = String(decodedToken.email || '').toLowerCase();
  if (postgresPool) {
    const result = await postgresPool.query(
      `SELECT id, firebase_uid, full_name, email, phone, role, is_active
       FROM users
       WHERE (firebase_uid = $1 OR lower(email) = $2)
       LIMIT 1`,
      [decodedToken.uid, email]
    );

    if (!result.rowCount) {
      throw new HttpError(403, 'Firebase identity is valid, but no active SACCO profile exists for this user.', 'SACCO_PROFILE_NOT_FOUND');
    }

    const user = mapDbUser(result.rows[0]);
    if (!user.isActive) {
      throw new HttpError(403, 'This SACCO profile has been deactivated.', 'SACCO_PROFILE_DISABLED');
    }

    if (!user.firebaseUid && user.id) {
      await postgresPool.query(
        'UPDATE users SET firebase_uid = $1, last_login_at = now() WHERE id = $2',
        [decodedToken.uid, user.id]
      );
      user.firebaseUid = decodedToken.uid;
    } else {
      await postgresPool.query('UPDATE users SET last_login_at = now() WHERE id = $1', [user.id]);
    }

    return user;
  }

  const user = localStore.users.find(item => item.email.toLowerCase() === email);
  if (!user) {
    throw new HttpError(403, 'Firebase identity is valid, but no local SACCO profile exists for this email.', 'SACCO_PROFILE_NOT_FOUND');
  }

  return {
    ...user,
    firebaseUid: decodedToken.uid,
    isActive: true
  };
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
        auth_provider, firebase_uid, ip_address, user_agent
      )
      VALUES (
        $1, $2, $3, $4, $5::jsonb, $6::jsonb, $7, $8, $9, $10
      )`,
      [
        user?.id?.match(/^[0-9a-f-]{36}$/i) ? user.id : null,
        action,
        entityTable,
        entityId?.match(/^[0-9a-f-]{36}$/i) ? entityId : null,
        oldData ? JSON.stringify(oldData) : null,
        newData ? JSON.stringify(newData) : null,
        authContext.provider || null,
        authContext.firebaseUid || user?.firebaseUid || null,
        req.ip,
        req.headers['user-agent'] || null
      ]
    );
  } catch (error: any) {
    console.warn('[Sacco Audit] Failed to write audit log:', error.message || error);
  }
}

async function countSaccoUsers(): Promise<number> {
  if (postgresPool) {
    const result = await postgresPool.query('SELECT COUNT(*)::int AS count FROM users');
    return Number(result.rows[0]?.count || 0);
  }

  if (useFirestore) {
    return safeDbOperation(
      async (firestoreDb) => {
        const snap = await firestoreDb.collection('users').limit(1).get();
        return snap.empty ? 0 : 1;
      },
      () => localStore.users.length,
      'users'
    );
  }

  return localStore.users.length;
}

async function createFirstAdminProfile(input: {
  firebaseUid?: string;
  email: string;
  fullName: string;
  phone?: string;
  devPassword?: string;
}): Promise<AuthorizedUser> {
  const email = input.email.trim().toLowerCase();
  const fullName = input.fullName.trim();
  if (!email || !fullName) {
    throw new HttpError(400, 'Full name and email are required to create the first SACCO admin.', 'BOOTSTRAP_FIELDS_REQUIRED');
  }

  if (postgresPool) {
    const result = await postgresPool.query(
      `INSERT INTO users (firebase_uid, full_name, email, phone, role, password_hash, is_active)
       VALUES ($1, $2, $3, $4, 'Chairman', crypt(NULLIF($5, ''), gen_salt('bf')), TRUE)
       ON CONFLICT (email) DO UPDATE SET
         firebase_uid = COALESCE(users.firebase_uid, EXCLUDED.firebase_uid),
         full_name = EXCLUDED.full_name,
         phone = EXCLUDED.phone,
         role = 'Chairman',
         password_hash = COALESCE(users.password_hash, EXCLUDED.password_hash),
         is_active = TRUE,
         updated_at = now()
       RETURNING id, firebase_uid, full_name, email, phone, role, is_active`,
      [input.firebaseUid || null, fullName, email, input.phone || null, input.devPassword || null]
    );
    return mapDbUser(result.rows[0]);
  }

  const newUser: AuthorizedUser = {
    id: `u-${Date.now()}`,
    name: fullName,
    email,
    phone: input.phone || '',
    role: 'Chairman',
    firebaseUid: input.firebaseUid,
    isActive: true,
    devPassword: input.devPassword
  };

  await safeDbOperation(
    async (firestoreDb) => {
      await firestoreDb.collection('users').doc(newUser.id).set(newUser);
    },
    () => {
      localStore.users.push(newUser);
    },
    'users'
  );

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
      `SELECT id, firebase_uid, full_name, email, phone, role, is_active
       FROM users
       WHERE lower(email) = $1
       LIMIT 1`,
      [email]
    );
    return result.rowCount ? mapDbUser(result.rows[0]) : null;
  }

  if (useFirestore) {
    return safeDbOperation<AuthorizedUser | null>(
      async firestoreDb => {
        const snap = await firestoreDb.collection('users').where('email', '==', email).limit(1).get();
        return snap.empty ? null : snap.docs[0].data() as AuthorizedUser;
      },
      () => localStore.users.find(item => item.email.toLowerCase() === email) || null,
      'users'
    );
  }

  return localStore.users.find(item => item.email.toLowerCase() === email) || null;
}

async function authenticateDevelopmentUser(email: string, password: string): Promise<AuthorizedUser | null> {
  if (postgresPool) {
    const result = await postgresPool.query(
      `SELECT id, firebase_uid, full_name, email, phone, role, is_active
       FROM users
       WHERE lower(email) = $1
         AND password_hash IS NOT NULL
         AND password_hash = crypt($2, password_hash)
       LIMIT 1`,
      [email, password]
    );
    return result.rowCount ? mapDbUser(result.rows[0]) : null;
  }

  const user = await findDevelopmentUserByEmail(email);
  return user?.devPassword && password === user.devPassword ? user : null;
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

  // Local fallback profiles are recreated when the development server restarts.
  // Their temporary internal ID can change, but the signed email and role remain
  // the stable identity. This keeps an otherwise valid browser session usable.
  const tokenEmail = String(payload.email || '').trim().toLowerCase();
  const user = await findDevelopmentUserByEmail(tokenEmail);
  if (!user || user.role !== payload.role || user.isActive === false) {
    throw new HttpError(401, 'Authentication token user is no longer authorized.', 'JWT_USER_REVOKED');
  }

  return user;
}

function getDarajaMode(value: unknown = process.env.DARAJA_MODE): DarajaMode {
  return value === 'production' ? 'production' : 'sandbox';
}

function getDarajaBaseUrl(mode: DarajaMode): string {
  return mode === 'production' ? 'https://api.safaricom.co.ke' : 'https://sandbox.safaricom.co.ke';
}

function parsePublicDarajaCallbackUrl(value: unknown, fieldName: string): URL {
  let callbackUrl: URL;
  try {
    callbackUrl = new URL(String(value || '').trim());
  } catch {
    throw new HttpError(400, `${fieldName} must be a valid public HTTPS URL.`, 'INVALID_CALLBACK_URL');
  }

  const host = callbackUrl.hostname.toLowerCase();
  const isPrivateIpv4 = /^(127\.|10\.|0\.|169\.254\.|192\.168\.|172\.(1[6-9]|2\d|3[0-1])\.)/.test(host);
  const isLocalHost = host === 'localhost' || host.endsWith('.localhost') || host === '::1' || host === '[::1]';
  if (callbackUrl.protocol !== 'https:' || !host || isPrivateIpv4 || isLocalHost) {
    throw new HttpError(400, `${fieldName} must use a publicly reachable HTTPS domain, not localhost or a private address.`, 'INVALID_CALLBACK_URL');
  }

  return callbackUrl;
}

function getDarajaSafeConfig(overrides: { shortcode?: unknown; mode?: unknown } = {}) {
  const mode = getDarajaMode(overrides.mode);
  const shortcode = String(overrides.shortcode || process.env.DARAJA_SHORTCODE || '').trim();
  const callbackBaseUrl = String(process.env.DARAJA_CALLBACK_BASE_URL || process.env.APP_URL || '').replace(/\/+$/, '');
  const consumerKey = process.env.DARAJA_CONSUMER_KEY || '';
  const consumerSecret = process.env.DARAJA_CONSUMER_SECRET || '';

  return {
    mode,
    shortcode,
    callbackBaseUrl,
    hasConsumerKey: Boolean(consumerKey),
    hasConsumerSecret: Boolean(consumerSecret),
    credentialsConfigured: Boolean(consumerKey && consumerSecret),
    stkPushEnabled: process.env.DARAJA_STK_PUSH_ENABLED !== 'false'
  };
}

function getDarajaCredentials() {
  const consumerKey = process.env.DARAJA_CONSUMER_KEY || '';
  const consumerSecret = process.env.DARAJA_CONSUMER_SECRET || '';
  if (!consumerKey || !consumerSecret) {
    throw new HttpError(400, 'Daraja credentials are not configured. Set DARAJA_CONSUMER_KEY and DARAJA_CONSUMER_SECRET on the server.', 'DARAJA_CREDENTIALS_MISSING');
  }
  return { consumerKey, consumerSecret };
}

async function getDarajaAccessToken(mode: DarajaMode): Promise<string> {
  const { consumerKey, consumerSecret } = getDarajaCredentials();
  const authHeader = Buffer.from(`${consumerKey}:${consumerSecret}`).toString('base64');
  const tokenRes = await fetch(`${getDarajaBaseUrl(mode)}/oauth/v1/generate?grant_type=client_credentials`, {
    method: 'GET',
    headers: {
      Authorization: `Basic ${authHeader}`
    }
  });

  if (!tokenRes.ok) {
    const errText = await tokenRes.text();
    throw new HttpError(400, `Failed to authenticate with Safaricom Daraja API. Status: ${tokenRes.status}`, errText);
  }

  const tokenData = await tokenRes.json() as any;
  if (!tokenData.access_token) {
    throw new HttpError(400, 'Safaricom response did not contain an access_token.', 'DARAJA_TOKEN_MISSING');
  }

  return tokenData.access_token;
}

const defaultMPesaConfig = {
  shortcode: process.env.DARAJA_SHORTCODE || '',
  callbackUrl: process.env.DARAJA_CALLBACK_BASE_URL || '',
  mode: getDarajaMode(),
  stkPushEnabled: process.env.DARAJA_STK_PUSH_ENABLED !== 'false'
};

// Optional Firestore development adapter.
const firestoreOptions: ConstructorParameters<typeof Firestore>[0] = {};
const firestoreProjectId = process.env.GOOGLE_CLOUD_PROJECT || process.env.GCLOUD_PROJECT;
if (firestoreProjectId) {
  firestoreOptions.projectId = firestoreProjectId;
}
if (process.env.FIRESTORE_DATABASE_ID) {
  firestoreOptions.databaseId = process.env.FIRESTORE_DATABASE_ID;
}
const db = new Firestore(firestoreOptions);

// Disposable in-memory store, available only through an explicit development flag.
const localStore = {
  users: [...initialUsers],
  members: [...initialMembers],
  vehicles: [...initialVehicles],
  transactions: [...initialTransactions],
  payments: [] as PaymentRecord[],
  mpesaConfig: { ...defaultMPesaConfig }
};

// Firestore is used only when its development credentials are configured.
let useFirestore = Boolean(
  process.env.GOOGLE_APPLICATION_CREDENTIALS ||
  process.env.GOOGLE_CLOUD_PROJECT ||
  process.env.GCLOUD_PROJECT
);
const allowInMemoryStore = !isProduction && process.env.ALLOW_IN_MEMORY_DB === 'true';

// Firestore errors fail closed; the in-memory adapter is selected only at startup.
async function safeDbOperation<T>(
  operation: (firestoreDb: Firestore) => Promise<T>,
  fallback: () => T | Promise<T>,
  collectionName: string
): Promise<T> {
  if (!useFirestore) {
    if (allowInMemoryStore) {
      return Promise.resolve(fallback());
    }
    throw new HttpError(
      503,
      'No persistent database is configured. Set DATABASE_URL or Firestore credentials. Use ALLOW_IN_MEMORY_DB=true only for disposable local development.',
      'DATABASE_NOT_CONFIGURED'
    );
  }
  try {
    return await operation(db);
  } catch (error: any) {
    if (error instanceof HttpError || error instanceof LedgerPolicyError) {
      throw error;
    }
    console.error(`[Sacco Ledger OS] Firestore operation failed for [${collectionName}].`, error.message || error);
    throw new HttpError(503, `Persistent storage is unavailable for ${collectionName}. Retry after restoring the database connection.`, 'DATABASE_UNAVAILABLE');
  }
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

async function applyFirestoreMemberBalance(firestoreDb: Firestore, tx: Transaction) {
  const delta = getDailyContributionBalanceDelta(tx);
  if (!delta.shares && !delta.savings && !delta.loan) return;

  const memberRef = firestoreDb.collection('members').doc(tx.memberId || '');
  const memberSnap = await memberRef.get();
  if (!memberSnap.exists) {
    throw new HttpError(404, 'Linked Sacco member profile was not found.', 'MEMBER_NOT_FOUND');
  }

  const currentMemberData = memberSnap.data() || {};
  await memberRef.set({
    ...currentMemberData,
    sharesAmount: Math.max(0, Number(currentMemberData.sharesAmount || 0) + delta.shares),
    savingsAmount: Math.max(0, Number(currentMemberData.savingsAmount || 0) + delta.savings),
    loanBalance: Math.min(
      Number(currentMemberData.initialLoanAmount ?? currentMemberData.loanBalance ?? 0),
      Math.max(0, Number(currentMemberData.loanBalance || 0) + delta.loan)
    )
  }, { merge: true });
}

async function createLedgerTransaction(input: LedgerInput): Promise<Transaction> {
  const tx = normalizeTransactionInput(input);
  await validateLedgerRegistration(tx);

  if (postgresPool) {
    return createPostgresTransaction(postgresPool, tx);
  }

  await safeDbOperation(
    async (firestoreDb) => {
      const duplicateSnap = await firestoreDb
        .collection('transactions')
        .where('refCode', '==', tx.refCode)
        .limit(1)
        .get();

      if (!duplicateSnap.empty) {
        throw new HttpError(409, `Reference code ${tx.refCode} already exists in the ledger.`, 'DUPLICATE_LEDGER_REF');
      }

      await applyFirestoreMemberBalance(firestoreDb, tx);
      await firestoreDb.collection('transactions').doc(tx.id).set(tx);
    },
    () => {
      const duplicate = localStore.transactions.some(t => normalizeRefCode(t.refCode) === tx.refCode);
      if (duplicate) {
        throw new HttpError(409, `Reference code ${tx.refCode} already exists in the ledger.`, 'DUPLICATE_LEDGER_REF');
      }

      applyLocalMemberBalance(tx);
      localStore.transactions.push(tx);
    },
    'transactions'
  );

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
  const original = await safeDbOperation<Transaction | null>(
    async firestoreDb => {
      const snap = await firestoreDb.collection('transactions').doc(transactionId).get();
      return snap.exists ? snap.data() as Transaction : null;
    },
    () => localStore.transactions.find(tx => tx.id === transactionId) || null,
    'transactions'
  );
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

  await safeDbOperation(
    async firestoreDb => {
      await applyFirestoreMemberBalance(firestoreDb, reverseOriginal);
      await applyFirestoreMemberBalance(firestoreDb, updated);
      await firestoreDb.collection('transactions').doc(transactionId).set(updated);
    },
    () => {
      applyLocalMemberBalance(reverseOriginal);
      applyLocalMemberBalance(updated);
      const index = localStore.transactions.findIndex(tx => tx.id === transactionId);
      localStore.transactions[index] = updated;
    },
    'transactions'
  );
  return updated;
}

async function reverseLedgerTransaction(transactionId: string, recorderName: string): Promise<Transaction> {
  if (postgresPool) {
    return reversePostgresTransaction(postgresPool, transactionId, recorderName);
  }
  const original = await safeDbOperation<Transaction | null>(
    async (firestoreDb) => {
      const snap = await firestoreDb.collection('transactions').doc(transactionId).get();
      return snap.exists ? snap.data() as Transaction : null;
    },
    () => localStore.transactions.find(tx => tx.id === transactionId) || null,
    'transactions'
  );

  if (!original) {
    throw new HttpError(404, 'Transaction to reverse was not found.', 'TRANSACTION_NOT_FOUND');
  }

  const existingReversal = await safeDbOperation<Transaction | null>(
    async (firestoreDb) => {
      const snap = await firestoreDb
        .collection('transactions')
        .where('reversalOf', '==', original.id)
        .limit(1)
        .get();
      return snap.empty ? null : snap.docs[0].data() as Transaction;
    },
    () => localStore.transactions.find(tx => tx.reversalOf === original.id) || null,
    'transactions'
  );

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
  return res.status(500).json({ error: error.message || 'Unexpected server error.' });
}

function getTillFromShortcode(shortcode: unknown): { tillNumber: 'VehicleTill' | 'UtilityTill'; category: TransactionCategory; paybillName: string } {
  if (String(shortcode) === '4810294') {
    return {
      tillNumber: 'UtilityTill',
      category: 'Management Fee',
      paybillName: 'Operating Utility Till (No. 481 0294)'
    };
  }

  return {
    tillNumber: 'VehicleTill',
    category: 'Daily Contribution',
    paybillName: 'Vehicle Fleet Till (No. 824 9102)'
  };
}

async function listPaymentRecords(): Promise<PaymentRecord[]> {
  if (postgresPool) {
    return listPostgresPayments(postgresPool);
  }

  const list = await safeDbOperation<PaymentRecord[]>(
    async (firestoreDb) => {
      const snap = await firestoreDb.collection('payments').get();
      return snap.docs.map(doc => doc.data() as PaymentRecord);
    },
    () => localStore.payments,
    'payments'
  );

  return [...list].sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
}

async function savePaymentRecord(record: PaymentRecord): Promise<PaymentRecord> {
  if (postgresPool) {
    return savePostgresPayment(postgresPool, record);
  }

  await safeDbOperation(
    async (firestoreDb) => {
      await firestoreDb.collection('payments').doc(record.id).set(record);
    },
    () => {
      const idx = localStore.payments.findIndex(payment => payment.id === record.id);
      if (idx >= 0) {
        localStore.payments[idx] = record;
      } else {
        localStore.payments.push(record);
      }
    },
    'payments'
  );

  return record;
}

async function findPaymentByRef(refCode: string): Promise<PaymentRecord | null> {
  if (postgresPool) {
    return findPostgresPaymentByRef(postgresPool, refCode);
  }

  return safeDbOperation<PaymentRecord | null>(
    async (firestoreDb) => {
      const snap = await firestoreDb.collection('payments').where('refCode', '==', refCode).limit(1).get();
      return snap.empty ? null : snap.docs[0].data() as PaymentRecord;
    },
    () => localStore.payments.find(payment => payment.refCode === refCode) || null,
    'payments'
  );
}

async function getAllMembers(): Promise<Member[]> {
  if (postgresPool) {
    return listPostgresMembers(postgresPool);
  }

  return safeDbOperation<Member[]>(
    async (firestoreDb) => {
      const snap = await firestoreDb.collection('members').get();
      return snap.docs.map(doc => doc.data() as Member);
    },
    () => localStore.members as Member[],
    'members'
  );
}

async function getAllVehicles(): Promise<Vehicle[]> {
  if (postgresPool) {
    return listPostgresVehicles(postgresPool);
  }

  return safeDbOperation<Vehicle[]>(
    async (firestoreDb) => {
      const snap = await firestoreDb.collection('vehicles').get();
      return snap.docs.map(doc => doc.data() as Vehicle);
    },
    () => localStore.vehicles as Vehicle[],
    'vehicles'
  );
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

async function processIncomingPayment(input: IncomingPaymentInput): Promise<PaymentRecord> {
  const refCode = normalizeRefCode(input.refCode);
  const amount = Number(input.amount);
  if (!refCode) {
    throw new HttpError(400, 'Payment reference code is required.', 'MISSING_PAYMENT_REF');
  }
  if (!Number.isFinite(amount) || amount <= 0) {
    throw new HttpError(400, 'Payment amount must be greater than zero.', 'INVALID_PAYMENT_AMOUNT');
  }

  const existing = await findPaymentByRef(refCode);
  if (existing) {
    return {
      ...existing,
      status: existing.status === 'Reconciled' ? 'Duplicate' : existing.status,
      note: `Duplicate callback or manual entry detected for ${refCode}.`
    };
  }

  const tillConfig = getTillFromShortcode(input.shortcode);
  const category = input.category || tillConfig.category;
  const [allMembers, allVehicles] = await Promise.all([getAllMembers(), getAllVehicles()]);
  const accountReference = String(input.accountReference || '').trim();
  const payerPhone = String(input.payerPhone || '').trim();
  const { member, matchMethod } = matchPaymentMember(allMembers, accountReference, payerPhone, input.memberId);
  const payerName = input.payerName || (member ? member.name : 'Unmatched M-Pesa Payer');
  const normalizedAccountReference = accountReference.replace(/\s+/g, '').toUpperCase();
  const matchedVehicle = member && normalizedAccountReference
    ? allVehicles.find(vehicle =>
        vehicle.ownerId === member.id &&
        vehicle.status === 'Active' &&
        vehicle.plateNumber.replace(/\s+/g, '').toUpperCase() === normalizedAccountReference
      )
    : undefined;
  const canAutoReconcile = Boolean(member && member.status === 'Active');

  if (input.source === 'Manual') {
    if (!member || !canAutoReconcile) {
      throw new HttpError(400, 'Select an active registered member before logging a manual payment.', 'REGISTERED_MEMBER_REQUIRED');
    }
    if (normalizedAccountReference && !matchedVehicle) {
      const submittedVehicle = allVehicles.find(vehicle =>
        vehicle.plateNumber.replace(/\s+/g, '').toUpperCase() === normalizedAccountReference
      );
      if (!submittedVehicle) {
        throw new HttpError(400, `Car/V.REG "${accountReference}" is not registered.`, 'VEHICLE_NOT_REGISTERED');
      }
      if (submittedVehicle.ownerId !== member.id) {
        throw new HttpError(400, `Car/V.REG "${submittedVehicle.plateNumber}" is not registered under ${member.name}.`, 'MEMBER_VEHICLE_MISMATCH');
      }
      throw new HttpError(409, `Car/V.REG "${submittedVehicle.plateNumber}" is not active.`, 'VEHICLE_NOT_ACTIVE');
    }
  }

  let payment: PaymentRecord = {
    id: `pay-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
    timestamp: new Date().toISOString(),
    source: input.source,
    status: canAutoReconcile ? 'Pending' : 'Unmatched',
    refCode,
    amount,
    tillNumber: tillConfig.tillNumber,
    category,
    accountReference,
    payerName,
    payerPhone,
    memberId: member?.id,
    memberName: member?.name,
    vehiclePlate: matchedVehicle?.plateNumber || accountReference,
    matchMethod,
    rawPayload: input.rawPayload,
    note: canAutoReconcile
      ? `Matched by ${matchMethod}.`
      : member
        ? 'Member matched, but the profile is not active.'
        : 'Awaiting accountant reconciliation.'
  };

  if (!member || !canAutoReconcile) {
    return savePaymentRecord(payment);
  }

  const transactionInput = normalizeTransactionInput({
    id: `t-mpesa-${Date.now()}`,
    timestamp: payment.timestamp,
    memberId: member.id,
    memberName: member.name,
    vehiclePlate: matchedVehicle?.plateNumber || '',
    description: `M-Pesa ${input.source.toLowerCase()} payment of KES ${amount.toLocaleString()} received on ${tillConfig.paybillName} (Account Ref: ${accountReference || 'N/A'}). Reconciled automatically.`,
    refCode,
    type: 'Credit',
    category,
    amount,
    recorderName: input.recorderName,
    tillNumber: tillConfig.tillNumber
  });
  await validateLedgerRegistration(transactionInput);

  payment = {
    ...payment,
    status: 'Reconciled',
    note: `Auto-reconciled by ${matchMethod}.`
  };

  if (postgresPool) {
    return reconcilePostgresPayment(postgresPool, payment, transactionInput);
  }

  const transaction = await createLedgerTransaction(transactionInput);
  payment.transactionId = transaction.id;
  return savePaymentRecord(payment);
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
    id: `t-mpesa-${Date.now()}`,
    timestamp: new Date().toISOString(),
    memberId: member.id,
    memberName: member.name,
    vehiclePlate: memberVehicle?.plateNumber || '',
    description: `M-Pesa unmatched payment of KES ${payment.amount.toLocaleString()} assigned to ${member.name}. Original Account Ref: ${payment.accountReference || 'N/A'}.`,
    refCode: payment.refCode,
    type: 'Credit',
    category: payment.category,
    amount: payment.amount,
    recorderName,
    tillNumber: payment.tillNumber
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

async function authenticateFirebaseBearer(req: express.Request): Promise<AuthorizedUser> {
  const authHeader = req.headers.authorization || '';
  if (!authHeader.startsWith('Bearer ')) {
    throw new HttpError(401, 'Firebase ID token is required.', 'FIREBASE_TOKEN_MISSING');
  }

  const adminAuth = getFirebaseAdminAuth();
  if (!adminAuth) {
    throw new HttpError(503, 'Firebase Admin credentials are not configured on the server.', 'FIREBASE_ADMIN_NOT_CONFIGURED');
  }

  let decodedToken: DecodedIdToken;
  try {
    decodedToken = await adminAuth.verifyIdToken(authHeader.slice('Bearer '.length).trim());
  } catch (error: any) {
    const code = String(error?.code || error?.errorInfo?.code || '');
    if (code.startsWith('auth/')) {
      throw new HttpError(401, 'Firebase ID token is invalid, expired, or revoked.', 'FIREBASE_TOKEN_INVALID');
    }
    throw error;
  }
  const user = await findSaccoUserByFirebaseToken(decodedToken);
  (req as any).authContext = {
    provider: 'firebase',
    firebaseUid: decodedToken.uid,
    email: decodedToken.email
  };
  return user;
}

// Sacco Security OS Authentication Middleware
const authenticateSaccoUser = async (req: express.Request, res: express.Response, next: express.NextFunction) => {
  try {
    const authHeader = req.headers.authorization || '';
    if (authHeader.startsWith('Bearer ')) {
      try {
        (req as any).user = await authenticateFirebaseBearer(req);
        await recordAuditLog(req, 'API_AUTHORIZED', req.path);
        return next();
      } catch (firebaseError: any) {
        const allowDevJwt = !isProduction && process.env.ALLOW_DEV_JWT_AUTH === 'true';
        if (!allowDevJwt) {
          throw firebaseError;
        }

        (req as any).user = await verifyJwt(authHeader.slice('Bearer '.length).trim());
        (req as any).authContext = {
          provider: 'dev-jwt',
          email: (req as any).user.email
        };
        await recordAuditLog(req, 'API_AUTHORIZED_DEV_JWT', req.path);
        return next();
      }
    }

    return res.status(401).json({ error: 'Firebase Bearer token authentication is required.' });
  } catch (error: any) {
    if (error instanceof HttpError) {
      return res.status(error.status).json({ error: error.message, code: error.code });
    }
    return res.status(401).json({ error: 'Invalid authentication token.' });
  }
};

const requireRoles = (allowedRoles: string[]) => {
  return async (req: express.Request, res: express.Response, next: express.NextFunction) => {
    const user = (req as any).user;
    if (!user || !allowedRoles.includes(user.role)) {
      await recordAuditLog(req, 'API_AUTHORIZATION_DENIED', req.path, undefined, undefined, {
        requiredRoles: allowedRoles,
        actualRole: user?.role || 'Unknown'
      });
      return res.status(403).json({ 
        error: `Sacco Access Control Breach Blocked: Role [${user?.role || 'Unknown'}] is restricted from this operational directory.` 
      });
    }
    next();
  };
};

// Verify the selected persistence adapter before accepting requests.
async function seedDatabaseIfEmpty() {
  if (postgresPool) {
    await postgresPool.query('SELECT 1');
    console.log('PostgreSQL connection check complete.');
    return;
  }

  if (isProduction) {
    throw new Error('DATABASE_URL is required in production. Firestore and in-memory storage are development adapters only.');
  }

  if (!useFirestore) {
    if (allowInMemoryStore) {
      console.warn('No persistent database configured. ALLOW_IN_MEMORY_DB is enabled; all development data will be lost when the server stops.');
    } else {
      console.warn('No persistent database configured. Functional API requests will fail closed.');
    }
    return;
  }

  console.log("Checking Firestore connection...");
  try {
    await db.collection('system').doc('status').get();
    console.log("Firestore connection check complete. No sample data was seeded.");
  } catch (error: any) {
    throw new Error(`Firestore connection failed during startup: ${error.message || error}`);
  }
}

async function startServer() {
  const app = express();
  const PORT = Number(process.env.PORT || 3000);

  app.use(express.json());

  // Run database seeding
  await seedDatabaseIfEmpty();

  // API 1: Healthcheck
  app.get('/api/health', (req, res) => {
    res.json({
      status: 'ok',
      database: postgresPool ? 'postgres_configured' : (useFirestore ? 'firestore_connected' : 'local_fallback'),
      auth: getFirebaseAdminAuth() ? 'firebase_admin_configured' : 'firebase_admin_missing',
      timestamp: new Date().toISOString()
    });
  });

  app.post('/api/auth/session', async (req, res) => {
    try {
      const user = await authenticateFirebaseBearer(req);
      (req as any).user = user;
      await recordAuditLog(req, 'USER_LOGIN', 'users', user.id, undefined, { email: user.email, role: user.role });
      res.json({
        user,
        tokenType: 'FirebaseIdToken',
        authProvider: 'firebase'
      });
    } catch (error: any) {
      sendApiError(res, error);
    }
  });

  app.post('/api/auth/bootstrap', async (req, res) => {
    try {
      const existingUsers = await countSaccoUsers();
      if (existingUsers > 0) {
        return res.status(409).json({ error: 'SACCO onboarding is already complete. Ask an existing admin to create your profile.' });
      }

      const authHeader = req.headers.authorization || '';
      const adminAuth = getFirebaseAdminAuth();
      let firebaseUid: string | undefined;
      let email = String(req.body?.email || '').trim().toLowerCase();
      let fullName = String(req.body?.fullName || '').trim();

      if (authHeader.startsWith('Bearer ') && adminAuth) {
        const decoded = await adminAuth.verifyIdToken(authHeader.slice('Bearer '.length).trim());
        firebaseUid = decoded.uid;
        email = String(decoded.email || email).trim().toLowerCase();
        fullName = fullName || String(decoded.name || '').trim();
      } else {
        const allowDevBootstrap = !isProduction && process.env.ALLOW_DEV_AUTH_FALLBACK === 'true';
        if (!allowDevBootstrap) {
          return res.status(401).json({ error: 'Firebase ID token is required to bootstrap the first admin.' });
        }
        if (String(req.body?.password || '').length < 8) {
          return res.status(400).json({ error: 'Create a password with at least 8 characters.', code: 'BOOTSTRAP_PASSWORD_REQUIRED' });
        }
      }

      const user = await createFirstAdminProfile({
        firebaseUid,
        email,
        fullName,
        phone: String(req.body?.phone || '').trim(),
        devPassword: firebaseUid ? undefined : String(req.body?.password || '')
      });
      (req as any).user = user;
      (req as any).authContext = {
        provider: firebaseUid ? 'firebase-bootstrap' : 'dev-bootstrap',
        firebaseUid,
        email
      };
      await recordAuditLog(req, 'FIRST_ADMIN_BOOTSTRAPPED', 'users', user.id, undefined, { email: user.email, role: user.role });

      const devToken = firebaseUid ? undefined : signJwt(user);
      return res.status(201).json({
        user,
        token: devToken?.token,
        tokenType: firebaseUid ? 'FirebaseIdToken' : 'DevJwt',
        authProvider: firebaseUid ? 'firebase' : 'dev'
      });
    } catch (error: any) {
      sendApiError(res, error);
    }
  });

  app.post('/api/auth/login', async (req, res) => {
    try {
      const allowDevLogin = !isProduction && process.env.ALLOW_DEV_AUTH_FALLBACK === 'true';
      if (!allowDevLogin) {
        return res.status(404).json({ error: 'Password login is disabled. Use Firebase Auth.' });
      }

      const { email, password } = req.body || {};
      const user = await authenticateDevelopmentUser(
        String(email || '').trim().toLowerCase(),
        String(password || '')
      );
      if (!user || user.isActive === false) {
        return res.status(401).json({ error: 'Invalid Sacco profile or password.' });
      }

      const signed = signJwt(user);
      res.json({
        user,
        token: signed.token,
        expiresAt: signed.expiresAt,
        tokenType: 'Bearer'
      });
    } catch (error: any) {
      sendApiError(res, error);
    }
  });

  // Protect all functional API endpoints with Sacco Zero-Trust validation
  app.use('/api/users', authenticateSaccoUser);
  app.use('/api/members', authenticateSaccoUser);
  app.use('/api/vehicles', authenticateSaccoUser);
  app.use('/api/transactions', authenticateSaccoUser);
  app.use('/api/payments', authenticateSaccoUser);
  app.use('/api/system', authenticateSaccoUser);

  // API 2: Get Users
  app.get('/api/users', requireRoles(['Chairman', 'Secretary', 'Auditor']), async (req, res) => {
    try {
      if (postgresPool) {
        return res.json(await listPostgresUsers(postgresPool));
      }
      const list = await safeDbOperation(
        async (firestoreDb) => {
          const snap = await firestoreDb.collection('users').get();
          return snap.docs.map(doc => doc.data());
        },
        () => localStore.users,
        'users'
      );
      res.json(list);
    } catch (error: any) {
      sendApiError(res, error);
    }
  });

  // API 3: Get Sacco Members
  app.get('/api/members', async (req, res) => {
    try {
      if (postgresPool) {
        return res.json(await listPostgresMembers(postgresPool));
      }
      const list = await safeDbOperation(
        async (firestoreDb) => {
          const snap = await firestoreDb.collection('members').get();
          return snap.docs.map(doc => doc.data());
        },
        () => localStore.members,
        'members'
      );
      res.json(list);
    } catch (error: any) {
      sendApiError(res, error);
    }
  });

  // API 4: Register Sacco Member (Authorized roles: Chairman, Secretary, Treasurer)
  app.post('/api/members', requireRoles(['Chairman', 'Secretary', 'Treasurer']), async (req, res) => {
    try {
      const memberData = req.body;
      if (!memberData.name || !memberData.idNumber) {
        return res.status(400).json({ error: 'Name and National ID Number are required.' });
      }
      const name = sanitizePersonName(memberData.name).trim();
      const idNumber = sanitizeIntegerInput(memberData.idNumber, 12);
      const phoneNumber = sanitizePhoneNumber(memberData.phoneNumber);
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

      await safeDbOperation(
        async (firestoreDb) => {
          await firestoreDb.collection('members').doc(memberId).set(newMember);
        },
        () => {
          const idx = localStore.members.findIndex(m => m.id === memberId);
          if (idx >= 0) {
            localStore.members[idx] = newMember;
          } else {
            localStore.members.push(newMember);
          }
        },
        'members'
      );

      await recordAuditLog(req, 'MEMBER_CREATED', 'members', newMember.id, undefined, newMember);
      res.status(201).json(newMember);
    } catch (error: any) {
      sendApiError(res, error);
    }
  });

  // API 5: Get Fleet Vehicles
  app.get('/api/vehicles', async (req, res) => {
    try {
      if (postgresPool) {
        return res.json(await listPostgresVehicles(postgresPool));
      }
      const list = await safeDbOperation(
        async (firestoreDb) => {
          const snap = await firestoreDb.collection('vehicles').get();
          return snap.docs.map(doc => doc.data());
        },
        () => localStore.vehicles,
        'vehicles'
      );
      res.json(list);
    } catch (error: any) {
      sendApiError(res, error);
    }
  });

  // API 6: Register Matatu Vehicle (Authorized roles: Chairman, Secretary)
  app.post('/api/vehicles', requireRoles(['Chairman', 'Secretary']), async (req, res) => {
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
        const created = await createPostgresVehicle(postgresPool, newVehicle);
        await recordAuditLog(req, 'VEHICLE_CREATED', 'vehicles', created.id, undefined, created);
        return res.status(201).json(created);
      }

      await safeDbOperation(
        async (firestoreDb) => {
          await firestoreDb.collection('vehicles').doc(vehicleId).set(newVehicle);
          if (newVehicle.ownerId !== 'm-unknown') {
            await firestoreDb.collection('members').doc(newVehicle.ownerId).set({
              vehicleAssigned: newVehicle.plateNumber
            }, { merge: true });
          }
        },
        () => {
          const idx = localStore.vehicles.findIndex(v => v.id === vehicleId);
          if (idx >= 0) {
            localStore.vehicles[idx] = newVehicle;
          } else {
            localStore.vehicles.push(newVehicle);
          }
          const owner = localStore.members.find(member => member.id === newVehicle.ownerId);
          if (owner) owner.vehicleAssigned = newVehicle.plateNumber;
        },
        'vehicles'
      );

      await recordAuditLog(req, 'VEHICLE_CREATED', 'vehicles', newVehicle.id, undefined, newVehicle);
      res.status(201).json(newVehicle);
    } catch (error: any) {
      sendApiError(res, error);
    }
  });

  // API 7: Get Ledger Transactions
  app.get('/api/transactions', async (req, res) => {
    try {
      if (postgresPool) {
        return res.json(await listPostgresTransactions(postgresPool));
      }
      const list = await safeDbOperation(
        async (firestoreDb) => {
          const snap = await firestoreDb.collection('transactions').get();
          return snap.docs.map(doc => doc.data());
        },
        () => localStore.transactions,
        'transactions'
      );
      // Sort by timestamp descending
      list.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
      res.json(list);
    } catch (error: any) {
      sendApiError(res, error);
    }
  });

  // API 8: Book a transaction (Authorized roles: Chairman, Treasurer, Accountant)
  app.post('/api/transactions', requireRoles(['Chairman', 'Treasurer', 'Accountant']), async (req, res) => {
    try {
      const newTx = await createLedgerTransaction(req.body);
      await recordAuditLog(req, 'LEDGER_ENTRY_POSTED', 'ledger_entries', newTx.id, undefined, newTx);
      res.status(201).json(newTx);
    } catch (error: any) {
      sendApiError(res, error);
    }
  });

  app.put('/api/transactions/:id', requireRoles(['Chairman', 'Treasurer', 'Accountant']), async (req, res) => {
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
  app.post('/api/transactions/:id/reverse', requireRoles(['Chairman', 'Treasurer', 'Accountant']), async (req, res) => {
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
      res.json(await listPaymentRecords());
    } catch (error: any) {
      sendApiError(res, error);
    }
  });

  app.post('/api/payments/:id/reconcile', requireRoles(['Chairman', 'Treasurer', 'Accountant']), async (req, res) => {
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
      const data = await safeDbOperation(
        async (firestoreDb) => {
          const txSnap = await firestoreDb.collection('transactions').get();
          const memberSnap = await firestoreDb.collection('members').get();
          const vehicleSnap = await firestoreDb.collection('vehicles').get();

          let totalCredits = 0;
          let totalDebits = 0;
          txSnap.docs.forEach(doc => {
            const tx = doc.data();
            if (tx.type === 'Credit') {
              totalCredits += (tx.amount || 0);
            } else {
              totalDebits += (tx.amount || 0);
            }
          });

          let totalShares = 0;
          let totalSavings = 0;
          memberSnap.docs.forEach(doc => {
            const m = doc.data();
            totalShares += (m.sharesAmount || 0);
            totalSavings += (m.savingsAmount || 0);
          });

          return {
            totalTransactionsCount: txSnap.size,
            totalMembersCount: memberSnap.size,
            totalFleetCount: vehicleSnap.size,
            netCashFlow: totalCredits - totalDebits,
            totalCapitalReserve: totalShares,
            totalMemberSavings: totalSavings,
            systemHealth: "100%",
            auditTimestamp: new Date().toISOString()
          };
        },
        () => {
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
        },
        'transactions'
      );

      res.json(data);
    } catch (error: any) {
      sendApiError(res, error);
    }
  });

  // =========================================================================
  // M-PESA PAYBILL & DARJA API INTEGRATION GATEWAY
  // =========================================================================

  // API 14: Get active M-Pesa configuration
  app.get('/api/mpesa/config', authenticateSaccoUser, async (req, res) => {
    res.json(getDarajaSafeConfig());
  });

  // API 15: Save/Update non-secret M-Pesa configuration (Admin/Treasurer)
  app.post('/api/mpesa/config', authenticateSaccoUser, requireRoles(['Chairman', 'Treasurer']), async (req, res) => {
    try {
      const newConfig = req.body;
      const updated = {
        shortcode: newConfig.shortcode || '',
        callbackUrl: newConfig.callbackUrl || '',
        mode: getDarajaMode(newConfig.mode),
        stkPushEnabled: newConfig.stkPushEnabled !== false
      };

      await safeDbOperation(
        async (firestoreDb) => {
          await firestoreDb.collection('mpesaConfig').doc('active').set(updated);
        },
        () => {
          localStore.mpesaConfig = updated;
        },
        'mpesaConfig'
      );
      res.json({
        ...updated,
        ...getDarajaSafeConfig({ shortcode: updated.shortcode, mode: updated.mode })
      });
    } catch (error: any) {
      sendApiError(res, error);
    }
  });

  // API 15C: Safaricom C2B register URL using server-side Daraja credentials
  app.post('/api/mpesa/register-url', authenticateSaccoUser, requireRoles(['Chairman', 'Treasurer']), async (req, res) => {
    try {
      const { shortcode, mode, confirmationUrl, validationUrl } = req.body;
      const darajaConfig = getDarajaSafeConfig({ shortcode, mode });
      
      if (!darajaConfig.shortcode) {
        return res.status(400).json({ error: 'Missing required parameter: shortcode is required or DARAJA_SHORTCODE must be configured.' });
      }
      if (!confirmationUrl || !validationUrl) {
        return res.status(400).json({ error: 'Confirmation and validation callback URLs are required.' });
      }

      const confirmationCallbackUrl = parsePublicDarajaCallbackUrl(confirmationUrl, 'Confirmation URL');
      const validationCallbackUrl = parsePublicDarajaCallbackUrl(validationUrl, 'Validation URL');
      if (confirmationCallbackUrl.pathname !== '/api/daraja/c2b-confirmation' || validationCallbackUrl.pathname !== '/api/daraja/c2b-validation') {
        return res.status(400).json({ error: 'Use the generated /api/daraja/c2b-confirmation and /api/daraja/c2b-validation callback URLs.' });
      }

      const accessToken = await getDarajaAccessToken(darajaConfig.mode);

      // 2. Call Safaricom C2B Register URL API
      const registerRes = await fetch(`${getDarajaBaseUrl(darajaConfig.mode)}/mpesa/c2b/v1/registerurl`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${accessToken}`
        },
        body: JSON.stringify({
          ShortCode: darajaConfig.shortcode,
          ResponseType: 'Completed',
          ConfirmationURL: confirmationCallbackUrl.toString(),
          ValidationURL: validationCallbackUrl.toString()
        })
      });

      const registerResponseText = await registerRes.text();
      let registerData: any = registerResponseText;
      try {
        registerData = registerResponseText ? JSON.parse(registerResponseText) : {};
      } catch {
        // Preserve a non-JSON Daraja response for the administrator's diagnosis.
      }

      if (!registerRes.ok) {
        const remoteMessage = typeof registerData === 'object'
          ? registerData.errorMessage || registerData.error || 'Safaricom rejected the callback registration request.'
          : 'Safaricom rejected the callback registration request.';
        return res.status(registerRes.status >= 500 ? 502 : registerRes.status).json({
          status: 'failed',
          statusCode: registerRes.status,
          error: remoteMessage,
          response: registerData
        });
      }

      return res.status(200).json({
        status: 'success',
        statusCode: registerRes.status,
        response: registerData
      });

    } catch (error: any) {
      console.error('M-Pesa Webhook Registration Error:', error);
      return sendApiError(res, error);
    }
  });

  // API 15D: Safaricom C2B sandbox simulation trigger
  app.post('/api/mpesa/simulate-c2b', authenticateSaccoUser, requireRoles(['Chairman', 'Treasurer']), async (req, res) => {
    try {
      const { shortcode, mode, amount, msisdn, billRefNumber } = req.body;
      const darajaConfig = getDarajaSafeConfig({ shortcode, mode });

      if (!darajaConfig.shortcode || !amount || !msisdn) {
        return res.status(400).json({
          error: 'Missing required parameters: shortcode, amount, and msisdn are required.'
        });
      }

      const numAmount = Number(amount);
      if (!Number.isFinite(numAmount) || numAmount <= 0) {
        return res.status(400).json({ error: 'Amount must be greater than zero.' });
      }

      if (darajaConfig.mode === 'production') {
        return res.status(400).json({ error: 'C2B simulation is only available in Daraja sandbox mode.' });
      }

      const accessToken = await getDarajaAccessToken('sandbox');

      const simulateRes = await fetch(`${getDarajaBaseUrl('sandbox')}/mpesa/c2b/v1/simulate`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${accessToken}`
        },
        body: JSON.stringify({
          ShortCode: darajaConfig.shortcode,
          CommandID: 'CustomerPayBillOnline',
          Amount: numAmount,
          Msisdn: String(msisdn).replace(/\D/g, ''),
          BillRefNumber: String(billRefNumber || '').trim()
        })
      });

      const simulateData = await simulateRes.json() as any;
      return res.status(simulateRes.ok ? 200 : 400).json({
        status: simulateRes.ok ? 'success' : 'failed',
        statusCode: simulateRes.status,
        response: simulateData
      });
    } catch (error: any) {
      console.error('M-Pesa Sandbox C2B Simulation Error:', error);
      return sendApiError(res, error);
    }
  });

  // API 15A: Safaricom C2B validation webhook (Public - called by Daraja)
  const handleC2BValidation = async (req: express.Request, res: express.Response) => {
    try {
      const { TransAmount } = req.body;
      const numAmount = Number(TransAmount);
      
      if (isNaN(numAmount) || numAmount <= 0) {
        return res.status(200).json({
          ResultCode: 'C2B00013',
          ResultDesc: 'Rejected: Invalid amount'
        });
      }

      // Sacco accepts all payments (even non-members can pay and we handle as direct depositors)
      return res.status(200).json({
        ResultCode: 0,
        ResultDesc: 'Accepted'
      });
    } catch (error: any) {
      return res.status(200).json({
        ResultCode: 'C2B00016',
        ResultDesc: 'Rejected: Internal Validation Exception'
      });
    }
  };

  app.post('/api/mpesa/c2b-validation', handleC2BValidation);
  app.post('/api/daraja/c2b-validation', handleC2BValidation);

  // API 15B: Safaricom C2B confirmation webhook (Public - called by Daraja)
  const handleC2BConfirmation = async (req: express.Request, res: express.Response) => {
    try {
      const { TransID, TransAmount, BusinessShortCode, BillRefNumber, MSISDN, FirstName, MiddleName, LastName } = req.body;

      if (!TransID || !TransAmount || !BusinessShortCode) {
        return res.status(400).json({ error: 'Missing required C2B confirmation payload parameters.' });
      }

      const payerName = [FirstName, MiddleName, LastName].filter(Boolean).join(' ').trim() || 'Direct Cashless Depositor';
      const payment = await processIncomingPayment({
        source: 'Webhook',
        refCode: TransID,
        amount: TransAmount,
        shortcode: BusinessShortCode,
        accountReference: BillRefNumber,
        payerPhone: MSISDN ? '+' + String(MSISDN).replace(/\+/g, '') : '',
        payerName,
        rawPayload: req.body,
        recorderName: 'M-Pesa Gateway API'
      });

      return res.status(200).json({
        ResultCode: 0,
        ResultDesc: payment.status === 'Unmatched'
          ? 'Confirmation received; payment queued for reconciliation'
          : 'Confirmation received and reconciled successfully'
      });

    } catch (error: any) {
      console.error('M-Pesa Confirmation Webhook Error:', error);
      return res.status(500).json({ error: error.message });
    }
  };

  app.post('/api/mpesa/c2b-confirmation', handleC2BConfirmation);
  app.post('/api/daraja/c2b-confirmation', handleC2BConfirmation);

  // API 16: Log direct M-Pesa cashless payment for both paybills
  app.post('/api/mpesa/log-payment', authenticateSaccoUser, requireRoles(['Chairman', 'Treasurer', 'Accountant']), async (req, res) => {
    try {
      const { memberId, accountReference, payerPhone, amount, category, refCode, tillNumber } = req.body;
      const normalizedPayerPhone = sanitizePhoneNumber(payerPhone);

      if (!amount || !category || !refCode || !tillNumber) {
        return res.status(400).json({ error: 'Parameters (amount, category, refCode, tillNumber) are required.' });
      }

      if (tillNumber !== 'VehicleTill' && tillNumber !== 'UtilityTill') {
        return res.status(400).json({ error: 'Invalid paybill selection. Must be VehicleTill (824 9102) or UtilityTill (481 0294).' });
      }
      if (normalizedPayerPhone && !isValidPhoneNumber(normalizedPayerPhone)) {
        return res.status(400).json({ error: 'Payer phone number must contain 9 to 15 digits.' });
      }

      const payment = await processIncomingPayment({
        source: 'Manual',
        refCode,
        amount,
        shortcode: tillNumber === 'UtilityTill' ? '4810294' : '8249102',
        memberId,
        accountReference: String(accountReference || '').trim(),
        payerPhone: normalizedPayerPhone,
        category,
        recorderName: `M-Pesa Gateway (${(req as any).user?.role || 'System'})`
      });

      res.status(200).json({
        status: 'success',
        payment
      });

    } catch (error: any) {
      sendApiError(res, error);
    }
  });

  // Vite middleware or production static server setup
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`[Sacco Ledger OS] Express full-stack server listening on http://0.0.0.0:${PORT}`);
  });
}

startServer();
