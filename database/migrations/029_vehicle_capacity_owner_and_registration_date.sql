-- Expanded capacity choices, non-member owner identity, requested routes, and historical registration dates.

ALTER TABLE vehicles
  ADD COLUMN IF NOT EXISTS owner_phone TEXT,
  ADD COLUMN IF NOT EXISTS owner_id_number TEXT,
  ADD COLUMN IF NOT EXISTS date_registered DATE;

UPDATE vehicles
SET date_registered = created_at::date
WHERE date_registered IS NULL;

ALTER TABLE vehicles
  ALTER COLUMN date_registered SET NOT NULL;

INSERT INTO routes (route_name, origin, destination, is_active)
VALUES
  ('Soweto to Kabanas', 'Soweto', 'Kabanas', TRUE),
  ('Kabanas, Mombasa Road', 'Kabanas', 'Mombasa Road', TRUE),
  ('Junction to Mihango', 'Junction', 'Mihango', TRUE)
ON CONFLICT (route_name) DO UPDATE SET
  origin = EXCLUDED.origin,
  destination = EXCLUDED.destination,
  is_active = TRUE;

INSERT INTO schema_migrations (version, name)
VALUES ('029', 'vehicle_capacity_owner_and_registration_date')
ON CONFLICT (version) DO NOTHING;
