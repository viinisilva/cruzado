-- Durable, resumable bank sync. Additive only: every existing row keeps working with the defaults below.
ALTER TABLE financial_connections
  ADD COLUMN access_mode text NOT NULL DEFAULT 'personal',
  ADD COLUMN lease_until timestamptz,
  ADD COLUMN sync_requested_at timestamptz,
  ADD COLUMN resync_from date,
  ADD COLUMN sync_cursor jsonb,
  ADD COLUMN next_attempt_at timestamptz,
  ADD COLUMN failure_count integer NOT NULL DEFAULT 0,
  ADD COLUMN last_attempt_at timestamptz,
  ADD COLUMN last_sync_summary jsonb;
--> statement-breakpoint
ALTER TABLE accounts
  ADD COLUMN bank_balance_cents bigint,
  ADD COLUMN bank_balance_at timestamptz;
--> statement-breakpoint
ALTER TABLE transactions
  ADD COLUMN provider_description text,
  ADD COLUMN description_overridden boolean NOT NULL DEFAULT false,
  ADD COLUMN bank_status text,
  ADD COLUMN provider_tx_hash text,
  ADD COLUMN last_seen_run text;
--> statement-breakpoint
CREATE INDEX transactions_provider_hash_idx ON transactions (user_id, provider_tx_hash) WHERE provider_tx_hash IS NOT NULL;
--> statement-breakpoint
CREATE TABLE bank_connect_attempts (
  id text PRIMARY KEY,
  user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  connection_id text REFERENCES financial_connections(id) ON DELETE CASCADE,
  client_user_ref text NOT NULL UNIQUE,
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE bank_webhook_events (
  id text PRIMARY KEY,
  event_id text NOT NULL UNIQUE,
  event text NOT NULL,
  item_hash text,
  item_encrypted text,
  client_user_ref text,
  min_date date,
  tx_hashes jsonb,
  status text NOT NULL DEFAULT 'received',
  attempts integer NOT NULL DEFAULT 0,
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  last_error text,
  received_at timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX bank_webhook_events_queue_idx ON bank_webhook_events (status, next_attempt_at);
