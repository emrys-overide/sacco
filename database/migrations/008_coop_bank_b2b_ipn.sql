-- Co-operative Bank B2B/IPN inbox. This deliberately does not reuse the
-- legacy mpesa_payments table: a bank account event is not automatically a
-- member contribution, and debit events must never be auto-posted as income.

CREATE TABLE IF NOT EXISTS coop_bank_ipn_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  transaction_id TEXT NOT NULL UNIQUE,
  payment_ref TEXT,
  account_number TEXT NOT NULL,
  amount NUMERIC(14,2) NOT NULL CHECK (amount > 0),
  currency CHAR(3) NOT NULL,
  event_type TEXT NOT NULL CHECK (event_type IN ('CREDIT', 'DEBIT')),
  narration TEXT NOT NULL DEFAULT '',
  customer_memo_line1 TEXT,
  customer_memo_line2 TEXT,
  customer_memo_line3 TEXT,
  booked_balance NUMERIC(14,2),
  cleared_balance NUMERIC(14,2),
  exchange_rate NUMERIC(18,8),
  posting_date TEXT,
  value_date TEXT,
  transaction_date TEXT,
  status TEXT NOT NULL DEFAULT 'PendingReview'
    CHECK (status IN ('PendingReview', 'Reconciled', 'Ignored')),
  raw_payload JSONB NOT NULL,
  received_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  reconciled_at TIMESTAMPTZ,
  reconciled_by UUID REFERENCES users(id) ON DELETE SET NULL,
  ledger_entry_id UUID UNIQUE REFERENCES ledger_entries(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_coop_bank_ipn_events_received_at
  ON coop_bank_ipn_events(received_at DESC);
CREATE INDEX IF NOT EXISTS idx_coop_bank_ipn_events_status
  ON coop_bank_ipn_events(status, received_at DESC);
CREATE INDEX IF NOT EXISTS idx_coop_bank_ipn_events_account_number
  ON coop_bank_ipn_events(account_number, received_at DESC);

INSERT INTO schema_migrations (version, name)
VALUES ('008', 'coop_bank_b2b_ipn')
ON CONFLICT (version) DO NOTHING;
