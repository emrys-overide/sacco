-- Co-op Paybill 400200 deposits settle into one of two bank accounts.
-- The legacy till_type values remain intact so existing ledger rows and reports
-- continue to work, while these columns carry the real bank routing data.
ALTER TABLE mpesa_tills
  ADD COLUMN IF NOT EXISTS paybill_number TEXT,
  ADD COLUMN IF NOT EXISTS bank_account_number TEXT;

ALTER TABLE mpesa_payments
  ADD COLUMN IF NOT EXISTS destination_account_number TEXT;

UPDATE mpesa_tills
SET business_short_code = '48277',
    paybill_number = '400200',
    bank_account_number = '48277',
    display_name = 'Operations / Daily Collection Account',
    default_account_type = 'DailyContribution',
    updated_at = now()
WHERE till_type = 'VehicleTill';

UPDATE mpesa_tills
SET business_short_code = '871671',
    paybill_number = '400200',
    bank_account_number = '871671',
    display_name = 'Member Savings Account',
    default_account_type = 'Savings',
    updated_at = now()
WHERE till_type = 'UtilityTill';

CREATE INDEX IF NOT EXISTS idx_mpesa_payments_destination_account
  ON mpesa_payments(destination_account_number, transaction_time DESC);

INSERT INTO schema_migrations(version, name)
VALUES ('005', 'coop_collection_accounts')
ON CONFLICT (version) DO NOTHING;

