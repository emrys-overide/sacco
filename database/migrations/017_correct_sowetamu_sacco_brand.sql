-- Correct the default organisation name after the brand spelling correction.
UPDATE sacco_settings
SET sacco_name = 'Sowetamu Sacco'
WHERE sacco_name = 'Sewetamu Sacco';
