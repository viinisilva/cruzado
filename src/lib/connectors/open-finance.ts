// Open Finance through Pluggy: links an authorized item, then mirrors accounts, balances, card limits and
// transactions into our own tables. Read-only by design; see docs/OPEN_FINANCE.md.
import { and, asc, eq, inArray, isNotNull, isNull, lte, or, sql } from "drizzle-orm";
import type { DB } from "@/db/connection";
import * as s from "@/db/schema";
import type { AccountType, SyncCursor } from "@/db/schema";
import { audit } from "../audit";
import { decryptSecret, encryptSecret, sha256Hex } from "../auth/crypto";
import { addDays, isValidYmd, todayInSaoPaulo } from "../dates";
import { closingDayFor } from "../banks";
import { newId } from "../ids";
import { readsLikeCashback } from "../categorizer";
import { categorizerFor } from "../importer";
import { normalizeMerchant, parseInstallment, sanitizeUntrusted } from "../text";
import { refreshRecurring } from "../finance/recurring-store";
import { releaseSuperseded, suggestMatchesSafely } from "../reconcile";
import { runUserAgents } from "../agents/service";
import { PluggyError, isPluggyId, isTransient, type PluggyAccount, type PluggyBill, type PluggyClient, type PluggyTransaction } from "./pluggy";
import { errorSummary } from "../log";
import { loadCards, loadCategories, loadTransactions } from "../data/repo";
import { learnCalibration } from "../finance/calibration";
import { cardStatements } from "../finance/cards";
import { RECONCILE_TOLERANCE_CENTS } from "../finance/solver";
import { classifyCardAccount, logMatched, reconcileCard } from "../card-reconciliation";

// Pending card purchases change or vanish for weeks, so every sync re-reads and reconciles this window.
const RECONCILE_DAYS = 45;
const INSERT_BATCH = 500;
const LEASE_MS = 5 * 60_000;
const DEFAULT_BUDGET_MS = 40_000;
const PROVIDER_BUSY_RETRY_MS = 60_000;
const MAX_FAILURES = 6;
const ATTEMPT_TTL_MS = 2 * 60 * 60_000; // longer than the 30-minute token: some banks confirm minutes later
// Open Finance allows about 30 bill listings a month per person and institution: at most one read a day.
const BILLS_EVERY_MS = 20 * 60 * 60_000;
// Installments further ahead than this are bad data (a 24-installment purchase still fits).
const FUTURE_INSTALLMENT_DAYS = 2 * 366;
// A bill paid from another account shows up there within a few days of the card's payment entry.
const BILL_PAYMENT_MATCH_DAYS = 5;
/** Card operation types that the institution itself classified as paying the bill. */
const BILL_PAYMENT_OPERATIONS = new Set(["PAGAMENTO_FATURA", "PAGAMENTO"]);
// Text a bank uses for money sent or received between accounts. Required on one side before pairing two entries.
const TRANSFER_WORDS = /\b(pix|ted|doc|transf|transferencia|transferência)\b/i;

type Connection = typeof s.financialConnections.$inferSelect;
export type SyncSummary = { accounts: number; transactions: number; status: "active" | "error" | "partial" | "processing" | "busy"; detail?: string };

export const secretContext = (connectionId: string) => `bank-connection|${connectionId}`;

/** Item states the user has to solve at the bank; syncing again cannot fix them. */
const NEEDS_USER: Record<string, string> = {
  LOGIN_ERROR: "O banco recusou o acesso. Refaça a autorização.",
  WAITING_USER_INPUT: "O banco está aguardando sua confirmação.",
  USER_AUTHORIZATION_PENDING: "O banco está aguardando sua autorização.",
  USER_AUTHORIZATION_REVOKED: "Você revogou o compartilhamento no banco.",
  USER_AUTHORIZATION_NOT_GRANTED: "A autorização no banco não foi concedida.",
  USER_AUTHORIZATION_EXPIRED: "A autorização expirou. Refaça a conexão.",
  ACCOUNT_LOCKED: "A conta está bloqueada no banco.",
  ACCOUNT_NEEDS_ACTION: "O banco pede uma ação sua, como aceitar novos termos.",
};
const CONSENT_EXPIRED = "A autorização expirou. Refaça a conexão.";
const NO_DATA = "O banco não devolveu nenhuma conta. Refaça a autorização; os dados anteriores continuam aqui.";

function accountType(a: PluggyAccount): AccountType {
  if (a.type === "CREDIT") return "credit_card";
  return a.subtype === "SAVINGS_ACCOUNT" ? "savings" : "checking";
}

/** Survives reconnection, which gives every account a new provider id. Only a hash of the number is kept. */
export function accountKey(a: PluggyAccount, institution: string): string {
  // The institution matters: two banks can issue the same account number.
  return `of:${sha256Hex(`${institution}|${a.type}|${a.subtype ?? ""}|${a.number ?? a.id}`)}`;
}

export type MappedTx = {
  key: string;
  providerHash: string;
  date: string;
  description: string;
  amountCents: number;
  installmentNumber: number | null;
  installmentTotal: number | null;
  isBillPayment: boolean;
  isOwnTransfer: boolean;
  bankStatus: "pending" | "posted";
  /** Hash of the bank's bill id: which bill a card entry was charged in. */
  billRef: string | null;
  /** The bank's operation type, kept as a signal for the evidence classifier. */
  operationType: string | null;
};

/** Date-only and midnight-UTC values are calendar dates: converting them to Brasília would fall on the day before. */
export function bankDate(raw: string): string | null {
  const calendar = raw.match(/^(\d{4}-\d{2}-\d{2})(?:T00:00:00(?:\.0+)?Z)?$/)?.[1];
  if (calendar) return isValidYmd(calendar) ? calendar : null;
  const parsed = new Date(raw);
  return Number.isNaN(parsed.getTime()) ? null : todayInSaoPaulo(parsed);
}

export const providerHash = (id: string) => sha256Hex(`pluggy-tx|${id}`);
export const billHash = (id: string) => sha256Hex(`pluggy-bill|${id}`);

/**
 * Provider → our conventions (negative = expense). Returns null for entries that are not money movement yet, like
 * scheduled bank payments. Open card purchases stay, or the month would look empty. A card installment the bank already
 * lists with a later date (Open Finance dates the 2nd onwards on the day it posts to its bill) is kept as pending: it
 * counts in the bill it falls in and nowhere else until its date (see `notFuture` in data/repo.ts).
 */
