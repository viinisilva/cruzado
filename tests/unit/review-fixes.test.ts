// Regressions found in the pre-deploy review.
import { describe, expect, it } from "vitest";
import { categorizeByKeywords } from "@/lib/categorizer";
import { parseOfx, parseOfxAmount } from "@/lib/connectors/ofx";
import { mapCsvRows, parseCsv, suggestMapping } from "@/lib/connectors/csv";
import { currentStatementCycle, detectRecurring } from "@/lib/finance/core";
import { homePeriod, previousComparableRange } from "@/lib/finance/period";
import { maskMoney } from "@/lib/money";
import { parseTxQuery, txHref } from "@/lib/tx-query";
import { normalizeMerchant, parseInstallment } from "@/lib/text";

const card = (closingDay: number, dueDay: number) => ({ accountId: "c", limitCents: 1, closingDay, dueDay });

describe("OFX amounts", () => {
  it.each([
    ["-1.500", -150],
    ["-1500.00", -150000],
    ["1234.5", 123450],
    ["-12,30", -1230],
    ["+10", 1000],
  ])("%s → %d cents", (s, cents) => expect(parseOfxAmount(s)).toBe(cents));

  it("rejects text and sub-cent values", () => {
    expect(parseOfxAmount("abc")).toBeNull();
    expect(parseOfxAmount("1.2345")).toBeNull();
    expect(parseOfxAmount("")).toBeNull();
  });

  it("refuses files over the row limit instead of truncating", () => {
    const body = "<STMTTRN><DTPOSTED>20251001<TRNAMT>-1.00<FITID>1</STMTTRN>".repeat(5001);
    expect(() => parseOfx(`<OFX>${body}</OFX>`)).toThrow(/limite/);
  });
});

describe("CSV", () => {
  it("does not reuse the date column as description", () => {
    expect(suggestMapping(["Data Lançamento", "Histórico", "Descrição", "Valor", "Saldo"])).toMatchObject({
      date: "Data Lançamento",
      description: "Descrição",
      amount: "Valor",
    });
  });

  it("finds the real table below a summary block, as in Mercado Pago statements", () => {
    const file = [
      "INITIAL_BALANCE;CREDITS;DEBITS;FINAL_BALANCE",
      "100,00;500,00;-150,50;449,50",
      "",
      "RELEASE_DATE;TRANSACTION_TYPE;REFERENCE_ID;TRANSACTION_NET_AMOUNT;PARTIAL_BALANCE",
      "01-10-2026;Pagamento com Pix;123;-150,50;-50,50",
      "02-10-2026 09:30;Transferência recebida;124;500,00;449,50",
    ].join("\n");
    const parsed = parseCsv(file);
    expect(parsed.headers).toContain("RELEASE_DATE");
    const mapping = suggestMapping(parsed.headers);
    expect(mapping).toEqual({ date: "RELEASE_DATE", description: "TRANSACTION_TYPE", amount: "TRANSACTION_NET_AMOUNT" });
    const rows = mapCsvRows(parsed, mapping as never);
    expect(rows.map((r) => (r.ok ? [r.tx.date, r.tx.amountCents] : r.error))).toEqual([
      ["2026-10-01", -15050],
      ["2026-10-02", 50000],
    ]);
  });

  it("skips account details above the header and reports the real line number", () => {
    const parsed = parseCsv("Banco Exemplo;;\nConta;1234-5;\nData;Descrição;Valor\n01/10/2025;Mercado;-10,00\n");
    expect(parsed.headers).toEqual(["Data", "Descrição", "Valor"]);
    expect(mapCsvRows(parsed, { date: "Data", description: "Descrição", amount: "Valor" })[0]!.line).toBe(4);
  });

  it("does not take a running balance as the amount", () => {
    expect(suggestMapping(["Data", "Histórico", "Valor do saldo", "Valor"]).amount).toBe("Valor");
  });

  it("ignores balance lines", () => {
    const parsed = parseCsv("Data;Descrição;Valor\n01/10/2025;SALDO ANTERIOR;1000,00\n02/10/2025;Saldo do dia;900,00\n02/10/2025;Mercado;-100,00\n");
    const rows = mapCsvRows(parsed, { date: "Data", description: "Descrição", amount: "Valor" });
    expect(rows.filter((r) => r.ok)).toHaveLength(1);
  });

  it("refuses files over the row limit instead of truncating", () => {
    expect(() => parseCsv(`Data;Descrição;Valor\n${"01/10/2025;x;1,00\n".repeat(5001)}`)).toThrow(/limite/);
  });
});

