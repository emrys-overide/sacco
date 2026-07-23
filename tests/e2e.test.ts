import assert from 'node:assert/strict';
import { spawn, type ChildProcess } from 'node:child_process';
import test from 'node:test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

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

async function waitForLiveNotification(reader: ReadableStreamDefaultReader<Uint8Array>, timeoutMs = 5_000): Promise<any> {
  const decoder = new TextDecoder();
  let buffered = '';
  let timeout: ReturnType<typeof setTimeout> | undefined;
  const expires = new Promise<never>((_, reject) => {
    timeout = setTimeout(() => reject(new Error('Timed out waiting for a live notification.')), timeoutMs);
  });
  try {
    while (true) {
      const next = await Promise.race([reader.read(), expires]);
      if (next.done) throw new Error('The live notification stream closed before an event arrived.');
      buffered += decoder.decode(next.value, { stream: true });
      const events = buffered.split('\n\n');
      buffered = events.pop() || '';
      for (const eventText of events) {
        const event = eventText.match(/^event:\s*(.+)$/m)?.[1];
        const data = eventText.match(/^data:\s*(.+)$/m)?.[1];
        if (event !== 'notification' || !data) continue;
        return JSON.parse(data);
      }
    }
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

test('runs the clean-install SACCO workflow end to end', { timeout: 45_000 }, async t => {
  const databaseUrl = process.env.E2E_DATABASE_URL || '';
  const port = 4400 + (process.pid % 500);
  const baseUrl = `http://127.0.0.1:${port}`;
  let logs = '';
  const server = spawn(process.execPath, ['--import', 'tsx', 'start.ts'], {
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
      APP_URL: baseUrl,
      NODE_ENV: 'development',
      ALLOW_IN_MEMORY_DB: 'true',
      ALLOW_DEV_AUTH_FALLBACK: 'true',
      ALLOW_DEV_JWT_AUTH: 'true',
      JWT_SECRET: 'isolated-e2e-secret',
      TOTP_ENCRYPTION_KEY: 'MDEyMzQ1Njc4OWFiY2RlZjAxMjM0NTY3ODlhYmNkZWY=',
      OFFICER_TOTP_REQUIRED: 'false',
      COOP_IPN_ENABLED: 'true',
      COOP_IPN_AUTH_MODE: 'TOKEN',
      COOP_IPN_TOKEN: 'isolated-coop-bank-token',
      COOP_IPN_TOKEN_HEADER: 'x-coop-bank-token',
      COOP_IPN_TOKEN_SCHEME: 'Token',
      COOP_ALLOWED_ACCOUNT_NUMBERS: '01134248358600',
      COOP_OBSERVE_ONLY: 'true',
      COOP_AUTO_POSTING_ENABLED: 'false',
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
  const robots = await fetch(`${baseUrl}/robots.txt`);
  assert.equal(robots.status, 200);
  assert.match(await robots.text(), new RegExp(`Sitemap: ${baseUrl.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}/sitemap\\.xml`));
  const sitemap = await fetch(`${baseUrl}/sitemap.xml`);
  assert.equal(sitemap.status, 200);
  assert.match(await sitemap.text(), /<loc>http:\/\/127\.0\.0\.1:\d+\/about<\/loc>/);
  const about = await fetch(`${baseUrl}/about`);
  assert.equal(about.status, 200);
  assert.match(await about.text(), /<h1>Secure management for SACCO members, vehicles, collections, and reporting\.<\/h1>/);
  const documentation = await fetch(`${baseUrl}/documentation`);
  assert.equal(documentation.status, 200);
  assert.equal(documentation.headers.get('x-robots-tag'), 'noindex, nofollow');
  const documentationText = await documentation.text();
  assert.match(documentationText, /Technical Department/);
  assert.match(documentationText, /emryspaul7@gmail\.com/);
  const healthResponse = await fetch(`${baseUrl}/api/health`);
  assert.equal(healthResponse.headers.get('x-robots-tag'), 'noindex, nofollow');
  assert.equal(healthResponse.headers.get('cache-control'), 'no-store');
  const onboardingBeforeBootstrap = await request<{ needsFirstAdmin: boolean }>('/api/auth/onboarding-status', 200);
  assert.equal(onboardingBeforeBootstrap.needsFirstAdmin, true);
  // The retired third-party recovery surface must not be registered.
  await request('/api/auth/officer-recovery', 404, {
    method: 'POST',
    body: { password: 'not-a-recovery' }
  });

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
  const onboardingAfterBootstrap = await request<{ needsFirstAdmin: boolean }>('/api/auth/onboarding-status', 200);
  assert.equal(onboardingAfterBootstrap.needsFirstAdmin, false);
  const token = bootstrap.token as string;
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
  assert.ok(login.token);
  const loginToken = login.token as string;
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
  assert.equal(treasurerLogin.user.role, 'Treasurer');
  assert.ok(treasurerLogin.token);
  const secretary = await request('/api/users', 201, {
    method: 'POST',
    token,
    body: {
      fullName: 'E Two E Secretary',
      email: 'secretary.e2e@example.com',
      phone: '0700000002',
      role: 'Secretary',
      password: 'secretary-password'
    }
  });
  assert.equal(secretary.user.role, 'Secretary');
  const secretaryLogin = await request('/api/auth/login', 200, {
    method: 'POST',
    body: { identifier: 'secretary.e2e@example.com', password: 'secretary-password' }
  });
  await request('/api/password-reset-requests', 403, { token: secretaryLogin.token });
  await request('/api/users/not-a-real-user/password', 403, {
    method: 'POST', token: secretaryLogin.token, body: { password: 'another-temporary-password' }
  });
  await request('/api/members', 401);
  await request('/api/member-activation/request', 200, {
    method: 'POST',
    body: { phone: '0711111111' }
  });

  await request('/api/members', 400, {
    method: 'POST',
    token: loginToken,
    body: {
      id: 'member-e2e-missing-email',
      name: 'No Email Member',
      idNumber: '99990000',
      phoneNumber: '0799999999',
      status: 'Active'
    }
  });

  const firstMember = await request('/api/members', 201, {
    method: 'POST',
    token: loginToken,
    body: {
      id: 'member-e2e-one',
      name: 'Alice Kamau',
      idNumber: '11112222',
      email: 'alice.member@example.com',
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
      email: 'brian.member@example.com',
      phoneNumber: '0722222222',
      status: 'Active'
    }
  });
  const removableMember = await request('/api/members', 201, {
    method: 'POST',
    token: loginToken,
    body: {
      id: 'member-e2e-removable',
      name: 'Removable Member',
      idNumber: '55556666',
      email: 'removable.member@example.com',
      phoneNumber: '0733333333',
      status: 'Active'
    }
  });
  let removableMemberToken = '';
  if (!databaseUrl) {
    await request('/api/auth/member-registration', 201, {
      method: 'POST',
      body: {
        fullName: removableMember.name,
        phone: removableMember.phoneNumber,
        email: removableMember.email,
        password: 'removable-member-password'
      }
    });
    const removableLogin = await request('/api/auth/login', 200, {
      method: 'POST',
      body: { identifier: removableMember.email, password: 'removable-member-password' }
    });
    removableMemberToken = removableLogin.token as string;
  }
  await request(`/api/members/${removableMember.id}`, 403, {
    method: 'DELETE',
    token: secretaryLogin.token
  });
  const deletedMember = await request(`/api/members/${removableMember.id}`, 200, {
    method: 'DELETE',
    token: loginToken
  });
  assert.equal(deletedMember.deleted, true);
  const membersAfterDeletion = await request<any[]>('/api/members', 200, { token: loginToken });
  assert.equal(membersAfterDeletion.some(member => member.id === removableMember.id), false);
  if (removableMemberToken) {
    await request('/api/member-portal', 401, { token: removableMemberToken });
    await request('/api/auth/login', 401, {
      method: 'POST',
      body: { identifier: removableMember.email, password: 'removable-member-password' }
    });
  }
  await request('/api/members', 409, {
    method: 'POST',
    token: loginToken,
    body: {
      id: 'member-e2e-duplicate',
      name: 'Duplicate Member',
      idNumber: '11112222',
      email: 'duplicate.member@example.com',
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

  // The Secretary owns day-to-day record entry and correction, while the
  // higher-risk Chairman controls remain unavailable to that role.
  const secretaryDaily = await request('/api/transactions', 201, {
    method: 'POST',
    token: secretaryLogin.token,
    body: {
      memberId: firstMember.id,
      memberName: firstMember.name,
      vehiclePlate: vehicle.plateNumber,
      description: 'Secretary daily collection access check',
      refCode: 'E2E-SECRETARY-DAILY-1',
      type: 'Credit',
      category: 'Daily Contribution',
      amount: 100,
      tillNumber: 'VehicleTill'
    }
  });
  const secretaryCorrection = await request(`/api/transactions/${secretaryDaily.id}`, 200, {
    method: 'PUT',
    token: secretaryLogin.token,
    body: { amount: 120, description: 'Secretary corrected daily collection' }
  });
  await request(`/api/transactions/${secretaryCorrection.id}/reverse`, 201, {
    method: 'POST',
    token: secretaryLogin.token
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
  await request(`/api/members/${firstMember.id}`, 409, {
    method: 'DELETE',
    token: loginToken
  });

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
    PaymentRef: 'KDA 123A',
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
  const received = await request('/api/integrations/coop/ipn', 200, {
    method: 'POST',
    headers: { 'x-coop-bank-token': 'Token isolated-coop-bank-token' },
    body: bankPayload
  });
  assert.equal(received.MessageCode, '2XX');
  const duplicate = await request('/api/webhooks/coop-bank/b2b-ipn', 200, {
    method: 'POST',
    headers: { 'x-coop-bank-token': 'Token isolated-coop-bank-token' },
    body: bankPayload
  });
  assert.equal(duplicate.MessageCode, '2XX');
  await request('/api/webhooks/coop-bank/b2b-ipn', 403, {
    method: 'POST',
    headers: { 'x-coop-bank-token': 'Token isolated-coop-bank-token' },
    body: { ...bankPayload, TransactionId: 'E2E-BANK-UNKNOWN', AcctNo: '01134248358699' }
  });
  const bankEvents = await request<any[]>('/api/coop-bank/events', 200, { token });
  assert.equal(bankEvents.length, 1);
  assert.equal(bankEvents[0].transactionId, 'E2E-BANK-001');
  assert.equal(bankEvents[0].reconciliationStatus, 'PENDING_ALLOCATION');
  assert.equal(bankEvents[0].accountNumber.endsWith('8600'), true);
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
    const registration = await request('/api/auth/member-registration', 201, {
      method: 'POST',
      body: {
        fullName: firstMember.name,
        phone: firstMember.phoneNumber,
        email: 'alice.member@example.com',
        password: 'member-password'
      }
    });
    assert.equal(registration.accountCreated, true);
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

    // Password reset requests are private, Chairman-confirmed, and delivered
    // live to a connected Chairman before the normal durable bell refresh.
    const streamController = new AbortController();
    const stream = await fetch(`${baseUrl}/api/notifications/stream`, {
      headers: { Authorization: `Bearer ${loginToken}` },
      signal: streamController.signal
    });
    assert.equal(stream.status, 200);
    assert.equal(stream.headers.get('content-type')?.startsWith('text/event-stream'), true);
    assert.ok(stream.body);
    const streamReader = stream.body.getReader();
    const liveNotification = waitForLiveNotification(streamReader);
    const resetRequest = await request<{ message: string }>('/api/auth/password-reset-request', 200, {
      method: 'POST',
      body: { identifier: firstMember.phoneNumber }
    });
    const unknownResetRequest = await request<{ message: string }>('/api/auth/password-reset-request', 200, {
      method: 'POST',
      body: { identifier: '0799999999' }
    });
    assert.equal(resetRequest.message, unknownResetRequest.message);
    assert.match(resetRequest.message, /Contact them directly to confirm your identity\./);
    const delivered = await liveNotification;
    assert.equal(delivered.category, 'PASSWORD_RESET_REQUEST');
    assert.match(delivered.message, /contact the SACCO Administrator/i);
    streamController.abort();
    await streamReader.cancel().catch(() => undefined);

    const chairmanNotifications = await request<{ items: Array<{ category: string }>; unreadCount: number }>('/api/notifications', 200, { token: loginToken });
    assert.ok(chairmanNotifications.items.some(notification => notification.category === 'PASSWORD_RESET_REQUEST'));
    assert.ok(chairmanNotifications.unreadCount >= 1);
    const resetRequests = await request<Array<{ id: string; user_id: string }>>('/api/password-reset-requests', 200, { token: loginToken });
    const pendingReset = resetRequests.find(reset => reset.user_id === memberLogin.user.id);
    assert.ok(pendingReset);

    await request(`/api/users/${memberLogin.user.id}/password`, 200, {
      method: 'POST', token: loginToken,
      body: { password: 'member-temporary-password', resetRequestId: pendingReset.id }
    });
    const temporaryLogin = await request('/api/auth/login', 200, {
      method: 'POST',
      body: { identifier: firstMember.phoneNumber, password: 'member-temporary-password' }
    });
    assert.equal(temporaryLogin.passwordChangeRequired, true);
    await request('/api/notifications', 403, { token: temporaryLogin.token });
    const completedChange = await request('/api/auth/change-temporary-password', 200, {
      method: 'POST', token: temporaryLogin.token,
      body: { password: 'member-private-password' }
    });
    assert.equal(completedChange.passwordUpdated, true);
    const updatedMemberLogin = await request('/api/auth/login', 200, {
      method: 'POST',
      body: { identifier: firstMember.phoneNumber, password: 'member-private-password' }
    });
    assert.equal(updatedMemberLogin.passwordChangeRequired, false);
    await request('/api/member-portal', 200, { token: updatedMemberLogin.token });

    // A locked-out Chairman has a separate break-glass path. The public
    // request is privacy-safe, reaches only the Secretary, and does not give
    // the Secretary general account-reset authority.
    const secretaryStreamController = new AbortController();
    const secretaryStream = await fetch(`${baseUrl}/api/notifications/stream`, {
      headers: { Authorization: `Bearer ${secretaryLogin.token}` },
      signal: secretaryStreamController.signal
    });
    assert.equal(secretaryStream.status, 200);
    assert.ok(secretaryStream.body);
    const secretaryStreamReader = secretaryStream.body.getReader();
    const secretaryRecoveryNotification = waitForLiveNotification(secretaryStreamReader);
    const recoveryRequest = await request<{ message: string }>('/api/auth/chairman-recovery-request', 200, {
      method: 'POST',
      body: { identifier: 'chairman.e2e@example.com' }
    });
    const unknownRecoveryRequest = await request<{ message: string }>('/api/auth/chairman-recovery-request', 200, {
      method: 'POST',
      body: { identifier: 'not-chairman@example.com' }
    });
    assert.equal(recoveryRequest.message, unknownRecoveryRequest.message);
    assert.match(recoveryRequest.message, /Secretary will receive the recovery request/i);
    const secretaryDelivered = await secretaryRecoveryNotification;
    assert.equal(secretaryDelivered.category, 'CHAIRMAN_RECOVERY_REQUEST');
    assert.equal(secretaryDelivered.destination, 'Chairman Recovery');
    secretaryStreamController.abort();
    await secretaryStreamReader.cancel().catch(() => undefined);

    await request('/api/chairman-recovery-requests', 403, { token: loginToken });
    await request('/api/chairman-recovery-requests', 403, { token: updatedMemberLogin.token });
    const recoveryRequests = await request<Array<{ id: string; user_id: string }>>('/api/chairman-recovery-requests', 200, { token: secretaryLogin.token });
    const pendingChairmanRecovery = recoveryRequests.find(recovery => recovery.user_id === bootstrap.user.id);
    assert.ok(pendingChairmanRecovery);
    await request(`/api/chairman-recovery-requests/${pendingChairmanRecovery.id}/approve`, 403, {
      method: 'POST', token: loginToken, body: { password: 'chairman-recovery-password' }
    });
    await request(`/api/chairman-recovery-requests/${pendingChairmanRecovery.id}/approve`, 200, {
      method: 'POST', token: secretaryLogin.token, body: { password: 'chairman-recovery-password' }
    });
    const chairmanRecoveryLogin = await request('/api/auth/login', 200, {
      method: 'POST', body: { identifier: 'chairman.e2e@example.com', password: 'chairman-recovery-password' }
    });
    assert.equal(chairmanRecoveryLogin.passwordChangeRequired, true);
    await request('/api/members', 403, { token: chairmanRecoveryLogin.token });
    const chairmanChangedPassword = await request('/api/auth/change-temporary-password', 200, {
      method: 'POST', token: chairmanRecoveryLogin.token, body: { password: 'chairman-new-private-password' }
    });
    assert.equal(chairmanChangedPassword.passwordUpdated, true);
    const restoredChairmanLogin = await request('/api/auth/login', 200, {
      method: 'POST', body: { identifier: 'chairman.e2e@example.com', password: 'chairman-new-private-password' }
    });
    assert.equal(restoredChairmanLogin.passwordChangeRequired, false);

    // Only the Chairman can permanently remove another officer account.
    await request(`/api/users/${secretary.user.id}`, 403, {
      method: 'DELETE', token: secretaryLogin.token
    });
    await request(`/api/users/${bootstrap.user.id}`, 409, {
      method: 'DELETE', token: restoredChairmanLogin.token
    });
    const deletedSecretary = await request(`/api/users/${secretary.user.id}`, 200, {
      method: 'DELETE', token: restoredChairmanLogin.token
    });
    assert.equal(deletedSecretary.deleted, true);
    assert.equal(deletedSecretary.role, 'Secretary');
    await request('/api/users', 401, { token: secretaryLogin.token });
    await request('/api/auth/login', 401, {
      method: 'POST',
      body: { identifier: 'secretary.e2e@example.com', password: 'secretary-password' }
    });
  }
});
