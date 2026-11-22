// Turns stored messages into entries. One database transaction covers the entry, the message state and the queued
// reply: if anything fails or the process dies, all of it rolls back and the message is simply tried again.
import { and, desc, eq, gt, like, ne, sql } from "drizzle-orm";
import type { DB } from "@/db/connection";
import * as s from "@/db/schema";
import type { InboxStatus, PaymentMethod } from "@/db/schema";
import { audit } from "../audit";
import { decryptSecret, encryptSecret, sha256Hex } from "../auth/crypto";
import { CaptureError, afterEntry, assertEntryLimits, insertEntry } from "../capture";
import { loadAccounts, loadCategories } from "../data/repo";
import { formatDateBR, todayInSaoPaulo } from "../dates";
import { PAYMENT_LABEL } from "../finance/labels";
import { newId } from "../ids";
import { categorizerFor } from "../importer";
import { formatBRL } from "../money";
import { rateLimitShared } from "../rate-limit";
import { sanitizeUntrusted } from "../text";
import { maskPhone } from "./config";
import { CODE_PATTERN } from "./link";
import { amountFrom, matchAccount, parseMessage, type ParsedEntry, type ParserAccount } from "./parser";
import { errorSummary } from "../log";

type Tx = Parameters<Parameters<DB["transaction"]>[0]>[0];
type Row = typeof s.whatsappInbox.$inferSelect;
type Link = typeof s.whatsappLinks.$inferSelect;
type Reply = { text: string; buttons?: { id: string; title: string }[] };
type Outcome = { status: InboxStatus; reply?: Reply; transactionId?: string; userId?: string; linkId?: string };

const MAX_ATTEMPTS = 5;
const WINDOW_MS = 24 * 60 * 60_000;
const DRAFT_TTL_MS = 24 * 60 * 60_000;
const EDIT_WINDOW_MS = 24 * 60 * 60_000;

const HELP = "Para registrar, escreva algo como: gastei 60 no Pix no mercado.";

type Fields = { direction: "expense" | "income"; amountCents?: number; description?: string; paymentMethod?: PaymentMethod; accountId?: string; date: string; needsReview?: boolean };

const appUrl = () => process.env.APP_URL ?? "";
const linkPrefix = (linkId: string) => `wa:${linkId}:`;

function accountFor(f: Fields, hit: ParserAccount | undefined, defaultId: string | null, accounts: ParserAccount[]): string | undefined {
  const card = (a: ParserAccount) => a.type === "credit_card";
  const fits = (a: ParserAccount) => {
    if (f.paymentMethod === "credito") return card(a);
    if (f.paymentMethod === "pix" || f.paymentMethod === "debito" || f.paymentMethod === "transferencia") return !card(a) && a.type !== "cash";
    if (f.paymentMethod === "dinheiro") return a.type === "cash";
    return true;
  };
  if (hit) return fits(hit) ? hit.id : undefined;
  const preferred = accounts.find((a) => a.id === defaultId);
  if (preferred && fits(preferred)) return preferred.id;
  const options = accounts.filter(fits);
  return options.length === 1 ? options[0]!.id : undefined;
}

function nextQuestion(f: Fields, accounts: ParserAccount[]): string | null {
  if (f.amountCents === undefined) return "Qual foi o valor?";
  if (!f.description) return `${f.direction === "income" ? "De onde veio esse dinheiro?" : "Com o que foi esse gasto?"} Guardei ${formatBRL(f.amountCents)}${f.paymentMethod ? ` no ${PAYMENT_LABEL[f.paymentMethod]}` : ""}.`;
  if (!f.accountId) return `Em qual conta? ${accounts.slice(0, 6).map((a) => sanitizeUntrusted(a.name, 40)).join(", ")}.`;
  return null;
}

async function categoryName(tx: Tx, userId: string, id: string | null) {
  return sanitizeUntrusted((await loadCategories(tx as unknown as DB, userId)).find((c) => c.id === id)?.name ?? "Sem categoria", 40);
}

