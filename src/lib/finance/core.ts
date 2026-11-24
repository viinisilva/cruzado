// Deterministic financial calculations. Pure functions over integer cents; no I/O, no LLM.
import { addDays, addMonths, daysInMonth, diffDays, inRange, type DateRange } from "../dates";
import { changeBasisPoints, sumCents } from "../money";
import type { CardCalibration } from "./cycles";
import type { BillPayment, CategorySource, Classification } from "./classify";

export type FinTx = {
  id: string;
  accountId: string;
  categoryId: string | null;
  date: string;
  description: string;
  merchant: string;
  amountCents: number; // negative = expense
  installmentNumber: number | null;
  installmentTotal: number | null;
  bankStatus?: "pending" | "posted" | null;
  /** Card entries only: hash of the bank's bill id, when the bank said which bill it belongs to. */
  billRef?: string | null;
  /** Open Finance operation type as sent (PAGAMENTO, ESTORNO…): a signal for classification, never the decision. */
  operationType?: string | null;
  /** Who set the category; "user" is never changed by any automatic step. */
  categorySource?: CategorySource | null;
  classification?: Classification | null;
  /** Set by chargeDated (cards.ts): the bank sent this installment with the purchase date, kept here; date is when it is charged. */
  purchaseDate?: string;
  /** Set by projectInstallments (cards.ts): an installment the bank never sent, counted as "prevista". Never stored. */
  projected?: true;
  /** Stable key of a prevista, what the person's "Excluir" stores (credit_cards.dismissed_projections). */
  projectionKey?: string;
};

export type FinCategory = { id: string; name: string; slug: string; kind: "expense" | "income" | "transfer" };

export type FinAccount = {
  id: string;
  name: string;
  institution: string;
  type: "checking" | "savings" | "credit_card" | "cash";
  openingBalanceCents: number;
};

export type TxFilters = { accountIds?: string[]; categoryIds?: string[] };

const UNCATEGORIZED = { id: "sem-categoria", name: "Sem categoria", slug: "sem-categoria", kind: "expense" } as const;

function categoryMap(categories: FinCategory[]): Map<string, FinCategory> {
  return new Map(categories.map((c) => [c.id, c]));
}

/** Transfers between own accounts (incl. card bill payments) are not income or spending. */
export function isTransfer(tx: FinTx, cats: Map<string, FinCategory>): boolean {
  return tx.categoryId ? cats.get(tx.categoryId)?.kind === "transfer" : false;
}

export function applyFilters(txs: FinTx[], range: DateRange | null, filters: TxFilters = {}): FinTx[] {
  const acc = filters.accountIds?.length ? new Set(filters.accountIds) : null;
  const cat = filters.categoryIds?.length ? new Set(filters.categoryIds) : null;
  return txs.filter(
    (t) =>
      (!range || inRange(t.date, range)) &&
      (!acc || acc.has(t.accountId)) &&
      (!cat || (t.categoryId !== null && cat.has(t.categoryId))),
  );
}

export type CategorySpend = {
  categoryId: string;
  name: string;
  totalCents: number; // positive number = money spent (refunds reduce it)
  count: number;
  transactionIds: string[];
};

export function spendingByCategory(
  txs: FinTx[],
  categories: FinCategory[],
  range: DateRange,
  filters: TxFilters = {},
): { categories: CategorySpend[]; totalCents: number } {
  const cats = categoryMap(categories);
  const groups = new Map<string, CategorySpend>();
  for (const t of applyFilters(txs, range, filters)) {
    if (isTransfer(t, cats)) continue;
    const cat = t.categoryId ? cats.get(t.categoryId) : undefined;
    // Income-category entries are not spending; refunds inside expense categories offset spending.
    if (cat?.kind === "income") continue;
    if (!cat && t.amountCents > 0) continue;
    const key = cat?.id ?? UNCATEGORIZED.id;
    const g = groups.get(key) ?? { categoryId: key, name: cat?.name ?? UNCATEGORIZED.name, totalCents: 0, count: 0, transactionIds: [] };
    g.totalCents -= t.amountCents;
    g.count += 1;
    g.transactionIds.push(t.id);
    groups.set(key, g);
  }
  const list = [...groups.values()].filter((g) => g.count > 0).sort((a, b) => b.totalCents - a.totalCents || a.name.localeCompare(b.name));
  return { categories: list, totalCents: sumCents(list.map((g) => g.totalCents)) };
}

