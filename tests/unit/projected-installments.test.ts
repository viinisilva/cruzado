// "Parcela prevista": an installment the bank never sent, counted in the closed bill it belongs to, labelled as such,
// replaced by the real one when it arrives, never duplicated, and gone when the person excludes it. Synthetic values.
import { describe, expect, it } from "vitest";
import type { BankBill, CardInfo, FinCategory, FinTx } from "@/lib/finance/core";
import { notChargedByBank, projectInstallments, statementForMonth } from "@/lib/finance/cards";

const cats: FinCategory[] = [{ id: "c-exp", name: "Compras", slug: "compras", kind: "expense" }];
const bill = (billRef: string, closingDate: string, dueDate: string, totalCents: number): BankBill => ({ billRef, closingDate, dueDate, totalCents, minimumCents: null });
const card: CardInfo = {
  accountId: "k",
  limitCents: 500000,
  closingDay: 20,
  dueDay: 1,
  closingDaySource: "bank",
  bills: [bill("B-SET", "2026-09-20", "2026-10-01", 5000), bill("B-OUT", "2026-10-20", "2026-11-01", 15000), bill("B-NOV", "2026-11-17", "2026-12-01", 30000)],
};
const TODAY = "2026-11-23";
let n = 0;
const tx = (date: string, cents: number, over: Partial<FinTx> = {}): FinTx => ({ id: `t${++n}`, accountId: "k", categoryId: "c-exp", date, description: "LOJA", merchant: "loja", amountCents: -cents, installmentNumber: null, installmentTotal: null, bankStatus: "posted", ...over });
// The bank sent only installment 1 of 4 (R$ 100,03, the rounding on the first) in October's bill.
const base = () => [tx("2026-09-10", 5000, { billRef: "B-SET" }), tx("2026-10-10", 10003, { description: "LOJA PARCELADA", merchant: "loja parcelada", installmentNumber: 1, installmentTotal: 4 }), tx("2026-10-12", 4997, { billRef: "B-OUT" }), tx("2026-11-05", 20000, { billRef: "B-NOV" })];
const nov = (txs: FinTx[], c: CardInfo = card) => statementForMonth(c, txs, cats, TODAY, "2026-12")!;

describe("projectInstallments", () => {
  it("counts the missing installment 2/4 as prevista in the closed bill it belongs to", () => {
    const txs = base();
    const projected = projectInstallments(card, txs, TODAY).filter((t) => t.projected);
    expect(projected).toEqual([expect.objectContaining({ installmentNumber: 2, installmentTotal: 4, amountCents: -10003, billRef: "B-NOV", projected: true })]);
    // 200,00 + 100,03 against the bank's 300,00: three cents of rounding, not a divergence.
    expect(nov(txs).computedCents).toBe(30003);
  });

  it("never in a bill that is still open: there it is only a forecast", () => {
    const projected = projectInstallments(card, base(), TODAY).filter((t) => t.projected);
    expect(projected.map((t) => t.installmentNumber)).toEqual([2]);
  });

  it("is replaced by the real installment, numbered or only matched by merchant and amount within cents", () => {
    const numbered = [...base(), tx("2026-11-10", 10000, { description: "LOJA PARCELADA", merchant: "loja parcelada", installmentNumber: 2, installmentTotal: 4, billRef: "B-NOV" })];
    expect(projectInstallments(card, numbered, TODAY).some((t) => t.projected)).toBe(false);
    expect(nov(numbered).computedCents).toBe(30000);
    const plain = [...base(), tx("2026-11-10", 10000, { description: "LOJA PARCELADA", merchant: "loja parcelada", billRef: "B-NOV" })];
    expect(projectInstallments(card, plain, TODAY).some((t) => t.projected)).toBe(false);
  });

  it("is never duplicated, however many times it runs", () => {
    const once = projectInstallments(card, base(), TODAY);
    const twice = projectInstallments(card, once, TODAY);
    expect(twice.filter((t) => t.projected)).toHaveLength(1);
    expect(nov(once).computedCents).toBe(30003);
  });

  it("is gone when the person excludes it", () => {
    const txs = base();
    const key = projectInstallments(card, txs, TODAY).find((t) => t.projected)!.projectionKey!;
    const excluded = { ...card, dismissedProjections: [key] };
    expect(projectInstallments(excluded, txs, TODAY).some((t) => t.projected)).toBe(false);
    expect(nov(txs, excluded).computedCents).toBe(20000);
  });
});

describe("a prevista is never evidence against real entries", () => {
  // As the bank sent them in production: pending, tied to no bill. The prevista is the only row with the bill's ref.
  const pendingBase = () => [
    tx("2026-09-10", 5000, { billRef: "B-SET" }),
    tx("2026-10-10", 10003, { description: "LOJA PARCELADA", merchant: "loja parcelada", installmentNumber: 1, installmentTotal: 4 }),
    tx("2026-10-12", 4997, { billRef: "B-OUT" }),
    tx("2026-10-25", 12000, { bankStatus: "pending" }),
    tx("2026-11-05", 8000, { bankStatus: "pending" }),
  ];

  it("pending entries of a closed bill the bank did not tag still count, next to the prevista", () => {
    const txs = pendingBase();
    expect(nov(txs).computedCents).toBe(30003);
  });

  it("the phantom-pending rule gives the same answer with or without the previstas", () => {
    const txs = pendingBase();
    const st = nov(txs);
    const without = notChargedByBank(card, st, txs, cats).map((t) => t.id);
    const withProjection = notChargedByBank(card, st, projectInstallments(card, txs, TODAY), cats).map((t) => t.id);
    expect(withProjection).toEqual(without);
    expect(without).toEqual([]);
  });
});
