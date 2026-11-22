// Durable work behind the Pluggy webhook. The route only stores the event; everything here runs from a queue that
// survives restarts. Events are hints: the provider is re-read before anything is believed, so order and repeats
// do not matter, and a repeated event converges to the same state.
import { and, asc, eq, inArray, isNotNull, isNull, lte, min, or, sql } from "drizzle-orm";
import { z } from "zod";
import type { DB } from "@/db/connection";
import * as s from "@/db/schema";
import { decryptSecret, encryptSecret, sha256Hex } from "../auth/crypto";
import { todayInSaoPaulo } from "../dates";
import { newId } from "../ids";
import { releaseSuperseded } from "../reconcile";
import { linkFromWebhook, providerHash, syncConnection } from "./open-finance";
import type { PluggyClient } from "./pluggy";
import { errorSummary } from "../log";

const MAX_ATTEMPTS = 5;
const HANDLED = /^(item|transactions)\//;

const Payload = z.object({
  event: z.string().max(80),
  eventId: z.string().min(1).max(200),
  itemId: z.string().max(80).nullish(),
  clientUserId: z.string().max(200).nullish(),
  transactionIds: z.array(z.string().max(80)).max(5000).nullish(),
  transactionsMinDate: z.string().max(40).nullish(),
});

/** Validates and stores. A repeated delivery hits the unique event id and stops here. */
export async function storeBankEvent(db: DB, json: unknown, now: Date = new Date()): Promise<"stored" | "duplicate" | "ignored" | "invalid"> {
  const parsed = Payload.safeParse(json);
  if (!parsed.success) return "invalid";
  const e = parsed.data;
  // Payment events do not apply: this product never starts one.
  if (!HANDLED.test(e.event)) return "ignored";
  const id = newId();
  const inserted = await db
    .insert(s.bankWebhookEvents)
    .values({
      id,
      eventId: e.eventId,
      event: e.event,
      itemHash: e.itemId ? sha256Hex(e.itemId) : null,
      itemEncrypted: e.itemId ? encryptSecret(e.itemId, `bank-event|${id}`) : null,
      clientUserRef: e.clientUserId ?? null,
      minDate: e.transactionsMinDate?.slice(0, 10).match(/^\d{4}-\d{2}-\d{2}$/)?.[0] ?? null,
      txHashes: e.transactionIds?.map(providerHash) ?? null,
      nextAttemptAt: now,
    })
    .onConflictDoNothing({ target: s.bankWebhookEvents.eventId })
    .returning({ id: s.bankWebhookEvents.id });
  return inserted.length ? "stored" : "duplicate";
}

async function requestSync(db: DB, connectionId: string, now: Date, resyncFrom?: string | null) {
  await db
    .update(s.financialConnections)
    .set({
      syncRequestedAt: now,
      ...(resyncFrom ? { resyncFrom: sql`LEAST(${s.financialConnections.resyncFrom}, ${resyncFrom}::date)` } : {}),
    })
    .where(eq(s.financialConnections.id, connectionId));
}

