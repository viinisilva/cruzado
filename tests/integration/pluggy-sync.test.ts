// Durable sync against a contract fake of the Pluggy API (shapes from docs.pluggy.ai). This is not the real provider
// nor its sandbox: it proves our behavior for documented responses, including the unhappy ones.
import { and, eq } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";
import * as s from "@/db/schema";
import { loadAccounts, loadTransactions } from "@/lib/data/repo";
import { accountBalances, cashFlow } from "@/lib/finance/core";
import { PluggyClient, PluggyError, canConnectBanks } from "@/lib/connectors/pluggy";
import { connectItem, deleteBankHistory, disconnectBank, finishConnectAttempt, startConnectAttempt, syncConnection } from "@/lib/connectors/open-finance";
import { processBankWork, storeBankEvent } from "@/lib/connectors/bank-work";
import { confirmMatch, listMatches, suggestMatches } from "@/lib/reconcile";
import { createUser } from "@/lib/auth/users";
import { POST } from "@/app/api/webhooks/pluggy/route";
import { testDb } from "../support/db";

process.env.APP_ENCRYPTION_KEY = Buffer.alloc(32, 7).toString("base64");

const ITEM = "11111111-1111-4111-8111-111111111111";
const ITEM2 = "66666666-6666-4666-8666-666666666666";
const CHECKING = "22222222-2222-4222-8222-222222222222";
const CARD = "33333333-3333-4333-8333-333333333333";
const NOW = new Date("2026-10-30T15:00:00Z");
const LATER = new Date("2026-10-31T15:00:00Z");
const TODAY = "2026-10-30";

type Tx = Record<string, unknown>;
type Fail = { path: RegExp; status: number; headers?: Record<string, string>; times?: number };
type State = {
  item: Record<string, unknown>;
  items: Record<string, Record<string, unknown>>;
  accounts: Record<string, unknown>[];
  txs: Record<string, Tx[]>;
  pageSize: number;
  fail?: Fail;
  throwOn?: RegExp;
  calls: string[];
  tokens: unknown[];
};

const fresh = (): State => ({
  item: { id: ITEM, status: "UPDATED", executionStatus: "SUCCESS", connector: { name: "Banco Teste" } },
  items: {},
  accounts: [
    { id: CHECKING, type: "BANK", subtype: "CHECKING_ACCOUNT", number: "123", name: "Conta", balance: 1000, currencyCode: "BRL" },
    { id: CARD, type: "CREDIT", subtype: "CREDIT_CARD", number: "4444", name: "Cartão", balance: 100, currencyCode: "BRL", creditData: { creditLimit: 5000 } },
  ],
  txs: { [CHECKING]: [], [CARD]: [] },
  pageSize: 2,
  calls: [],
  tokens: [],
});

function fake(state: State): typeof fetch {
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    const key = `${init?.method ?? "GET"} ${url.pathname}${url.search}`;
    state.calls.push(key);
    const json = (body: unknown, status = 200, headers?: Record<string, string>) => new Response(JSON.stringify(body), { status, headers });
    if (url.pathname === "/auth") return json({ apiKey: "key" });
    if (state.throwOn?.test(key)) throw new DOMException("timeout", "TimeoutError");
    if (state.fail?.path.test(key)) {
      const f = state.fail;
      if (f.times !== undefined && --f.times <= 0) state.fail = undefined;
      return json({ code: f.status }, f.status, f.headers);
    }
    if (url.pathname === "/connect_token") {
      state.tokens.push(JSON.parse(String(init?.body)));
      return json({ accessToken: "connect-token" });
    }
    if (url.pathname === "/connectors") return json({ results: [{ id: 601, name: "Banco OF", isOpenFinance: true }, { id: 3, name: "Direto", isOpenFinance: false }] });
    if (url.pathname.startsWith("/items/")) {
      const id = url.pathname.split("/")[2]!;
      if (init?.method === "DELETE" || init?.method === "PATCH") return json({});
      return json(state.items[id] ?? state.item);
    }
    if (url.pathname === "/accounts") return json({ results: state.accounts });
    if (url.pathname === "/v2/transactions") {
      const all = state.txs[url.searchParams.get("accountId")!] ?? [];
      const from = url.searchParams.get("dateFrom");
      const rows = from ? all.filter((t) => String(t.date) >= from) : all;
      const start = Number(url.searchParams.get("after")?.replace("c", "") ?? 0);
      const end = start + state.pageSize;
      return json({ results: rows.slice(start, end), next: end < rows.length ? `?accountId=x&after=c${end}` : null });
    }
    return json({}, 404);
  }) as typeof fetch;
}

