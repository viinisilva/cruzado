import { describe, expect, it } from "vitest";
import {
  accountBalances,
  applyFilters,
  cashFlow,
  comparePeriods,
  consolidatedBalance,
  creditCardSummary,
  currentStatementCycle,
  detectPossibleDuplicates,
  detectRecurring,
  isTransfer,
  spendingByCategory,
  type CardInfo,
  type FinAccount,
  type FinCategory,
  type FinTx,
} from "@/lib/finance/core";
import { normalizeMerchant, parseInstallment } from "@/lib/text";

const cats: FinCategory[] = [
  { id: "c-mercado", name: "Mercado", slug: "mercado", kind: "expense" },
  { id: "c-lazer", name: "Lazer", slug: "lazer", kind: "expense" },
  { id: "c-sal", name: "Salário", slug: "salario", kind: "income" },
  { id: "c-tr", name: "Transferências", slug: "transferencias", kind: "transfer" },
];

let n = 0;
function tx(date: string, description: string, amountCents: number, categoryId: string | null, accountId = "a"): FinTx {
  const inst = parseInstallment(description);
  return { id: `t${++n}`, accountId, categoryId, date, description, merchant: normalizeMerchant(description), amountCents, installmentNumber: inst?.number ?? null, installmentTotal: inst?.total ?? null };
}

describe("spendingByCategory", () => {
  const txs = [
    tx("2025-10-01", "Mercado A", -10050, "c-mercado"),
    tx("2025-10-02", "Mercado B", -2025, "c-mercado"),
    tx("2025-10-03", "Estorno Mercado B", 525, "c-mercado"),
    tx("2025-10-04", "Cinema", -3000, "c-lazer"),
    tx("2025-10-05", "Salário", 500000, "c-sal"),
    tx("2025-10-06", "Transferência", -100000, "c-tr"),
    tx("2025-10-07", "Sem categoria", -100, null),
    tx("2025-11-01", "Mercado fora do período", -99999, "c-mercado"),
  ];
  const range = { from: "2025-10-01", to: "2025-10-31" };

  it("sums expenses per category in cents, refunds offset, transfers and income excluded", () => {
    const r = spendingByCategory(txs, cats, range);
    expect(r.categories.map((c) => [c.name, c.totalCents])).toEqual([
      ["Mercado", 11550],
      ["Lazer", 3000],
      ["Sem categoria", 100],
    ]);
    expect(r.totalCents).toBe(14650);
  });

  it("filters by category and account", () => {
    expect(spendingByCategory(txs, cats, range, { categoryIds: ["c-lazer"] }).totalCents).toBe(3000);
    expect(spendingByCategory(txs, cats, range, { accountIds: ["b"] }).totalCents).toBe(0);
  });

  it("handles empty input", () => {
    expect(spendingByCategory([], cats, range)).toEqual({ categories: [], totalCents: 0 });
  });

  it("is inclusive on range boundaries", () => {
    expect(spendingByCategory(txs, cats, { from: "2025-10-01", to: "2025-10-01" }).totalCents).toBe(10050);
  });
});

describe("cashFlow", () => {
  it("separates income/expense and ignores transfers", () => {
    const txs = [tx("2025-10-01", "Salário", 500000, "c-sal"), tx("2025-10-02", "Mercado", -12345, "c-mercado"), tx("2025-10-03", "Transferência", 100000, "c-tr")];
    const r = cashFlow(txs, cats, { from: "2025-10-01", to: "2025-10-14" });
    expect(r.incomeCents).toBe(500000);
    expect(r.expenseCents).toBe(12345);
    expect(r.netCents).toBe(487655);
    expect(r.buckets).toHaveLength(2);
    expect(r.buckets[0]).toMatchObject({ from: "2025-10-01", to: "2025-10-07", incomeCents: 500000, expenseCents: 12345 });
  });
});

