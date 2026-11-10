-- Update the seeded organisation name without overwriting a custom SACCO name.
UPDATE sacco_settings
SET sacco_name = 'Sewetamu Sacco'
WHERE sacco_name = 'Sowetamu Sacco';
