-- Member password reset requests are approved only by the Chairman.

CREATE TABLE IF NOT EXISTS password_reset_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'Pending' CHECK (status IN ('Pending', 'Completed', 'Cancelled')),
  requested_ip TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  reviewed_at TIMESTAMPTZ,
  reviewed_by UUID REFERENCES users(id) ON DELETE SET NULL,
  CHECK ((status = 'Pending' AND reviewed_at IS NULL AND reviewed_by IS NULL) OR status <> 'Pending')
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_password_reset_request_pending_user
  ON password_reset_requests (user_id)
  WHERE status = 'Pending';
CREATE INDEX IF NOT EXISTS idx_password_reset_requests_pending_created
  ON password_reset_requests (created_at DESC)
  WHERE status = 'Pending';

INSERT INTO schema_migrations (version, name)
VALUES ('021', 'chairman_confirmed_password_resets')
ON CONFLICT (version) DO NOTHING;
