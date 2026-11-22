-- The bank's own card bills, and where each card fact came from. Additive only: no existing value changes here.
-- Open Finance never sends a closing day, so cards linked before this point keep their stored day, marked as an
-- estimate until the bank's bills or the user confirm it.
ALTER TABLE credit_cards
  ADD COLUMN closing_day_source text,
  ADD COLUMN available_cents bigint,
  ADD COLUMN bank_data_at timestamptz,
  ADD COLUMN bills_fetched_at timestamptz;
--> statement-breakpoint
UPDATE credit_cards SET closing_day_source = CASE
  WHEN EXISTS (SELECT 1 FROM accounts a WHERE a.id = credit_cards.account_id AND a.connection_id IS NOT NULL) THEN 'estimated'
  ELSE 'user' END;
--> statement-breakpoint
ALTER TABLE transactions ADD COLUMN bill_ref text;
--> statement-breakpoint
CREATE TABLE card_bills (
  id text PRIMARY KEY,
  user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  account_id text NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  bill_ref text NOT NULL,
  due_date date NOT NULL,
  closing_date date,
  total_cents bigint NOT NULL,
  minimum_cents bigint,
  fetched_at timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE UNIQUE INDEX card_bills_account_ref_uq ON card_bills (account_id, bill_ref);
--> statement-breakpoint
CREATE INDEX card_bills_user_idx ON card_bills (user_id, due_date);
