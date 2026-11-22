// Applies what the evidence classifier and the reconciler decided, with a record of every change so each one can be
// undone (docs/AUTOCONCILIACAO.md). Rules that protect the person's data:
// - a category the person chose (category_source = "user") is never changed;
// - rows stored before this existed (category_source null) are only ever *proposed*, for review;
// - bills closed before the card was first reconciled are only proposed too;
// - the reconciler acts alone only on a unique answer whose every change has evidence beyond the arithmetic.
import { and, desc, eq, gte, inArray, lt, ne, sql } from "drizzle-orm";
import type { DB } from "@/db/connection";
import * as s from "@/db/schema";
import { addDays, todayInSaoPaulo } from "./dates";
import { newId } from "./ids";
import { loadCards, loadCategories, loadTransactions } from "./data/repo";
import { classifyCardCredits, creditPattern, type Classification, type CreditKind, type LearnedSignal } from "./finance/classify";
import type { CardCalibration, Divergence } from "./finance/cycles";
import type { FinCategory, FinTx } from "./finance/core";

/** Existing data is reviewed back to this far; older rows are left as they are. */
const REVIEW_DAYS = 365;

type Cats = { bill: string | null; fallback: string | null; byId: Map<string, FinCategory> };
const catsOf = (categories: FinCategory[]): Cats => ({
  bill: categories.find((c) => c.slug === "pagamento-fatura")?.id ?? null,
  fallback: categories.find((c) => c.slug === "outras-despesas")?.id ?? null,
  byId: new Map(categories.map((c) => [c.id, c])),
});

/** Where a credit of this kind belongs. A refund takes the purchase's category, so it lowers that spending. */
export function categoryFor(c: Classification, txs: FinTx[], cats: Cats): string | null {
  if (c.kind === "payment") return cats.bill;
  if (c.kind === "refund" && c.matchedTxId) {
    const bought = txs.find((t) => t.id === c.matchedTxId)?.categoryId;
    if (bought && cats.byId.get(bought)?.kind === "expense") return bought;
  }
  return cats.fallback;
}

const confidencePoints = (evidence: number, contradictions: number): 0 | 2 | 3 => (contradictions > 0 ? 0 : evidence >= 2 ? 3 : evidence === 1 ? 2 : 0);

async function learnedSignals(db: DB, userId: string, institution: string): Promise<LearnedSignal[]> {
  const rows = await db.select().from(s.reconciliationRules).where(and(eq(s.reconciliationRules.userId, userId), eq(s.reconciliationRules.institution, institution)));
  return rows.flatMap((r) => {
    const points = confidencePoints(r.evidence, r.contradictions);
    const kind = r.change.replace(/^to-/, "") as CreditKind;
    return points ? [{ pattern: r.pattern, kind: kind === "payment" ? "payment" : "refund", points }] : [];
  });
}

async function cashDebits(db: DB, userId: string, today: string) {
  const t = s.transactions;
  return db
    .select({ amountCents: t.amountCents, date: t.date })
    .from(t)
    .innerJoin(s.accounts, eq(s.accounts.id, t.accountId))
    .where(and(eq(t.userId, userId), ne(s.accounts.type, "credit_card"), lt(t.amountCents, 0), gte(t.date, addDays(today, -REVIEW_DAYS))));
}

type ChangeRow = typeof s.reconciliationChanges.$inferInsert;

async function record(db: DB, row: Omit<ChangeRow, "id">) {
  await db.insert(s.reconciliationChanges).values({ id: newId(), ...row });
}

type Open = Map<string, { id: string; target: string | null; status: string; source: string }[]>;

/** Proposals waiting for review and dismissed ones, per entry of one card, loaded once per run. */
async function openHistory(db: DB, accountId: string): Promise<Open> {
  const c = s.reconciliationChanges;
  const rows = await db.select({ id: c.id, txId: c.transactionId, after: c.after, status: c.status, source: c.source }).from(c).where(and(eq(c.accountId, accountId), inArray(c.status, ["proposed", "dismissed"])));
  const out: Open = new Map();
  for (const r of rows) out.set(r.txId, [...(out.get(r.txId) ?? []), { id: r.id, target: (r.after as { categoryId?: string | null }).categoryId ?? null, status: r.status, source: r.source }]);
  return out;
}

