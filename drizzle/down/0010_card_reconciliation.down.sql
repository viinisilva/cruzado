-- Undoes drizzle/0010_card_reconciliation.sql. Run by hand in the Neon SQL editor, after rolling the code back.
-- Step 1 (optional, before dropping): put back every category the reconciler or the classifier changed.
UPDATE transactions t SET category_id = c.before->>'categoryId'
FROM reconciliation_changes c
WHERE c.transaction_id = t.id AND c.status = 'applied' AND c.kind = 'category'
  AND c.id = (SELECT c2.id FROM reconciliation_changes c2 WHERE c2.transaction_id = t.id AND c2.kind = 'category' AND c2.status = 'applied' ORDER BY c2.applied_at ASC LIMIT 1);
-- Step 2: drop what the migration created.
DROP TABLE IF EXISTS reconciliation_events;
DROP TABLE IF EXISTS reconciliation_changes;
DROP TABLE IF EXISTS reconciliation_rules;
ALTER TABLE card_bills DROP COLUMN IF EXISTS payments;
ALTER TABLE transactions DROP COLUMN IF EXISTS classification, DROP COLUMN IF EXISTS category_source, DROP COLUMN IF EXISTS operation_type;
DELETE FROM _migrations WHERE name = '0010_card_reconciliation.sql';
