// Deterministic agent evaluators: (rule, data, today) -> notifications. No LLM involved.
import { addDays, formatDateBR, formatRangeBR, startOfWeek, type DateRange } from "../dates";
import { formatBRL, formatBasisPoints } from "../money";
import { plural, sanitizeUntrusted } from "../text";
import { applyFilters, comparePeriods, detectPossibleDuplicates, isTransfer, spendingByCategory, type FinCategory, type FinTx } from "../finance/core";
import { previousComparableRange } from "../finance/period";
import { normalizeRule, type AgentRule, type Schedule } from "./rule";
import type { NotificationLink } from "@/db/schema";

export type DraftNotification = {
  dedupeKey: string;
  severity: "info" | "attention" | "risk";
  title: string;
  body: string;
  links: NotificationLink[];
};

export type Evaluation = { periodKey: string; notifications: DraftNotification[]; summary: Record<string, number | string> };

export function periodKeyFor(schedule: Schedule, today: string): string {
  switch (schedule) {
    case "continuous":
    case "daily":
      return today;
    case "weekly_monday":
      return startOfWeek(today);
    case "monthly_first":
      return today.slice(0, 7);
  }
}

/** Whether a scheduled run may start now. Weekly/monthly runs open at 08:00 São Paulo and catch up later in the period. */
export function isDue(schedule: Schedule, today: string, hour: number): boolean {
  if (schedule === "weekly_monday" && today === startOfWeek(today)) return hour >= 8;
  if (schedule === "monthly_first" && today.endsWith("-01")) return hour >= 8;
  return true;
}

const txLink = (t: FinTx): NotificationLink => ({
  label: `${formatDateBR(t.date)} · ${sanitizeUntrusted(t.description, 40)} · ${formatBRL(t.amountCents)}`,
  href: `/transacoes/${t.id}`,
});

const rangeLink = (r: DateRange, label: string, categoryId?: string): NotificationLink => {
  const p = new URLSearchParams({ de: r.from, ate: r.to });
  if (categoryId && categoryId !== "sem-categoria") p.set("categoria", categoryId);
  return { label, href: `/transacoes?${p.toString()}` };
};

