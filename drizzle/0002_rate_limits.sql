CREATE TABLE rate_limits (
  key text PRIMARY KEY,
  count integer NOT NULL,
  reset_at timestamptz NOT NULL
);
--> statement-breakpoint
CREATE INDEX rate_limits_reset_idx ON rate_limits (reset_at);