export function mapTransaction(t: PluggyTransaction, account: PluggyAccount, today: string, institution: string): MappedTx | null {
  const isCard = account.type === "CREDIT";
  if (!isCard && t.status === "PENDING") return null;
  const date = bankDate(t.date);
  if (!date) return null;
  const future = date > today;
  const meta = t.creditCardMetadata;
  if (future && !(isCard && (meta?.installmentNumber || parseInstallment(t.description ?? "")) && date <= addDays(today, FUTURE_INSTALLMENT_DAYS))) return null;
  // A foreign amount with no BRL value cannot join the totals; guessing a rate would invent money.
  if ((t.currencyCode ?? "BRL") !== "BRL" && t.amountInAccountCurrency == null) return null;
  const amount = t.amountInAccountCurrency ?? t.amount;
  const cents = Math.round(Math.abs(amount) * 100);
  if (!cents) return null;
  // Cards: positive is a charge. Bank accounts: direction comes from `type`.
  const outflow = isCard ? amount > 0 : t.type ? t.type === "DEBIT" : amount < 0;
  // Anyone can write this text with a Pix; it is stored as sanitized data and never trusted.
  const description = sanitizeUntrusted(t.description ?? "", 200) || "Sem descrição";
  const parsedInstallment = parseInstallment(description);
  return {
    key: `of:${sha256Hex(`${accountKey(account, institution)}|${t.providerId ?? t.id}`)}`,
    providerHash: providerHash(t.id),
    date,
    description,
    amountCents: outflow ? -cents : cents,
    installmentNumber: meta?.installmentNumber ?? parsedInstallment?.number ?? null,
    installmentTotal: meta?.totalInstallments ?? parsedInstallment?.total ?? null,
    // Meu Pluggy has no categories; on Open Finance the institution's own operation type says it is a bill payment.
    // Some banks send cashback with operationType PAGAMENTO; it lowers the bill like a refund and is never a payment.
    isBillPayment: !readsLikeCashback(description) && t.operationType !== "CASHBACK" && (/credit card payment/i.test(t.category ?? "") || (isCard && !outflow && BILL_PAYMENT_OPERATIONS.has(t.operationType ?? ""))),
    isOwnTransfer: /same person transfer/i.test(t.category ?? ""),
    // Not charged before its date, whatever the bank calls it: this is what keeps it out of spending until then.
    bankStatus: t.status === "PENDING" || future ? "pending" : "posted",
    billRef: isCard && meta?.billId ? billHash(meta.billId) : null,
    operationType: t.operationType ? sanitizeUntrusted(t.operationType, 40) : null,
  };
}

const dayOf = (ymd?: string | null) => {
  const day = Number(ymd?.slice(8, 10));
  return day >= 1 && day <= 31 ? day : undefined;
};

async function insertConnection(db: DB, userId: string, itemId: string, label: string, accessMode: Connection["accessMode"], now: Date) {
  const id = newId();
  const [row] = await db
    .insert(s.financialConnections)
    .values({ id, userId, connector: "open_finance", label, accessMode, status: "processing", syncRequestedAt: now, encryptedToken: encryptSecret(itemId, secretContext(id)), externalHash: sha256Hex(itemId) })
    .onConflictDoNothing({ target: s.financialConnections.externalHash })
    .returning();
  if (!row) throw new Error("Este banco já está conectado.");
  await audit(db, userId, "bank.connected", { connectionId: id });
  return row;
}

/** Personal mode: links an item the instance owner authorized. Callers must have checked `canConnectBanks`. */
export async function connectItem(db: DB, client: PluggyClient, userId: string, itemId: string, now: Date = new Date()) {
  if (!isPluggyId(itemId)) throw new Error("Cole o Item ID exatamente como aparece no painel do Pluggy.");
  const item = await client.getItem(itemId);
  const conn = await insertConnection(db, userId, itemId, item.connector?.name ?? "Banco", "personal", now);
  return syncConnection(db, client, conn, now);
}

async function ownConnection(db: DB, userId: string, id: string) {
  const [conn] = await db.select().from(s.financialConnections).where(and(eq(s.financialConnections.id, id), eq(s.financialConnections.userId, userId)));
  return conn;
}

/**
 * Starts one widget session. The opaque ref travels inside the token and returns on the item, which is what later
 * proves the item came from this user: an item id alone, arriving from the browser, proves nothing.
 */
export async function startConnectAttempt(db: DB, client: PluggyClient, userId: string, input: { connectionId?: string; includeSandbox?: boolean }, now: Date = new Date()) {
  const id = newId();
  const clientUserRef = `tostao-${id}`;
  let updateItem: string | undefined;
  if (input.connectionId) {
    const conn = await ownConnection(db, userId, input.connectionId);
    if (!conn?.encryptedToken) throw new Error("Conexão não encontrada.");
    updateItem = decryptSecret(conn.encryptedToken, secretContext(conn.id));
  }
  const connectorIds = updateItem ? undefined : await client.listOpenFinanceConnectorIds(Boolean(input.includeSandbox));
  if (connectorIds && !connectorIds.length) throw new Error("Nenhuma instituição Open Finance disponível neste plano.");
  const accessToken = await client.createConnectToken({ clientUserId: clientUserRef, itemId: updateItem });
  await db.insert(s.bankConnectAttempts).values({ id, userId, connectionId: input.connectionId, clientUserRef, expiresAt: new Date(now.getTime() + ATTEMPT_TTL_MS) });
  return { attemptId: id, accessToken, connectorIds, updateItem };
}

/** One attempt yields one link: the update runs only for whoever wins it, so a replayed callback changes nothing. */
async function consumeAttempt(db: DB, attemptId: string, now: Date) {
  const [attempt] = await db
    .update(s.bankConnectAttempts)
    .set({ consumedAt: now })
    .where(and(eq(s.bankConnectAttempts.id, attemptId), isNull(s.bankConnectAttempts.consumedAt), sql`${s.bankConnectAttempts.expiresAt} > ${now}`))
    .returning();
  return attempt;
}

