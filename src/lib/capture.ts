// Recording entries from an external assistant (e.g. WhatsApp through Hermes). Deliberately narrow: it adds or
// undoes entries in the Cruzado ledger and exposes no balance or history. Nothing here touches a bank.
import { and, desc, eq, gt, like } from "drizzle-orm";
import { z } from "zod";
import type { DB } from "@/db/connection";
import * as s from "@/db/schema";
import type { PaymentMethod } from "@/db/schema";
import { audit } from "./audit";
import { runUserAgents } from "./agents/service";
import { sha256Hex } from "./auth/crypto";
import { loadAccounts, loadCategories } from "./data/repo";
import { addDays, isValidYmd, todayInSaoPaulo } from "./dates";
import { refreshRecurring } from "./finance/recurring-store";
import { newId } from "./ids";
import { categorizerFor } from "./importer";
import { formatBRL, parseMoneyToCents } from "./money";
import { normalizeMerchant, parseInstallment, sanitizeUntrusted } from "./text";
import { errorSummary } from "./log";

const MAX_AMOUNT_CENTS = 10_000_000; // R$ 100.000: a typo here would distort every report
const MAX_DAYS_BACK = 90;
const DUPLICATE_WINDOW_MS = 2 * 60_000;
const UNDO_WINDOW_MS = 24 * 60 * 60_000;

export const RecordInput = z
  .object({
    amount: z.string().min(1).max(20).describe('Valor positivo em reais, como "45,50".'),
    direction: z.enum(["expense", "income"]).describe("expense para gasto, income para recebimento."),
    description: z.string().trim().min(2).max(120).describe("O que foi, nas palavras do usuário."),
    accountId: z.string().max(64).optional().describe("Id vindo de list_accounts. Obrigatório se houver mais de uma conta."),
    categoryId: z.string().max(64).optional().describe("Id vindo de list_categories. Sem ele, a categoria é escolhida automaticamente."),
    date: z.string().max(10).optional().describe("AAAA-MM-DD. Sem ele, usa hoje."),
  })
  .strict();
export type RecordInput = z.infer<typeof RecordInput>;

/** Message meant for the person, safe to return to the assistant. */
export class CaptureError extends Error {}

/** Names and ids only: enough to choose where an entry goes, with no balance or number. */
export async function listCaptureOptions(db: DB, userId: string) {
  const [accounts, categories] = await Promise.all([loadAccounts(db, userId), loadCategories(db, userId)]);
  return {
    accounts: accounts.filter((a) => !a.archived).map((a) => ({ id: a.id, name: sanitizeUntrusted(a.name, 60), type: a.type })),
    categories: categories.filter((c) => c.kind !== "transfer").map((c) => ({ id: c.id, name: sanitizeUntrusted(c.name, 40), kind: c.kind })),
  };
}

/** Every entry remembers which token made it, so one integration can never undo another's. */
const channelPrefix = (channel: string) => `assistant:${channel}:`;

/** Rules every channel shares, so WhatsApp and MCP cannot drift apart. */
export function assertEntryLimits(cents: number | null, date: string, today: string) {
  if (cents === null || cents <= 0) throw new CaptureError("Valor inválido. Informe um valor positivo em reais.");
  if (cents > MAX_AMOUNT_CENTS) throw new CaptureError("Valor acima do limite de R$ 100.000,00. Lance pelo site.");
  if (!isValidYmd(date)) throw new CaptureError("Data inválida. Use AAAA-MM-DD.");
  if (date > today) throw new CaptureError("Não registro lançamentos com data futura.");
  if (date < addDays(today, -MAX_DAYS_BACK)) throw new CaptureError(`Data anterior a ${MAX_DAYS_BACK} dias. Lance pelo site.`);
}

export type EntryFields = { accountId: string; categoryId: string | null; date: string; description: string; amountCents: number; paymentMethod?: PaymentMethod; channel: "whatsapp" | "mcp"; dedupeKey: string };

/** Inserts inside the caller's transaction, so the entry commits together with whatever produced it. */
export async function insertEntry(tx: Pick<DB, "insert">, userId: string, e: EntryFields): Promise<string | null> {
  const inst = parseInstallment(e.description);
  const id = newId();
  const inserted = await tx
    .insert(s.transactions)
    .values({
      id,
      userId,
      accountId: e.accountId,
      categoryId: e.categoryId,
      date: e.date,
      description: e.description,
      merchant: normalizeMerchant(e.description),
      amountCents: e.amountCents,
      installmentNumber: inst?.number ?? null,
      installmentTotal: inst?.total ?? null,
      source: "assistant",
      paymentMethod: e.paymentMethod ?? null,
      channel: e.channel,
      dedupeKey: e.dedupeKey,
    })
    .onConflictDoNothing({ target: [s.transactions.userId, s.transactions.dedupeKey] })
    .returning({ id: s.transactions.id });
  if (!inserted.length) return null;
  await audit(tx, userId, "transaction.created", { transactionId: id, via: e.channel });
  return id;
}