/** Whether this exact change is waiting for review or was dismissed: never ask twice. A past application does not count, the category may have changed since. */
const alreadyRecorded = (open: Open, txId: string, target: string | null) => (open.get(txId) ?? []).some((r) => r.target === target);

/**
 * The classifier's own open proposals for an entry that no longer match what the evidence says are retired, so the
 * report never lists them. The reconciler's proposals disagree with the classification on purpose and stay.
 */
async function retireStale(db: DB, open: Open, txId: string, keep: string | null) {
  const stale = (open.get(txId) ?? []).filter((r) => r.status === "proposed" && r.source === "evidence" && r.target !== keep).map((r) => r.id);
  if (stale.length) await db.update(s.reconciliationChanges).set({ status: "dismissed" }).where(inArray(s.reconciliationChanges.id, stale));
}

/**
 * Classifies every credit of a card and acts on it: new rows change (with a record), old rows get a proposal, the
 * person's choices stay. Returns what changed, for the logs.
 */
export async function classifyCardAccount(db: DB, userId: string, accountId: string, institution: string, today: string) {
  const [cards, txs, categories, learned, debits] = await Promise.all([
    loadCards(db, userId),
    loadTransactions(db, userId, { accountIds: [accountId], includeFuture: true, today }),
    loadCategories(db, userId),
    learnedSignals(db, userId, institution),
    cashDebits(db, userId, today),
  ]);
  const open = await openHistory(db, accountId);
  const card = cards.find((c) => c.accountId === accountId);
  const cats = catsOf(categories);
  const decided = classifyCardCredits({ card: { accountId, bills: card?.bills }, txs, cashDebits: debits, learned, today });
  let applied = 0;
  let proposed = 0;
  for (const t of txs) {
    const c = decided.get(t.id);
    if (!c) continue;
    const same = t.classification && t.classification.kind === c.kind && t.classification.reason === c.reason && t.classification.matchedTxId === c.matchedTxId;
    if (!same) await db.update(s.transactions).set({ classification: c }).where(eq(s.transactions.id, t.id));
    const target = categoryFor(c, txs, cats);
    if (t.categorySource === "user" || t.categorySource === "reconciler" || !target || target === t.categoryId) {
      await retireStale(db, open, t.id, null);
      continue;
    }
    await retireStale(db, open, t.id, target);
    const reason = `classificação: ${c.reason}`;
    if (t.categorySource === null || t.categorySource === undefined) {
      if (t.date < addDays(today, -REVIEW_DAYS) || alreadyRecorded(open, t.id, target)) continue;
      await record(db, { userId, accountId, billRef: t.billRef ?? null, transactionId: t.id, kind: "category", before: { categoryId: t.categoryId, categorySource: null }, after: { categoryId: target, kind: c.kind }, reason, source: "evidence", status: "proposed" });
      proposed++;
      continue;
    }
    await db.update(s.transactions).set({ categoryId: target, categorySource: "evidence" }).where(eq(s.transactions.id, t.id));
    await record(db, { userId, accountId, billRef: t.billRef ?? null, transactionId: t.id, kind: "category", before: { categoryId: t.categoryId, categorySource: t.categorySource }, after: { categoryId: target, kind: c.kind }, reason, source: "evidence", status: "applied" });
    applied++;
  }
  return { applied, proposed };
}

const gapBucket = (cents: number) => (Math.abs(cents) <= 100 ? "<=1" : Math.abs(cents) <= 1000 ? "<=10" : Math.abs(cents) <= 10000 ? "<=100" : ">100");

/**
 * Acts on the reconciler's answers in a fresh calibration. A unique answer with evidence on every change is applied
 * for bills closed since the card was first reconciled, and proposed for older ones (up to a year). Returns true when
 * something changed, so the caller learns the card again.
 */
