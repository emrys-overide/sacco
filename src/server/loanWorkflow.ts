import type { UserRole } from '../types';

export type ReviewStage = 'SecretaryReview' | 'TreasurerReview' | 'ChairmanReview';

const STAGE_ROLE: Record<ReviewStage, UserRole> = {
  SecretaryReview: 'Secretary',
  TreasurerReview: 'Treasurer',
  ChairmanReview: 'Chairman'
};

export function canReviewLoanStage(role: UserRole, stage: ReviewStage): boolean {
  return STAGE_ROLE[stage] === role;
}

export function nextApprovedStage(stage: ReviewStage): 'TreasurerReview' | 'ChairmanReview' | 'Active' {
  if (stage === 'SecretaryReview') return 'TreasurerReview';
  if (stage === 'TreasurerReview') return 'ChairmanReview';
  return 'Active';
}

export function calculateLoanTotal(principal: number, interestRate: number): number {
  if (!Number.isFinite(principal) || principal <= 0) throw new Error('Principal must be positive.');
  if (!Number.isFinite(interestRate) || interestRate < 0 || interestRate > 100) throw new Error('Interest rate must be between 0 and 100.');
  return Math.round(principal * (1 + interestRate / 100) * 100) / 100;
}

export function repaymentResult(totalPayable: number, alreadyRepaid: number, amount: number) {
  const outstanding = Math.max(0, totalPayable - alreadyRepaid);
  if (!Number.isFinite(amount) || amount <= 0) throw new Error('Repayment must be positive.');
  if (amount > outstanding + 0.005) throw new Error('Repayment exceeds outstanding balance.');
  const remaining = Math.max(0, Math.round((outstanding - amount) * 100) / 100);
  return { remaining, cleared: remaining === 0 };
}
