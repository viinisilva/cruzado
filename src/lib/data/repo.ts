// Data access. Every query here is scoped by userId on the server — callers never pass ownership checks around.
import { and, asc, desc, eq, gt, gte, inArray, isNull, lt, lte, notInArray, or, sql, type SQL } from "drizzle-orm";
import type { DB } from "@/db/connection";
import * as s from "@/db/schema";
import { todayInSaoPaulo, type DateRange } from "../dates";
import type { CardInfo, FinAccount, FinCategory, FinTx } from "../finance/core";
import { parseInstallment, stripAccents } from "../text";
import { PAGE_SIZE, UNCATEGORIZED_FILTER, type TxOrigin, type TxQuery } from "../tx-query";

export async function loadAccounts(db: DB, userId: string): Promise<(FinAccount & { archived: boolean })[]> {
  const rows = await db
    .select()
    .from(s.accounts)
    .where(eq(s.accounts.userId, userId))
    .orderBy(asc(s.accounts.type), asc(s.accounts.name));
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    institution: r.institution,
    type: r.type,
    openingBalanceCents: r.openingBalanceCents,
    archived: r.archived,
  }));
}

export async function loadCategories(db: DB, userId: string): Promise<FinCategory[]> {
  const rows = await db.select().from(s.categories).where(eq(s.categories.userId, userId)).orderBy(asc(s.categories.name));
  return rows.map((r) => ({ id: r.id, name: r.name, slug: r.slug, kind: r.kind }));
}

/** Saved color name per category id; colors are presentation only, so they stay out of FinCategory. */
export async function loadCategoryColors(db: DB, userId: string): Promise<Map<string, string>> {
  const rows = await db.select({ id: s.categories.id, color: s.categories.color }).from(s.categories).where(eq(s.categories.userId, userId));
  return new Map(rows.map((r) => [r.id, r.color]));
}

export async function loadCards(db: DB, userId: string): Promise<CardInfo[]> {
  const [rows, bills] = await Promise.all([
    db.select().from(s.creditCards).where(eq(s.creditCards.userId, userId)),
    db.select().from(s.cardBills).where(eq(s.cardBills.userId, userId)).orderBy(desc(s.cardBills.dueDate)),
  ]);
  return rows.map((r) => ({
    accountId: r.accountId,
    limitCents: r.limitCents,
    closingDay: r.closingDay,
    dueDay: r.dueDay,
    closingDaySource: r.closingDaySource,
    availableCents: r.availableCents,
    calibration: r.calibration?.version === 1 ? r.calibration : null,
    // Cards typed by hand have no bank to ask; for them this stays undefined.
    billsChecked: r.bankDataAt ? r.billsFetchedAt !== null : undefined,
    dismissedProjections: Array.isArray(r.dismissedProjections) ? r.dismissedProjections : [],
    bills: bills.filter((b) => b.accountId === r.accountId).map((b) => ({ billRef: b.billRef, dueDate: b.dueDate, closingDate: b.closingDate, totalCents: b.totalCents, minimumCents: b.minimumCents, payments: b.payments })),
  }));
}

export async function loadTransactions(
  db: DB,
  userId: string,
  opts: { range?: DateRange; accountIds?: string[]; ids?: string[]; includeFuture?: boolean; today?: string } = {},
): Promise<FinTx[]> {
  // Reconciled entries stay stored for history, but the bank's row is the one that counts everywhere.
  const conds = [eq(s.transactions.userId, userId), isNull(s.transactions.supersededBy)];
  if (!opts.includeFuture) conds.push(notFuture(opts.today ?? todayInSaoPaulo()));
  if (opts.range) conds.push(gte(s.transactions.date, opts.range.from), lte(s.transactions.date, opts.range.to));
  if (opts.accountIds?.length) conds.push(inArray(s.transactions.accountId, opts.accountIds));
  if (opts.ids) {
    if (opts.ids.length === 0) return [];
    conds.push(inArray(s.transactions.id, opts.ids));
  }
  const rows = await db
    .select()
    .from(s.transactions)
    .where(and(...conds))
    .orderBy(desc(s.transactions.date), asc(s.transactions.id));
  return rows.map(toFinTx);
}

/**
 * A card installment the bank already lists with a later date (docs/CALIBRACAO_CARTAO.md, item 4). It only counts in
 * the card bill it falls in; everywhere else (spending, cash flow, balances, lists) it waits for its date. Card screens
 * ask for these rows with `includeFuture`.
 */
// Written so a row without bank status (typed by hand, imported from a file) always passes, whatever its date.
export const notFuture = (today: string) => sql`(${s.transactions.bankStatus} IS DISTINCT FROM 'pending' OR ${s.transactions.date} <= ${today})`;

const ACCENTED = "áàâãäéèêëíìîïóòôõöúùûüç";
const PLAIN = "aaaaaeeeeiiiiooooouuuuc";
const ORIGIN_SOURCES: Record<TxOrigin, s.TransactionSource[]> = { banco: ["open_finance"], arquivo: ["csv", "ofx"], manual: ["manual", "demo"], mensagem: ["assistant"] };

/**
 * One page of the list, filtered in SQL; count and sum always cover every match, not just the page.
 * `includeFuture`: also card installments dated later, for a list made only of card accounts.
 */