async function linkFromAttempt(db: DB, client: PluggyClient, attempt: typeof s.bankConnectAttempts.$inferSelect, itemId: string, now: Date) {
  const item = await client.getItem(itemId);
  if (item.clientUserId !== attempt.clientUserRef) {
    await audit(db, attempt.userId, "bank.link_refused", {});
    throw new Error("Esta conexão não pertence à sua autorização.");
  }
  const [existing] = await db.select().from(s.financialConnections).where(eq(s.financialConnections.externalHash, sha256Hex(itemId)));
  // The webhook and the browser both report the same success; whichever comes second finds the link done.
  if (existing) {
    if (existing.userId !== attempt.userId) throw new Error("Este banco já está conectado.");
    return existing;
  }
  if (!(await consumeAttempt(db, attempt.id, now))) throw new Error("Esta autorização já foi usada ou expirou.");
  return insertConnection(db, attempt.userId, itemId, sanitizeUntrusted(item.connector?.name ?? "Banco", 80), "connect", now);
}

/**
 * Widget finished in the browser. The result is re-read from the provider: only an item whose clientUserId is the
 * ref of this user's open attempt is linked.
 */
export async function finishConnectAttempt(db: DB, client: PluggyClient, userId: string, attemptId: string, itemId: string | undefined, now: Date = new Date()) {
  const [attempt] = await db.select().from(s.bankConnectAttempts).where(and(eq(s.bankConnectAttempts.id, attemptId), eq(s.bankConnectAttempts.userId, userId)));
  if (!attempt) throw new Error("Tentativa de conexão não encontrada.");
  if (attempt.connectionId) {
    if (!(await consumeAttempt(db, attemptId, now))) throw new Error("Esta autorização já foi usada ou expirou.");
    await db.update(s.financialConnections).set({ syncRequestedAt: now, nextAttemptAt: null, failureCount: 0 }).where(and(eq(s.financialConnections.id, attempt.connectionId), eq(s.financialConnections.userId, userId)));
    return ownConnection(db, userId, attempt.connectionId);
  }
  if (!itemId || !isPluggyId(itemId)) throw new Error("Identificador de conexão inválido.");
  return linkFromAttempt(db, client, attempt, itemId, now);
}

/** Webhook path, for users who close the page while the bank is still confirming. */
export async function linkFromWebhook(db: DB, client: PluggyClient, clientUserRef: string, itemId: string, now: Date) {
  const [attempt] = await db.select().from(s.bankConnectAttempts).where(eq(s.bankConnectAttempts.clientUserRef, clientUserRef));
  if (!attempt || attempt.connectionId) return null;
  return linkFromAttempt(db, client, attempt, itemId, now);
}

async function takeLease(db: DB, connectionId: string, now: Date) {
  const [row] = await db
    .update(s.financialConnections)
    .set({ leaseUntil: new Date(now.getTime() + LEASE_MS), lastAttemptAt: now })
    .where(and(eq(s.financialConnections.id, connectionId), isNotNull(s.financialConnections.encryptedToken), or(isNull(s.financialConnections.leaseUntil), lte(s.financialConnections.leaseUntil, now))))
    .returning();
  return row;
}

async function afterSync(db: DB, userId: string, now: Date) {
  const today = todayInSaoPaulo(now);
  try {
    await refreshRecurring(db, userId, today);
    await runUserAgents(db, userId, now, ["daily_spend_limit", "possible_duplicate"]);
  } catch (e) {
    console.error("[bank-sync] efeitos", errorSummary(e));
  }
  await suggestMatchesSafely(db, userId, today);
}

/** The saved data stays untouched: a failed call says nothing about the balance or the entries. */
async function recordFailure(db: DB, conn: Connection, e: unknown, now: Date): Promise<SyncSummary> {
  console.error("[bank-sync]", errorSummary(e));
  const failures = conn.failureCount + 1;
  const retry = isTransient(e) && failures < MAX_FAILURES;
  const waitMs = Math.max(((e instanceof PluggyError && e.retryAfter) || 0) * 1000, Math.min(2 ** failures * 60_000, 3_600_000));
  const detail = e instanceof PluggyError && e.status === 429 ? "Muitas consultas ao banco agora. Tentamos de novo em instantes; os dados anteriores continuam aqui." : "Não foi possível atualizar agora. Os dados mostrados são da última atualização concluída.";
  await db
    .update(s.financialConnections)
    .set({ status: "error", statusDetail: detail, failureCount: failures, nextAttemptAt: new Date(now.getTime() + waitMs), syncRequestedAt: retry ? now : null })
    .where(eq(s.financialConnections.id, conn.id));
  return { accounts: 0, transactions: 0, status: "error", detail };
}

async function needsUser(db: DB, conn: Connection, detail: string, consentExpiresAt: Date | null): Promise<SyncSummary> {
  await db.update(s.financialConnections).set({ status: "reauth_required", statusDetail: detail, consentExpiresAt, syncRequestedAt: null, syncCursor: null, nextAttemptAt: null }).where(eq(s.financialConnections.id, conn.id));
  return { accounts: 0, transactions: 0, status: "error", detail };
}

async function ensureAccount(db: DB, conn: Connection, account: PluggyAccount): Promise<string> {
  const externalId = accountKey(account, conn.label);
  const [existing] = await db.select().from(s.accounts).where(and(eq(s.accounts.userId, conn.userId), eq(s.accounts.externalId, externalId)));
  if (existing) {
    await db.update(s.accounts).set({ connectionId: conn.id }).where(eq(s.accounts.id, existing.id));
    return existing.id;
  }
  const id = newId();
  await db.insert(s.accounts).values({ id, userId: conn.userId, connectionId: conn.id, externalId, name: sanitizeUntrusted(account.marketingName ?? account.name, 80), institution: sanitizeUntrusted(conn.label, 80), type: accountType(account) });
  return id;
}

type Tx = Parameters<Parameters<DB["transaction"]>[0]>[0];

/**
 * `fixable`: the automatic fallback categories. A bill payment stored in one of them before the bank's marking was
 * read is moved to the bill payment category on a later sync; anything the user picked stays.
 */
