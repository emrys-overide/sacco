-- Runtime metadata needed to preserve the existing API contract while the
-- relational ledger remains the financial source of truth.
ALTER TABLE ledger_entries
  ADD COLUMN IF NOT EXISTS metadata JSONB NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE mpesa_payments
  ADD COLUMN IF NOT EXISTS source payment_source NOT NULL DEFAULT 'Manual',
  ADD COLUMN IF NOT EXISTS metadata JSONB NOT NULL DEFAULT '{}'::jsonb;

CREATE INDEX IF NOT EXISTS idx_ledger_entries_metadata ON ledger_entries USING GIN (metadata);

INSERT INTO schema_migrations (version, name)
VALUES ('004', 'runtime_persistence')
ON CONFLICT (version) DO NOTHING;
