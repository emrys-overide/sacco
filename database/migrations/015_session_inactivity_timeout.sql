ALTER TABLE users
  ADD COLUMN IF NOT EXISTS last_activity_at TIMESTAMPTZ;

UPDATE users
SET last_activity_at = COALESCE(last_login_at, now())
WHERE last_activity_at IS NULL;

INSERT INTO schema_migrations (version, name)
VALUES ('015', 'session_inactivity_timeout')
ON CONFLICT (version) DO NOTHING;
