-- Member numbers are officer-assigned, case-insensitive identifiers.
-- Existing legacy rows may remain NULL until corrected by an officer; every
-- new application registration requires a value before it reaches PostgreSQL.
UPDATE members
SET member_number = upper(member_number)
WHERE member_number IS NOT NULL;

ALTER TABLE members
  DROP CONSTRAINT IF EXISTS members_member_number_format;

ALTER TABLE members
  ADD CONSTRAINT members_member_number_format
  CHECK (member_number IS NULL OR member_number ~ '^[A-Z0-9]{1,30}$');

CREATE UNIQUE INDEX IF NOT EXISTS members_member_number_unique_ci
  ON members (upper(member_number))
  WHERE member_number IS NOT NULL;
