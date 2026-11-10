-- Email recovery, forced temporary-password rotation, and auditable loans.

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS must_change_password BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS temporary_password_expires_at TIMESTAMPTZ;

ALTER TABLE member_activation_challenges
  ADD COLUMN IF NOT EXISTS delivery_address TEXT;

ALTER TYPE loan_status ADD VALUE IF NOT EXISTS 'Applied';
ALTER TYPE loan_status ADD VALUE IF NOT EXISTS 'Approved';
ALTER TYPE loan_status ADD VALUE IF NOT EXISTS 'Rejected';

ALTER TABLE loans
  ADD COLUMN IF NOT EXISTS application_date DATE NOT NULL DEFAULT CURRENT_DATE,
  ADD COLUMN IF NOT EXISTS approved_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS rejected_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS disbursed_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_loans_member_status
  ON loans(member_id, status, created_at DESC);

INSERT INTO schema_migrations (version, name)
VALUES ('012', 'email_recovery_and_loan_workflow')
ON CONFLICT (version) DO NOTHING;
