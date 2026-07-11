import type { User, UserRole } from '../types';

export const STORAGE_KEYS = {
  currentUser: 'sacco_current_user',
  authToken: 'sacco_auth_token',
  installVersion: 'sacco_install_version',
  sidebarCollapsed: 'sacco_sidebar_collapsed',
  blueprintApproved: 'sacco_blueprint_approved',
  blueprintSigner: 'sacco_blueprint_signer',
  savedSheets: 'sowetamu_saved_sheets',
  legacyMembers: 'sacco_members_list',
  legacyVehicles: 'sacco_vehicles_list',
  legacyTransactions: 'sacco_transactions_list'
} as const;

const ROLE_SECURITY_KEYS: Partial<Record<UserRole, string>> = {
  Treasurer: 'treasurer@sacco',
  Secretary: 'secretary@sacco',
  Chairman: 'chairman@sacco',
  Auditor: 'auditor@sacco',
  Accountant: 'accountant@sacco'
};

export function getSaccoUserKey(role: UserRole): string {
  return ROLE_SECURITY_KEYS[role] ?? 'saccopass123';
}

export function buildSaccoAuthHeaders(user: User, token?: string): Record<string, string> {
  if (token) {
    return {
      Authorization: `Bearer ${token}`
    };
  }

  return {
    'X-Sacco-User-Email': user.email,
    'X-Sacco-User-Role': user.role,
    'X-Sacco-User-Key': getSaccoUserKey(user.role)
  };
}

export function canRole(user: User | null, allowedRoles: readonly UserRole[]): boolean {
  return Boolean(user && allowedRoles.includes(user.role));
}
