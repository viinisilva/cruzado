// What the Cruzado learns about each card from the bank's own data, recomputed at the end of every sync: which bill a
// purchase on the closing day goes to, how far the closing is from the due date, and why a closed bill does not match
// the bank's total. Pure: the sync stores the result, the screens read it. See docs/CALIBRACAO_CARTAO.md.
import { readsLikeBillPayment } from "../categorizer";
import { addDays, addMonths } from "../dates";
import { sumCents } from "../money";
import { applyFilters, isTransfer, type CardInfo, type FinCategory, type FinTx } from "./core";
import { cardStatements, statementEntries, type CardStatement } from "./cards";
import { bankAnchors, DEFAULT_RULE, gapStats, type CardCalibration, type ClosingRule, type Confidence, type Divergence, type DivergenceReason } from "./cycles";

export { gapStats, timeline } from "./cycles";
import { RECONCILE_TOLERANCE_CENTS, solveBill, type SolverResult } from "./solver";
import type { SolverSummary } from "./cycles";

function summarize(r: SolverResult): SolverSummary | undefined {
  if (r.outcome === "matched") return undefined;
  if (r.outcome === "unsolved") return { outcome: "unsolved", auto: false, combos: [] };
  if (r.outcome === "ambiguous") return { outcome: "ambiguous", auto: false, combos: r.combos };
  return { outcome: "solved", auto: r.auto, combos: [r.combo] };
}

/** A bank total and a sum of entries this close are the same bill. */
const SAME_CENTS = 10;
/** Below this, a gap against the bank's total is rounding and not worth a reason. */
export const DIVERGENCE_CENTS = 100;
const BILLS_CHECKED = 12;

export type RuleLearning = { rule: ClosingRule; confidence: Confidence; evidence: { same: number; next: number; bills: number } };

/**
 * One vote per closed bill with a real closing date F, strongest evidence first:
 * 1. an entry dated F that the bank tied to this bill (same) or to the next one (next);
 * 2. a bill the bank did not tag, whose total only matches the sum under one of the two rules;
 * 3. weak: an entry dated F left untagged in a bill the bank does tag, so it is not in this bill (next).
 */
export function learnRule(card: CardInfo, txs: FinTx[], categories: FinCategory[]): RuleLearning {
  const gap = gapStats(card.bills ?? []);
  if (!gap) return { rule: DEFAULT_RULE, confidence: "none", evidence: { same: 0, next: 0, bills: 0 } };
  const cats = new Map(categories.map((c) => [c.id, c]));
  const anchors = bankAnchors(card, gap);
  const known = new Set(anchors.map((a) => a.bill!.billRef));
  const mine = applyFilters(txs, null, { accountIds: [card.accountId] }).filter((t) => !isTransfer(t, cats));
  const tagged = new Set(mine.flatMap((t) => (t.billRef ? [t.billRef] : [])));
  const untagged = (t: FinTx) => !t.billRef || !known.has(t.billRef);
  const owed = (from: string, to: string) => -sumCents(mine.filter((t) => untagged(t) && t.date >= from && t.date <= to).map((t) => t.amountCents));
  const votes: { rule: ClosingRule; strong: boolean }[] = [];
  anchors.forEach((a, i) => {
    const bill = a.bill!;
    if (!bill.closingDate) return;
    const day = mine.filter((t) => t.date === bill.closingDate);
    const nextRef = anchors[i + 1]?.bill?.billRef;
    const same = day.some((t) => t.billRef === bill.billRef);
    const next = !!nextRef && day.some((t) => t.billRef === nextRef);
    if (same !== next) return votes.push({ rule: same ? "same" : "next", strong: true });
    if (same) return;
    if (tagged.has(bill.billRef)) {
      if (day.some(untagged)) votes.push({ rule: "next", strong: false });
      return;
    }
    const prev = i > 0 ? anchors[i - 1]!.closing : addMonths(bill.closingDate, -1);
    const fits = (cents: number) => Math.abs(cents - bill.totalCents) <= SAME_CENTS;
    const asSame = fits(owed(addDays(prev, 1), bill.closingDate));
    const asNext = fits(owed(prev, addDays(bill.closingDate, -1)));
    if (asSame !== asNext) votes.push({ rule: asSame ? "same" : "next", strong: true });
  });
  const same = votes.filter((v) => v.rule === "same").length;
  const next = votes.length - same;
  const evidence = { same, next, bills: anchors.length };
  if (!votes.length) return { rule: DEFAULT_RULE, confidence: "none", evidence };
  const rule: ClosingRule = same > next ? "same" : "next";
  const confidence: Confidence = same && next ? "low" : votes.length >= 2 && votes.some((v) => v.strong) ? "high" : "medium";
  return { rule, confidence, evidence };
}

