ALTER TABLE users ADD COLUMN totp_secret text;
--> statement-breakpoint
ALTER TABLE users ADD COLUMN totp_enabled_at timestamptz;
--> statement-breakpoint
ALTER TABLE users ADD COLUMN totp_last_step bigint;
--> statement-breakpoint
ALTER TABLE mcp_tokens ADD COLUMN expires_at timestamptz;
--> statement-breakpoint
UPDATE mcp_tokens SET expires_at = now() + interval '90 days';
