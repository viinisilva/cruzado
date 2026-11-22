// Database connection. PostgreSQL via DATABASE_URL (production / Docker Compose),
// or an embedded PGlite database on disk when DATABASE_URL is unset (local demo, no Docker).
import { drizzle as drizzlePg, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { drizzle as drizzlePglite } from "drizzle-orm/pglite";
import { mkdirSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import pg from "pg";
import { errorSummary } from "../lib/log";
import * as schema from "./schema";
import { runMigrations } from "./migrate";

// Both drivers expose the same query-builder API; we type against node-postgres.
export type DB = NodePgDatabase<typeof schema>;

type Holder = { db?: Promise<DB>; demoDay?: string };
const holder = globalThis as unknown as { __tostaoDb?: Holder };
holder.__tostaoDb ??= {};

/**
 * Preview and Development deployments can receive the production DATABASE_URL, and experimental code must never
 * change that schema. Migrations are applied by production or by hand.
 */
export const shouldAutoMigrate = (env: Record<string, string | undefined> = process.env) => env.SKIP_AUTO_MIGRATE !== "1" && env.VERCEL_ENV !== "preview" && env.VERCEL_ENV !== "development";

/** `loadDataDir` starts an in-memory PGlite from a dump (dumpDataDir) instead of running initdb, the slow part. */
export function createDb(options: { databaseUrl?: string; pgliteDir?: string; loadDataDir?: Blob } = {}): DB {
  if (options.databaseUrl) {
    // Serverless: many short-lived instances, so keep each pool tiny and fail fast. Use the provider's pooled URL.
    const serverless = Boolean(process.env.VERCEL);
    const pool = new pg.Pool({
      connectionString: options.databaseUrl,
      max: serverless ? 3 : 10,
      idleTimeoutMillis: serverless ? 10_000 : 30_000,
      connectionTimeoutMillis: 10_000,
    });
    // Idle clients can die while a function is frozen; without a listener this would crash the process.
    pool.on("error", (e) => console.error("[db]", errorSummary(e)));
    return drizzlePg(pool, { schema });
  }
  if (options.pgliteDir) mkdirSync(options.pgliteDir, { recursive: true });
  const client = options.loadDataDir ? new PGlite({ loadDataDir: options.loadDataDir }) : new PGlite(options.pgliteDir); // undefined dir = in-memory
  return drizzlePglite(client, { schema }) as unknown as DB;
}

export function getDb(): Promise<DB> {
  const h = holder.__tostaoDb!;
  // The demonstration's data is relative to the day it was created: a new day starts it over, so "this month" stays true.
  if (process.env.DEMO_INSTANCE === "1") {
    const day = new Date().toLocaleDateString("en-CA", { timeZone: "America/Sao_Paulo" });
    if (h.demoDay !== day) {
      const old = h.db;
      h.demoDay = day;
      h.db = undefined;
      // Frees yesterday's in-memory database once requests still using it are done.
      if (old) setTimeout(() => void old.then((d) => (d as unknown as { $client?: { close?: () => Promise<void> } }).$client?.close?.()).catch(() => undefined), 60_000).unref();
    }
  }
  h.db ??= (async () => {
    // Public demonstration (docs/USO_COMPARTILHADO.md): memory only, invented data, and no credentials allowed at all.
    const { isDemoInstance, assertDemoInstanceSafe } = await import("../lib/demo/instance-env");
    if (isDemoInstance()) {
      assertDemoInstanceSafe();
      const { bootDemoDatabase } = await import("../lib/demo/instance");
      const { readDemoSnapshot } = await import("../lib/demo/snapshot");
      const snapshot = await readDemoSnapshot();
      const { db, ms } = await bootDemoDatabase(new Date(), { snapshot });
      console.log("[demo] banco em memória pronto", JSON.stringify({ ms, snapshot: Boolean(snapshot) }));
      return db;
    }
    // PGlite needs a writable, persistent disk; on Vercel it would silently lose data.
    if (process.env.VERCEL && !process.env.DATABASE_URL) throw new Error("DATABASE_URL é obrigatória na Vercel.");
    const db = createDb({
      databaseUrl: process.env.DATABASE_URL || undefined,
      pgliteDir: process.env.DATABASE_URL ? undefined : (process.env.PGLITE_DIR ?? ".data/pglite"),
    });
    // Migrations are idempotent; applying them at boot keeps the self-hosted path one command.
    if (shouldAutoMigrate()) await runMigrations(db);
    return db;
  })().catch((e) => {
    // Do not cache a transient failure (e.g. database waking up) for the life of the instance.
    h.db = undefined;
    throw e;
  });
  return h.db;
}
