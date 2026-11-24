// Credit card views. A "fatura" is a cycle plus what was posted inside it. When the bank shared its bills (Open
// Finance), each closed cycle uses the bank's own closing date, entries go to the bill the bank put them in and the
// bank's total is the headline; the open cycle closes on a forecast, shown as a range. The sum of entries stays next to
// the bank's total, so a gap (interest, fees, entries not shared) is visible, never hidden. See docs/CALIBRACAO_CARTAO.md.
import { addDays, addMonths, diffDays, startOfMonth, type DateRange } from "../dates";
import { sumCents } from "../money";
import { applyFilters, creditCardSummary, installmentPurchases, isTransfer, type AccountBalance, type BankBill, type CardInfo, type FinCategory, type FinTx } from "./core";
import { slotIndexAt, timeline, usesBankDates, type Slot } from "./cycles";

/** Bank-linked card whose bills were never asked for: the first sync is still learning it. */
const calibratingNow = (info: CardInfo) => info.billsChecked === false && !usesBankDates(info);

export type CardStatement = {
  accountId: string;
  cycle: DateRange;
  dueDate: string;
  /** Decided only by the date. Nothing here can tell whether a statement was paid. "future" = not open yet: a forecast. */
  status: "open" | "closed" | "future";
  chargesCents: number;
  refundsCents: number;
  /** The figure to show: the bank's total when it shared this bill, otherwise the sum of entries. */
  totalCents: number;
  /** Charges minus refunds found in the entries. */
  computedCents: number;
  /** The issuer's total for this bill; null when the bank did not share it (open bills never have one). */
  bankTotalCents: number | null;
  minimumCents: number | null;
  /** The bank's bill this cycle is, when it shared one. */
  billRef: string | null;
  /** The cycle before: pending entries it closed without, dated in its last days, may count here. */
  previous: { cycle: DateRange; billRef: string | null } | null;
  count: number;
  /** True when the entries are exactly the cycle's dates; false when the bank's bill moved some in or out. */
  matchesRange: boolean;
  paymentsCents: number;
  /**
   * The bank's figure is the balance left after an early payment (Mercado Pago shows R$ 0,00 for a bill paid before it
   * closed): the payment that explains it. Then totalCents is the bill's value, not the bank's balance.
   */
  paidEarly: { cents: number; date: string } | null;
  /**
   * The bank charged more than the entries add up to, and one entry left out of this bill has exactly the missing
   * amount: most likely that one (an installment the bank sent without a bill, for example). Null otherwise.
   */
  gapCandidate: { id: string; description: string; date: string; amountCents: number; installment: string | null; kind: "left-out" | "earlier-purchase" } | null;
  /** "Parcelas previstas" counted in this bill (projectInstallments): installments the bank never sent. */
  projected: { count: number; cents: number };
  /** Closing + 1 … next closing: where a payment for this statement would be posted. */
  paymentWindow: DateRange | null;
  /** bank: the bank's closing date. forecast: predicted, see closingRange. fixed: the configured closing day. */
  closingSource: Slot["source"];
  /** The closing date: the bank's, the configured day, or the middle of the forecast range. */
  closing: string;
  /** Days a forecast cycle may close on; null when the closing date is known. */
  closingRange: DateRange | null;
};

const dayMonth = (ymd: string) => `${ymd.slice(8, 10)}/${ymd.slice(5, 7)}`;

/** "em 29/10" for a known closing; "por volta de 19 a 21/11" for a forecast, never one made-up exact day. */
export function closingText(s: Pick<CardStatement, "closing" | "closingRange">): string {
  if (!s.closingRange) return `em ${dayMonth(s.closing)}`;
  const { from, to } = s.closingRange;
  return `por volta de ${from.slice(5, 7) === to.slice(5, 7) ? from.slice(8, 10) : dayMonth(from)} a ${dayMonth(to)}`;
}

export { bankBillFor } from "./cycles";