async function upsertPage(tx: Tx, conn: Connection, accountId: string, txs: MappedTx[], runId: string, categoryOf: (t: MappedTx) => string | null, bill: { id: string | null; fixable: string[] }) {
  const t = s.transactions;
  for (let i = 0; i < txs.length; i += INSERT_BATCH) {
    const batch = txs.slice(i, i + INSERT_BATCH);
    // The bank may fill in providerId when a pending purchase posts. Same provider row, so same local row.
    const known = await tx.select({ id: t.id, key: t.dedupeKey, hash: t.providerTxHash }).from(t).where(and(eq(t.userId, conn.userId), inArray(t.providerTxHash, batch.map((m) => m.providerHash))));
    for (const row of known) {
      const fresh = batch.find((m) => m.providerHash === row.hash);
      if (fresh && fresh.key !== row.key) await tx.update(t).set({ dedupeKey: fresh.key }).where(eq(t.id, row.id));
    }
    await tx
      .insert(t)
      .values(
        batch.map((m) => ({
          id: newId(),
          userId: conn.userId,
          accountId,
          categoryId: categoryOf(m),
          date: m.date,
          description: m.description,
          providerDescription: m.description,
          merchant: normalizeMerchant(m.description),
          amountCents: m.amountCents,
          installmentNumber: m.installmentNumber,
          installmentTotal: m.installmentTotal,
          source: "open_finance" as const,
          dedupeKey: m.key,
          bankStatus: m.bankStatus,
          providerTxHash: m.providerHash,
          lastSeenRun: runId,
          billRef: m.billRef,
          operationType: m.operationType,
          // Set by a rule here; the evidence classifier and the person can change it later, the person for good.
          categorySource: "keyword" as const,
        })),
      )
      .onConflictDoUpdate({
        target: [t.userId, t.dedupeKey],
        // Facts come from the bank; what the user wrote (category, notes, a new name) survives every sync.
        set: {
          date: sql`excluded.date`,
          providerDescription: sql`excluded.provider_description`,
          description: sql`CASE WHEN ${t.descriptionOverridden} THEN ${t.description} ELSE excluded.description END`,
          merchant: sql`CASE WHEN ${t.descriptionOverridden} THEN ${t.merchant} ELSE excluded.merchant END`,
          amountCents: sql`excluded.amount_cents`,
          bankStatus: sql`excluded.bank_status`,
          providerTxHash: sql`excluded.provider_tx_hash`,
          lastSeenRun: sql`excluded.last_seen_run`,
          billRef: sql`excluded.bill_ref`,
          operationType: sql`excluded.operation_type`,
          // Bank facts too: a better reader (text.ts, parseInstallment) fills them in for rows stored before it.
          installmentNumber: sql`excluded.installment_number`,
          installmentTotal: sql`excluded.installment_total`,
          ...(bill.id && bill.fixable.length
            ? { categoryId: sql`CASE WHEN excluded.category_id = ${bill.id} AND (${t.categoryId} IS NULL OR ${t.categoryId} IN (${sql.join(bill.fixable.map((id) => sql`${id}`), sql`, `)})) THEN excluded.category_id ELSE ${t.categoryId} END` }
            : {}),
        },
      });
  }
}

/**
 * Entries inside the window that this run never saw: a pending purchase the bank cancelled or re-issued. Rows dated
 * after today are left alone: the API documents no upper bound for a date window, so not seeing a future installment
 * is no proof it is gone. Once its date arrives it is inside the window like any other row.
 */
async function dropVanished(tx: Tx, userId: string, accountId: string, cursor: SyncCursor, today: string) {
  const t = s.transactions;
  const stale = await tx
    .select({ id: t.id })
    .from(t)
    .where(and(eq(t.accountId, accountId), eq(t.source, "open_finance"), sql`${t.date} >= ${cursor.windowFrom}`, sql`${t.date} <= ${today}`, sql`${t.lastSeenRun} IS DISTINCT FROM ${cursor.runId}`));
  const ids = stale.map((r) => r.id);
  for (let i = 0; i < ids.length; i += INSERT_BATCH) {
    const chunk = ids.slice(i, i + INSERT_BATCH);
    await releaseSuperseded(tx, userId, chunk);
    await tx.delete(t).where(inArray(t.id, chunk));
  }
}

/**
 * Reads the bank's bills when the last read is more than a day old. A refusal (product not enabled, quota) is not a
 * sync failure: the card keeps working from its entries, and the next read waits a day like any other.
 */
async function fetchBills(db: DB, client: PluggyClient, accountId: string, account: PluggyAccount, now: Date): Promise<{ bills: PluggyBill[] | null; asked: boolean }> {
  const [card] = await db.select({ fetchedAt: s.creditCards.billsFetchedAt }).from(s.creditCards).where(eq(s.creditCards.accountId, accountId));
  if (card?.fetchedAt && now.getTime() - card.fetchedAt.getTime() < BILLS_EVERY_MS) return { bills: null, asked: false };
  try {
    return { bills: await client.listBills(account.id), asked: true };
  } catch (e) {
    console.error("[bank-sync] faturas", errorSummary(e));
    return { bills: null, asked: true };
  }
}

async function storeBills(tx: Tx, conn: Connection, accountId: string, bills: PluggyBill[], now: Date) {
  for (const b of bills) {
    const dueDate = bankDate(b.dueDate);
    // A bill in another currency or without a usable date cannot be compared with anything here.
    if (!dueDate || (b.totalAmountCurrencyCode ?? "BRL") !== "BRL") continue;
    const values = {
      dueDate,
      closingDate: b.billClosingDate ? bankDate(b.billClosingDate) : null,
      totalCents: Math.round(b.totalAmount * 100),
      minimumCents: b.minimumPaymentAmount == null ? null : Math.round(b.minimumPaymentAmount * 100),
      payments: (b.payments ?? []).flatMap((p) => {
        const date = p.paymentDate ? bankDate(p.paymentDate) : null;
        if (!date || (p.currencyCode ?? "BRL") !== "BRL") return [];
        return [{ amountCents: Math.round(Math.abs(p.amount) * 100), date, mode: p.paymentMode ? sanitizeUntrusted(p.paymentMode, 40) : null, valueType: p.valueType ? sanitizeUntrusted(p.valueType, 40) : null }];
      }),
      fetchedAt: now,
    };
    await tx
      .insert(s.cardBills)
      .values({ id: newId(), userId: conn.userId, accountId, billRef: billHash(b.id), ...values })
      .onConflictDoUpdate({ target: [s.cardBills.accountId, s.cardBills.billRef], set: values });
  }
}

