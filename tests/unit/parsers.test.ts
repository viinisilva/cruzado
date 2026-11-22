import { describe, expect, it } from "vitest";
import { mapCsvRows, parseCsv, suggestMapping } from "@/lib/connectors/csv";
import { parseOfx } from "@/lib/connectors/ofx";
import { categorizeByKeywords } from "@/lib/categorizer";
import { AgentRuleSchema, describeRule } from "@/lib/agents/rule";
import { parseIntent, parsePeriod } from "@/lib/ai/mock-intent";
import { needsDisclaimer } from "@/lib/chat/engine";

const CSV = "﻿Data;Descrição;Valor\n01/10/2025;Supermercado Bom Preço;-123,45\n02/10/2025;Salário;5.000,00\n31/02/2025;Data ruim;-1,00\n03/10/2025;;-5,00\n";

describe("CSV", () => {
  it("parses semicolon pt-BR files and suggests a mapping", () => {
    const parsed = parseCsv(CSV);
    expect(parsed.headers).toEqual(["Data", "Descrição", "Valor"]);
    expect(suggestMapping(parsed.headers)).toEqual({ date: "Data", description: "Descrição", amount: "Valor" });
  });
  it("validates rows with line numbers", () => {
    const rows = mapCsvRows(parseCsv(CSV), { date: "Data", description: "Descrição", amount: "Valor" });
    expect(rows[0]).toMatchObject({ ok: true, tx: { date: "2025-10-01", amountCents: -12345 } });
    expect(rows[1]).toMatchObject({ ok: true, tx: { amountCents: 500000 } });
    expect(rows[2]).toMatchObject({ ok: false, line: 4 });
    expect(rows[3]).toMatchObject({ ok: false, error: "Descrição vazia" });
  });
  it("supports debit/credit columns and inverted card exports", () => {
    const p = parseCsv("date,title,debit,credit\n2025-10-01,Loja,50.00,\n2025-10-02,Refund,,10.00\n");
    const rows = mapCsvRows(p, { date: "date", description: "title", debit: "debit", credit: "credit" });
    expect(rows.map((r) => r.ok && r.tx.amountCents)).toEqual([-5000, 1000]);
    const inv = mapCsvRows(parseCsv("d,t,v\n2025-10-01,Loja,50.00\n"), { date: "d", description: "t", amount: "v", invertSign: true });
    expect(inv[0]!.ok && inv[0]!.tx.amountCents).toBe(-5000);
  });
});

const OFX_SGML = `OFXHEADER:100
DATA:OFXSGML
<OFX><BANKMSGSRSV1><STMTTRNRS><STMTRS><CURDEF>BRL<BANKACCTFROM><BANKID>999<ACCTID>12345-6<ACCTTYPE>CHECKING</BANKACCTFROM>
<BANKTRANLIST>
<STMTTRN><TRNTYPE>DEBIT<DTPOSTED>20251001120000[-3:BRT]<TRNAMT>-45.90<FITID>A1<MEMO>Farmacia Bem Estar
</STMTTRN>
<STMTTRN><TRNTYPE>CREDIT<DTPOSTED>20251005<TRNAMT>7850,00<FITID>A2<NAME>SALARIO &amp; BONUS
</STMTTRN>
<STMTTRN><TRNTYPE>DEBIT<DTPOSTED>xx<TRNAMT>-1.00<FITID>A3<MEMO>Ruim
</STMTTRN>
</BANKTRANLIST></STMTRS></STMTTRNRS></BANKMSGSRSV1></OFX>`;

describe("OFX", () => {
  it("parses SGML statements", () => {
    const r = parseOfx(OFX_SGML);
    expect(r.account).toMatchObject({ accountId: "12345-6", type: "checking" });
    expect(r.rows[0]).toMatchObject({ ok: true, tx: { externalId: "A1", date: "2025-10-01", amountCents: -4590, description: "Farmacia Bem Estar" } });
    expect(r.rows[1]).toMatchObject({ ok: true, tx: { amountCents: 785000, description: "SALARIO & BONUS" } });
    expect(r.rows[2]).toMatchObject({ ok: false });
  });
  it("parses XML statements and card statements", () => {
    const xml = `<?xml version="1.0"?><OFX><CREDITCARDMSGSRSV1><CCSTMTTRNRS><CCSTMTRS><STMTTRN><DTPOSTED>20251002</DTPOSTED><TRNAMT>-10.00</TRNAMT><FITID>X</FITID><NAME>Loja</NAME></STMTTRN></CCSTMTRS></CCSTMTTRNRS></CREDITCARDMSGSRSV1></OFX>`;
    const r = parseOfx(xml);
    expect(r.account.type).toBe("credit_card");
    expect(r.rows[0]).toMatchObject({ ok: true, tx: { amountCents: -1000, externalId: "X" } });
  });
  it("rejects non-OFX", () => expect(() => parseOfx("hello")).toThrow());
});

