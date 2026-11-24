// "Conferir fatura": the entries of one statement, each with the reason it counts, plus the ones that stayed out and
// the ones just past the cycle's edges. Read-only and pure, so a gap against the bank's app can be traced line by line.
import { readsLikeBillPayment } from "../categorizer";
import { addDays } from "../dates";
import { sumCents } from "../money";
import { applyFilters, isTransfer, type CardInfo, type FinCategory, type FinTx } from "./core";
import { cardView, carriedOver, notChargedByBank, statementEntries, statementForMonth, type CardStatement } from "./cards";
import { DIVERGENCE_CENTS, divergenceReason } from "./calibration";
import { ruleOf, type ClosingRule, type Confidence, type DivergenceReason } from "./cycles";
import { SIGNAL_TEXT, type CreditKind } from "./classify";
import { solveBill, type SolverResult } from "./solver";

/** bill: the bank tied it to this bill. date: no bill from the bank, placed by the cycle's dates. */
/** bill: the bank tied it to this bill. date: placed by the cycle's dates. carried: pending, left out of the previous bill in its last days. */
export type IncludedReason = "bill" | "date" | "carried" | "purchase-date" | "projected";
/**
 * transfer: a bill payment or a move between own accounts. other-bill: the bank tied it to another bill.
 * not-charged: pending, and the bank closed this bill without it (see notChargedByBank). Kept, never deleted.
 * late: pending in the last days, left out of this bill: counts in the next one (see carriedOver).
 */
export type ExcludedReason = "transfer" | "other-bill" | "not-charged" | "late";
/**
 * pending: the bank has not settled it yet. outside-dates: counted by the bank's bill although its date is outside the
 * cycle. looks-like-payment: a credit whose text reads like a bill payment, yet it is being subtracted as a refund.
 * may-move: open bill, dated inside the forecast closing range: the bank may put it in the next bill.
 * scheduled: an installment the bank already lists with a later date; it counts here, nowhere else yet.
 */
export type CheckFlag = "pending" | "outside-dates" | "looks-like-payment" | "may-move" | "scheduled";

export type CheckRow = {
  id: string;
  date: string;
  description: string;
  amountCents: number;
  categoryName: string;
  installment: string | null;
  flags: CheckFlag[];
  /** Credits only: what the evidence classifier decided and why, in one sentence. */
  decision: { kind: CreditKind; why: string; matched: { id: string; description: string; date: string } | null } | null;
  /** Who set the category: the person's choice is never changed by any automatic step. */
  chosenByUser: boolean;
  /** A "parcela prevista" (cards.ts, projectInstallments): the bank never sent it; it has no page, only "Excluir". */
  projected: boolean;
  projectionKey: string | null;
};

export type StatementCheck = {
  statement: CardStatement;
  closingDay: number;
  dueDay: number;
  closingDaySource: CardInfo["closingDaySource"];
  included: (CheckRow & { reason: IncludedReason })[];
  excluded: (CheckRow & { reason: ExcludedReason })[];
  /** Entries up to EDGE_DAYS outside the cycle that counted nowhere near it: a wrong closing day moves exactly these. */
  nearby: CheckRow[];
  chargesCents: number;
  creditsCents: number;
  /** Credits counted as refunds whose text reads like a bill payment. */
  suspectPaymentsCents: number;
  /** What the last sync learned: where the closing-day purchase goes, and how sure. */
  rule: ClosingRule;
  ruleConfidence: Confidence;
  ruleBills: number;
  /** Closed bill more than R$ 1,00 away from the bank's total: the likely reason. */
  divergence: { reason: DivergenceReason; amountCents: number } | null;
  /** What the reconciler would change to close the bank's total; "matched" when nothing is needed. */
  solver: SolverResult;
};

const EDGE_DAYS = 5;
const byDate = <T extends { date: string; amountCents: number }>(a: T, b: T) => a.date.localeCompare(b.date) || a.amountCents - b.amountCents;