export async function reconcileCard(db: DB, userId: string, accountId: string, institution: string, calibration: CardCalibration, today: string): Promise<boolean> {
  const since = calibration.reconcilerSince ?? today;
  const [txs, categories] = await Promise.all([loadTransactions(db, userId, { accountIds: [accountId], includeFuture: true, today }), loadCategories(db, userId)]);
  const cats = catsOf(categories);
  const open = await openHistory(db, accountId);
  let changed = false;
  for (const d of calibration.divergences) {
    const fresh = (d.closing ?? d.dueDate) >= since;
    const automatic = d.solver?.outcome === "solved" && d.solver.auto;
    // A unique answer is applied (fresh bill) or proposed (the dry run over older bills); one that rests on arithmetic
    // alone stays a suggestion on Conferir.
    await logEvent(db, userId, institution, d, !d.solver ? "matched" : automatic ? (fresh ? "auto-applied" : "proposed") : d.solver.outcome === "solved" ? "suggested" : d.solver.outcome);
    if (!automatic) continue;
    if (!fresh && (d.closing ?? d.dueDate) < addDays(today, -REVIEW_DAYS)) continue;
    for (const step of d.solver!.combos[0]!) {
      const t = txs.find((x) => x.id === step.txId);
      if (!t || t.categorySource === "user") continue;
      // A credit leaving the payments lowers the bill like a refund: the purchase's category when one was paired.
      const target = step.change === "to-payment" ? cats.bill : t.classification ? categoryFor({ ...t.classification, kind: "refund" }, txs, cats) : cats.fallback;
      if (!target || target === t.categoryId || alreadyRecorded(open, t.id, target)) continue;
      const pattern = creditPattern(t, t.classification?.signals ?? []);
      const rule = fresh && t.categorySource !== null && t.categorySource !== undefined ? await learnRule(db, userId, institution, pattern, step.change) : null;
      const row = { userId, accountId, billRef: d.billRef ?? null, transactionId: t.id, kind: "category" as const, before: { categoryId: t.categoryId, categorySource: t.categorySource ?? null }, after: { categoryId: target, change: step.change }, reason: `fatura de ${d.dueDate.slice(0, 7)} fechou ao centavo com esta mudança`, source: "reconciler" as const, ruleId: rule };
      // Old bills, and rows from before category sources existed, are the dry run: proposed, never applied alone.
      if (!fresh || t.categorySource === null || t.categorySource === undefined) {
        await record(db, { ...row, status: "proposed" });
        continue;
      }
      await db.update(s.transactions).set({ categoryId: target, categorySource: "reconciler" }).where(eq(s.transactions.id, t.id));
      await record(db, { ...row, status: "applied" });
      changed = true;
    }
  }
  return changed;
}

async function learnRule(db: DB, userId: string, institution: string, pattern: string, change: string): Promise<string> {
  const id = newId();
  const [row] = await db
    .insert(s.reconciliationRules)
    .values({ id, userId, institution, pattern, change, evidence: 1 })
    .onConflictDoUpdate({ target: [s.reconciliationRules.userId, s.reconciliationRules.institution, s.reconciliationRules.pattern, s.reconciliationRules.change], set: { evidence: sql`${s.reconciliationRules.evidence} + 1`, updatedAt: new Date() } })
    .returning({ id: s.reconciliationRules.id });
  return row!.id;
}

export type EventOutcome = "matched" | "auto-applied" | "proposed" | "suggested" | "ambiguous" | "unsolved" | "resolved";

/**
 * One row per bill and outcome: a bill that keeps the same outcome is not logged again. No amounts, no text. A bill
 * that matches after the reconciler fixed it keeps that label; after any other problem it is "resolved" (by the person).
 */
async function logEvent(db: DB, userId: string, institution: string, d: Divergence, wanted: EventOutcome) {
  const billMonth = d.dueDate.slice(0, 7);
  const e = s.reconciliationEvents;
  const [last] = await db.select({ outcome: e.outcome }).from(e).where(and(eq(e.userId, userId), eq(e.institution, institution), eq(e.billMonth, billMonth))).orderBy(desc(e.createdAt)).limit(1);
  const outcome: EventOutcome = wanted === "matched" && last && last.outcome !== "matched" ? (last.outcome === "auto-applied" || last.outcome === "resolved" ? last.outcome : "resolved") : wanted;
  if (last?.outcome === outcome) return;
  const kinds = [...new Set((d.solver?.combos[0] ?? []).map((c) => c.change))];
  await db.insert(e).values({ id: newId(), userId, institution, billMonth, outcome, changeKinds: kinds, gapBucket: gapBucket(d.bankCents - d.computedCents) });
  console.log("[reconciliation]", JSON.stringify({ institution, outcome, kinds, gap: gapBucket(d.bankCents - d.computedCents) }));
}