/**
 * Installments some banks send with the **purchase date** and no bill tag (Bradesco Elo, Mercado Pago): placed by that
 * date, installment 2/4 of a purchase made in October lands in October's bill, which the bank closed long ago without
 * it, and it would count nowhere. The bank charges installment n in the bill of the purchase plus n − 1 months.
 *
 * Told apart from a pending entry the bank never charged (the Nubank "4/5" left out of its latest bill) by where the
 * date falls: a real pending charge never outlives two closings, so only an installment dated in a closed, tagged bill
 * **older than the latest one** is moved, and only when its numbering reaches the latest closed bill or later. It gets
 * its charge date (purchase date + n − 1 months) and keeps the purchase date in `purchaseDate`. Idempotent.
 */
export function chargeDated(card: CardInfo, txs: FinTx[], today: string): FinTx[] {
  const known = new Set(card.bills?.map((b) => b.billRef) ?? []);
  if (!known.size) return txs;
  const slots = timeline(card, today);
  const taggedRefs = new Set(txs.filter((t) => t.accountId === card.accountId && t.billRef).map((t) => t.billRef!));
  const tagged = (i: number) => Boolean(slots[i]?.bill && taggedRefs.has(slots[i]!.bill!.billRef));
  let latest = -1;
  slots.forEach((_, i) => {
    if (tagged(i)) latest = i;
  });
  if (latest < 1) return txs;
  return txs.map((t) => {
    const n = t.installmentNumber ?? 0;
    if (t.purchaseDate || t.accountId !== card.accountId || n < 2 || t.amountCents >= 0 || (t.billRef && known.has(t.billRef))) return t;
    const at = slots.findIndex((s) => t.date >= s.cycle.from && t.date <= s.cycle.to);
    if (at < 0 || at >= latest || !tagged(at) || at + n - 1 < latest) return t;
    return { ...t, date: addMonths(t.date, n - 1), purchaseDate: t.date };
  });
}

/** Same tolerance as the reconciler: an installment that differs by a few cents of rounding is the same installment. */
const INSTALLMENT_TOLERANCE_CENTS = 10;
/** A bill with previstas whose sum is this close to the bank is explained by them: the rest is rounding between installments. */
export const PROJECTION_MATCH_CENTS = INSTALLMENT_TOLERANCE_CENTS;

/**
 * "Parcela prevista": installments the bank never sent. When a purchase in n/t installments has its later ones missing
 * from bills that already closed (Bradesco Elo sent only 1/4 of a purchase), each missing one is added, for this
 * calculation only, to the bill it belongs to: the bill of the last one received plus one per installment, with that
 * one's amount. It is marked (`projected`), tied to that bill, and:
 * - only in closed bills: in the open one it is still just a forecast (installmentPlans);
 * - gone as soon as the real one arrives, numbered or, without numbers, same merchant and amount within cents;
 * - gone for good when the person excludes it (`card.dismissedProjections`);
 * - never duplicated: rows already projected are not projected again.
 */