export function checkStatement(card: CardInfo, given: FinTx[], categories: FinCategory[], today: string, month: string): StatementCheck | null {
  const txs = cardView(card, given, today);
  const statement = statementForMonth(card, txs, categories, today, month);
  if (!statement || statement.status === "future") return null;
  const { cycle } = statement;
  const cats = new Map(categories.map((c) => [c.id, c]));
  const known = new Set(card.bills?.map((b) => b.billRef) ?? []);
  const mine = applyFilters(txs, null, { accountIds: [card.accountId] });
  const counted = statementEntries(card, statement, txs, categories);
  const countedIds = new Set(counted.map((t) => t.id));
  const uncharged = new Set(notChargedByBank(card, statement, txs, categories).map((t) => t.id));
  const carried = new Set(carriedOver(card, statement, txs, categories).map((t) => t.id));
  const inDates = (t: FinTx) => t.date >= cycle.from && t.date <= cycle.to;

  const matchedOf = (id: string | null) => {
    const m = id ? txs.find((x) => x.id === id) : undefined;
    return m ? { id: m.id, description: m.description, date: m.date } : null;
  };
  const row = (t: FinTx): CheckRow => {
    const flags: CheckFlag[] = [];
    if (t.bankStatus === "pending") flags.push("pending");
    if (countedIds.has(t.id) && !inDates(t)) flags.push("outside-dates");
    if (countedIds.has(t.id) && t.amountCents > 0 && readsLikeBillPayment(t.description)) flags.push("looks-like-payment");
    if (countedIds.has(t.id) && statement.status === "open" && statement.closingRange && t.date >= statement.closingRange.from) flags.push("may-move");
    if (t.date > today) flags.push("scheduled");
    return {
      id: t.id,
      // An installment moved to its charge date (cards.ts, chargeDated) shows the date the bank sent: the purchase.
      date: t.purchaseDate ?? t.date,
      description: t.description,
      amountCents: t.amountCents,
      categoryName: (t.categoryId && cats.get(t.categoryId)?.name) || "Sem categoria",
      installment: t.installmentNumber && t.installmentTotal ? `${t.installmentNumber}/${t.installmentTotal}` : null,
      flags,
      decision: t.amountCents > 0 && t.classification ? { kind: t.classification.kind, why: SIGNAL_TEXT[t.classification.reason], matched: matchedOf(t.classification.matchedTxId) } : null,
      chosenByUser: t.categorySource === "user",
      projected: t.projected === true,
      projectionKey: t.projectionKey ?? null,
    };
  };

  const included = counted.map((t) => ({ ...row(t), reason: (t.projected ? "projected" : carried.has(t.id) ? "carried" : t.purchaseDate ? "purchase-date" : t.billRef && known.has(t.billRef) ? "bill" : "date") as IncludedReason })).sort(byDate);
  const excluded = mine
    .filter((t) => inDates(t) && !countedIds.has(t.id))
    .map((t) => ({ ...row(t), reason: (isTransfer(t, cats) ? "transfer" : uncharged.has(t.id) ? "not-charged" : t.bankStatus === "pending" && !t.billRef && statement.billRef ? "late" : "other-bill") as ExcludedReason }))
    .sort(byDate);
  const before = { from: addDays(cycle.from, -EDGE_DAYS), to: addDays(cycle.from, -1) };
  const after = { from: addDays(cycle.to, 1), to: addDays(cycle.to, EDGE_DAYS) };
  const nearby = mine
    .filter((t) => !countedIds.has(t.id) && !isTransfer(t, cats) && !(t.billRef && known.has(t.billRef)))
    .filter((t) => (t.date >= before.from && t.date <= before.to) || (t.date >= after.from && t.date <= after.to))
    .map(row)
    .sort(byDate);

  return {
    statement,
    closingDay: card.closingDay,
    dueDay: card.dueDay,
    closingDaySource: card.closingDaySource ?? null,
    included,
    excluded,
    nearby,
    chargesCents: -sumCents(included.filter((r) => r.amountCents < 0).map((r) => r.amountCents)),
    creditsCents: sumCents(included.filter((r) => r.amountCents > 0).map((r) => r.amountCents)),
    suspectPaymentsCents: sumCents(included.filter((r) => r.flags.includes("looks-like-payment")).map((r) => r.amountCents)),
    rule: ruleOf(card),
    ruleConfidence: card.calibration?.ruleConfidence ?? "none",
    ruleBills: card.calibration?.evidence.bills ?? 0,
    solver: solveBill(card, statement, txs, categories, today),
    divergence: statement.bankTotalCents !== null && !statement.paidEarly && Math.abs(statement.bankTotalCents - statement.computedCents) > DIVERGENCE_CENTS ? divergenceReason(card, statement, txs, categories) : null,
  };
}
