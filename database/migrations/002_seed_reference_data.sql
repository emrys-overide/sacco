-- SACCO reference data seed
-- Target database: PostgreSQL / Supabase-compatible SQL

INSERT INTO sacco_settings (sacco_name, default_currency, fiscal_year_start_month)
SELECT 'Sowetamu Sacco', 'KES', 1
WHERE NOT EXISTS (SELECT 1 FROM sacco_settings);

INSERT INTO mpesa_tills (till_type, business_short_code, display_name, default_account_type)
VALUES
  ('VehicleTill', '48277', 'Operations / Daily Collection Account', 'DailyContribution'),
  ('UtilityTill', '871671', 'Member Savings Account', 'Savings')
ON CONFLICT (till_type) DO UPDATE SET
  business_short_code = EXCLUDED.business_short_code,
  display_name = EXCLUDED.display_name,
  default_account_type = EXCLUDED.default_account_type,
  is_active = TRUE,
  updated_at = now();

INSERT INTO schema_migrations(version, name)
VALUES ('002', 'seed_reference_data')
ON CONFLICT (version) DO NOTHING;