export function projectInstallments(card: CardInfo, txs: FinTx[], today: string): FinTx[] {
  if (!card.bills?.length || txs.some((t) => t.projected && t.accountId === card.accountId)) return txs;
  const slots = timeline(card, today);
  const open = slotIndexAt(slots, today);
  const known = new Map(slots.map((s, i) => [s.bill?.billRef, i]));
  const dismissed = new Set(card.dismissedProjections ?? []);
  const mine = txs.filter((t) => t.accountId === card.accountId);
  const slotOf = (t: FinTx) => (t.billRef && known.has(t.billRef) ? known.get(t.billRef)! : slots.findIndex((s) => t.date >= s.cycle.from && t.date <= s.cycle.to));
  const inSlot = (t: FinTx, i: number) => slotOf(t) === i;
  const added: FinTx[] = [];
  for (const rows of installmentPurchases(mine)) {
    const sorted = [...rows].sort((a, b) => a.installmentNumber! - b.installmentNumber!);
    const first = sorted[0]!;
    const last = sorted.at(-1)!;
    const total = last.installmentTotal!;
    const from = slotOf(last);
    if (from < 0) continue;
    const received = new Set(sorted.map((t) => t.installmentNumber));
    for (let k = last.installmentNumber! + 1; k <= total; k++) {
      const target = from + (k - last.installmentNumber!);
      if (target >= open || target >= slots.length) break;
      if (received.has(k)) continue;
      const key = `${first.id}#${k}`;
      if (dismissed.has(key)) continue;
      // The real one may have come without numbers: same merchant, about the same amount, in that bill.
      const arrived = mine.some((t) => !t.projected && t.merchant === last.merchant && inSlot(t, target) && Math.abs(t.amountCents - last.amountCents) <= INSTALLMENT_TOLERANCE_CENTS && (!t.installmentNumber || t.installmentNumber === k));
      if (arrived) continue;
      const slot = slots[target]!;
      const shifted = addMonths(last.date, k - last.installmentNumber!);
      const date = shifted < slot.cycle.from ? slot.cycle.from : shifted > slot.cycle.to ? slot.cycle.to : shifted;
      added.push({ ...last, id: `prevista:${key}`, date, installmentNumber: k, billRef: slot.bill?.billRef ?? null, bankStatus: null, classification: null, purchaseDate: undefined, projected: true, projectionKey: key });
    }
  }
  return added.length ? [...txs, ...added] : txs;
}

/** What the card screens work on: installments moved to their charge date, then the previstas. */
export function cardView(card: CardInfo, txs: FinTx[], today: string): FinTx[] {
  return projectInstallments(card, chargeDated(card, txs, today), today);
}

/** cardView for every card: what pages pass to anything that places entries in bills or forecasts installments. */
export function withChargeDates(cards: CardInfo[], txs: FinTx[], today: string): FinTx[] {
  return cards.reduce((acc, card) => cardView(card, acc, today), txs);
}

/** A pending entry this close to the closing may simply post late, into the next bill (see `carriedOver`). */
export const LATE_POST_DAYS = 5;

type StatementRef = { cycle: DateRange; billRef: string | null };

/** Untagged pending entries dated inside a closed bill that the bank tags: the bank closed it without them. */
function leftOut(card: CardInfo, statement: StatementRef, txs: FinTx[], categories: FinCategory[]): FinTx[] {
  const { cycle, billRef } = statement;
  if (!billRef) return [];
  const mine = applyFilters(txs, null, { accountIds: [card.accountId] });
  // Evidence that the bank tags what it charged: only its own rows count. A prevista carries this bill's ref but was
  // made here (projectInstallments), so it never turns this rule on.
  if (!mine.some((t) => !t.projected && t.billRef === billRef)) return [];
  const cats = new Map(categories.map((c) => [c.id, c]));
  const known = new Set(card.bills?.map((b) => b.billRef) ?? []);
  // An installment moved to its charge date (chargeDated) is placed by the numbering, which the bank's tags do not show.
  return mine.filter((t) => t.bankStatus === "pending" && !t.purchaseDate && !(t.billRef && known.has(t.billRef)) && !isTransfer(t, cats) && t.date >= cycle.from && t.date <= cycle.to);
}

const late = (statement: StatementRef) => (t: FinTx) => t.date > addDays(statement.cycle.to, -LATE_POST_DAYS);

/**
 * Left out of a closed bill and dated well before its closing: a pre-authorization that was cancelled, or a duplicate.
 * The bank tags what it charged when the bill closes, so these were not charged. They stay stored and visible (Conferir
 * shows them as "não cobrado pelo banco"); they only stop adding to the bill.
 */
export function notChargedByBank(card: CardInfo, statement: StatementRef, txs: FinTx[], categories: FinCategory[]): FinTx[] {
  return leftOut(card, statement, txs, categories).filter((t) => !late(statement)(t));
}

/**
 * Left out of the previous closed bill but dated in its last days: most likely a purchase that settled after the
 * closing, so it counts in this bill. Once this bill is closed and tagged too, the bank's tags decide.
 */