export function evaluate(
  ruleId: string,
  input: AgentRule,
  data: { transactions: FinTx[]; categories: FinCategory[] },
  today: string,
): Evaluation {
  const rule = normalizeRule(input);
  const periodKey = periodKeyFor(rule.schedule, today);
  const filters = { accountIds: rule.filters?.accountIds, categoryIds: rule.filters?.categoryIds };
  const cats = new Map(data.categories.map((c) => [c.id, c]));

  switch (rule.kind) {
    case "daily_spend_limit": {
      const day = { from: today, to: today };
      const spend = spendingByCategory(data.transactions, data.categories, day, filters);
      const limit = rule.thresholdCents ?? 0;
      const ids = new Set(spend.categories.flatMap((c) => c.transactionIds));
      const dayTxs = data.transactions.filter((t) => ids.has(t.id)).sort((a, b) => a.amountCents - b.amountCents);
      const notifications: DraftNotification[] =
        spend.totalCents > limit
          ? [
              {
                dedupeKey: `daily_limit:${ruleId}:${today}`,
                severity: "attention",
                title: `${rule.name}: limite diário ultrapassado`,
                // Stored and read later, so it names the date instead of saying "today".
                body: `Em ${formatDateBR(today)} as despesas somaram ${formatBRL(spend.totalCents)}, acima do limite de ${formatBRL(limit)} (${formatBRL(spend.totalCents - limit)} a mais). ${plural(dayTxs.length, "transação considerada", "transações consideradas")}.`,
                links: [...dayTxs.slice(0, 5).map(txLink), rangeLink(day, "Ver todas as despesas de hoje")],
              },
            ]
          : [];
      return { periodKey, notifications, summary: { totalCents: spend.totalCents, limitCents: limit } };
    }

    case "weekly_summary": {
      const start = addDays(startOfWeek(today), -7);
      const week = { from: start, to: addDays(start, 6) };
      const before = { from: addDays(start, -7), to: addDays(start, -1) };
      const cmp = comparePeriods(data.transactions, data.categories, week, before, filters);
      const top = [...cmp.categories].filter((c) => c.currentCents > 0).sort((a, b) => b.currentCents - a.currentCents).slice(0, 3);
      const movers = cmp.categories.filter((c) => Math.abs(c.changeCents) >= 5000).slice(0, 2);
      const weekTxs = applyFilters(data.transactions, week, filters).filter((t) => !isTransfer(t, cats));
      const income = weekTxs.filter((t) => t.amountCents > 0 && cats.get(t.categoryId ?? "")?.kind === "income").reduce((n, t) => n + t.amountCents, 0);
      const body =
        cmp.current.totalCents === 0
          ? `Não houve despesas registradas na semana de ${formatRangeBR(week)}.`
          : [
              `Semana de ${formatRangeBR(week)}: despesas de ${formatBRL(cmp.current.totalCents)} (semana anterior: ${formatBRL(cmp.previous.totalCents)}, ${formatBasisPoints(cmp.totalChangeBp)}).`,
              income ? `Receitas: ${formatBRL(income)}.` : "",
              `Principais categorias: ${top.map((c) => `${c.name} ${formatBRL(c.currentCents)}`).join(", ")}.`,
              movers.length ? `Variações relevantes: ${movers.map((c) => `${c.name} ${c.changeCents > 0 ? "+" : ""}${formatBRL(c.changeCents)}`).join(", ")}.` : "",
            ]
              .filter(Boolean)
              .join(" ");
      return {
        periodKey,
        notifications: [
          {
            dedupeKey: `weekly:${ruleId}:${week.from}`,
            severity: "info",
            title: `${rule.name}: resumo da semana`,
            body,
            links: [rangeLink(week, "Ver transações da semana"), ...top.slice(0, 2).map((c) => rangeLink(week, `${c.name} na semana`, c.categoryId))],
          },
        ],
        summary: { totalCents: cmp.current.totalCents, previousCents: cmp.previous.totalCents },
      };
    }

    case "possible_duplicate": {
      const window = { from: addDays(today, -29), to: today };
      const pairs = detectPossibleDuplicates(applyFilters(data.transactions, window, filters));
      return {
        periodKey,
        notifications: pairs.map((p) => ({
          dedupeKey: `duplicate:${ruleId}:${p.a.id}:${p.b.id}`,
          severity: "attention" as const,
          title: "Possível cobrança duplicada",
          body: `${sanitizeUntrusted(p.a.description, 50)}: ${formatBRL(p.a.amountCents)} em ${formatDateBR(p.a.date)} e ${formatBRL(p.b.amountCents)} em ${formatDateBR(p.b.date)} (${p.reason}). Isto é apenas uma suspeita para você conferir — não indica fraude.`,
          links: [txLink(p.a), txLink(p.b)],
        })),
        summary: { pairs: pairs.length },
      };
    }

    case "monthly_comparison": {
      const current = { from: `${today.slice(0, 7)}-01`, to: today };
      const previous = previousComparableRange(current);
      const cmp = comparePeriods(data.transactions, data.categories, current, previous, filters);
      const byAbs = cmp.categories.filter((c) => c.changeCents !== 0).slice(0, 3);
      const byPct = cmp.categories
        .filter((c) => c.changeBp !== null && c.previousCents >= 5000)
        .sort((a, b) => Math.abs(b.changeBp!) - Math.abs(a.changeBp!))[0];
      const parts = [
        `De ${formatRangeBR(current)} você gastou ${formatBRL(cmp.current.totalCents)}, contra ${formatBRL(cmp.previous.totalCents)} no mesmo intervalo do mês anterior (${formatRangeBR(previous)}; ${formatBasisPoints(cmp.totalChangeBp)}).`,
        byAbs.length ? `Maiores variações em valor: ${byAbs.map((c) => `${c.name} ${c.changeCents > 0 ? "+" : ""}${formatBRL(c.changeCents)}`).join(", ")}.` : "",
        byPct ? `Maior variação percentual: ${byPct.name} (${formatBasisPoints(byPct.changeBp)}).` : "",
      ];
      return {
        periodKey,
        notifications: [
          {
            dedupeKey: `monthly:${ruleId}:${periodKey}`,
            severity: cmp.totalChangeBp !== null && cmp.totalChangeBp > 2000 ? "attention" : "info",
            title: `${rule.name}: mês atual vs. anterior`,
            body: parts.filter(Boolean).join(" "),
            links: byAbs.slice(0, 2).flatMap((c) => [rangeLink(current, `${c.name} neste mês`, c.categoryId)]),
          },
        ],
        summary: { currentCents: cmp.current.totalCents, previousCents: cmp.previous.totalCents },
      };
    }
  }
}
