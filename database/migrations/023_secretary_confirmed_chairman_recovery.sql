-- Break-glass recovery for a locked-out Chairman. The application limits
-- approval to an authenticated Secretary and records that reviewer.

CREATE TABLE IF NOT EXISTS chairman_recovery_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'Pending' CHECK (status IN ('Pending', 'Completed', 'Cancelled')),
  requested_ip TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  reviewed_at TIMESTAMPTZ,
  reviewed_by UUID REFERENCES users(id) ON DELETE SET NULL,
  CHECK ((status = 'Pending' AND reviewed_at IS NULL AND reviewed_by IS NULL) OR status <> 'Pending')
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_chairman_recovery_request_pending_user
  ON chairman_recovery_requests (user_id)
  WHERE status = 'Pending';
CREATE INDEX IF NOT EXISTS idx_chairman_recovery_requests_pending_created
  ON chairman_recovery_requests (created_at DESC)
  WHERE status = 'Pending';

INSERT INTO schema_migrations (version, name)
VALUES ('023', 'secretary_confirmed_chairman_recovery')
ON CONFLICT (version) DO NOTHING;
