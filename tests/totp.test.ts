import assert from 'node:assert/strict';
import test from 'node:test';
import { createBase32Secret, createTotpCode, createTotpUri, verifyTotpCode } from '../src/server/totp';

test('creates six-digit time-based codes accepted only in the bounded verification window', () => {
  const secret = 'JBSWY3DPEHPK3PXP';
  const timestamp = 1_700_000_000_000;
  const code = createTotpCode(secret, timestamp);
  assert.match(code, /^\d{6}$/);
  assert.equal(verifyTotpCode(secret, code, timestamp), true);
  assert.equal(verifyTotpCode(secret, code, timestamp + 30_000 * 3), false);
  assert.equal(verifyTotpCode(secret, '000000', timestamp), false);
});

test('creates a Base32 secret and standard Google Authenticator provisioning URI', () => {
  const secret = createBase32Secret();
  assert.match(secret, /^[A-Z2-7]+$/);
  const uri = createTotpUri('Sowetamu Sacco', 'chair@example.test', secret);
  assert.match(uri, /^otpauth:\/\/totp\//);
  assert.match(uri, /issuer=Sowetamu%20Sacco/);
});
