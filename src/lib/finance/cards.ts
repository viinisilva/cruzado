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

/** A pending entry this close to the closing may simply post late, into the next bill (see `carriedOver`). */
export const LATE_POST_DAYS = 5;

type StatementRef = { cycle: DateRange; billRef: string | null };

/** Untagged pending entries dated inside a closed bill that the bank tags: the bank closed it without them. */
function leftOut(card: CardInfo, statement: StatementRef, txs: FinTx[], categories: FinCategory[]): FinTx[] {
  const { cycle, billRef } = statement;
  if (!billRef) return [];
  const mine = applyFilters(txs, null, { accountIds: [card.accountId] });
  if (!mine.some((t) => t.billRef === billRef)) return [];
  const cats = new Map(categories.map((c) => [c.id, c]));
  const known = new Set(card.bills?.map((b) => b.billRef) ?? []);
  return mine.filter((t) => t.bankStatus === "pending" && !(t.billRef && known.has(t.billRef)) && !isTransfer(t, cats) && t.date >= cycle.from && t.date <= cycle.to);
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
  if (statement.billRef && txs.some((t) => t.accountId === card.accountId && t.billRef === statement.billRef)) return [];
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
  return {
    accountId: card.accountId,
    cycle,
    dueDate: bill?.dueDate ?? slot.dueDate,
    status,
    chargesCents,
    refundsCents,
    totalCents: bill?.totalCents ?? computedCents,
    computedCents,
    bankTotalCents: bill?.totalCents ?? null,
    minimumCents: bill?.minimumCents ?? null,
    billRef: bill?.billRef ?? null,
    previous,
    count: rows.length,
    matchesRange,
    paymentsCents: sumCents(payments.map((t) => t.amountCents)),
    paymentWindow,
    closingSource: slot.source,
    closing: slot.closing,
    closingRange: slot.closingRange,
  };
}

/** The current cycle and the ones before it, newest first. Totals follow creditCardSummary: no bill payments or transfers. */
export function cardStatements(card: CardInfo, txs: FinTx[], categories: FinCategory[], today: string, count = 6): CardStatement[] {
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
export function statementForMonth(card: CardInfo, txs: FinTx[], categories: FinCategory[], today: string, month: string): CardStatement | null {
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
  return { accountId: card.accountId, cycle, dueDate, status: "future", chargesCents, refundsCents: 0, totalCents: chargesCents, computedCents: chargesCents, bankTotalCents: null, minimumCents: null, billRef: null, previous: null, count: due.length, matchesRange: true, paymentsCents: 0, paymentWindow: null, closingSource: source, closing, closingRange };
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

export function cardOverviews(balances: AccountBalance[], cards: CardInfo[], txs: FinTx[], categories: FinCategory[], today: string): CardOverview[] {
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
