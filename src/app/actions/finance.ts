"use server";
// Manual management of accounts, cards, categories and transactions. Every write is scoped by userId.
import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { getDb } from "@/db/client";
import * as s from "@/db/schema";
import { requireWriter } from "@/lib/auth/session";
import { publicError } from "@/lib/api";
import { removeAccount } from "@/lib/accounts";
import { reauthenticate } from "@/lib/auth/reauth";
import { closingDayFor } from "@/lib/banks";
import { audit } from "@/lib/audit";
import { canAddAccountsManually } from "@/lib/connectors/pluggy";
import { errorSummary } from "@/lib/log";
import { newId } from "@/lib/ids";
import { isValidYmd, todayInSaoPaulo } from "@/lib/dates";
import { parseMoneyToCents } from "@/lib/money";
import { normalizeMerchant, parseInstallment, slugify } from "@/lib/text";
import { ownedIds } from "@/lib/data/repo";
import { runUserAgents } from "@/lib/agents/service";
import { refreshRecurring } from "@/lib/finance/recurring-store";
import { releaseSuperseded } from "@/lib/reconcile";
import { safeTxReturn } from "@/lib/tx-query";
import { fieldErrors, type FormState } from "./auth";

const money = z.string().transform((v, ctx) => {
  const c = parseMoneyToCents(v);
  if (c === null) {
    ctx.addIssue({ code: "custom", message: "Valor inválido. Use, por exemplo, 1.234,56." });
    return z.NEVER;
  }
  return c;
});

const TxInput = z.object({
  accountId: z.string().min(1, "Escolha a conta."),
  categoryId: z.string().optional(),
  date: z.string().refine(isValidYmd, "Data inválida."),
  description: z.string().trim().min(2, "Descreva a transação.").max(200),
  amount: money.refine((c) => c !== 0, "O valor não pode ser zero."),
  direction: z.enum(["expense", "income"]),
  notes: z.string().max(500).optional(),
});

async function assertOwnedRefs(userId: string, accountId: string, categoryId?: string | null) {
  const db = await getDb();
  const acc = await ownedIds(db, userId, "accounts", [accountId]);
  if (!acc?.length) throw new Error("Conta não encontrada.");
  if (categoryId) {
    const cat = await ownedIds(db, userId, "categories", [categoryId]);
    if (!cat?.length) throw new Error("Categoria não encontrada.");
  }
}

export async function createTransactionAction(_: FormState, form: FormData): Promise<FormState> {
  const user = await requireWriter();
  const parsed = TxInput.safeParse(Object.fromEntries(form));
  if (!parsed.success) return { fieldErrors: await fieldErrors(parsed.error) };
  const d = parsed.data;
  try {
    await assertOwnedRefs(user.id, d.accountId, d.categoryId || null);
  } catch (e) {
    return { error: publicError(e, "Conta ou categoria inválida.") };
  }
  const db = await getDb();
  const id = newId();
  const cents = Math.abs(d.amount) * (d.direction === "expense" ? -1 : 1);
  const inst = parseInstallment(d.description);
  await db.insert(s.transactions).values({
    id,
    userId: user.id,
    accountId: d.accountId,
    categoryId: d.categoryId || null,
    date: d.date,
    description: d.description,
    merchant: normalizeMerchant(d.description),
    amountCents: cents,
    installmentNumber: inst?.number ?? null,
    installmentTotal: inst?.total ?? null,
    source: "manual",
    dedupeKey: `manual:${id}`,
    notes: d.notes || null,
  });
  await audit(db, user.id, "transaction.created", { transactionId: id });
  await refreshRecurring(db, user.id, todayInSaoPaulo());
  await runUserAgents(db, user.id, new Date(), ["daily_spend_limit", "possible_duplicate"]);
  revalidatePath("/", "layout");
  return { ok: true, message: "Transação adicionada." };
}

export async function updateTransactionAction(_: FormState, form: FormData): Promise<FormState> {
  const user = await requireWriter();
  const id = String(form.get("id") ?? "");
  const Upd = z.object({ categoryId: z.string().optional(), notes: z.string().max(500).optional(), description: z.string().trim().min(2, "Descreva a transação.").max(200) });
  const parsed = Upd.safeParse(Object.fromEntries(form));
  if (!parsed.success) return { fieldErrors: await fieldErrors(parsed.error) };
  const db = await getDb();
  if (parsed.data.categoryId) {
    const ok = await ownedIds(db, user.id, "categories", [parsed.data.categoryId]);
    if (!ok?.length) return { error: "Categoria não encontrada." };
  }
  const [current] = await db.select({ description: s.transactions.description, categoryId: s.transactions.categoryId }).from(s.transactions).where(and(eq(s.transactions.id, id), eq(s.transactions.userId, user.id)));
  if (!current) return { error: "Transação não encontrada." };
  const renamed = current.description !== parsed.data.description;
  // A new name is a local override: the next bank sync must not bring the old text back.
  await db
    .update(s.transactions)
    // A category the person picks is theirs for good: no classifier or reconciler touches it again.
    .set({ categoryId: parsed.data.categoryId || null, notes: parsed.data.notes || null, description: parsed.data.description, ...(renamed ? { descriptionOverridden: true } : {}), ...((parsed.data.categoryId || null) !== current.categoryId ? { categorySource: "user" as const } : {}) })
    .where(and(eq(s.transactions.id, id), eq(s.transactions.userId, user.id)));
  await audit(db, user.id, "transaction.updated", { transactionId: id });
  revalidatePath("/", "layout");
  return { ok: true, message: "Alterações salvas." };
}

