import assert from 'node:assert/strict';
import test from 'node:test';
import { securityHeaders } from '../src/server/securityMiddleware';

test('relaxes development CSP for Vite dev client support', () => {
  const headers: Record<string, string> = {};
  const res = {
    setHeader(name: string, value: string) {
      headers[name] = value;
    }
  };
  const req = { path: '/', secure: false };
  let nextCalled = false;

  securityHeaders(false)(req as any, res as any, () => {
    nextCalled = true;
  });

  assert.equal(nextCalled, true);
  assert.match(headers['Content-Security-Policy'] || '', /script-src 'self' 'unsafe-inline'/);
  assert.match(headers['Content-Security-Policy'] || '', /connect-src 'self' ws: wss:/);
});

test('prevents search indexing and caching of protected API responses', () => {
  const headers: Record<string, string> = {};
  const res = {
    setHeader(name: string, value: string) {
      headers[name] = value;
    }
  };

  securityHeaders(true)({ path: '/api/members', secure: true } as any, res as any, () => {});

  assert.equal(headers['Cache-Control'], 'no-store');
  assert.equal(headers['X-Robots-Tag'], 'noindex, nofollow');
  assert.match(headers['Content-Security-Policy'] || '', /https:\/\/fonts\.googleapis\.com/);
  assert.match(headers['Content-Security-Policy'] || '', /https:\/\/fonts\.gstatic\.com/);
});