async function describe(tx: Tx, link: Link, f: Fields, accounts: ParserAccount[]) {
  const account = accounts.find((a) => a.id === f.accountId);
  const signed = f.direction === "expense" ? -f.amountCents! : f.amountCents!;
  const { categorize } = await categorizerFor(tx as unknown as DB, link.userId, account?.type ?? "checking");
  const categoryId = categorize(f.description!, signed);
  const parts = [`${formatBRL(f.amountCents!)} em ${f.description}`, await categoryName(tx, link.userId, categoryId), ...(f.paymentMethod ? [PAYMENT_LABEL[f.paymentMethod]] : []), sanitizeUntrusted(account?.name ?? "", 40), formatDateBR(f.date)];
  return { signed, categoryId, summary: parts.join(" · ") };
}

async function commit(tx: Tx, link: Link, row: Row, f: Fields, accounts: ParserAccount[], now: Date): Promise<Outcome> {
  try {
    assertEntryLimits(f.amountCents ?? null, f.date, todayInSaoPaulo(row.eventAt));
  } catch (e) {
    if (e instanceof CaptureError) return { status: "ignored", reply: { text: e.message } };
    throw e;
  }
  // Rechecked at commit: a draft can outlive the account it was written against.
  if (!accounts.some((a) => a.id === f.accountId)) return { status: "ignored", reply: { text: "Essa conta não está mais disponível. Envie o lançamento de novo." } };
  const { signed, categoryId, summary } = await describe(tx, link, f, accounts);
  const dedupeKey = `${linkPrefix(link.id)}${sha256Hex(`${row.provider}|${row.phoneNumberId}|${row.wamid}`)}`;
  const id = await insertEntry(tx, link.userId, { accountId: f.accountId!, categoryId, date: f.date, description: f.description!, amountCents: signed, paymentMethod: f.paymentMethod, channel: "whatsapp", dedupeKey });
  if (!id) return { status: "ignored" };
  return {
    status: "recorded",
    transactionId: id,
    userId: link.userId,
    reply: { text: `Registrei ${summary}.\nVer lançamento: ${appUrl()}/transacoes/${id}`, buttons: [{ id: `fix:${id}`, title: "Corrigir" }, { id: `undo:${id}`, title: "Desfazer" }] },
  };
}

async function openDraft(tx: Tx, link: Link, now: Date) {
  const [draft] = await tx.select().from(s.whatsappDrafts).where(and(eq(s.whatsappDrafts.linkId, link.id), eq(s.whatsappDrafts.status, "open")));
  if (draft && draft.expiresAt <= now) {
    await tx.update(s.whatsappDrafts).set({ status: "cancelled" }).where(eq(s.whatsappDrafts.id, draft.id));
    return null;
  }
  return draft ?? null;
}

async function saveDraft(tx: Tx, link: Link, f: Fields, now: Date, existing?: string, target?: string) {
  if (existing) {
    await tx.update(s.whatsappDrafts).set({ fields: f as unknown as Record<string, unknown> }).where(eq(s.whatsappDrafts.id, existing));
    return existing;
  }
  const id = newId();
  await tx.insert(s.whatsappDrafts).values({ id, linkId: link.id, userId: link.userId, fields: f as unknown as Record<string, unknown>, targetTransactionId: target, expiresAt: new Date(now.getTime() + DRAFT_TTL_MS) });
  return id;
}

const closeDraft = (tx: Tx, id: string, status: "done" | "cancelled") => tx.update(s.whatsappDrafts).set({ status }).where(eq(s.whatsappDrafts.id, id));

async function advance(tx: Tx, link: Link, row: Row, f: Fields, accounts: ParserAccount[], now: Date, draftId?: string): Promise<Outcome> {
  const question = nextQuestion(f, accounts);
  if (question) {
    await saveDraft(tx, link, f, now, draftId);
    return { status: "awaiting_input", reply: { text: question } };
  }
  if (link.mode === "review" || f.needsReview) {
    const id = await saveDraft(tx, link, f, now, draftId);
    const { summary } = await describe(tx, link, f, accounts);
    return { status: "awaiting_input", reply: { text: `Registrar ${summary}?`, buttons: [{ id: `confirm:${id}`, title: "Confirmar" }, { id: `cancel:${id}`, title: "Cancelar" }] } };
  }
  if (draftId) await closeDraft(tx, draftId, "done");
  return commit(tx, link, row, f, accounts, now);
}

