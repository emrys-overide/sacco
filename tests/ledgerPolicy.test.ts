import assert from 'node:assert/strict';
import test from 'node:test';
import type { Member, Transaction } from '../src/types';
import {
  LedgerPolicyError,
  getDailyContributionBalanceDelta,
  matchPaymentMember,
  normalizeTransactionInput
} from '../src/server/ledgerPolicy';

const member: Member = {
  id: 'member-1',
  name: 'Test Member',
  idNumber: '12345678',
  phoneNumber: '+254 712 345 678',
  status: 'Active',
  dateRegistered: '2026-01-01',
  vehicleAssigned: 'KCJ 402X',
  sharesAmount: 0,
  savingsAmount: 0,
  initialLoanAmount: 1000,
  loanBalance: 1000
};

test('normalizes a valid ledger entry without inventing optional savings data', () => {
  const transaction = normalizeTransactionInput({
    description: '  Daily collection  ',
    refCode: '  qabc123  ',
    amount: '1000',
    memberId: member.id
  });

  assert.equal(transaction.description, 'Daily collection');
  assert.equal(transaction.refCode, 'QABC123');
  assert.equal(transaction.amount, 1000);
  assert.equal(transaction.savingsContribution, undefined);
});

test('rejects invalid financial amounts with a stable API error code', () => {
  assert.throws(
    () => normalizeTransactionInput({ description: 'Invalid', refCode: 'BAD-1', amount: 0 }),
    (error: unknown) => error instanceof LedgerPolicyError && error.code === 'INVALID_AMOUNT'
  );
});

test('derives default member allocations and reverses their direction', () => {
  const credit = normalizeTransactionInput({
    description: 'Contribution',
    refCode: 'ALLOC-1',
    amount: 1000,
    memberId: member.id,
    type: 'Credit',
    category: 'Daily Contribution'
  });
  assert.deepEqual(getDailyContributionBalanceDelta(credit), { shares: 300, savings: 700, loan: 0 });

  const reversal: Transaction = { ...credit, type: 'Debit' };
  assert.deepEqual(getDailyContributionBalanceDelta(reversal), { shares: -300, savings: -700, loan: 0 });
});

test('uses explicit savings and loan repayment fields when supplied', () => {
  const transaction = normalizeTransactionInput({
    description: 'Daily sheet',
    refCode: 'ALLOC-2',
    amount: 900,
    memberId: member.id,
    savingsContribution: 250,
    loanRepay: 100
  });

  assert.deepEqual(getDailyContributionBalanceDelta(transaction), { shares: 0, savings: 250, loan: -100 });
});

test('matches payments by explicit assignment, plate, phone, then leaves them unmatched', () => {
  assert.equal(matchPaymentMember([member], '', '', member.id).matchMethod, 'Manual Assignment');
  assert.equal(matchPaymentMember([member], 'kcj402x', '').matchMethod, 'Vehicle Plate');
  assert.equal(matchPaymentMember([member], '', '0712345678').matchMethod, 'Phone Number');
  assert.equal(matchPaymentMember([member], 'UNKNOWN', '0700000000').matchMethod, 'None');
});
