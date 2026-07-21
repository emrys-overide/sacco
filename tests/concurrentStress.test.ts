import assert from 'node:assert/strict';
import { spawn, type ChildProcess } from 'node:child_process';
import test from 'node:test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

type Result = { status: number; data: any; headers: Headers };

async function waitForHealth(baseUrl: string, server: ChildProcess, getLogs: () => string) {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    if (server.exitCode !== null) throw new Error(`Stress-test server stopped early.\n${getLogs()}`);
    try {
      const response = await fetch(`${baseUrl}/api/health`, { signal: AbortSignal.timeout(750) });
      if (response.ok) return;
    } catch {
      // The isolated test server is still starting.
    }
    await new Promise(resolve => setTimeout(resolve, 125));
  }
  throw new Error(`Stress-test server did not become ready.\n${getLogs()}`);
}

test('keeps concurrent member workflows consistent and rejects security abuse', { timeout: 60_000 }, async t => {
  const port = 5000 + (process.pid % 500);
  const baseUrl = `http://127.0.0.1:${port}`;
  let logs = '';
  const server = spawn(process.execPath, ['--import', 'tsx', 'start.ts'], {
    cwd: repoRoot,
    detached: true,
    env: {
      ...process.env,
      DOTENV_CONFIG_PATH: '/dev/null',
      DATABASE_URL: '',
      PORT: String(port),
      APP_URL: baseUrl,
      NODE_ENV: 'development',
      ALLOW_IN_MEMORY_DB: 'true',
      ALLOW_DEV_AUTH_FALLBACK: 'true',
      ALLOW_DEV_JWT_AUTH: 'true',
      JWT_SECRET: 'isolated-stress-test-secret',
      TOTP_ENCRYPTION_KEY: 'MDEyMzQ1Njc4OWFiY2RlZjAxMjM0NTY3ODlhYmNkZWY=',
      OFFICER_TOTP_REQUIRED: 'false',
      COOP_IPN_ENABLED: 'false',
      SACCO_TEST_MODE: 'true',
      DISABLE_HMR: 'true'
    },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  server.stdout?.on('data', chunk => { logs += chunk.toString(); });
  server.stderr?.on('data', chunk => { logs += chunk.toString(); });
  t.after(() => {
    if (!server.pid || server.exitCode !== null) return;
    try { process.kill(-server.pid, 'SIGTERM'); } catch { server.kill('SIGTERM'); }
  });

  const request = async (pathName: string, options: { method?: string; token?: string; body?: unknown; rawBody?: string } = {}): Promise<Result> => {
    const response = await fetch(`${baseUrl}${pathName}`, {
      method: options.method || 'GET',
      headers: {
        ...(options.token ? { Authorization: `Bearer ${options.token}` } : {}),
        ...(options.body !== undefined || options.rawBody !== undefined ? { 'Content-Type': 'application/json' } : {})
      },
      body: options.rawBody ?? (options.body === undefined ? undefined : JSON.stringify(options.body)),
      signal: AbortSignal.timeout(8_000)
    });
    const text = await response.text();
    let data: any = null;
    try { data = text ? JSON.parse(text) : null; } catch { data = text; }
    return { status: response.status, data, headers: response.headers };
  };

  await waitForHealth(baseUrl, server, () => logs);
  const bootstrap = await request('/api/auth/bootstrap', {
    method: 'POST',
    body: { fullName: 'Stress Test Chairman', email: 'chair.stress@example.com', phone: '0700000000', password: 'chairman-stress-password' }
  });
  assert.equal(bootstrap.status, 201, logs);
  const chairmanToken = bootstrap.data.token as string;

  const secretary = await request('/api/users', {
    method: 'POST', token: chairmanToken,
    body: { fullName: 'Stress Test Secretary', email: 'secretary.stress@example.com', phone: '0700000005', role: 'Secretary', password: 'secretary-stress-password' }
  });
  assert.equal(secretary.status, 201, JSON.stringify(secretary.data));
  const secretaryLogin = await request('/api/auth/login', {
    method: 'POST', body: { identifier: 'secretary.stress@example.com', password: 'secretary-stress-password' }
  });
  assert.equal(secretaryLogin.status, 200, JSON.stringify(secretaryLogin.data));
  const secretaryToken = secretaryLogin.data.token as string;

  const member = await request('/api/members', {
    method: 'POST', token: chairmanToken,
    body: { id: 'member-stress-one', name: 'Stress Member', idNumber: '55556666', email: 'member.stress@example.com', phoneNumber: '0711000000', status: 'Active' }
  });
  assert.equal(member.status, 201, JSON.stringify(member.data));

  // Parallel registration attempts for one identity must create exactly one account.
  const registrations = await Promise.all(Array.from({ length: 24 }, () => request('/api/auth/member-registration', {
    method: 'POST',
    body: { fullName: 'Stress Member', email: 'member.stress@example.com', phone: '0711000000', password: 'parallel-member-password' }
  })));
  assert.equal(registrations.filter(result => result.status === 201).length, 1);
  assert.equal(registrations.filter(result => result.status === 409).length, 23);

  const memberLogin = await request('/api/auth/login', {
    method: 'POST', body: { identifier: 'member.stress@example.com', password: 'parallel-member-password' }
  });
  assert.equal(memberLogin.status, 200, JSON.stringify(memberLogin.data));
  const memberToken = memberLogin.data.token as string;

  // A bounded real-client burst: 60 authenticated member reads and 60 health
  // checks run together, with the member response remaining scoped and masked.
  const readBurst = await Promise.all([
    ...Array.from({ length: 60 }, () => request('/api/member-portal', { token: memberToken })),
    ...Array.from({ length: 60 }, () => request('/api/health'))
  ]);
  const portalResponses = readBurst.slice(0, 60);
  assert.ok(portalResponses.every(result => result.status === 200));
  assert.ok(portalResponses.every(result => result.data.member.id === 'member-stress-one'));
  assert.ok(portalResponses.every(result => result.data.member.idNumber !== '55556666'));
  assert.ok(readBurst.slice(60).every(result => result.status === 200));

  // Public reset requests can be burst without multiplying pending work or
  // leaking whether the supplied identity belongs to a member.
  const resetBurst = await Promise.all(Array.from({ length: 30 }, () => request('/api/auth/password-reset-request', {
    method: 'POST', body: { identifier: 'member.stress@example.com' }
  })));
  assert.ok(resetBurst.every(result => result.status === 200));
  assert.equal(new Set(resetBurst.map(result => result.data.message)).size, 1);
  assert.match(resetBurst[0].data.message, /Contact them directly to confirm your identity\./);
  const pendingResets = await request('/api/password-reset-requests', { token: chairmanToken });
  assert.equal(pendingResets.status, 200);
  assert.equal(pendingResets.data.length, 1);
  const chairmanNotifications = await request('/api/notifications', { token: chairmanToken });
  assert.equal(chairmanNotifications.status, 200);
  assert.equal(chairmanNotifications.data.items.filter((item: any) => item.category === 'PASSWORD_RESET_REQUEST').length, 1);

  // Chairman recovery uses the same bounded public-request protection, but its
  // one durable request and notification belong only to the Secretary.
  const recoveryBurst = await Promise.all(Array.from({ length: 30 }, () => request('/api/auth/chairman-recovery-request', {
    method: 'POST', body: { identifier: 'chair.stress@example.com' }
  })));
  assert.ok(recoveryBurst.every(result => result.status === 200));
  assert.equal(new Set(recoveryBurst.map(result => result.data.message)).size, 1);
  const pendingRecoveries = await request('/api/chairman-recovery-requests', { token: secretaryToken });
  assert.equal(pendingRecoveries.status, 200);
  assert.equal(pendingRecoveries.data.length, 1);
  const secretaryNotifications = await request('/api/notifications', { token: secretaryToken });
  assert.equal(secretaryNotifications.status, 200);
  assert.equal(secretaryNotifications.data.items.filter((item: any) => item.category === 'CHAIRMAN_RECOVERY_REQUEST').length, 1);
  assert.equal((await request('/api/chairman-recovery-requests', { token: chairmanToken })).status, 403);

  // Parallel authorization and malformed-token attempts must never become a
  // successful privileged request or expose a server error.
  const authorizationBurst = await Promise.all([
    ...Array.from({ length: 50 }, () => request('/api/users', { token: memberToken })),
    ...Array.from({ length: 50 }, () => request('/api/members', { token: 'not.a.valid.token' }))
  ]);
  assert.ok(authorizationBurst.slice(0, 50).every(result => result.status === 403));
  assert.ok(authorizationBurst.slice(50).every(result => result.status === 401));

  const malformedBurst = await Promise.all(Array.from({ length: 20 }, () => request('/api/auth/login', {
    method: 'POST', rawBody: '{"identifier":'
  })));
  assert.ok(malformedBurst.every(result => result.status === 400));

  const tooLargeBody = JSON.stringify({ identifier: 'member.stress@example.com', password: 'x'.repeat(310 * 1024) });
  const largeBodyBurst = await Promise.all(Array.from({ length: 6 }, () => request('/api/auth/login', {
    method: 'POST', rawBody: tooLargeBody
  })));
  assert.ok(largeBodyBurst.every(result => result.status === 413));

  // Login throttling remains effective even when the failures arrive together.
  const badLogins = await Promise.all(Array.from({ length: 14 }, () => request('/api/auth/login', {
    method: 'POST', body: { identifier: 'member.stress@example.com', password: 'incorrect-password' }
  })));
  assert.ok(badLogins.every(result => result.status === 401 || result.status === 429));
  assert.ok(badLogins.some(result => result.status === 429));
  const throttledCorrectLogin = await request('/api/auth/login', {
    method: 'POST', body: { identifier: 'member.stress@example.com', password: 'parallel-member-password' }
  });
  assert.equal(throttledCorrectLogin.status, 429);
  assert.equal((await request('/api/health')).status, 200);
});
