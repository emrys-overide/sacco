-- Auditable member and vehicle lifecycle controls.

ALTER TABLE members
  ADD COLUMN IF NOT EXISTS created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS suspended_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS suspended_by UUID REFERENCES users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS suspension_reason TEXT,
  ADD COLUMN IF NOT EXISTS inactivity_warned_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS last_daily_collection_at TIMESTAMPTZ;

ALTER TABLE vehicles
  ADD COLUMN IF NOT EXISTS offboarded_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS offboarded_by UUID REFERENCES users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS offboarding_reason TEXT;

UPDATE members m
SET last_daily_collection_at = activity.last_collection_at
FROM (
  SELECT member_id, MAX(entry_time) AS last_collection_at
  FROM ledger_entries
  WHERE account_type = 'DailyContribution'
    AND transaction_type = 'Credit'
    AND status = 'Posted'
    AND reversal_of IS NULL
    AND member_id IS NOT NULL
  GROUP BY member_id
) activity
WHERE m.id = activity.member_id
  AND m.last_daily_collection_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_members_creator_active
  ON members (created_by, created_at DESC)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_members_inactivity_lifecycle
  ON members (status, COALESCE(last_daily_collection_at, created_at))
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_vehicles_active_fleet
  ON vehicles (created_at DESC)
  WHERE status <> 'Exited';

INSERT INTO schema_migrations (version, name)
VALUES ('026', 'member_vehicle_lifecycle')
ON CONFLICT (version) DO NOTHING;
