-- Chairman-only member removal. The active profile is anonymized and hidden,
-- while financial rows retain their foreign-key link for audit integrity.

ALTER TABLE members
  ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS deleted_by UUID REFERENCES users(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_members_active_registry
  ON members (created_at DESC)
  WHERE deleted_at IS NULL;

INSERT INTO schema_migrations (version, name)
VALUES ('024', 'chairman_member_deletion')
ON CONFLICT (version) DO NOTHING;