export function carriedOver(card: CardInfo, statement: StatementRef & { previous?: StatementRef | null }, txs: FinTx[], categories: FinCategory[]): FinTx[] {
  if (!statement.previous) return [];
  if (statement.billRef && txs.some((t) => !t.projected && t.accountId === card.accountId && t.billRef === statement.billRef)) return [];
  return leftOut(card, statement.previous, txs, categories).filter(late(statement.previous));
}

/**
 * Entries of one statement. An entry the bank tied to a known bill belongs to that bill whatever its date (an
 * installment may carry the purchase date); everything else is placed by date inside the cycle, except pending
 * entries the bank left out of a bill it already closed: not charged (`notChargedByBank`) or late (`carriedOver`).
 */
export function statementEntries(card: CardInfo, statement: StatementRef & { previous?: StatementRef | null }, txs: FinTx[], categories: FinCategory[]): FinTx[] {
  const cats = new Map(categories.map((c) => [c.id, c]));
  const known = new Set(card.bills?.map((b) => b.billRef) ?? []);
  const { cycle, billRef } = statement;
  const out = new Set(leftOut(card, statement, txs, categories).map((t) => t.id));
  const carried = new Set(carriedOver(card, statement, txs, categories).map((t) => t.id));
  return applyFilters(txs, null, { accountIds: [card.accountId] }).filter((t) => {
    if (carried.has(t.id)) return true;
    if (isTransfer(t, cats) || out.has(t.id)) return false;
    if (t.billRef && known.has(t.billRef)) return t.billRef === billRef;
    return t.date >= cycle.from && t.date <= cycle.to;
  });
}

/** Same tolerance as the reconciler (solver.ts): a few cents of rounding are not a difference. */
const PAID_TOLERANCE_CENTS = 10;

/**
 * Some banks report a bill's total as what is still owed. Paid before the closing or the due date, it shows R$ 0,00 or
 * less than the entries add up to. When the bill payments (credits classified as payment by evidence) made from the
 * cycle's start up to the due date cover exactly
 * that difference (one of them, or all together), the bill was paid early, and nothing diverges.
 */
/**
 * A credit that surely paid the bill: classified as a payment with no signal against it, and either the bank shows
 * nothing left (R$ 0,00) or the bank itself marked it as a bill payment. A partial payment backed only by wording or by
 * a matching debit stays a divergence for the reconciler: a refund taken as a payment looks exactly the same.
 */
const STRONG_PAYMENT = new Set(["bill-payment", "op-bill-payment"]);
function surelyPaid(t: FinTx, bankTotalCents: number): boolean {
  const c = t.classification;
  if (c?.kind !== "payment" || c.signals.some((s) => s.kind !== "payment")) return false;
  return bankTotalCents === 0 || c.signals.some((s) => STRONG_PAYMENT.has(s.code));
}

function earlyPayment(card: CardInfo, cycle: DateRange, bill: BankBill, computedCents: number, txs: FinTx[], cats: Map<string, FinCategory>) {
  const owed = computedCents - bill.totalCents;
  if (owed <= PAID_TOLERANCE_CENTS) return null;
  // Only credits the evidence classifier calls a payment: a refund or a cashback sitting in "Pagamento de fatura" by
  // mistake would cover the same difference, and hiding it would stop the reconciler from fixing it.
  const paid = applyFilters(txs, { from: cycle.from, to: bill.dueDate.slice(0, 10) }, { accountIds: [card.accountId] }).filter((t) => t.amountCents > 0 && isTransfer(t, cats) && surelyPaid(t, bill.totalCents));
  const fits = (cents: number) => Math.abs(cents - owed) <= PAID_TOLERANCE_CENTS;
  const single = paid.filter((t) => fits(t.amountCents)).sort((a, b) => a.date.localeCompare(b.date))[0];
  if (single) return { cents: single.amountCents, date: single.date };
  const all = sumCents(paid.map((t) => t.amountCents));
  return paid.length > 1 && fits(all) ? { cents: all, date: paid.map((t) => t.date).sort().at(-1)! } : null;
}

