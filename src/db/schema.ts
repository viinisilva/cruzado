// Drizzle schema. Keep in sync with drizzle/*.sql (migrations are hand-written; see docs/DECISIONS.md).
import {
  pgTable,
  text,
  timestamp,
  bigint,
  integer,
  boolean,
  jsonb,
  date,
  uniqueIndex,
  index,
} from "drizzle-orm/pg-core";
import type { CardCalibration } from "@/lib/finance/cycles";
import type { BillPayment, CategorySource, Classification } from "@/lib/finance/classify";

const money = (name: string) => bigint(name, { mode: "number" });
const ts = (name: string) => timestamp(name, { withTimezone: true, mode: "date" });

export const users = pgTable("users", {
  id: text("id").primaryKey(),
  email: text("email").notNull().unique(),
  name: text("name").notNull(),
  passwordHash: text("password_hash").notNull(),
  isDemo: boolean("is_demo").notNull().default(false),
  aiExternalConsentAt: ts("ai_external_consent_at"),
  totpSecret: text("totp_secret"), // encrypted; only effective once totp_enabled_at is set
  totpEnabledAt: ts("totp_enabled_at"),
  totpLastStep: bigint("totp_last_step", { mode: "number" }), // blocks replaying a code within its window
  createdAt: ts("created_at").notNull().defaultNow(),
});

// Fixed-window counters shared across serverless instances (see src/lib/rate-limit.ts).
export const rateLimits = pgTable(
  "rate_limits",
  {
    key: text("key").primaryKey(),
    count: integer("count").notNull(),
    resetAt: ts("reset_at").notNull(),
  },
  (t) => [index("rate_limits_reset_idx").on(t.resetAt)],
);

export const sessions = pgTable(
  "sessions",
  {
    id: text("id").primaryKey(), // sha256(token) — the raw token only lives in the cookie
    userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    expiresAt: ts("expires_at").notNull(),
    createdAt: ts("created_at").notNull().defaultNow(),
  },
  (t) => [index("sessions_user_idx").on(t.userId)],
);

export const financialConnections = pgTable("financial_connections", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  connector: text("connector").$type<"demo" | "csv" | "ofx" | "open_finance">().notNull(),
  label: text("label").notNull(),
  status: text("status").$type<ConnectionStatus>().notNull().default("active"),
  // Encrypted (AES-256-GCM) connector credentials/tokens, when a real connector exists. Never bank passwords.
  encryptedToken: text("encrypted_token"),
  // SHA-256 of the provider's item id: lets us detect duplicates without decrypting every row.
  externalHash: text("external_hash").unique("financial_connections_external_uq"),
  statusDetail: text("status_detail"),
  consentExpiresAt: ts("consent_expires_at"),
  lastSyncAt: ts("last_sync_at"), // last sync that finished completely; a partial run never moves it
  accessMode: text("access_mode").$type<"personal" | "connect">().notNull().default("personal"),
  leaseUntil: ts("lease_until"),
  syncRequestedAt: ts("sync_requested_at"),
  resyncFrom: date("resync_from", { mode: "string" }),
  syncCursor: jsonb("sync_cursor").$type<SyncCursor>(),
  nextAttemptAt: ts("next_attempt_at"),
  failureCount: integer("failure_count").notNull().default(0),
  lastAttemptAt: ts("last_attempt_at"),
  lastSyncSummary: jsonb("last_sync_summary").$type<{ accounts: number; transactions: number; ignoredAccounts: number }>(),
  createdAt: ts("created_at").notNull().defaultNow(),
});

export type ConnectionStatus = "processing" | "active" | "reauth_required" | "error" | "disconnected";
/** Where an interrupted sync resumes. `after` is the provider's cursor for the account at `index`. */
export type SyncCursor = { runId: string; windowFrom: string | null; index: number; after: string | null; written: number; seen: Record<string, number> };