const tx = (id: string, day: number, amount: number, extra: Tx = {}): Tx => ({ id, date: `2026-10-${String(day).padStart(2, "0")}T12:00:00.000Z`, description: `Compra ${id}`, amount, type: amount < 0 ? "DEBIT" : "CREDIT", status: "POSTED", ...extra });

let db: Awaited<ReturnType<typeof testDb>>;
let userId: string;
let other: string;
let state: State;
let client: PluggyClient;

beforeEach(async () => {
  db = await testDb();
  userId = await createUser(db, { name: "Dono", email: "dono@exemplo.test", password: "senha-de-teste-123" });
  other = await createUser(db, { name: "Outra", email: "outra@exemplo.test", password: "senha-de-teste-123" });
  state = fresh();
  client = new PluggyClient({ clientId: "id", clientSecret: "secret" }, fake(state));
});

const conn = async () => (await db.select().from(s.financialConnections).where(eq(s.financialConnections.userId, userId)))[0]!;
const txs = () => loadTransactions(db, userId);
const account = async (type: string) => (await loadAccounts(db, userId)).find((a) => a.type === type)!;
const balance = async (type: string) => accountBalances(await loadAccounts(db, userId), await txs(), TODAY).find((b) => b.type === type)!.balanceCents;

describe("pagination and resume", () => {
  it("reads every page, using only the cursor", async () => {
    state.txs[CHECKING] = [1, 2, 3, 4, 5].map((n) => tx(`t${n}`, n, -10));
    await connectItem(db, client, userId, ITEM, NOW);
    expect(await txs()).toHaveLength(5);
    expect(state.calls.filter((c) => c.includes("after=c"))).toHaveLength(2);
  });

  it("a next value without a cursor stops as a failure, never as a shorter history", async () => {
    const broken = (async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input).includes("/v2/transactions")) return new Response(JSON.stringify({ results: [tx("a", 1, -1)], next: "?accountId=x" }));
      return fake(state)(input, init);
    }) as typeof fetch;
    const r = await connectItem(db, new PluggyClient({ clientId: "i", clientSecret: "s" }, broken), userId, ITEM, NOW);
    expect(r.status).toBe("error");
    expect((await conn()).lastSyncAt).toBeNull();
  });

  it("an interrupted run keeps its progress, is not marked complete, and resumes where it stopped", async () => {
    state.txs[CHECKING] = [1, 2, 3, 4, 5].map((n) => tx(`t${n}`, n, -10));
    state.fail = { path: /after=c4/, status: 503, times: 1 };
    const first = await connectItem(db, client, userId, ITEM, NOW);
    expect(first.status).toBe("error");
    let c = await conn();
    expect(c.lastSyncAt).toBeNull();
    expect(c.syncCursor).toMatchObject({ after: "c4" });
    expect(c.nextAttemptAt!.getTime()).toBeGreaterThan(NOW.getTime());
    expect(await txs()).toHaveLength(4);
    state.calls = [];
    expect((await syncConnection(db, client, c, LATER)).status).toBe("active");
    expect(state.calls.some((x) => x.includes("after=c0") || (x.includes("/v2/transactions") && x.includes(CHECKING) && !x.includes("after=")))).toBe(false);
    c = await conn();
    expect(c).toMatchObject({ syncCursor: null, status: "active", failureCount: 0 });
    expect(c.lastSyncAt).toEqual(LATER);
    expect(await txs()).toHaveLength(5);
  });

  it("an expired cursor restarts the account without duplicating", async () => {
    state.txs[CHECKING] = [1, 2, 3].map((n) => tx(`t${n}`, n, -10));
    state.fail = { path: /after=c2/, status: 500, times: 1 };
    await connectItem(db, client, userId, ITEM, NOW);
    state.fail = { path: /after=c2/, status: 400, times: 1 };
    expect((await syncConnection(db, client, await conn(), LATER)).status).toBe("active");
    expect(await txs()).toHaveLength(3);
  });

  it("the time budget ends a run as partial, and the queue finishes it", async () => {
    state.txs[CHECKING] = [1, 2, 3, 4, 5].map((n) => tx(`t${n}`, n, -10));
    state.item.status = "UPDATED";
    await connectItem(db, client, userId, ITEM2, NOW).catch(() => null);
    const c = await conn();
    await db.update(s.financialConnections).set({ lastSyncAt: null, syncCursor: null }).where(eq(s.financialConnections.id, c.id));
    const r = await syncConnection(db, client, await conn(), LATER, { budgetMs: -1 });
    expect(r.status).toBe("partial");
    expect((await conn()).lastSyncAt).toBeNull();
    await processBankWork(db, client, { now: () => LATER });
    expect((await conn()).lastSyncAt).toEqual(LATER);
  });
});