async function handleEvent(db: DB, client: PluggyClient, e: typeof s.bankWebhookEvents.$inferSelect, now: Date): Promise<"done" | "ignored"> {
  const t = s.transactions;
  const [conn] = e.itemHash ? await db.select().from(s.financialConnections).where(eq(s.financialConnections.externalHash, e.itemHash)) : [];
  if (!conn) {
    if (e.clientUserRef && e.itemEncrypted && (e.event === "item/created" || e.event === "item/updated")) {
      const linked = await linkFromWebhook(db, client, e.clientUserRef, decryptSecret(e.itemEncrypted, `bank-event|${e.id}`), now);
      return linked ? "done" : "ignored";
    }
    return "ignored";
  }
  switch (e.event) {
    case "item/deleted":
      await db.update(s.financialConnections).set({ status: "disconnected", statusDetail: "A conexão foi removida no provedor.", encryptedToken: null, externalHash: null, syncRequestedAt: null, syncCursor: null }).where(eq(s.financialConnections.id, conn.id));
      return "done";
    case "transactions/created":
      await requestSync(db, conn.id, now, e.minDate);
      return "done";
    case "transactions/updated": {
      // Changes can reach further back than the usual window: widen it to the oldest entry named.
      const [oldest] = e.txHashes?.length ? await db.select({ date: min(t.date) }).from(t).where(and(eq(t.userId, conn.userId), inArray(t.providerTxHash, e.txHashes))) : [];
      await requestSync(db, conn.id, now, oldest?.date);
      return "done";
    }
    case "transactions/deleted": {
      if (e.txHashes?.length) {
        const rows = await db.select({ id: t.id }).from(t).where(and(eq(t.userId, conn.userId), eq(t.source, "open_finance"), inArray(t.providerTxHash, e.txHashes)));
        const ids = rows.map((r) => r.id);
        if (ids.length) {
          await db.transaction(async (tx) => {
            await releaseSuperseded(tx, conn.userId, ids);
            await tx.delete(t).where(inArray(t.id, ids));
          });
        }
      }
      // Pluggy warns a deleted entry can return, and the balance must be re-derived either way.
      await requestSync(db, conn.id, now);
      return "done";
    }
    default:
      await requestSync(db, conn.id, now);
      return "done";
  }
}

/** Claiming pushes the retry time forward, so a worker that dies mid-event simply hands it to the next run. */
async function nextEvent(db: DB, now: Date) {
  const { rows } = await db.execute(sql`
    UPDATE bank_webhook_events SET attempts = attempts + 1, next_attempt_at = ${new Date(now.getTime() + 60_000)}
    WHERE id = (SELECT id FROM bank_webhook_events WHERE status = 'received' AND next_attempt_at <= ${now} ORDER BY received_at, id LIMIT 1 FOR UPDATE SKIP LOCKED)
    RETURNING id`);
  const id = (rows[0] as { id: string } | undefined)?.id;
  if (!id) return null;
  const [row] = await db.select().from(s.bankWebhookEvents).where(eq(s.bankWebhookEvents.id, id));
  return row ?? null;
}

/** Runs after the webhook answers, from the scheduled endpoint and from the worker. Safe to overlap. */
export async function processBankWork(db: DB, client: PluggyClient, opts: { budgetMs?: number; now?: () => Date } = {}) {
  const started = Date.now();
  const budget = opts.budgetMs ?? 25_000;
  const now = opts.now ?? (() => new Date());
  const left = () => budget - (Date.now() - started);
  let events = 0;
  let synced = 0;
  while (left() > 0) {
    const e = await nextEvent(db, now());
    if (!e) break;
    events++;
    try {
      const status = await handleEvent(db, client, e, now());
      await db.update(s.bankWebhookEvents).set({ status, lastError: null, itemEncrypted: null }).where(eq(s.bankWebhookEvents.id, e.id));
    } catch (err) {
      const message = errorSummary(err);
      console.error("[bank-event]", e.event, message);
      const giveUp = e.attempts >= MAX_ATTEMPTS;
      await db
        .update(s.bankWebhookEvents)
        .set({ status: giveUp ? "failed" : "received", lastError: message, ...(giveUp ? { itemEncrypted: null } : { nextAttemptAt: new Date(now().getTime() + 2 ** e.attempts * 60_000) }) })
        .where(eq(s.bankWebhookEvents.id, e.id));
    }
  }
  const due = await db
    .select()
    .from(s.financialConnections)
    .where(and(isNotNull(s.financialConnections.syncRequestedAt), isNotNull(s.financialConnections.encryptedToken), or(isNull(s.financialConnections.nextAttemptAt), lte(s.financialConnections.nextAttemptAt, now()))))
    .orderBy(asc(s.financialConnections.syncRequestedAt));
  for (const conn of due) {
    if (left() <= 0) break;
    const r = await syncConnection(db, client, conn, now(), { budgetMs: left() });
    if (r.status !== "busy") synced++;
  }
  return { events, synced, today: todayInSaoPaulo(now()) };
}