/** Only entries this link created, recently, and never one already settled against a bank statement. */
async function ownEntry(tx: Tx, link: Link, id: string, now: Date) {
  const [entry] = await tx.select().from(s.transactions).where(and(eq(s.transactions.id, id), eq(s.transactions.userId, link.userId), like(s.transactions.dedupeKey, `${linkPrefix(link.id)}%`)));
  if (!entry) return { error: "Esse lançamento já não existe ou não veio desta conversa." };
  if (entry.createdAt.getTime() < now.getTime() - EDIT_WINDOW_MS) return { error: "Esse lançamento tem mais de 24 horas. Altere pelo site." };
  const [matched] = await tx.select({ id: s.reconciliationMatches.id }).from(s.reconciliationMatches).where(and(eq(s.reconciliationMatches.entryTxId, id), eq(s.reconciliationMatches.status, "confirmed")));
  if (entry.supersededBy || matched) return { error: "Esse lançamento já foi conciliado com o extrato. Altere pelo site." };
  return { entry };
}

async function undo(tx: Tx, link: Link, id: string, now: Date): Promise<Outcome> {
  const found = await ownEntry(tx, link, id, now);
  if (!found.entry) return { status: "ignored", reply: { text: found.error! } };
  await tx.delete(s.transactions).where(eq(s.transactions.id, id));
  await audit(tx, link.userId, "transaction.deleted", { transactionId: id, via: "whatsapp" });
  return { status: "ignored", userId: link.userId, reply: { text: `Desfeito: ${formatBRL(Math.abs(found.entry.amountCents))} em ${found.entry.description}.` } };
}

async function correct(tx: Tx, link: Link, id: string, cents: number, row: Row, now: Date): Promise<Outcome> {
  const found = await ownEntry(tx, link, id, now);
  if (!found.entry) return { status: "ignored", reply: { text: found.error! } };
  try {
    assertEntryLimits(cents, found.entry.date, todayInSaoPaulo(row.eventAt));
  } catch (e) {
    if (e instanceof CaptureError) return { status: "ignored", reply: { text: e.message } };
    throw e;
  }
  await tx.update(s.transactions).set({ amountCents: found.entry.amountCents < 0 ? -cents : cents }).where(eq(s.transactions.id, id));
  await audit(tx, link.userId, "transaction.updated", { transactionId: id, via: "whatsapp" });
  return { status: "ignored", transactionId: id, userId: link.userId, reply: { text: `Corrigido para ${formatBRL(cents)}: ${found.entry.description}.` } };
}

/** With text only, acting is safe just when there is exactly one candidate; otherwise the button says which. */
async function targetEntry(tx: Tx, link: Link, row: Row, now: Date): Promise<{ id?: string; many?: boolean }> {
  if (row.contextId) {
    const [sent] = await tx.select({ id: s.whatsappOutbox.transactionId }).from(s.whatsappOutbox).where(eq(s.whatsappOutbox.providerMessageId, row.contextId));
    if (sent?.id) return { id: sent.id };
  }
  const recent = await tx
    .select({ id: s.transactions.id })
    .from(s.transactions)
    .where(and(eq(s.transactions.userId, link.userId), like(s.transactions.dedupeKey, `${linkPrefix(link.id)}%`), gt(s.transactions.createdAt, new Date(now.getTime() - EDIT_WINDOW_MS))))
    .orderBy(desc(s.transactions.createdAt))
    .limit(2);
  return recent.length === 1 ? { id: recent[0]!.id } : { many: recent.length > 1 };
}

async function handleButton(tx: Tx, link: Link, row: Row, value: string, accounts: ParserAccount[], now: Date): Promise<Outcome> {
  const [action, id = ""] = value.split(":");
  if (action === "undo") return undo(tx, link, id, now);
  if (action === "fix") {
    const found = await ownEntry(tx, link, id, now);
    if (!found.entry) return { status: "ignored", reply: { text: found.error! } };
    const draft = await openDraft(tx, link, now);
    if (draft) await closeDraft(tx, draft.id, "cancelled");
    await saveDraft(tx, link, { direction: "expense", date: found.entry.date }, now, undefined, id);
    return { status: "awaiting_input", reply: { text: `Qual é o valor correto para ${found.entry.description}?` } };
  }
  const [draft] = await tx.select().from(s.whatsappDrafts).where(and(eq(s.whatsappDrafts.id, id), eq(s.whatsappDrafts.linkId, link.id)));
  if (!draft || draft.status !== "open" || draft.expiresAt <= now) return { status: "ignored", reply: { text: "Esse rascunho já foi encerrado." } };
  if (action === "cancel") {
    await closeDraft(tx, draft.id, "cancelled");
    return { status: "ignored", reply: { text: "Cancelado. Nada foi registrado." } };
  }
  if (action === "confirm") {
    await closeDraft(tx, draft.id, "done");
    return commit(tx, link, row, draft.fields as unknown as Fields, accounts, now);
  }
  return { status: "ignored", reply: { text: HELP } };
}