/** Derived data only: a failure here must never look like the entry itself failed, or a retry would record it twice. */
export async function afterEntry(db: DB, userId: string, now: Date) {
  try {
    await refreshRecurring(db, userId, todayInSaoPaulo(now));
    await runUserAgents(db, userId, now, ["daily_spend_limit", "possible_duplicate"]);
  } catch (e) {
    console.error("[entry-effects]", errorSummary(e));
  }
}

export async function recordTransaction(db: DB, userId: string, input: RecordInput, now: Date = new Date(), channel = "direto") {
  const cents = parseMoneyToCents(input.amount);
  const today = todayInSaoPaulo(now);
  const date = input.date ?? today;
  assertEntryLimits(cents, date, today);

  const accounts = (await loadAccounts(db, userId)).filter((a) => !a.archived);
  if (!accounts.length) throw new CaptureError("Nenhuma conta cadastrada. Cadastre uma no Cruzado primeiro.");
  // Any id that is not this user's fails here, whatever the assistant sends.
  const account = input.accountId ? accounts.find((a) => a.id === input.accountId) : accounts.length === 1 ? accounts[0] : undefined;
  if (!account) throw new CaptureError(input.accountId ? "Conta não encontrada." : "Em qual conta? Use list_accounts e pergunte ao usuário.");
  const categories = await loadCategories(db, userId);
  if (input.categoryId) {
    // Same rule as the listing: transfers stay out, and the category must match the direction of the money.
    const chosen = categories.find((c) => c.id === input.categoryId);
    if (!chosen || chosen.kind !== input.direction) throw new CaptureError("Categoria não encontrada para este tipo de lançamento.");
  }

  const description = sanitizeUntrusted(input.description, 120);
  if (description.length < 2) throw new CaptureError("Descreva o lançamento.");
  const merchant = normalizeMerchant(description);
  const amountCents = input.direction === "expense" ? -cents! : cents!;
  const { categorize } = await categorizerFor(db, userId, account.type);
  const categoryId = input.categoryId ?? categorize(description, amountCents);

  // MCP clients send no event id; a model repeating a call after a timeout is caught by this short window.
  const bucket = Math.floor(now.getTime() / DUPLICATE_WINDOW_MS);
  const id = await db.transaction((tx) =>
    insertEntry(tx, userId, {
      accountId: account.id,
      categoryId,
      date,
      description,
      amountCents,
      channel: "mcp",
      dedupeKey: `${channelPrefix(channel)}${sha256Hex(`${account.id}|${date}|${amountCents}|${merchant}|${bucket}`)}`,
    }),
  );
  const category = sanitizeUntrusted(categories.find((c) => c.id === categoryId)?.name ?? "Sem categoria", 40);
  const summary = { amount: formatBRL(amountCents), description, account: sanitizeUntrusted(account.name, 60), category, date };
  if (!id) return { recorded: false, duplicate: true, ...summary };
  await afterEntry(db, userId, now);
  return { recorded: true, duplicate: false, ...summary };
}

/** Removes the latest entry this channel made, within a day. Nothing else can be deleted from here. */
export async function undoLastRecorded(db: DB, userId: string, now: Date = new Date(), channel = "direto") {
  const [last] = await db
    .select()
    .from(s.transactions)
    .where(
      and(
        eq(s.transactions.userId, userId),
        eq(s.transactions.source, "assistant"),
        like(s.transactions.dedupeKey, `${channelPrefix(channel)}%`),
        gt(s.transactions.createdAt, new Date(now.getTime() - UNDO_WINDOW_MS)),
      ),
    )
    .orderBy(desc(s.transactions.createdAt))
    .limit(1);
  if (!last) throw new CaptureError("Não há lançamento recente para desfazer.");
  await db.delete(s.transactions).where(and(eq(s.transactions.id, last.id), eq(s.transactions.userId, userId)));
  await audit(db, userId, "transaction.deleted", { transactionId: last.id, via: "assistant" });
  await afterEntry(db, userId, now);
  return { undone: true, amount: formatBRL(last.amountCents), description: last.description, date: last.date };
}
