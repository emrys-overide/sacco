import assert from 'node:assert/strict';
import test from 'node:test';
import {
  hasActiveAccount,
  hasPermission,
  memberOwnsId,
  memberScopeId,
  ROLE_PERMISSION_MATRIX
} from '../src/server/accessControl';

test('permission matrix keeps each administrative role within its approved scope', () => {
  assert.equal(hasPermission('Chairman', 'ledger.write'), true);
  assert.equal(hasPermission('Chairman', 'users.write'), true);
  assert.equal(hasPermission('Secretary', 'users.write'), false);
  assert.equal(hasPermission('Treasurer', 'payments.reconcile'), true);
  assert.equal(hasPermission('Secretary', 'members.write'), true);
  assert.equal(hasPermission('Secretary', 'ledger.write'), true);
  assert.equal(hasPermission('Secretary', 'payments.reconcile'), false);
  assert.equal(hasPermission('Secretary', 'users.write'), false);
  assert.equal(hasPermission('Secretary', 'loans.approve'), false);
  assert.equal(hasPermission('Auditor', 'reports.read.all'), true);
  assert.equal(hasPermission('Auditor', 'ledger.write'), false);
  assert.equal(hasPermission('Member', 'member.portal.read'), true);
  assert.equal(hasPermission('Member', 'reports.read.all'), false);
  assert.deepEqual(ROLE_PERMISSION_MATRIX.Member, ['member.portal.read']);
});

test('member ownership is derived from the trusted profile link, not a requested ID', () => {
  const member = {
    id: 'user-a',
    role: 'Member' as const,
    linkedMemberId: 'member-a',
    accountStatus: 'Active' as const
  };
  assert.equal(memberScopeId(member), 'member-a');
  assert.equal(memberOwnsId(member, 'member-a'), true);
  assert.equal(memberOwnsId(member, 'member-b'), false);
  assert.equal(memberOwnsId({ ...member, linkedMemberId: undefined }, 'member-a'), false);
});

test('suspended, disabled, rejected, and locked profiles fail the active-account gate', () => {
  assert.equal(hasActiveAccount({ accountStatus: 'Active', isActive: true }), true);
  for (const accountStatus of ['PendingActivation', 'Suspended', 'Disabled', 'Rejected', 'Locked'] as const) {
    assert.equal(hasActiveAccount({ accountStatus, isActive: true }), false);
  }
  assert.equal(hasActiveAccount({ accountStatus: 'Active', isActive: false }), false);
});
