// Retries stuck WhatsApp messages and replies. Must be called every minute by an external scheduler
// (see docs/WHATSAPP.md): the daily Vercel cron alone is not enough for a conversation.
import { createHash, timingSafeEqual } from "node:crypto";
import { getDb } from "@/db/client";
import { json } from "@/lib/api";
import { drainWhatsapp } from "@/lib/whatsapp/outbox";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const digest = (v: string) => createHash("sha256").update(v).digest();

export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || !timingSafeEqual(digest(req.headers.get("authorization") ?? ""), digest(`Bearer ${secret}`))) return json({ error: "Não autorizado." }, 401);
  return json(await drainWhatsapp(await getDb(), { budgetMs: 45_000 }));
}