describe("failures keep what is there", () => {
  beforeEach(async () => {
    state.txs[CHECKING] = [tx("t1", 10, 1000), tx("t2", 20, -100)];
    await connectItem(db, client, userId, ITEM, NOW);
  });

  it("a timeout leaves balance and entries alone", async () => {
    const before = await balance("checking");
    state.throwOn = /accounts/;
    const r = await syncConnection(db, client, await conn(), LATER);
    expect(r.status).toBe("error");
    expect(await balance("checking")).toBe(before);
    expect(await txs()).toHaveLength(2);
    expect((await conn()).lastSyncAt).toEqual(NOW);
    expect((await conn()).statusDetail).toMatch(/última atualização/);
  });

  it("a 429 waits what the provider asked", async () => {
    state.fail = { path: /accounts/, status: 429, headers: { "ratelimit-reset": "600" }, times: 1 };
    await syncConnection(db, client, await conn(), LATER);
    const c = await conn();
    expect(c.statusDetail).toMatch(/Muitas consultas/);
    expect(c.nextAttemptAt!.getTime()).toBe(LATER.getTime() + 600_000);
    await processBankWork(db, client, { now: () => LATER });
    expect((await conn()).status).toBe("error");
    await processBankWork(db, client, { now: () => new Date(LATER.getTime() + 601_000) });
    expect((await conn()).status).toBe("active");
  });

  it("revoked consent answering with empty lists never empties the account", async () => {
    state.accounts = [];
    state.txs = {};
    const before = await balance("checking");
    await syncConnection(db, client, await conn(), LATER);
    expect((await conn()).status).toBe("reauth_required");
    expect(await txs()).toHaveLength(2);
    expect(await balance("checking")).toBe(before);
  });

  it("an expired consent date asks for reauthorization", async () => {
    state.item.consentExpiresAt = "2026-10-01T00:00:00.000Z";
    await syncConnection(db, client, await conn(), LATER);
    expect(await conn()).toMatchObject({ status: "reauth_required" });
  });

  it("a null balance is unknown, not zero", async () => {
    const before = await balance("checking");
    (state.accounts[0] as { balance: unknown }).balance = null;
    await syncConnection(db, client, await conn(), LATER);
    expect(await balance("checking")).toBe(before);
  });

  it("a partial provider run does not delete what it did not read, nor move the last sync", async () => {
    state.item.executionStatus = "PARTIAL_SUCCESS";
    state.txs[CHECKING] = [tx("t1", 10, 1000)];
    const r = await syncConnection(db, client, await conn(), LATER);
    expect(r.status).toBe("partial");
    expect(await txs()).toHaveLength(2);
    expect((await conn()).lastSyncAt).toEqual(NOW);
  });

  it("while the bank is still working nothing is read", async () => {
    state.item.status = "UPDATING";
    state.calls = [];
    expect((await syncConnection(db, client, await conn(), LATER)).status).toBe("processing");
    expect(state.calls.some((c) => c.includes("/accounts"))).toBe(false);
    expect((await conn()).syncRequestedAt).toEqual(LATER);
  });

  it("two syncs at once: one runs, the other steps aside, and totals hold", async () => {
    const c = await conn();
    const [a, b] = await Promise.all([syncConnection(db, client, c, LATER), syncConnection(db, client, c, LATER)]);
    expect([a.status, b.status].sort()).toEqual(["active", "busy"]);
    expect(await txs()).toHaveLength(2);
    expect((await conn()).leaseUntil).toBeNull();
  });

  it("a lease left by a dead worker expires", async () => {
    await db.update(s.financialConnections).set({ leaseUntil: new Date(LATER.getTime() + 60_000) });
    expect((await syncConnection(db, client, await conn(), LATER)).status).toBe("busy");
    expect((await syncConnection(db, client, await conn(), new Date(LATER.getTime() + 61_000))).status).toBe("active");
  });
});

