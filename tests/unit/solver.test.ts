// The closed-bill reconciler: smallest change set that closes the bank's total to the cent, applied alone only when it
// is unique and every change has evidence beyond the arithmetic (docs/AUTOCONCILIACAO.md, section 3).
import { describe, expect, it } from "vitest";
import type { BankBill, CardInfo, FinCategory, FinTx } from "@/lib/finance/core";
import { statementForMonth } from "@/lib/finance/cards";
import { combos, solveBill, type Candidate } from "@/lib/finance/solver";
import type { Classification, Signal } from "@/lib/finance/classify";

const cats: FinCategory[] = [
  { id: "c-exp", name: "Compras", slug: "compras", kind: "expense" },
  { id: "c-out", name: "Outras despesas", slug: "outras-despesas", kind: "expense" },
  { id: "c-pay", name: "Pagamento de fatura", slug: "pagamento-fatura", kind: "transfer" },
];
let n = 0;
const tx = (date: string, amountCents: number, over: Partial<FinTx> = {}): FinTx => ({
  id: `t${++n}`, accountId: "K", categoryId: amountCents < 0 ? "c-exp" : "c-out", date, description: "X", merchant: "x", amountCents, installmentNumber: null, installmentTotal: null, bankStatus: "posted", categorySource: "evidence", ...over,
});
const cls = (kind: Classification["kind"], signals: Signal[]): Classification => ({ version: 1, kind, reason: signals[0]?.code ?? "ambiguous", signals, matchedTxId: null, decidedAt: "2026-11-17" });
const bill = (billRef: string, closingDate: string, dueDate: string, totalCents: number): BankBill => ({ billRef, closingDate, dueDate, totalCents, minimumCents: null });
const TODAY = "2026-11-17";
const card: CardInfo = { accountId: "K", limitCents: 1, closingDay: 15, dueDay: 25, bills: [bill("B1", "2026-09-15", "2026-09-25", 1), bill("B2", "2026-10-15", "2026-10-25", 47000)] };
const solve = (txs: FinTx[]) => solveBill(card, statementForMonth(card, txs, cats, TODAY, "2026-10")!, txs, cats, TODAY);

describe("solveBill", () => {
  it("a refund wrongly taken as a payment, with evidence of a refund: unique and automatic", () => {
    const refund = tx("2026-10-05", 3000, { billRef: "B2", categoryId: "c-pay", classification: cls("payment", [{ code: "account-debit", kind: "payment", points: 2 }, { code: "op-refund", kind: "refund", points: 1 }]) });
    const r = solve([tx("2026-09-20", -50000, { billRef: "B2" }), refund]);
    expect(r).toMatchObject({ outcome: "solved", auto: true, combo: [{ txId: refund.id, change: "to-refund", effect: -3000 }] });
  });

  it("closing only by arithmetic, with nothing but wording behind it, is a suggestion", () => {
    const refund = tx("2026-10-05", 3000, { billRef: "B2", categoryId: "c-pay", classification: cls("payment", [{ code: "text-payment", kind: "payment", points: 1 }]) });
    expect(solve([tx("2026-09-20", -50000, { billRef: "B2" }), refund])).toMatchObject({ outcome: "solved", auto: false });
  });

  it("a pending entry that closes the gap is only ever suggested", () => {
    const pending = tx("2026-10-10", -3000, { bankStatus: "pending" });
    const r = solve([tx("2026-09-20", -47000, { billRef: "B2", bankStatus: "posted" }), pending].map((t) => (t.id === pending.id ? t : { ...t, billRef: undefined })));
    expect(r).toMatchObject({ outcome: "solved", auto: false, combo: [{ txId: pending.id, change: "exclude" }] });
  });

  it("two credits of the same amount: two answers, nothing applied", () => {
    const a = tx("2026-10-05", 3000, { billRef: "B2", categoryId: "c-pay", classification: cls("payment", [{ code: "op-refund", kind: "refund", points: 1 }]) });
    const b = tx("2026-10-06", 3000, { billRef: "B2", categoryId: "c-pay", classification: cls("payment", [{ code: "op-refund", kind: "refund", points: 1 }]) });
    expect(solve([tx("2026-09-20", -50000, { billRef: "B2" }), a, b])).toMatchObject({ outcome: "ambiguous" });
  });

  it("a category the person chose is never a candidate", () => {
    const refund = tx("2026-10-05", 3000, { billRef: "B2", categoryId: "c-pay", categorySource: "user", classification: cls("payment", [{ code: "op-refund", kind: "refund", points: 1 }]) });
    expect(solve([tx("2026-09-20", -50000, { billRef: "B2" }), refund])).toMatchObject({ outcome: "unsolved", gapCents: -3000 });
  });

  it("within R$ 0,10 there is nothing to do", () => {
    expect(solve([tx("2026-09-20", -47005, { billRef: "B2" })])).toEqual({ outcome: "matched" });
  });
});

describe("combos", () => {
  const c = (txId: string, effect: number): Candidate => ({ txId, change: "exclude", effect, evidence: false, why: "pending" });

  it("prefers the smallest set", () => {
    expect(combos([c("a", 100), c("b", 200), c("c", 300)], 300)).toEqual([[c("c", 300)]]);
  });

  it("finds sets of up to three, never using one entry twice", () => {
    expect(combos([c("a", 100), c("b", 250), c("c", 400)], 750)).toEqual([[c("a", 100), c("b", 250), c("c", 400)]]);
    expect(combos([c("a", 100)], 200)).toEqual([]);
  });
});