async function handleText(tx: Tx, link: Link, row: Row, text: string, now: Date): Promise<Outcome> {
  const accounts: ParserAccount[] = (await loadAccounts(tx as unknown as DB, link.userId)).filter((a) => !a.archived);
  if (!accounts.length) return { status: "ignored", reply: { text: "Cadastre uma conta no Cruzado para começar." } };
  if (row.kind === "button") return handleButton(tx, link, row, text, accounts, now);

  const today = todayInSaoPaulo(row.eventAt);
  const p = parseMessage(text, accounts, today);
  const draft = await openDraft(tx, link, now);

  if (draft?.targetTransactionId) {
    if (p.kind === "cancel") {
      await closeDraft(tx, draft.id, "cancelled");
      return { status: "ignored", reply: { text: "Cancelado. O lançamento continua como estava." } };
    }
    const cents = p.kind === "correction" ? p.amountCents : amountFrom(text);
    if (!cents) return { status: "awaiting_input", reply: { text: "Não entendi o valor. Envie só o número, como 65,00." } };
    await closeDraft(tx, draft.id, "done");
    return correct(tx, link, draft.targetTransactionId, cents, row, now);
  }

  if (draft) {
    const f = draft.fields as unknown as Fields;
    if (p.kind === "cancel") {
      await closeDraft(tx, draft.id, "cancelled");
      return { status: "ignored", reply: { text: "Cancelado. Nada foi registrado." } };
    }
    if (p.kind === "confirm" && !nextQuestion(f, accounts)) {
      await closeDraft(tx, draft.id, "done");
      return commit(tx, link, row, f, accounts, now);
    }
    if (p.kind === "correction") {
      if (!p.amountCents) return { status: "awaiting_input", reply: { text: "Não entendi o valor. Envie só o número, como 65,00." } };
      return advance(tx, link, row, { ...f, amountCents: p.amountCents }, accounts, now, draft.id);
    }
    // A complete new entry replaces the unfinished one; anything else is the answer to what was asked.
    const isNewEntry = p.kind === "entry" && p.amountCents !== undefined && Boolean(p.description) && f.amountCents !== undefined && !p.needsReview;
    if (!isNewEntry && !["undo", "question", "future", "transfer", "multiple"].includes(p.kind)) {
      if (f.amountCents === undefined) {
        const cents = amountFrom(text);
        if (!cents) return { status: "awaiting_input", reply: { text: "Qual foi o valor? Envie só o número, como 60,00." } };
        return advance(tx, link, row, { ...f, amountCents: cents }, accounts, now, draft.id);
      }
      if (!f.description) return advance(tx, link, row, { ...f, description: sanitizeUntrusted(text, 120) }, accounts, now, draft.id);
      if (!f.accountId) {
        const hit = matchAccount(text, accounts);
        if (!hit) return { status: "awaiting_input", reply: { text: nextQuestion(f, accounts)! } };
        return advance(tx, link, row, { ...f, accountId: hit.id }, accounts, now, draft.id);
      }
      return { status: "awaiting_input", reply: { text: "Responda Sim para registrar ou Não para cancelar." } };
    }
    if (isNewEntry) await closeDraft(tx, draft.id, "cancelled");
  }

  switch (p.kind) {
    case "entry": {
      const hit = accounts.find((a) => a.id === p.accountId);
      const f: Fields = { direction: p.direction, amountCents: p.amountCents, description: p.description, paymentMethod: p.paymentMethod, date: p.date, needsReview: p.needsReview };
      f.accountId = accountFor(f, hit, link.defaultAccountId, accounts);
      return advance(tx, link, row, f, accounts, now);
    }
    case "undo":
    case "correction": {
      const target = await targetEntry(tx, link, row, now);
      if (target.many) return { status: "ignored", reply: { text: "Há mais de um lançamento recente. Toque no botão da mensagem do lançamento certo." } };
      if (!target.id) return { status: "ignored", reply: { text: "Não encontrei lançamento recente para alterar." } };
      if (p.kind === "undo") return undo(tx, link, target.id, now);
      const cents = (p as { amountCents: number | null }).amountCents;
      if (!cents) return { status: "ignored", reply: { text: "Diga o novo valor, como: corrigir para 65." } };
      return correct(tx, link, target.id, cents, row, now);
    }
    case "question":
      return { status: "ignored", reply: { text: `Por aqui eu só registro lançamentos. Consultas ficam no app: ${appUrl()}/inicio` } };
    case "future":
      return { status: "ignored", reply: { text: "Registro só o que já aconteceu. Quando o gasto acontecer, me avise." } };
    case "transfer":
      return { status: "ignored", reply: { text: "Transferência entre suas contas não é gasto, então não registrei. Ajuste pelo app, se precisar." } };
    case "multiple":
      return { status: "ignored", reply: { text: "Envie um lançamento por mensagem, por favor. Nada foi registrado." } };
    default:
      return { status: "ignored", reply: { text: `Não entendi. ${HELP}` } };
  }
}