/**
 * Closing day, best source first: the bank's latest bill, the account itself (direct connectors only), what the user
 * typed, and only then an estimate from the due day. An estimate is flagged so the screens can say so.
 */
async function closingDayOf(tx: Tx, accountId: string, account: PluggyAccount, dueDay: number | undefined) {
  const [latest] = await tx
    .select({ closingDate: s.cardBills.closingDate, dueDate: s.cardBills.dueDate })
    .from(s.cardBills)
    .where(and(eq(s.cardBills.accountId, accountId), isNotNull(s.cardBills.closingDate)))
    .orderBy(sql`${s.cardBills.dueDate} DESC`)
    .limit(1);
  const [current] = await tx.select({ day: s.creditCards.closingDay, source: s.creditCards.closingDaySource }).from(s.creditCards).where(eq(s.creditCards.accountId, accountId));
  const due = dueDay ?? dayOf(latest?.dueDate);
  const fromBill = dayOf(latest?.closingDate);
  if (fromBill) return { closingDay: fromBill, closingDaySource: "bank" as const, dueDay: due };
  const fromAccount = dayOf(account.creditData?.balanceCloseDate);
  if (fromAccount) return { closingDay: fromAccount, closingDaySource: "bank" as const, dueDay: due };
  if (current?.source === "user" || current?.source === "bank") return { closingDay: current.day, closingDaySource: current.source, dueDay: due };
  return { closingDay: closingDayFor(due ?? 10), closingDaySource: "estimated" as const, dueDay: due };
}

async function settleAccount(tx: Tx, conn: Connection, accountId: string, account: PluggyAccount, type: AccountType, now: Date, billsAsked = false) {
  // A missing balance is not a zero balance: without one the last known value stays.
  if (account.balance != null) {
    // Balances are derived as opening + sum(transactions); solve for the opening value so the total matches the bank.
    const bankBalance = Math.round(account.balance * 100) * (type === "credit_card" ? -1 : 1);
    // Same rows the balance is derived from (accountBalances up to today): a future installment is not owed yet.
    const [{ total }] = (await tx.select({ total: sql<string>`coalesce(sum(${s.transactions.amountCents}), 0)` }).from(s.transactions).where(and(eq(s.transactions.accountId, accountId), isNull(s.transactions.supersededBy), lte(s.transactions.date, todayInSaoPaulo(now))))) as [{ total: string }];
    await tx.update(s.accounts).set({ openingBalanceCents: bankBalance - Number(total), bankBalanceCents: bankBalance, bankBalanceAt: now }).where(eq(s.accounts.id, accountId));
  }
  if (type !== "credit_card") return;
  const cents = (v: number | null | undefined) => (v == null ? undefined : Math.round(v * 100));
  const limitCents = cents(account.creditData?.creditLimit);
  const availableCents = cents(account.creditData?.availableCreditLimit);
  const days = await closingDayOf(tx, accountId, account, dayOf(account.creditData?.balanceDueDate));
  await tx
    .insert(s.creditCards)
    .values({ id: newId(), userId: conn.userId, accountId, limitCents: limitCents ?? 0, closingDay: days.closingDay, closingDaySource: days.closingDaySource, dueDay: days.dueDay ?? 10, availableCents: availableCents ?? null, bankDataAt: now, billsFetchedAt: billsAsked ? now : null })
    .onConflictDoUpdate({
      target: s.creditCards.accountId,
      set: {
        limitCents: limitCents ?? sql`${s.creditCards.limitCents}`,
        closingDay: days.closingDay,
        closingDaySource: days.closingDaySource,
        ...(days.dueDay ? { dueDay: days.dueDay } : {}),
        // A missing value is unknown, not zero: the last one reported stays.
        ...(availableCents !== undefined ? { availableCents } : {}),
        bankDataAt: now,
        ...(billsAsked ? { billsFetchedAt: now } : {}),
      },
    });
}

/**
 * A bill paid from a bank account shows twice: the card's payment entry and the debit in the account. When the card
 * entry is a bill payment, the account debit with the same amount a few days around it is the same money moving, so
 * it is not spending. Only debits still in the automatic fallback category change; one card payment claims one debit.
 */
export async function tagBillPaymentDebits(db: DB, userId: string, from: string | null) {
  const t = s.transactions;
  const cats = await db.select().from(s.categories).where(eq(s.categories.userId, userId));
  const bill = cats.find((c) => c.slug === "pagamento-fatura")?.id;
  const fallback = cats.filter((c) => c.slug === "outras-despesas").map((c) => c.id);
  if (!bill) return 0;
  const accounts = await db.select({ id: s.accounts.id, type: s.accounts.type }).from(s.accounts).where(eq(s.accounts.userId, userId));
  const cardIds = accounts.filter((a) => a.type === "credit_card").map((a) => a.id);
  const cashIds = accounts.filter((a) => a.type !== "credit_card").map((a) => a.id);
  if (!cardIds.length || !cashIds.length) return 0;
  const since = from ? sql`${t.date} >= ${addDays(from, -BILL_PAYMENT_MATCH_DAYS)}` : sql`true`;
  const payments = await db
    .select({ date: t.date, amountCents: t.amountCents })
    .from(t)
    .where(and(eq(t.userId, userId), inArray(t.accountId, cardIds), eq(t.categoryId, bill), sql`${t.amountCents} > 0`, isNull(t.supersededBy), since))
    .orderBy(asc(t.date));
  if (!payments.length) return 0;
  const debits = await db
    .select({ id: t.id, date: t.date, amountCents: t.amountCents, categoryId: t.categoryId })
    .from(t)
    .where(and(eq(t.userId, userId), inArray(t.accountId, cashIds), sql`${t.amountCents} < 0`, isNull(t.supersededBy), since))
    .orderBy(asc(t.date), asc(t.id));
  const used = new Set<string>();
  const tagged: string[] = [];
  for (const p of payments) {
    const twin = (d: (typeof debits)[number]) => !used.has(d.id) && d.amountCents === -p.amountCents && d.date >= addDays(p.date, -BILL_PAYMENT_MATCH_DAYS) && d.date <= addDays(p.date, BILL_PAYMENT_MATCH_DAYS);
    // Already paired, by hand or by an earlier run: that debit is this payment's, nothing to change.
    const match: (typeof debits)[number] | undefined = debits.find((d) => twin(d) && d.categoryId === bill) ?? debits.find((d) => twin(d) && (d.categoryId === null || fallback.includes(d.categoryId)));
    if (!match) continue;
    used.add(match.id);
    if (match.categoryId !== bill) tagged.push(match.id);
  }
  for (let i = 0; i < tagged.length; i += INSERT_BATCH) {
    await db.update(t).set({ categoryId: bill }).where(and(eq(t.userId, userId), inArray(t.id, tagged.slice(i, i + INSERT_BATCH))));
  }
  return tagged.length;
}