describe("categorizer", () => {
  it.each([
    ["Supermercado Bom Preço", -100, "mercado"],
    ["App Mobilidade Rota", -100, "transporte"],
    ["Pagamento fatura Cartao", -100, "pagamento-fatura"],
    ["Salário Empresa", 100, "salario"],
    ["Algo aleatório", -100, "outras-despesas"],
    ["Algo aleatório", 100, "outras-receitas"],
  ])("%s → %s", (d, a, slug) => expect(categorizeByKeywords(d, a)).toBe(slug));
});

describe("AgentRule validation", () => {
  const base = { name: "Teste", timezone: "America/Sao_Paulo", enabled: true } as const;
  it("requires threshold for daily limit", () => {
    expect(AgentRuleSchema.safeParse({ ...base, kind: "daily_spend_limit" }).success).toBe(false);
    expect(AgentRuleSchema.safeParse({ ...base, kind: "daily_spend_limit", thresholdCents: 20000 }).success).toBe(true);
  });
  it("rejects arbitrary cron, SQL or unknown fields", () => {
    expect(AgentRuleSchema.safeParse({ ...base, kind: "weekly_summary", schedule: "*/1 * * * *" }).success).toBe(false);
    expect(AgentRuleSchema.safeParse({ ...base, kind: "weekly_summary", sql: "DROP TABLE users" }).success).toBe(false);
    expect(AgentRuleSchema.safeParse({ ...base, kind: "weekly_summary", timezone: "UTC" }).success).toBe(false);
    expect(AgentRuleSchema.safeParse({ ...base, kind: "weekly_summary", thresholdCents: 1.5 }).success).toBe(false);
  });
  it("describes rules in pt-BR", () => {
    const lines = describeRule({ ...base, kind: "daily_spend_limit", thresholdCents: 20000, filters: { categoryIds: ["c1"] } }, { accounts: new Map(), categories: new Map([["c1", "Mercado"]]) });
    expect(lines[0]).toContain("R$ 200,00");
    expect(lines[0]).toContain("Mercado");
  });
});

describe("mock intent parser", () => {
  const ctx = {
    today: "2025-10-15",
    categories: [
      { name: "Mercado", slug: "mercado", kind: "expense" },
      { name: "Transporte", slug: "transporte", kind: "expense" },
      { name: "Salário", slug: "salario", kind: "income" },
    ],
  };
  it("maps spending question with category and period", () => {
    expect(parseIntent("Quanto gastei com mercado neste mês?", ctx)).toEqual({
      calls: [{ name: "getSpendingByCategory", input: { categories: ["Mercado"], period: { preset: "this_month" } } }],
    });
  });
  it("keeps the period unset when not given (tool states the default)", () => {
    expect(parseIntent("quanto gastei com uber?", ctx)).toEqual({ calls: [{ name: "getSpendingByCategory", input: { categories: ["Transporte"] } }] });
  });
  it("passes unknown categories through for clarification", () => {
    expect(parseIntent("quanto gastei com pets?", ctx)).toEqual({ calls: [{ name: "getSpendingByCategory", input: { categories: ["pets"] } }] });
  });
  it("builds an agent draft, asking for a threshold when missing", () => {
    expect(parseIntent("Me avise quando eu gastar mais de R$ 200 por dia com mercado", ctx)).toMatchObject({
      calls: [{ name: "createAgentDraft", input: { kind: "daily_spend_limit", thresholdCents: 20000, categories: ["Mercado"] } }],
    });
    expect(parseIntent("me avise quando passar do limite por dia", ctx)).toHaveProperty("clarify");
  });
  it("asks for clarification on gibberish", () => expect(parseIntent("blá", ctx)).toHaveProperty("clarify"));
  it("parses periods", () => {
    expect(parsePeriod("em setembro", "2025-10-15")).toEqual({ from: "2025-09-01", to: "2025-09-30" });
    expect(parsePeriod("em dezembro", "2025-10-15")).toEqual({ from: "2024-12-01", to: "2024-12-31" });
    expect(parsePeriod("últimos 7 dias", "2025-10-15")).toEqual({ from: "2025-10-09", to: "2025-10-15" });
    expect(parsePeriod("de 01/10 a 10/10", "2025-10-15")).toEqual({ from: "2025-10-01", to: "2025-10-10" });
  });
  it("flags regulated topics", () => {
    expect(needsDisclaimer("devo investir em CDB?")).toBe(true);
    expect(needsDisclaimer("como quitar minha dívida")).toBe(true);
    expect(needsDisclaimer("quanto gastei com mercado")).toBe(false);
  });
});
