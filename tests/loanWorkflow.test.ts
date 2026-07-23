import test from 'node:test';
import assert from 'node:assert/strict';
import { calculateLoanTotal, canReviewLoanStage, nextApprovedStage, repaymentResult } from '../src/server/loanWorkflow';

test('enforces Secretary then Treasurer then Chairman without role bypass', () => {
  assert.equal(canReviewLoanStage('Secretary', 'SecretaryReview'), true);
  assert.equal(canReviewLoanStage('Chairman', 'SecretaryReview'), false);
  assert.equal(canReviewLoanStage('Treasurer', 'SecretaryReview'), false);
  assert.equal(nextApprovedStage('SecretaryReview'), 'TreasurerReview');
  assert.equal(nextApprovedStage('TreasurerReview'), 'ChairmanReview');
  assert.equal(nextApprovedStage('ChairmanReview'), 'Active');
});

test('calculates the Chairman-controlled rate and rejects manipulated rates', () => {
  assert.equal(calculateLoanTotal(100_000, 10), 110_000);
  assert.throws(() => calculateLoanTotal(100_000, -1));
  assert.throws(() => calculateLoanTotal(100_000, 101));
});

test('prevents overpayment and clears an exactly repaid loan', () => {
  assert.deepEqual(repaymentResult(110_000, 60_000, 50_000), { remaining: 0, cleared: true });
  assert.deepEqual(repaymentResult(110_000, 60_000, 10_000), { remaining: 40_000, cleared: false });
  assert.throws(() => repaymentResult(110_000, 60_000, 50_001));
  assert.throws(() => repaymentResult(110_000, 60_000, -1));
});
