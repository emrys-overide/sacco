-- Firebase-gated Member enrollment. A row is reserved before Firebase account
-- creation so one SACCO member can never gain two concurrent web identities.
-- The `users` profile is still created only after Firebase reports the email
-- as verified to the server.

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS firebase_email_verified_at TIMESTAMPTZ;

CREATE TABLE IF NOT EXISTS member_firebase_enrollments (
  member_id UUID PRIMARY KEY REFERENCES members(id) ON DELETE RESTRICT,
  firebase_uid TEXT NOT NULL UNIQUE,
  email TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  email_verified_at TIMESTAMPTZ
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_member_firebase_enrollments_email
  ON member_firebase_enrollments (lower(email));

CREATE INDEX IF NOT EXISTS idx_member_firebase_enrollments_firebase_uid
  ON member_firebase_enrollments(firebase_uid);

INSERT INTO schema_migrations (version, name)
VALUES ('009', 'firebase_member_email_verification')
ON CONFLICT (version) DO NOTHING;