describe("categorization and merchants", () => {
  it("keeps Pix to third parties as real income and expense", () => {
    expect(categorizeByKeywords("Transferência enviada pelo Pix - Imobiliaria Lar", -210000)).toBe("moradia");
    expect(categorizeByKeywords("Transferência recebida pelo Pix - ACME LTDA", 500000)).toBe("outras-receitas");
    expect(categorizeByKeywords("Transferência entre contas", -1000)).toBe("transferencias");
  });

  it("treats 'pagamento recebido' as a bill payment only on cards", () => {
    expect(categorizeByKeywords("Pagamento recebido", 10000, "credit_card")).toBe("pagamento-fatura");
    expect(categorizeByKeywords("Pagamento recebido", 10000, "checking")).toBe("outras-receitas");
  });

  it("does not merge number-only descriptions", () => {
    expect(normalizeMerchant("PIX 00123")).not.toBe(normalizeMerchant("TED 456"));
  });

  it("does not read a date in the middle of the text as installments", () => {
    expect(parseInstallment("COMPRA CARTAO 05/12 SUPERMERCADO")).toBeNull();
    expect(parseInstallment("Geladeira parc 3/10 loja")).toEqual({ number: 3, total: 10 });
    expect(parseInstallment("Geladeira parcela 3 de 10")).toEqual({ number: 3, total: 10 });
  });
});

describe("privacy masking", () => {
  it("hides amounts in free text, keeping the rest readable", () => {
    expect(maskMoney("Hoje somam R$ 510,31, acima de R$ 300 (-R$ 1.210,31 a mais).")).toBe("Hoje somam R$ ••••, acima de R$ •••• ( R$ •••• a mais).");
    expect(maskMoney("R$ 7")).toBe("R$ ••••");
    expect(maskMoney("gastou 60 reais e BRL 12,50")).not.toMatch(/\d/);
    expect(maskMoney("Sem valores aqui")).toBe("Sem valores aqui");
  });

  it("hides percentage changes, which reveal amounts relative to each other", () => {
    expect(maskMoney("(01/10/2026 a 14/10/2026; -21,2%). Restaurantes (+128,1%) e 5% a mais")).toBe("(01/10/2026 a 14/10/2026; ••%). Restaurantes (••%) e ••% a mais");
  });
});

describe("transaction filters in the URL", () => {
  const base = { de: "2026-10-01", ate: "2026-10-31" };

  it("reads several accounts from links and from the form", () => {
    expect(parseTxQuery({ contas: "a,b" }, "2026-10-30").contas).toEqual(["a", "b"]);
    expect(parseTxQuery({ contas: ["a", "b", "a"] }, "2026-10-30").contas).toEqual(["a", "b"]);
  });

  it("swaps inverted dates and ignores invalid values", () => {
    expect(parseTxQuery({ de: "2026-10-30", ate: "2026-10-01" }, "2026-10-30")).toMatchObject({ de: "2026-10-01", ate: "2026-10-30" });
    expect(parseTxQuery({ tipo: "x", pagina: "-5" }, "2026-10-30")).toMatchObject({ tipo: undefined, pagina: undefined });
  });

  it("keeps filters in the link", () => {
    expect(txHref({ ...base, contas: ["a", "b"], tipo: "despesa", q: "pix" })).toBe("/transacoes?de=2026-10-01&ate=2026-10-31&contas=a%2Cb&q=pix&tipo=despesa");
    expect(txHref({})).toBe("/transacoes");
  });
});

