import type {
  Member,
  PaymentMatchMethod,
  Transaction,
  TransactionCategory,
  TransactionType,
  TillType
} from '../types';

const TRANSACTION_TYPES: readonly TransactionType[] = ['Credit', 'Debit'];
const TRANSACTION_CATEGORIES: readonly TransactionCategory[] = [
  'Daily Contribution',
  'Registration Fee',
  'Management Fee',
  'Office Expenses',
  'Petty Cash',
  'Penalty',
  'Utilities',
  'Equipment'
];
const TILL_TYPES: readonly TillType[] = ['VehicleTill', 'UtilityTill', 'None'];
const SHARES_ALLOCATION_RATE = 0.3;
const SAVINGS_ALLOCATION_RATE = 0.7;

export type LedgerInput = Omit<Partial<Transaction>, 'amount'> & {
  description?: string;
  refCode?: string;
  amount?: number | string;
};

export class LedgerPolicyError extends Error {
  constructor(public status: number, message: string, public code: string) {
    super(message);
    this.name = 'LedgerPolicyError';
  }
}

export function normalizeRefCode(refCode: unknown): string {
  return String(refCode || '').trim().toUpperCase();
}

function normalizeNonNegativeAmount(value: unknown, fieldName: string): number {
  const amount = Number(value ?? 0);
  if (!Number.isFinite(amount) || amount < 0) {
    throw new LedgerPolicyError(400, `${fieldName} must contain a valid non-negative number.`, 'INVALID_NUMERIC_FIELD');
  }
  return amount;
}

export function normalizeTransactionInput(input: LedgerInput): Transaction {
  const description = String(input.description || '').trim();
  const refCode = normalizeRefCode(input.refCode);
  const amount = Number(input.amount);
  const type = (input.type || 'Credit') as TransactionType;
  const category = (input.category || 'Daily Contribution') as TransactionCategory;
  const tillNumber = (input.tillNumber || 'UtilityTill') as TillType;

  if (!description) throw new LedgerPolicyError(400, 'Transaction description is required.', 'MISSING_DESCRIPTION');
  if (!refCode) throw new LedgerPolicyError(400, 'Transaction reference code is required.', 'MISSING_REF_CODE');
  if (!Number.isFinite(amount) || amount <= 0) throw new LedgerPolicyError(400, 'Transaction amount must be greater than zero.', 'INVALID_AMOUNT');
  if (!TRANSACTION_TYPES.includes(type)) throw new LedgerPolicyError(400, 'Transaction type must be Credit or Debit.', 'INVALID_TRANSACTION_TYPE');
  if (!TRANSACTION_CATEGORIES.includes(category)) throw new LedgerPolicyError(400, `Unsupported transaction category: ${category}`, 'INVALID_TRANSACTION_CATEGORY');
  if (!TILL_TYPES.includes(tillNumber)) throw new LedgerPolicyError(400, `Unsupported till number: ${tillNumber}`, 'INVALID_TILL');

  return {
    id: input.id || 't-' + Date.now(),
    timestamp: input.timestamp || new Date().toISOString(),
    memberId: input.memberId || '',
    memberName: input.memberName || '',
    vehiclePlate: input.vehiclePlate || '',
    description,
    refCode,
    type,
    category,
    amount,
    recorderName: input.recorderName || 'SACCO Ledger OS',
    tillNumber,
    vehicleClass: input.vehicleClass,
    operationAmount: normalizeNonNegativeAmount(input.operationAmount, 'Operation amount'),
    entranceFee: normalizeNonNegativeAmount(input.entranceFee, 'Entrance fee'),
    loanRepay: normalizeNonNegativeAmount(input.loanRepay, 'Loan repayment'),
    savingsContribution: input.savingsContribution === undefined ? undefined : normalizeNonNegativeAmount(input.savingsContribution, 'Savings contribution'),
    sTicket: normalizeNonNegativeAmount(input.sTicket, 'S/Ticket'),
    legalFee: normalizeNonNegativeAmount(input.legalFee, 'Legal fee'),
    expenseDeduction: normalizeNonNegativeAmount(input.expenseDeduction, 'Expense deduction'),
    grossAmount: input.grossAmount === undefined ? amount : normalizeNonNegativeAmount(input.grossAmount, 'Gross amount'),
    reversalOf: input.reversalOf,
    reversedAt: input.reversedAt,
    reversedBy: input.reversedBy
  };
}

export function getDailyContributionBalanceDelta(tx: Transaction): { shares: number; savings: number; loan: number } {
  if (!tx.memberId || tx.category !== 'Daily Contribution') return { shares: 0, savings: 0, loan: 0 };

  const direction = tx.type === 'Credit' ? 1 : -1;
  const loanRepay = Number(tx.loanRepay || 0);
  if (tx.savingsContribution !== undefined) {
    return {
      shares: 0,
      savings: direction * Number(tx.savingsContribution || 0),
      loan: loanRepay ? -direction * loanRepay : 0
    };
  }
  return {
    shares: direction * Math.round(tx.amount * SHARES_ALLOCATION_RATE),
    savings: direction * Math.round(tx.amount * SAVINGS_ALLOCATION_RATE),
    loan: loanRepay ? -direction * loanRepay : 0
  };
}

function getLast9Digits(value: unknown): string {
  return String(value || '').replace(/\D/g, '').slice(-9);
}

export function matchPaymentMember(
  members: Member[],
  accountReference: string,
  payerPhone: string,
  preferredMemberId?: string
): { member: Member | null; matchMethod: PaymentMatchMethod } {
  if (preferredMemberId) {
    const member = members.find(item => item.id === preferredMemberId);
    if (member) return { member, matchMethod: 'Manual Assignment' };
  }

  const normalizedRef = accountReference.trim().toUpperCase().replace(/\s+/g, '');
  if (normalizedRef) {
    const byId = members.find(member => member.id.trim().toUpperCase() === normalizedRef);
    if (byId) return { member: byId, matchMethod: 'Member ID' };

    const byPlate = members.find(member => {
      const plate = (member.vehicleAssigned || '').trim().toUpperCase().replace(/\s+/g, '');
      return Boolean(plate && plate === normalizedRef);
    });
    if (byPlate) return { member: byPlate, matchMethod: 'Vehicle Plate' };
  }

  const payerLast9 = getLast9Digits(payerPhone);
  if (payerLast9.length === 9) {
    const byPhone = members.find(member => getLast9Digits(member.phoneNumber) === payerLast9);
    if (byPhone) return { member: byPhone, matchMethod: 'Phone Number' };
  }

  return { member: null, matchMethod: 'None' };
}