async function handleLinkCode(tx: Tx, row: Row, code: string, waId: string, now: Date): Promise<Outcome> {
  if (!(await rateLimitShared(tx as unknown as DB, "whatsappCode", row.senderHash, now)).ok) return { status: "ignored" };
  const consumed = await tx
    .update(s.whatsappLinkCodes)
    .set({ consumedAt: now })
    .where(and(eq(s.whatsappLinkCodes.codeHash, sha256Hex(code)), sql`${s.whatsappLinkCodes.consumedAt} IS NULL`, gt(s.whatsappLinkCodes.expiresAt, now)))
    .returning({ userId: s.whatsappLinkCodes.userId });
  const userId = consumed[0]?.userId;
  if (!userId) return { status: "ignored", reply: { text: "Código inválido ou expirado. Gere outro em Configurações › WhatsApp." } };
  const [taken] = await tx.select().from(s.whatsappLinks).where(eq(s.whatsappLinks.waHash, row.senderHash));
  if (taken && taken.userId !== userId) return { status: "ignored", reply: { text: "Este número já está ligado a outra conta. Desconecte-o lá primeiro." } };
  if (taken) await tx.delete(s.whatsappLinks).where(eq(s.whatsappLinks.id, taken.id));
  await tx.update(s.whatsappLinks).set({ status: "disabled", waHash: null, waEncrypted: null }).where(and(eq(s.whatsappLinks.userId, userId), ne(s.whatsappLinks.status, "disabled")));
  const id = newId();
  await tx.insert(s.whatsappLinks).values({ id, userId, waHash: row.senderHash, waEncrypted: encryptSecret(waId, `wa-link|${id}`), phoneMasked: maskPhone(waId), status: "pending", lastActivityAt: now });
  return { status: "ignored", reply: { text: "Número recebido. Agora confirme no app, em Configurações › WhatsApp." } };
}

async function handle(tx: Tx, row: Row, now: Date): Promise<Outcome> {
  const waId = decryptSecret(row.senderEncrypted!, `wa-sender|${row.wamid}`);
  const text = row.bodyEncrypted ? decryptSecret(row.bodyEncrypted, `wa-body|${row.wamid}`) : "";
  const code = row.kind === "text" ? text.toUpperCase().match(CODE_PATTERN)?.[0] : undefined;
  if (code) return handleLinkCode(tx, row, code, waId, now);

  // Re-read here, inside the transaction: disconnecting takes effect even for messages already queued.
  const [link] = await tx.select().from(s.whatsappLinks).where(eq(s.whatsappLinks.waHash, row.senderHash));
  if (!link || link.status === "disabled") {
    const allowed = (await rateLimitShared(tx as unknown as DB, "whatsappReply", row.senderHash, now)).ok;
    return { status: "ignored", reply: allowed ? { text: "Este número não está ligado a uma conta. Gere um código em Configurações › WhatsApp, no app do Cruzado." } : undefined };
  }
  if (link.status === "pending") return { status: "ignored", linkId: link.id, reply: { text: "Falta confirmar este número no app, em Configurações › WhatsApp." } };
  await tx.update(s.whatsappLinks).set({ lastActivityAt: now }).where(eq(s.whatsappLinks.id, link.id));
  if (row.kind === "unsupported") return { status: "ignored", linkId: link.id, reply: { text: "Por enquanto só entendo mensagens de texto. Não li esse arquivo. Digite o lançamento, por favor." } };
  return { linkId: link.id, ...(await handleText(tx, link, row, text, now)) };
}

