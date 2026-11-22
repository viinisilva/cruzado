import { describe, expect, it } from "vitest";
import { evaluate, isDue, periodKeyFor } from "@/lib/agents/evaluators";
import { normalizeRule, type AgentRule } from "@/lib/agents/rule";
import { normalizeMerchant, parseInstallment } from "@/lib/text";
import type { FinCategory, FinTx } from "@/lib/finance/core";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const BASE_RULE = {
  timezone: "America/Sao_Paulo" as const,
  enabled: true,
};

function rule(overrides: Partial<AgentRule> & Pick<AgentRule, "kind" | "name">): AgentRule {
  return normalizeRule({ ...BASE_RULE, ...overrides });
}

const cats: FinCategory[] = [
  { id: "c-mercado", name: "Mercado", slug: "mercado", kind: "expense" },
  { id: "c-lazer", name: "Lazer", slug: "lazer", kind: "expense" },
  { id: "c-sal", name: "Salário", slug: "salario", kind: "income" },
  { id: "c-tr", name: "Transferências", slug: "transferencias", kind: "transfer" },
];

let n = 0;
function tx(date: string, description: string, amountCents: number, categoryId: string | null, accountId = "a"): FinTx {
  const inst = parseInstallment(description);
  return {
    id: `t${++n}`,
    accountId,
    categoryId,
    date,
    description,
    merchant: normalizeMerchant(description),
    amountCents,
    installmentNumber: inst?.number ?? null,
    installmentTotal: inst?.total ?? null,
  };
}

// ---------------------------------------------------------------------------
// periodKeyFor
// ---------------------------------------------------------------------------

describe("periodKeyFor", () => {
  const monday = "2025-10-13";
  const wednesday = "2025-10-15";
  const first = "2025-10-01";
  const mid = "2025-10-17";

  it("continuous → today", () => {
    expect(periodKeyFor("continuous", wednesday)).toBe(wednesday);
  });

  it("daily → today", () => {
    expect(periodKeyFor("daily", wednesday)).toBe(wednesday);
  });

  it("weekly_monday → start of ISO week (Monday)", () => {
    expect(periodKeyFor("weekly_monday", wednesday)).toBe(monday);
    // On Monday itself, the key is the same day.
    expect(periodKeyFor("weekly_monday", monday)).toBe(monday);
    // On Sunday the key is the previous Monday.
    expect(periodKeyFor("weekly_monday", "2025-10-19")).toBe(monday);
  });

  it("monthly_first → YYYY-MM", () => {
    expect(periodKeyFor("monthly_first", first)).toBe("2025-10");
    expect(periodKeyFor("monthly_first", mid)).toBe("2025-10");
  });

  it("year boundary: December sunday → December Monday key", () => {
    // 2025-12-28 is a Sunday; Monday of its week is 2025-12-22.
    expect(periodKeyFor("weekly_monday", "2025-12-28")).toBe("2025-12-22");
  });
});

// ---------------------------------------------------------------------------
// isDue
// ---------------------------------------------------------------------------

