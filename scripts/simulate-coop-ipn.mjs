import 'dotenv/config';
import { readFile } from 'node:fs/promises';

if (process.env.NODE_ENV === 'production') throw new Error('The Co-op IPN simulator is disabled in production.');

const args = Object.fromEntries(process.argv.slice(2).map((value, index, values) => {
  if (!value.startsWith('--')) return [value, true];
  const [key, inline] = value.slice(2).split('=', 2);
  return [key, inline ?? (values[index + 1]?.startsWith('--') ? true : values[index + 1])];
}));
const fixtures = JSON.parse(await readFile(new URL('./fixtures/coop-ipn.json', import.meta.url), 'utf8'));
const fixtureName = String(args.fixture || 'valid-credit');
const selected = fixtures[fixtureName];
if (!selected) throw new Error(`Unknown fixture "${fixtureName}". Available: ${Object.keys(fixtures).join(', ')}`);

const body = { ...selected };
const invalidToken = body._invalidToken === true;
delete body._invalidToken;
if (args.account) body.AcctNo = String(args.account);
if (args.transaction) body.TransactionId = String(args.transaction);
if (args.reference) body.PaymentRef = String(args.reference);
if (args.amount) body.Amount = String(args.amount);
if (args.event) body.EventType = String(args.event).toUpperCase();
if (args.narration) body.Narration = String(args.narration);
if (args.memo1) body.CustMemoLine1 = String(args.memo1);
if (args.memo2) body.CustMemoLine2 = String(args.memo2);
if (args.memo3) body.CustMemoLine3 = String(args.memo3);

const mode = String(args.auth || process.env.COOP_IPN_AUTH_MODE || 'TOKEN').toUpperCase();
const headers = { 'Content-Type': 'application/json' };
if (mode === 'BASIC') {
  const username = String(args.username || process.env.COOP_IPN_BASIC_USERNAME || '');
  const password = String(args.password || process.env.COOP_IPN_BASIC_PASSWORD || '');
  headers.Authorization = `Basic ${Buffer.from(`${username}:${password}`).toString('base64')}`;
} else {
  const token = invalidToken ? 'intentionally-invalid-token' : String(args.token || process.env.COOP_IPN_TOKEN || '');
  const tokenHeader = String(args['token-header'] || process.env.COOP_IPN_TOKEN_HEADER || 'authorization');
  const tokenScheme = String(args['token-scheme'] ?? process.env.COOP_IPN_TOKEN_SCHEME ?? 'Bearer').trim();
  headers[tokenHeader] = tokenScheme ? `${tokenScheme} ${token}` : token;
}

const url = String(args.url || `http://127.0.0.1:${process.env.PORT || 3000}/api/integrations/coop/ipn`);
const response = await fetch(url, { method: 'POST', headers, body: JSON.stringify(body) });
const text = await response.text();
console.log(JSON.stringify({ fixture: fixtureName, url, status: response.status, response: text ? JSON.parse(text) : null }, null, 2));
if (!response.ok) process.exitCode = 1;
