// Statement cycles. When the bank shared bills with closing dates, every closed cycle uses its own real dates and the
// open one is a forecast with a range; the fixed closing day is only the fallback for cards without bank bills.
// See docs/CALIBRACAO_CARTAO.md.
import { addDays, addMonths, daysInMonth, diffDays, type DateRange } from "../dates";
import { currentStatementCycle, type BankBill, type CardInfo } from "./core";

/** Where a purchase dated on the closing day goes: the bill that closes ("same") or the following one ("next"). */
export type ClosingRule = "same" | "next";
export type Confidence = "high" | "medium" | "low" | "none";
export type GapStats = { min: number; max: number; median: number; samples: number };

export type DivergenceReason =
  | "bank-zero"
  | "closing-edge"
  | "pending-not-charged"
  | "credit-as-payment"
  | "payment-as-refund"
  | "missing-entries"
  | "extra-entries";
/** What the reconciler found for a divergent bill: the changes that close it, when it found any. */
export type SolverSummary = { outcome: "solved" | "ambiguous" | "unsolved"; auto: boolean; combos: { txId: string; change: "to-payment" | "to-refund" | "include" | "exclude"; effect: number; why: string; evidence: boolean }[][] };
export type Divergence = { dueDate: string; billRef?: string | null; closing?: string; bankCents: number; computedCents: number; reason: DivergenceReason; amountCents: number; solver?: SolverSummary };

export type CardCalibration = {
  version: 1;
  learnedAt: string;
  status: "calibrating" | "calibrated" | "needs-closing-day";
  rule: ClosingRule;
  ruleConfidence: Confidence;
  evidence: { same: number; next: number; bills: number };
  gap: GapStats | null;
  divergences: Divergence[];
  /** First day this card was reconciled: bills closed before it are only ever suggested, never changed alone. */
  reconcilerSince?: string;
};

export type Slot = {
  cycle: DateRange;
  dueDate: string;
  /** The bank's bill for this cycle, when it shared one. */
  bill: BankBill | null;
  /** The closing date used: the bank's, or the forecast's middle. */
  closing: string;
  /** Forecast only: the days the bill may close on. */
  closingRange: DateRange | null;
  /** bank: from a bill the bank shared. forecast: open or later, predicted. fixed: the configured closing day. */
  source: "bank" | "forecast" | "fixed";
};

/** When no rule was learned yet, the most common practice, and the one seen on the cards studied. */
export const DEFAULT_RULE: ClosingRule = "next";
const MONTHS_BACK = 36;
const MONTHS_AHEAD = 24;
// A due date more than this after the closing is not a closing/due pair: bad data, ignored.
const MAX_GAP = 40;

export const endOf = (rule: ClosingRule, closing: string) => (rule === "next" ? addDays(closing, -1) : closing);
export const startAfter = (rule: ClosingRule, closing: string) => (rule === "next" ? closing : addDays(closing, 1));

const dayIn = (ymd: string, day: number) => `${ymd.slice(0, 7)}-${String(Math.min(day, daysInMonth(Number(ymd.slice(0, 4)), Number(ymd.slice(5, 7))))).padStart(2, "0")}`;

/** Days between closing and due date over the bank's bills. */
export function gapStats(bills: BankBill[]): GapStats | null {
  const gaps = bills
    .filter((b) => b.closingDate)
    .map((b) => diffDays(b.closingDate!, b.dueDate))
    .filter((g) => g > 0 && g <= MAX_GAP)
    .sort((a, b) => a - b);
  if (!gaps.length) return null;
  const mid = Math.floor(gaps.length / 2);
  const median = gaps.length % 2 ? gaps[mid]! : Math.round((gaps[mid - 1]! + gaps[mid]!) / 2);
  return { min: gaps[0]!, max: gaps.at(-1)!, median, samples: gaps.length };
}

/** True when cycles come from the bank's own closing dates rather than the fixed day. */
export function usesBankDates(card: CardInfo): boolean {
  return gapStats(card.bills ?? []) !== null;
}

export function ruleOf(card: CardInfo): ClosingRule {
  return card.calibration?.rule ?? DEFAULT_RULE;
}