describe("what the bank changes and what the user owns", () => {
  it("a pending card purchase that posts stays one row, with new facts and the user's edits", async () => {
    state.txs[CARD] = [tx("c1", 20, 80, { status: "PENDING", type: "DEBIT" })];
    await connectItem(db, client, userId, ITEM, NOW);
    const [row] = await db.select().from(s.transactions).where(eq(s.transactions.userId, userId));
    expect(row!.bankStatus).toBe("pending");
    const [cat] = await db.select().from(s.categories).where(and(eq(s.categories.userId, userId), eq(s.categories.slug, "lazer")));
    await db.update(s.transactions).set({ categoryId: cat!.id, description: "Jantar com amigos", descriptionOverridden: true, notes: "aniversário" }).where(eq(s.transactions.id, row!.id));
    state.txs[CARD] = [tx("c1", 20, 85.5, { status: "POSTED", type: "DEBIT", providerId: "op-1", description: "RESTAURANTE XYZ" })];
    await syncConnection(db, client, await conn(), LATER);
    const rows = await db.select().from(s.transactions).where(eq(s.transactions.userId, userId));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ id: row!.id, amountCents: -8550, bankStatus: "posted", categoryId: cat!.id, description: "Jantar com amigos", providerDescription: "RESTAURANTE XYZ", notes: "aniversário" });
  });

  it("a row stored without installment numbers gets them on the next sync", async () => {
    state.txs[CARD] = [tx("c1", 20, 95.5, { type: "DEBIT", status: "PENDING", description: "LOJA EXEMPLO02/04" })];
    await connectItem(db, client, userId, ITEM, NOW);
    // As an older reader left it in production: no installment read from the glued "02/04".
    await db.update(s.transactions).set({ installmentNumber: null, installmentTotal: null }).where(eq(s.transactions.userId, userId));
    await syncConnection(db, client, await conn(), LATER);
    const [row] = await db.select().from(s.transactions).where(eq(s.transactions.userId, userId));
    expect(row).toMatchObject({ installmentNumber: 2, installmentTotal: 4 });
  });

  it("without an override the bank's new text is used", async () => {
    state.txs[CARD] = [tx("c1", 20, 80, { type: "DEBIT" })];
    await connectItem(db, client, userId, ITEM, NOW);
    state.txs[CARD] = [tx("c1", 20, 80, { type: "DEBIT", description: "NOVO TEXTO" })];
    await syncConnection(db, client, await conn(), LATER);
    expect((await txs())[0]!.description).toBe("NOVO TEXTO");
  });

  it("a bill payment plus the purchases counts the spending once", async () => {
    state.txs[CARD] = [tx("c1", 5, 300, { type: "DEBIT" }), tx("c2", 15, -300, { type: "CREDIT", description: "Pagamento recebido", category: "Credit card payment" })];
    state.txs[CHECKING] = [tx("b1", 15, -300, { description: "Pagamento fatura", category: "Credit card payment" })];
    await connectItem(db, client, userId, ITEM, NOW);
    const cats = (await db.select().from(s.categories).where(eq(s.categories.userId, userId))).map((c) => ({ ...c }));
    expect(cashFlow(await txs(), cats as never, { from: "2026-10-01", to: TODAY })).toMatchObject({ expenseCents: 30000, incomeCents: 0 });
  });

  it("money between own accounts is neither income nor spending", async () => {
    state.txs[CHECKING] = [tx("b1", 15, -500, { category: "Same person transfer - PIX" })];
    await connectItem(db, client, userId, ITEM, NOW);
    const cats = await db.select().from(s.categories).where(eq(s.categories.userId, userId));
    const flow = cashFlow(await txs(), cats as never, { from: "2026-10-01", to: TODAY });
    expect([flow.expenseCents + 0, flow.incomeCents]).toEqual([0, 0]);
  });

  it("installments keep the amount of each one", async () => {
    state.txs[CARD] = [tx("c1", 5, 100, { type: "DEBIT", creditCardMetadata: { installmentNumber: 3, totalInstallments: 10 } })];
    await connectItem(db, client, userId, ITEM, NOW);
    expect((await txs())[0]).toMatchObject({ amountCents: -10000, installmentNumber: 3, installmentTotal: 10 });
  });

  it("two equal purchases on the same day stay two", async () => {
    state.txs[CHECKING] = [tx("x1", 15, -60, { description: "Mercado" }), tx("x2", 15, -60, { description: "Mercado" })];
    await connectItem(db, client, userId, ITEM, NOW);
    expect(await txs()).toHaveLength(2);
  });

  it("a manual entry later found in the bank is suggested, never merged by itself", async () => {
    const acc = "manual-acc";
    state.txs[CHECKING] = [tx("x1", 15, -60, { description: "Mercado" })];
    await connectItem(db, client, userId, ITEM, NOW);
    const bankAccount = await account("checking");
    await db.insert(s.transactions).values({ id: acc, userId, accountId: bankAccount.id, date: "2026-10-15", description: "mercado da esquina", merchant: "m", amountCents: -6000, source: "manual", dedupeKey: "manual:1" });
    await suggestMatches(db, userId, TODAY);
    expect(await txs()).toHaveLength(2);
    const [m] = await listMatches(db, userId, "suggested");
    await confirmMatch(db, userId, m!.id, NOW);
    expect((await txs()).map((t) => t.description)).toEqual(["Mercado"]);
    await syncConnection(db, client, await conn(), LATER);
    expect(await balance("checking")).toBe(100000);
    expect(await txs()).toHaveLength(1);
  });

  it("a file imported first and the bank later are suggested too", async () => {
    state.txs[CHECKING] = [tx("x1", 15, -60, { description: "Mercado" })];
    await connectItem(db, client, userId, ITEM, NOW);
    const bankAccount = await account("checking");
    await db.insert(s.transactions).values({ id: "csv-1", userId, accountId: bankAccount.id, date: "2026-10-14", description: "MERCADO", merchant: "m", amountCents: -6000, source: "csv", dedupeKey: "csv:1" });
    expect(await suggestMatches(db, userId, TODAY)).toBe(1);
  });
});

