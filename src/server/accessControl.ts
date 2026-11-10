import type { UserRole } from '../types';

/**
 * The server is the source of truth for SACCO permissions. Frontend checks
 * remain useful for navigation, but they are never authorization controls.
 */
export type SaccoPermission =
  | 'users.read'
  | 'users.write'
  | 'members.read.all'
  | 'members.write'
  | 'vehicles.read.all'
  | 'vehicles.write'
  | 'drivers.assign'
  | 'ledger.read.all'
  | 'ledger.write'
  | 'payments.read.all'
  | 'payments.reconcile'
  | 'reports.read.all'
  | 'reports.export'
  | 'system.read.all'
  | 'banking.manage'
  | 'member.portal.read'
  | 'loans.read.all'
  | 'loans.write'
  | 'loans.approve';

export type AccountStatus = 'PendingActivation' | 'Active' | 'Suspended' | 'Disabled' | 'Rejected' | 'Locked';

export interface AccessControlledUser {
  id: string;
  role: UserRole;
  isActive?: boolean;
  accountStatus?: AccountStatus;
  linkedMemberId?: string;
}

const ALL_ADMIN_PERMISSIONS: readonly SaccoPermission[] = [
  'users.read',
  'users.write',
  'members.read.all',
  'members.write',
  'vehicles.read.all',
  'vehicles.write',
  'drivers.assign',
  'ledger.read.all',
  'ledger.write',
  'payments.read.all',
  'payments.reconcile',
  'reports.read.all',
  'reports.export',
  'system.read.all',
  'banking.manage',
  'loans.read.all',
  'loans.write',
  'loans.approve'
];

export const ROLE_PERMISSION_MATRIX: Readonly<Record<UserRole, readonly SaccoPermission[]>> = {
  Chairman: ALL_ADMIN_PERMISSIONS,
  Secretary: [
    'users.read',
    'members.read.all',
    'members.write',
    'vehicles.read.all',
    'vehicles.write',
    'drivers.assign',
    'ledger.read.all',
    'ledger.write',
    'payments.read.all',
    'reports.read.all',
    'reports.export',
    'system.read.all',
    'loans.read.all',
    'loans.write'
  ],
  Treasurer: [
    'members.read.all',
    'vehicles.read.all',
    'ledger.read.all',
    'ledger.write',
    'payments.read.all',
    'payments.reconcile',
    'reports.read.all',
    'reports.export',
    'system.read.all',
    'banking.manage',
    'loans.read.all',
    'loans.write'
  ],
  Accountant: [
    'members.read.all',
    'vehicles.read.all',
    'ledger.read.all',
    'ledger.write',
    'payments.read.all',
    'payments.reconcile',
    'reports.read.all',
    'reports.export',
    'system.read.all',
    'loans.read.all',
    'loans.write'
  ],
  Auditor: [
    'users.read',
    'members.read.all',
    'vehicles.read.all',
    'ledger.read.all',
    'payments.read.all',
    'reports.read.all',
    'reports.export',
    'system.read.all',
    'loans.read.all'
  ],
  Member: ['member.portal.read']
};

export function hasPermission(role: UserRole, permission: SaccoPermission): boolean {
  return ROLE_PERMISSION_MATRIX[role].includes(permission);
}

export function isMemberUser(user: Pick<AccessControlledUser, 'role'>): boolean {
  return user.role === 'Member';
}

export function hasActiveAccount(user: Pick<AccessControlledUser, 'isActive' | 'accountStatus'>): boolean {
  return user.isActive !== false && (user.accountStatus === undefined || user.accountStatus === 'Active');
}

export function memberScopeId(user: AccessControlledUser): string | null {
  return isMemberUser(user) && user.linkedMemberId ? user.linkedMemberId : null;
}

export function memberOwnsId(user: AccessControlledUser, memberId: string | null | undefined): boolean {
  const scopedMemberId = memberScopeId(user);
  return Boolean(scopedMemberId && memberId && scopedMemberId === memberId);
}