async function runSync(db: DB, client: PluggyClient, conn: Connection, now: Date, deadline: number): Promise<SyncSummary> {
  const itemId = decryptSecret(conn.encryptedToken!, secretContext(conn.id));
  let item;
  try {
    item = await client.getItem(itemId);
  } catch (e) {
    if (e instanceof PluggyError && e.status === 404) return needsUser(db, conn, "Esta conexão não existe mais no provedor. Conecte o banco de novo.", conn.consentExpiresAt);
    throw e;
  }
  const consentExpiresAt = item.consentExpiresAt ? new Date(item.consentExpiresAt) : null;
  const blocked = NEEDS_USER[item.executionStatus ?? ""] ?? NEEDS_USER[item.status] ?? (consentExpiresAt && consentExpiresAt <= now ? CONSENT_EXPIRED : undefined);
  if (blocked) return needsUser(db, conn, blocked, consentExpiresAt);
  if (item.status === "UPDATING" || item.status === "CREATING") {
    await db
      .update(s.financialConnections)
      .set({ ...(conn.lastSyncAt ? {} : { status: "processing" as const }), syncRequestedAt: now, nextAttemptAt: new Date(now.getTime() + PROVIDER_BUSY_RETRY_MS) })
      .where(eq(s.financialConnections.id, conn.id));
    return { accounts: 0, transactions: 0, status: "processing" };
  }
  // Only a clean run may conclude that a missing entry is gone; a partial one simply did not read it.
  const complete = item.status === "UPDATED" && (!item.executionStatus || item.executionStatus === "SUCCESS");

  const today = todayInSaoPaulo(now);
  const lastDay = conn.lastSyncAt ? addDays(todayInSaoPaulo(conn.lastSyncAt), -RECONCILE_DAYS) : null;
  const windowFrom = lastDay && conn.resyncFrom && conn.resyncFrom < lastDay ? conn.resyncFrom : lastDay;
  const cursor: SyncCursor = conn.syncCursor ?? { runId: newId(), windowFrom, index: 0, after: null, written: 0, seen: {} };

  const all = await client.listAccounts(itemId);
  const remote = all.filter((a) => (a.currencyCode ?? "BRL") === "BRL").sort((a, b) => a.id.localeCompare(b.id));
  const ignoredAccounts = all.length - remote.length;
  // Expired or revoked consents answer with empty lists, not errors. Empty must never read as "everything is gone".
  if (!remote.length && conn.lastSyncAt) return needsUser(db, conn, NO_DATA, consentExpiresAt);

  const partial = async (): Promise<SyncSummary> => {
    await db.update(s.financialConnections).set({ syncRequestedAt: now, nextAttemptAt: null }).where(eq(s.financialConnections.id, conn.id));
    return { accounts: remote.length, transactions: cursor.written, status: "partial" };
  };

  for (let i = cursor.index; i < remote.length; i++) {
    const account = remote[i]!;
    const accountId = await ensureAccount(db, conn, account);
    const type = accountType(account);
    const { categorize, cats } = await categorizerFor(db, conn.userId, type);
    const special = { bill: cats.find((c) => c.slug === "pagamento-fatura")?.id ?? null, own: cats.find((c) => c.slug === "transferencias")?.id ?? null };
    // Card credits are decided by evidence (classifyCardAccount), which keeps a record; the silent fix-up is for accounts.
    const fixable = type === "credit_card" ? [] : cats.filter((c) => c.slug === "outras-receitas" || c.slug === "outras-despesas").map((c) => c.id);
    let after = cursor.after;
    let restarted = false;
    for (;;) {
      let page;
      try {
        page = await client.transactionsPage(account.id, { from: cursor.windowFrom ?? undefined, after });
      } catch (e) {
        // A cursor can expire between runs. Starting the account over is safe: every write is an upsert.
        if (after && !restarted && e instanceof PluggyError && e.status === 400) {
          restarted = true;
          after = null;
          continue;
        }
        throw e;
      }
      const txs = page.results.flatMap((t) => mapTransaction(t, account, today, conn.label) ?? []);
      after = page.after;
      cursor.after = after;
      cursor.written += txs.length;
      cursor.seen[accountId] = (cursor.seen[accountId] ?? 0) + page.results.length;
      await db.transaction(async (tx) => {
        await upsertPage(tx, conn, accountId, txs, cursor.runId, (t) => (t.isBillPayment ? special.bill : t.isOwnTransfer ? special.own : categorize(t.description, t.amountCents)), { id: special.bill, fixable });
        await tx.update(s.financialConnections).set({ syncCursor: cursor }).where(eq(s.financialConnections.id, conn.id));
      });
      if (!after) break;
      if (Date.now() > deadline) return partial();
    }
    // Card entries can arrive with an old date (an installment carrying the purchase day), outside the date window.
    // A second, cheap read by creation date catches them even when no webhook told us. Every write is an upsert.
    if (type === "credit_card" && cursor.windowFrom && conn.lastSyncAt) {
      let next: string | null = null;
      do {
        const page = await client.transactionsPage(account.id, { createdFrom: addDays(todayInSaoPaulo(conn.lastSyncAt), -2), after: next });
        const txs = page.results.flatMap((t) => mapTransaction(t, account, today, conn.label) ?? []);
        await db.transaction(async (tx) => upsertPage(tx, conn, accountId, txs, cursor.runId, (t) => (t.isBillPayment ? special.bill : categorize(t.description, t.amountCents)), { id: special.bill, fixable }));
        cursor.written += txs.length;
        next = page.after;
      } while (next && Date.now() <= deadline);
    }
    cursor.index = i + 1;
    const read = type === "credit_card" ? await fetchBills(db, client, accountId, account, now) : { bills: null, asked: false };
    await db.transaction(async (tx) => {
      if (complete && cursor.windowFrom && cursor.seen[accountId]) await dropVanished(tx, conn.userId, accountId, cursor, today);
      if (read.bills) await storeBills(tx, conn, accountId, read.bills, now);
      await settleAccount(tx, conn, accountId, account, type, now, read.asked);
      await tx.update(s.financialConnections).set({ syncCursor: cursor }).where(eq(s.financialConnections.id, conn.id));
    });
    if (Date.now() > deadline && i + 1 < remote.length) return partial();
  }

  // Every card is learned again from everything stored (classification, cycles, reconciliation), before the bank
  // account debits are paired with card payments, so the pairing sees the evidence-based classes.
  const cards = await db.select({ id: s.accounts.id }).from(s.accounts).where(and(eq(s.accounts.connectionId, conn.id), eq(s.accounts.type, "credit_card")));
  for (const { id } of cards) await calibrateCard(db, conn.userId, id, today);

  try {
    await tagBillPaymentDebits(db, conn.userId, cursor.windowFrom);
  } catch (e) {
    console.error("[bank-sync] pagamentos de fatura", errorSummary(e));
  }

  try {
    await tagOwnTransfers(db, conn.userId, cursor.windowFrom);
  } catch (e) {
    console.error("[bank-sync] transferências", errorSummary(e));
  }

  const warning = !complete
    ? "O banco respondeu só em parte. Parte dos dados pode estar desatualizada."
    : ignoredAccounts
      ? `${ignoredAccounts === 1 ? "1 conta em outra moeda não foi importada" : `${ignoredAccounts} contas em outra moeda não foram importadas`}: o Cruzado só soma reais.`
      : null;
  await db
    .update(s.financialConnections)
    .set({
      status: complete ? "active" : "error",
      statusDetail: warning,
      consentExpiresAt,
      syncCursor: null,
      failureCount: 0,
      nextAttemptAt: null,
      ...(complete ? { lastSyncAt: now, lastSyncSummary: { accounts: remote.length, transactions: cursor.written, ignoredAccounts } } : {}),
      // Requests and wider windows that arrived during this run still have to be honored by another one.
      syncRequestedAt: sql`CASE WHEN ${s.financialConnections.syncRequestedAt} > ${now} THEN ${s.financialConnections.syncRequestedAt} END`,
      resyncFrom: sql`CASE WHEN ${s.financialConnections.resyncFrom} < ${cursor.windowFrom ?? "0001-01-01"}::date THEN ${s.financialConnections.resyncFrom} END`,
    })
    .where(eq(s.financialConnections.id, conn.id));
  if (complete) await audit(db, conn.userId, "bank.synced", { connectionId: conn.id, accounts: remote.length, transactions: cursor.written });
  return complete ? { accounts: remote.length, transactions: cursor.written, status: "active" } : { accounts: remote.length, transactions: cursor.written, status: "partial", detail: warning! };
}

