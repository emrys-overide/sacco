import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {
  normalizeMpesaPhoneNumber,
  getDarajaTimestamp,
  generateDarajaPassword,
  parseCallbackMetadata,
  initiateStkPush
} from '../src/server/darajaMpesa';
import { processMemberChat } from '../src/server/conversationalCollections';

test('M-Pesa phone number normalization', () => {
  assert.equal(normalizeMpesaPhoneNumber('0712345678'), '254712345678');
  assert.equal(normalizeMpesaPhoneNumber('+254712345678'), '254712345678');
  assert.equal(normalizeMpesaPhoneNumber('254712345678'), '254712345678');
  assert.equal(normalizeMpesaPhoneNumber('0112345678'), '254112345678');
  assert.equal(normalizeMpesaPhoneNumber('712345678'), '254712345678');

  // Invalid formats must throw
  assert.throws(() => normalizeMpesaPhoneNumber('0201234567'), /Invalid Kenyan mobile number/);
  assert.throws(() => normalizeMpesaPhoneNumber('12345'), /Invalid Kenyan mobile number/);
});

test('Daraja timestamp and password generation', () => {
  const fixedDate = new Date('2026-06-15T10:30:00.000Z'); // 10:30 UTC = 13:30 EAT
  const timestamp = getDarajaTimestamp(fixedDate);
  assert.equal(timestamp, '20260615133000');

  const password = generateDarajaPassword('174379', 'bfb279f9aa9bdbcf158e97dd71a467cd2e0c893059b10f78e6b72ada1ed2c919', timestamp);
  assert.ok(password.length > 20);
  const decoded = Buffer.from(password, 'base64').toString('utf8');
  assert.ok(decoded.startsWith('174379'));
  assert.ok(decoded.endsWith('20260615133000'));
});

test('Daraja callback metadata parsing', () => {
  const metadata = {
    Item: [
      { Name: 'Amount', Value: 1500 },
      { Name: 'MpesaReceiptNumber', Value: 'QAA1234567' },
      { Name: 'TransactionDate', Value: 20260615133000 },
      { Name: 'PhoneNumber', Value: 254712345678 }
    ]
  };

  const parsed = parseCallbackMetadata(metadata);
  assert.equal(parsed.amount, 1500);
  assert.equal(parsed.mpesaReceiptNumber, 'QAA1234567');
  assert.equal(parsed.phoneNumber, '254712345678');
});

test('STK push initiation in test/sandbox environment', async () => {
  const result = await initiateStkPush({
    phoneNumber: '0712345678',
    amount: 2500,
    accountReference: 'MEM-001',
    transactionDesc: 'Savings Deposit'
  });

  assert.ok(result.checkoutRequestId);
  assert.ok(result.merchantRequestId);
  assert.equal(result.responseCode, '0');
});

test('Conversational collections intent detection and aggregation', async () => {
  const context = {
    memberId: 'mem-uuid-1',
    fullName: 'John Kamau',
    phoneNumber: '0712345678',
    membershipNumber: 'SOW-101',
    savingsBalance: 12000,
    loanBalance: 8500,
    activeLoans: [
      { id: 'LOAN-99', amount: 10000, remainingBalance: 8500 }
    ]
  };

  // Inquiry
  const step1 = await processMemberChat('Hello, I want to check my account', [], context);
  assert.ok(step1.reply.includes('John Kamau'));

  // Details
  const step2 = await processMemberChat('I want to deposit 2,000 shillings into my savings', [], context);
  assert.equal(step2.stage, 'AWAITING_CONFIRMATION');
  assert.ok(step2.proposal);
  assert.equal(step2.proposal?.amount, 2000);
  assert.equal(step2.proposal?.transactionType, 'SAVINGS');

  // Confirmation
  const history = [
    { role: 'user' as const, content: 'I want to deposit 2,000 shillings into my savings' },
    { role: 'model' as const, content: step2.reply }
  ];
  const step3 = await processMemberChat('Confirm', history, context);
  assert.equal(step3.stage, 'TRIGGER_STK');
  assert.ok(step3.reply.includes('PIN to complete the transaction'));
});