/** One opening of the bank widget. The token's clientUserId comes back on the item, proving whose attempt it was. */
export const bankConnectAttempts = pgTable("bank_connect_attempts", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  connectionId: text("connection_id").references(() => financialConnections.id, { onDelete: "cascade" }),
  clientUserRef: text("client_user_ref").notNull().unique(),
  expiresAt: ts("expires_at").notNull(),
  consumedAt: ts("consumed_at"),
  createdAt: ts("created_at").notNull().defaultNow(),
});

export const bankWebhookEvents = pgTable("bank_webhook_events", {
  id: text("id").primaryKey(),
  eventId: text("event_id").notNull().unique(),
  event: text("event").notNull(),
  itemHash: text("item_hash"),
  itemEncrypted: text("item_encrypted"),
  clientUserRef: text("client_user_ref"),
  minDate: date("min_date", { mode: "string" }),
  txHashes: jsonb("tx_hashes").$type<string[]>(),
  status: text("status").$type<"received" | "done" | "ignored" | "failed">().notNull().default("received"),
  attempts: integer("attempts").notNull().default(0),
  nextAttemptAt: ts("next_attempt_at").notNull().defaultNow(),
  lastError: text("last_error"),
  receivedAt: ts("received_at").notNull().defaultNow(),
});

export type AccountType = "checking" | "savings" | "credit_card" | "cash";

export const accounts = pgTable(
  "accounts",
  {
    id: text("id").primaryKey(),
    userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    connectionId: text("connection_id").references(() => financialConnections.id, { onDelete: "set null" }),
    externalId: text("external_id"),
    name: text("name").notNull(),
    institution: text("institution").notNull(),
    type: text("type").$type<AccountType>().notNull(),
    openingBalanceCents: money("opening_balance_cents").notNull().default(0),
    bankBalanceCents: money("bank_balance_cents"), // as reported by the bank, never derived
    bankBalanceAt: ts("bank_balance_at"),
    currency: text("currency").notNull().default("BRL"),
    archived: boolean("archived").notNull().default(false),
    createdAt: ts("created_at").notNull().defaultNow(),
  },
  (t) => [index("accounts_user_idx").on(t.userId)],
);

export const creditCards = pgTable("credit_cards", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  accountId: text("account_id").notNull().unique().references(() => accounts.id, { onDelete: "cascade" }),
  limitCents: money("limit_cents").notNull(),
  closingDay: integer("closing_day").notNull(),
  dueDay: integer("due_day").notNull(),
  // Open Finance never sends the closing day: "bank" = read from the bank's bills, "user" = typed, "estimated" = guessed.
  closingDaySource: text("closing_day_source").$type<"bank" | "user" | "estimated">(),
  availableCents: money("available_cents"), // available limit as reported by the bank; null when it never said
  bankDataAt: ts("bank_data_at"),
  billsFetchedAt: ts("bills_fetched_at"),
  // Learned from the bank's bills and entries at the end of each sync: closing-day rule, closing/due gap, divergences.
  calibration: jsonb("calibration").$type<CardCalibration>(),
  // Keys of the "parcelas previstas" the person excluded (finance/cards.ts, projectInstallments). Migration 0011.
  dismissedProjections: jsonb("dismissed_projections").$type<string[]>().notNull().default([]),
  createdAt: ts("created_at").notNull().defaultNow(),
});

/** The card issuer's own bills, as shared through Open Finance. The total here is the bank's, never derived. */
export const cardBills = pgTable(
  "card_bills",
  {
    id: text("id").primaryKey(),
    userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    accountId: text("account_id").notNull().references(() => accounts.id, { onDelete: "cascade" }),
    billRef: text("bill_ref").notNull(), // hash of the provider's bill id; transactions carry the same value
    dueDate: date("due_date", { mode: "string" }).notNull(),
    closingDate: date("closing_date", { mode: "string" }),
    totalCents: money("total_cents").notNull(),
    minimumCents: money("minimum_cents"),
    fetchedAt: ts("fetched_at").notNull().defaultNow(),
    // The bank's payments of this bill (amount, date, mode), as /bills lists them.
    payments: jsonb("payments").$type<BillPayment[]>(),
  },
  (t) => [uniqueIndex("card_bills_account_ref_uq").on(t.accountId, t.billRef), index("card_bills_user_idx").on(t.userId, t.dueDate)],
);

