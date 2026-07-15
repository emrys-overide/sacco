-- Password-based member login and TOTP-based officer second factor.
-- Firebase UID support remains nullable for existing deployments, but neither
-- email nor a Firebase identity is required for a phone/password Member.

ALTER TABLE users
  ALTER COLUMN email DROP NOT NULL;

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS totp_secret_ciphertext TEXT,
  ADD COLUMN IF NOT EXISTS totp_enabled_at TIMESTAMPTZ;

ALTER TABLE member_activation_challenges
  ADD COLUMN IF NOT EXISTS purpose TEXT NOT NULL DEFAULT 'Activation';

UPDATE member_activation_challenges
SET purpose = 'Activation'
WHERE purpose IS NULL OR purpose NOT IN ('Activation', 'PasswordReset');

ALTER TABLE member_activation_challenges
  DROP CONSTRAINT IF EXISTS chk_member_activation_challenge_purpose;
ALTER TABLE member_activation_challenges
  ADD CONSTRAINT chk_member_activation_challenge_purpose
  CHECK (purpose IN ('Activation', 'PasswordReset'));

CREATE INDEX IF NOT EXISTS idx_member_activation_challenges_purpose
  ON member_activation_challenges(member_id, purpose, created_at DESC);

CREATE TABLE IF NOT EXISTS auth_mfa_challenges (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  purpose TEXT NOT NULL CHECK (purpose IN ('TotpLogin', 'TotpEnrollment')),
  expires_at TIMESTAMPTZ NOT NULL,
  attempt_count INTEGER NOT NULL DEFAULT 0 CHECK (attempt_count >= 0 AND attempt_count <= 5),
  max_attempts INTEGER NOT NULL DEFAULT 5 CHECK (max_attempts BETWEEN 1 AND 10),
  used_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_auth_mfa_challenges_user_purpose
  ON auth_mfa_challenges(user_id, purpose, created_at DESC);

INSERT INTO schema_migrations (version, name)
VALUES ('007', 'password_and_totp_auth')
ON CONFLICT (version) DO NOTHING;
