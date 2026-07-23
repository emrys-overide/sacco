-- Private operational diagnostics. Error details are never exposed to normal SACCO roles.

CREATE TABLE IF NOT EXISTS application_error_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  source TEXT NOT NULL CHECK (source IN ('server', 'client')),
  severity TEXT NOT NULL DEFAULT 'error' CHECK (severity IN ('warning', 'error', 'critical')),
  request_id UUID,
  method TEXT,
  path TEXT,
  status_code INTEGER CHECK (status_code IS NULL OR status_code BETWEEN 100 AND 599),
  error_code TEXT,
  message TEXT NOT NULL,
  stack_trace TEXT,
  context JSONB NOT NULL DEFAULT '{}'::jsonb,
  actor_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  resolved_at TIMESTAMPTZ,
  resolved_by UUID REFERENCES users(id) ON DELETE SET NULL,
  resolution_note TEXT
);

CREATE INDEX IF NOT EXISTS idx_application_error_logs_open
  ON application_error_logs (occurred_at DESC)
  WHERE resolved_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_application_error_logs_source_occurred
  ON application_error_logs (source, occurred_at DESC);

INSERT INTO schema_migrations (version, name)
VALUES ('020', 'developer_error_log')
ON CONFLICT (version) DO NOTHING;
