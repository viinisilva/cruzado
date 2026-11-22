// CSV statements: parse, suggest a column mapping, validate rows. The raw file is never persisted.
import Papa from "papaparse";
import { z } from "zod";
import { parseFlexibleDate } from "../dates";
import { parseMoneyToCents } from "../money";
import { stripAccents } from "../text";
import type { ExternalTransaction } from "./types";

export const CsvMapping = z
  .object({
    date: z.string().min(1),
    description: z.string().min(1),
    amount: z.string().optional(), // single signed column
    debit: z.string().optional(), // or separate debit/credit columns
    credit: z.string().optional(),
    invertSign: z.boolean().optional(), // some card exports show purchases as positive
  })
  .strict()
  .refine((m) => m.amount || m.debit || m.credit, { message: "Escolha a coluna de valor (ou débito/crédito)." });
export type CsvMapping = z.infer<typeof CsvMapping>;

export type ParsedCsv = { headers: string[]; rows: Record<string, string>[]; headerLine?: number };

// Banks often put a summary or account details above the table, so the header may not be the first row.
const HEADER_SEARCH_ROWS = 30;

function findHeaderRow(rows: string[][]): number {
  const limit = Math.min(rows.length, HEADER_SEARCH_ROWS);
  for (let i = 0; i < limit; i++) {
    const m = suggestMapping(rows[i]!.map((c) => c.trim()).filter(Boolean));
    if (m.date && m.description && (m.amount || m.debit || m.credit)) return i;
  }
  return 0;
}

export function parseCsv(text: string): ParsedCsv {
  const clean = text.replace(/^﻿/, "");
  const result = Papa.parse<string[]>(clean, { skipEmptyLines: "greedy", delimitersToGuess: [";", ",", "\t", "|"] });
  const headerRow = findHeaderRow(result.data);
  const headers = (result.data[headerRow] ?? []).map((h) => h.trim());
  if (headers.filter(Boolean).length < 2) throw new Error("Não encontrei a tabela de lançamentos neste arquivo. Confira se é o extrato em CSV do seu banco.");
  const body = result.data.slice(headerRow + 1);
  if (body.length > 5000) throw new Error(`O arquivo tem ${body.length} linhas; o limite é 5.000. Exporte um período menor.`);
  const rows = body.map((cells) => Object.fromEntries(headers.flatMap((h, i) => (h ? [[h, cells[i] ?? ""] as const] : []))));
  return { headers: headers.filter(Boolean), rows, headerLine: headerRow + 1 };
}

const norm = (s: string) => stripAccents(s).toLowerCase();

export function suggestMapping(headers: string[]): Partial<CsvMapping> {
  const date = headers.find((h) => ["data", "date", "dt"].some((k) => norm(h).includes(k)));
  // Keys in priority order, and never the date column ("Data Lançamento" must not win as description).
  const find = (...keys: string[]) => {
    for (const k of keys) {
      const hit = headers.find((h) => h !== date && norm(h).includes(k));
      if (hit) return hit;
    }
    return undefined;
  };
  const debit = find("debito", "saida", "debit");
  const credit = find("credito", "entrada", "credit");
  // Net before gross, and never a running balance such as "Valor do saldo".
  const amount = headers
    .filter((h) => h !== date && !/saldo|balance/.test(norm(h)))
    .sort((a, b) => Number(/net/.test(norm(b))) - Number(/net/.test(norm(a))))
    .find((h) => ["valor", "amount", "montante", "quantia"].some((k) => norm(h).includes(k)));
  return {
    date,
    description: find("descri", "historico", "estabelecimento", "lancamento", "memo", "title", "nome", "transaction_type", "tipo"),
    ...(amount ? { amount } : { debit, credit }),
  };
}

// Balance lines in bank exports are not transactions; importing them would inflate the balance.
const BALANCE_LINE = /^saldo\b/;

export type RowResult = { line: number; ok: true; tx: ExternalTransaction } | { line: number; ok: false; error: string };

export function mapCsvRows(parsed: ParsedCsv, mapping: CsvMapping): RowResult[] {
  return parsed.rows.map((row, i) => {
    const line = i + 1 + (parsed.headerLine ?? 1);
    const date = parseFlexibleDate(row[mapping.date] ?? "");
    if (!date) return { line, ok: false, error: `Data inválida: "${(row[mapping.date] ?? "").slice(0, 20)}"` };
    const description = (row[mapping.description] ?? "").trim();
    if (!description) return { line, ok: false, error: "Descrição vazia" };
    if (BALANCE_LINE.test(norm(description))) return { line, ok: false, error: "Linha de saldo ignorada" };
    let cents: number | null;
    if (mapping.amount) {
      cents = parseMoneyToCents(row[mapping.amount] ?? "");
    } else {
      const d = mapping.debit && row[mapping.debit]?.trim() ? parseMoneyToCents(row[mapping.debit]!) : 0;
      const c = mapping.credit && row[mapping.credit]?.trim() ? parseMoneyToCents(row[mapping.credit]!) : 0;
      cents = d === null || c === null ? null : Math.abs(c) - Math.abs(d);
    }
    if (cents === null) return { line, ok: false, error: "Valor inválido" };
    if (cents === 0) return { line, ok: false, error: "Valor zero" };
    if (mapping.invertSign) cents = -cents;
    return { line, ok: true, tx: { date, description: description.slice(0, 200), amountCents: cents } };
  });
}
