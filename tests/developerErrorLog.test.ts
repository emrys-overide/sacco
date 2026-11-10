import assert from 'node:assert/strict';
import test from 'node:test';
import { canViewDeveloperErrorLog, redactErrorText, safeErrorPath } from '../src/server/developerErrorLog';

test('allows the private diagnostics page only for explicitly configured developer emails', () => {
  const configured = 'dev@example.test, operations@example.test';
  assert.equal(canViewDeveloperErrorLog('DEV@example.test', configured), true);
  assert.equal(canViewDeveloperErrorLog('member@example.test', configured), false);
  assert.equal(canViewDeveloperErrorLog('dev@example.test', ''), false);
});

test('redacts credentials and drops query strings from recorded diagnostics', () => {
  const message = redactErrorText('Authorization: Bearer abc.def.ghi password=hunter2 token=123');
  assert.equal(message.includes('hunter2'), false);
  assert.equal(message.includes('abc.def.ghi'), false);
  assert.equal(message.includes('123'), false);
  assert.equal(safeErrorPath('/api/member-portal?reset=secret#fragment'), '/api/member-portal');
});