/** A bill that closed to the cent also counts, once, so the health page shows the share that needed nothing. */
export async function logMatched(db: DB, userId: string, institution: string, billMonths: string[]) {
  for (const m of billMonths) await logEvent(db, userId, institution, { dueDate: `${m}-01`, bankCents: 0, computedCents: 0, reason: "missing-entries", amountCents: 0 }, "matched");
}

/** The person applies a proposal: the category becomes theirs. */
export async function applyChange(db: DB, userId: string, changeId: string) {
  const [c] = await db.select().from(s.reconciliationChanges).where(and(eq(s.reconciliationChanges.id, changeId), eq(s.reconciliationChanges.userId, userId)));
  if (!c || c.status !== "proposed") return false;
  // A proposal is only valid for the state it was made from: if the person chose a category since, or the entry moved,
  // it is retired instead of overwriting anything.
  const [now] = await db.select({ categoryId: s.transactions.categoryId, categorySource: s.transactions.categorySource }).from(s.transactions).where(and(eq(s.transactions.id, c.transactionId), eq(s.transactions.userId, userId)));
  if (!now || now.categorySource === "user" || now.categoryId !== (c.before as { categoryId: string | null }).categoryId) {
    await db.update(s.reconciliationChanges).set({ status: "dismissed" }).where(eq(s.reconciliationChanges.id, c.id));
    return false;
  }
  await db.transaction(async (tx) => {
    await tx.update(s.transactions).set({ categoryId: (c.after as { categoryId: string }).categoryId, categorySource: "user" }).where(and(eq(s.transactions.id, c.transactionId), eq(s.transactions.userId, userId)));
    await tx.update(s.reconciliationChanges).set({ status: "applied", source: "user", appliedAt: new Date() }).where(eq(s.reconciliationChanges.id, c.id));
  });
  return true;
}

export async function applyAllProposals(db: DB, userId: string) {
  const rows = await db.select({ id: s.reconciliationChanges.id }).from(s.reconciliationChanges).where(and(eq(s.reconciliationChanges.userId, userId), eq(s.reconciliationChanges.status, "proposed")));
  for (const r of rows) await applyChange(db, userId, r.id);
  return rows.length;
}

export async function dismissChange(db: DB, userId: string, changeId: string) {
  await db.update(s.reconciliationChanges).set({ status: "dismissed" }).where(and(eq(s.reconciliationChanges.id, changeId), eq(s.reconciliationChanges.userId, userId), eq(s.reconciliationChanges.status, "proposed")));
}

/**
 * Puts the category back. The person's undo is a decision too: the entry becomes theirs, and the rule that caused the
 * change gets a contradiction, so it stops acting alone.
 */
export async function revertChange(db: DB, userId: string, changeId: string) {
  const [c] = await db.select().from(s.reconciliationChanges).where(and(eq(s.reconciliationChanges.id, changeId), eq(s.reconciliationChanges.userId, userId)));
  if (!c || c.status !== "applied") return false;
  await db.transaction(async (tx) => {
    await tx.update(s.transactions).set({ categoryId: (c.before as { categoryId: string | null }).categoryId, categorySource: "user" }).where(and(eq(s.transactions.id, c.transactionId), eq(s.transactions.userId, userId)));
    await tx.update(s.reconciliationChanges).set({ status: "reverted", revertedAt: new Date() }).where(eq(s.reconciliationChanges.id, c.id));
    if (c.ruleId) await tx.update(s.reconciliationRules).set({ contradictions: sql`${s.reconciliationRules.contradictions} + 1`, updatedAt: new Date() }).where(eq(s.reconciliationRules.id, c.ruleId));
  });
  return true;
}

/** matched: closed with nothing to do. fixed: closed after a change (by the reconciler or the person). waiting: a proposal or suggestion to review. open: no answer yet. */
export type HealthRow = { institution: string; bills: number; matched: number; fixed: number; waiting: number; open: number; kinds: Record<string, number> };