export type CashFlow = {
  incomeCents: number;
  expenseCents: number; // positive
  netCents: number;
  incomeTransactionIds: string[];
  expenseTransactionIds: string[];
  buckets: { label: string; from: string; to: string; incomeCents: number; expenseCents: number }[];
};

export function cashFlow(
  txs: FinTx[],
  categories: FinCategory[],
  range: DateRange,
  filters: TxFilters = {},
  bucket: "day" | "week" | "month" = "week",
): CashFlow {
  const cats = categoryMap(categories);
  const relevant = applyFilters(txs, range, filters).filter((t) => !isTransfer(t, cats));
  const income = relevant.filter((t) => t.amountCents > 0 && (!t.categoryId || cats.get(t.categoryId)?.kind !== "expense"));
  const incomeSet = new Set(income);
  const expense = relevant.filter((t) => !incomeSet.has(t));
  const buckets = makeBuckets(range, bucket).map((b) => {
    const inB = relevant.filter((t) => inRange(t.date, b));
    return {
      ...b,
      incomeCents: sumCents(inB.filter((t) => incomeSet.has(t)).map((t) => t.amountCents)),
      expenseCents: -sumCents(inB.filter((t) => !incomeSet.has(t)).map((t) => t.amountCents)),
    };
  });
  const incomeCents = sumCents(income.map((t) => t.amountCents));
  const expenseCents = -sumCents(expense.map((t) => t.amountCents));
  return {
    incomeCents,
    expenseCents,
    netCents: incomeCents - expenseCents,
    incomeTransactionIds: income.map((t) => t.id),
    expenseTransactionIds: expense.map((t) => t.id),
    buckets,
  };
}

function makeBuckets(range: DateRange, kind: "day" | "week" | "month") {
  const out: { label: string; from: string; to: string }[] = [];
  let cursor = range.from;
  let guard = 0;
  while (cursor <= range.to && guard++ < 400) {
    let end: string;
    if (kind === "day") end = cursor;
    else if (kind === "week") end = addDays(cursor, 6);
    else {
      const [y, m] = cursor.split("-").map(Number) as [number, number];
      end = `${cursor.slice(0, 7)}-${String(daysInMonth(y, m)).padStart(2, "0")}`;
    }
    if (end > range.to) end = range.to;
    const label = kind === "month" ? cursor.slice(0, 7) : `${cursor.slice(8, 10)}/${cursor.slice(5, 7)}`;
    out.push({ label, from: cursor, to: end });
    cursor = addDays(end, 1);
  }
  return out;
}

export type PeriodComparison = {
  current: { range: DateRange; totalCents: number };
  previous: { range: DateRange; totalCents: number };
  totalChangeCents: number;
  totalChangeBp: number | null;
  categories: {
    categoryId: string;
    name: string;
    currentCents: number;
    previousCents: number;
    changeCents: number;
    changeBp: number | null;
    currentTransactionIds: string[];
    previousTransactionIds: string[];
  }[];
};

export function comparePeriods(
  txs: FinTx[],
  categories: FinCategory[],
  current: DateRange,
  previous: DateRange,
  filters: TxFilters = {},
): PeriodComparison {
  const a = spendingByCategory(txs, categories, current, filters);
  const b = spendingByCategory(txs, categories, previous, filters);
  const ids = new Set([...a.categories.map((c) => c.categoryId), ...b.categories.map((c) => c.categoryId)]);
  const rows = [...ids].map((id) => {
    const cur = a.categories.find((c) => c.categoryId === id);
    const prev = b.categories.find((c) => c.categoryId === id);
    const currentCents = cur?.totalCents ?? 0;
    const previousCents = prev?.totalCents ?? 0;
    return {
      categoryId: id,
      name: cur?.name ?? prev?.name ?? "",
      currentCents,
      previousCents,
      changeCents: currentCents - previousCents,
      changeBp: changeBasisPoints(previousCents, currentCents),
      currentTransactionIds: cur?.transactionIds ?? [],
      previousTransactionIds: prev?.transactionIds ?? [],
    };
  });
  rows.sort((x, y) => Math.abs(y.changeCents) - Math.abs(x.changeCents) || x.name.localeCompare(y.name));
  return {
    current: { range: current, totalCents: a.totalCents },
    previous: { range: previous, totalCents: b.totalCents },
    totalChangeCents: a.totalCents - b.totalCents,
    totalChangeBp: changeBasisPoints(b.totalCents, a.totalCents),
    categories: rows,
  };
}

