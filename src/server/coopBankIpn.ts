import crypto from 'node:crypto';

export const COOP_PROVIDER = 'COOP_BANK' as const;
export type CoopAuthMode = 'TOKEN' | 'BASIC';
export type CoopProcessingStatus = 'RECEIVED' | 'VALIDATED' | 'PROCESSING' | 'PROCESSED' | 'FAILED' | 'QUARANTINED';
export type CoopReconciliationStatus = 'NOT_EVALUATED' | 'MATCHED' | 'UNMATCHED' | 'AMBIGUOUS' | 'IGNORED_DEBIT' | 'PENDING_ALLOCATION' | 'POSTED' | 'MANUALLY_RECONCILED';

export class CoopIpnError extends Error {
  constructor(public status: number, message: string, public code: string) {
    super(message);
    this.name = 'CoopIpnError';
  }
}

export interface CoopIpnConfig {
  enabled: boolean;
  authMode: CoopAuthMode;
  token: string;
  tokenHeader: string;
  tokenScheme: string;
  basicUsername: string;
  basicPassword: string;
  allowedAccountNumbers: string[];
  successMessageCode: string;
  observeOnly: boolean;
  autoPostingEnabled: boolean;
}

export interface NormalizedCoopEvent {
  provider: typeof COOP_PROVIDER;
  externalTransactionId: string;
  idempotencyKey: string;
  accountNumber: string;
  amount: string;
  currency: string;
  eventType: string;
  paymentReference?: string;
  narration: string;
  customerMemoLine1?: string;
  customerMemoLine2?: string;
  customerMemoLine3?: string;
  bookedBalance?: string;
  clearedBalance?: string;
  exchangeRate?: string;
  postingDate?: string;
  valueDate?: string;
  transactionDate?: string;
  rawPayload: unknown;
}

function valueFrom(primary: string | undefined, legacy: string | undefined): string {
  return String(primary ?? legacy ?? '').trim();
}

export function normalizeAccountNumber(value: unknown): string {
  return String(value || '').replace(/\s+/g, '');
}

export function loadCoopIpnConfig(env: NodeJS.ProcessEnv = process.env): CoopIpnConfig {
  const legacyConfigured = Boolean(env.COOP_B2B_IPN_TOKEN || (env.COOP_B2B_IPN_BASIC_USERNAME && env.COOP_B2B_IPN_BASIC_PASSWORD));
  const enabled = env.COOP_IPN_ENABLED === undefined ? legacyConfigured : env.COOP_IPN_ENABLED === 'true';
  const mode = valueFrom(env.COOP_IPN_AUTH_MODE, env.COOP_B2B_IPN_AUTH_MODE || 'TOKEN').toUpperCase();
  if (mode !== 'TOKEN' && mode !== 'BASIC') {
    throw new CoopIpnError(503, 'Co-op Bank IPN authentication mode is invalid.', 'COOP_IPN_CONFIG_INVALID');
  }
  const tokenHeader = String(env.COOP_IPN_TOKEN_HEADER || 'authorization').trim().toLowerCase();
  if (!/^[a-z0-9-]+$/.test(tokenHeader)) {
    throw new CoopIpnError(503, 'Co-op Bank IPN token header is invalid.', 'COOP_IPN_CONFIG_INVALID');
  }
  return {
    enabled,
    authMode: mode,
    token: valueFrom(env.COOP_IPN_TOKEN, env.COOP_B2B_IPN_TOKEN),
    tokenHeader,
    tokenScheme: env.COOP_IPN_TOKEN_SCHEME === undefined ? 'Bearer' : String(env.COOP_IPN_TOKEN_SCHEME).trim(),
    basicUsername: valueFrom(env.COOP_IPN_BASIC_USERNAME, env.COOP_B2B_IPN_BASIC_USERNAME),
    basicPassword: valueFrom(env.COOP_IPN_BASIC_PASSWORD, env.COOP_B2B_IPN_BASIC_PASSWORD),
    allowedAccountNumbers: valueFrom(env.COOP_ALLOWED_ACCOUNT_NUMBERS, env.COOP_B2B_ALLOWED_ACCOUNT_NUMBERS)
      .split(',').map(normalizeAccountNumber).filter(Boolean),
    successMessageCode: String(env.COOP_IPN_SUCCESS_MESSAGE_CODE || '2XX').trim() || '2XX',
    observeOnly: env.COOP_OBSERVE_ONLY !== 'false',
    autoPostingEnabled: env.COOP_AUTO_POSTING_ENABLED === 'true'
  };
}

export function assertCoopIpnConfiguration(config: CoopIpnConfig): void {
  if (!config.enabled) return;
  if (!config.allowedAccountNumbers.length) {
    throw new CoopIpnError(503, 'No Co-op Bank collection accounts are configured.', 'COOP_IPN_CONFIG_INVALID');
  }
  if (config.authMode === 'TOKEN' && !config.token) {
    throw new CoopIpnError(503, 'Co-op Bank IPN token authentication is incomplete.', 'COOP_IPN_AUTH_UNAVAILABLE');
  }
  if (config.authMode === 'BASIC' && (!config.basicUsername || !config.basicPassword)) {
    throw new CoopIpnError(503, 'Co-op Bank IPN Basic authentication is incomplete.', 'COOP_IPN_AUTH_UNAVAILABLE');
  }
}

