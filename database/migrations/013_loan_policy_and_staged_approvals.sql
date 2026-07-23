ALTER TYPE loan_status ADD VALUE IF NOT EXISTS 'SecretaryReview';
ALTER TYPE loan_status ADD VALUE IF NOT EXISTS 'TreasurerReview';
ALTER TYPE loan_status ADD VALUE IF NOT EXISTS 'ChairmanReview';

INSERT INTO schema_migrations (version, name)
VALUES ('013', 'loan_workflow_statuses')
ON CONFLICT (version) DO NOTHING;