describe("webhook queue", () => {
  const event = (over: Record<string, unknown>) => ({ eventId: `e-${Math.random()}`, event: "item/updated", itemId: ITEM, triggeredBy: "SYNC", ...over });

  it("repeating an event changes nothing", async () => {
    state.txs[CHECKING] = [tx("t1", 10, -10)];
    await connectItem(db, client, userId, ITEM, NOW);
    const e = event({ eventId: "same" });
    expect(await storeBankEvent(db, e, NOW)).toBe("stored");
    expect(await storeBankEvent(db, e, NOW)).toBe("duplicate");
    await processBankWork(db, client, { now: () => LATER });
    await processBankWork(db, client, { now: () => LATER });
    expect(await txs()).toHaveLength(1);
    expect(await db.select().from(s.bankWebhookEvents)).toHaveLength(1);
  });

  it("ignores payment events and refuses malformed ones", async () => {
    expect(await storeBankEvent(db, { event: "payment_intent/completed", eventId: "p" }, NOW)).toBe("ignored");
    expect(await storeBankEvent(db, { event: "item/updated" }, NOW)).toBe("invalid");
  });

  it("stores neither the raw item id nor transaction ids in clear", async () => {
    await storeBankEvent(db, event({ eventId: "priv", event: "transactions/deleted", transactionIds: ["tx-secreta"] }), NOW);
    const [row] = await db.select().from(s.bankWebhookEvents);
    expect(JSON.stringify(row)).not.toContain(ITEM);
    expect(JSON.stringify(row)).not.toContain("tx-secreta");
  });

  it("an event for an unknown item does nothing", async () => {
    await storeBankEvent(db, event({ eventId: "u", itemId: ITEM2 }), NOW);
    expect((await processBankWork(db, client, { now: () => LATER })).events).toBe(1);
    expect((await db.select().from(s.bankWebhookEvents))[0]!.status).toBe("ignored");
  });

  it("transactions/deleted removes that row and re-derives the balance, in any arrival order", async () => {
    state.txs[CHECKING] = [tx("t1", 10, -10), tx("t2", 11, -20)];
    await connectItem(db, client, userId, ITEM, NOW);
    state.txs[CHECKING] = [tx("t1", 10, -10)];
    (state.accounts[0] as { balance: number }).balance = 1020;
    await storeBankEvent(db, event({ event: "transactions/deleted", transactionIds: ["t2"] }), NOW);
    await storeBankEvent(db, event({ event: "item/updated" }), NOW);
    await processBankWork(db, client, { now: () => LATER });
    expect((await txs()).map((t) => t.amountCents)).toEqual([-1000]);
    expect(await balance("checking")).toBe(102000);
  });

  it("transactions/updated reaches an old entry outside the usual window", async () => {
    state.txs[CHECKING] = [tx("old", 1, -10, { date: "2026-06-01T12:00:00.000Z" })];
    await connectItem(db, client, userId, ITEM, NOW);
    state.txs[CHECKING] = [tx("old", 1, -15, { date: "2026-06-01T12:00:00.000Z" })];
    await storeBankEvent(db, event({ event: "transactions/updated", transactionIds: ["old"] }), NOW);
    await processBankWork(db, client, { now: () => LATER });
    expect((await txs())[0]!.amountCents).toBe(-1500);
    expect((await conn()).resyncFrom).toBeNull();
  });

  it("item/deleted stops updates and keeps the history", async () => {
    state.txs[CHECKING] = [tx("t1", 10, -10)];
    await connectItem(db, client, userId, ITEM, NOW);
    await storeBankEvent(db, { eventId: "d", event: "item/deleted", itemId: ITEM }, NOW);
    await processBankWork(db, client, { now: () => LATER });
    expect(await conn()).toMatchObject({ status: "disconnected", encryptedToken: null });
    expect(await txs()).toHaveLength(1);
  });

  it("a failing event retries with backoff, then gives up", async () => {
    state.throwOn = /items\//;
    await db.insert(s.bankConnectAttempts).values({ id: "a", userId, clientUserRef: "tostao-a", expiresAt: new Date(NOW.getTime() + 3_600_000) });
    await storeBankEvent(db, event({ eventId: "x", event: "item/created", itemId: ITEM2, clientUserId: "tostao-a" }), NOW);
    let at = NOW.getTime();
    for (let i = 0; i < 8; i++) {
      const now = new Date(at);
      await processBankWork(db, client, { now: () => now });
      at += 3_600_000;
    }
    const [row] = await db.select().from(s.bankWebhookEvents);
    expect(row).toMatchObject({ status: "failed", attempts: 5, itemEncrypted: null });
  });

  describe("route", () => {
    const post = (body: string, auth?: string) => POST(new Request("https://x.test/api/webhooks/pluggy", { method: "POST", body, headers: auth ? { authorization: auth } : {} }));

    it("is off without a configured secret, and refuses a wrong one before reading anything", async () => {
      vi.stubEnv("PLUGGY_WEBHOOK_SECRET", "");
      vi.stubEnv("PLUGGY_CLIENT_ID", "id");
      expect((await post("{}", "Bearer x")).status).toBe(503);
      vi.stubEnv("PLUGGY_WEBHOOK_SECRET", "segredo");
      expect((await post("not json")).status).toBe(401);
      expect((await post("not json", "Bearer errado")).status).toBe(401);
      expect((await post("x".repeat(70_000), "Bearer segredo")).status).toBe(413);
      expect((await post("not json", "Bearer segredo")).status).toBe(400);
      vi.unstubAllEnvs();
    });
  });
});

