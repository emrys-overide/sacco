import assert from 'node:assert/strict';
import test from 'node:test';
import {
  CoopIpnError,
  assertCoopIpnAuthentication,
  assertCoopIpnConfiguration,
  buildCoopIdempotencyKey,
  classifyEventType,
  loadCoopIpnConfig,
  maskAccountNumber,
  normalizeCoopIpnPayload,
  normalizeDecimal,
  normalizeReference,
  referenceCandidates
} from '../src/server/coopBankIpn';

const config = loadCoopIpnConfig({
  COOP_IPN_ENABLED: 'true',
  COOP_IPN_AUTH_MODE: 'TOKEN',
  COOP_IPN_TOKEN: 'secret-token',
  COOP_ALLOWED_ACCOUNT_NUMBERS: '01134248358600'
});

const payload = {
  AcctNo: '01134248358600', Amount: '22459.0', Currency: 'KES', EventType: 'credit',
  TransactionId: 'CB0045889_06112023', PaymentRef: 'MEM-001', PostingDate: '2023-11-06+03:00'
};

test('normalizes exact decimals and rejects unsafe numeric input', () => {
  assert.equal(normalizeDecimal('22459.0', 'Amount', false), '22459.00');
  assert.equal(normalizeDecimal('1.12345678', 'ExchangeRate', true, 8), '1.12345678');
  for (const value of ['NaN', 'Infinity', '-1', '1.234', '']) {
    assert.throws(() => normalizeDecimal(value, 'Amount', false), CoopIpnError);
  }
});

test('authenticates configured token and basic modes', () => {
  assert.doesNotThrow(() => assertCoopIpnAuthentication('Bearer secret-token', config));
  assert.throws(() => assertCoopIpnAuthentication('Bearer wrong', config), CoopIpnError);
  const basic = loadCoopIpnConfig({ COOP_IPN_ENABLED: 'true', COOP_IPN_AUTH_MODE: 'BASIC', COOP_IPN_BASIC_USERNAME: 'bank', COOP_IPN_BASIC_PASSWORD: 'pass', COOP_ALLOWED_ACCOUNT_NUMBERS: '1' });
  assert.doesNotThrow(() => assertCoopIpnAuthentication(`Basic ${Buffer.from('bank:pass').toString('base64')}`, basic));
  const configurableToken = loadCoopIpnConfig({ COOP_IPN_ENABLED: 'true', COOP_IPN_AUTH_MODE: 'TOKEN', COOP_IPN_TOKEN: 'secret-token', COOP_IPN_TOKEN_HEADER: 'x-bank-token', COOP_IPN_TOKEN_SCHEME: 'Token', COOP_ALLOWED_ACCOUNT_NUMBERS: '1' });
  assert.equal(configurableToken.tokenHeader, 'x-bank-token');
  assert.doesNotThrow(() => assertCoopIpnAuthentication('Token secret-token', configurableToken));
  assert.throws(() => assertCoopIpnConfiguration(loadCoopIpnConfig({ COOP_IPN_ENABLED: 'true', COOP_IPN_AUTH_MODE: 'TOKEN' })), (error: any) => error.status === 503);
});

test('validates payload, account and deterministic identity', () => {
  const event = normalizeCoopIpnPayload(payload, config);
  assert.equal(event.amount, '22459.00');
  assert.equal(event.eventType, 'CREDIT');
  assert.equal(event.idempotencyKey, 'COOP_BANK:CB0045889_06112023');
  assert.equal(buildCoopIdempotencyKey(' cb0045889_06112023 '), event.idempotencyKey);
  assert.throws(() => normalizeCoopIpnPayload({ ...payload, AcctNo: '999' }, config), (error: any) => error.status === 403);
  assert.throws(() => normalizeCoopIpnPayload({ ...payload, TransactionId: '' }, config), CoopIpnError);
  assert.throws(() => normalizeCoopIpnPayload({ ...payload, Currency: 'KESH' }, config), CoopIpnError);
  assert.throws(() => normalizeCoopIpnPayload({ ...payload, EventType: { value: 'CREDIT' } }, config), CoopIpnError);
  assert.throws(() => normalizeCoopIpnPayload({ ...payload, PostingDate: '2023-99-99+03:00' }, config), CoopIpnError);
});

test('preserves and normalizes all sixteen documented notification fields', () => {
  const event = normalizeCoopIpnPayload({
    AcctNo: '01134248358600',
    Amount: '22459.0',
    BookedBalance: '100000.9',
    ClearedBalance: '99999.9',
    Currency: 'KES',
    CustMemoLine1: 'CHQ No.123',
    CustMemoLine2: 'MEM-001',
    CustMemoLine3: '',
    EventType: 'DEBIT',
    ExchangeRate: '1.12345678',
    Narration: 'Cheque payment',
    PaymentRef: '06112023_153977988',
    PostingDate: '2023-11-06+03:00',
    ValueDate: '2023-11-06+03:00',
    TransactionDate: '2023-11-06+03:00',
    TransactionId: 'CB0045889_06112023'
  }, config);
  assert.deepEqual({
    amount: event.amount,
    bookedBalance: event.bookedBalance,
    clearedBalance: event.clearedBalance,
    exchangeRate: event.exchangeRate,
    paymentReference: event.paymentReference,
    postingDate: event.postingDate,
    valueDate: event.valueDate,
    transactionDate: event.transactionDate,
    eventType: event.eventType
  }, {
    amount: '22459.00', bookedBalance: '100000.90', clearedBalance: '99999.90',
    exchangeRate: '1.12345678', paymentReference: '06112023_153977988',
    postingDate: '2023-11-06+03:00', valueDate: '2023-11-06+03:00',
    transactionDate: '2023-11-06+03:00', eventType: 'DEBIT'
  });
  assert.equal(classifyEventType(event.eventType).reconciliationStatus, 'IGNORED_DEBIT');
});

test('normalizes references, masks accounts and classifies safely', () => {
  assert.equal(normalizeReference(' KDA-123 A '), 'KDA123A');
  assert.deepEqual(referenceCandidates({ paymentReference: 'MEM-001', narration: 'paid KDA 123A' }), ['MEM001', 'PAIDKDA123A', 'PAID', '123A']);
  assert.equal(maskAccountNumber('01134248358600').endsWith('8600'), true);
  assert.equal(classifyEventType('debit').reconciliationStatus, 'IGNORED_DEBIT');
  assert.equal(classifyEventType('reversal').processingStatus, 'QUARANTINED');
});