test('Member Account STK Payment Lifecycle: Savings Addition, Loan Deduction, and Callback Lag Flagging/Verification', async () => {
  delete process.env.DATABASE_URL;
  process.env.ALLOW_IN_MEMORY_DB = 'true';
  process.env.SEED_DEMO_DATA = 'true';
  process.env.SACCO_TEST_MODE = 'true';
  process.env.ALLOW_DEV_AUTH_FALLBACK = 'true';
  process.env.JWT_SECRET = 'test-mpesa-member-portal-secret-key-2026';

  const { createSaccoApp } = await import('../server');
  const app = await createSaccoApp({ serveFrontend: false, runBackgroundProcessor: false });
  const server = http.createServer(app);
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const addr = server.address();
  const port = typeof addr === 'object' && addr ? addr.port : 0;
  const baseUrl = `http://127.0.0.1:${port}`;

  try {
    // 1. Sign in as Demo Member Grace Wanjiku (0722112233)
    const loginRes = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ identifier: '0722112233', password: 'DemoPassword123!' })
    });
    assert.equal(loginRes.status, 200);
    const loginData = await loginRes.json();
    const token = loginData.token as string;
    assert.ok(token);

    // 2. Verify initial balances on Member Portal
    const initialPortalRes = await fetch(`${baseUrl}/api/member-portal`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    assert.equal(initialPortalRes.status, 200);
    const initialPortal = await initialPortalRes.json();
    assert.equal(initialPortal.member.savingsAmount, 45000);
    assert.equal(initialPortal.member.loanBalance, 15000);

    // 3. Member initiates KES 2,000 SAVINGS payment for Vehicle KDA 123A
    const stkSavingsRes = await fetch(`${baseUrl}/api/v1/mpesa/stk-push`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`
      },
      body: JSON.stringify({
        vehiclePlate: 'KDA 123A',
        transactionType: 'SAVINGS',
        amount: 2000,
        phoneNumber: '0722112233'
      })
    });
    assert.equal(stkSavingsRes.status, 200);
    const stkSavings = await stkSavingsRes.json();
    assert.equal(stkSavings.success, true);
    assert.ok(stkSavings.checkoutRequestId);

    // Simulate Safaricom callback for Savings payment
    const callbackSavingsRes = await fetch(`${baseUrl}/api/v1/mpesa/callback`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        Body: {
          stkCallback: {
            MerchantRequestID: stkSavings.merchantRequestId,
            CheckoutRequestID: stkSavings.checkoutRequestId,
            ResultCode: 0,
            ResultDesc: 'The service request is processed successfully.',
            CallbackMetadata: {
              Item: [
                { Name: 'Amount', Value: 2000 },
                { Name: 'MpesaReceiptNumber', Value: 'SAV2000REC' },
                { Name: 'PhoneNumber', Value: 254722112233 }
              ]
            }
          }
        }
      })
    });
    assert.equal(callbackSavingsRes.status, 200);
    await new Promise(resolve => setTimeout(resolve, 60));

    // Verify Savings balance increased from 45,000 to 47,000
    const afterSavingsRes = await fetch(`${baseUrl}/api/member-portal`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    const afterSavings = await afterSavingsRes.json();
    assert.equal(afterSavings.member.savingsAmount, 47000);
    assert.equal(afterSavings.transactions[0].refCode, 'SAV2000REC');
    assert.equal(afterSavings.transactions[0].vehiclePlate, 'KDA 123A');

    // 4. Member initiates KES 3,500 LOAN_REPAYMENT for Vehicle KDA 123A
    const stkLoanRes = await fetch(`${baseUrl}/api/v1/mpesa/stk-push`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`
      },
      body: JSON.stringify({
        vehiclePlate: 'KDA 123A',
        transactionType: 'LOAN_REPAYMENT',
        amount: 3500,
        phoneNumber: '0722112233'
      })
    });
    assert.equal(stkLoanRes.status, 200);
    const stkLoan = await stkLoanRes.json();

    // Simulate Safaricom callback for Loan Repayment
    await fetch(`${baseUrl}/api/v1/mpesa/callback`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        Body: {
          stkCallback: {
            MerchantRequestID: stkLoan.merchantRequestId,
            CheckoutRequestID: stkLoan.checkoutRequestId,
            ResultCode: 0,
            ResultDesc: 'The service request is processed successfully.',
            CallbackMetadata: {
              Item: [
                { Name: 'Amount', Value: 3500 },
                { Name: 'MpesaReceiptNumber', Value: 'LOAN3500REC' },
                { Name: 'PhoneNumber', Value: 254722112233 }
              ]
            }
          }
        }
      })
    });
    await new Promise(resolve => setTimeout(resolve, 60));

    // Verify Loan balance deducted from 15,000 to 11,500 (and savings remained 47,000)
    const afterLoanRes = await fetch(`${baseUrl}/api/member-portal`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    const afterLoan = await afterLoanRes.json();
    assert.equal(afterLoan.member.loanBalance, 11500);
    assert.equal(afterLoan.member.savingsAmount, 47000);
    assert.equal(afterLoan.loans[0].outstandingBalance, 11500);
    assert.equal(afterLoan.loans[0].amountPaid, 3500);

    // 5. Test Safaricom Callback Lag / Missing Notification -> Database Flag & Active Daraja Query
    const stkLagRes = await fetch(`${baseUrl}/api/v1/mpesa/stk-push`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`
      },
      body: JSON.stringify({
        vehiclePlate: 'KDA 123A',
        transactionType: 'LOAN_REPAYMENT',
        amount: 1500,
        phoneNumber: '0722112233',
        simulateLag: true
      })
    });
    assert.equal(stkLagRes.status, 200);
    const stkLag = await stkLagRes.json();

    // Verify transaction is PENDING before fallback query
    const pollPendingRes = await fetch(
      `${baseUrl}/api/v1/mpesa/transactions/${encodeURIComponent(stkLag.checkoutRequestId)}`,
      { headers: { Authorization: `Bearer ${token}` } }
    );
    const pollPending = await pollPendingRes.json();
    assert.equal(pollPending.transaction.status, 'PENDING');

    // Trigger active Database + Daraja Status Verification endpoint
    const verifyRes = await fetch(
      `${baseUrl}/api/v1/mpesa/transactions/${encodeURIComponent(stkLag.checkoutRequestId)}/verify`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({ reason: 'Safaricom callback delayed beyond threshold' })
      }
    );
    assert.equal(verifyRes.status, 200);
    const verifyData = await verifyRes.json();
    assert.equal(verifyData.verified, true);
    assert.equal(verifyData.flaggedDelayedCallback, true);
    assert.equal(verifyData.transaction.status, 'RESOLVED_RECONCILED');
    assert.equal(verifyData.transaction.metadata?.flaggedDelayedCallback, true);

    // Verify Loan balance deducted further from 11,500 to 10,000
    const finalPortalRes = await fetch(`${baseUrl}/api/member-portal`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    const finalPortal = await finalPortalRes.json();
    assert.equal(finalPortal.member.loanBalance, 10000);
    assert.equal(finalPortal.loans[0].outstandingBalance, 10000);
    assert.equal(finalPortal.loans[0].amountPaid, 5000);
  } finally {
    await new Promise<void>(resolve => server.close(() => resolve()));
  }
});