/** From the Revisar list: naming the category is the whole decision, so it is saved as is. */
export async function setCategoryAction(form: FormData): Promise<void> {
  const user = await requireWriter();
  const id = String(form.get("id") ?? "");
  const categoryId = String(form.get("categoryId") ?? "");
  if (!categoryId) return;
  const db = await getDb();
  const ok = await ownedIds(db, user.id, "categories", [categoryId]);
  if (!ok?.length) return;
  await db.update(s.transactions).set({ categoryId, categorySource: "user" }).where(and(eq(s.transactions.id, id), eq(s.transactions.userId, user.id)));
  await audit(db, user.id, "transaction.updated", { transactionId: id });
  revalidatePath("/", "layout");
}

export async function deleteTransactionAction(form: FormData): Promise<void> {
  const user = await requireWriter();
  const id = String(form.get("id") ?? "");
  const db = await getDb();
  await releaseSuperseded(db, user.id, [id]);
  const deleted = await db.delete(s.transactions).where(and(eq(s.transactions.id, id), eq(s.transactions.userId, user.id))).returning({ id: s.transactions.id });
  if (deleted.length) await audit(db, user.id, "transaction.deleted", { transactionId: id });
  revalidatePath("/", "layout");
  redirect(safeTxReturn(form.get("volta")));
}

const MANUAL_OFF = "Contas e cartões entram pela conexão com o banco. Conecte em Integrações.";

const AccountInput = z.object({
  name: z.string().trim().min(2, "Informe o nome.").max(60),
  institution: z.string().trim().min(2, "Informe a instituição.").max(60),
  type: z.enum(["checking", "savings", "credit_card", "cash"]),
  openingBalance: z.string().optional().default("0"),
  limit: z.string().optional(),
  closingDay: z.coerce.number().int().min(1).max(31).optional(),
  dueDay: z.coerce.number().int().min(1).max(31).optional(),
});

export async function saveAccountAction(_: FormState, form: FormData): Promise<FormState> {
  const user = await requireWriter();
  const raw = Object.fromEntries([...form.entries()].filter(([, v]) => v !== ""));
  const parsed = AccountInput.safeParse(raw);
  if (!parsed.success) return { fieldErrors: await fieldErrors(parsed.error) };
  const d = parsed.data;
  const opening = parseMoneyToCents(d.openingBalance || "0");
  if (opening === null) return { fieldErrors: { openingBalance: "Valor inválido." } };
  const db = await getDb();
  const id = String(form.get("id") ?? "");
  if (id) {
    const isCard = d.type === "credit_card";
    const limit = isCard ? parseMoneyToCents(d.limit ?? "") : null;
    if (isCard && (limit === null || limit < 0)) return { fieldErrors: { limit: "Informe o limite do cartão." } };
    if (isCard && (!d.closingDay || !d.dueDay)) return { fieldErrors: { closingDay: "Informe os dias de fechamento e vencimento." } };
    const res = await db
      .update(s.accounts)
      // A card has no opening balance field in the form; keep what is stored.
      .set({ name: d.name, institution: d.institution, ...(isCard ? {} : { openingBalanceCents: opening }) })
      .where(and(eq(s.accounts.id, id), eq(s.accounts.userId, user.id)))
      .returning({ id: s.accounts.id });
    if (!res.length) return { error: "Conta não encontrada." };
    if (isCard) {
      await db
        .update(s.creditCards)
        // Typed by the person: from here on a bank sync never replaces it with an estimate.
        .set({ limitCents: limit!, closingDay: d.closingDay!, closingDaySource: "user", dueDay: d.dueDay! })
        .where(and(eq(s.creditCards.accountId, id), eq(s.creditCards.userId, user.id)));
    }
    await audit(db, user.id, "account.updated", { accountId: id });
  } else {
    if (!canAddAccountsManually(user)) return { error: MANUAL_OFF };
    const newAcc = newId();
    let card: { limitCents: number; closingDay: number; closingDaySource: "user"; dueDay: number } | null = null;
    if (d.type === "credit_card") {
      const limit = parseMoneyToCents(d.limit ?? "");
      if (!limit || limit <= 0) return { fieldErrors: { limit: "Informe o limite do cartão." } };
      if (!d.closingDay || !d.dueDay) return { fieldErrors: { closingDay: "Informe os dias de fechamento e vencimento." } };
      card = { limitCents: limit, closingDay: d.closingDay, closingDaySource: "user" as const, dueDay: d.dueDay };
    }
    await db.transaction(async (tx) => {
      await tx.insert(s.accounts).values({ id: newAcc, userId: user.id, name: d.name, institution: d.institution, type: d.type, openingBalanceCents: d.type === "credit_card" ? 0 : opening });
      if (card) await tx.insert(s.creditCards).values({ id: newId(), userId: user.id, accountId: newAcc, ...card });
    });
    await audit(db, user.id, "account.created", { accountId: newAcc, type: d.type });
  }
  revalidatePath("/", "layout");
  return { ok: true, message: "Conta salva." };
}

