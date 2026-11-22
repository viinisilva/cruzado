// Minimal versioned migration runner: applies drizzle/NNNN_*.sql in order, once each.
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { sql } from "drizzle-orm";
import type { DB } from "./connection";

// Resolved at runtime; the Docker image copies drizzle/ next to the server and next.config.ts traces it for Vercel.
const MIGRATIONS_DIR = process.env.MIGRATIONS_DIR ?? path.join(/* turbopackIgnore: true */ process.cwd(), "drizzle");
// Arbitrary constant: serializes cold starts applying migrations to a fresh database.
const MIGRATION_LOCK = 7_260_001;

export async function runMigrations(db: DB): Promise<string[]> {
  const files = (await readdir(MIGRATIONS_DIR)).filter((f) => /^\d{4}_.+\.sql$/.test(f)).sort();
  return db.transaction(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(${MIGRATION_LOCK})`);
    await tx.execute(
      sql`CREATE TABLE IF NOT EXISTS _migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())`,
    );
    const applied = new Set(
      ((await tx.execute(sql`SELECT name FROM _migrations`)).rows as { name: string }[]).map((r) => r.name),
    );
    const done: string[] = [];
    for (const file of files) {
      if (applied.has(file)) continue;
      const text = await readFile(path.join(MIGRATIONS_DIR, file), "utf8");
      const statements = text
        .split("--> statement-breakpoint")
        .map((s) => s.trim())
        .filter(Boolean);
      for (const stmt of statements) await tx.execute(sql.raw(stmt));
      await tx.execute(sql`INSERT INTO _migrations (name) VALUES (${file})`);
      done.push(file);
    }
    return done;
  });
}