export type DuplicatePair = {
  a: FinTx;
  b: FinTx;
  daysApart: number;
  reason: string;
};

/**
 * Possible duplicates: same account, same normalized merchant, amounts within 1% (min R$ 0,01)
 * and dates within `windowDays`. Different installments of one purchase are never paired.
 * Output is a suspicion for human review — never a confirmed fraud.
 */
export function detectPossibleDuplicates(txs: FinTx[], options: { windowDays?: number } = {}): DuplicatePair[] {
  const windowDays = options.windowDays ?? 3;
  const expenses = txs.filter((t) => t.amountCents < 0).sort((x, y) => x.date.localeCompare(y.date) || x.id.localeCompare(y.id));
  const pairs: DuplicatePair[] = [];
  const used = new Set<string>();
  for (let i = 0; i < expenses.length; i++) {
    const a = expenses[i]!;
    if (used.has(a.id)) continue;
    for (let j = i + 1; j < expenses.length; j++) {
      const b = expenses[j]!;
      const days = diffDays(a.date, b.date);
      if (days > windowDays) break;
      if (used.has(b.id) || a.accountId !== b.accountId || a.merchant !== b.merchant) continue;
      if (a.installmentTotal && b.installmentTotal && a.installmentNumber !== b.installmentNumber) continue;
      const diff = Math.abs(a.amountCents - b.amountCents);
      const tolerance = Math.max(1, Math.floor(Math.abs(a.amountCents) / 100));
      if (diff > tolerance) continue;
      pairs.push({
        a,
        b,
        daysApart: days,
        reason: diff === 0 ? "mesmo estabelecimento e mesmo valor" : "mesmo estabelecimento e valor muito próximo",
      });
      used.add(a.id);
      used.add(b.id);
      break;
    }
  }
  return pairs;
}

export type RecurringItem = {
  merchant: string;
  label: string;
  kind: "subscription" | "installment" | "income";
  accountId: string;
  categoryId: string | null;
  amountCents: number;
  nextDate: string;
  remainingInstallments: number | null;
  lastTransactionId: string;
  transactionIds: string[];
};

/**
 * Rows of each installment purchase. The month a purchase started tells two purchases at one store apart; neighbouring
 * months join when no installment number repeats, because a bank can post the 30th on the 1st and that is still one purchase.
 */
export function installmentPurchases(txs: FinTx[]): FinTx[][] {
  const stores = new Map<string, Map<string, FinTx[]>>();
  for (const t of txs) {
    if (!t.installmentNumber || !t.installmentTotal || t.amountCents >= 0) continue;
    const key = [t.accountId, t.merchant, t.installmentTotal, t.amountCents].join("|");
    const started = addMonths(`${t.date.slice(0, 7)}-01`, 1 - t.installmentNumber).slice(0, 7);
    const months = stores.get(key) ?? new Map<string, FinTx[]>();
    months.set(started, [...(months.get(started) ?? []), t]);
    stores.set(key, months);
  }
  return [...stores.values()].flatMap((months) => {
    const purchases: { month: string; rows: FinTx[] }[] = [];
    for (const [month, rows] of [...months].sort(([a], [b]) => a.localeCompare(b))) {
      const last = purchases.at(-1);
      const adjacent = last && addMonths(`${last.month}-01`, 1).slice(0, 7) === month;
      if (adjacent && !last.rows.some((r) => rows.some((t) => t.installmentNumber === r.installmentNumber))) {
        last.rows.push(...rows);
        last.month = month;
      } else {
        purchases.push({ month, rows: [...rows] });
      }
    }
    return purchases.map((p) => p.rows);
  });
}

