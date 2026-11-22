// The public demonstration's database (docs/USO_COMPARTILHADO.md, etapa 1): PGlite in memory, created and filled with
// invented data when the function starts, gone when it stops. There is no other database this code could reach: the
// deployment has no credentials at all (instance-env.ts).
import type { DB } from "@/db/connection";
import { createDb } from "@/db/connection";
import { runMigrations } from "@/db/migrate";
import * as s from "@/db/schema";
import { todayInSaoPaulo } from "../dates";
import { normalizeMerchant, parseInstallment } from "../text";
import { newId, withSeededIds } from "../ids";
import { ensureDefaultCategories } from "./seed";
import { generateShowcase, type ShowcaseAccountKey } from "./showcase";
import { createAgentDraft, runUserAgents } from "../agents/service";
import { refreshRecurring } from "../finance/recurring-store";
import { calibrateCard } from "../connectors/open-finance";
import { answer, type ChatReply } from "../chat/engine";
import { MockProvider } from "../ai/mock";
import type { AIProvider } from "../ai/types";
import { loadCategories } from "../data/repo";
import { DEMO_USER, DEMO_USER_CREATED_AT, DEMO_USER_ID } from "./instance-env";

export { DEMO_USER_ID };


/** Fills one user with the showcase: accounts, cards with the bank's bills, entries, agents, alerts and chats. */
export async function seedShowcase(db: DB, userId: string, today: string, now: Date) {
  const sc = generateShowcase(today);
  const cats = await ensureDefaultCategories(db, userId);
  const connectionId = newId();
  await db.insert(s.financialConnections).values({ id: connectionId, userId, connector: "demo", label: "Dados de exemplo", lastSyncAt: now });
  const ids = Object.fromEntries(sc.accounts.map((a) => [a.key, newId()])) as Record<ShowcaseAccountKey, string>;
  await db.insert(s.accounts).values(sc.accounts.map((a) => ({ id: ids[a.key], userId, connectionId, externalId: `vitrine-${a.key}`, name: a.name, institution: a.institution, type: a.type, openingBalanceCents: a.openingBalanceCents })));
  await db.insert(s.creditCards).values(
    sc.cards.map((c) => ({ id: newId(), userId, accountId: ids[c.account], limitCents: c.limitCents, closingDay: c.closingDay, dueDay: c.dueDay, closingDaySource: "bank" as const, bankDataAt: now, billsFetchedAt: now })),
  );
  if (sc.bills.length) {
    await db.insert(s.cardBills).values(sc.bills.map((b) => ({ id: newId(), userId, accountId: ids[b.account], billRef: b.key, dueDate: b.dueDate, closingDate: b.closingDate, totalCents: b.totalCents, minimumCents: b.minimumCents, fetchedAt: now })));
  }
  const rows = sc.transactions.map((t, i) => {
    const inst = parseInstallment(t.description);
    return {
      id: newId(),
      userId,
      accountId: ids[t.account],
      categoryId: cats.get(t.category) ?? null,
      date: t.date,
      description: t.description,
      providerDescription: t.description,
      merchant: normalizeMerchant(t.description),
      amountCents: t.amountCents,
      installmentNumber: inst?.number ?? null,
      installmentTotal: inst?.total ?? null,
      source: "demo" as const,
      dedupeKey: `vitrine:${i}`,
      bankStatus: t.status ?? null,
      billRef: t.billKey ?? null,
      operationType: t.operationType ?? null,
    };
  });
  for (let i = 0; i < rows.length; i += 250) await db.insert(s.transactions).values(rows.slice(i, i + 250));

  for (const c of sc.cards) await calibrateCard(db, userId, ids[c.account], today);

  const base = { timezone: "America/Sao_Paulo" as const, enabled: true };
  await createAgentDraft(db, userId, { ...base, name: "Gastei mais de R$ 250 no dia", kind: "daily_spend_limit", thresholdCents: 25000 }, { origin: "default", status: "active" });
  await createAgentDraft(db, userId, { ...base, name: "Resumo semanal", kind: "weekly_summary" }, { origin: "default", status: "active" });
  await createAgentDraft(db, userId, { ...base, name: "Cobranças duplicadas", kind: "possible_duplicate" }, { origin: "default", status: "active" });
  await createAgentDraft(db, userId, { ...base, name: "Comparação mensal", kind: "monthly_comparison" }, { origin: "default", status: "active" });
  await refreshRecurring(db, userId, today);
  await runUserAgents(db, userId, now);

  const categories = await loadCategories(db, userId);
  const provider = new MockProvider(() => ({ today, categories }));
  for (const questions of sc.conversations) {
    let conversationId: string | undefined;
    for (const q of questions) conversationId = (await answer(db, provider, userId, q, { now, conversationId })).conversationId;
  }
  return { transactions: rows.length, bills: sc.bills.length };
}

/** Creates the in-memory database for the public demonstration. Takes a few seconds; called once per instance. */
export async function bootDemoDatabase(now: Date = new Date(), opts: { snapshot?: Blob } = {}): Promise<{ db: DB; ms: number }> {
  const started = Date.now();
  // Memory only. With the build's dump (snapshot.ts) initdb is skipped and the migrations below find nothing to do.
  const db = createDb({ loadDataDir: opts.snapshot });
  await runMigrations(db);
  await db.insert(s.users).values({ ...DEMO_USER, createdAt: DEMO_USER_CREATED_AT });
  // Same ids in every instance booted on the same day, so links made by one instance open on the others.
  const today = todayInSaoPaulo(now);
  await withSeededIds(`demo:${today}`, () => seedShowcase(db, DEMO_USER_ID, today, now));
  return { db, ms: Date.now() - started };
}

class ReadOnlyReply extends Error {
  constructor(readonly reply: ChatReply) {
    super("demo: rollback");
  }
}

/**
 * A chat answer that leaves no trace: every visitor shares the same database in memory, so one visitor's question must
 * never show up for another. Runs inside a transaction that is always rolled back.
 */
export async function answerReadOnly(db: DB, provider: AIProvider, text: string, now: Date = new Date()): Promise<ChatReply> {
  try {
    await db.transaction(async (tx) => {
      throw new ReadOnlyReply(await answer(tx as unknown as DB, provider, DEMO_USER_ID, text, { now, readOnly: true }));
    });
  } catch (e) {
    if (e instanceof ReadOnlyReply) return e.reply;
    throw e;
  }
  throw new Error("demo: a resposta não foi produzida.");
}
