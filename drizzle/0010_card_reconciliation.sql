-- Card credits classified by evidence and bills reconciled against the bank (docs/AUTOCONCILIACAO.md). Additive only:
-- new optional columns and new tables; no existing value changes here. Undo: drizzle/down/0010_card_reconciliation.down.sql
ALTER TABLE transactions
  ADD COLUMN IF NOT EXISTS operation_type text,
  ADD COLUMN IF NOT EXISTS category_source text,
  ADD COLUMN IF NOT EXISTS classification jsonb;
--> statement-breakpoint
ALTER TABLE card_bills ADD COLUMN IF NOT EXISTS payments jsonb;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS reconciliation_rules (
  id text PRIMARY KEY,
  user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  institution text NOT NULL,
  pattern text NOT NULL,
  change text NOT NULL,
  evidence integer NOT NULL DEFAULT 0,
  contradictions integer NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS reconciliation_rules_uq ON reconciliation_rules (user_id, institution, pattern, change);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS reconciliation_changes (
  id text PRIMARY KEY,
  user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  account_id text NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  bill_ref text,
  transaction_id text NOT NULL REFERENCES transactions(id) ON DELETE CASCADE,
  kind text NOT NULL,
  before jsonb NOT NULL,
  after jsonb NOT NULL,
  reason text NOT NULL,
  source text NOT NULL,
  status text NOT NULL DEFAULT 'applied',
  rule_id text,
  applied_at timestamptz NOT NULL DEFAULT now(),
  reverted_at timestamptz
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS reconciliation_changes_account_idx ON reconciliation_changes (account_id, applied_at);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS reconciliation_events (
  id text PRIMARY KEY,
  user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  institution text NOT NULL,
  bill_month text NOT NULL,
  outcome text NOT NULL,
  change_kinds text[] NOT NULL DEFAULT '{}',
  gap_bucket text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS reconciliation_events_user_idx ON reconciliation_events (user_id, created_at);
