import 'dotenv/config';
import express from 'express';
import path from 'path';
import crypto from 'node:crypto';
import { createServer as createViteServer } from 'vite';
import { Firestore } from '@google-cloud/firestore';
import { Pool } from 'pg';
import { applicationDefault, cert, getApps, initializeApp as initializeFirebaseAdminApp } from 'firebase-admin/app';
import { getAuth, type DecodedIdToken } from 'firebase-admin/auth';
import { getSaccoUserKey } from './src/lib/auth';
import type {
  Member,
  PaymentMatchMethod,
  PaymentRecord,
  PaymentSource,
  PaymentStatus,
  TillType,
  Transaction,
  TransactionCategory,
  TransactionType,
  UserRole
} from './src/types';

const TRANSACTION_TYPES: readonly TransactionType[] = ['Credit', 'Debit'];
const TRANSACTION_CATEGORIES: readonly TransactionCategory[] = [
  'Daily Contribution',
  'Registration Fee',
  'Management Fee',
  'Office Expenses',
  'Petty Cash',
  'Penalty',
  'Utilities',
  'Equipment'
];
const TILL_TYPES: readonly TillType[] = ['VehicleTill', 'UtilityTill', 'None'];
const SHARES_ALLOCATION_RATE = 0.3;
const SAVINGS_ALLOCATION_RATE = 0.7;

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

type LedgerInput = Partial<Transaction> & {
  description?: string;
  refCode?: string;
  amount?: number | string;
};

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
const DEV_JWT_SECRET = 'dev-only-change-me-sacco-jwt-secret';
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
      `INSERT INTO users (firebase_uid, full_name, email, phone, role, is_active)
       VALUES ($1, $2, $3, $4, 'Chairman', TRUE)
       ON CONFLICT (email) DO UPDATE SET
         firebase_uid = COALESCE(users.firebase_uid, EXCLUDED.firebase_uid),
         full_name = EXCLUDED.full_name,
         phone = EXCLUDED.phone,
         role = 'Chairman',
         is_active = TRUE,
         updated_at = now()
       RETURNING id, firebase_uid, full_name, email, phone, role, is_active`,
      [input.firebaseUid || null, fullName, email, input.phone || null]
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
  if (!secret && process.env.NODE_ENV === 'production') {
    throw new HttpError(500, 'JWT_SECRET must be configured in production.', 'JWT_SECRET_MISSING');
  }
  return secret || DEV_JWT_SECRET;
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