export const categories = pgTable(
  "categories",
  {
    id: text("id").primaryKey(),
    userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    slug: text("slug").notNull(),
    kind: text("kind").$type<"expense" | "income" | "transfer">().notNull(),
    color: text("color").notNull().default("slate"),
    createdAt: ts("created_at").notNull().defaultNow(),
  },
  (t) => [uniqueIndex("categories_user_slug_uq").on(t.userId, t.slug)],
);

export const transactionImports = pgTable("transaction_imports", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  accountId: text("account_id").notNull().references(() => accounts.id, { onDelete: "cascade" }),
  format: text("format").$type<"csv" | "ofx">().notNull(),
  fileName: text("file_name").notNull(),
  fileSha256: text("file_sha256").notNull(),
  rowsTotal: integer("rows_total").notNull(),
  rowsImported: integer("rows_imported").notNull(),
  rowsSkipped: integer("rows_skipped").notNull(),
  createdAt: ts("created_at").notNull().defaultNow(),
});

export type TransactionSource = "demo" | "csv" | "ofx" | "manual" | "open_finance" | "assistant";

export type PaymentMethod = "pix" | "debito" | "credito" | "dinheiro" | "boleto" | "transferencia";

export const transactions = pgTable(
  "transactions",
  {
    id: text("id").primaryKey(),
    userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    accountId: text("account_id").notNull().references(() => accounts.id, { onDelete: "cascade" }),
    categoryId: text("category_id").references(() => categories.id, { onDelete: "set null" }),
    importId: text("import_id").references(() => transactionImports.id, { onDelete: "set null" }),
    date: date("date", { mode: "string" }).notNull(), // YYYY-MM-DD, America/Sao_Paulo calendar date
    description: text("description").notNull(),
    merchant: text("merchant").notNull(), // normalized merchant key
    amountCents: money("amount_cents").notNull(), // negative = expense, positive = income
    installmentNumber: integer("installment_number"),
    installmentTotal: integer("installment_total"),
    source: text("source").$type<TransactionSource>().notNull(),
    dedupeKey: text("dedupe_key").notNull(),
    notes: text("notes"),
    paymentMethod: text("payment_method").$type<PaymentMethod>(),
    channel: text("channel").$type<"whatsapp" | "mcp">(), // how an assistant entry arrived; null for everything else
    supersededBy: text("superseded_by"), // set when reconciled: the bank's row counts, this one is kept for history
    providerDescription: text("provider_description"), // the bank's text, kept apart from what the user renamed it to
    descriptionOverridden: boolean("description_overridden").notNull().default(false),
    bankStatus: text("bank_status").$type<"pending" | "posted">(),
    providerTxHash: text("provider_tx_hash"),
    lastSeenRun: text("last_seen_run"),
    billRef: text("bill_ref"), // hash of the bank's bill id for card entries; decides which bill an entry belongs to
    // Open Finance operation type as the bank sent it (PAGAMENTO, ESTORNO, CASHBACK…): a signal, never the decision.
    operationType: text("operation_type"),
    // Who set the category: "user" is never overwritten by any automatic step. null = stored before this was tracked.
    categorySource: text("category_source").$type<CategorySource>(),
    // Why an automatic step classified this entry, with its evidence and the category it had before.
    classification: jsonb("classification").$type<Classification>(),
    createdAt: ts("created_at").notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("transactions_user_dedupe_uq").on(t.userId, t.dedupeKey),
    index("transactions_user_date_idx").on(t.userId, t.date),
  ],
);

export const recurringTransactions = pgTable(
  "recurring_transactions",
  {
    id: text("id").primaryKey(),
    userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    accountId: text("account_id").references(() => accounts.id, { onDelete: "cascade" }),
    categoryId: text("category_id").references(() => categories.id, { onDelete: "set null" }),
    merchant: text("merchant").notNull(),
    label: text("label").notNull(),
    kind: text("kind").$type<"subscription" | "installment" | "income">().notNull(),
    amountCents: money("amount_cents").notNull(),
    nextDate: date("next_date", { mode: "string" }).notNull(),
    remainingInstallments: integer("remaining_installments"),
    lastTransactionId: text("last_transaction_id"),
    updatedAt: ts("updated_at").notNull().defaultNow(),
  },
  (t) => [uniqueIndex("recurring_user_merchant_uq").on(t.userId, t.merchant, t.kind)],
);

