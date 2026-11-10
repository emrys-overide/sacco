ALTER TABLE loans
  ADD COLUMN IF NOT EXISTS secretary_reviewed_by UUID REFERENCES users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS secretary_reviewed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS secretary_eligible BOOLEAN,
  ADD COLUMN IF NOT EXISTS secretary_notes TEXT,
  ADD COLUMN IF NOT EXISTS treasurer_reviewed_by UUID REFERENCES users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS treasurer_reviewed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS treasurer_notes TEXT;

CREATE TABLE IF NOT EXISTS loan_policy (
  id BOOLEAN PRIMARY KEY DEFAULT TRUE CHECK (id),
  default_interest_rate NUMERIC(6,3) NOT NULL DEFAULT 0 CHECK (default_interest_rate BETWEEN 0 AND 100),
  maximum_principal NUMERIC(14,2) CHECK (maximum_principal IS NULL OR maximum_principal > 0),
  minimum_savings NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK (minimum_savings >= 0),
  minimum_membership_days INTEGER NOT NULL DEFAULT 0 CHECK (minimum_membership_days >= 0),
  require_active_membership BOOLEAN NOT NULL DEFAULT TRUE,
  updated_by UUID REFERENCES users(id) ON DELETE SET NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO loan_policy (id) VALUES (TRUE) ON CONFLICT (id) DO NOTHING;

CREATE UNIQUE INDEX IF NOT EXISTS uq_loans_one_open_per_member
  ON loans(member_id)
  WHERE status IN ('Applied','SecretaryReview','TreasurerReview','ChairmanReview','Approved','Active','Defaulted');

INSERT INTO schema_migrations (version, name)
VALUES ('014', 'loan_policy_and_staged_approvals')
ON CONFLICT (version) DO NOTHING;
