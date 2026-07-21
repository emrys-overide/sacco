-- Member self-service profile details and a complete, auditable loan application.

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS profile_photo_data TEXT;

ALTER TABLE loans
  ADD COLUMN IF NOT EXISTS loan_type TEXT NOT NULL DEFAULT 'General',
  ADD COLUMN IF NOT EXISTS repayment_period_months INTEGER NOT NULL DEFAULT 12
    CHECK (repayment_period_months BETWEEN 1 AND 84),
  ADD COLUMN IF NOT EXISTS repayment_method TEXT NOT NULL DEFAULT 'SACCO collection',
  ADD COLUMN IF NOT EXISTS income_source TEXT,
  ADD COLUMN IF NOT EXISTS monthly_income NUMERIC(14,2),
  ADD COLUMN IF NOT EXISTS application_snapshot JSONB NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS rejection_reason TEXT,
  ADD COLUMN IF NOT EXISTS rejected_by UUID REFERENCES users(id) ON DELETE SET NULL;

ALTER TABLE loans
  ADD CONSTRAINT loans_monthly_income_non_negative
  CHECK (monthly_income IS NULL OR monthly_income >= 0);

CREATE INDEX IF NOT EXISTS idx_loans_due_date ON loans(due_date);
CREATE INDEX IF NOT EXISTS idx_loans_rejected_at ON loans(rejected_at) WHERE status = 'Rejected';

CREATE TABLE IF NOT EXISTS login_rate_limits (
  attempt_key TEXT PRIMARY KEY,
  attempt_count INTEGER NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  window_started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  locked_until TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO schema_migrations (version, name)
VALUES ('018', 'member_profile_and_loan_application_details')
ON CONFLICT (version) DO NOTHING;