export type AgentKind = "daily_spend_limit" | "weekly_summary" | "possible_duplicate" | "monthly_comparison";

export const agentRules = pgTable(
  "agent_rules",
  {
    id: text("id").primaryKey(),
    userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    kind: text("kind").$type<AgentKind>().notNull(),
    // Validated AgentRule (src/lib/agents/rule.ts). Never SQL, code or cron text.
    rule: jsonb("rule").notNull(),
    status: text("status").$type<"draft" | "active" | "paused">().notNull(),
    origin: text("origin").$type<"manual" | "natural_language" | "default">().notNull(),
    sourceText: text("source_text"),
    lastRunAt: ts("last_run_at"),
    createdAt: ts("created_at").notNull().defaultNow(),
    updatedAt: ts("updated_at").notNull().defaultNow(),
  },
  (t) => [index("agent_rules_user_idx").on(t.userId)],
);

export const agentRuns = pgTable(
  "agent_runs",
  {
    id: text("id").primaryKey(),
    userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    ruleId: text("rule_id").notNull().references(() => agentRules.id, { onDelete: "cascade" }),
    periodKey: text("period_key").notNull(),
    status: text("status").$type<"ok" | "error">().notNull(),
    summary: jsonb("summary"),
    runCount: integer("run_count").notNull().default(1),
    startedAt: ts("started_at").notNull().defaultNow(),
    finishedAt: ts("finished_at"),
  },
  (t) => [uniqueIndex("agent_runs_rule_period_uq").on(t.ruleId, t.periodKey)],
);

export type NotificationLink = { label: string; href: string };

export const notifications = pgTable(
  "notifications",
  {
    id: text("id").primaryKey(),
    userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    ruleId: text("rule_id").references(() => agentRules.id, { onDelete: "set null" }),
    kind: text("kind").$type<AgentKind | "system">().notNull(),
    severity: text("severity").$type<"info" | "attention" | "risk">().notNull(),
    title: text("title").notNull(),
    body: text("body").notNull(),
    links: jsonb("links").$type<NotificationLink[]>().notNull().default([]),
    dedupeKey: text("dedupe_key").notNull(),
    readAt: ts("read_at"),
    createdAt: ts("created_at").notNull().defaultNow(),
  },
  (t) => [uniqueIndex("notifications_user_dedupe_uq").on(t.userId, t.dedupeKey)],
);

export const conversations = pgTable("conversations", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  title: text("title").notNull(),
  createdAt: ts("created_at").notNull().defaultNow(),
});

export const messages = pgTable(
  "messages",
  {
    id: text("id").primaryKey(),
    userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    conversationId: text("conversation_id").notNull().references(() => conversations.id, { onDelete: "cascade" }),
    role: text("role").$type<"user" | "assistant">().notNull(),
    content: text("content").notNull(),
    // Evidence: period, filters, tools used and source links (see src/lib/chat/types.ts)
    evidence: jsonb("evidence"),
    createdAt: ts("created_at").notNull().defaultNow(),
  },
  (t) => [index("messages_conversation_idx").on(t.conversationId, t.createdAt)],
);

export const auditEvents = pgTable(
  "audit_events",
  {
    id: text("id").primaryKey(),
    userId: text("user_id"), // nulled on account deletion (kept anonymized)
    action: text("action").notNull(),
    // Metadata only: ids, counts, flags. Never amounts, descriptions or secrets.
    meta: jsonb("meta").$type<Record<string, string | number | boolean | null>>().notNull().default({}),
    createdAt: ts("created_at").notNull().defaultNow(),
  },
  (t) => [index("audit_user_idx").on(t.userId)],
);

