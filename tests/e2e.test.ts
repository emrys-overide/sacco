import assert from 'node:assert/strict';
import { spawn, type ChildProcess } from 'node:child_process';
import test from 'node:test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createTotpCode } from '../src/server/totp';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

type RequestOptions = {
  method?: string;
  token?: string;
  headers?: Record<string, string>;
  body?: unknown;
};

async function waitForHealth(baseUrl: string, server: ChildProcess, getLogs: () => string) {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    if (server.exitCode !== null) {
      throw new Error(`E2E server exited before becoming healthy.\n${getLogs()}`);
    }
    try {
      const response = await fetch(`${baseUrl}/api/health`, { signal: AbortSignal.timeout(750) });
      if (response.ok) return response.json();
    } catch {
      // The server is still starting.
    }
    await new Promise(resolve => setTimeout(resolve, 150));
  }
  throw new Error(`E2E server did not become healthy.\n${getLogs()}`);
}

test('runs the clean-install SACCO workflow end to end', { timeout: 45_000 }, async t => {
  const databaseUrl = process.env.E2E_DATABASE_URL || '';
  const port = 4400 + (process.pid % 500);
  const baseUrl = `http://127.0.0.1:${port}`;
  let logs = '';
  const server = spawn(process.execPath, ['--import', 'tsx', 'server.ts'], {
    cwd: repoRoot,
    detached: true,
    env: {
      ...process.env,
      DOTENV_CONFIG_PATH: '/dev/null',
      DATABASE_URL: databaseUrl,
      FIREBASE_PROJECT_ID: '',
      FIREBASE_SERVICE_ACCOUNT_JSON: '',
      GOOGLE_APPLICATION_CREDENTIALS: '',
      GOOGLE_CLOUD_PROJECT: '',
      GCLOUD_PROJECT: '',
      FIRESTORE_DATABASE_ID: '',
      PORT: String(port),
      NODE_ENV: 'development',
      ALLOW_IN_MEMORY_DB: 'true',
      ALLOW_DEV_AUTH_FALLBACK: 'true',
      ALLOW_DEV_JWT_AUTH: 'true',
      JWT_SECRET: 'isolated-e2e-secret',
      TOTP_ENCRYPTION_KEY: 'MDEyMzQ1Njc4OWFiY2RlZjAxMjM0NTY3ODlhYmNkZWY=',
      COOP_B2B_IPN_AUTH_MODE: 'token',
      COOP_B2B_IPN_TOKEN: 'isolated-coop-bank-token',
      COOP_B2B_ALLOWED_ACCOUNT_NUMBERS: '01134248358600',
      SACCO_TEST_MODE: databaseUrl ? 'false' : 'true',
      VITE_FIREBASE_AUTH_ENABLED: 'false',
      DISABLE_HMR: 'true'
    },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  server.stdout?.on('data', chunk => { logs += chunk.toString(); });
  server.stderr?.on('data', chunk => { logs += chunk.toString(); });

  t.after(() => {
    if (!server.pid || server.exitCode !== null) return;
    try {
      process.kill(-server.pid, 'SIGTERM');
    } catch {
      server.kill('SIGTERM');
    }
  });

  const request = async <T = any>(pathName: string, expectedStatus: number, options: RequestOptions = {}): Promise<T> => {
    const response = await fetch(`${baseUrl}${pathName}`, {
      method: options.method || 'GET',
      headers: {
        ...(options.token ? { Authorization: `Bearer ${options.token}` } : {}),
        ...(options.headers || {}),
        ...(options.body === undefined ? {} : { 'Content-Type': 'application/json' })
      },
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
      signal: AbortSignal.timeout(5_000)
    });
    const text = await response.text();
    const data = text ? JSON.parse(text) : null;
    assert.equal(response.status, expectedStatus, `${options.method || 'GET'} ${pathName}: ${text}\n${logs}`);
    return data as T;
  };

  const health = await waitForHealth(baseUrl, server, () => logs);
  assert.equal(health.database, databaseUrl ? 'postgres_configured' : 'local_fallback');

  const bootstrap = await request('/api/auth/bootstrap', 201, {
    method: 'POST',
    body: {
      email: 'chairman.e2e@example.com',
      fullName: 'E Two E Chairman',
      phone: '0712345678',
      password: 'test-password'
    }
  });
  assert.equal(bootstrap.user.role, 'Chairman');
  assert.equal(bootstrap.requiresTotp, true);
  assert.ok(bootstrap.challengeId);
  assert.ok(bootstrap.enrollment?.manualKey);
  const bootstrapTotp = await request('/api/auth/totp/verify', 200, {
    method: 'POST',
    body: { challengeId: bootstrap.challengeId, code: createTotpCode(bootstrap.enrollment.manualKey) }
  });
  const token = bootstrapTotp.token as string;
  assert.ok(token);

  await request('/api/auth/bootstrap', 409, {
    method: 'POST',
    body: {
      email: 'second@example.com',
      fullName: 'Second Chairman',
      password: 'test-password'
    }
  });
  await request('/api/auth/login', 401, {
    method: 'POST',
    body: { email: 'chairman.e2e@example.com', password: 'wrong-password' }
  });
  const login = await request('/api/auth/login', 200, {
    method: 'POST',
    body: { email: 'chairman.e2e@example.com', password: 'test-password' }
  });
  assert.equal(login.requiresTotp, true);
  const loginTotp = await request('/api/auth/totp/verify', 200, {
    method: 'POST',
    body: { challengeId: login.challengeId, code: createTotpCode(bootstrap.enrollment.manualKey) }
  });
  const loginToken = loginTotp.token as string;
  const treasurer = await request('/api/users', 201, {
    method: 'POST',
    token,
    body: {
      fullName: 'E Two E Treasurer',
      email: 'treasurer.e2e@example.com',
      phone: '0700000001',
      role: 'Treasurer',
      password: 'treasurer-password'
    }
  });
  assert.equal(treasurer.user.role, 'Treasurer');
  const treasurerLogin = await request('/api/auth/login', 200, {
    method: 'POST',
    body: { identifier: 'treasurer.e2e@example.com', password: 'treasurer-password' }
  });
  assert.equal(treasurerLogin.requiresTotp, true);
  assert.ok(treasurerLogin.enrollment?.manualKey);
  const treasurerTotp = await request('/api/auth/totp/verify', 200, {
    method: 'POST',
    body: { challengeId: treasurerLogin.challengeId, code: createTotpCode(treasurerLogin.enrollment.manualKey) }
  });
  assert.equal(treasurerTotp.user.role, 'Treasurer');
  assert.ok(treasurerTotp.token);
  await request('/api/members', 401);

  const firstMember = await request('/api/members', 201, {
    method: 'POST',
    token: loginToken,
    body: {
      id: 'member-e2e-one',
      name: 'Alice Kamau',
      idNumber: '11112222',
      phoneNumber: '0711111111',
      status: 'Active'
    }
  });
  const secondMember = await request('/api/members', 201, {
    method: 'POST',
    token: loginToken,
    body: {
      id: 'member-e2e-two',
      name: 'Brian Otieno',
      idNumber: '33334444',
      phoneNumber: '0722222222',
      status: 'Active'
    }
  });
  await request('/api/members', 409, {
    method: 'POST',
    token: loginToken,
    body: {
      id: 'member-e2e-duplicate',
      name: 'Duplicate Member',
      idNumber: '11112222',
      phoneNumber: '0733333333',
      status: 'Active'
    }
  });

  await request('/api/vehicles', 400, {
    method: 'POST',
    token: loginToken,
    body: {
      plateNumber: 'KDA 123A',
      ownerId: 'missing-member',
      ownerName: 'Missing Member',
      driverName: 'Test Driver',
      driverPhone: '0700000000',
      status: 'Active',
      capacity: 14
    }
  });
  const vehicle = await request('/api/vehicles', 201, {
    method: 'POST',
    token: loginToken,
    body: {
      id: 'vehicle-e2e-one',
      plateNumber: 'KDA 123A',
      ownerId: firstMember.id,
      ownerName: 'Tampered Owner Name',
      driverName: 'Test Driver',
      driverPhone: '0700000000',
      status: 'Active',
      capacity: 14
    }
  });
  assert.equal(vehicle.ownerName, firstMember.name);
  await request('/api/vehicles', 409, {
    method: 'POST',
    token: loginToken,
    body: {
      plateNumber: 'KDA123A',
      ownerId: firstMember.id,
      ownerName: firstMember.name,
      driverName: 'Another Driver',
      driverPhone: '0700000001',
      status: 'Active',
      capacity: 14
    }
  });

  await request('/api/transactions', 400, {
    method: 'POST',
    token: loginToken,
    body: {
      description: 'Unregistered contribution',
      refCode: 'E2E-MISSING-MEMBER',
      type: 'Credit',
      category: 'Daily Contribution',
      amount: 500,
      tillNumber: 'VehicleTill'
    }
  });
  await request('/api/transactions', 201, {
    method: 'POST',
    token,
    body: {
      description: 'Office stationery',
      refCode: 'E2E-EXPENSE-1',
      type: 'Debit',
      category: 'Office Expenses',
      amount: 200,
      tillNumber: 'VehicleTill'
    }
  });
  const daily = await request('/api/transactions', 201, {
    method: 'POST',
    token,
    body: {
      id: 'transaction-e2e-daily',
      memberId: firstMember.id,
      memberName: firstMember.name,
      vehiclePlate: vehicle.plateNumber,
      description: 'Daily vehicle contribution',
      refCode: 'E2E-DAILY-1',
      type: 'Credit',
      category: 'Daily Contribution',
      amount: 1000,
      tillNumber: 'VehicleTill'
    }
  });
  const corrected = await request(`/api/transactions/${daily.id}`, 200, {
    method: 'PUT',
    token,
    body: { amount: 1200, description: 'Corrected daily vehicle contribution' }
  });
  const afterCorrection = await request<any[]>('/api/members', 200, { token });
  const correctedMember = afterCorrection.find(member => member.id === firstMember.id);
  assert.equal(correctedMember.sharesAmount, 360);
  assert.equal(correctedMember.savingsAmount, 840);

  const reversal = await request(`/api/transactions/${corrected.id}/reverse`, 201, { method: 'POST', token });
  assert.equal(reversal.type, 'Debit');
  assert.equal(reversal.reversalOf, corrected.id);
  await request(`/api/transactions/${corrected.id}/reverse`, 409, { method: 'POST', token });

  const bankConfig = await request('/api/coop-bank/config', 200, { token });
  assert.equal(bankConfig.authMode, 'Token');
  assert.equal(bankConfig.configuredAccountCount, 1);
  await request('/api/webhooks/coop-bank/b2b-ipn', 401, {
    method: 'POST',
    body: { TransactionId: 'E2E-BANK-UNAUTH', AcctNo: '01134248358600', Amount: '1', Currency: 'KES', EventType: 'CREDIT' }
  });
  const bankPayload = {
    TransactionId: 'E2E-BANK-001',
    PaymentRef: 'E2E-PAYMENT-001',
    AcctNo: '01134248358600',
    Amount: '750.00',
    Currency: 'KES',
    EventType: 'CREDIT',
    Narration: 'Daily contribution KDA 123A',
    CustMemoLine1: 'Alice Kamau',
    BookedBalance: '15000.00',
    ClearedBalance: '14500.00',
    TransactionDate: '2026-07-15+03:00'
  };
  const received = await request('/api/webhooks/coop-bank/b2b-ipn', 201, {
    method: 'POST',
    headers: { Authorization: 'Bearer isolated-coop-bank-token' },
    body: bankPayload
  });
  assert.equal(received.MessageCode, '201');
  const duplicate = await request('/api/webhooks/coop-bank/b2b-ipn', 200, {
    method: 'POST',
    headers: { Authorization: 'Bearer isolated-coop-bank-token' },
    body: bankPayload
  });
  assert.equal(duplicate.MessageCode, '200');
  await request('/api/webhooks/coop-bank/b2b-ipn', 422, {
    method: 'POST',
    headers: { Authorization: 'Bearer isolated-coop-bank-token' },
    body: { ...bankPayload, TransactionId: 'E2E-BANK-UNKNOWN', AcctNo: '01134248358699' }
  });
  const bankEvents = await request<any[]>('/api/coop-bank/events', 200, { token });
  assert.equal(bankEvents.length, 1);
  assert.equal(bankEvents[0].transactionId, 'E2E-BANK-001');
  assert.equal(bankEvents[0].status, 'PendingReview');
  assert.equal(bankEvents[0].rawPayload, undefined);

  const finalMembers = await request<any[]>('/api/members', 200, { token });
  const memberOne = finalMembers.find(member => member.id === firstMember.id);
  const memberTwo = finalMembers.find(member => member.id === secondMember.id);
  assert.deepEqual(
    { shares: memberOne.sharesAmount, savings: memberOne.savingsAmount },
    { shares: 0, savings: 0 }
  );
  assert.deepEqual(
    { shares: memberTwo.sharesAmount, savings: memberTwo.savingsAmount },
    { shares: 0, savings: 0 }
  );

  const status = await request('/api/system/status', 200, { token });
  assert.ok(status.totalTransactionsCount >= 3);
  assert.equal(status.totalMembersCount, 2);
  assert.equal(status.totalFleetCount, 1);
  assert.equal(typeof status.netCashFlow, 'number');
  assert.equal(typeof status.totalCapitalReserve, 'number');
  assert.equal(typeof status.totalMemberSavings, 'number');

  if (!databaseUrl) {
    await request('/api/testing/member-profile', 201, {
      method: 'POST',
      token,
      body: {
        memberId: firstMember.id,
        email: 'alice.member@example.com',
        password: 'member-password'
      }
    });
    const memberLogin = await request('/api/auth/login', 200, {
      method: 'POST',
      body: { identifier: firstMember.phoneNumber, password: 'member-password' }
    });
    const memberToken = memberLogin.token as string;

    const ownMembers = await request<any[]>('/api/members', 200, { token: memberToken });
    assert.equal(ownMembers.length, 1);
    assert.equal(ownMembers[0].id, firstMember.id);
    assert.notEqual(ownMembers[0].idNumber, firstMember.idNumber);

    const ownVehicles = await request<any[]>('/api/vehicles', 200, { token: memberToken });
    assert.deepEqual(ownVehicles.map(vehicleItem => vehicleItem.id), [vehicle.id]);

    const ownTransactions = await request<any[]>('/api/transactions?memberId=' + secondMember.id, 200, { token: memberToken });
    assert.ok(ownTransactions.length > 0);
    assert.ok(ownTransactions.every(transaction => transaction.memberId === firstMember.id || transaction.vehiclePlate === vehicle.plateNumber));

    const ownPayments = await request<any[]>('/api/payments?memberId=' + secondMember.id, 200, { token: memberToken });
    assert.ok(ownPayments.every(payment => payment.memberId === firstMember.id || payment.vehiclePlate === vehicle.plateNumber));
    assert.ok(ownPayments.every(payment => payment.rawPayload === undefined));

    const portal = await request('/api/member-portal', 200, { token: memberToken });
    assert.equal(portal.member.id, firstMember.id);
    assert.equal(portal.transactions.some((transaction: any) => transaction.memberId === secondMember.id), false);

    const memberStatus = await request('/api/system/status', 200, { token: memberToken });
    assert.equal(memberStatus.totalMembersCount, 1);
    assert.equal(memberStatus.totalFleetCount, 1);

    await request('/api/users', 403, { token: memberToken });
    await request('/api/transactions', 403, {
      method: 'POST', token: memberToken,
      body: { description: 'Unauthorized', refCode: 'MEMBER-BLOCKED', type: 'Credit', category: 'Daily Contribution', amount: 1, tillNumber: 'VehicleTill' }
    });
    await request(`/api/vehicles/${vehicle.id}/driver`, 403, {
      method: 'PUT', token: memberToken,
      body: { driverName: 'Blocked Driver', driverPhone: '0712345678' }
    });
    await request('/api/coop-bank/events', 403, { token: memberToken });
  }
});
