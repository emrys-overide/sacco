-- The SACCO uses a trusted server-side PostgreSQL connection and does not
-- expose application tables through Supabase's browser-facing Data API.
-- Re-apply the private API boundary to tables added after migration 011.
DO $$
DECLARE
  table_record record;
  api_role text;
BEGIN
  FOR table_record IN
    SELECT schemaname, tablename
    FROM pg_tables
    WHERE schemaname = 'public'
  LOOP
    EXECUTE format(
      'ALTER TABLE %I.%I ENABLE ROW LEVEL SECURITY',
      table_record.schemaname,
      table_record.tablename
    );
  END LOOP;

  FOREACH api_role IN ARRAY ARRAY['anon', 'authenticated', 'service_role']
  LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = api_role) THEN
      EXECUTE format('REVOKE ALL ON ALL TABLES IN SCHEMA public FROM %I', api_role);
      EXECUTE format('REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM %I', api_role);
      EXECUTE format('REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA public FROM %I', api_role);

      -- Supabase's legacy project defaults automatically granted new public
      -- objects to API roles. Remove those defaults for future app migrations.
      EXECUTE format(
        'ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON TABLES FROM %I',
        api_role
      );
      EXECUTE format(
        'ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON SEQUENCES FROM %I',
        api_role
      );
      EXECUTE format(
        'ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM %I',
        api_role
      );
    END IF;
  END LOOP;
END $$;

-- These trigger functions do not need to be callable over PostgREST. Pinning
-- their search paths also prevents object-shadowing if public objects change.
ALTER FUNCTION public.set_updated_at()
  SET search_path = pg_catalog, public;
ALTER FUNCTION public.prevent_coop_bank_raw_payload_update()
  SET search_path = pg_catalog, public;

REVOKE EXECUTE ON FUNCTION public.set_updated_at() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.prevent_coop_bank_raw_payload_update() FROM PUBLIC;
ALTER DEFAULT PRIVILEGES REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;

INSERT INTO schema_migrations (version, name)
VALUES ('027', 'supabase_security_advisor_lockdown')
ON CONFLICT (version) DO NOTHING;
