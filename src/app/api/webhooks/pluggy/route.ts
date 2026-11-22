// Pluggy webhook. Pluggy does not sign deliveries: the only proof of origin is the secret header set when this
// webhook was registered (scripts/pluggy-webhook.ts). It must answer within 10 seconds, so it only stores the event.
import { createHash, timingSafeEqual } from "node:crypto";
import { after } from "next/server";
import { getDb } from "@/db/client";
import { processBankWork, storeBankEvent } from "@/lib/connectors/bank-work";
import { pluggyClientFromEnv } from "@/lib/connectors/pluggy";
import { errorSummary } from "@/lib/log";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

const MAX_BYTES = 64 * 1024;
const digest = (v: string) => createHash("sha256").update(v).digest();
const reply = (body: string, status: number) => new Response(body, { status, headers: { "content-type": "text/plain", "cache-control": "no-store" } });

export async function POST(req: Request) {
  const secret = process.env.PLUGGY_WEBHOOK_SECRET;
  if (!secret || !process.env.PLUGGY_CLIENT_ID) return reply("not configured", 503);
  if (!timingSafeEqual(digest(req.headers.get("authorization") ?? ""), digest(`Bearer ${secret}`))) return reply("unauthorized", 401);
  const raw = await req.text();
  if (Buffer.byteLength(raw) > MAX_BYTES) return reply("too large", 413);
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    return reply("invalid json", 400);
  }
  const db = await getDb();
  try {
    const result = await storeBankEvent(db, json);
    if (result === "invalid") return reply("invalid", 400);
    // Only a speed-up: the event is stored, and the scheduled endpoint picks up whatever this misses.
    if (result === "stored") after(() => processBankWork(db, pluggyClientFromEnv()).catch((e) => console.error("[bank-work]", errorSummary(e))));
    return reply("ok", 200);
  } catch (e) {
    console.error("[bank-webhook]", errorSummary(e));
    return reply("retry", 500);
  }
}
