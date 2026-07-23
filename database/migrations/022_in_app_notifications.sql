-- Private, role-scoped workflow reminders. Notifications contain no financial payloads or secrets.

CREATE TABLE IF NOT EXISTS app_notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  recipient_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  category TEXT NOT NULL,
  title TEXT NOT NULL,
  message TEXT NOT NULL,
  destination TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  read_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_app_notifications_recipient_unread
  ON app_notifications (recipient_user_id, created_at DESC)
  WHERE read_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_app_notifications_recipient_created
  ON app_notifications (recipient_user_id, created_at DESC);

INSERT INTO schema_migrations (version, name)
VALUES ('022', 'in_app_notifications')
ON CONFLICT (version) DO NOTHING;