type Anchor = { closing: string; due: string; bill: BankBill | null; range: DateRange | null; source: Slot["source"] };

/** The bank's closed bills as anchors, oldest first. A bill without a closing date gets one from the median gap. */
export function bankAnchors(card: CardInfo, gap: GapStats): Anchor[] {
  const seen = new Set<string>();
  return (card.bills ?? [])
    .map((b) => ({ closing: b.closingDate ?? addDays(b.dueDate, -gap.median), due: b.dueDate, bill: b, range: null, source: "bank" as const }))
    .sort((a, b) => a.closing.localeCompare(b.closing))
    .filter((a) => (seen.has(a.closing) ? false : (seen.add(a.closing), true)));
}

/** The open bill and the ones after it: due on the card's due day, closing the median gap before, inside a range. */
function forecastAnchors(card: CardInfo, last: Anchor, gap: GapStats): Anchor[] {
  const out: Anchor[] = [];
  let prev = last.closing;
  for (let k = 1; k <= MONTHS_AHEAD; k++) {
    const due = dayIn(addMonths(last.due, k), card.dueDay);
    let closing = addDays(due, -gap.median);
    // Weekends and holidays move closings by a day or two: always a range, never one exact day.
    let range = { from: addDays(due, -(gap.max + 1)), to: addDays(due, -(gap.min - 1)) };
    // A due day that moved can make the forecast land on top of the last closing; keep cycles about a month long,
    // and since the due date no longer tells, a range around that month.
    if (diffDays(prev, closing) < 20) {
      closing = addMonths(prev, 1);
      range = { from: addDays(closing, -2), to: addDays(closing, 2) };
    }
    out.push({ closing, due, bill: null, range, source: "forecast" });
    prev = closing;
  }
  return out;
}

/** The bank's bill that comes due in the same month as this due date. */
export function bankBillFor(card: CardInfo, dueDate: string): BankBill | null {
  return card.bills?.find((b) => b.dueDate.slice(0, 7) === dueDate.slice(0, 7)) ?? null;
}

function legacyTimeline(card: CardInfo, today: string): Slot[] {
  const slots: Slot[] = [];
  let anchor = today;
  for (let i = 0; i < MONTHS_BACK; i++) {
    const { cycle, dueDate } = currentStatementCycle(card, anchor);
    slots.unshift({ cycle, dueDate, bill: bankBillFor(card, dueDate), closing: cycle.to, closingRange: null, source: "fixed" });
    anchor = addDays(cycle.from, -1);
  }
  anchor = addDays(slots.at(-1)!.cycle.to, 1);
  for (let i = 0; i < MONTHS_AHEAD; i++) {
    const { cycle, dueDate } = currentStatementCycle(card, anchor);
    slots.push({ cycle, dueDate, bill: bankBillFor(card, dueDate), closing: cycle.to, closingRange: null, source: "fixed" });
    anchor = addDays(cycle.to, 1);
  }
  return slots;
}

/** Every cycle from three years back to two years ahead, oldest first. */
export function timeline(card: CardInfo, today: string): Slot[] {
  const gap = gapStats(card.bills ?? []);
  if (!gap) return legacyTimeline(card, today);
  const rule = ruleOf(card);
  const bank = bankAnchors(card, gap);
  const first = bank[0]!;
  const past: Anchor[] = Array.from({ length: MONTHS_BACK }, (_, i) => MONTHS_BACK - i).map((k) => ({ closing: addMonths(first.closing, -k), due: addMonths(first.due, -k), bill: null, range: null, source: "fixed" as const }));
  const all = [...past, ...bank, ...forecastAnchors(card, bank.at(-1)!, gap)];
  return all.map((a, i) => ({
    cycle: { from: startAfter(rule, i === 0 ? addMonths(a.closing, -1) : all[i - 1]!.closing), to: endOf(rule, a.closing) },
    dueDate: a.due,
    bill: a.bill,
    closing: a.closing,
    closingRange: a.range,
    source: a.source,
  }));
}

/** Index of the cycle that contains `date`. */
export function slotIndexAt(slots: Slot[], date: string): number {
  const i = slots.findIndex((s) => s.cycle.to >= date);
  return i === -1 ? slots.length - 1 : i;
}
