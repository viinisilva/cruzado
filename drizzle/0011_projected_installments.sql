-- "Parcela prevista" (src/lib/finance/cards.ts, projectInstallments): installments the bank never sent are computed,
-- never stored. Only the person's exclusions are stored here, one key per prevista. Additive only: one new column with
-- an empty default; no existing value changes. Undo: drizzle/down/0011_projected_installments.down.sql
ALTER TABLE credit_cards ADD COLUMN IF NOT EXISTS dismissed_projections jsonb NOT NULL DEFAULT '[]'::jsonb;