describe("widget ownership", () => {
  it("asks for Open Finance connectors only and never exposes credentials", async () => {
    const r = await startConnectAttempt(db, client, userId, {}, NOW);
    expect(r.connectorIds).toEqual([601]);
    expect(r.accessToken).toBe("connect-token");
    expect(JSON.stringify(r)).not.toMatch(/secret|apiKey/i);
    expect(state.tokens[0]).toMatchObject({ options: { clientUserId: `tostao-${r.attemptId}`, avoidDuplicates: true } });
  });

  const itemFor = (ref: string, id = ITEM) => {
    state.items[id] = { id, status: "UPDATED", executionStatus: "SUCCESS", clientUserId: ref, connector: { name: "Banco" } };
  };

  it("links only an item carrying this attempt's ref", async () => {
    const a = await startConnectAttempt(db, client, userId, {}, NOW);
    itemFor(`tostao-${a.attemptId}`);
    const c = await finishConnectAttempt(db, client, userId, a.attemptId, ITEM, NOW);
    expect(c).toMatchObject({ userId, accessMode: "connect" });
  });

  it("refuses an item id that came from elsewhere", async () => {
    const a = await startConnectAttempt(db, client, userId, {}, NOW);
    itemFor("tostao-de-outra-pessoa");
    await expect(finishConnectAttempt(db, client, userId, a.attemptId, ITEM, NOW)).rejects.toThrow(/não pertence/);
    expect(await db.select().from(s.financialConnections)).toHaveLength(0);
  });

  it("user B cannot use the attempt of user A", async () => {
    const a = await startConnectAttempt(db, client, userId, {}, NOW);
    itemFor(`tostao-${a.attemptId}`);
    await expect(finishConnectAttempt(db, client, other, a.attemptId, ITEM, NOW)).rejects.toThrow(/não encontrada/);
  });

  it("a replayed callback neither relinks nor reaches another item", async () => {
    const a = await startConnectAttempt(db, client, userId, {}, NOW);
    itemFor(`tostao-${a.attemptId}`);
    const first = await finishConnectAttempt(db, client, userId, a.attemptId, ITEM, NOW);
    const again = await finishConnectAttempt(db, client, userId, a.attemptId, ITEM, NOW);
    expect(again!.id).toBe(first!.id);
    itemFor(`tostao-${a.attemptId}`, ITEM2);
    await expect(finishConnectAttempt(db, client, userId, a.attemptId, ITEM2, NOW)).rejects.toThrow(/já foi usada/);
  });

  it("an expired attempt is refused", async () => {
    const a = await startConnectAttempt(db, client, userId, {}, NOW);
    itemFor(`tostao-${a.attemptId}`);
    await expect(finishConnectAttempt(db, client, userId, a.attemptId, ITEM, new Date(NOW.getTime() + 3 * 3_600_000))).rejects.toThrow(/expirou/);
  });

  it("the webhook completes a connection when the user closed the page", async () => {
    const a = await startConnectAttempt(db, client, userId, {}, NOW);
    itemFor(`tostao-${a.attemptId}`);
    state.txs[CHECKING] = [tx("t1", 10, -10)];
    await storeBankEvent(db, { eventId: "w", event: "item/created", itemId: ITEM, clientUserId: `tostao-${a.attemptId}` }, NOW);
    await processBankWork(db, client, { now: () => NOW });
    expect(await conn()).toMatchObject({ status: "active", accessMode: "connect" });
    expect(await txs()).toHaveLength(1);
  });

  it("reauthorizing binds the token to that item and only for its owner", async () => {
    state.item.executionStatus = "USER_AUTHORIZATION_EXPIRED";
    await connectItem(db, client, userId, ITEM, NOW);
    const c = await conn();
    expect(c.status).toBe("reauth_required");
    await expect(startConnectAttempt(db, client, other, { connectionId: c.id }, NOW)).rejects.toThrow(/não encontrada/);
    const a = await startConnectAttempt(db, client, userId, { connectionId: c.id }, NOW);
    expect(a.updateItem).toBe(ITEM);
    expect(state.tokens.at(-1)).toMatchObject({ itemId: ITEM });
    state.item.executionStatus = "SUCCESS";
    const updated = await finishConnectAttempt(db, client, userId, a.attemptId, undefined, NOW);
    expect((await syncConnection(db, client, updated!, NOW)).status).toBe("active");
    expect(await conn()).toMatchObject({ status: "active", statusDetail: null });
  });

  it("demo users and non-owners never pass the gate", () => {
    process.env.PLUGGY_CLIENT_ID = "id";
    process.env.PLUGGY_CLIENT_SECRET = "s";
    process.env.PLUGGY_OWNER_USER_ID = "dono";
    const totpEnabledAt = new Date();
    expect(canConnectBanks({ id: "dono", isDemo: true, totpEnabledAt })).toBe(false);
    expect(canConnectBanks({ id: "b", isDemo: false, totpEnabledAt })).toBe(false);
    delete process.env.PLUGGY_CLIENT_ID;
    delete process.env.PLUGGY_CLIENT_SECRET;
    delete process.env.PLUGGY_OWNER_USER_ID;
  });
});

describe("history", () => {
  it("disconnecting and deleting are separate steps, and only bank entries go", async () => {
    state.txs[CHECKING] = [tx("t1", 10, -10)];
    await connectItem(db, client, userId, ITEM, NOW);
    const c = await conn();
    await expect(deleteBankHistory(db, userId, c.id)).rejects.toThrow(/Desconecte/);
    await disconnectBank(db, client, userId, c.id);
    const acc = await account("checking");
    await db.insert(s.transactions).values({ id: "m", userId, accountId: acc.id, date: "2026-10-02", description: "à mão", merchant: "x", amountCents: -100, source: "manual", dedupeKey: "manual:m" });
    await expect(deleteBankHistory(db, other, c.id)).rejects.toThrow(/não encontrada/);
    await deleteBankHistory(db, userId, c.id);
    expect((await txs()).map((t) => t.id)).toEqual(["m"]);
    expect(await db.select().from(s.financialConnections).where(eq(s.financialConnections.userId, userId))).toHaveLength(0);
  });
});

it("carries the wait time on rate limits", () => {
  expect(new PluggyError(429, 30).retryAfter).toBe(30);
});