describe("home period", () => {
  it("falls back to this month and compares equal windows", () => {
    expect(homePeriod("x", "2026-10-30").range).toEqual({ from: "2026-10-01", to: "2026-10-30" });
    expect(homePeriod("mes-passado", "2026-10-30").range).toEqual({ from: "2026-09-01", to: "2026-09-30" });
    expect(previousComparableRange(homePeriod("mes", "2026-10-15").range)).toEqual({ from: "2026-09-01", to: "2026-09-15" });
  });
});

describe("statement cycle in short months", () => {
  it("closing day 31 never overlaps", () => {
    expect(currentStatementCycle(card(31, 10), "2026-02-20").cycle).toEqual({ from: "2026-02-01", to: "2026-02-28" });
    expect(currentStatementCycle(card(31, 10), "2026-04-20").cycle).toEqual({ from: "2026-04-01", to: "2026-04-30" });
  });

  it("keeps the configured due day after a short closing month", () => {
    expect(currentStatementCycle(card(30, 31), "2026-05-10").dueDate).toBe("2026-05-31");
  });
});

describe("periods", () => {
  it("compares long windows with the window right before them, without overlap", () => {
    expect(previousComparableRange({ from: "2026-08-02", to: "2026-10-30" })).toEqual({ from: "2026-05-04", to: "2026-08-01" });
  });
});

describe("installments", () => {
  const tx = (id: string, accountId: string, date: string, number: number, total: number) => ({
    id,
    accountId,
    date,
    description: `Loja ${number}/${total}`,
    merchant: "loja",
    amountCents: -1000,
    categoryId: null,
    installmentNumber: number,
    installmentTotal: total,
  });

  it("drops plans whose installments are all in the past", () => {
    expect(detectRecurring([tx("1", "a", "2025-01-10", 1, 3)], [], "2026-10-30")).toEqual([]);
  });

  it("keeps plans on different cards apart", () => {
    const out = detectRecurring([tx("1", "a", "2026-10-10", 2, 5), tx("2", "b", "2026-10-12", 3, 5)], [], "2026-10-30");
    expect(out.map((r) => r.transactionIds)).toEqual([["1"], ["2"]]);
  });

  it("keeps two purchases at one store apart on the same card", () => {
    const out = detectRecurring([tx("1", "a", "2026-10-10", 2, 5), tx("2", "a", "2026-10-12", 4, 6)], [], "2026-10-30");
    expect(out.map((r) => [r.transactionIds, r.remainingInstallments])).toEqual([[["1"], 3], [["2"], 2]]);
  });

  it("still sees one purchase when the bank moves a date into the next month", () => {
    const out = detectRecurring([tx("1", "a", "2026-08-30", 2, 5), tx("2", "a", "2026-10-01", 3, 5)], [], "2026-10-10");
    expect(out.map((r) => [r.transactionIds, r.remainingInstallments])).toEqual([[["1", "2"], 2]]);
  });

  it("two purchases started in neighbouring months stay apart when an installment number repeats", () => {
    const rows = [tx("1", "a", "2026-09-10", 1, 5), tx("2", "a", "2026-10-10", 2, 5), tx("3", "a", "2026-10-11", 1, 5), tx("4", "a", "2026-11-11", 2, 5)];
    expect(detectRecurring(rows, [], "2026-11-12").map((r) => r.transactionIds)).toEqual([["1", "2"], ["3", "4"]]);
  });

  it("a refund does not count as an installment of the purchase", () => {
    const refund = { ...tx("2", "a", "2026-10-20", 3, 5), amountCents: 1000 };
    const out = detectRecurring([tx("1", "a", "2026-10-10", 2, 5), refund], [], "2026-10-30");
    expect(out.map((r) => r.transactionIds)).toEqual([["1"]]);
  });
});