export async function searchTransactions(db: DB, userId: string, q: TxQuery, categories: FinCategory[], opts: { includeFuture?: boolean; today?: string } = {}) {
  const t = s.transactions;
  const conds: (SQL | undefined)[] = [eq(t.userId, userId), isNull(t.supersededBy), gte(t.date, q.de!), lte(t.date, q.ate!), opts.includeFuture ? undefined : notFuture(opts.today ?? todayInSaoPaulo())];
  if (q.contas?.length) conds.push(inArray(t.accountId, q.contas));
  if (q.categoria === UNCATEGORIZED_FILTER) conds.push(isNull(t.categoryId));
  else if (q.categoria) conds.push(eq(t.categoryId, q.categoria));
  if (q.q) {
    const needle = `%${stripAccents(q.q).toLowerCase().replace(/[\\%_]/g, "\\$&")}%`;
    conds.push(sql`translate(lower(${t.description}), ${ACCENTED}, ${PLAIN}) LIKE ${needle}`);
  }
  const transfers = categories.filter((c) => c.kind === "transfer").map((c) => c.id);
  const expenses = categories.filter((c) => c.kind === "expense").map((c) => c.id);
  if (q.origem) conds.push(inArray(t.source, ORIGIN_SOURCES[q.origem]));
  if (q.status === "pendente") conds.push(eq(t.bankStatus, "pending"));
  if (q.tipo === "transferencia") conds.push(transfers.length ? inArray(t.categoryId, transfers) : sql`false`);
  if (q.fluxo) {
    if (transfers.length) conds.push(or(isNull(t.categoryId), notInArray(t.categoryId, transfers)));
    // Mirrors cashFlow(): positive money in an expense category is a refund, so it reduces spending.
    const notExpense = expenses.length ? or(isNull(t.categoryId), notInArray(t.categoryId, expenses)) : undefined;
    const income = and(gt(t.amountCents, 0), notExpense);
    if (q.tipo === "receita") conds.push(income);
    if (q.tipo === "despesa") conds.push(or(lte(t.amountCents, 0), and(gt(t.amountCents, 0), expenses.length ? inArray(t.categoryId, expenses) : sql`false`)));
  } else {
    if (q.tipo === "despesa") conds.push(lt(t.amountCents, 0));
    if (q.tipo === "receita") conds.push(gt(t.amountCents, 0));
  }
  const where = and(...conds);
  const page = q.pagina ?? 1;
  const notTransfer = transfers.length ? sql`(${t.categoryId} IS NULL OR ${notInArray(t.categoryId, transfers)})` : sql`true`;
  const isIncome = sql`(${t.amountCents} > 0 AND (${t.categoryId} IS NULL OR ${expenses.length ? notInArray(t.categoryId, expenses) : sql`true`}))`;
  const [rows, [totals]] = await Promise.all([
    db.select().from(t).where(where).orderBy(q.ordem === "antigas" ? asc(t.date) : desc(t.date), asc(t.id)).limit(PAGE_SIZE).offset((page - 1) * PAGE_SIZE),
    db
      .select({
        count: sql<string>`count(*)`,
        sum: sql<string>`coalesce(sum(${t.amountCents}), 0)`,
        // Same rules as cashFlow(): transfers are out, and money back in an expense category reduces spending.
        income: sql<string>`coalesce(sum(${t.amountCents}) filter (where ${notTransfer} and ${isIncome}), 0)`,
        expense: sql<string>`coalesce(-sum(${t.amountCents}) filter (where ${notTransfer} and not ${isIncome}), 0)`,
      })
      .from(t)
      .where(where),
  ]);
  return { rows: rows.map(toFinTx), total: Number(totals!.count), sumCents: Number(totals!.sum), incomeCents: Number(totals!.income), expenseCents: Number(totals!.expense), page };
}

export function toFinTx(r: typeof s.transactions.$inferSelect): FinTx {
  // Rows stored by an older reader may lack the numbers ("MERCADO02/04"): read them from the bank's text, without writing.
  const parsed = r.installmentNumber ? null : parseInstallment(r.providerDescription ?? r.description);
  return {
    id: r.id,
    accountId: r.accountId,
    categoryId: r.categoryId,
    date: r.date,
    description: r.description,
    merchant: r.merchant,
    amountCents: r.amountCents,
    installmentNumber: r.installmentNumber ?? parsed?.number ?? null,
    installmentTotal: r.installmentTotal ?? parsed?.total ?? null,
    bankStatus: r.bankStatus,
    billRef: r.billRef,
    operationType: r.operationType,
    categorySource: r.categorySource,
    classification: r.classification,
  };
}

/** Only ids that belong to the user survive — guards every filter coming from the client or the LLM. */
export async function ownedIds(
  db: DB,
  userId: string,
  table: "accounts" | "categories",
  ids: string[] | undefined,
): Promise<string[] | undefined> {
  if (!ids?.length) return undefined;
  const t = table === "accounts" ? s.accounts : s.categories;
  const rows = await db.select({ id: t.id }).from(t).where(and(eq(t.userId, userId), inArray(t.id, ids)));
  return rows.map((r) => r.id);
}