function constantTimeMatches(actual: string, expected: string): boolean {
  const left = Buffer.from(actual);
  const right = Buffer.from(expected);
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}

export function assertCoopIpnAuthentication(authorizationValue: unknown, config: CoopIpnConfig): void {
  if (!config.enabled) throw new CoopIpnError(503, 'Co-op Bank IPN is disabled.', 'COOP_IPN_DISABLED');
  const authorization = String(authorizationValue || '');
  if (config.authMode === 'TOKEN') {
    if (!config.token) throw new CoopIpnError(503, 'Co-op Bank IPN authentication is not configured.', 'COOP_IPN_AUTH_UNAVAILABLE');
    const expectedPrefix = config.tokenScheme ? `${config.tokenScheme} ` : '';
    const supplied = expectedPrefix
      ? (authorization.toLowerCase().startsWith(expectedPrefix.toLowerCase()) ? authorization.slice(expectedPrefix.length).trim() : '')
      : authorization.trim();
    if (!constantTimeMatches(supplied, config.token)) throw new CoopIpnError(401, 'Co-op Bank IPN authentication failed.', 'COOP_IPN_AUTH_FAILED');
    return;
  }
  if (!config.basicUsername || !config.basicPassword) {
    throw new CoopIpnError(503, 'Co-op Bank IPN authentication is not configured.', 'COOP_IPN_AUTH_UNAVAILABLE');
  }
  const encoded = authorization.toLowerCase().startsWith('basic ') ? authorization.slice(6).trim() : '';
  let decoded = '';
  try { decoded = Buffer.from(encoded, 'base64').toString('utf8'); } catch { decoded = ''; }
  const separator = decoded.indexOf(':');
  const username = separator >= 0 ? decoded.slice(0, separator) : '';
  const password = separator >= 0 ? decoded.slice(separator + 1) : '';
  if (!constantTimeMatches(username, config.basicUsername) || !constantTimeMatches(password, config.basicPassword)) {
    throw new CoopIpnError(401, 'Co-op Bank IPN authentication failed.', 'COOP_IPN_AUTH_FAILED');
  }
}

function normalizeRequiredString(value: unknown, field: string): string {
  if (typeof value !== 'string') throw new CoopIpnError(400, `${field} must be a string.`, 'COOP_IPN_PAYLOAD_INVALID');
  const normalized = value.trim();
  if (!normalized) throw new CoopIpnError(400, `${field} is required.`, 'COOP_IPN_PAYLOAD_INVALID');
  if (normalized.length > 500) throw new CoopIpnError(400, `${field} is too long.`, 'COOP_IPN_PAYLOAD_INVALID');
  return normalized;
}

function optionalString(value: unknown): string | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  if (typeof value !== 'string') throw new CoopIpnError(400, 'Optional text fields must be strings.', 'COOP_IPN_PAYLOAD_INVALID');
  const normalized = value.trim();
  return normalized ? normalized.slice(0, 2000) : undefined;
}

/** Returns an exact two-decimal database value without floating point maths. */
export function normalizeDecimal(value: unknown, field: string, allowZero = true, scale = 2): string {
  const raw = String(value ?? '').trim();
  const pattern = new RegExp(`^(?:0|[1-9]\\d{0,11})(?:\\.\\d{1,${scale}})?$`);
  if (!pattern.test(raw)) {
    throw new CoopIpnError(400, `${field} must be a valid decimal with at most ${scale} decimal places.`, 'COOP_IPN_PAYLOAD_INVALID');
  }
  const [whole, fraction = ''] = raw.split('.');
  const normalized = `${whole}.${fraction.padEnd(scale, '0')}`;
  if (!allowZero && Number(normalized) === 0) {
    throw new CoopIpnError(400, `${field} must be greater than zero.`, 'COOP_IPN_PAYLOAD_INVALID');
  }
  return normalized;
}

function normalizeOptionalDecimal(value: unknown, field: string, scale = 2): string | undefined {
  const raw = String(value ?? '').trim();
  return raw ? normalizeDecimal(raw, field, true, scale) : undefined;
}

export function isSupportedCoopDate(value: string): boolean {
  if (/^\d{4}-\d{2}-\d{2}(?:[+\-]\d{2}:\d{2})?$/.test(value)) {
    const datePart = value.slice(0, 10);
    const parsed = Date.parse(`${datePart}T00:00:00${value.length > 10 ? value.slice(10) : 'Z'}`);
    return !Number.isNaN(parsed) && new Date(`${datePart}T00:00:00Z`).toISOString().slice(0, 10) === datePart;
  }
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+\-]\d{2}:\d{2})$/.test(value)) return !Number.isNaN(Date.parse(value));
  return false;
}

