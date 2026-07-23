import type { TransactionCategory } from '../types';

export const EXPENSE_TRANSACTION_CATEGORIES: readonly TransactionCategory[] = [
  'Office Expenses',
  'Petty Cash',
  'Utilities',
  'Equipment'
];

export function isExpenseTransactionCategory(category: TransactionCategory): boolean {
  return EXPENSE_TRANSACTION_CATEGORIES.includes(category);
}

export function requiresRegisteredMember(category: TransactionCategory): boolean {
  return !isExpenseTransactionCategory(category);
}
