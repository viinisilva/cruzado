// Linking what someone reported by message with the same payment arriving from the bank. Message ids stop
// redelivery; they say nothing about a statement. Without a shared id this only ever suggests: a person decides.
import { and, eq, gte, inArray, isNull } from "drizzle-orm";
import type { DB } from "@/db/connection";
import * as s from "@/db/schema";
import { audit } from "./audit";
import { addDays } from "./dates";
import { newId } from "./ids";
import { errorSummary } from "./log";

const DATE_TOLERANCE_DAYS = 2;
const BANK_SOURCES = ["csv", "ofx", "open_finance"] as const;
const ENTRY_SOURCES = ["assistant", "manual", "csv", "ofx"] as const;

/** Files are weaker evidence than the bank: a file only ever yields to a live bank row, a typed entry to either. */
const outranks = (bank: s.TransactionSource, entry: s.TransactionSource) => bank === "open_finance" || entry === "assistant" || entry === "manual";

/** One suggestion per entry and per bank row, closest date first, so two equal purchases stay two. */
export async function suggestMatches(db: DB, userId: string, today: string): Promise<number> {
  const t = s.transactions;
  const entries = await db.select().from(t).where(and(eq(t.userId, userId), inArray(t.source, [...ENTRY_SOURCES]), isNull(t.supersededBy), gte(t.date, addDays(today, -120))));
  if (!entries.length) return 0;
  const decided = await db.select().from(s.reconciliationMatches).where(eq(s.reconciliationMatches.userId, userId));
  const taken = new Set(decided.filter((m) => m.status !== "dismissed").flatMap((m) => [m.entryTxId, m.bankTxId]));
  const dismissed = new Set(decided.filter((m) => m.status === "dismissed").map((m) => `${m.entryTxId}|${m.bankTxId}`));
  const banks = await db.select().from(t).where(and(eq(t.userId, userId), inArray(t.source, [...BANK_SOURCES]), isNull(t.supersededBy), gte(t.date, addDays(today, -125))));
  let created = 0;
  for (const entry of entries) {
    if (taken.has(entry.id)) continue;
    const from = addDays(entry.date, -DATE_TOLERANCE_DAYS);
    const to = addDays(entry.date, DATE_TOLERANCE_DAYS);
    const best = banks
      .filter((b) => b.id !== entry.id && outranks(b.source, entry.source) && !taken.has(b.id) && !dismissed.has(`${entry.id}|${b.id}`) && b.accountId === entry.accountId && b.amountCents === entry.amountCents && b.date >= from && b.date <= to)
      .sort((a, b) => Math.abs(Date.parse(a.date) - Date.parse(entry.date)) - Math.abs(Date.parse(b.date) - Date.parse(entry.date)))[0];
    if (!best) continue;
    await db.insert(s.reconciliationMatches).values({ id: newId(), userId, entryTxId: entry.id, bankTxId: best.id }).onConflictDoNothing();
    taken.add(entry.id).add(best.id);
    created++;
  }
  return created;
}

/** Runs after imports: a failure here must not look like the import failed. */
export async function suggestMatchesSafely(db: DB, userId: string, today: string) {
  try {
    await suggestMatches(db, userId, today);
  } catch (e) {
    console.error("[reconcile]", errorSummary(e));
  }
}

export async function listMatches(db: DB, userId: string, status: "suggested" | "confirmed") {
  const entry = s.transactions;
  const rows = await db.select().from(s.reconciliationMatches).where(and(eq(s.reconciliationMatches.userId, userId), eq(s.reconciliationMatches.status, status)));
  if (!rows.length) return [];
  const txs = await db.select().from(entry).where(and(eq(entry.userId, userId), inArray(entry.id, rows.flatMap((m) => [m.entryTxId, m.bankTxId]))));
  return rows.flatMap((m) => {
    const a = txs.find((x) => x.id === m.entryTxId);
    const b = txs.find((x) => x.id === m.bankTxId);
    return a && b ? [{ id: m.id, entry: a, bank: b }] : [];
  });
}

async function matchOf(tx: Pick<DB, "select">, userId: string, id: string) {
  const [match] = await tx.select().from(s.reconciliationMatches).where(and(eq(s.reconciliationMatches.id, id), eq(s.reconciliationMatches.userId, userId)));
  return match;
}

/** The bank's row becomes the record. The entry stays stored for history, out of every total, and can come back. */
export async function confirmMatch(db: DB, userId: string, id: string, now: Date = new Date()) {
  await db.transaction(async (tx) => {
    const match = await matchOf(tx, userId, id);
    if (!match || match.status !== "suggested") throw new Error("Correspondência não encontrada.");
    const t = s.transactions;
    const [entry] = await tx.select().from(t).where(and(eq(t.id, match.entryTxId), eq(t.userId, userId)));
    const [bank] = await tx.select().from(t).where(and(eq(t.id, match.bankTxId), eq(t.userId, userId)));
    if (!entry || !bank || entry.supersededBy || bank.supersededBy) throw new Error("Correspondência não encontrada.");
    await tx.update(t).set({ supersededBy: bank.id }).where(eq(t.id, entry.id));
    // The category the person gave the entry is theirs: no automatic step may change it on the bank row.
    await tx.update(t).set({ paymentMethod: bank.paymentMethod ?? entry.paymentMethod, categoryId: entry.categoryId ?? bank.categoryId, ...(entry.categoryId ? { categorySource: "user" as const } : {}), notes: bank.notes ?? entry.notes }).where(eq(t.id, bank.id));
    await tx
      .update(s.reconciliationMatches)
      .set({ status: "confirmed", decidedAt: now, snapshot: { bank: { paymentMethod: bank.paymentMethod, categoryId: bank.categoryId, notes: bank.notes } } })
      .where(eq(s.reconciliationMatches.id, id));
    await audit(tx, userId, "reconciliation.confirmed", { matchId: id });
  });
}

export async function undoMatch(db: DB, userId: string, id: string, now: Date = new Date()) {
  await db.transaction(async (tx) => {
    const match = await matchOf(tx, userId, id);
    if (!match || match.status !== "confirmed") throw new Error("Correspondência não encontrada.");
    const before = (match.snapshot as { bank: { paymentMethod: s.PaymentMethod | null; categoryId: string | null; notes: string | null } }).bank;
    await tx.update(s.transactions).set({ supersededBy: null }).where(and(eq(s.transactions.id, match.entryTxId), eq(s.transactions.userId, userId)));
    await tx.update(s.transactions).set(before).where(and(eq(s.transactions.id, match.bankTxId), eq(s.transactions.userId, userId)));
    await tx.update(s.reconciliationMatches).set({ status: "dismissed", decidedAt: now }).where(eq(s.reconciliationMatches.id, id));
    await audit(tx, userId, "reconciliation.undone", { matchId: id });
  });
}

export async function dismissMatch(db: DB, userId: string, id: string, now: Date = new Date()) {
  await db.update(s.reconciliationMatches).set({ status: "dismissed", decidedAt: now }).where(and(eq(s.reconciliationMatches.id, id), eq(s.reconciliationMatches.userId, userId), eq(s.reconciliationMatches.status, "suggested")));
  await audit(db, userId, "reconciliation.dismissed", { matchId: id });
}

/** When a bank row disappears, any entry it replaced must count again instead of vanishing from the totals. */
export async function releaseSuperseded(tx: Pick<DB, "update">, userId: string, bankTxIds: string[]) {
  if (!bankTxIds.length) return;
  await tx.update(s.transactions).set({ supersededBy: null }).where(and(eq(s.transactions.userId, userId), inArray(s.transactions.supersededBy, bankTxIds)));
}
