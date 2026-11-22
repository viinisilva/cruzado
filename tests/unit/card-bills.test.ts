// Card bills built from the bank's own bills (Open Finance) and the rules that keep payments out of them.
import { describe, expect, it } from "vitest";
import { categorizeByKeywords, makeCategorizer } from "@/lib/categorizer";
import { normalizeMerchant } from "@/lib/text";
import { mapTransaction } from "@/lib/connectors/open-finance";
import type { BankBill, CardInfo, FinCategory, FinTx } from "@/lib/finance/core";
import { cardStatements, nextStatement, statementForMonth } from "@/lib/finance/cards";

const cats: FinCategory[] = [
  { id: "c-exp", name: "Compras", slug: "compras", kind: "expense" },
  { id: "c-in", name: "Outras receitas", slug: "outras-receitas", kind: "income" },
  { id: "c-pay", name: "Pagamento de fatura", slug: "pagamento-fatura", kind: "transfer" },
];
let n = 0;
const tx = (date: string, amountCents: number, over: Partial<FinTx> = {}): FinTx => ({
  id: `t${++n}`,
  accountId: "k",
  categoryId: amountCents < 0 ? "c-exp" : "c-in",
  date,
  description: "Compra",
  merchant: "compra",
  amountCents,
  installmentNumber: null,
  installmentTotal: null,
  ...over,
});
const bill = (billRef: string, dueDate: string, totalCents: number, closingDate: string | null = null): BankBill => ({ billRef, dueDate, closingDate, totalCents, minimumCents: null });
const card: CardInfo = { accountId: "k", limitCents: 500000, closingDay: 15, dueDay: 25 };

describe("statement entries and totals", () => {
  it("without bank bills nothing changes: entries by date, total from entries", () => {
    const txs = [tx("2026-10-20", -30000), tx("2026-11-03", -25000), tx("2026-11-16", -4000)];
    const st = statementForMonth(card, txs, cats, "2026-11-17", "2026-11")!;
    expect(st).toMatchObject({ computedCents: 55000, totalCents: 55000, bankTotalCents: null, count: 2, matchesRange: true });
  });

  it("an installment tied to a bill counts there, even with an old purchase date", () => {
    const withBills = { ...card, bills: [bill("B-NOV", "2026-11-25", 75000, "2026-11-15")] };
    const txs = [tx("2026-11-03", -30000, { billRef: "B-NOV" }), tx("2026-07-14", -45000, { billRef: "B-NOV", installmentNumber: 4, installmentTotal: 10 })];
    const st = statementForMonth(withBills, txs, cats, "2026-11-17", "2026-11")!;
    expect(st).toMatchObject({ computedCents: 75000, bankTotalCents: 75000, count: 2, matchesRange: false });
    // ...and it is not counted again in July's statement.
    expect(statementForMonth(withBills, txs, cats, "2026-11-17", "2026-07")!.count).toBe(0);
  });

  it("an entry tied to a bill the app never saw is placed by date", () => {
    const st = statementForMonth({ ...card, bills: [] }, [tx("2026-11-03", -30000, { billRef: "UNKNOWN" })], cats, "2026-11-17", "2026-11")!;
    expect(st.count).toBe(1);
  });

  it("the bank's total wins over the entries, and both stay visible", () => {
    const withBills = { ...card, bills: [bill("B-NOV", "2026-11-25", 121540)] };
    const st = statementForMonth(withBills, [tx("2026-11-03", -118000, { billRef: "B-NOV" })], cats, "2026-11-17", "2026-11")!;
    expect(st).toMatchObject({ totalCents: 121540, computedCents: 118000, bankTotalCents: 121540 });
  });

  it("a payment categorized as a bill payment never lowers the bill", () => {
    const txs = [tx("2026-10-20", -110000), tx("2026-10-27", 98000, { categoryId: "c-pay" })];
    expect(statementForMonth(card, txs, cats, "2026-11-17", "2026-11")!.totalCents).toBe(110000);
  });

  it("an uncategorized payment would lower it: this is the failure the bank's marking prevents", () => {
    const txs = [tx("2026-10-20", -110000), tx("2026-10-27", 98000)];
    expect(statementForMonth(card, txs, cats, "2026-11-17", "2026-11")!.totalCents).toBe(12000);
  });

  it("the next bill to pay uses the bank's due date", () => {
    const withBills = { ...card, bills: [bill("B-NOV", "2026-11-24", 50000)] };
    expect(nextStatement(cardStatements(withBills, [], cats, "2026-11-17"), "2026-11-17")).toMatchObject({ dueDate: "2026-11-24", totalCents: 50000 });
  });
});