function verifyJwt(token: string): AuthorizedUser {
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
  const user = localStore.users.find(item => item.email.toLowerCase() === tokenEmail);
  if (!user || user.role !== payload.role) {
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

// Firestore Setup - credentials and project identifiers are supplied by environment.
const firestoreOptions: ConstructorParameters<typeof Firestore>[0] = {};
const firestoreProjectId = process.env.GOOGLE_CLOUD_PROJECT || process.env.GCLOUD_PROJECT;
if (firestoreProjectId) {
  firestoreOptions.projectId = firestoreProjectId;
}
if (process.env.FIRESTORE_DATABASE_ID) {
  firestoreOptions.databaseId = process.env.FIRESTORE_DATABASE_ID;
}
const db = new Firestore(firestoreOptions);

// Sacco Memory-Backed Ledger Storage (Fallback engine for development and sandbox stability)
const localStore = {
  users: [...initialUsers],
  members: [...initialMembers],
  vehicles: [...initialVehicles],
  transactions: [...initialTransactions],
  payments: [] as PaymentRecord[],
  mpesaConfig: { ...defaultMPesaConfig }
};

// State flag indicating if we are using Firestore or Local Fallback
let useFirestore = Boolean(
  process.env.GOOGLE_APPLICATION_CREDENTIALS ||
  process.env.GOOGLE_CLOUD_PROJECT ||
  process.env.GCLOUD_PROJECT
);

// Helper to safely execute any Firestore database operation with automatic, zero-downtime local ledger fallback
async function safeDbOperation<T>(
  operation: (firestoreDb: Firestore) => Promise<T>,
  fallback: () => T | Promise<T>,
  collectionName: string
): Promise<T> {
  if (!useFirestore) {
    return Promise.resolve(fallback());
  }
  try {
    return await operation(db);
  } catch (error: any) {
    if (error instanceof HttpError) {
      throw error;
    }
    console.warn(`[Sacco Ledger OS] Firestore connection/permission unavailable for [${collectionName}]. Operating in high-security Local Ledger Fallback Mode.`, error.message || error);
    useFirestore = false;
    return Promise.resolve(fallback());
  }
}

function normalizeRefCode(refCode: unknown): string {
  return String(refCode || '').trim().toUpperCase();
}

function normalizeTransactionInput(input: LedgerInput): Transaction {
  const description = String(input.description || '').trim();
  const refCode = normalizeRefCode(input.refCode);
  const amount = Number(input.amount);
  const type = (input.type || 'Credit') as TransactionType;
  const category = (input.category || 'Daily Contribution') as TransactionCategory;
  const tillNumber = (input.tillNumber || 'UtilityTill') as TillType;

  if (!description) {
    throw new HttpError(400, 'Transaction description is required.', 'MISSING_DESCRIPTION');
  }
  if (!refCode) {
    throw new HttpError(400, 'Transaction reference code is required.', 'MISSING_REF_CODE');
  }
  if (!Number.isFinite(amount) || amount <= 0) {
    throw new HttpError(400, 'Transaction amount must be greater than zero.', 'INVALID_AMOUNT');
  }
  if (!TRANSACTION_TYPES.includes(type)) {
    throw new HttpError(400, 'Transaction type must be Credit or Debit.', 'INVALID_TRANSACTION_TYPE');
  }
  if (!TRANSACTION_CATEGORIES.includes(category)) {
    throw new HttpError(400, `Unsupported transaction category: ${category}`, 'INVALID_TRANSACTION_CATEGORY');
  }
  if (!TILL_TYPES.includes(tillNumber)) {
    throw new HttpError(400, `Unsupported till number: ${tillNumber}`, 'INVALID_TILL');
  }

  return {
    id: input.id || 't-' + Date.now(),
    timestamp: input.timestamp || new Date().toISOString(),
    memberId: input.memberId || '',
    memberName: input.memberName || '',
    vehiclePlate: input.vehiclePlate || '',
    description,
    refCode,
    type,
    category,
    amount,
    recorderName: input.recorderName || 'Sacco Ledger OS',
    tillNumber,
    vehicleClass: input.vehicleClass,
    operationAmount: Number(input.operationAmount || 0),
    entranceFee: Number(input.entranceFee || 0),
    loanRepay: Number(input.loanRepay || 0),
    savingsContribution: Number(input.savingsContribution || 0),
    sTicket: Number(input.sTicket || 0),
    legalFee: Number(input.legalFee || 0),
    expenseDeduction: Number(input.expenseDeduction || 0),
    grossAmount: Number(input.grossAmount || amount),
    reversalOf: input.reversalOf,
    reversedAt: input.reversedAt,
    reversedBy: input.reversedBy
  };
}

function getDailyContributionBalanceDelta(tx: Transaction): { shares: number; savings: number; loan: number } {
  if (!tx.memberId || tx.category !== 'Daily Contribution') {
    return { shares: 0, savings: 0, loan: 0 };
  }

  const direction = tx.type === 'Credit' ? 1 : -1;
  if (tx.savingsContribution !== undefined) {
    return {
      shares: 0,
      savings: direction * Number(tx.savingsContribution || 0),
      loan: -direction * Number(tx.loanRepay || 0)
    };
  }
  return {
    shares: direction * Math.round(tx.amount * SHARES_ALLOCATION_RATE),
    savings: direction * Math.round(tx.amount * SAVINGS_ALLOCATION_RATE),
    loan: -direction * Number(tx.loanRepay || 0)
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
  if (error instanceof HttpError) {
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

function getLast9Digits(value: unknown): string {
  return String(value || '').replace(/\D/g, '').slice(-9);
}

function matchPaymentMember(
  members: Member[],
  accountReference: string,
  payerPhone: string,
  preferredMemberId?: string
): { member: Member | null; matchMethod: PaymentMatchMethod } {
  if (preferredMemberId) {
    const member = members.find(m => m.id === preferredMemberId);
    if (member) return { member, matchMethod: 'Manual Assignment' };
  }

  const normalizedRef = accountReference.trim().toUpperCase().replace(/\s+/g, '');
  if (normalizedRef) {
    const byId = members.find(m => m.id.trim().toUpperCase() === normalizedRef);
    if (byId) return { member: byId, matchMethod: 'Member ID' };

    const byPlate = members.find(m => {
      const plate = (m.vehicleAssigned || '').trim().toUpperCase().replace(/\s+/g, '');
      return plate && plate === normalizedRef;
    });
    if (byPlate) return { member: byPlate, matchMethod: 'Vehicle Plate' };
  }

  const payerLast9 = getLast9Digits(payerPhone);
  if (payerLast9.length === 9) {
    const byPhone = members.find(m => getLast9Digits(m.phoneNumber) === payerLast9);
    if (byPhone) return { member: byPhone, matchMethod: 'Phone Number' };
  }

  return { member: null, matchMethod: 'None' };
}

async function listPaymentRecords(): Promise<PaymentRecord[]> {
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
  return safeDbOperation<Member[]>(
    async (firestoreDb) => {
      const snap = await firestoreDb.collection('members').get();
      return snap.docs.map(doc => doc.data() as Member);
    },
    () => localStore.members as Member[],
    'members'
  );
}

async function processIncomingPayment(input: IncomingPaymentInput): Promise<PaymentRecord> {
  const refCode = normalizeRefCode(input.refCode);
  const amount = Number(input.amount);
  if (!refCode) {
    throw new HttpError(400, 'Payment reference code is required.', 'MISSING_PAYMENT_REF');
  }
  if (!Number.isFinite(amount) || amount <= 0) {
    const tillConfig = getTillFromShortcode(input.shortcode);
    const rejected = await savePaymentRecord({
      id: `pay-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
      timestamp: new Date().toISOString(),
      source: input.source,
      status: 'Rejected',
      refCode: refCode || `INVALID-${Date.now()}`,
      amount: Number.isFinite(amount) ? amount : 0,
      tillNumber: tillConfig.tillNumber,
      category: input.category || tillConfig.category,
      accountReference: input.accountReference || '',
      payerName: input.payerName || 'Unknown Payer',
      payerPhone: input.payerPhone || '',
      matchMethod: 'None',
      note: 'Invalid payment amount.',
      rawPayload: input.rawPayload
    });
    return rejected;
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
  const allMembers = await getAllMembers();
  const accountReference = String(input.accountReference || '').trim();
  const payerPhone = String(input.payerPhone || '').trim();
  const { member, matchMethod } = matchPaymentMember(allMembers, accountReference, payerPhone, input.memberId);
  const payerName = input.payerName || (member ? member.name : 'Unmatched M-Pesa Payer');

  let payment: PaymentRecord = {
    id: `pay-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
    timestamp: new Date().toISOString(),
    source: input.source,
    status: member ? 'Pending' : 'Unmatched',
    refCode,
    amount,
    tillNumber: tillConfig.tillNumber,
    category,
    accountReference,
    payerName,
    payerPhone,
    memberId: member?.id,
    memberName: member?.name,
    vehiclePlate: member?.vehicleAssigned || accountReference,
    matchMethod,
    rawPayload: input.rawPayload,
    note: member ? `Matched by ${matchMethod}.` : 'Awaiting accountant reconciliation.'
  };

  if (!member) {
    return savePaymentRecord(payment);
  }

  const transaction = await createLedgerTransaction({
    id: `t-mpesa-${Date.now()}`,
    timestamp: payment.timestamp,
    memberId: member.id,
    memberName: member.name,
    vehiclePlate: member.vehicleAssigned || accountReference,
    description: `M-Pesa ${input.source.toLowerCase()} payment of KES ${amount.toLocaleString()} received on ${tillConfig.paybillName} (Account Ref: ${accountReference || 'N/A'}). Reconciled automatically.`,
    refCode,
    type: 'Credit',
    category,
    amount,
    recorderName: input.recorderName,
    tillNumber: tillConfig.tillNumber
  });

  payment = {
    ...payment,
    status: 'Reconciled',
    transactionId: transaction.id,
    note: `Auto-reconciled by ${matchMethod}.`
  };
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

  const members = await getAllMembers();
  const member = members.find(item => item.id === memberId);
  if (!member) {
    throw new HttpError(404, 'Selected member was not found.', 'MEMBER_NOT_FOUND');
  }

  const transaction = await createLedgerTransaction({
    id: `t-mpesa-${Date.now()}`,
    timestamp: new Date().toISOString(),
    memberId: member.id,
    memberName: member.name,
    vehiclePlate: member.vehicleAssigned || payment.accountReference,
    description: `M-Pesa unmatched payment of KES ${payment.amount.toLocaleString()} assigned to ${member.name}. Original Account Ref: ${payment.accountReference || 'N/A'}.`,
    refCode: payment.refCode,
    type: 'Credit',
    category: payment.category,
    amount: payment.amount,
    recorderName,
    tillNumber: payment.tillNumber
  });

  return savePaymentRecord({
    ...payment,
    status: 'Reconciled',
    memberId: member.id,
    memberName: member.name,
    vehiclePlate: member.vehicleAssigned || payment.vehiclePlate,
    matchMethod: 'Manual Assignment',
    transactionId: transaction.id,
    note: `Manually reconciled by ${recorderName}.`
  });
}

function authenticateLegacyHeaders(req: express.Request): AuthorizedUser {
  const email = req.headers['x-sacco-user-email'] as string;
  const role = req.headers['x-sacco-user-role'] as UserRole;
  const key = req.headers['x-sacco-user-key'] as string;

  if (!email || !role || !key) {
    throw new HttpError(401, 'Sacco Security OS: Missing authentication credentials.', 'AUTH_MISSING');
  }

  const user = localStore.users.find(u => u.email.toLowerCase() === email.toLowerCase());
  if (!user) {
    throw new HttpError(401, 'Sacco Security OS: User not found in authorized register.', 'AUTH_USER_NOT_FOUND');
  }

  if (user.role !== role) {
    throw new HttpError(401, 'Sacco Security OS: Role validation mismatch.', 'AUTH_ROLE_MISMATCH');
  }

  if (key !== getSaccoUserKey(user.role as UserRole)) {
    throw new HttpError(401, 'Sacco Security OS: Invalid role security credential key.', 'AUTH_BAD_KEY');
  }

  return user;
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

  const decodedToken = await adminAuth.verifyIdToken(authHeader.slice('Bearer '.length).trim());
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
        const allowDevJwt = process.env.ALLOW_DEV_JWT_AUTH === 'true' || process.env.NODE_ENV !== 'production';
        if (!allowDevJwt) {
          throw firebaseError;
        }

        (req as any).user = verifyJwt(authHeader.slice('Bearer '.length).trim());
        (req as any).authContext = {
          provider: 'dev-jwt',
          email: (req as any).user.email
        };
        await recordAuditLog(req, 'API_AUTHORIZED_DEV_JWT', req.path);
        return next();
      }
    }

    const allowLegacyHeaders = process.env.ALLOW_LEGACY_AUTH_HEADERS === 'true';
    if (allowLegacyHeaders) {
      (req as any).user = authenticateLegacyHeaders(req);
      (req as any).authContext = {
        provider: 'legacy-headers',
        email: (req as any).user.email
      };
      await recordAuditLog(req, 'API_AUTHORIZED_LEGACY', req.path);
      return next();
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

// Initialize/Seed Firestore collections with Mock Data if empty
async function seedDatabaseIfEmpty() {
  if (!useFirestore) {
    console.log("No Google Cloud credentials detected. Skipping Firestore seeding and using Local Ledger Fallback Mode.");
    return;
  }

  console.log("Checking Firestore connection...");
  try {
    await db.collection('system').doc('status').get();
    console.log("Firestore connection check complete. No sample data was seeded.");
  } catch (error: any) {
    console.warn("[Sacco Ledger OS] Firestore connection/permission unavailable on startup. Automatically operating in high-security Local Ledger Fallback Mode.", error.message || error);
    useFirestore = false;
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
        const allowDevBootstrap = process.env.ALLOW_DEV_AUTH_FALLBACK === 'true' || process.env.NODE_ENV !== 'production';
        if (!allowDevBootstrap) {
          return res.status(401).json({ error: 'Firebase ID token is required to bootstrap the first admin.' });
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

  app.post('/api/auth/login', (req, res) => {
    try {
      const allowDevLogin = process.env.ALLOW_DEV_AUTH_FALLBACK === 'true' || process.env.NODE_ENV !== 'production';
      if (!allowDevLogin) {
        return res.status(404).json({ error: 'Password login is disabled. Use Firebase Auth.' });
      }

      const { email, password } = req.body || {};
      const user = localStore.users.find(item => item.email.toLowerCase() === String(email || '').toLowerCase());
      if (!user || (password !== user.devPassword && password !== getSaccoUserKey(user.role as UserRole))) {
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
  app.get('/api/users', async (req, res) => {
    try {
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
      res.status(500).json({ error: error.message });
    }
  });

  // API 3: Get Sacco Members
  app.get('/api/members', async (req, res) => {
    try {
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
      res.status(500).json({ error: error.message });
    }
  });

  // API 4: Register Sacco Member (Authorized roles: Chairman, Secretary, Treasurer)
  app.post('/api/members', requireRoles(['Chairman', 'Secretary', 'Treasurer']), async (req, res) => {
    try {
      const memberData = req.body;
      if (!memberData.name || !memberData.idNumber) {
        return res.status(400).json({ error: 'Name and National ID Number are required.' });
      }
      const memberId = memberData.id || 'm-' + Date.now();
      const newMember = {
        id: memberId,
        name: memberData.name,
        idNumber: memberData.idNumber,
        phoneNumber: memberData.phoneNumber || '+254 700 000 000',
        status: memberData.status || 'Active',
        dateRegistered: memberData.dateRegistered || new Date().toISOString().substring(0, 10),
        vehicleAssigned: memberData.vehicleAssigned || '',
        sharesAmount: Number(memberData.sharesAmount) || 0,
        savingsAmount: Number(memberData.savingsAmount) || 0,
        initialLoanAmount: Math.max(0, Number(memberData.initialLoanAmount ?? memberData.loanBalance) || 0),
        loanBalance: Math.max(0, Number(memberData.loanBalance) || 0)
      };

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

      res.status(201).json(newMember);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // API 5: Get Fleet Vehicles
  app.get('/api/vehicles', async (req, res) => {
    try {
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
      res.status(500).json({ error: error.message });
    }
  });

  // API 6: Register Matatu Vehicle (Authorized roles: Chairman, Secretary)
  app.post('/api/vehicles', requireRoles(['Chairman', 'Secretary']), async (req, res) => {
    try {
      const vehicleData = req.body;
      if (!vehicleData.plateNumber || !vehicleData.ownerName) {
        return res.status(400).json({ error: 'Plate Number and Owner Name are required.' });
      }
      const vehicleId = vehicleData.id || 'v-' + Date.now();
      const newVehicle = {
        id: vehicleId,
        plateNumber: vehicleData.plateNumber.toUpperCase(),
        ownerId: vehicleData.ownerId || 'm-unknown',
        ownerName: vehicleData.ownerName,
        driverName: vehicleData.driverName || 'Douglas Mwangi',
        driverPhone: vehicleData.driverPhone || '+254 700 111 222',
        route: '17 Stage & Cabbanas',
        status: vehicleData.status || 'Active',
        capacity: [7, 14, 33, 50].includes(Number(vehicleData.capacity)) ? Number(vehicleData.capacity) : 14
      };

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

      res.status(201).json(newVehicle);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // API 7: Get Ledger Transactions
  app.get('/api/transactions', async (req, res) => {
    try {
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
      res.status(500).json({ error: error.message });
    }
  });

  // API 8: Book a transaction (Authorized roles: Chairman, Treasurer, Accountant)
  app.post('/api/transactions', requireRoles(['Chairman', 'Treasurer', 'Accountant']), async (req, res) => {
    try {
      const newTx = await createLedgerTransaction(req.body);
      res.status(201).json(newTx);
    } catch (error: any) {
      sendApiError(res, error);
    }
  });

  app.put('/api/transactions/:id', requireRoles(['Chairman', 'Treasurer', 'Accountant']), async (req, res) => {
    try {
      const updated = await updateLedgerTransaction(req.params.id, req.body);
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
      res.status(500).json({ error: error.message });
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
      res.status(500).json({ error: error.message });
    }
  });

  // API 15C: Safaricom C2B register URL using server-side Daraja credentials
  app.post('/api/mpesa/register-url', authenticateSaccoUser, async (req, res) => {
    try {
      const { shortcode, mode, confirmationUrl, validationUrl } = req.body;
      const darajaConfig = getDarajaSafeConfig({ shortcode, mode });
      
      if (!darajaConfig.shortcode) {
        return res.status(400).json({ error: 'Missing required parameter: shortcode is required or DARAJA_SHORTCODE must be configured.' });
      }
      if (!confirmationUrl || !validationUrl) {
        return res.status(400).json({ error: 'Confirmation and validation callback URLs are required.' });
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
          ConfirmationURL: confirmationUrl,
          ValidationURL: validationUrl
        })
      });

      const registerData = await registerRes.json() as any;
      
      return res.json({
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
  app.post('/api/mpesa/simulate-c2b', authenticateSaccoUser, async (req, res) => {
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
  app.post('/api/mpesa/log-payment', authenticateSaccoUser, async (req, res) => {
    try {
      const { memberId, amount, category, refCode, tillNumber } = req.body;

      if (!amount || !category || !refCode || !tillNumber) {
        return res.status(400).json({ error: 'Parameters (amount, category, refCode, tillNumber) are required.' });
      }

      if (tillNumber !== 'VehicleTill' && tillNumber !== 'UtilityTill') {
        return res.status(400).json({ error: 'Invalid paybill selection. Must be VehicleTill (824 9102) or UtilityTill (481 0294).' });
      }

      const payment = await processIncomingPayment({
        source: 'Manual',
        refCode,
        amount,
        shortcode: tillNumber === 'UtilityTill' ? '4810294' : '8249102',
        memberId,
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
