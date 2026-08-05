import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const migrationPath = new URL('../database/migrations/027_supabase_security_advisor_lockdown.sql', import.meta.url);
const runnerPath = new URL('../scripts/database.mjs', import.meta.url);

test('locks every public table away from Supabase Data API roles', async () => {
  const migration = await readFile(migrationPath, 'utf8');
  const runner = await readFile(runnerPath, 'utf8');

  assert.match(migration, /WHERE schemaname = 'public'/);
  assert.match(migration, /ENABLE ROW LEVEL SECURITY/);
  assert.match(migration, /ARRAY\['anon', 'authenticated', 'service_role'\]/);
  assert.match(migration, /REVOKE ALL ON ALL TABLES IN SCHEMA public/);
  assert.match(migration, /ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON TABLES/);
  assert.match(migration, /ALTER DEFAULT PRIVILEGES REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC/);
  assert.match(migration, /ALTER FUNCTION public\.set_updated_at\(\)[\s\S]*SET search_path = pg_catalog, public/);
  assert.match(migration, /ALTER FUNCTION public\.prevent_coop_bank_raw_payload_update\(\)[\s\S]*SET search_path = pg_catalog, public/);

  assert.match(runner, /Supabase public Data API boundary: enforced/);
  assert.match(runner, /ENABLE ROW LEVEL SECURITY/);
  assert.match(runner, /REVOKE ALL ON ALL TABLES IN SCHEMA public/);
});
