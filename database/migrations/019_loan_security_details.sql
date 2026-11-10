-- Optional application details commonly required for SACCO credit assessment.
-- These are review notes only; they do not create a guarantor obligation.

ALTER TABLE loans
  ADD COLUMN IF NOT EXISTS guarantor_details TEXT,
  ADD COLUMN IF NOT EXISTS collateral_details TEXT;

INSERT INTO schema_migrations (version, name)
VALUES ('019', 'loan_security_details')
ON CONFLICT (version) DO NOTHING;
