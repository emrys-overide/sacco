import assert from 'node:assert/strict';
import { spawn, type ChildProcess } from 'node:child_process';
import test from 'node:test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

type RequestOptions = {
  method?: string;
  token?: string;
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
  assert.ok(bootstrap.token);

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
  const token = login.token as string;
  await request('/api/members', 401);

  const firstMember = await request('/api/members', 201, {
    method: 'POST',
    token,
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
    token,
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
    token,
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
    token,
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
    token,
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
    token,
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
    token,
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

  const manualPayment = await request('/api/mpesa/log-payment', 200, {
    method: 'POST',
    token,
    body: {
      memberId: firstMember.id,
      accountReference: vehicle.plateNumber,
      payerPhone: firstMember.phoneNumber,
      amount: 1500,
      category: 'Daily Contribution',
      refCode: 'E2E-MPESA-1',
      tillNumber: 'VehicleTill'
    }
  });
  assert.equal(manualPayment.payment.status, 'Reconciled');
  assert.equal(manualPayment.payment.payerPhone, firstMember.phoneNumber);
  assert.equal(manualPayment.payment.vehiclePlate, vehicle.plateNumber);
  assert.equal(manualPayment.payment.destinationAccount, '48277');

  const savingsPayment = await request('/api/mpesa/log-payment', 200, {
    method: 'POST',
    token,
    body: {
      memberId: firstMember.id,
      accountReference: '',
      payerPhone: firstMember.phoneNumber,
      amount: 400,
      category: 'Savings Contribution',
      refCode: 'E2E-COOP-SAVINGS-1',
      tillNumber: 'UtilityTill'
    }
  });
  assert.equal(savingsPayment.payment.status, 'Reconciled');
  assert.equal(savingsPayment.payment.destinationAccount, '871671');

  await request('/api/mpesa/log-payment', 400, {
    method: 'POST',
    token,
    body: {
      memberId: firstMember.id,
      payerPhone: firstMember.phoneNumber,
      amount: 100,
      category: 'Daily Contribution',
      refCode: 'E2E-COOP-WRONG-ROUTE',
      tillNumber: 'UtilityTill'
    }
  });

  await request('/api/mpesa/log-payment', 400, {
    method: 'POST',
    token,
    body: {
      memberId: firstMember.id,
      accountReference: 'KDB 999Z',
      payerPhone: firstMember.phoneNumber,
      amount: 500,
      category: 'Daily Contribution',
      refCode: 'E2E-MPESA-BAD-PLATE',
      tillNumber: 'VehicleTill'
    }
  });
  const beforeDuplicate = await request<any[]>('/api/transactions', 200, { token });
  const duplicatePayment = await request('/api/mpesa/log-payment', 200, {
    method: 'POST',
    token,
    body: {
      memberId: firstMember.id,
      accountReference: vehicle.plateNumber,
      payerPhone: firstMember.phoneNumber,
      amount: 1500,
      category: 'Daily Contribution',
      refCode: 'E2E-MPESA-1',
      tillNumber: 'VehicleTill'
    }
  });
  assert.equal(duplicatePayment.payment.status, 'Duplicate');
  const afterDuplicate = await request<any[]>('/api/transactions', 200, { token });
  assert.equal(afterDuplicate.length, beforeDuplicate.length);

  const validation = await request('/api/daraja/c2b-validation', 200, {
    method: 'POST',
    body: { TransAmount: 750 }
  });
  assert.equal(validation.ResultCode, 0);
  const invalidValidation = await request('/api/daraja/c2b-validation', 200, {
    method: 'POST',
    body: { TransAmount: 0 }
  });
  assert.equal(invalidValidation.ResultCode, 'C2B00013');

  await request('/api/daraja/c2b-confirmation', 200, {
    method: 'POST',
    body: {
      TransID: 'E2E-WEBHOOK-1',
      TransAmount: 750,
      BusinessShortCode: '600000',
      BillRefNumber: 'UNKNOWN-E2E',
      MSISDN: '254700000099',
      FirstName: 'Webhook',
      LastName: 'Payer'
    }
  });
  const payments = await request<any[]>('/api/payments', 200, { token });
  const unmatched = payments.find(payment => payment.refCode === 'E2E-WEBHOOK-1');
  assert.equal(unmatched.status, 'Unmatched');
  const reconciled = await request(`/api/payments/${unmatched.id}/reconcile`, 200, {
    method: 'POST',
    token,
    body: { memberId: secondMember.id }
  });
  assert.equal(reconciled.status, 'Reconciled');
  assert.equal(reconciled.memberId, secondMember.id);
  const beforeWebhookDuplicate = await request<any[]>('/api/transactions', 200, { token });
  await request('/api/daraja/c2b-confirmation', 200, {
    method: 'POST',
    body: {
      TransID: 'E2E-WEBHOOK-1',
      TransAmount: 750,
      BusinessShortCode: '600000',
      BillRefNumber: 'UNKNOWN-E2E',
      MSISDN: '254700000099'
    }
  });
  const afterWebhookDuplicate = await request<any[]>('/api/transactions', 200, { token });
  assert.equal(afterWebhookDuplicate.length, beforeWebhookDuplicate.length);

  await request('/api/mpesa/register-url', 400, {
    method: 'POST',
    token,
    body: {
      shortcode: '600000',
      mode: 'sandbox',
      confirmationUrl: 'http://localhost:3000/api/daraja/c2b-confirmation',
      validationUrl: 'http://localhost:3000/api/daraja/c2b-validation'
    }
  });

  const finalMembers = await request<any[]>('/api/members', 200, { token });
  const memberOne = finalMembers.find(member => member.id === firstMember.id);
  const memberTwo = finalMembers.find(member => member.id === secondMember.id);
  assert.deepEqual(
    { shares: memberOne.sharesAmount, savings: memberOne.savingsAmount },
    { shares: 450, savings: 1450 }
  );
  assert.deepEqual(
    { shares: memberTwo.sharesAmount, savings: memberTwo.savingsAmount },
    { shares: 225, savings: 525 }
  );

  const status = await request('/api/system/status', 200, { token });
  assert.equal(status.totalTransactionsCount, databaseUrl ? 8 : 6);
  assert.equal(status.totalMembersCount, 2);
  assert.equal(status.totalFleetCount, 1);
  assert.equal(status.netCashFlow, 2450);
  assert.equal(status.totalCapitalReserve, 675);
  assert.equal(status.totalMemberSavings, 1975);
});
