// Outgoing replies, sent outside any database transaction. Delivery is at-least-attempted, never exactly once;
// the guarantee that matters (one financial record per event) already holds by the time anything is sent here.
import { eq, sql } from "drizzle-orm";
import type { DB } from "@/db/connection";
import * as s from "@/db/schema";
import { decryptSecret } from "../auth/crypto";
import { whatsappConfig, type WhatsappConfig } from "./config";
import { processNext } from "./processor";

const TIMEOUT_MS = 10_000;
const MAX_ATTEMPTS = 5;
const SEND_LEASE_MS = 60_000;

export type SendResult = { kind: "sent"; id: string } | { kind: "retry"; error: string } | { kind: "failed"; error: string } | { kind: "uncertain"; error: string };
export type Sender = (to: string, payload: { text: string; buttons?: { id: string; title: string }[] }) => Promise<SendResult>;

export function graphSender(cfg: WhatsappConfig, fetchImpl: typeof fetch = fetch): Sender | null {
  if (!cfg.accessToken || !cfg.graphVersion) return null;
  const url = `https://graph.facebook.com/${cfg.graphVersion}/${cfg.phoneNumberId}/messages`;
  return async (to, payload) => {
    const content = payload.buttons?.length
      ? { type: "interactive", interactive: { type: "button", body: { text: payload.text.slice(0, 1024) }, action: { buttons: payload.buttons.map((b) => ({ type: "reply", reply: { id: b.id, title: b.title.slice(0, 20) } })) } } }
      : { type: "text", text: { body: payload.text.slice(0, 4096) } };
    let res: Response;
    try {
      res = await fetchImpl(url, {
        method: "POST",
        headers: { authorization: `Bearer ${cfg.accessToken}`, "content-type": "application/json" },
        body: JSON.stringify({ messaging_product: "whatsapp", to, ...content }),
        redirect: "error",
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch {
      // The request may have been accepted before the connection dropped: resending could repeat the message.
      return { kind: "uncertain", error: "sem resposta do provedor" };
    }
    if (res.ok) {
      const body = (await res.json().catch(() => null)) as { messages?: { id?: string }[] } | null;
      const id = body?.messages?.[0]?.id;
      return id ? { kind: "sent", id } : { kind: "uncertain", error: "resposta sem id" };
    }
    if (res.status === 429 || res.status >= 500) return { kind: "retry", error: `HTTP ${res.status}` };
    return { kind: "failed", error: `HTTP ${res.status}` };
  };
}

export async function sendNext(db: DB, send: Sender, now: Date = new Date()): Promise<boolean> {
  // A send that never reported back (crashed worker) is uncertain, not failed: do not repeat it blindly.
  await db.execute(sql`UPDATE whatsapp_outbox SET status = 'unknown', last_error = 'envio interrompido' WHERE status = 'sending' AND locked_until < ${now}`);
  const { rows } = await db.execute(sql`
    UPDATE whatsapp_outbox SET status = 'sending', attempts = attempts + 1, locked_until = ${new Date(now.getTime() + SEND_LEASE_MS)}
    WHERE id = (SELECT id FROM whatsapp_outbox WHERE status = 'pending' AND next_attempt_at <= ${now} ORDER BY created_at, id LIMIT 1 FOR UPDATE SKIP LOCKED)
    RETURNING id, inbox_id, to_encrypted, payload, attempts, not_after`);
  const job = rows[0] as { id: string; inbox_id: string; to_encrypted: string; payload: Parameters<Sender>[1]; attempts: number; not_after: string | Date } | undefined;
  if (!job) return false;
  const finish = (set: Partial<typeof s.whatsappOutbox.$inferInsert>) => db.update(s.whatsappOutbox).set({ lockedUntil: null, ...set }).where(eq(s.whatsappOutbox.id, job.id));
  // Past the 24-hour service window a free-form reply is not allowed.
  if (new Date(job.not_after).getTime() <= now.getTime()) {
    await finish({ status: "expired" });
    return true;
  }
  const result = await send(decryptSecret(job.to_encrypted, `wa-to|${job.inbox_id}`), job.payload);
  if (result.kind === "sent") await finish({ status: "sent", providerMessageId: result.id, lastError: null });
  else if (result.kind === "uncertain") await finish({ status: "unknown", lastError: result.error });
  else if (result.kind === "failed" || job.attempts >= MAX_ATTEMPTS) await finish({ status: "failed", lastError: result.error });
  else await finish({ status: "pending", lastError: result.error, nextAttemptAt: new Date(now.getTime() + 2 ** job.attempts * 1000) });
  return true;
}

/** Runs from the webhook (after the response), the scheduled endpoint and the worker. Safe to run concurrently. */
export async function drainWhatsapp(db: DB, opts: { budgetMs?: number; send?: Sender | null; now?: () => Date } = {}) {
  const started = Date.now();
  const budget = opts.budgetMs ?? 20_000;
  const now = opts.now ?? (() => new Date());
  const cfg = whatsappConfig();
  const send = opts.send !== undefined ? opts.send : cfg ? graphSender(cfg) : null;
  let processed = 0;
  let sent = 0;
  while (Date.now() - started < budget && (await processNext(db, now()))) processed++;
  // Without credentials replies wait in the queue; the entries are already safe.
  if (send) while (Date.now() - started < budget && (await sendNext(db, send, now()))) sent++;
  return { processed, sent };
}