describe("comparePeriods", () => {
  it("ranks by absolute change and reports basis points", () => {
    const txs = [
      tx("2025-09-02", "Mercado", -10000, "c-mercado"),
      tx("2025-10-02", "Mercado", -15000, "c-mercado"),
      tx("2025-09-03", "Cinema", -1000, "c-lazer"),
      tx("2025-10-03", "Cinema", -4000, "c-lazer"),
    ];
    const r = comparePeriods(txs, cats, { from: "2025-10-01", to: "2025-10-31" }, { from: "2025-09-01", to: "2025-09-30" });
    expect(r.totalChangeCents).toBe(8000);
    expect(r.categories[0]).toMatchObject({ name: "Mercado", changeCents: 5000, changeBp: 5000 });
    expect(r.categories[1]).toMatchObject({ name: "Lazer", changeCents: 3000, changeBp: 30000 });
  });
  it("new category has no percentage base", () => {
    const r = comparePeriods([tx("2025-10-03", "Cinema", -4000, "c-lazer")], cats, { from: "2025-10-01", to: "2025-10-31" }, { from: "2025-09-01", to: "2025-09-30" });
    expect(r.categories[0]!.changeBp).toBeNull();
  });
});

describe("detectPossibleDuplicates", () => {
  it("pairs same merchant + same amount within 3 days, same account", () => {
    const a = tx("2025-10-10", "Restaurante Sabor", -8750, "c-lazer");
    const b = tx("2025-10-11", "RESTAURANTE SABOR", -8750, "c-lazer");
    const far = tx("2025-10-20", "Restaurante Sabor", -8750, "c-lazer");
    const otherAcc = tx("2025-10-10", "Restaurante Sabor", -8750, "c-lazer", "b");
    const pairs = detectPossibleDuplicates([a, b, far, otherAcc]);
    expect(pairs).toHaveLength(1);
    expect([pairs[0]!.a.id, pairs[0]!.b.id]).toEqual([a.id, b.id]);
  });
  it("ignores different installments and different amounts", () => {
    const i1 = tx("2025-10-10", "Loja X 1/3", -10000, null);
    const i2 = tx("2025-10-10", "Loja X 2/3", -10000, null);
    const c = tx("2025-10-10", "Padaria", -1000, null);
    const d = tx("2025-10-10", "Padaria", -1500, null);
    expect(detectPossibleDuplicates([i1, i2, c, d])).toHaveLength(0);
  });
  it("tolerates 1% difference", () => {
    expect(detectPossibleDuplicates([tx("2025-10-10", "Posto", -10000, null), tx("2025-10-12", "Posto", -10090, null)])).toHaveLength(1);
    expect(detectPossibleDuplicates([tx("2025-10-10", "Posto", -10000, null), tx("2025-10-12", "Posto", -10200, null)])).toHaveLength(0);
  });
});

describe("detectRecurring", () => {
  it("detects monthly subscription and installment remaining", () => {
    const txs = [
      tx("2025-08-03", "StreamFlix", -3990, "c-lazer"),
      tx("2025-09-03", "StreamFlix", -3990, "c-lazer"),
      tx("2025-10-03", "StreamFlix", -3990, "c-lazer"),
      tx("2025-09-14", "Geladeira 3/10", -38990, null),
      tx("2025-10-14", "Geladeira 4/10", -38990, null),
      tx("2025-10-01", "Mercado", -1000, "c-mercado"),
      tx("2025-10-08", "Mercado", -1000, "c-mercado"),
    ];
    const r = detectRecurring(txs, cats, "2025-10-15");
    const sub = r.find((x) => x.kind === "subscription");
    expect(sub).toMatchObject({ amountCents: -3990, nextDate: "2025-11-03" });
    const inst = r.find((x) => x.kind === "installment");
    expect(inst).toMatchObject({ nextDate: "2025-11-14", remainingInstallments: 6 });
    expect(r.some((x) => x.merchant === "mercado")).toBe(false);
  });
});

