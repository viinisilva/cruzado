-- Undoes drizzle/0009_card_calibration.sql. Run by hand in the Neon SQL editor, after rolling the code back.
-- Only learned data is lost; the next sync with the new code learns it again.
ALTER TABLE credit_cards DROP COLUMN IF EXISTS calibration;
DELETE FROM _migrations WHERE name = '0009_card_calibration.sql';
