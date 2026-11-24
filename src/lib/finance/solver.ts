// Closed-bill reconciliation (docs/AUTOCONCILIACAO.md, section 3). When the bank's total and the Cruzado's sum differ,
// look for the smallest set of changes that closes the gap to the cent. Pure: it only says what would close it.
// Acting alone is reserved for a unique answer whose every change has evidence beyond the arithmetic; anything else is
// a suggestion for the person.
import { addDays } from "../dates";
import { applyFilters, isTransfer, type CardInfo, type FinCategory, type FinTx } from "./core";
import { statementEntries, type CardStatement } from "./cards";
import { hasEvidenceFor } from "./classify";

export type CandidateChange = "to-payment" | "to-refund" | "include" | "exclude";
export type Candidate = {
  txId: string;
  change: CandidateChange;
  /** How much the Cruzado's sum moves, in cents. */
  effect: number;
  /** Only a credit flip with evidence for its new class may be applied without the person. */
  evidence: boolean;
  why: "credit" | "pending" | "edge" | "future";
};
export type SolverResult =
  | { outcome: "matched" }
  | { outcome: "solved"; combo: Candidate[]; auto: boolean }
  | { outcome: "ambiguous"; combos: Candidate[][] }
  | { outcome: "unsolved"; gapCents: number };

const MAX_CANDIDATES = 40;
const MAX_SIZE = 3;
const EDGE_DAYS = 3;
export const RECONCILE_TOLERANCE_CENTS = 10;

/** Every change that could move this bill's sum, with its exact effect. */
export function candidates(card: CardInfo, st: CardStatement, txs: FinTx[], categories: FinCategory[], today: string): Candidate[] {
  const cats = new Map(categories.map((c) => [c.id, c]));
  const counted = statementEntries(card, st, txs, categories);
  const countedIds = new Set(counted.map((t) => t.id));
  // A prevista is not a bank entry: nothing to change on it (the person can exclude it in Conferir).
  const mine = applyFilters(txs, null, { accountIds: [card.accountId] }).filter((t) => t.categorySource !== "user" && !t.projected);
  const inCycle = (t: FinTx) => (t.billRef ? t.billRef === st.billRef : t.date >= st.cycle.from && t.date <= st.cycle.to);
  const out: Candidate[] = [];
  for (const t of mine) {
    const c = t.classification;
    if (t.amountCents > 0 && inCycle(t)) {
      if (countedIds.has(t.id)) out.push({ txId: t.id, change: "to-payment", effect: t.amountCents, evidence: hasEvidenceFor(c, "payment"), why: "credit" });
      else if (isTransfer(t, cats)) out.push({ txId: t.id, change: "to-refund", effect: -t.amountCents, evidence: hasEvidenceFor(c, "refund") || hasEvidenceFor(c, "credit"), why: "credit" });
      continue;
    }
    if (t.amountCents >= 0 || t.billRef || isTransfer(t, cats)) continue;
    if (t.date > today && countedIds.has(t.id)) out.push({ txId: t.id, change: "exclude", effect: t.amountCents, evidence: false, why: "future" });
    else if (t.bankStatus === "pending" && countedIds.has(t.id)) out.push({ txId: t.id, change: "exclude", effect: t.amountCents, evidence: false, why: "pending" });
    else if (!countedIds.has(t.id) && inCycle(t)) out.push({ txId: t.id, change: "include", effect: -t.amountCents, evidence: false, why: "pending" });
    else if (!countedIds.has(t.id) && justOutside(t.date, st.cycle, EDGE_DAYS)) out.push({ txId: t.id, change: "include", effect: -t.amountCents, evidence: false, why: "edge" });
    else if (countedIds.has(t.id) && justInside(t.date, st.cycle, EDGE_DAYS)) out.push({ txId: t.id, change: "exclude", effect: t.amountCents, evidence: false, why: "edge" });
  }
  // Doubtful ones first: credits without a firm class, then the rest.
  const doubt = (x: Candidate) => (x.why === "credit" ? (txs.find((t) => t.id === x.txId)?.classification?.kind === "unknown" ? 0 : 1) : x.why === "pending" ? 2 : 3);
  return out.sort((a, b) => doubt(a) - doubt(b)).slice(0, MAX_CANDIDATES);
}

/** Up to `days` outside the cycle, before its start or after its end. */
function justOutside(date: string, cycle: { from: string; to: string }, days: number): boolean {
  return (date < cycle.from && date >= addDays(cycle.from, -days)) || (date > cycle.to && date <= addDays(cycle.to, days));
}

/** Up to `days` inside the cycle, from its start or before its end. */
function justInside(date: string, cycle: { from: string; to: string }, days: number): boolean {
  return (date >= cycle.from && date < addDays(cycle.from, days)) || (date <= cycle.to && date > addDays(cycle.to, -days));
}

/** Smallest sets of candidates (1 to 3, one change per entry) whose effects sum to the gap exactly. */
export function combos(list: Candidate[], gap: number): Candidate[][] {
  for (let size = 1; size <= MAX_SIZE; size++) {
    const found: Candidate[][] = [];
    const walk = (start: number, picked: Candidate[], sum: number) => {
      if (picked.length === size) {
        if (sum === gap) found.push(picked);
        return;
      }
      for (let i = start; i < list.length; i++) {
        if (picked.some((p) => p.txId === list[i]!.txId)) continue;
        walk(i + 1, [...picked, list[i]!], sum + list[i]!.effect);
      }
    };
    walk(0, [], 0);
    if (found.length) return found;
  }
  return [];
}

export function solveBill(card: CardInfo, st: CardStatement, txs: FinTx[], categories: FinCategory[], today: string): SolverResult {
  // No bank total, or the bank shows the balance left after an early payment (cards.ts, earlyPayment): nothing to close.
  if (st.bankTotalCents === null || st.paidEarly) return { outcome: "matched" };
  const gap = st.bankTotalCents - st.computedCents;
  if (Math.abs(gap) <= RECONCILE_TOLERANCE_CENTS) return { outcome: "matched" };
  const found = combos(candidates(card, st, txs, categories, today), gap);
  if (!found.length) return { outcome: "unsolved", gapCents: gap };
  if (found.length > 1) return { outcome: "ambiguous", combos: found.slice(0, 3) };
  const combo = found[0]!;
  return { outcome: "solved", combo, auto: combo.every((c) => c.why === "credit" && c.evidence) };
}