/**
 * Recurring charges: same merchant in at least 2 distinct consecutive months with amounts within 10%
 * and day-of-month within ±5 days. Installments: latest entry of each purchase whose number < total.
 */
export function detectRecurring(txs: FinTx[], categories: FinCategory[], today: string): RecurringItem[] {
  const cats = categoryMap(categories);
  const out: RecurringItem[] = [];

  for (const rows of installmentPurchases(txs)) {
    const t = rows.reduce((latest, x) => (x.date > latest.date ? x : latest));
    if (t.installmentNumber! >= t.installmentTotal!) continue;
    let next = addMonths(t.date, 1);
    let remaining = t.installmentTotal! - t.installmentNumber!;
    while (next < today && remaining > 0) {
      next = addMonths(next, 1);
      remaining -= 1;
    }
    // All installments are already in the past: nothing left to charge.
    if (remaining === 0) continue;
    out.push({
      merchant: t.merchant,
      label: t.description.replace(/\s*\d{1,2}\s*\/\s*\d{1,2}\s*$/, "").trim(),
      kind: "installment",
      accountId: t.accountId,
      categoryId: t.categoryId,
      amountCents: t.amountCents,
      nextDate: next,
      remainingInstallments: remaining,
      lastTransactionId: t.id,
      transactionIds: rows.map((x) => x.id),
    });
  }

  const byMerchant = new Map<string, FinTx[]>();
  for (const t of txs) {
    if (t.installmentTotal || isTransfer(t, cats)) continue;
    const key = `${t.accountId}|${t.merchant}`;
    const list = byMerchant.get(key) ?? [];
    list.push(t);
    byMerchant.set(key, list);
  }
  for (const list of byMerchant.values()) {
    const merchant = list[0]!.merchant;
    const sorted = [...list].sort((x, y) => x.date.localeCompare(y.date));
    // One entry per month (the first); several per month means it is not a monthly charge.
    const perMonth = new Map<string, FinTx[]>();
    for (const t of sorted) perMonth.set(t.date.slice(0, 7), [...(perMonth.get(t.date.slice(0, 7)) ?? []), t]);
    if (perMonth.size < 2 || [...perMonth.values()].some((v) => v.length > 1)) continue;
    const monthly = [...perMonth.values()].map((v) => v[0]!);
    const consecutive = monthly.every((t, i) => i === 0 || addMonths(`${monthly[i - 1]!.date.slice(0, 7)}-01`, 1).slice(0, 7) === t.date.slice(0, 7));
    if (!consecutive) continue;
    const last = monthly[monthly.length - 1]!;
    const sameSign = monthly.every((t) => Math.sign(t.amountCents) === Math.sign(last.amountCents));
    const closeAmounts = monthly.every((t) => Math.abs(t.amountCents - last.amountCents) <= Math.abs(last.amountCents) / 10);
    const days = monthly.map((t) => Number(t.date.slice(8, 10)));
    const closeDays = Math.max(...days) - Math.min(...days) <= 5;
    if (!sameSign || !closeAmounts || !closeDays) continue;
    // Stale: no charge in the last ~45 days means it probably stopped.
    if (diffDays(last.date, today) > 45) continue;
    let next = addMonths(last.date, 1);
    while (next < today) next = addMonths(next, 1);
    out.push({
      merchant,
      label: last.description,
      kind: last.amountCents > 0 ? "income" : "subscription",
      accountId: last.accountId,
      categoryId: last.categoryId,
      amountCents: last.amountCents,
      nextDate: next,
      remainingInstallments: null,
      lastTransactionId: last.id,
      transactionIds: monthly.map((t) => t.id),
    });
  }
  return out.sort((x, y) => x.nextDate.localeCompare(y.nextDate) || x.label.localeCompare(y.label));
}

export type AccountBalance = FinAccount & { balanceCents: number };

