import assert from 'node:assert/strict';
import { spawn, type ChildProcess } from 'node:child_process';
import test from 'node:test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

type Result = { status: number; data: any; headers: Headers };

function base64UrlJson(value: unknown) {
  return Buffer.from(JSON.stringify(value)).toString('base64url');
}

function forgeRoleClaim(token: string, role: string) {
  const [header, payload, signature] = token.split('.');
  const decoded = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
  return `${header}.${base64UrlJson({ ...decoded, role })}.${signature}`;
}

async function waitForHealth(baseUrl: string, server: ChildProcess, getLogs: () => string) {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    if (server.exitCode !== null) throw new Error(`Red-team server stopped early.\n${getLogs()}`);
    try {
      if ((await fetch(`${baseUrl}/api/health`, { signal: AbortSignal.timeout(750) })).ok) return;
    } catch {
      // Wait for the isolated test server.
    }
    await new Promise(resolve => setTimeout(resolve, 125));
  }
  throw new Error(`Red-team server did not become ready.\n${getLogs()}`);
}

test('red-team checks deny token forgery, privilege escalation, and cross-member data access', { timeout: 60_000 }, async t => {
  const port = 5500 + (process.pid % 400);
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
      JWT_SECRET: 'isolated-red-team-secret',
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
  const chairman = await request('/api/auth/bootstrap', {
    method: 'POST', body: { fullName: 'Red Team Chairman', email: 'chair.red@example.com', phone: '0700000003', password: 'chairman-red-password' }
  });
  assert.equal(chairman.status, 201, logs);
  const chairmanToken = chairman.data.token as string;

  const createMember = async (id: string, name: string, nationalId: string, email: string, phone: string) => {
    const result = await request('/api/members', {
      method: 'POST', token: chairmanToken,
      body: { id, name, idNumber: nationalId, email, phoneNumber: phone, status: 'Active' }
    });
    assert.equal(result.status, 201, JSON.stringify(result.data));
    return result.data;
  };
  const memberA = await createMember('member-red-a', 'Alice Redteam', '44440001', 'alice.red@example.com', '0711000001');
  const memberB = await createMember('member-red-b', 'Brian Redteam', '44440002', 'brian.red@example.com', '0711000002');
  const vehicleB = await request('/api/vehicles', {
    method: 'POST', token: chairmanToken,
    body: { id: 'vehicle-red-b', plateNumber: 'KDF 456B', ownerId: memberB.id, driverName: 'Brian Driver', driverPhone: '0700000004', status: 'Active', capacity: 14 }
  });
  assert.equal(vehicleB.status, 201, JSON.stringify(vehicleB.data));
  const transactionB = await request('/api/transactions', {
    method: 'POST', token: chairmanToken,
    body: {
      id: 'transaction-red-b', memberId: memberB.id, memberName: memberB.name, vehiclePlate: vehicleB.data.plateNumber,
      description: 'Private contribution for member B', refCode: 'RED-B-001', type: 'Credit', category: 'Daily Contribution', amount: 500, tillNumber: 'VehicleTill'
    }
  });
  assert.equal(transactionB.status, 201, JSON.stringify(transactionB.data));

  for (const details of [
    { fullName: memberA.name, email: 'alice.red@example.com', phone: '0711000001', password: 'member-a-password' },
    { fullName: memberB.name, email: 'brian.red@example.com', phone: '0711000002', password: 'member-b-password' }
  ]) {
    const registration = await request('/api/auth/member-registration', { method: 'POST', body: details });
    assert.equal(registration.status, 201, JSON.stringify(registration.data));
  }
  const memberALogin = await request('/api/auth/login', {
    method: 'POST', body: { identifier: 'alice.red@example.com', password: 'member-a-password' }
  });
  assert.equal(memberALogin.status, 200, JSON.stringify(memberALogin.data));
  const memberAToken = memberALogin.data.token as string;

  // Attempt an IDOR attack by supplying member B's identifiers in query strings.
  const scopedReads = await Promise.all([
    request(`/api/members?memberId=${memberB.id}`, { token: memberAToken }),
    request(`/api/vehicles?memberId=${memberB.id}`, { token: memberAToken }),
    request(`/api/transactions?memberId=${memberB.id}`, { token: memberAToken }),
    request(`/api/payments?memberId=${memberB.id}`, { token: memberAToken }),
    request(`/api/system/status?memberId=${memberB.id}`, { token: memberAToken })
  ]);
  assert.ok(scopedReads.every(result => result.status === 200));
  assert.equal(scopedReads[0].data.length, 1);
  assert.equal(scopedReads[0].data[0].id, memberA.id);
  assert.notEqual(scopedReads[0].data[0].idNumber, '44440001');
  assert.deepEqual(scopedReads[1].data, []);
  assert.deepEqual(scopedReads[2].data, []);
  assert.deepEqual(scopedReads[3].data, []);
  assert.equal(scopedReads[4].data.totalMembersCount, 1);

  // A changed role claim without a matching signature must not become Chairman access.
  const forgedChairmanToken = forgeRoleClaim(memberAToken, 'Chairman');
  assert.equal((await request('/api/users', { token: forgedChairmanToken })).status, 401);

  // A normal Member cannot turn a request body into a privileged action.
  const escalationAttempts = await Promise.all([
    request('/api/users', { method: 'POST', token: memberAToken, body: { fullName: 'Injected Chairman', email: 'injected@example.com', role: 'Chairman', password: 'injected-password' } }),
    request('/api/users/not-a-real-user/password', { method: 'POST', token: memberAToken, body: { password: 'injected-password' } }),
    request('/api/transactions', { method: 'POST', token: memberAToken, body: { description: 'Injected ledger record', refCode: 'INJECTED-1', type: 'Credit', category: 'Daily Contribution', amount: 1, tillNumber: 'VehicleTill' } }),
    request('/api/coop-bank/events', { token: memberAToken }),
    request('/api/developer-errors?status=all', { token: memberAToken }),
    request('/api/password-reset-requests', { token: memberAToken })
  ]);
  assert.ok(escalationAttempts.every(result => result.status === 403));

  // Injection-like and malformed credentials must not authenticate or produce a 5xx.
  const suspiciousInputs = await Promise.all([
    request('/api/auth/login', { method: 'POST', body: { identifier: "' OR '1'='1", password: 'anything' } }),
    request('/api/auth/login', { method: 'POST', body: { identifier: '<script>alert(1)</script>', password: 'anything' } }),
    request('/api/auth/login', { method: 'POST', rawBody: '{"identifier":' })
  ]);
  assert.equal(suspiciousInputs[0].status, 401);
  assert.equal(suspiciousInputs[1].status, 401);
  assert.equal(suspiciousInputs[2].status, 400);
  assert.ok(suspiciousInputs.every(result => result.status < 500));

  const resetUnknown = await request('/api/auth/password-reset-request', { method: 'POST', body: { identifier: '0799999999' } });
  const resetKnown = await request('/api/auth/password-reset-request', { method: 'POST', body: { identifier: '0711000001' } });
  assert.equal(resetUnknown.status, 200);
  assert.equal(resetKnown.status, 200);
  assert.equal(resetUnknown.data.message, resetKnown.data.message);
  assert.equal((await request('/api/health')).status, 200);
});
