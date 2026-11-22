ALTER TABLE financial_connections ADD COLUMN external_hash text;
--> statement-breakpoint
ALTER TABLE financial_connections ADD COLUMN status_detail text;
--> statement-breakpoint
ALTER TABLE financial_connections ADD COLUMN consent_expires_at timestamptz;
--> statement-breakpoint
CREATE UNIQUE INDEX financial_connections_external_uq ON financial_connections (external_hash);