describe("mapping Open Finance card entries", () => {
  const cardAccount = { id: "acc", type: "CREDIT", name: "Cartão", balance: 0 } as never;
  const bank = { id: "acc2", type: "BANK", subtype: "CHECKING_ACCOUNT", name: "Conta", balance: 0 } as never;
  const base = { id: "x", date: "2026-10-27T12:00:00.000Z", description: "PAGTO. POR DEB EM C/C", status: "POSTED" };

  it("PAGAMENTO_FATURA on a card credit is a bill payment", () => {
    expect(mapTransaction({ ...base, amount: -980, type: "CREDIT", operationType: "PAGAMENTO_FATURA" }, cardAccount, "2026-11-17", "B")).toMatchObject({ isBillPayment: true, amountCents: 98000 });
  });

  it("the same marking on a charge, or on a bank account, is not", () => {
    expect(mapTransaction({ ...base, amount: 980, type: "DEBIT", operationType: "PAGAMENTO_FATURA" }, cardAccount, "2026-11-17", "B")!.isBillPayment).toBe(false);
    expect(mapTransaction({ ...base, amount: -980, type: "DEBIT", operationType: "PAGAMENTO_FATURA" }, bank, "2026-11-17", "B")!.isBillPayment).toBe(false);
  });

  it("an estorno stays a refund", () => {
    expect(mapTransaction({ ...base, description: "ESTORNO", amount: -50, type: "CREDIT", operationType: "ESTORNO" }, cardAccount, "2026-11-17", "B")!.isBillPayment).toBe(false);
  });

  it("keeps the bank's bill as a hash, never the raw id", () => {
    const m = mapTransaction({ ...base, amount: 100, type: "DEBIT", creditCardMetadata: { billId: "bill-raw-id" } }, cardAccount, "2026-11-17", "B")!;
    expect(m.billRef).toMatch(/^[0-9a-f]{64}$/);
    expect(m.billRef).not.toContain("bill-raw-id");
  });
});

describe("bill payment wording on cards", () => {
  it.each(["PAGTO. POR DEB EM C/C", "PAGAMENTO EFETUADO", "Pagamento recebido", "PGTO DEBITO CONTA", "PAG BOLETO BANCARIO"])("%s on a card credit is a bill payment", (d) => {
    expect(categorizeByKeywords(d, 98000, "credit_card")).toBe("pagamento-fatura");
  });

  it("refunds and purchases on a card are not", () => {
    expect(categorizeByKeywords("ESTORNO PAGAMENTO DUPLICADO", 5000, "credit_card")).toBe("outras-receitas");
    expect(categorizeByKeywords("PAGSEGURO LOJA", -5000, "credit_card")).not.toBe("pagamento-fatura");
    expect(categorizeByKeywords("PAGTO ALUGUEL", 5000, "checking")).not.toBe("pagamento-fatura");
  });
});

describe("cashback on a card lowers the bill and is never a payment", () => {
  const cardAccount = { id: "acc", type: "CREDIT", name: "Cartão", balance: 0 } as never;
  const base = { id: "x", date: "2026-10-27T12:00:00.000Z", amount: -20, type: "CREDIT", status: "POSTED" };

  it.each([
    ["Cashback Elo", "PAGAMENTO"],
    ["CASH BACK PONTOS", "PAGAMENTO_FATURA"],
    ["CREDITO PROMOCIONAL", "CASHBACK"],
  ])("%s with operationType %s is not a bill payment", (description, operationType) => {
    expect(mapTransaction({ ...base, description, operationType }, cardAccount, "2026-11-17", "B")!.isBillPayment).toBe(false);
  });

  it("its text never reads like a payment, even with 'pagamento' in it", () => {
    expect(categorizeByKeywords("PAGAMENTO CASHBACK", 2000, "credit_card")).toBe("outras-receitas");
  });

  it("an older cashback saved as a payment does not teach the next one", () => {
    const categorize = makeCategorizer(cats, [{ merchant: normalizeMerchant("Cashback Elo"), categoryId: "c-pay" }], "credit_card");
    expect(categorize("Cashback Elo", 1000)).toBe("c-in");
  });
});