/** Per institution, the latest outcome of each bill: what the health page shows. */
export async function reconciliationHealth(db: DB, userId: string): Promise<HealthRow[]> {
  // Bills due in the last 12 months, as the page says.
  const since = addDays(todayInSaoPaulo(), -REVIEW_DAYS).slice(0, 7);
  const rows = await db.select().from(s.reconciliationEvents).where(and(eq(s.reconciliationEvents.userId, userId), gte(s.reconciliationEvents.billMonth, since))).orderBy(desc(s.reconciliationEvents.createdAt));
  const latest = new Map<string, (typeof rows)[number]>();
  for (const r of rows) if (!latest.has(`${r.institution}|${r.billMonth}`)) latest.set(`${r.institution}|${r.billMonth}`, r);
  const out = new Map<string, HealthRow>();
  for (const r of latest.values()) {
    const h = out.get(r.institution) ?? { institution: r.institution, bills: 0, matched: 0, fixed: 0, waiting: 0, open: 0, kinds: {} };
    h.bills++;
    if (r.outcome === "matched") h.matched++;
    else if (r.outcome === "auto-applied" || r.outcome === "resolved") h.fixed++;
    else if (r.outcome === "proposed" || r.outcome === "suggested") h.waiting++;
    else h.open++;
    for (const k of r.changeKinds) h.kinds[k] = (h.kinds[k] ?? 0) + 1;
    out.set(r.institution, h);
  }
  // Banks with the most bills that needed help first.
  return [...out.values()].sort((a, b) => b.bills - b.matched - (a.bills - a.matched) || a.institution.localeCompare(b.institution));
}

export async function listChanges(db: DB, userId: string, statuses: ("proposed" | "applied")[]) {
  const c = s.reconciliationChanges;
  return db
    .select({ id: c.id, status: c.status, source: c.source, reason: c.reason, before: c.before, after: c.after, appliedAt: c.appliedAt, txId: c.transactionId, date: s.transactions.date, description: s.transactions.description, amountCents: s.transactions.amountCents, accountId: c.accountId })
    .from(c)
    .innerJoin(s.transactions, eq(s.transactions.id, c.transactionId))
    .where(and(eq(c.userId, userId), inArray(c.status, statuses)))
    .orderBy(desc(s.transactions.date));
}

/**
 * The person applies one change of a suggestion shown on Conferir. Only credit flips can be applied this way; moving a
 * pending or edge entry has no stored override, so those stay as information.
 */
export async function applySuggestion(db: DB, userId: string, txId: string, change: "to-payment" | "to-refund") {
  const [row] = await db.select().from(s.transactions).where(and(eq(s.transactions.id, txId), eq(s.transactions.userId, userId)));
  if (!row || row.amountCents <= 0 || row.categorySource === "user") return false;
  const [txs, categories] = await Promise.all([loadTransactions(db, userId, { accountIds: [row.accountId], includeFuture: true }), loadCategories(db, userId)]);
  const t = txs.find((x) => x.id === txId);
  if (!t) return false;
  const cats = catsOf(categories);
  const target = change === "to-payment" ? cats.bill : t.classification ? categoryFor({ ...t.classification, kind: "refund" }, txs, cats) : cats.fallback;
  if (!target || target === t.categoryId) return false;
  await db.transaction(async (tx) => {
    await tx.update(s.transactions).set({ categoryId: target, categorySource: "user" }).where(eq(s.transactions.id, txId));
    await tx.insert(s.reconciliationChanges).values({ id: newId(), userId, accountId: row.accountId, billRef: row.billRef, transactionId: txId, kind: "category", before: { categoryId: t.categoryId, categorySource: t.categorySource ?? null }, after: { categoryId: target, change }, reason: "sugestão aplicada por você em Conferir fatura", source: "user", status: "applied" });
    // A proposal for the same entry is settled by this decision.
    await tx.update(s.reconciliationChanges).set({ status: "dismissed" }).where(and(eq(s.reconciliationChanges.transactionId, txId), eq(s.reconciliationChanges.status, "proposed")));
  });
  return true;
}