/**
 * When the bank's total is higher than the entries, an entry of exactly the missing amount that did not count here:
 * one the bank sent without a bill (no tag it shared), pending or an installment, dated in this cycle or up to five
 * months before it. Shown instead of the generic "juros, tarifas…" explanation. Information only: it moves nothing.
 */
function missingEntry(card: CardInfo, cycle: DateRange, bill: BankBill, computedCents: number, rows: FinTx[], txs: FinTx[], cats: Map<string, FinCategory>): CardStatement["gapCandidate"] {
  const gap = bill.totalCents - computedCents;
  if (gap <= PAID_TOLERANCE_CENTS) return null;
  const known = new Set(card.bills?.map((b) => b.billRef) ?? []);
  const counted = new Set(rows.map((t) => t.id));
  const found = applyFilters(txs, { from: addDays(cycle.from, -150), to: cycle.to }, { accountIds: [card.accountId] })
    .filter((t) => t.amountCents < 0 && !t.projected && !counted.has(t.id) && !isTransfer(t, cats) && !(t.billRef && known.has(t.billRef)))
    .filter((t) => (t.bankStatus === "pending" || t.installmentNumber) && Math.abs(-t.amountCents - gap) <= PAID_TOLERANCE_CENTS)
    .sort((a, b) => Number(Boolean(b.installmentNumber)) - Number(Boolean(a.installmentNumber)) || b.date.localeCompare(a.date));
  const pick = (t: FinTx, kind: "left-out" | "earlier-purchase") => {
    const installment = t.installmentNumber && t.installmentTotal ? `${t.installmentNumber}/${t.installmentTotal}` : null;
    return { id: t.id, description: t.description, date: t.purchaseDate ?? t.date, amountCents: -t.amountCents, installment, kind };
  };
  if (found.length === 1) return pick(found[0]!, "left-out");
  if (found.length > 1) return null;
  // No left-out entry: maybe an installment of an earlier purchase that the bank never sent. Some banks (Bradesco Elo)
  // send only the first one, without numbers: a purchase before this cycle of about the missing amount (the first
  // installment often carries the rounding), from a merchant with nothing in this bill. Named as a possibility only.
  const here = new Set(rows.map((t) => t.merchant));
  const earlier = applyFilters(txs, { from: addDays(cycle.from, -150), to: addDays(cycle.from, -1) }, { accountIds: [card.accountId] }).filter(
    (t) => t.amountCents < 0 && !t.projected && !isTransfer(t, cats) && !here.has(t.merchant) && Math.abs(-t.amountCents - gap) <= PAID_TOLERANCE_CENTS,
  );
  return earlier.length === 1 ? pick(earlier[0]!, "earlier-purchase") : null;
}

