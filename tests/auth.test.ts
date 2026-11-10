import assert from 'node:assert/strict';
import test from 'node:test';
import { buildSaccoAuthHeaders, canRole } from '../src/lib/auth';
import type { User } from '../src/types';

const treasurer: User = {
  id: 'user-1',
  name: 'Test Treasurer',
  email: 'treasurer@example.test',
  phone: '',
  role: 'Treasurer'
};

test('builds bearer-only authentication headers', () => {
  assert.deepEqual(buildSaccoAuthHeaders('firebase-id-token'), {
    Authorization: 'Bearer firebase-id-token'
  });
});

test('applies the client permission policy consistently', () => {
  assert.equal(canRole(treasurer, ['Chairman', 'Treasurer']), true);
  assert.equal(canRole(treasurer, ['Chairman', 'Secretary']), false);
  assert.equal(canRole(null, ['Treasurer']), false);
});
