// Inbound events: authenticate the raw bytes, then store durably. No interpretation happens here.
import { createHmac, timingSafeEqual } from "node:crypto";
import { eq } from "drizzle-orm";
import { z } from "zod";
import type { DB } from "@/db/connection";
import * as s from "@/db/schema";
import { encryptSecret } from "../auth/crypto";
import { newId } from "../ids";
import { senderHash, type WhatsappConfig } from "./config";

export const MAX_WEBHOOK_BYTES = 256 * 1024;

export function validSignature(rawBody: string, header: string | null, appSecret: string): boolean {
  if (!header?.startsWith("sha256=")) return false;
  const expected = Buffer.from(createHmac("sha256", appSecret).update(rawBody, "utf8").digest("hex"));
  const given = Buffer.from(header.slice("sha256=".length));
  return given.length === expected.length && timingSafeEqual(given, expected);
}

const Message = z.object({
  id: z.string().min(1).max(200),
  from: z.string().regex(/^\d{6,20}$/),
  timestamp: z.string().regex(/^\d{1,12}$/),
  type: z.string().max(40),
  text: z.object({ body: z.string().max(4096) }).optional(),
  interactive: z.object({ button_reply: z.object({ id: z.string().max(256) }).optional() }).optional(),
  context: z.object({ id: z.string().max(200).optional() }).optional(),
});

const Status = z.object({ id: z.string().max(200), status: z.string().max(40), errors: z.array(z.object({ code: z.number().optional() })).optional() });

const Payload = z.object({
  object: z.string().optional(),
  entry: z.array(
    z.object({
      changes: z.array(
        z.object({
          value: z.object({
            metadata: z.object({ phone_number_id: z.string().max(40) }).optional(),
            messages: z.array(Message).max(100).optional(),
            statuses: z.array(Status).max(100).optional(),
          }),
        }),
      ),
    }),
  ),
});

export type IngestResult = { stored: number; duplicates: number; statuses: number; skipped: number };

/** Throws only on storage failure, so the route can answer with an error and Meta retries. */
export async function ingestEvent(db: DB, json: unknown, cfg: WhatsappConfig): Promise<IngestResult | null> {
  const parsed = Payload.safeParse(json);
  if (!parsed.success) return null;
  const result: IngestResult = { stored: 0, duplicates: 0, statuses: 0, skipped: 0 };
  for (const entry of parsed.data.entry) {
    for (const { value } of entry.changes) {
      // Events for another number must never act on this instance's users.
      if (value.metadata?.phone_number_id !== cfg.phoneNumberId) {
        result.skipped += (value.messages?.length ?? 0) + (value.statuses?.length ?? 0);
        continue;
      }
      for (const st of value.statuses ?? []) {
        // Delivery receipts only update the outgoing record; they can never create a transaction.
        await db
          .update(s.whatsappOutbox)
          .set({ deliveryStatus: st.status, ...(st.errors?.[0]?.code ? { lastError: `meta:${st.errors[0].code}` } : {}) })
          .where(eq(s.whatsappOutbox.providerMessageId, st.id));
        result.statuses++;
      }
      for (const m of value.messages ?? []) {
        const button = m.interactive?.button_reply?.id;
        const kind = button ? "button" : m.type === "text" && m.text ? "text" : "unsupported";
        const body = button ?? m.text?.body;
        const inserted = await db
          .insert(s.whatsappInbox)
          .values({
            id: newId(),
            phoneNumberId: cfg.phoneNumberId,
            wamid: m.id,
            senderHash: senderHash(m.from),
            senderEncrypted: encryptSecret(m.from, `wa-sender|${m.id}`),
            eventAt: new Date(Number(m.timestamp) * 1000),
            nextAttemptAt: new Date(Number(m.timestamp) * 1000),
            kind,
            bodyEncrypted: body ? encryptSecret(body, `wa-body|${m.id}`) : null,
            contextId: m.context?.id ?? null,
          })
          .onConflictDoNothing({ target: [s.whatsappInbox.provider, s.whatsappInbox.phoneNumberId, s.whatsappInbox.wamid] })
          .returning({ id: s.whatsappInbox.id });
        if (inserted.length) result.stored++;
        else result.duplicates++;
      }
    }
  }
  return result;
}