function buildStatement(card: CardInfo, slots: Slot[], i: number, txs: FinTx[], categories: FinCategory[], today: string): CardStatement {
  const slot = slots[i]!;
  const { cycle, bill } = slot;
  const cats = new Map(categories.map((c) => [c.id, c]));
  const prev = slots[i - 1];
  const previous = prev ? { cycle: prev.cycle, billRef: prev.bill?.billRef ?? null } : null;
  const rows = statementEntries(card, { cycle, billRef: bill?.billRef ?? null, previous }, txs, categories);
  const inRange = applyFilters(txs, cycle, { accountIds: [card.accountId] }).filter((t) => !isTransfer(t, cats));
  const matchesRange = inRange.length === rows.length && rows.every((t) => t.date >= cycle.from && t.date <= cycle.to);
  const status = bill || today > cycle.to ? "closed" : "open";
  const next = slots[i + 1];
  const paymentWindow = status === "closed" && next ? { from: next.cycle.from, to: next.cycle.to } : null;
  const payments = paymentWindow ? applyFilters(txs, paymentWindow, { accountIds: [card.accountId] }).filter((t) => isTransfer(t, cats) && t.amountCents > 0) : [];
  const chargesCents = -sumCents(rows.filter((t) => t.amountCents < 0).map((t) => t.amountCents));
  const refundsCents = sumCents(rows.filter((t) => t.amountCents > 0).map((t) => t.amountCents));
  const computedCents = chargesCents - refundsCents;
  const paidEarly = bill ? earlyPayment(card, cycle, bill, computedCents, txs, cats) : null;
  const gapCandidate = bill && !paidEarly ? missingEntry(card, cycle, bill, computedCents, rows, txs, cats) : null;
  return {
    accountId: card.accountId,
    cycle,
    dueDate: bill?.dueDate ?? slot.dueDate,
    status,
    chargesCents,
    refundsCents,
    totalCents: paidEarly ? computedCents : (bill?.totalCents ?? computedCents),
    computedCents,
    bankTotalCents: bill?.totalCents ?? null,
    minimumCents: bill?.minimumCents ?? null,
    billRef: bill?.billRef ?? null,
    previous,
    count: rows.length,
    matchesRange,
    paymentsCents: sumCents(payments.map((t) => t.amountCents)),
    paidEarly,
    gapCandidate,
    projected: { count: rows.filter((t) => t.projected).length, cents: -sumCents(rows.filter((t) => t.projected).map((t) => t.amountCents)) },
    paymentWindow,
    closingSource: slot.source,
    closing: slot.closing,
    closingRange: slot.closingRange,
  };
}

/** The current cycle and the ones before it, newest first. Totals follow creditCardSummary: no bill payments or transfers. */
export function cardStatements(card: CardInfo, given: FinTx[], categories: FinCategory[], today: string, count = 6): CardStatement[] {
  const txs = cardView(card, given, today);
  const slots = timeline(card, today);
  const at = slotIndexAt(slots, today);
  const out: CardStatement[] = [];
  for (let i = at; i >= 0 && out.length < count; i--) out.push(buildStatement(card, slots, i, txs, categories, today));
  return out;
}

/**
 * The statement that comes due in `month` (YYYY-MM). Past and open ones are built from what was posted. A later one has
 * not opened yet, so it is only a forecast: the installments already known to fall in its cycle, nothing else.
 */
export function statementForMonth(card: CardInfo, given: FinTx[], categories: FinCategory[], today: string, month: string): CardStatement | null {
  const txs = cardView(card, given, today);
  const slots = timeline(card, today);
  const open = slotIndexAt(slots, today);
  const i = slots.findIndex((s) => (s.bill?.dueDate ?? s.dueDate).slice(0, 7) === month);
  if (i === -1) return null;
  if (i <= open) return buildStatement(card, slots, i, txs, categories, today);
  const { cycle, dueDate, closingRange, source, closing } = slots[i]!;
  // Installments the bank already listed for this cycle, then a projection of the ones it has not listed yet.
  const cats = new Map(categories.map((c) => [c.id, c]));
  const listed = applyFilters(txs, cycle, { accountIds: [card.accountId] }).filter((t) => t.date > today && !isTransfer(t, cats)).map((t) => -t.amountCents);
  const projected = installmentPlans(txs, today, [card.accountId]).flatMap((p) =>
    Array.from({ length: p.remaining }, (_, k) => ({ n: p.current + 1 + k, date: addMonths(p.nextDate, k) }))
      .filter(({ n, date }) => !p.listed.includes(n) && date >= cycle.from && date <= cycle.to)
      .map(() => p.installmentCents),
  );
  const due = [...listed, ...projected];
  const chargesCents = sumCents(due);
  return { accountId: card.accountId, cycle, dueDate, status: "future", chargesCents, refundsCents: 0, totalCents: chargesCents, computedCents: chargesCents, bankTotalCents: null, minimumCents: null, billRef: null, previous: null, count: due.length, matchesRange: true, paymentsCents: 0, paidEarly: null, gapCandidate: null, projected: { count: 0, cents: 0 }, paymentWindow: null, closingSource: source, closing, closingRange };
}

