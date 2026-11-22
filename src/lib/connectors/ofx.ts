// OFX 1.x (SGML) and 2.x (XML) statement parser. Only reads STMTTRN entries; ignores everything else.
import { parseFlexibleDate } from "../dates";
import type { RowResult } from "./csv";

export type ParsedOfx = {
  account: { bankId?: string; accountId?: string; type: "checking" | "savings" | "credit_card" };
  currency?: string;
  rows: RowResult[];
};

function tag(block: string, name: string): string | undefined {
  // Works for both <TAG>value (SGML, no closing tag) and <TAG>value</TAG> (XML).
  const m = block.match(new RegExp(`<${name}>([^<\\r\\n]*)`, "i"));
  return m?.[1]?.trim() || undefined;
}

function decodeEntities(s: string): string {
  return s.replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'");
}

/** OFX amounts have no thousands separator: "-1.500" is R$ 1,50, unlike the pt-BR text parser. Comma appears in some BR exports. */
export function parseOfxAmount(input: string): number | null {
  const m = input.trim().replace(",", ".").match(/^([+-]?)(\d*)(?:\.(\d*))?$/);
  if (!m || !(m[2] || m[3])) return null;
  const frac = m[3] ?? "";
  if (/[1-9]/.test(frac.slice(2))) return null;
  const cents = Number(m[2] || "0") * 100 + Number(frac.padEnd(2, "0").slice(0, 2));
  if (!Number.isSafeInteger(cents)) return null;
  return m[1] === "-" ? -cents : cents;
}

export function parseOfx(text: string): ParsedOfx {
  if (!/<OFX>/i.test(text)) throw new Error("Arquivo não parece ser OFX (tag <OFX> não encontrada).");
  const isCard = /<CCSTMTRS>/i.test(text);
  const acctType = tag(text, "ACCTTYPE")?.toUpperCase();
  const blocks = text.split(/<STMTTRN>/i).slice(1).map((b) => b.split(/<\/STMTTRN>/i)[0]!);
  if (blocks.length > 5000) throw new Error(`O arquivo tem ${blocks.length} lançamentos; o limite é 5.000. Exporte um período menor.`);
  const rows: RowResult[] = blocks.map((b, i) => {
    const line = i + 1;
    const date = parseFlexibleDate(tag(b, "DTPOSTED") ?? "");
    if (!date) return { line, ok: false, error: "DTPOSTED inválido" };
    const amount = parseOfxAmount(tag(b, "TRNAMT") ?? "");
    if (amount === null || amount === 0) return { line, ok: false, error: "TRNAMT inválido" };
    const description = decodeEntities([tag(b, "NAME"), tag(b, "MEMO")].filter(Boolean).join(" - ") || "Sem descrição");
    return { line, ok: true, tx: { externalId: tag(b, "FITID"), date, description: description.slice(0, 200), amountCents: amount } };
  });
  return {
    account: {
      bankId: tag(text, "BANKID"),
      accountId: tag(text, "ACCTID"),
      type: isCard ? "credit_card" : acctType === "SAVINGS" ? "savings" : "checking",
    },
    currency: tag(text, "CURDEF"),
    rows,
  };
}
