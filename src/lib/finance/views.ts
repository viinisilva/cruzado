// Presentation-only calculations built on core.ts: they reshape numbers for charts and lists, never redefine them.
import { endOfMonth, formatDateBR, type DateRange } from "../dates";
import { changeBasisPoints, sumCents } from "../money";
import { cashFlow, spendingByCategory, type FinCategory, type FinTx, type RecurringItem } from "./core";

/** Expense accumulated day by day over `range`, with the same expense rule as cashFlow. One point per day. */
export function cumulativeSpend(txs: FinTx[], categories: FinCategory[], range: DateRange): { date: string; day: number; cents: number }[] {
  let total = 0;
  return cashFlow(txs, categories, range, {}, "day").buckets.map((b, i) => {
    total += b.expenseCents;
    return { date: b.from, day: i + 1, cents: total };
  });
}

export type CategoryRow = { categoryId: string; name: string; totalCents: number; previousCents: number; count: number; shareBp: number; changeBp: number | null };

/** Spending per category in `range`, in spendingByCategory's order, with its share and the change against `previous`. */
export function categoryComparison(txs: FinTx[], categories: FinCategory[], range: DateRange, previous: DateRange): { totalCents: number; rows: CategoryRow[] } {
  const now = spendingByCategory(txs, categories, range);
  const before = new Map(spendingByCategory(txs, categories, previous).categories.map((c) => [c.categoryId, c.totalCents]));
  const rows = now.categories.map((c) => {
    const previousCents = before.get(c.categoryId) ?? 0;
    return {
      categoryId: c.categoryId,
      name: c.name,
      totalCents: c.totalCents,
      previousCents,
      count: c.count,
      shareBp: now.totalCents > 0 ? Math.round((c.totalCents * 10000) / now.totalCents) : 0,
      // A refund-only or empty previous period is no base: a percent against it would be arbitrary.
      changeBp: previousCents > 0 ? changeBasisPoints(previousCents, c.totalCents) : null,
    };
  });
  return { totalCents: now.totalCents, rows };
}

/** Outgoing subscriptions (installments live with the cards) and recurring income, with a monthly and yearly estimate. */
export function recurringSummary(items: RecurringItem[]): { subscriptions: RecurringItem[]; incomes: RecurringItem[]; monthlyCents: number; yearlyCents: number } {
  const subscriptions = items.filter((i) => i.kind === "subscription" && i.amountCents < 0).sort((a, b) => a.nextDate.localeCompare(b.nextDate));
  const incomes = items.filter((i) => i.kind === "income");
  const monthlyCents = sumCents(subscriptions.map((s) => -s.amountCents));
  return { subscriptions, incomes, monthlyCents, yearlyCents: monthlyCents * 12 };
}

const CATEGORY_COLORS = new Set(["amber", "cyan", "emerald", "fuchsia", "indigo", "orange", "rose", "sky", "slate", "teal", "violet"]);

/** CSS color for a saved category color name. Only known names pass, so a stored value can never inject CSS. */
export function categoryColor(name: string | undefined | null): string {
  return `var(--cat-${name && CATEGORY_COLORS.has(name) ? name : "slate"})`;
}

/** How much of a month a range covers, in words: complete, or up to which day. */
export function monthCoverage(range: DateRange): string {
  return range.to === endOfMonth(range.from) ? "Mês completo." : `Até ${formatDateBR(range.to)}.`;
}