export function accountBalances(accounts: FinAccount[], txs: FinTx[], asOf?: string): AccountBalance[] {
  return accounts.map((a) => ({
    ...a,
    balanceCents: a.openingBalanceCents + sumCents(txs.filter((t) => t.accountId === a.id && (!asOf || t.date <= asOf)).map((t) => t.amountCents)),
  }));
}

export function consolidatedBalance(balances: AccountBalance[]) {
  const cash = balances.filter((b) => b.type !== "credit_card");
  const cards = balances.filter((b) => b.type === "credit_card");
  const availableCents = sumCents(cash.map((b) => b.balanceCents));
  // Card balance is negative when there is an open bill.
  const cardDebtCents = -sumCents(cards.map((b) => Math.min(0, b.balanceCents)));
  return { availableCents, cardDebtCents, netCents: availableCents - cardDebtCents, accountIds: cash.map((b) => b.id) };
}

/** A bill as the card issuer reported it. Its total is the bank's figure; nothing here derives it. */
export type BankBill = { billRef: string; dueDate: string; closingDate: string | null; totalCents: number; minimumCents: number | null; payments?: BillPayment[] | null };

export type CardInfo = {
  accountId: string;
  limitCents: number;
  closingDay: number;
  dueDay: number;
  /** "estimated" when no bank bill or person ever said which day the card closes. */
  closingDaySource?: "bank" | "user" | "estimated" | null;
  /** Available limit reported by the bank, when it reports one. */
  availableCents?: number | null;
  bills?: BankBill[];
  /** What the last sync learned about this card (docs/CALIBRACAO_CARTAO.md). */
  calibration?: CardCalibration | null;
  /** True once the bank's bills were asked for at least once, whatever the answer. */
  billsChecked?: boolean;
  /** Previstas the person excluded (projectionKey of each): they are never projected again. */
  dismissedProjections?: string[];
};

/** Statement cycle that contains `today`: (previous closing day + 1) … closing day. */
export function currentStatementCycle(card: CardInfo, today: string): { cycle: DateRange; dueDate: string } {
  // Always clamp the configured day to the target month: adding months to an already clamped date would drift.
  const dayIn = (monthStart: string, day: number) => `${monthStart.slice(0, 7)}-${String(Math.min(day, daysInMonth(Number(monthStart.slice(0, 4)), Number(monthStart.slice(5, 7))))).padStart(2, "0")}`;
  const thisMonth = `${today.slice(0, 7)}-01`;
  const closingMonth = today <= dayIn(thisMonth, card.closingDay) ? thisMonth : addMonths(thisMonth, 1);
  const closing = dayIn(closingMonth, card.closingDay);
  const prevClosing = dayIn(addMonths(closingMonth, -1), card.closingDay);
  const sameMonthDue = dayIn(closingMonth, card.dueDay);
  const due = sameMonthDue <= closing ? dayIn(addMonths(closingMonth, 1), card.dueDay) : sameMonthDue;
  return { cycle: { from: addDays(prevClosing, 1), to: closing }, dueDate: due };
}

/** `open`: the open statement's cycle and due date, when the caller already has them from the bank's dates. */
export function creditCardSummary(card: CardInfo, txs: FinTx[], categories: FinCategory[], balance: number, today: string, open?: { cycle: DateRange; dueDate: string }) {
  const cats = categoryMap(categories);
  const { cycle, dueDate } = open ?? currentStatementCycle(card, today);
  // "Posted so far": an installment the bank already dated later is in the bill, not in what was spent until today.
  const cycleTxs = applyFilters(txs, cycle, { accountIds: [card.accountId] }).filter((t) => !isTransfer(t, cats) && t.date <= today);
  const statementCents = -sumCents(cycleTxs.map((t) => t.amountCents));
  const usedCents = Math.max(0, -balance);
  return {
    cycle,
    dueDate,
    statementCents,
    usedCents,
    limitCents: card.limitCents,
    availableCents: Math.max(0, card.limitCents - usedCents),
    transactionIds: cycleTxs.map((t) => t.id),
  };
}

/** A card installment the bank lists with a later date: it waits for that date everywhere except its card bill. */
export function isFutureEntry(t: Pick<FinTx, "bankStatus" | "date">, today: string): boolean {
  return t.bankStatus === "pending" && t.date > today;
}
