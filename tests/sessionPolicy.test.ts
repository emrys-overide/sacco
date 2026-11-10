import test from 'node:test';
import assert from 'node:assert/strict';
import { isSessionIdle, SESSION_IDLE_TIMEOUT_MS } from '../src/server/sessionPolicy';

test('keeps an active session and expires it at one hour of inactivity', () => {
  const now = Date.parse('2026-07-20T12:00:00Z');
  assert.equal(isSessionIdle(new Date(now - SESSION_IDLE_TIMEOUT_MS + 1).toISOString(), now), false);
  assert.equal(isSessionIdle(new Date(now - SESSION_IDLE_TIMEOUT_MS).toISOString(), now), true);
  assert.equal(isSessionIdle(new Date(now - SESSION_IDLE_TIMEOUT_MS - 1).toISOString(), now), true);
});

test('fails closed for malformed activity timestamps while allowing migration nulls', () => {
  assert.equal(isSessionIdle(undefined), false);
  assert.equal(isSessionIdle('not-a-date'), true);
});
