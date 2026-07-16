import type { TransactionCategory, TillType } from '../types';

export const COOP_BANK_NAME = 'Co-operative Bank of Kenya';

export type CollectionTill = Exclude<TillType, 'None'>;

export type CollectionAccountConfig = {
  tillNumber: CollectionTill;
  accountNumber: string;
  displayName: string;
  shortName: string;
  defaultCategory: TransactionCategory;
  allocation: 'daily' | 'savings';
};

// VehicleTill and UtilityTill are retained as internal compatibility keys for
// existing ledger rows. All user-facing copy uses the real Co-op account role.
export const COOP_COLLECTION_ACCOUNTS: Record<CollectionTill, CollectionAccountConfig> = {
  VehicleTill: {
    tillNumber: 'VehicleTill',
    accountNumber: '48277',
    displayName: 'Operations / Daily Collection Account',
    shortName: 'Operations Account',
    defaultCategory: 'Daily Contribution',
    allocation: 'daily'
  },
  UtilityTill: {
    tillNumber: 'UtilityTill',
    accountNumber: '871671',
    displayName: 'Member Savings Account',
    shortName: 'Savings Account',
    defaultCategory: 'Savings Contribution',
    allocation: 'savings'
  }
};

export function getCollectionAccountByTill(tillNumber: CollectionTill): CollectionAccountConfig {
  return COOP_COLLECTION_ACCOUNTS[tillNumber];
}

export function findCollectionAccount(value: unknown): CollectionAccountConfig | null {
  const normalized = String(value || '').replace(/\D/g, '');
  return Object.values(COOP_COLLECTION_ACCOUNTS).find(account =>
    account.accountNumber === normalized
  ) || null;
}
