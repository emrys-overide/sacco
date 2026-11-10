-- 031_historical_manifests.sql
-- Dedicated, isolated storage for 2025 historical daily collection manifests.
-- Completely decoupled from ledger_entries and member accounts to prevent
-- any interference with active operational balances, dashboard totals, or tills.

CREATE TABLE IF NOT EXISTS historical_manifest_days (
  record_date DATE PRIMARY KEY,
  nissan_total NUMERIC(14,2) NOT NULL DEFAULT 0,
  sienta_total NUMERIC(14,2) NOT NULL DEFAULT 0,
  gross_total NUMERIC(14,2) NOT NULL DEFAULT 0,
  total_expenses NUMERIC(14,2) NOT NULL DEFAULT 0,
  net_vault_inflow NUMERIC(14,2) NOT NULL DEFAULT 0,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS historical_manifest_entries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  record_date DATE NOT NULL REFERENCES historical_manifest_days(record_date) ON DELETE CASCADE,
  fleet TEXT NOT NULL CHECK (fleet IN ('Nissan', 'Sienta')),
  row_no INTEGER NOT NULL,
  plate_number TEXT NOT NULL DEFAULT '',
  operation NUMERIC(14,2) NOT NULL DEFAULT 0,
  entrance NUMERIC(14,2) NOT NULL DEFAULT 0,
  loan_repay NUMERIC(14,2) NOT NULL DEFAULT 0,
  savings NUMERIC(14,2) NOT NULL DEFAULT 0,
  s_ticket NUMERIC(14,2) NOT NULL DEFAULT 0,
  legal_fee NUMERIC(14,2) NOT NULL DEFAULT 0,
  total_amount NUMERIC(14,2) NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS historical_manifest_expenses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  record_date DATE NOT NULL REFERENCES historical_manifest_days(record_date) ON DELETE CASCADE,
  item_no INTEGER NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  amount NUMERIC(14,2) NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_hist_entries_date ON historical_manifest_entries(record_date);
CREATE INDEX IF NOT EXISTS idx_hist_expenses_date ON historical_manifest_expenses(record_date);

INSERT INTO schema_migrations (version, name)
VALUES ('031', 'historical_manifests')
ON CONFLICT (version) DO NOTHING;