/**
 * Money moved between two of the user's own accounts arrives as a debit in one and a credit in the other, and without
 * the provider's category both would count: as spending and as income. A pair is tagged only when it is unambiguous:
 * same amount, at most a day apart, different accounts, both still in the automatic fallback category, transfer wording
 * on at least one side, and no other entry that could be the other half.
 */
export async function tagOwnTransfers(db: DB, userId: string, from: string | null) {
  const t = s.transactions;
  const cats = await db.select().from(s.categories).where(eq(s.categories.userId, userId));
  const own = cats.find((c) => c.slug === "transferencias")?.id;
  const fallback = new Set(cats.filter((c) => c.slug === "outras-despesas" || c.slug === "outras-receitas").map((c) => c.id));
  if (!own) return 0;
  const cash = (await db.select({ id: s.accounts.id, type: s.accounts.type }).from(s.accounts).where(eq(s.accounts.userId, userId))).filter((a) => a.type !== "credit_card").map((a) => a.id);
  if (cash.length < 2) return 0;
  const rows = (
    await db
      .select({ id: t.id, accountId: t.accountId, date: t.date, amountCents: t.amountCents, categoryId: t.categoryId, description: t.description })
      .from(t)
      .where(and(eq(t.userId, userId), inArray(t.accountId, cash), isNull(t.supersededBy), from ? sql`${t.date} >= ${addDays(from, -1)}` : sql`true`))
  ).filter((r) => r.categoryId === null || fallback.has(r.categoryId));
  const near = (a: string, b: string) => a >= addDays(b, -1) && a <= addDays(b, 1);
  const tagged = new Set<string>();
  for (const out of rows.filter((r) => r.amountCents < 0)) {
    const ins = rows.filter((r) => r.amountCents === -out.amountCents && r.accountId !== out.accountId && near(r.date, out.date));
    if (ins.length !== 1) continue;
    const back = ins[0]!;
    // The other side must have only this one candidate too.
    const outs = rows.filter((r) => r.amountCents === out.amountCents && r.accountId !== back.accountId && near(r.date, back.date));
    if (outs.length !== 1 || tagged.has(back.id)) continue;
    if (!TRANSFER_WORDS.test(out.description) && !TRANSFER_WORDS.test(back.description)) continue;
    tagged.add(out.id);
    tagged.add(back.id);
  }
  const ids = [...tagged];
  for (let i = 0; i < ids.length; i += INSERT_BATCH) {
    await db.update(t).set({ categoryId: own }).where(and(eq(t.userId, userId), inArray(t.id, ids.slice(i, i + INSERT_BATCH))));
  }
  return ids.length / 2;
}

/** Read the provider and write page by page, resuming from the saved cursor. One run at a time per connection. */
export async function syncConnection(db: DB, client: PluggyClient, conn: Connection, now: Date = new Date(), opts: { budgetMs?: number } = {}): Promise<SyncSummary> {
  if (!conn.encryptedToken) throw new Error("Conexão sem autorização guardada.");
  const leased = await takeLease(db, conn.id, now);
  if (!leased) return { accounts: 0, transactions: 0, status: "busy" };
  let summary: SyncSummary;
  try {
    summary = await runSync(db, client, leased, now, Date.now() + (opts.budgetMs ?? DEFAULT_BUDGET_MS));
  } catch (e) {
    summary = await recordFailure(db, leased, e, now);
  }
  await db.update(s.financialConnections).set({ leaseUntil: null }).where(eq(s.financialConnections.id, conn.id));
  if (summary.status === "active" && summary.transactions > 0) await afterSync(db, conn.userId, now);
  return summary;
}

