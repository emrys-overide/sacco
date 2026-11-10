import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { APPROVED_VEHICLE_ROUTES, VEHICLE_CAPACITIES, isApprovedVehicleRoute, isSupportedVehicleCapacity } from '../src/lib/vehicleRegistration';

test('includes the requested approved vehicle registration routes', () => {
  assert.deepEqual([...APPROVED_VEHICLE_ROUTES], [
    'Stage 17 to Machakos',
    'Soweto to Utawala',
    'Rounda / Taj Mall to Utawala',
    'Cabanas to Allsops',
    'Outer Ring to Utawala',
    'Kariobangi to Kangundo',
    'Soweto to Kabanas',
    'Kabanas, Mombasa Road',
    'Junction to Mihango'
  ]);
  assert.equal(isApprovedVehicleRoute('Cabanas to Allsops'), true);
  assert.equal(isApprovedVehicleRoute('Unapproved Route'), false);
});

test('uses the requested vehicle seating capacities', () => {
  assert.deepEqual([...VEHICLE_CAPACITIES], [7, 14, 26, 29, 46, 52, 63]);
  for (const capacity of VEHICLE_CAPACITIES) assert.equal(isSupportedVehicleCapacity(capacity), true);
  assert.equal(isSupportedVehicleCapacity(33), false);
});

test('vehicle detail migration stores owner contacts, historical dates, and requested routes', async () => {
  const migration = await readFile(new URL('../database/migrations/029_vehicle_capacity_owner_and_registration_date.sql', import.meta.url), 'utf8');
  assert.match(migration, /owner_phone TEXT/);
  assert.match(migration, /owner_id_number TEXT/);
  assert.match(migration, /date_registered DATE/);
  assert.match(migration, /SET date_registered = created_at::date/);
  for (const route of ['Soweto to Kabanas', 'Kabanas, Mombasa Road', 'Junction to Mihango']) {
    assert.match(migration, new RegExp(route.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  }
});

test('vehicle workflow migration preserves an external owner and nullable member link', async () => {
  const migration = await readFile(new URL('../database/migrations/028_vehicle_registration_workflow.sql', import.meta.url), 'utf8');
  assert.match(migration, /ADD COLUMN IF NOT EXISTS owner_name TEXT/);
  assert.match(migration, /ALTER COLUMN owner_member_id DROP NOT NULL/);
  assert.match(migration, /ALTER COLUMN owner_name SET NOT NULL/);
  for (const route of ['Stage 17 to Machakos', 'Soweto to Utawala', 'Rounda / Taj Mall to Utawala', 'Cabanas to Allsops', 'Outer Ring to Utawala', 'Kariobangi to Kangundo']) {
    assert.match(migration, new RegExp(route.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  }
});
