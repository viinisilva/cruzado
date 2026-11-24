// The reconciliation report (Cartões › Conciliação › Baixar relatório): each pending proposal with its evidence and what
// it would do to the bills, computed without changing anything.
import { describe, expect, it } from "vitest";
import type { BankBill, CardInfo, FinCategory, FinTx } from "@/lib/finance/core";
import { buildReconciliationReport, reportMarkdown, type ReportInput } from "@/lib/finance/reconciliation-report";

const cats: FinCategory[] = [
  { id: "c-exp", name: "Compras", slug: "compras", kind: "expense" },
  { id: "c-pay", name: "Pagamento de fatura", slug: "pagamento-fatura", kind: "transfer" },
];
const bill = (billRef: string, dueDate: string, totalCents: number): BankBill => ({ billRef, dueDate, closingDate: null, totalCents, minimumCents: null });
const card: CardInfo = { accountId: "k", limitCents: 500000, closingDay: 15, dueDay: 25, closingDaySource: "estimated", bills: [bill("B-NOV", "2026-11-25", 100000)] };
const base = { accountId: "k", installmentNumber: null, installmentTotal: null } as const;
const purchase: FinTx = { ...base, id: "buy", categoryId: "c-exp", date: "2026-10-20", description: "LOJA BOA", merchant: "loja boa", amountCents: -110000, billRef: "B-NOV" };
// A refund the bank marked as PAGAMENTO, so it went to "Pagamento de fatura" and left the bill.
const credit: FinTx = {
  ...base,
  id: "back",
  categoryId: "c-pay",
  date: "2026-11-02",
  description: "ESTORNO LOJA BOA",
  merchant: "loja boa",
  amountCents: 10000,
  billRef: "B-NOV",
  classification: { version: 1, kind: "refund", reason: "refund-partial", signals: [{ code: "refund-partial", kind: "refund", points: 2, ref: "buy" }, { code: "op-payment", kind: "payment", points: 1 }], matchedTxId: "buy", decidedAt: "2026-11-17" },
};
const input = (): ReportInput => ({
  today: "2026-11-17",
  cards: [card],
  txs: [purchase, credit],
  categories: cats,
  accounts: [{ id: "k", name: "Cartão Ipê" }],
  proposals: [{ id: "p1", txId: "back", accountId: "k", before: { categoryId: "c-pay" }, after: { categoryId: "c-exp", kind: "refund" }, reason: "estorno: existe a compra que ele desfaz" }],
});

describe("buildReconciliationReport", () => {
  it("shows each proposal with its evidence and its effect on the bill, and changes nothing", () => {
    const data = input();
    const before = JSON.stringify(data);
    const report = buildReconciliationReport(data);
    expect(JSON.stringify(data)).toBe(before);

    expect(report.proposals).toHaveLength(1);
    const [p] = report.proposals;
    expect(p).toMatchObject({ description: "ESTORNO LOJA BOA", amountCents: 10000, accountName: "Cartão Ipê", from: "Pagamento de fatura", to: "Compras", billMonth: "2026-11", deltaCents: -10000 });
    expect(p!.evidence.map((e) => e.code)).toEqual(["refund-partial", "op-payment"]);
    expect(p!.evidence[0]!.ref).toBe("LOJA BOA, 20/10/2026, R$ 1.100,00");

    expect(report.bills).toEqual([{ accountName: "Cartão Ipê", month: "2026-11", status: "closed", bankTotalCents: 100000, beforeCents: 110000, afterCents: 100000, matchesBefore: false, matchesAfter: true }]);
  });

  it("skips a proposal whose entry no longer exists, and says how many", () => {
    const data = { ...input(), proposals: [...input().proposals, { id: "p2", txId: "gone", accountId: "k", before: { categoryId: "c-pay" }, after: { categoryId: "c-exp" }, reason: "x" }] };
    const report = buildReconciliationReport(data);
    expect(report.proposals).toHaveLength(1);
    expect(report.skipped).toBe(1);
  });
});

describe("reportMarkdown", () => {
  it("reads as a review document: what changes, why, and what the bill becomes", () => {
    const md = reportMarkdown(buildReconciliationReport(input()));
    expect(md).toContain("# Relatório da conciliação");
    expect(md).toContain("Nada foi aplicado");
    expect(md).toContain("ESTORNO LOJA BOA");
    expect(md).toContain("Pagamento de fatura → Compras");
    expect(md).toContain("Existe uma compra parecida, de valor maior, antes dele (2 pontos para estorno)");
    expect(md).toMatch(/Fatura de novembro de 2026.*R\$ 1\.100,00.*R\$ 1\.000,00.*passa a bater/s);
  });

  it("says so when there is nothing to review", () => {
    expect(reportMarkdown(buildReconciliationReport({ ...input(), proposals: [] }))).toContain("Nenhuma mudança esperando revisão.");
  });
});
