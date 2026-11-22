// Statement import: preview (no writes) → user confirms → idempotent insert.
// Only the file hash and metadata are stored; the raw file is discarded after parsing.
import { createHash } from "node:crypto";
import { and, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import type { DB } from "@/db/connection";
import * as s from "@/db/schema";
import { newId } from "./ids";
import { audit } from "./audit";
import { todayInSaoPaulo } from "./dates";
import { normalizeMerchant, parseInstallment } from "./text";
import { makeCategorizer } from "./categorizer";
import { CsvMapping, mapCsvRows, parseCsv, suggestMapping, type RowResult } from "./connectors/csv";
import { parseOfx } from "./connectors/ofx";
import { loadCategories } from "./data/repo";
import { refreshRecurring } from "./finance/recurring-store";
import { suggestMatchesSafely } from "./reconcile";
import { runUserAgents } from "./agents/service";

export const MAX_IMPORT_BYTES = 2 * 1024 * 1024;
const INSERT_BATCH = 500;

export const ImportRequest = z.object({
  format: z.enum(["csv", "ofx"]),
  fileName: z.string().min(1).max(200),
  content: z.string().min(1).max(MAX_IMPORT_BYTES),
  accountId: z.string().min(1),
  mapping: CsvMapping.optional(),
});
export type ImportRequest = z.infer<typeof ImportRequest>;

export type PreviewRow = {
  line: number;
  status: "new" | "duplicate" | "invalid";
  date?: string;
  description?: string;
  amountCents?: number;
  categoryName?: string | null;
  error?: string;
};

export type Preview = {
  format: "csv" | "ofx";
  headers?: string[];
  suggestedMapping?: Partial<z.infer<typeof CsvMapping>>;
  needsMapping: boolean;
  rows: PreviewRow[];
  counts: { total: number; new: number; duplicate: number; invalid: number };
  fileSha256: string;
  ofxAccount?: { accountId?: string; type: string };
};

const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");

/** Stable key so re-importing the same statement (or an overlapping one) never duplicates rows. */
export function dedupeKeyFor(accountId: string, tx: { externalId?: string; date: string; amountCents: number; description: string }, occurrence: number): string {
  // Date and amount too: some banks reuse FITIDs, which would silently drop real entries.
  if (tx.externalId) return `ofx:${sha256(`${accountId}|${tx.externalId}|${tx.date}|${tx.amountCents}`)}`;
  return `file:${sha256(`${accountId}|${tx.date}|${tx.amountCents}|${normalizeMerchant(tx.description)}|${occurrence}`)}`;
}

async function assertAccount(db: DB, userId: string, accountId: string) {
  const [acc] = await db.select().from(s.accounts).where(and(eq(s.accounts.id, accountId), eq(s.accounts.userId, userId)));
  if (!acc) throw new Error("Conta não encontrada.");
  return acc;
}

function parseRows(req: ImportRequest): { rows: RowResult[]; headers?: string[]; suggested?: Partial<z.infer<typeof CsvMapping>>; needsMapping: boolean; ofxAccount?: Preview["ofxAccount"] } {
  if (req.format === "ofx") {
    const ofx = parseOfx(req.content);
    if (ofx.currency && ofx.currency.toUpperCase() !== "BRL") throw new Error(`Extrato em ${ofx.currency}: só importamos valores em reais (BRL).`);
    return { rows: ofx.rows, needsMapping: false, ofxAccount: { accountId: ofx.account.accountId, type: ofx.account.type } };
  }
  const parsed = parseCsv(req.content);
  const suggested = suggestMapping(parsed.headers);
  const mapping = req.mapping ?? CsvMapping.safeParse(suggested).data;
  if (!mapping) return { rows: [], headers: parsed.headers, suggested, needsMapping: true };
  for (const col of [mapping.date, mapping.description, mapping.amount, mapping.debit, mapping.credit]) {
    if (col && !parsed.headers.includes(col)) throw new Error(`Coluna "${col}" não existe no arquivo.`);
  }
  return { rows: mapCsvRows(parsed, mapping), headers: parsed.headers, suggested, needsMapping: false };
}

type Planned = { line: number; key: string; tx: { externalId?: string; date: string; description: string; amountCents: number } };

function plan(accountId: string, rows: RowResult[]): Planned[] {
  const seen = new Map<string, number>();
  const out: Planned[] = [];
  for (const r of rows) {
    if (!r.ok) continue;
    const base = `${r.tx.date}|${r.tx.amountCents}|${normalizeMerchant(r.tx.description)}`;
    const occurrence = seen.get(base) ?? 0;
    seen.set(base, occurrence + 1);
    out.push({ line: r.line, key: dedupeKeyFor(accountId, r.tx, occurrence), tx: r.tx });
  }
  return out;
}

async function existingKeys(db: DB, userId: string, keys: string[]): Promise<Set<string>> {
  const found = new Set<string>();
  for (let i = 0; i < keys.length; i += 500) {
    const chunk = keys.slice(i, i + 500);
    if (!chunk.length) continue;
    const rows = await db
      .select({ k: s.transactions.dedupeKey })
      .from(s.transactions)
      .where(and(eq(s.transactions.userId, userId), inArray(s.transactions.dedupeKey, chunk)));
    rows.forEach((r) => found.add(r.k));
  }
  return found;
}

export async function categorizerFor(db: DB, userId: string, accountType: string) {
  const [cats, history] = await Promise.all([
    loadCategories(db, userId),
    db.select({ merchant: s.transactions.merchant, categoryId: s.transactions.categoryId }).from(s.transactions).where(eq(s.transactions.userId, userId)).orderBy(s.transactions.date),
  ]);
  return { cats, categorize: makeCategorizer(cats, history.reverse(), accountType) };
}

export async function previewImport(db: DB, userId: string, req: ImportRequest): Promise<Preview> {
  const account = await assertAccount(db, userId, req.accountId);
  const parsed = parseRows(req);
  const planned = plan(req.accountId, parsed.rows);
  const existing = await existingKeys(db, userId, planned.map((p) => p.key));
  const { cats, categorize } = await categorizerFor(db, userId, account.type);
  const byLine = new Map(planned.map((p) => [p.line, p]));
  const rows: PreviewRow[] = parsed.rows.map((r) => {
    if (!r.ok) return { line: r.line, status: "invalid", error: r.error };
    const p = byLine.get(r.line)!;
    const catId = categorize(r.tx.description, r.tx.amountCents);
    return {
      line: r.line,
      status: existing.has(p.key) ? "duplicate" : "new",
      date: r.tx.date,
      description: r.tx.description,
      amountCents: r.tx.amountCents,
      categoryName: cats.find((c) => c.id === catId)?.name ?? null,
    };
  });
  return {
    format: req.format,
    headers: parsed.headers,
    suggestedMapping: parsed.suggested,
    needsMapping: parsed.needsMapping,
    rows,
    counts: {
      total: rows.length,
      new: rows.filter((r) => r.status === "new").length,
      duplicate: rows.filter((r) => r.status === "duplicate").length,
      invalid: rows.filter((r) => r.status === "invalid").length,
    },
    fileSha256: sha256(req.content),
    ofxAccount: parsed.ofxAccount,
  };
}

export async function commitImport(db: DB, userId: string, req: ImportRequest, now: Date = new Date()) {
  const account = await assertAccount(db, userId, req.accountId);
  const parsed = parseRows(req);
  if (parsed.needsMapping) throw new Error("Defina o mapeamento de colunas antes de importar.");
  const planned = plan(req.accountId, parsed.rows);
  const { categorize } = await categorizerFor(db, userId, account.type);
  const importId = newId();
  let imported = 0;
  await db.transaction(async (tx) => {
    await tx.insert(s.transactionImports).values({
      id: importId,
      userId,
      accountId: req.accountId,
      format: req.format,
      fileName: req.fileName.slice(0, 200),
      fileSha256: sha256(req.content),
      rowsTotal: parsed.rows.length,
      rowsImported: 0,
      rowsSkipped: 0,
    });
    // Batched: one round trip per row would exceed a serverless function's time limit on large statements.
    for (let i = 0; i < planned.length; i += INSERT_BATCH) {
      const values = planned.slice(i, i + INSERT_BATCH).map((p) => {
        const inst = parseInstallment(p.tx.description);
        return {
          id: newId(),
          userId,
          accountId: req.accountId,
          categoryId: categorize(p.tx.description, p.tx.amountCents),
          importId,
          date: p.tx.date,
          description: p.tx.description,
          merchant: normalizeMerchant(p.tx.description),
          amountCents: p.tx.amountCents,
          installmentNumber: inst?.number ?? null,
          installmentTotal: inst?.total ?? null,
          source: req.format,
          dedupeKey: p.key,
        };
      });
      const inserted = await tx
        .insert(s.transactions)
        .values(values)
        .onConflictDoNothing({ target: [s.transactions.userId, s.transactions.dedupeKey] })
        .returning({ id: s.transactions.id });
      imported += inserted.length;
    }
    await tx
      .update(s.transactionImports)
      .set({ rowsImported: imported, rowsSkipped: parsed.rows.length - imported })
      .where(eq(s.transactionImports.id, importId));
  });
  await audit(db, userId, "import.completed", { importId, format: req.format, imported, skipped: parsed.rows.length - imported });
  if (imported > 0) {
    await refreshRecurring(db, userId, todayInSaoPaulo(now));
    await runUserAgents(db, userId, now, ["daily_spend_limit", "possible_duplicate"]);
    await suggestMatchesSafely(db, userId, todayInSaoPaulo(now));
  }
  return { importId, imported, skipped: parsed.rows.length - imported, invalid: parsed.rows.filter((r) => !r.ok).length };
}