/** Irreversible: goes with the account's entries, so it asks for proof again. A connected bank must be disconnected first. */
export async function removeAccountAction(_: FormState, form: FormData): Promise<FormState> {
  const user = await requireWriter();
  if (String(form.get("confirm") ?? "") !== "EXCLUIR") return { fieldErrors: { confirm: "Digite EXCLUIR para confirmar." } };
  const denied = await reauthenticate(user, form);
  if (denied) return { fieldErrors: { password: denied } };
  try {
    await removeAccount(await getDb(), user.id, String(form.get("id") ?? ""), todayInSaoPaulo());
  } catch (e) {
    if (e instanceof Error && /Desconecte|não encontrada/.test(e.message)) return { error: e.message };
    console.error("[accounts] remove", errorSummary(e));
    return { error: "Não foi possível remover a conta. Tente novamente em alguns minutos." };
  }
  revalidatePath("/", "layout");
  redirect("/configuracoes?aba=contas&removida=1");
}

const QuickBank = z.object({
  bank: z.string().trim().min(2).max(40),
  checking: z.boolean(),
  card: z.boolean(),
  balance: z.string().max(20).optional(),
  limit: z.string().max(20).optional(),
  dueDay: z.number().int().min(1).max(31).optional(),
});

/** First-run setup: turns the picked banks into accounts. Safe to resubmit, existing accounts are skipped. */
export async function quickSetupAction(_: FormState, form: FormData): Promise<FormState> {
  const user = await requireWriter();
  if (!canAddAccountsManually(user)) return { error: MANUAL_OFF };
  let raw: unknown;
  try {
    raw = JSON.parse(String(form.get("selection") ?? "[]"));
  } catch {
    return { error: "Seleção inválida." };
  }
  const parsed = z.array(QuickBank).min(1).max(12).safeParse(raw);
  if (!parsed.success) return { error: "Escolha pelo menos um banco." };
  const picks = parsed.data.filter((p) => p.checking || p.card);
  if (!picks.length) return { error: "Marque conta ou cartão em pelo menos um banco." };
  for (const p of picks) {
    if (p.balance && parseMoneyToCents(p.balance) === null) return { error: `Saldo inválido em ${p.bank}.` };
    if (p.limit && parseMoneyToCents(p.limit) === null) return { error: `Limite inválido em ${p.bank}.` };
  }
  const db = await getDb();
  const existing = await db.select({ name: s.accounts.name, type: s.accounts.type }).from(s.accounts).where(eq(s.accounts.userId, user.id));
  const has = (name: string, type: string) => existing.some((a) => a.name === name && a.type === type);
  await db.transaction(async (tx) => {
    for (const p of picks) {
      if (p.checking && !has(p.bank, "checking")) {
        await tx.insert(s.accounts).values({ id: newId(), userId: user.id, name: p.bank, institution: p.bank, type: "checking", openingBalanceCents: parseMoneyToCents(p.balance ?? "") ?? 0 });
      }
      const cardName = `Cartão ${p.bank}`.slice(0, 60);
      if (p.card && !has(cardName, "credit_card")) {
        const accountId = newId();
        const dueDay = p.dueDay ?? 10;
        await tx.insert(s.accounts).values({ id: accountId, userId: user.id, name: cardName, institution: p.bank, type: "credit_card" });
        await tx.insert(s.creditCards).values({ id: newId(), userId: user.id, accountId, limitCents: parseMoneyToCents(p.limit ?? "") ?? 0, closingDay: closingDayFor(dueDay), closingDaySource: "estimated", dueDay });
      }
    }
  });
  await audit(db, user.id, "account.created", { accountId: "onboarding", type: "quick_setup" });
  revalidatePath("/", "layout");
  redirect("/comecar?passo=2");
}

export async function createCategoryAction(_: FormState, form: FormData): Promise<FormState> {
  const user = await requireWriter();
  const parsed = z
    .object({ name: z.string().trim().min(2, "Informe o nome.").max(40), kind: z.enum(["expense", "income", "transfer"]) })
    .safeParse(Object.fromEntries(form));
  if (!parsed.success) return { fieldErrors: await fieldErrors(parsed.error) };
  const db = await getDb();
  const slug = slugify(parsed.data.name);
  const inserted = await db
    .insert(s.categories)
    .values({ id: newId(), userId: user.id, name: parsed.data.name, slug, kind: parsed.data.kind })
    .onConflictDoNothing()
    .returning({ id: s.categories.id });
  if (!inserted.length) return { fieldErrors: { name: "Já existe uma categoria com este nome." } };
  await audit(db, user.id, "category.created", { categoryId: inserted[0]!.id });
  revalidatePath("/", "layout");
  return { ok: true, message: "Categoria criada." };
}
