-- What the Tostão learned about each card from the bank's data (docs/CALIBRACAO_CARTAO.md). Additive only: one
-- optional column, filled by the next sync. Code from before this migration ignores it.
-- Undo: drizzle/down/0009_card_calibration.down.sql
ALTER TABLE credit_cards ADD COLUMN IF NOT EXISTS calibration jsonb;