export const mcpTokens = pgTable("mcp_tokens", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  tokenHash: text("token_hash").notNull().unique(),
  prefix: text("prefix").notNull(),
  // read: reports only. capture: can record entries but cannot read any financial data.
  scope: text("scope").$type<"read" | "capture">().notNull().default("read"),
  lastUsedAt: ts("last_used_at"),
  revokedAt: ts("revoked_at"),
  expiresAt: ts("expires_at"),
  createdAt: ts("created_at").notNull().defaultNow(),
});

export const whatsappLinks = pgTable("whatsapp_links", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  waHash: text("wa_hash"), // keyed hash: finds the sender without storing the number in the clear
  waEncrypted: text("wa_encrypted"),
  phoneMasked: text("phone_masked"),
  status: text("status").$type<"pending" | "active" | "disabled">().notNull().default("pending"),
  defaultAccountId: text("default_account_id").references(() => accounts.id, { onDelete: "set null" }),
  mode: text("mode").$type<"auto" | "review">().notNull().default("auto"),
  confirmedAt: ts("confirmed_at"),
  lastActivityAt: ts("last_activity_at"),
  createdAt: ts("created_at").notNull().defaultNow(),
});

export const whatsappLinkCodes = pgTable("whatsapp_link_codes", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  codeHash: text("code_hash").notNull().unique(),
  expiresAt: ts("expires_at").notNull(),
  consumedAt: ts("consumed_at"),
  createdAt: ts("created_at").notNull().defaultNow(),
});

export type InboxStatus = "received" | "awaiting_input" | "recorded" | "ignored" | "failed";

export const whatsappInbox = pgTable("whatsapp_inbox", {
  id: text("id").primaryKey(),
  provider: text("provider").notNull().default("meta"),
  phoneNumberId: text("phone_number_id").notNull(),
  wamid: text("wamid").notNull(),
  senderHash: text("sender_hash").notNull(),
  senderEncrypted: text("sender_encrypted"),
  eventAt: ts("event_at").notNull(),
  receivedAt: ts("received_at").notNull().defaultNow(),
  kind: text("kind").$type<"text" | "button" | "unsupported">().notNull(),
  bodyEncrypted: text("body_encrypted"),
  contextId: text("context_id"),
  status: text("status").$type<InboxStatus>().notNull().default("received"),
  attempts: integer("attempts").notNull().default(0),
  nextAttemptAt: ts("next_attempt_at").notNull().defaultNow(),
  lastError: text("last_error"),
  transactionId: text("transaction_id"),
  linkId: text("link_id"),
});

export const whatsappDrafts = pgTable("whatsapp_drafts", {
  id: text("id").primaryKey(),
  linkId: text("link_id").notNull().references(() => whatsappLinks.id, { onDelete: "cascade" }),
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  status: text("status").$type<"open" | "done" | "cancelled">().notNull().default("open"),
  fields: jsonb("fields").$type<Record<string, unknown>>().notNull(),
  targetTransactionId: text("target_transaction_id"),
  createdAt: ts("created_at").notNull().defaultNow(),
  expiresAt: ts("expires_at").notNull(),
});

export const whatsappOutbox = pgTable("whatsapp_outbox", {
  id: text("id").primaryKey(),
  inboxId: text("inbox_id").notNull().unique(),
  toEncrypted: text("to_encrypted").notNull(),
  payload: jsonb("payload").$type<{ text: string; buttons?: { id: string; title: string }[] }>().notNull(),
  status: text("status").$type<"pending" | "sending" | "sent" | "unknown" | "failed" | "expired">().notNull().default("pending"),
  attempts: integer("attempts").notNull().default(0),
  nextAttemptAt: ts("next_attempt_at").notNull().defaultNow(),
  lockedUntil: ts("locked_until"),
  notAfter: ts("not_after").notNull(),
  providerMessageId: text("provider_message_id"),
  deliveryStatus: text("delivery_status"),
  lastError: text("last_error"),
  transactionId: text("transaction_id"),
  createdAt: ts("created_at").notNull().defaultNow(),
});

