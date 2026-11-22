-- 0001_init: initial schema. Mirrors src/db/schema.ts.
CREATE TABLE users (
  id text PRIMARY KEY,
  email text NOT NULL UNIQUE,
  name text NOT NULL,
  password_hash text NOT NULL,
  is_demo boolean NOT NULL DEFAULT false,
  ai_external_consent_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE sessions (
  id text PRIMARY KEY,
  user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX sessions_user_idx ON sessions(user_id);
--> statement-breakpoint
CREATE TABLE financial_connections (
  id text PRIMARY KEY,
  user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  connector text NOT NULL,
  label text NOT NULL,
  status text NOT NULL DEFAULT 'active',
  encrypted_token text,
  last_sync_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE accounts (
  id text PRIMARY KEY,
  user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  connection_id text REFERENCES financial_connections(id) ON DELETE SET NULL,
  external_id text,
  name text NOT NULL,
  institution text NOT NULL,
  type text NOT NULL CHECK (type IN ('checking','savings','credit_card','cash')),
  opening_balance_cents bigint NOT NULL DEFAULT 0,
  currency text NOT NULL DEFAULT 'BRL',
  archived boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX accounts_user_idx ON accounts(user_id);
--> statement-breakpoint
CREATE TABLE credit_cards (
  id text PRIMARY KEY,
  user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  account_id text NOT NULL UNIQUE REFERENCES accounts(id) ON DELETE CASCADE,
  limit_cents bigint NOT NULL,
  closing_day integer NOT NULL CHECK (closing_day BETWEEN 1 AND 31),
  due_day integer NOT NULL CHECK (due_day BETWEEN 1 AND 31),
  created_at timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE categories (
  id text PRIMARY KEY,
  user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name text NOT NULL,
  slug text NOT NULL,
  kind text NOT NULL CHECK (kind IN ('expense','income','transfer')),
  color text NOT NULL DEFAULT 'slate',
  created_at timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE UNIQUE INDEX categories_user_slug_uq ON categories(user_id, slug);
--> statement-breakpoint
CREATE TABLE transaction_imports (
  id text PRIMARY KEY,
  user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  account_id text NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  format text NOT NULL CHECK (format IN ('csv','ofx')),
  file_name text NOT NULL,
  file_sha256 text NOT NULL,
  rows_total integer NOT NULL,
  rows_imported integer NOT NULL,
  rows_skipped integer NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE transactions (
  id text PRIMARY KEY,
  user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  account_id text NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  category_id text REFERENCES categories(id) ON DELETE SET NULL,
  import_id text REFERENCES transaction_imports(id) ON DELETE SET NULL,
  date date NOT NULL,
  description text NOT NULL,
  merchant text NOT NULL,
  amount_cents bigint NOT NULL,
  installment_number integer,
  installment_total integer,
  source text NOT NULL,
  dedupe_key text NOT NULL,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE UNIQUE INDEX transactions_user_dedupe_uq ON transactions(user_id, dedupe_key);
--> statement-breakpoint
CREATE INDEX transactions_user_date_idx ON transactions(user_id, date);
--> statement-breakpoint
CREATE TABLE recurring_transactions (
  id text PRIMARY KEY,
  user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  account_id text REFERENCES accounts(id) ON DELETE CASCADE,
  category_id text REFERENCES categories(id) ON DELETE SET NULL,
  merchant text NOT NULL,
  label text NOT NULL,
  kind text NOT NULL,
  amount_cents bigint NOT NULL,
  next_date date NOT NULL,
  remaining_installments integer,
  last_transaction_id text,
  updated_at timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE UNIQUE INDEX recurring_user_merchant_uq ON recurring_transactions(user_id, merchant, kind);
--> statement-breakpoint
CREATE TABLE agent_rules (
  id text PRIMARY KEY,
  user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name text NOT NULL,
  kind text NOT NULL CHECK (kind IN ('daily_spend_limit','weekly_summary','possible_duplicate','monthly_comparison')),
  rule jsonb NOT NULL,
  status text NOT NULL CHECK (status IN ('draft','active','paused')),
  origin text NOT NULL,
  source_text text,
  last_run_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX agent_rules_user_idx ON agent_rules(user_id);
--> statement-breakpoint
CREATE TABLE agent_runs (
  id text PRIMARY KEY,
  user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  rule_id text NOT NULL REFERENCES agent_rules(id) ON DELETE CASCADE,
  period_key text NOT NULL,
  status text NOT NULL,
  summary jsonb,
  run_count integer NOT NULL DEFAULT 1,
  started_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz
);
--> statement-breakpoint
CREATE UNIQUE INDEX agent_runs_rule_period_uq ON agent_runs(rule_id, period_key);
--> statement-breakpoint
CREATE TABLE notifications (
  id text PRIMARY KEY,
  user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  rule_id text REFERENCES agent_rules(id) ON DELETE SET NULL,
  kind text NOT NULL,
  severity text NOT NULL CHECK (severity IN ('info','attention','risk')),
  title text NOT NULL,
  body text NOT NULL,
  links jsonb NOT NULL DEFAULT '[]'::jsonb,
  dedupe_key text NOT NULL,
  read_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE UNIQUE INDEX notifications_user_dedupe_uq ON notifications(user_id, dedupe_key);
--> statement-breakpoint
CREATE TABLE conversations (
  id text PRIMARY KEY,
  user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE messages (
  id text PRIMARY KEY,
  user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  conversation_id text NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  role text NOT NULL CHECK (role IN ('user','assistant')),
  content text NOT NULL,
  evidence jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX messages_conversation_idx ON messages(conversation_id, created_at);
--> statement-breakpoint
CREATE TABLE audit_events (
  id text PRIMARY KEY,
  user_id text,
  action text NOT NULL,
  meta jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX audit_user_idx ON audit_events(user_id);
--> statement-breakpoint
CREATE TABLE mcp_tokens (
  id text PRIMARY KEY,
  user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name text NOT NULL,
  token_hash text NOT NULL UNIQUE,
  prefix text NOT NULL,
  last_used_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE jobs (
  id text PRIMARY KEY,
  type text NOT NULL,
  payload jsonb NOT NULL,
  dedupe_key text NOT NULL UNIQUE,
  status text NOT NULL DEFAULT 'queued',
  attempts integer NOT NULL DEFAULT 0,
  run_at timestamptz NOT NULL DEFAULT now(),
  locked_at timestamptz,
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX jobs_status_run_idx ON jobs(status, run_at);