/**
 * Cron entry point: oldest first, within a time budget, and only for the configured owner. `staleMs`: only connections
 * not synced for this long, so an endpoint called often cannot spend the Open Finance quota.
 */
export async function syncAllConnections(db: DB, client: PluggyClient, ownerId: string, budgetMs: number, now: Date = new Date(), opts: { staleMs?: number } = {}) {
  const started = Date.now();
  const rows = await db
    .select()
    .from(s.financialConnections)
    .where(
      and(
        eq(s.financialConnections.connector, "open_finance"),
        eq(s.financialConnections.userId, ownerId),
        isNotNull(s.financialConnections.encryptedToken),
        opts.staleMs ? or(isNull(s.financialConnections.lastSyncAt), lte(s.financialConnections.lastSyncAt, new Date(now.getTime() - opts.staleMs))) : undefined,
      ),
    )
    .orderBy(asc(s.financialConnections.lastSyncAt));
  let synced = 0;
  let failed = 0;
  for (const conn of rows) {
    const left = budgetMs - (Date.now() - started);
    if (left <= 0) break;
    const r = await syncConnection(db, client, conn, now, { budgetMs: left });
    if (r.status === "error") failed++;
    else if (r.status !== "busy") synced++;
  }
  return { synced, failed };
}

/** Stops new updates and removes the connection at the provider. The history stays until deleted on its own. */
export async function disconnectBank(db: DB, client: PluggyClient, userId: string, connectionId: string) {
  const conn = await ownConnection(db, userId, connectionId);
  if (!conn) throw new Error("Conexão não encontrada.");
  if (conn.encryptedToken) {
    try {
      await client.deleteItem(decryptSecret(conn.encryptedToken, secretContext(conn.id)));
    } catch (e) {
      // Already gone at the provider is the state we wanted.
      if (!(e instanceof PluggyError && e.status === 404)) throw e;
    }
  }
  await db
    .update(s.financialConnections)
    .set({ status: "disconnected", statusDetail: null, encryptedToken: null, externalHash: null, syncRequestedAt: null, syncCursor: null, nextAttemptAt: null, leaseUntil: null })
    .where(eq(s.financialConnections.id, conn.id));
  await audit(db, userId, "bank.disconnected", { connectionId: conn.id });
}

/** Separate from disconnecting on purpose. Only bank-sourced entries go; anything the user added to the account stays. */
export async function deleteBankHistory(db: DB, userId: string, connectionId: string) {
  const conn = await ownConnection(db, userId, connectionId);
  if (!conn) throw new Error("Conexão não encontrada.");
  if (conn.status !== "disconnected") throw new Error("Desconecte o banco antes de excluir o histórico.");
  await db.transaction(async (tx) => {
    const accounts = await tx.select({ id: s.accounts.id }).from(s.accounts).where(and(eq(s.accounts.userId, userId), eq(s.accounts.connectionId, conn.id)));
    const t = s.transactions;
    for (const { id } of accounts) {
      const rows = await tx.select({ id: t.id }).from(t).where(and(eq(t.accountId, id), eq(t.source, "open_finance")));
      for (let i = 0; i < rows.length; i += INSERT_BATCH) {
        const chunk = rows.slice(i, i + INSERT_BATCH).map((r) => r.id);
        await releaseSuperseded(tx, userId, chunk);
        await tx.delete(t).where(inArray(t.id, chunk));
      }
      const [left] = await tx.select({ id: t.id }).from(t).where(eq(t.accountId, id)).limit(1);
      if (!left) await tx.delete(s.accounts).where(eq(s.accounts.id, id));
    }
    await tx.delete(s.financialConnections).where(eq(s.financialConnections.id, conn.id));
    await audit(tx, userId, "bank.history_deleted", {});
  });
}

/**
 * The whole learning pipeline for one card, at the end of every sync (docs/CALIBRACAO_CARTAO.md and
 * docs/AUTOCONCILIACAO.md): classify credits by evidence → learn cycles and rule → reconcile closed bills against the
 * bank → learn again if the reconciler changed anything. A failure here never fails the sync.
 */
export async function calibrateCard(db: DB, userId: string, accountId: string, today: string) {
  try {
    const [account] = await db.select({ institution: s.accounts.institution }).from(s.accounts).where(and(eq(s.accounts.id, accountId), eq(s.accounts.userId, userId)));
    const institution = account?.institution ?? "?";
    const classified = await classifyCardAccount(db, userId, accountId, institution, today);
    const learn = async () => {
      const [cards, txs, categories] = await Promise.all([loadCards(db, userId), loadTransactions(db, userId, { accountIds: [accountId], includeFuture: true, today }), loadCategories(db, userId)]);
      const card = cards.find((c) => c.accountId === accountId);
      return card ? { card, txs, categories, calibration: learnCalibration(card, txs, categories, today) } : null;
    };
    let learned = await learn();
    if (!learned) return null;
    if (await reconcileCard(db, userId, accountId, institution, learned.calibration, today)) learned = (await learn()) ?? learned;
    const { calibration } = learned;
    const matched = cardStatements({ ...learned.card, calibration }, learned.txs, learned.categories, today, 12)
      .filter((st) => st.bankTotalCents !== null && Math.abs(st.bankTotalCents - st.computedCents) <= RECONCILE_TOLERANCE_CENTS)
      .map((st) => st.dueDate.slice(0, 7));
    await logMatched(db, userId, institution, matched);
    await db.update(s.creditCards).set({ calibration }).where(and(eq(s.creditCards.userId, userId), eq(s.creditCards.accountId, accountId)));
    // Shapes only, never amounts or descriptions: logs leave this database.
    console.log("[bank-sync] calibração", JSON.stringify({ status: calibration.status, rule: calibration.rule, confidence: calibration.ruleConfidence, bills: calibration.evidence.bills, divergences: calibration.divergences.map((d) => d.reason), classified }));
    return calibration;
  } catch (e) {
    console.error("[bank-sync] calibração", errorSummary(e));
    return null;
  }
}
