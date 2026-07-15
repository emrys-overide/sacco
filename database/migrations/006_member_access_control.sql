-- Member portal authorization and activation support.
-- This migration is additive. Existing Member rows are deliberately not linked
-- automatically: an administrator must resolve any ambiguous legacy identity.

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS linked_member_id UUID REFERENCES members(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS account_status TEXT NOT NULL DEFAULT 'Active',
  ADD COLUMN IF NOT EXISTS approved_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS approved_by UUID REFERENCES users(id) ON DELETE SET NULL;

UPDATE users
SET account_status = CASE WHEN is_active THEN 'Active' ELSE 'Disabled' END
WHERE (is_active = FALSE AND account_status = 'Active')
   OR account_status IS NULL
   OR account_status NOT IN ('PendingActivation', 'Active', 'Suspended', 'Disabled', 'Rejected', 'Locked');

ALTER TABLE users
  DROP CONSTRAINT IF EXISTS chk_users_account_status;
ALTER TABLE users
  ADD CONSTRAINT chk_users_account_status
  CHECK (account_status IN ('PendingActivation', 'Active', 'Suspended', 'Disabled', 'Rejected', 'Locked'));

-- One online account can be linked to one member and a member can have only
-- one active SACCO account. The NOT VALID constraint protects new/changed rows
-- without destroying or guessing at legacy Member records.
CREATE UNIQUE INDEX IF NOT EXISTS uq_users_linked_member_id
  ON users(linked_member_id)
  WHERE linked_member_id IS NOT NULL;

ALTER TABLE users
  DROP CONSTRAINT IF EXISTS chk_member_users_have_member_link;
ALTER TABLE users
  ADD CONSTRAINT chk_member_users_have_member_link
  CHECK (role <> 'Member' OR linked_member_id IS NOT NULL) NOT VALID;

CREATE INDEX IF NOT EXISTS idx_users_linked_member_id ON users(linked_member_id);
CREATE INDEX IF NOT EXISTS idx_users_account_status ON users(account_status);

CREATE TABLE IF NOT EXISTS member_activation_challenges (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  member_id UUID NOT NULL REFERENCES members(id) ON DELETE RESTRICT,
  otp_hash TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  attempt_count INTEGER NOT NULL DEFAULT 0 CHECK (attempt_count >= 0 AND attempt_count <= 5),
  max_attempts INTEGER NOT NULL DEFAULT 5 CHECK (max_attempts BETWEEN 1 AND 10),
  requested_ip TEXT,
  used_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_member_activation_challenges_member_created
  ON member_activation_challenges(member_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_member_activation_challenges_ip_created
  ON member_activation_challenges(requested_ip, created_at DESC)
  WHERE requested_ip IS NOT NULL;

CREATE TABLE IF NOT EXISTS drivers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  full_name TEXT NOT NULL,
  phone TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_drivers_phone_not_null
  ON drivers(phone)
  WHERE phone IS NOT NULL AND phone <> '';

CREATE TABLE IF NOT EXISTS driver_assignments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  vehicle_id UUID NOT NULL REFERENCES vehicles(id) ON DELETE RESTRICT,
  driver_id UUID NOT NULL REFERENCES drivers(id) ON DELETE RESTRICT,
  owner_member_id UUID NOT NULL REFERENCES members(id) ON DELETE RESTRICT,
  start_date_time TIMESTAMPTZ NOT NULL DEFAULT now(),
  end_date_time TIMESTAMPTZ,
  status TEXT NOT NULL DEFAULT 'Active' CHECK (status IN ('Active', 'Closed')),
  assigned_by UUID REFERENCES users(id) ON DELETE SET NULL,
  reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK ((status = 'Active' AND end_date_time IS NULL) OR (status = 'Closed' AND end_date_time IS NOT NULL)),
  CHECK (end_date_time IS NULL OR end_date_time >= start_date_time)
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_active_driver_assignment_per_vehicle
  ON driver_assignments(vehicle_id)
  WHERE status = 'Active';
CREATE INDEX IF NOT EXISTS idx_driver_assignments_owner_member
  ON driver_assignments(owner_member_id, start_date_time DESC);

-- Preserve current vehicle-driver details as the first historical assignment.
INSERT INTO drivers (full_name, phone)
SELECT DISTINCT v.driver_name, NULLIF(v.driver_phone, '')
FROM vehicles v
WHERE COALESCE(v.driver_name, '') <> ''
  AND NOT EXISTS (
    SELECT 1 FROM drivers d
    WHERE (NULLIF(v.driver_phone, '') IS NOT NULL AND d.phone = NULLIF(v.driver_phone, ''))
       OR (NULLIF(v.driver_phone, '') IS NULL AND d.full_name = v.driver_name)
  );

INSERT INTO driver_assignments (
  vehicle_id, driver_id, owner_member_id, start_date_time, status, assigned_by, reason
)
SELECT v.id, d.id, v.member_id, COALESCE(v.created_at, now()), 'Active', NULL, 'Migrated current vehicle driver'
FROM vehicles v
JOIN drivers d ON (
  (NULLIF(v.driver_phone, '') IS NOT NULL AND d.phone = NULLIF(v.driver_phone, ''))
  OR (NULLIF(v.driver_phone, '') IS NULL AND d.full_name = v.driver_name)
)
WHERE v.member_id IS NOT NULL
  AND COALESCE(v.driver_name, '') <> ''
  AND NOT EXISTS (SELECT 1 FROM driver_assignments da WHERE da.vehicle_id = v.id);

DROP TRIGGER IF EXISTS trg_drivers_updated_at ON drivers;
CREATE TRIGGER trg_drivers_updated_at
BEFORE UPDATE ON drivers
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS trg_driver_assignments_updated_at ON driver_assignments;
CREATE TRIGGER trg_driver_assignments_updated_at
BEFORE UPDATE ON driver_assignments
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

INSERT INTO schema_migrations (version, name)
VALUES ('006', 'member_access_control')
ON CONFLICT (version) DO NOTHING;
