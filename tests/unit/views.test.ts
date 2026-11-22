import { describe, expect, it } from "vitest";
import { spendingByCategory, type FinCategory, type FinTx, type RecurringItem } from "@/lib/finance/core";
import { categoryColor, categoryComparison, cumulativeSpend, monthCoverage, recurringSummary } from "@/lib/finance/views";

const cats: FinCategory[] = [
  { id: "c-mercado", name: "Mercado", slug: "mercado", kind: "expense" },
  { id: "c-lazer", name: "Lazer", slug: "lazer", kind: "expense" },
  { id: "c-sal", name: "Salário", slug: "salario", kind: "income" },
  { id: "c-tr", name: "Transferências", slug: "transferencias", kind: "transfer" },
];

let n = 0;
const tx = (date: string, amountCents: number, categoryId: string | null): FinTx => ({
  id: `t${++n}`,
  accountId: "a",
  categoryId,
  date,
  description: `item ${n}`,
  merchant: `item ${n}`,
  amountCents,
  installmentNumber: null,
  installmentTotal: null,
});

const nov = { from: "2026-11-01", to: "2026-11-14" };
const oct = { from: "2026-10-01", to: "2026-10-14" };

describe("cumulativeSpend", () => {
  it("accumulates expenses day by day and ignores income and transfers", () => {
    const txs = [tx("2026-11-01", -1000, "c-mercado"), tx("2026-11-02", 10000, "c-sal"), tx("2026-11-02", -9999, "c-tr"), tx("2026-11-03", -500, "c-lazer")];
    const points = cumulativeSpend(txs, cats, { from: "2026-11-01", to: "2026-11-03" });
    expect(points.map((p) => p.cents)).toEqual([1000, 1000, 1500]);
    expect(points.map((p) => p.day)).toEqual([1, 2, 3]);
    expect(points[2]!.date).toBe("2026-11-03");
  });
});

describe("categoryComparison", () => {
  const txs = [
    tx("2026-11-02", -3000, "c-mercado"),
    tx("2026-11-03", -1000, "c-lazer"),
    tx("2026-11-04", 500, "c-mercado"),
    tx("2026-10-03", -2000, "c-mercado"),
  ];

  it("reports null change when the previous period had nothing", () => {
    const lazer = categoryComparison(txs, cats, nov, oct).rows.find((r) => r.categoryId === "c-lazer")!;
    expect(lazer.previousCents).toBe(0);
    expect(lazer.changeBp).toBeNull();
  });

  it("compares with the previous period and keeps refunds inside the category", () => {
    const mercado = categoryComparison(txs, cats, nov, oct).rows.find((r) => r.categoryId === "c-mercado")!;
    expect(mercado.totalCents).toBe(2500);
    expect(mercado.previousCents).toBe(2000);
    expect(mercado.changeBp).toBe(2500);
  });

  it("matches spendingByCategory in order and total, with shares adding up", () => {
    const r = categoryComparison(txs, cats, nov, oct);
    const base = spendingByCategory(txs, cats, nov);
    expect(r.totalCents).toBe(base.totalCents);
    expect(r.rows.map((x) => x.categoryId)).toEqual(base.categories.map((c) => c.categoryId));
    expect(r.rows.reduce((s, x) => s + x.shareBp, 0)).toBeGreaterThanOrEqual(9999);
    expect(r.rows[0]!.shareBp).toBe(7143);
  });
});

const item = (kind: RecurringItem["kind"], amountCents: number, nextDate = "2026-12-01"): RecurringItem => ({
  merchant: `m${++n}`,
  label: `Item ${n}`,
  kind,
  accountId: "a",
  categoryId: null,
  amountCents,
  nextDate,
  remainingInstallments: kind === "installment" ? 3 : null,
  lastTransactionId: `t${n}`,
  transactionIds: [`t${n}`],
});

describe("recurringSummary", () => {
  it("keeps only outgoing subscriptions, sorted by next date, and projects 12 months", () => {
    const later = item("subscription", -1290, "2026-12-10");
    const sooner = item("subscription", -4490, "2026-11-20");
    const s = recurringSummary([later, sooner, item("installment", -10000), item("income", 500000)]);
    expect(s.subscriptions).toEqual([sooner, later]);
    expect(s.monthlyCents).toBe(5780);
    expect(s.yearlyCents).toBe(69360);
    expect(s.incomes).toHaveLength(1);
  });

  it("is empty with zero totals when nothing was detected", () => {
    expect(recurringSummary([])).toEqual({ subscriptions: [], incomes: [], monthlyCents: 0, yearlyCents: 0 });
  });
});

describe("categoryColor", () => {
  it("maps a saved color name to its theme variable", () => {
    expect(categoryColor("teal")).toBe("var(--cat-teal)");
  });
  it("falls back to slate for unknown, missing or injected names", () => {
    expect(categoryColor(undefined)).toBe("var(--cat-slate)");
    expect(categoryColor("red); background: url(x)")).toBe("var(--cat-slate)");
  });
});

describe("categoryComparison base", () => {
  it("has no change when the previous period was only a refund", () => {
    const txs = [tx("2026-10-05", 500, "c-lazer"), tx("2026-11-05", -1000, "c-lazer")];
    expect(categoryComparison(txs, cats, nov, oct).rows[0]!.changeBp).toBeNull();
  });
});

describe("monthCoverage", () => {
  it("names the last day covered, even on the first day of the month", () => {
    expect(monthCoverage({ from: "2026-11-01", to: "2026-11-01" })).toBe("Até 01/11/2026.");
    expect(monthCoverage({ from: "2026-11-01", to: "2026-11-14" })).toBe("Até 14/11/2026.");
  });
  it("says the month is complete when it reaches the last day", () => {
    expect(monthCoverage({ from: "2026-10-01", to: "2026-10-31" })).toBe("Mês completo.");
  });
});