describe("balances and card cycle", () => {
  it("consolidates cash and card debt", () => {
    const accounts = [
      { id: "a", name: "A", institution: "X", type: "checking" as const, openingBalanceCents: 100000 },
      { id: "c", name: "Card", institution: "Y", type: "credit_card" as const, openingBalanceCents: 0 },
    ];
    const b = accountBalances(accounts, [tx("2025-10-01", "x", -5000, null, "a"), tx("2025-10-02", "y", -7000, null, "c")]);
    expect(consolidatedBalance(b)).toMatchObject({ availableCents: 95000, cardDebtCents: 7000, netCents: 88000 });
  });
  it("computes statement cycle and due date", () => {
    expect(currentStatementCycle({ accountId: "c", limitCents: 1, closingDay: 1, dueDay: 10 }, "2025-10-15")).toEqual({ cycle: { from: "2025-10-02", to: "2025-11-01" }, dueDate: "2025-11-10" });
    expect(currentStatementCycle({ accountId: "c", limitCents: 1, closingDay: 25, dueDay: 5 }, "2025-10-15")).toEqual({ cycle: { from: "2025-09-26", to: "2025-10-25" }, dueDate: "2025-11-05" });
  });
});

// ---------------------------------------------------------------------------
// isTransfer (direct unit tests)
// ---------------------------------------------------------------------------