export const reconciliationMatches = pgTable("reconciliation_matches", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  entryTxId: text("entry_tx_id").notNull().references(() => transactions.id, { onDelete: "cascade" }),
  bankTxId: text("bank_tx_id").notNull().references(() => transactions.id, { onDelete: "cascade" }),
  status: text("status").$type<"suggested" | "confirmed" | "dismissed">().notNull().default("suggested"),
  snapshot: jsonb("snapshot").$type<Record<string, unknown>>(),
  createdAt: ts("created_at").notNull().defaultNow(),
  decidedAt: ts("decided_at"),
});

export const jobs = pgTable(
  "jobs",
  {
    id: text("id").primaryKey(),
    type: text("type").notNull(),
    payload: jsonb("payload").notNull(),
    dedupeKey: text("dedupe_key").notNull().unique(),
    status: text("status").$type<"queued" | "running" | "done" | "failed">().notNull().default("queued"),
    attempts: integer("attempts").notNull().default(0),
    runAt: ts("run_at").notNull().defaultNow(),
    lockedAt: ts("locked_at"),
    lastError: text("last_error"),
    createdAt: ts("created_at").notNull().defaultNow(),
  },
  (t) => [index("jobs_status_run_idx").on(t.status, t.runAt)],
);

/** Patterns learned per institution from bills the reconciler closed to the cent (docs/AUTOCONCILIACAO.md). */
export const reconciliationRules = pgTable(
  "reconciliation_rules",
  {
    id: text("id").primaryKey(),
    userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    institution: text("institution").notNull(),
    pattern: text("pattern").notNull(),
    change: text("change").notNull(),
    evidence: integer("evidence").notNull().default(0),
    contradictions: integer("contradictions").notNull().default(0),
    updatedAt: ts("updated_at").notNull().defaultNow(),
  },
  (t) => [uniqueIndex("reconciliation_rules_uq").on(t.userId, t.institution, t.pattern, t.change)],
);

/** Every automatic or suggested change, with the value before it: what makes all of it reversible. */
export const reconciliationChanges = pgTable(
  "reconciliation_changes",
  {
    id: text("id").primaryKey(),
    userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    accountId: text("account_id").notNull().references(() => accounts.id, { onDelete: "cascade" }),
    billRef: text("bill_ref"),
    transactionId: text("transaction_id").notNull().references(() => transactions.id, { onDelete: "cascade" }),
    kind: text("kind").$type<"category" | "excluded">().notNull(),
    before: jsonb("before").$type<Record<string, unknown>>().notNull(),
    after: jsonb("after").$type<Record<string, unknown>>().notNull(),
    reason: text("reason").notNull(),
    source: text("source").$type<"evidence" | "reconciler" | "user">().notNull(),
    /** proposed: shown for review, nothing changed yet (first run over existing data). applied. reverted. dismissed. */
    status: text("status").$type<"proposed" | "applied" | "reverted" | "dismissed">().notNull().default("applied"),
    ruleId: text("rule_id"),
    appliedAt: ts("applied_at").notNull().defaultNow(),
    revertedAt: ts("reverted_at"),
  },
  (t) => [index("reconciliation_changes_account_idx").on(t.accountId, t.appliedAt)],
);

/** One row per closed bill checked: no amounts and no descriptions, only how it went. */
export const reconciliationEvents = pgTable(
  "reconciliation_events",
  {
    id: text("id").primaryKey(),
    userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    institution: text("institution").notNull(),
    billMonth: text("bill_month").notNull(),
    // matched | auto-applied | proposed (dry run) | suggested (arithmetic only) | ambiguous | unsolved | resolved (later)
    outcome: text("outcome").$type<"matched" | "auto-applied" | "proposed" | "suggested" | "ambiguous" | "unsolved" | "resolved">().notNull(),
    changeKinds: text("change_kinds").array().notNull().default([]),
    gapBucket: text("gap_bucket").notNull(),
    createdAt: ts("created_at").notNull().defaultNow(),
  },
  (t) => [index("reconciliation_events_user_idx").on(t.userId, t.createdAt)],
);
