import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { APPROVED_VEHICLE_ROUTES, isApprovedVehicleRoute } from '../src/lib/vehicleRegistration';

test('uses only the six approved vehicle registration routes', () => {
  assert.deepEqual([...APPROVED_VEHICLE_ROUTES], [
    'Stage 17 to Machakos',
    'Soweto to Utawala',
    'Rounda / Taj Mall to Utawala',
    'Cabanas to Allsops',
    'Outer Ring to Utawala',
    'Kariobangi to Kangundo'
  ]);
  assert.equal(isApprovedVehicleRoute('Cabanas to Allsops'), true);
  assert.equal(isApprovedVehicleRoute('Unapproved Route'), false);
});

test('vehicle workflow migration preserves an external owner and nullable member link', async () => {
  const migration = await readFile(new URL('../database/migrations/028_vehicle_registration_workflow.sql', import.meta.url), 'utf8');
  assert.match(migration, /ADD COLUMN IF NOT EXISTS owner_name TEXT/);
  assert.match(migration, /ALTER COLUMN owner_member_id DROP NOT NULL/);
  assert.match(migration, /ALTER COLUMN owner_name SET NOT NULL/);
  for (const route of APPROVED_VEHICLE_ROUTES) assert.match(migration, new RegExp(route.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
});
