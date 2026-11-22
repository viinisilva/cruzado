// Fixed-window rate limiter in PostgreSQL, shared by every serverless instance. There is no in-memory variant on
// purpose: on Vercel each instance would count alone, and a public link multiplies instances.
import { sql } from "drizzle-orm";
import type { DB } from "@/db/connection";

export const LIMITS = {
  chat: { max: 20, windowMs: 60_000 },
  import: { max: 10, windowMs: 60_000 },
  sync: { max: 5, windowMs: 60_000 },
  mcp: { max: 60, windowMs: 60_000 },
  mcpAuth: { max: 120, windowMs: 60_000 },
  capture: { max: 30, windowMs: 60 * 60_000 },
  whatsappReply: { max: 3, windowMs: 60 * 60_000 },
  whatsappCode: { max: 5, windowMs: 10 * 60_000 },
  auth: { max: 10, windowMs: 10 * 60_000 },
  authEmail: { max: 20, windowMs: 10 * 60_000 },
  demoGlobal: { max: 200, windowMs: 60 * 60_000 },
  demoChat: { max: 30, windowMs: 60 * 60_000 },
} as const;

// Override per kind, e.g. RATE_LIMIT_AUTH_MAX=100 (used by e2e tests).
const maxFor = (kind: keyof typeof LIMITS) => Number(process.env[`RATE_LIMIT_${kind.toUpperCase()}_MAX`]) || LIMITS[kind].max;

/** Client address as seen by the platform proxy (Vercel overwrites x-forwarded-for). */
export function clientIp(headers: Headers): string {
  return headers.get("x-forwarded-for")?.split(",")[0]?.trim() || headers.get("x-real-ip") || "local";
}

/** Fixed window, atomic in PostgreSQL so every instance sees the same count. */
export async function rateLimitShared(db: DB, kind: keyof typeof LIMITS, key: string, now = new Date()): Promise<{ ok: boolean; retryAfterSec: number }> {
  const resetAt = new Date(now.getTime() + LIMITS[kind].windowMs);
  const { rows } = await db.execute(sql`
    INSERT INTO rate_limits (key, count, reset_at) VALUES (${`${kind}:${key}`}, 1, ${resetAt})
    ON CONFLICT (key) DO UPDATE SET
      count = CASE WHEN rate_limits.reset_at <= ${now} THEN 1 ELSE rate_limits.count + 1 END,
      reset_at = CASE WHEN rate_limits.reset_at <= ${now} THEN ${resetAt} ELSE rate_limits.reset_at END
    RETURNING count, reset_at`);
  const row = rows[0] as { count: number; reset_at: string | Date };
  const ok = Number(row.count) <= maxFor(kind);
  return { ok, retryAfterSec: ok ? 0 : Math.ceil((new Date(row.reset_at).getTime() - now.getTime()) / 1000) };
}


export function tooMany(retryAfterSec: number): Response {
  return new Response(JSON.stringify({ error: "Muitas requisições. Tente novamente em instantes." }), {
    status: 429,
    headers: { "content-type": "application/json", "retry-after": String(retryAfterSec), "cache-control": "no-store" },
  });
}