const near = (a: number, b: number) => Math.abs(a - b) <= SAME_CENTS;
const CASHBACK = /cash\s*back/i;

/** The most likely reason a closed bill's entries do not add up to the bank's total. */
export function divergenceReason(card: CardInfo, st: CardStatement, txs: FinTx[], categories: FinCategory[]): { reason: DivergenceReason; amountCents: number } {
  const bank = st.bankTotalCents!;
  const diff = bank - st.computedCents; // > 0: the bank charged more than the entries found
  if (bank === 0 && st.computedCents > 0) return { reason: "bank-zero", amountCents: st.computedCents };
  const cats = new Map(categories.map((c) => [c.id, c]));
  const rows = statementEntries(card, st, txs, categories);
  const pending = -sumCents(rows.filter((t) => t.bankStatus === "pending" && !t.billRef).map((t) => t.amountCents));
  if (diff < 0 && pending > 0 && near(-diff, pending)) return { reason: "pending-not-charged", amountCents: pending };
  const mine = applyFilters(txs, null, { accountIds: [card.accountId] });
  const edges = [st.cycle.from, addDays(st.cycle.from, -1), st.cycle.to, addDays(st.cycle.to, 1)];
  const edge = mine.find((t) => !isTransfer(t, cats) && edges.includes(t.date) && near(Math.abs(t.amountCents), Math.abs(diff)));
  if (edge) return { reason: "closing-edge", amountCents: Math.abs(edge.amountCents) };
  const window = { from: st.cycle.from, to: st.paymentWindow?.to ?? st.cycle.to };
  const asPayment = applyFilters(mine, window).filter((t) => t.amountCents > 0 && isTransfer(t, cats));
  const cashback = sumCents(asPayment.filter((t) => CASHBACK.test(t.description)).map((t) => t.amountCents));
  if (diff < 0 && (near(cashback, -diff) || asPayment.some((t) => near(t.amountCents, -diff)))) return { reason: "credit-as-payment", amountCents: -diff };
  const refundsLikePayment = sumCents(rows.filter((t) => t.amountCents > 0 && readsLikeBillPayment(t.description)).map((t) => t.amountCents));
  if (diff > 0 && refundsLikePayment > 0 && near(refundsLikePayment, diff)) return { reason: "payment-as-refund", amountCents: refundsLikePayment };
  return { reason: diff > 0 ? "missing-entries" : "extra-entries", amountCents: Math.abs(diff) };
}

export function divergences(card: CardInfo, txs: FinTx[], categories: FinCategory[], today: string): Divergence[] {
  return cardStatements(card, txs, categories, today, BILLS_CHECKED)
    // A bill the bank shows as the balance left after an early payment is not a divergence (cards.ts, earlyPayment).
    .filter((st) => st.bankTotalCents !== null && !st.paidEarly && Math.abs(st.bankTotalCents - st.computedCents) > RECONCILE_TOLERANCE_CENTS)
    .map((st) => ({ dueDate: st.dueDate, billRef: st.billRef, closing: st.closing, bankCents: st.bankTotalCents!, computedCents: st.computedCents, ...divergenceReason(card, st, txs, categories), solver: summarize(solveBill(card, st, txs, categories, today)) }));
}

/** Everything the screens need to know about a card, learned from its data. */
export function learnCalibration(card: CardInfo, txs: FinTx[], categories: FinCategory[], today: string): CardCalibration {
  const learned = learnRule(card, txs, categories);
  const gap = gapStats(card.bills ?? []);
  const status: CardCalibration["status"] = gap || card.closingDaySource === "user" || card.closingDaySource === "bank" ? "calibrated" : card.billsChecked === false ? "calibrating" : "needs-closing-day";
  const base: CardCalibration = { version: 1, learnedAt: today, status, rule: learned.rule, ruleConfidence: learned.confidence, evidence: learned.evidence, gap, divergences: [], reconcilerSince: card.calibration?.reconcilerSince ?? today };
  // Divergences are measured with the rule just learned, not the one stored before.
  return gap ? { ...base, divergences: divergences({ ...card, calibration: base }, txs, categories, today) } : base;
}
