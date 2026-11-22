ALTER TABLE transactions ADD COLUMN payment_method text;
--> statement-breakpoint
ALTER TABLE transactions ADD COLUMN channel text;
--> statement-breakpoint
ALTER TABLE transactions ADD COLUMN superseded_by text;
--> statement-breakpoint
CREATE INDEX transactions_user_active_idx ON transactions (user_id, date DESC, id) WHERE superseded_by IS NULL;
--> statement-breakpoint
CREATE TABLE whatsapp_links (
  id text PRIMARY KEY,
  user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  wa_hash text,
  wa_encrypted text,
  phone_masked text,
  status text NOT NULL DEFAULT 'pending',
  default_account_id text REFERENCES accounts(id) ON DELETE SET NULL,
  mode text NOT NULL DEFAULT 'auto',
  confirmed_at timestamptz,
  last_activity_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE UNIQUE INDEX whatsapp_links_user_uq ON whatsapp_links (user_id) WHERE status <> 'disabled';
--> statement-breakpoint
CREATE UNIQUE INDEX whatsapp_links_sender_uq ON whatsapp_links (wa_hash) WHERE wa_hash IS NOT NULL;
--> statement-breakpoint
CREATE TABLE whatsapp_link_codes (
  id text PRIMARY KEY,
  user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  code_hash text NOT NULL UNIQUE,
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE whatsapp_inbox (
  id text PRIMARY KEY,
  provider text NOT NULL DEFAULT 'meta',
  phone_number_id text NOT NULL,
  wamid text NOT NULL,
  sender_hash text NOT NULL,
  sender_encrypted text,
  event_at timestamptz NOT NULL,
  received_at timestamptz NOT NULL DEFAULT now(),
  kind text NOT NULL,
  body_encrypted text,
  context_id text,
  status text NOT NULL DEFAULT 'received',
  attempts integer NOT NULL DEFAULT 0,
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  last_error text,
  transaction_id text,
  link_id text
);
--> statement-breakpoint
CREATE UNIQUE INDEX whatsapp_inbox_event_uq ON whatsapp_inbox (provider, phone_number_id, wamid);
--> statement-breakpoint
CREATE INDEX whatsapp_inbox_pending_idx ON whatsapp_inbox (status, next_attempt_at);
--> statement-breakpoint
CREATE TABLE whatsapp_drafts (
  id text PRIMARY KEY,
  link_id text NOT NULL REFERENCES whatsapp_links(id) ON DELETE CASCADE,
  user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'open',
  fields jsonb NOT NULL,
  target_transaction_id text,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX whatsapp_drafts_open_uq ON whatsapp_drafts (link_id) WHERE status = 'open';
--> statement-breakpoint
CREATE TABLE whatsapp_outbox (
  id text PRIMARY KEY,
  inbox_id text NOT NULL UNIQUE,
  to_encrypted text NOT NULL,
  payload jsonb NOT NULL,
  status text NOT NULL DEFAULT 'pending',
  attempts integer NOT NULL DEFAULT 0,
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  locked_until timestamptz,
  not_after timestamptz NOT NULL,
  provider_message_id text,
  delivery_status text,
  last_error text,
  transaction_id text,
  created_at timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX whatsapp_outbox_pending_idx ON whatsapp_outbox (status, next_attempt_at);
--> statement-breakpoint
CREATE INDEX whatsapp_outbox_provider_idx ON whatsapp_outbox (provider_message_id);
--> statement-breakpoint
CREATE TABLE reconciliation_matches (
  id text PRIMARY KEY,
  user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  entry_tx_id text NOT NULL REFERENCES transactions(id) ON DELETE CASCADE,
  bank_tx_id text NOT NULL REFERENCES transactions(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'suggested',
  snapshot jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  decided_at timestamptz
);
--> statement-breakpoint
CREATE UNIQUE INDEX reconciliation_pair_uq ON reconciliation_matches (entry_tx_id, bank_tx_id);