function optionalDate(value: unknown, field: string): string | undefined {
  const normalized = optionalString(value);
  if (normalized && !isSupportedCoopDate(normalized)) {
    throw new CoopIpnError(400, `${field} has an unsupported date format.`, 'COOP_IPN_PAYLOAD_INVALID');
  }
  return normalized;
}

export function normalizeTransactionId(value: unknown): string {
  return normalizeRequiredString(value, 'TransactionId').toUpperCase();
}

export function buildCoopIdempotencyKey(transactionId: unknown): string {
  return `${COOP_PROVIDER}:${normalizeTransactionId(transactionId)}`;
}

export function normalizeCoopIpnPayload(payload: unknown, config: CoopIpnConfig): NormalizedCoopEvent {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new CoopIpnError(400, 'Co-op Bank IPN payload must be a JSON object.', 'COOP_IPN_PAYLOAD_INVALID');
  }
  const body = payload as Record<string, unknown>;
  if (typeof body.AcctNo !== 'string') throw new CoopIpnError(400, 'AcctNo must be a string.', 'COOP_IPN_PAYLOAD_INVALID');
  const accountNumber = normalizeAccountNumber(body.AcctNo);
  if (!accountNumber) throw new CoopIpnError(400, 'AcctNo is required.', 'COOP_IPN_PAYLOAD_INVALID');
  if (!config.allowedAccountNumbers.length) throw new CoopIpnError(503, 'No Co-op Bank collection accounts are configured.', 'COOP_IPN_CONFIG_INVALID');
  if (!config.allowedAccountNumbers.includes(accountNumber)) {
    throw new CoopIpnError(403, 'The supplied account is not authorized for this SACCO.', 'COOP_IPN_ACCOUNT_REJECTED');
  }
  const externalTransactionId = normalizeTransactionId(body.TransactionId);
  const postingDate = optionalDate(body.PostingDate, 'PostingDate');
  const transactionDate = optionalDate(body.TransactionDate, 'TransactionDate');
  const currency = normalizeRequiredString(body.Currency, 'Currency').toUpperCase();
  if (!/^[A-Z]{3}$/.test(currency)) throw new CoopIpnError(400, 'Currency must be a three-letter currency code.', 'COOP_IPN_PAYLOAD_INVALID');
  return {
    provider: COOP_PROVIDER,
    externalTransactionId,
    idempotencyKey: buildCoopIdempotencyKey(externalTransactionId),
    accountNumber,
    amount: normalizeDecimal(body.Amount, 'Amount', false),
    currency,
    eventType: normalizeRequiredString(body.EventType, 'EventType').toUpperCase(),
    paymentReference: optionalString(body.PaymentRef),
    narration: optionalString(body.Narration) || '',
    customerMemoLine1: optionalString(body.CustMemoLine1),
    customerMemoLine2: optionalString(body.CustMemoLine2),
    customerMemoLine3: optionalString(body.CustMemoLine3),
    bookedBalance: normalizeOptionalDecimal(body.BookedBalance, 'BookedBalance'),
    clearedBalance: normalizeOptionalDecimal(body.ClearedBalance, 'ClearedBalance'),
    exchangeRate: normalizeOptionalDecimal(body.ExchangeRate, 'ExchangeRate', 8),
    postingDate,
    valueDate: optionalDate(body.ValueDate, 'ValueDate'),
    transactionDate,
    rawPayload: payload
  };
}

export function maskAccountNumber(value: unknown): string {
  const normalized = normalizeAccountNumber(value);
  if (normalized.length <= 4) return '*'.repeat(normalized.length);
  return `${'*'.repeat(Math.min(8, normalized.length - 4))}${normalized.slice(-4)}`;
}

export function normalizeReference(value: unknown): string {
  return String(value || '').trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
}

export function referenceCandidates(event: Pick<NormalizedCoopEvent, 'paymentReference' | 'customerMemoLine1' | 'customerMemoLine2' | 'customerMemoLine3' | 'narration'>): string[] {
  const values = [event.paymentReference, event.customerMemoLine1, event.customerMemoLine2, event.customerMemoLine3, event.narration];
  const candidates = values.flatMap(value => {
    const raw = String(value || '').trim();
    if (!raw) return [];
    return [raw, ...raw.split(/[\s,:;|/_-]+/g)];
  }).map(normalizeReference).filter(value => value.length >= 4);
  return [...new Set(candidates)];
}

export function classifyEventType(eventType: unknown): { processingStatus: CoopProcessingStatus; reconciliationStatus: CoopReconciliationStatus; reason?: string } {
  const normalized = String(eventType || '').trim().toUpperCase();
  if (normalized === 'CREDIT') return { processingStatus: 'PROCESSED', reconciliationStatus: 'NOT_EVALUATED' };
  if (normalized === 'DEBIT') return { processingStatus: 'PROCESSED', reconciliationStatus: 'IGNORED_DEBIT', reason: 'Debit events are retained for audit and are not member contributions.' };
  return { processingStatus: 'QUARANTINED', reconciliationStatus: 'NOT_EVALUATED', reason: `Unsupported event type: ${normalized || 'EMPTY'}` };
}