/** The statement that comes due next; a past due date stops counting even when nothing shows it was paid. */
export function nextStatement(statements: CardStatement[], today: string): CardStatement | null {
  return statements.filter((s) => s.dueDate >= today).sort((a, b) => a.dueDate.localeCompare(b.dueDate))[0] ?? null;
}


export type InstallmentPlan = {
  key: string;
  accountId: string;
  label: string;
  installmentCents: number;
  total: number;
  /** Last installment already charged. Moves forward by date when the rows stopped arriving (see `estimated`). */
  current: number;
  remaining: number;
  nextDate: string;
  lastDate: string;
  firstDate: string;
  chargedCents: number;
  remainingCents: number;
  estimated: boolean;
  /** Installment numbers the bank already listed with a later date: real rows, so they are never projected again. */
  listed: number[];
};

/** A purchase's name without its "3/10" or "parcela 3 de 10" suffix. */
export function installmentLabel(description: string): string {
  return description.replace(/\s*(parc(ela)?\.?\s*)?\d{1,2}\s*(\/|de)\s*\d{1,2}\s*$/i, "").trim() || description;
}

/** Purchases still being paid. Remaining amounts repeat the latest installment, since the plan itself is never stored. */
export function installmentPlans(txs: FinTx[], today: string, accountIds?: string[]): InstallmentPlan[] {
  const out: InstallmentPlan[] = [];
  for (const purchase of installmentPurchases(applyFilters(txs, null, { accountIds }))) {
    const rows = [...purchase].sort((a, b) => a.installmentNumber! - b.installmentNumber!);
    const anchor = rows.filter((t) => t.date <= today).at(-1);
    const first = rows[0]!;
    const total = first.installmentTotal!;
    const installmentCents = -first.amountCents;
    const base = anchor ?? first;
    // Rows dated in the future are not charged yet; without any posted row the first one is the next charge.
    let current = anchor ? anchor.installmentNumber! : first.installmentNumber! - 1;
    let nextDate = anchor ? addMonths(anchor.date, 1) : first.date;
    const posted = current;
    while (nextDate < today && current < total) {
      current += 1;
      nextDate = addMonths(base.date, current + 1 - base.installmentNumber!);
    }
    if (current >= total) continue;
    const remaining = total - current;
    out.push({
      key: first.id,
      accountId: first.accountId,
      label: installmentLabel(first.description),
      installmentCents,
      total,
      current,
      remaining,
      nextDate,
      lastDate: addMonths(base.date, total - base.installmentNumber!),
      firstDate: first.date,
      chargedCents: installmentCents * current,
      remainingCents: installmentCents * remaining,
      estimated: current !== posted,
      listed: rows.filter((t) => t.date > today).map((t) => t.installmentNumber!),
    });
  }
  return out.sort((a, b) => a.nextDate.localeCompare(b.nextDate) || a.label.localeCompare(b.label));
}

/** Installments still to be charged in each of the next `months` calendar months, starting with this one. */
export function installmentSchedule(plans: InstallmentPlan[], today: string, months = 6): { month: string; cents: number; count: number }[] {
  const first = startOfMonth(today);
  return Array.from({ length: months }, (_, i) => {
    const month = addMonths(first, i);
    const due = plans.filter((p) => Array.from({ length: p.remaining }, (_, k) => addMonths(p.nextDate, k).slice(0, 7)).includes(month.slice(0, 7)));
    return { month, cents: sumCents(due.map((p) => p.installmentCents)), count: due.length };
  });
}

export type MonthInstallment = { key: string; accountId: string; label: string; number: number; total: number; cents: number; date: string; projected: boolean };

/**
 * Installments of one calendar month (YYYY-MM): what was charged up to today, finished purchases included, plus the
 * forecast of purchases still open. A forecast repeats the latest installment and may land in another statement.
 */
