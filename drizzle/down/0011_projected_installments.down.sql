-- Undoes drizzle/0011_projected_installments.sql. Run by hand in the Neon SQL editor, after rolling the code back.
-- Only the person's exclusions of previstas are lost; no entry, bill or category depends on this column.
ALTER TABLE credit_cards DROP COLUMN IF EXISTS dismissed_projections;