describe("isTransfer", () => {
  const catMap = new Map(cats.map((c) => [c.id, c]));

  it("returns true for transaction in a transfer category", () => {
    expect(isTransfer(tx("2025-10-01", "Pagamento fatura", -50000, "c-tr"), catMap)).toBe(true);
  });

  it("returns false for expense category", () => {
    expect(isTransfer(tx("2025-10-01", "Mercado", -5000, "c-mercado"), catMap)).toBe(false);
  });

  it("returns false for income category", () => {
    expect(isTransfer(tx("2025-10-01", "Salário", 300000, "c-sal"), catMap)).toBe(false);
  });

  it("returns false when categoryId is null", () => {
    expect(isTransfer(tx("2025-10-01", "Sem categoria", -100, null), catMap)).toBe(false);
  });

  it("returns false for unknown categoryId", () => {
    expect(isTransfer(tx("2025-10-01", "Cat inexistente", -100, "c-nonexistent"), catMap)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// applyFilters (direct unit tests)
// ---------------------------------------------------------------------------

describe("applyFilters", () => {
  const range = { from: "2025-10-01", to: "2025-10-31" };
  const txs = [
    tx("2025-10-05", "Mercado A", -1000, "c-mercado", "acc-1"),
    tx("2025-10-10", "Cinema", -2000, "c-lazer", "acc-2"),
    tx("2025-10-15", "Salário", 10000, "c-sal", "acc-1"),
    tx("2025-11-01", "Fora do período", -500, "c-mercado", "acc-1"),
    tx("2025-09-30", "Antes do período", -500, "c-lazer", "acc-1"),
  ];

  it("range filter: only returns txs within the range", () => {
    const result = applyFilters(txs, range);
    expect(result).toHaveLength(3);
    expect(result.map((t) => t.date)).not.toContain("2025-11-01");
    expect(result.map((t) => t.date)).not.toContain("2025-09-30");
  });

  it("null range: returns all txs", () => {
    expect(applyFilters(txs, null)).toHaveLength(txs.length);
  });

  it("accountIds filter: returns only txs from matching accounts", () => {
    const result = applyFilters(txs, null, { accountIds: ["acc-2"] });
    expect(result).toHaveLength(1);
    expect(result[0]!.description).toBe("Cinema");
  });

  it("categoryIds filter: returns only txs from matching categories", () => {
    const result = applyFilters(txs, null, { categoryIds: ["c-lazer"] });
    expect(result.every((t) => t.categoryId === "c-lazer")).toBe(true);
  });

  it("categoryIds filter excludes uncategorized txs", () => {
    const uncategorized = tx("2025-10-10", "Sem cat", -100, null, "acc-1");
    const result = applyFilters([...txs, uncategorized], null, { categoryIds: ["c-mercado"] });
    expect(result.every((t) => t.categoryId === "c-mercado")).toBe(true);
    expect(result.some((t) => t.id === uncategorized.id)).toBe(false);
  });

  it("empty accountIds array: no filter applied (all accounts pass)", () => {
    const result = applyFilters(txs, null, { accountIds: [] });
    expect(result).toHaveLength(txs.length);
  });

  it("empty categoryIds array: no filter applied (all categories pass)", () => {
    const result = applyFilters(txs, null, { categoryIds: [] });
    expect(result).toHaveLength(txs.length);
  });

  it("combined range + accountIds + categoryIds", () => {
    const result = applyFilters(txs, range, { accountIds: ["acc-1"], categoryIds: ["c-mercado"] });
    expect(result).toHaveLength(1);
    expect(result[0]!.description).toBe("Mercado A");
  });

  it("range is inclusive on both boundaries", () => {
    const tight = [tx("2025-10-01", "First", -100, null), tx("2025-10-31", "Last", -100, null)];
    const result = applyFilters(tight, range);
    expect(result).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------
// creditCardSummary
// ---------------------------------------------------------------------------

describe("creditCardSummary", () => {
  const card: CardInfo = { accountId: "card-1", limitCents: 500000, closingDay: 10, dueDay: 20 };
  // today = "2025-10-05": d(5) <= closingDay(10) → current cycle = 2025-09-11 to 2025-10-10
  const today = "2025-10-05";

  it("returns correct cycle, statementCents, usedCents and availableCents", () => {
    const txs = [
      tx("2025-09-15", "Loja A", -10000, "c-mercado", "card-1"),
      tx("2025-10-03", "Restaurante", -5000, "c-lazer", "card-1"),
    ];
    const balance = -15000;
    const r = creditCardSummary(card, txs, cats, balance, today);
    expect(r.statementCents).toBe(15000);
    expect(r.usedCents).toBe(15000);
    expect(r.limitCents).toBe(500000);
    expect(r.availableCents).toBe(485000);
    expect(r.transactionIds).toHaveLength(2);
    expect(r.dueDate).toBe("2025-10-20");
  });

  it("no transactions in cycle → statementCents = 0", () => {
    const r = creditCardSummary(card, [], cats, 0, today);
    expect(r.statementCents).toBe(-0); // -sumCents([]) = -0 (JS behaviour)
    expect(r.transactionIds).toHaveLength(0);
    expect(r.availableCents).toBe(500000);
    expect(r.usedCents).toBe(0);
  });

  it("excludes transactions from other accounts", () => {
    const txs = [
      tx("2025-09-20", "Loja no cartão", -8000, "c-mercado", "card-1"),
      tx("2025-09-20", "Loja em outra conta", -20000, "c-mercado", "acc-checking"),
    ];
    const r = creditCardSummary(card, txs, cats, -8000, today);
    expect(r.statementCents).toBe(8000);
    expect(r.transactionIds).toHaveLength(1);
  });

  it("excludes transactions outside the current cycle", () => {
    const txs = [
      tx("2025-08-01", "Ciclo anterior", -5000, "c-mercado", "card-1"),
      tx("2025-09-20", "Ciclo atual", -3000, "c-lazer", "card-1"),
    ];
    const r = creditCardSummary(card, txs, cats, -3000, today);
    expect(r.statementCents).toBe(3000);
  });

  it("excludes transfer transactions", () => {
    const txs = [
      tx("2025-09-20", "Compra", -5000, "c-mercado", "card-1"),
      tx("2025-09-21", "Pagamento fatura", -50000, "c-tr", "card-1"),
    ];
    const r = creditCardSummary(card, txs, cats, -5000, today);
    expect(r.statementCents).toBe(5000);
    expect(r.transactionIds).toHaveLength(1);
  });

  it("positive balance (card in credit) → usedCents = 0, full limit available", () => {
    const txs = [tx("2025-09-20", "Estorno", 2000, "c-mercado", "card-1")];
    const r = creditCardSummary(card, txs, cats, 2000, today);
    expect(r.usedCents).toBe(0);
    expect(r.availableCents).toBe(500000);
  });

  it("cycle contains correct date range (today before closing day)", () => {
    // today = "2025-10-05", closingDay = 10 → cycle is Sep 11 to Oct 10
    const r = creditCardSummary(card, [], cats, 0, today);
    expect(r.cycle).toEqual({ from: "2025-09-11", to: "2025-10-10" });
  });

  it("cycle advances when today is past closing day", () => {
    // today = "2025-10-15", closingDay = 10 → cycle is Oct 11 to Nov 10
    const r = creditCardSummary(card, [], cats, 0, "2025-10-15");
    expect(r.cycle).toEqual({ from: "2025-10-11", to: "2025-11-10" });
    expect(r.dueDate).toBe("2025-11-20");
  });

  it("closing day 31 in February clamps to Feb 28", () => {
    const cardLate: CardInfo = { accountId: "card-2", limitCents: 100000, closingDay: 31, dueDay: 10 };
    // today = 2025-02-15: d(15) <= clamp(31→28) → closing = Feb 28
    const r = creditCardSummary(cardLate, [], cats, 0, "2025-02-15");
    expect(r.cycle.to).toBe("2025-02-28");
  });

  it("due date rolls to next month when it falls on or before closing day", () => {
    const cardEarly: CardInfo = { accountId: "card-3", limitCents: 100000, closingDay: 25, dueDay: 5 };
    const r = creditCardSummary(cardEarly, [], cats, 0, "2025-10-15");
    expect(r.dueDate).toBe("2025-11-05");
  });
});

// ---------------------------------------------------------------------------
// spendingByCategory – additional edge cases
// ---------------------------------------------------------------------------

describe("spendingByCategory – edge cases", () => {
  const range = { from: "2025-10-01", to: "2025-10-31" };

  it("refund that fully offsets purchase results in zero for that category", () => {
    const txs = [
      tx("2025-10-05", "Loja X", -10000, "c-lazer"),
      tx("2025-10-06", "Estorno Loja X", 10000, "c-lazer"),
    ];
    const r = spendingByCategory(txs, cats, range);
    // Category with zero totalCents is filtered out (count > 0 but total = 0 is still shown).
    const lazer = r.categories.find((c) => c.categoryId === "c-lazer");
    expect(lazer?.totalCents ?? 0).toBe(0);
  });

  it("multiple refunds reducing a category below zero are clamped in display (negative totalCents allowed)", () => {
    const txs = [
      tx("2025-10-01", "Loja Z", -5000, "c-lazer"),
      tx("2025-10-05", "Estorno 1 Loja Z", 4000, "c-lazer"),
      tx("2025-10-06", "Estorno 2 Loja Z", 3000, "c-lazer"),
    ];
    const r = spendingByCategory(txs, cats, range);
    const lazer = r.categories.find((c) => c.categoryId === "c-lazer");
    // totalCents can be negative when refunds exceed purchases
    expect(lazer!.totalCents).toBe(-2000);
  });

  it("uncategorized positive amount (income-like) is excluded", () => {
    const txs = [tx("2025-10-01", "Sem categoria", 1000, null)];
    const r = spendingByCategory(txs, cats, range);
    expect(r.categories).toHaveLength(0);
    expect(r.totalCents).toBe(0);
  });

  it("sorting: higher spending first, then alphabetical on tie", () => {
    const txs = [
      tx("2025-10-01", "Cinema", -3000, "c-lazer"),
      tx("2025-10-01", "Mercado", -3000, "c-mercado"),
    ];
    const r = spendingByCategory(txs, cats, range);
    expect(r.categories.map((c) => c.name)).toEqual(["Lazer", "Mercado"]);
  });
});

// ---------------------------------------------------------------------------
// comparePeriods – edge cases
// ---------------------------------------------------------------------------

describe("comparePeriods – edge cases", () => {
  it("all zeros in both periods → null changeBp and zero totalChangeCents", () => {
    const r = comparePeriods([], cats, { from: "2025-10-01", to: "2025-10-31" }, { from: "2025-09-01", to: "2025-09-30" });
    expect(r.totalChangeCents).toBe(0);
    expect(r.totalChangeBp).toBeNull();
    expect(r.categories).toHaveLength(0);
  });

  it("negative change (spending dropped) → negative changeCents and negative changeBp", () => {
    const txs = [
      tx("2025-09-05", "Mercado", -20000, "c-mercado"),
      tx("2025-10-05", "Mercado", -10000, "c-mercado"),
    ];
    const r = comparePeriods(txs, cats, { from: "2025-10-01", to: "2025-10-31" }, { from: "2025-09-01", to: "2025-09-30" });
    expect(r.categories[0]!.changeCents).toBe(-10000);
    expect(r.categories[0]!.changeBp).toBe(-5000);
    expect(r.totalChangeCents).toBe(-10000);
  });
});

// ---------------------------------------------------------------------------
// detectPossibleDuplicates – edge cases
// ---------------------------------------------------------------------------

describe("detectPossibleDuplicates – edge cases", () => {
  it("amount = 1 cent: 1% tolerance is at least 1 cent → exact match required", () => {
    const a = tx("2025-10-10", "Padaria Mínima", -1, null);
    const b = tx("2025-10-10", "Padaria Mínima", -1, null);
    expect(detectPossibleDuplicates([a, b])).toHaveLength(1);
  });

  it("positive amounts (income) are never flagged as duplicates", () => {
    const txs = [
      tx("2025-10-10", "Salário", 100000, "c-sal"),
      tx("2025-10-11", "Salário", 100000, "c-sal"),
    ];
    expect(detectPossibleDuplicates(txs)).toHaveLength(0);
  });

  it("same merchant different accounts → not a duplicate", () => {
    const a = tx("2025-10-10", "Loja A", -5000, null, "conta-1");
    const b = tx("2025-10-10", "Loja A", -5000, null, "conta-2");
    expect(detectPossibleDuplicates([a, b])).toHaveLength(0);
  });

  it("custom windowDays respected", () => {
    const a = tx("2025-10-10", "Posto", -10000, null);
    const b = tx("2025-10-15", "Posto", -10000, null); // 5 days apart
    expect(detectPossibleDuplicates([a, b], { windowDays: 3 })).toHaveLength(0);
    expect(detectPossibleDuplicates([a, b], { windowDays: 5 })).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// detectRecurring – edge cases
// ---------------------------------------------------------------------------

describe("detectRecurring – edge cases", () => {
  it("stale subscription (>45 days without charge) is not returned", () => {
    const txs = [
      tx("2025-07-01", "StreamFlix", -3990, "c-lazer"),
      tx("2025-08-01", "StreamFlix", -3990, "c-lazer"),
      // Last charge was 2025-08-01; today is 2025-10-15 → 75 days → stale
    ];
    const r = detectRecurring(txs, cats, "2025-10-15");
    expect(r.some((x) => x.merchant === "streamflix")).toBe(false);
  });

  it("exactly 2 consecutive months qualifies", () => {
    const txs = [
      tx("2025-09-03", "ServiçoX", -1500, "c-lazer"),
      tx("2025-10-03", "ServiçoX", -1500, "c-lazer"),
    ];
    const r = detectRecurring(txs, cats, "2025-10-15");
    expect(r.some((x) => x.kind === "subscription")).toBe(true);
  });

  it("installment already at last number is not returned", () => {
    const txs = [
      tx("2025-09-14", "Geladeira 9/10", -38990, null),
      tx("2025-10-14", "Geladeira 10/10", -38990, null),
    ];
    const r = detectRecurring(txs, cats, "2025-10-15");
    expect(r.some((x) => x.kind === "installment")).toBe(false);
  });

  it("income recurring (positive amount) returns kind=income", () => {
    const txs = [
      tx("2025-09-05", "Aluguel Recebido", 80000, "c-sal"),
      tx("2025-10-05", "Aluguel Recebido", 80000, "c-sal"),
    ];
    const r = detectRecurring(txs, cats, "2025-10-15");
    expect(r.some((x) => x.kind === "income")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// accountBalances – edge cases
// ---------------------------------------------------------------------------

describe("accountBalances – edge cases", () => {
  const accounts: FinAccount[] = [
    { id: "a1", name: "Corrente", institution: "Banco X", type: "checking", openingBalanceCents: 50000 },
    { id: "a2", name: "Poupança", institution: "Banco X", type: "savings", openingBalanceCents: 100000 },
  ];

  it("no transactions → balance equals opening balance", () => {
    const b = accountBalances(accounts, []);
    expect(b[0]!.balanceCents).toBe(50000);
    expect(b[1]!.balanceCents).toBe(100000);
  });

  it("asOf filters transactions", () => {
    const txs = [
      tx("2025-10-01", "Compra A", -10000, null, "a1"),
      tx("2025-10-20", "Compra B", -5000, null, "a1"),
    ];
    const b = accountBalances(accounts, txs, "2025-10-10");
    expect(b[0]!.balanceCents).toBe(40000); // only Compra A applied
  });

  it("transactions from other accounts are ignored", () => {
    const txs = [tx("2025-10-01", "Compra outra conta", -99999, null, "a3")];
    const b = accountBalances(accounts, txs);
    expect(b[0]!.balanceCents).toBe(50000);
    expect(b[1]!.balanceCents).toBe(100000);
  });
});

// ---------------------------------------------------------------------------
// consolidatedBalance – edge cases
// ---------------------------------------------------------------------------

describe("consolidatedBalance – edge cases", () => {
  it("no accounts → zeros", () => {
    const r = consolidatedBalance([]);
    expect(r.availableCents).toBe(0);
    // -sumCents([]) produces -0 in JS; treat as zero using Math.abs
    expect(Math.abs(r.cardDebtCents)).toBe(0);
    expect(r.netCents).toBe(0);
  });

  it("card with positive balance (credit) → cardDebtCents = 0", () => {
    const accounts: FinAccount[] = [{ id: "c1", name: "Card", institution: "X", type: "credit_card", openingBalanceCents: 0 }];
    const b = accountBalances(accounts, [tx("2025-10-01", "Estorno", 5000, null, "c1")]);
    const r = consolidatedBalance(b);
    // Positive card balance → no debt; -0 treated as 0
    expect(Math.abs(r.cardDebtCents)).toBe(0);
    expect(r.netCents).toBe(0); // no cash accounts
  });

  it("only cash accounts → cardDebtCents = 0, net = available", () => {
    const accounts: FinAccount[] = [{ id: "a1", name: "Corrente", institution: "X", type: "checking", openingBalanceCents: 30000 }];
    const b = accountBalances(accounts, []);
    const r = consolidatedBalance(b);
    expect(Math.abs(r.cardDebtCents)).toBe(0);
    expect(r.availableCents).toBe(30000);
    expect(r.netCents).toBe(30000);
  });
});

// ---------------------------------------------------------------------------
// cashFlow – additional coverage
// ---------------------------------------------------------------------------

describe("cashFlow – additional coverage", () => {
  it("single-day range creates one day bucket", () => {
    const txs = [tx("2025-10-01", "Mercado", -5000, "c-mercado")];
    const r = cashFlow(txs, cats, { from: "2025-10-01", to: "2025-10-01" }, {}, "day");
    expect(r.buckets).toHaveLength(1);
    expect(r.buckets[0]!.expenseCents).toBe(5000);
  });

  it("month bucket mode groups by calendar month", () => {
    const txs = [
      tx("2025-10-01", "Out compra", -10000, "c-mercado"),
      tx("2025-11-01", "Nov compra", -8000, "c-mercado"),
    ];
    const r = cashFlow(txs, cats, { from: "2025-10-01", to: "2025-11-30" }, {}, "month");
    expect(r.buckets.some((b) => b.label === "2025-10" && b.expenseCents === 10000)).toBe(true);
    expect(r.buckets.some((b) => b.label === "2025-11" && b.expenseCents === 8000)).toBe(true);
  });

  it("netCents = incomeCents - expenseCents", () => {
    const txs = [
      tx("2025-10-01", "Salário", 100000, "c-sal"),
      tx("2025-10-02", "Mercado", -30000, "c-mercado"),
    ];
    const r = cashFlow(txs, cats, { from: "2025-10-01", to: "2025-10-31" });
    expect(r.netCents).toBe(r.incomeCents - r.expenseCents);
    expect(r.netCents).toBe(70000);
  });
});