async function enqueueReply(tx: Tx, row: Row, reply: Reply, transactionId?: string) {
  await tx
    .insert(s.whatsappOutbox)
    .values({
      id: newId(),
      inboxId: row.id,
      // Re-encrypted because the inbox copy is erased as soon as the message is settled.
      toEncrypted: encryptSecret(decryptSecret(row.senderEncrypted!, `wa-sender|${row.wamid}`), `wa-to|${row.id}`),
      payload: reply,
      nextAttemptAt: row.eventAt,
      notAfter: new Date(row.eventAt.getTime() + WINDOW_MS),
      transactionId,
    })
    .onConflictDoNothing({ target: s.whatsappOutbox.inboxId });
}

/** Handles the oldest pending message. Messages from one sender run strictly in order, one at a time. */
export async function processNext(db: DB, now: Date = new Date()): Promise<boolean> {
  let claimedId: string | undefined;
  try {
    const result = await db.transaction(async (tx) => {
      const { rows } = await tx.execute(sql`
        SELECT i.id, i.sender_hash FROM whatsapp_inbox i
        WHERE i.status = 'received' AND i.next_attempt_at <= ${now}
          AND NOT EXISTS (SELECT 1 FROM whatsapp_inbox e WHERE e.sender_hash = i.sender_hash AND e.status = 'received' AND (e.event_at, e.id) < (i.event_at, i.id))
        ORDER BY i.event_at, i.id LIMIT 1 FOR UPDATE OF i SKIP LOCKED`);
      const picked = rows[0] as { id: string; sender_hash: string } | undefined;
      if (!picked) return null;
      claimedId = picked.id;
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${picked.sender_hash}))`);
      const [row] = await tx.select().from(s.whatsappInbox).where(eq(s.whatsappInbox.id, picked.id));
      const outcome = await handle(tx, row!, now);
      if (outcome.reply) await enqueueReply(tx, row!, outcome.reply, outcome.transactionId);
      await tx
        .update(s.whatsappInbox)
        // The text and number leave as soon as the message is settled; only the event id stays, to stop redelivery.
        .set({ status: outcome.status, transactionId: outcome.transactionId, linkId: outcome.linkId, bodyEncrypted: null, senderEncrypted: null, lastError: null })
        .where(eq(s.whatsappInbox.id, picked.id));
      return outcome;
    });
    if (!result) return false;
    if (result.userId) await afterEntry(db, result.userId, now);
    return true;
  } catch (e) {
    console.error("[whatsapp]", errorSummary(e));
    if (!claimedId) throw e;
    await registerFailure(db, claimedId, now, e);
    return true;
  }
}

async function registerFailure(db: DB, id: string, now: Date, e: unknown) {
  await db.transaction(async (tx) => {
    const [row] = await tx.select().from(s.whatsappInbox).where(eq(s.whatsappInbox.id, id));
    if (!row) return;
    const attempts = row.attempts + 1;
    const message = errorSummary(e);
    if (attempts >= MAX_ATTEMPTS) {
      await enqueueReply(tx, row, { text: "Não consegui processar sua mensagem. Nada foi registrado; tente de novo em alguns minutos." });
      await tx.update(s.whatsappInbox).set({ status: "failed", attempts, lastError: message, bodyEncrypted: null, senderEncrypted: null }).where(eq(s.whatsappInbox.id, id));
    } else {
      await tx.update(s.whatsappInbox).set({ attempts, lastError: message, nextAttemptAt: new Date(now.getTime() + 2 ** attempts * 1000) }).where(eq(s.whatsappInbox.id, id));
    }
  });
}
