-- Flexible vehicle ownership, approved operating routes, and editable fleet records.

ALTER TABLE vehicles
  ADD COLUMN IF NOT EXISTS owner_name TEXT;

UPDATE vehicles v
SET owner_name = COALESCE(
  NULLIF(btrim(v.owner_name), ''),
  (SELECT m.full_name FROM members m WHERE m.id = v.member_id),
  'Owner not recorded'
);

ALTER TABLE vehicles
  ALTER COLUMN owner_name SET NOT NULL;

ALTER TABLE driver_assignments
  ALTER COLUMN owner_member_id DROP NOT NULL;

INSERT INTO routes (route_name, origin, destination, is_active)
VALUES
  ('Stage 17 to Machakos', 'Stage 17', 'Machakos', TRUE),
  ('Soweto to Utawala', 'Soweto', 'Utawala', TRUE),
  ('Rounda / Taj Mall to Utawala', 'Rounda / Taj Mall', 'Utawala', TRUE),
  ('Cabanas to Allsops', 'Cabanas', 'Allsops', TRUE),
  ('Outer Ring to Utawala', 'Outer Ring', 'Utawala', TRUE),
  ('Kariobangi to Kangundo', 'Kariobangi', 'Kangundo', TRUE)
ON CONFLICT (route_name) DO UPDATE SET
  origin = EXCLUDED.origin,
  destination = EXCLUDED.destination,
  is_active = TRUE;

INSERT INTO schema_migrations (version, name)
VALUES ('028', 'vehicle_registration_workflow')
ON CONFLICT (version) DO NOTHING;
