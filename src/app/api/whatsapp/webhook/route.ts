// Meta Cloud API webhook. Answers fast: authenticates, stores durably, and only then works through the queue.
import { timingSafeEqual } from "node:crypto";
import { after } from "next/server";
import { getDb } from "@/db/client";
import { whatsappConfig } from "@/lib/whatsapp/config";
import { drainWhatsapp } from "@/lib/whatsapp/outbox";
import { MAX_WEBHOOK_BYTES, ingestEvent, validSignature } from "@/lib/whatsapp/webhook";
import { errorSummary } from "@/lib/log";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

const plain = (body: string, status: number) => new Response(body, { status, headers: { "content-type": "text/plain", "cache-control": "no-store" } });

function sameToken(a: string, b: string) {
  const [x, y] = [Buffer.from(a), Buffer.from(b)];
  return x.length === y.length && timingSafeEqual(x, y);
}

export async function GET(req: Request) {
  const cfg = whatsappConfig();
  const url = new URL(req.url);
  const challenge = url.searchParams.get("hub.challenge");
  if (!cfg || url.searchParams.get("hub.mode") !== "subscribe" || !challenge || !sameToken(url.searchParams.get("hub.verify_token") ?? "", cfg.verifyToken)) return plain("forbidden", 403);
  return plain(challenge, 200);
}

export async function POST(req: Request) {
  const cfg = whatsappConfig();
  if (!cfg) return plain("not configured", 503);
  if (Number(req.headers.get("content-length") ?? 0) > MAX_WEBHOOK_BYTES) return plain("too large", 413);
  const raw = await req.text();
  if (Buffer.byteLength(raw) > MAX_WEBHOOK_BYTES) return plain("too large", 413);
  // The signature covers these exact bytes, so nothing is parsed before it is checked.
  if (!validSignature(raw, req.headers.get("x-hub-signature-256"), cfg.appSecret)) return plain("invalid signature", 401);
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    return plain("invalid json", 400);
  }
  const db = await getDb();
  try {
    const result = await ingestEvent(db, json, cfg);
    if (!result) return plain("ignored", 200);
    // Only a speed-up: everything is already stored, and the scheduled endpoint picks up whatever this misses.
    if (result.stored) after(() => drainWhatsapp(db).catch((e) => console.error("[whatsapp-drain]", errorSummary(e))));
    return plain("ok", 200);
  } catch (e) {
    console.error("[whatsapp-webhook]", errorSummary(e));
    return plain("retry", 500);
  }
}