export function installmentsInMonth(txs: FinTx[], today: string, month: string, accountIds?: string[]): { month: string; items: MonthInstallment[]; cents: number; count: number } {
  const charged: MonthInstallment[] = applyFilters(txs, null, { accountIds })
    .filter((t) => t.installmentNumber && t.installmentTotal && t.amountCents < 0 && t.date <= today && t.date.slice(0, 7) === month)
    .map((t) => ({ key: t.id, accountId: t.accountId, label: installmentLabel(t.description), number: t.installmentNumber!, total: t.installmentTotal!, cents: -t.amountCents, date: t.date, projected: false }));
  // Listed by the bank with a later date: real, but not charged yet.
  const listed: MonthInstallment[] = applyFilters(txs, null, { accountIds })
    .filter((t) => t.installmentNumber && t.installmentTotal && t.amountCents < 0 && t.date > today && t.date.slice(0, 7) === month)
    .map((t) => ({ key: t.id, accountId: t.accountId, label: installmentLabel(t.description), number: t.installmentNumber!, total: t.installmentTotal!, cents: -t.amountCents, date: t.date, projected: true }));
  const forecast: MonthInstallment[] = installmentPlans(txs, today, accountIds).flatMap((p) =>
    Array.from({ length: p.remaining }, (_, k) => ({ k, date: addMonths(p.nextDate, k) }))
      .filter(({ k, date }) => !p.listed.includes(p.current + 1 + k) && date.slice(0, 7) === month)
      .map(({ k, date }) => ({ key: `${p.key}-${p.current + 1 + k}`, accountId: p.accountId, label: p.label, number: p.current + 1 + k, total: p.total, cents: p.installmentCents, date, projected: true })),
  );
  const items = [...charged, ...listed, ...forecast].sort((a, b) => a.date.localeCompare(b.date) || a.label.localeCompare(b.label));
  return { month, items, cents: sumCents(items.map((i) => i.cents)), count: items.length };
}

export type CardOverview = {
  id: string;
  name: string;
  institution: string;
  info: CardInfo | null;
  statements: CardStatement[];
  next: CardStatement | null;
  plans: InstallmentPlan[];
  openCents: number;
  limitCents: number;
  /** The bank's available limit when it reports one; otherwise limit minus what was posted (an estimate). */
  leftCents: number;
  leftFromBank: boolean;
  closingDayEstimated: boolean;
  /** Linked recently: the bank's bills were not read yet, so cycles still use the fixed day. */
  calibrating: boolean;
  futureInstallmentsCents: number;
};

export function cardOverviews(balances: AccountBalance[], cards: CardInfo[], given: FinTx[], categories: FinCategory[], today: string): CardOverview[] {
  const txs = withChargeDates(cards, given, today);
  return balances
    .filter((b) => b.type === "credit_card")
    .map((b) => {
      const info = cards.find((c) => c.accountId === b.id) ?? null;
      const statements = info ? cardStatements(info, txs, categories, today) : [];
      const plans = installmentPlans(txs, today, [b.id]);
      const summary = info ? creditCardSummary(info, txs, categories, b.balanceCents, today, statements[0]) : null;
      return {
        id: b.id,
        name: b.name,
        institution: b.institution,
        info,
        statements,
        next: nextStatement(statements, today),
        plans,
        openCents: Math.max(0, -b.balanceCents),
        limitCents: summary?.limitCents ?? 0,
        leftCents: info?.availableCents ?? summary?.availableCents ?? 0,
        leftFromBank: info?.availableCents != null,
        closingDayEstimated: !!info && info.closingDaySource === "estimated" && !usesBankDates(info) && !calibratingNow(info),
        calibrating: !!info && calibratingNow(info),
        futureInstallmentsCents: sumCents(plans.map((p) => p.remainingCents)),
      };
    });
}

/** Cards with something posted for a due date inside the window, closest first. */
export function cardsDueSoon(overviews: CardOverview[], today: string, days = 7): CardOverview[] {
  return overviews
    .filter((o) => o.next && o.next.totalCents > 0 && diffDays(today, o.next.dueDate) <= days)
    .sort((a, b) => a.next!.dueDate.localeCompare(b.next!.dueDate));
}
