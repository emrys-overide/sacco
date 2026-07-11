import type { User, UserRole } from '../types';

export const STORAGE_KEYS = {
  installVersion: 'sacco_install_version',
  sidebarCollapsed: 'sacco_sidebar_collapsed',
  blueprintApproved: 'sacco_blueprint_approved',
  blueprintSigner: 'sacco_blueprint_signer',
  savedSheets: 'sowetamu_saved_sheets',
  legacyMembers: 'sacco_members_list',
  legacyVehicles: 'sacco_vehicles_list',
  legacyTransactions: 'sacco_transactions_list'
} as const;

export function buildSaccoAuthHeaders(token: string): Record<string, string> {
  return {
    Authorization: `Bearer ${token}`
  };
}

export function canRole(user: User | null, allowedRoles: readonly UserRole[]): boolean {
  return Boolean(user && allowedRoles.includes(user.role));
}