describe("isDue", () => {
  it("continuous is always due regardless of hour", () => {
    expect(isDue("continuous", "2025-10-15", 0)).toBe(true);
    expect(isDue("continuous", "2025-10-15", 23)).toBe(true);
  });

  it("daily is always due", () => {
    expect(isDue("daily", "2025-10-15", 3)).toBe(true);
  });

  it("weekly_monday: blocks on Monday before 8h; other days are not blocked", () => {
    const monday = "2025-10-13";
    // On Monday, hour gate applies.
    expect(isDue("weekly_monday", monday, 7)).toBe(false);
    expect(isDue("weekly_monday", monday, 8)).toBe(true);
    expect(isDue("weekly_monday", monday, 23)).toBe(true);
    // On other weekdays the check falls through to true (dedup happens at the job level).
    expect(isDue("weekly_monday", "2025-10-14", 0)).toBe(true);
    expect(isDue("weekly_monday", "2025-10-15", 0)).toBe(true);
  });

  it("monthly_first: blocks on the 1st before 8h; other days are not blocked", () => {
    expect(isDue("monthly_first", "2025-10-01", 7)).toBe(false);
    expect(isDue("monthly_first", "2025-10-01", 8)).toBe(true);
    // Other days fall through to true; dedup prevents duplicate jobs for the month.
    expect(isDue("monthly_first", "2025-10-02", 0)).toBe(true);
    expect(isDue("monthly_first", "2025-11-01", 8)).toBe(true);
  });

  it("year boundary: Jan 1st is due for monthly_first; Dec 31st is not blocked", () => {
    expect(isDue("monthly_first", "2026-01-01", 8)).toBe(true);
    // Dec 31 is not the 1st, falls through to true.
    expect(isDue("monthly_first", "2025-12-31", 8)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// evaluate – daily_spend_limit
// ---------------------------------------------------------------------------

describe("evaluate – daily_spend_limit", () => {
  const today = "2025-10-15";
  const r = rule({ kind: "daily_spend_limit", name: "Limite Diário", thresholdCents: 10000 });

  it("no transactions → no notification", () => {
    const result = evaluate("r1", r, { transactions: [], categories: cats }, today);
    expect(result.notifications).toHaveLength(0);
    expect(result.summary).toMatchObject({ totalCents: 0, limitCents: 10000 });
    expect(result.periodKey).toBe(today);
  });

  it("spending below limit → no notification", () => {
    const txs = [tx(today, "Padaria", -5000, "c-mercado")];
    const result = evaluate("r1", r, { transactions: txs, categories: cats }, today);
    expect(result.notifications).toHaveLength(0);
    expect(result.summary).toMatchObject({ totalCents: 5000, limitCents: 10000 });
  });

  it("spending exactly at limit → no notification", () => {
    const txs = [tx(today, "Mercado", -10000, "c-mercado")];
    const result = evaluate("r1", r, { transactions: txs, categories: cats }, today);
    expect(result.notifications).toHaveLength(0);
  });

  it("spending above limit → one attention notification with correct body", () => {
    const txs = [
      tx(today, "Supermercado Líder", -8000, "c-mercado"),
      tx(today, "Cinema", -5000, "c-lazer"),
    ];
    const result = evaluate("r1", r, { transactions: txs, categories: cats }, today);
    expect(result.notifications).toHaveLength(1);
    const n = result.notifications[0]!;
    expect(n.severity).toBe("attention");
    expect(n.title).toContain("limite diário ultrapassado");
    expect(n.body).toContain("R$ 130,00"); // 13000 cents
    expect(n.body).toContain("R$ 100,00"); // threshold
    expect(n.dedupeKey).toBe(`daily_limit:r1:${today}`);
    expect(n.links.length).toBeGreaterThan(0);
    expect(result.summary).toMatchObject({ totalCents: 13000, limitCents: 10000 });
  });

  it("ignores transfers and income", () => {
    const txs = [
      tx(today, "Transferência Bancária", -50000, "c-tr"),
      tx(today, "Salário", 200000, "c-sal"),
      tx(today, "Padaria", -5000, "c-mercado"),
    ];
    const result = evaluate("r1", r, { transactions: txs, categories: cats }, today);
    expect(result.notifications).toHaveLength(0);
    expect(result.summary.totalCents).toBe(5000);
  });

  it("ignores transactions outside today", () => {
    const txs = [
      tx("2025-10-14", "Ontem", -20000, "c-mercado"),
      tx("2025-10-16", "Amanhã", -20000, "c-mercado"),
      tx(today, "Hoje", -5000, "c-mercado"),
    ];
    const result = evaluate("r1", r, { transactions: txs, categories: cats }, today);
    expect(result.notifications).toHaveLength(0);
    expect(result.summary.totalCents).toBe(5000);
  });

  it("category filter only considers filtered categories", () => {
    const rf = rule({ kind: "daily_spend_limit", name: "Limite Mercado", thresholdCents: 5000, filters: { categoryIds: ["c-mercado"] } });
    const txs = [
      tx(today, "Mercado", -4000, "c-mercado"),
      tx(today, "Cinema", -8000, "c-lazer"), // large but filtered out
    ];
    const result = evaluate("r2", rf, { transactions: txs, categories: cats }, today);
    expect(result.notifications).toHaveLength(0);
    expect(result.summary.totalCents).toBe(4000);
  });

  it("dedupeKey includes ruleId and date", () => {
    const txs = [tx(today, "Loja", -20000, "c-mercado")];
    const r1 = evaluate("rule-abc", r, { transactions: txs, categories: cats }, today);
    expect(r1.notifications[0]!.dedupeKey).toBe(`daily_limit:rule-abc:${today}`);
  });
});

// ---------------------------------------------------------------------------
// evaluate – weekly_summary
// ---------------------------------------------------------------------------

describe("evaluate – weekly_summary", () => {
  // today = Wednesday 2025-10-15
  // startOfWeek("2025-10-15") = Monday "2025-10-13"
  // previous week (the one being summarised) = "2025-10-06" to "2025-10-12"
  const today = "2025-10-15";
  const r = rule({ kind: "weekly_summary", name: "Resumo Semanal" });

  it("no transactions → 'Não houve despesas' body", () => {
    const result = evaluate("r3", r, { transactions: [], categories: cats }, today);
    expect(result.notifications).toHaveLength(1);
    const n = result.notifications[0]!;
    expect(n.severity).toBe("info");
    expect(n.body).toContain("Não houve despesas");
    expect(n.dedupeKey).toBe("weekly:r3:2025-10-06");
    expect(result.summary).toMatchObject({ totalCents: 0 });
  });

  it("transactions in previous week → summary with top categories", () => {
    const txs = [
      tx("2025-10-07", "Supermercado", -15000, "c-mercado"),
      tx("2025-10-08", "Cinema", -6000, "c-lazer"),
      tx("2025-10-07", "Salário", 300000, "c-sal"),
    ];
    const result = evaluate("r3", r, { transactions: txs, categories: cats }, today);
    const n = result.notifications[0]!;
    expect(n.body).toContain("R$ 210,00"); // 15000+6000 = 21000 cents
    expect(n.body).toContain("Mercado");
    expect(n.body).toContain("Receitas");
    expect(result.summary).toMatchObject({ totalCents: 21000 });
  });

  it("ignores current week and other periods", () => {
    const txs = [
      tx(today, "Esta semana", -50000, "c-mercado"),         // current week, ignored
      tx("2025-09-01", "Mês passado", -50000, "c-mercado"), // too old
    ];
    const result = evaluate("r3", r, { transactions: txs, categories: cats }, today);
    expect(result.notifications[0]!.body).toContain("Não houve despesas");
  });

  it("periodKey is the start of the current ISO week", () => {
    const result = evaluate("r3", r, { transactions: [], categories: cats }, today);
    expect(result.periodKey).toBe("2025-10-13");
  });

  it("always produces exactly one notification", () => {
    const result = evaluate("r3", r, { transactions: [], categories: cats }, today);
    expect(result.notifications).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// evaluate – possible_duplicate
// ---------------------------------------------------------------------------

describe("evaluate – possible_duplicate", () => {
  const today = "2025-10-15";
  const r = rule({ kind: "possible_duplicate", name: "Duplicatas" });

  it("no transactions → no notifications", () => {
    const result = evaluate("r4", r, { transactions: [], categories: cats }, today);
    expect(result.notifications).toHaveLength(0);
    expect(result.summary).toMatchObject({ pairs: 0 });
  });

  it("no duplicates → no notifications", () => {
    const txs = [
      tx("2025-10-10", "Loja A", -5000, null),
      tx("2025-10-10", "Loja B", -5000, null),
    ];
    const result = evaluate("r4", r, { transactions: txs, categories: cats }, today);
    expect(result.notifications).toHaveLength(0);
  });

  it("duplicate pair → one notification per pair", () => {
    const txs = [
      tx("2025-10-10", "Restaurante Sabor Caseiro", -8750, "c-lazer"),
      tx("2025-10-11", "RESTAURANTE SABOR CASEIRO", -8750, "c-lazer"),
    ];
    const result = evaluate("r4", r, { transactions: txs, categories: cats }, today);
    expect(result.notifications).toHaveLength(1);
    const n = result.notifications[0]!;
    expect(n.severity).toBe("attention");
    expect(n.title).toBe("Possível cobrança duplicada");
    expect(n.body).toContain("suspeita");
    expect(n.body).toContain("não indica fraude");
    expect(n.links).toHaveLength(2);
    expect(result.summary).toMatchObject({ pairs: 1 });
  });

  it("dedupeKey encodes both transaction IDs and ruleId", () => {
    const a = tx("2025-10-10", "Posto Ipiranga", -6000, null);
    const b = tx("2025-10-11", "Posto Ipiranga", -6000, null);
    const result = evaluate("rule-dup", r, { transactions: [a, b], categories: cats }, today);
    expect(result.notifications[0]!.dedupeKey).toBe(`duplicate:rule-dup:${a.id}:${b.id}`);
  });

  it("only looks at the last 30 days window", () => {
    const old = tx("2025-09-01", "Loja X", -5000, null);
    const recent = tx("2025-09-02", "Loja X", -5000, null);
    // Both are > 30 days before today (2025-10-15), so outside the window.
    const result = evaluate("r4", r, { transactions: [old, recent], categories: cats }, today);
    expect(result.notifications).toHaveLength(0);
  });

  it("periodKey is today for daily schedule", () => {
    const result = evaluate("r4", r, { transactions: [], categories: cats }, today);
    expect(result.periodKey).toBe(today);
  });
});

// ---------------------------------------------------------------------------
// evaluate – monthly_comparison
// ---------------------------------------------------------------------------

describe("evaluate – monthly_comparison", () => {
  const today = "2025-10-15";
  const r = rule({ kind: "monthly_comparison", name: "Comparação Mensal" });

  it("no transactions → info notification with zero amounts", () => {
    const result = evaluate("r5", r, { transactions: [], categories: cats }, today);
    expect(result.notifications).toHaveLength(1);
    const n = result.notifications[0]!;
    expect(n.severity).toBe("info");
    expect(n.body).toContain("R$ 0,00");
    expect(result.summary).toMatchObject({ currentCents: 0, previousCents: 0 });
  });

  it("current month vs previous same interval — computes change", () => {
    // current: 2025-10-01 to 2025-10-15
    // previous: 2025-09-01 to 2025-09-15
    const txs = [
      tx("2025-09-05", "Mercado Set", -10000, "c-mercado"),
      tx("2025-10-05", "Mercado Out", -15000, "c-mercado"),
    ];
    const result = evaluate("r5", r, { transactions: txs, categories: cats }, today);
    const n = result.notifications[0]!;
    expect(n.body).toContain("R$ 150,00"); // current 15000 cents
    expect(n.body).toContain("R$ 100,00"); // previous 10000 cents
    expect(result.summary).toMatchObject({ currentCents: 15000, previousCents: 10000 });
  });

  it("increase > 20% → attention severity", () => {
    // 10000 previous → 50000 current = +400% = 40000 bp > 2000 bp threshold
    const txs = [
      tx("2025-09-05", "Lazer", -10000, "c-lazer"),
      tx("2025-10-05", "Lazer", -50000, "c-lazer"),
    ];
    const result = evaluate("r5", r, { transactions: txs, categories: cats }, today);
    expect(result.notifications[0]!.severity).toBe("attention");
  });

  it("zero previous → info severity (null changeBp)", () => {
    const txs = [tx("2025-10-05", "Mercado", -10000, "c-mercado")];
    const result = evaluate("r5", r, { transactions: txs, categories: cats }, today);
    expect(result.notifications[0]!.severity).toBe("info");
  });

  it("dedupeKey encodes ruleId and periodKey (ISO week start for weekly_monday schedule)", () => {
    // monthly_comparison defaults to weekly_monday schedule.
    // periodKeyFor("weekly_monday", "2025-10-15") = startOfWeek("2025-10-15") = "2025-10-13"
    const result = evaluate("r5", r, { transactions: [], categories: cats }, today);
    expect(result.notifications[0]!.dedupeKey).toBe("monthly:r5:2025-10-13");
  });

  it("periodKey is the start of the ISO week", () => {
    // weekly_monday is the default schedule for monthly_comparison
    const result = evaluate("r5", r, { transactions: [], categories: cats }, today);
    expect(result.periodKey).toBe("2025-10-13");
  });

  it("category filter limits comparison scope", () => {
    const rf = rule({ kind: "monthly_comparison", name: "Comparação Mercado", filters: { categoryIds: ["c-mercado"] } });
    const txs = [
      tx("2025-09-05", "Lazer Set", -20000, "c-lazer"),   // filtered out
      tx("2025-10-05", "Lazer Out", -50000, "c-lazer"),   // filtered out
      tx("2025-10-05", "Mercado Out", -3000, "c-mercado"),
    ];
    const result = evaluate("r6", rf, { transactions: txs, categories: cats }, today);
    expect(result.summary).toMatchObject({ currentCents: 3000, previousCents: 0 });
  });
});
