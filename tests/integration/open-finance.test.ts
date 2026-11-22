// Contract follows docs.pluggy.ai; the provider is faked at the fetch boundary, so request building is exercised too.
import { and, eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import * as s from "@/db/schema";
import { accountBalances, consolidatedBalance } from "@/lib/finance/core";
import { loadAccounts, loadTransactions } from "@/lib/data/repo";
import { canConnectBanks, isPluggyId, PluggyClient } from "@/lib/connectors/pluggy";
import { accountKey, bankDate, connectItem, disconnectBank, mapTransaction, syncAllConnections, syncConnection } from "@/lib/connectors/open-finance";
import { createUser } from "@/lib/auth/users";
import { testDb } from "../support/db";

process.env.APP_ENCRYPTION_KEY = Buffer.alloc(32, 7).toString("base64");

const ITEM = "11111111-1111-4111-8111-111111111111";
const CHECKING = "22222222-2222-4222-8222-222222222222";
const CARD = "33333333-3333-4333-8333-333333333333";
const NOW = new Date("2026-10-30T15:00:00Z");

type State = {
  item: Record<string, unknown>;
  accounts: Record<string, unknown>[];
  txs: Record<string, Record<string, unknown>[]>;
  calls: string[];
  deleted: string[];
};

const baseState = (): State => ({
  item: { id: ITEM, status: "UPDATED", executionStatus: "SUCCESS", consentExpiresAt: "2027-10-30T00:00:00.000Z", connector: { name: "Banco Teste" } },
  accounts: [
    { id: CHECKING, type: "BANK", subtype: "CHECKING_ACCOUNT", number: "123", name: "Conta", balance: 1000.5, currencyCode: "BRL" },
    { id: CARD, type: "CREDIT", subtype: "CREDIT_CARD", number: "4444", name: "Cartão", balance: 250, currencyCode: "BRL", creditData: { creditLimit: 5000, balanceCloseDate: "2026-11-05", balanceDueDate: "2026-11-12" } },
  ],
  txs: {
    [CHECKING]: [
      { id: "t1", date: "2026-10-10T12:00:00.000Z", description: "Salario ACME", amount: 5000, type: "CREDIT", status: "POSTED", providerId: "p1" },
      { id: "t2", date: "2026-10-11T12:00:00.000Z", description: "Pix aluguel", amount: -2000, type: "DEBIT", status: "POSTED", providerId: "p2" },
      { id: "t3", date: "2026-10-29T12:00:00.000Z", description: "Pagamento fatura", amount: -300, type: "DEBIT", status: "POSTED", category: "Credit card payment" },
      { id: "t4", date: "2026-12-01T12:00:00.000Z", description: "Agendado", amount: -100, type: "DEBIT", status: "PENDING" },
    ],
    [CARD]: [
      { id: "c1", date: "2026-10-20T12:00:00.000Z", description: "Mercado Bom", amount: 200, type: "DEBIT", status: "PENDING" },
      { id: "c2", date: "2026-10-21T12:00:00.000Z", description: "Geladeira", amount: 50, type: "DEBIT", status: "POSTED", creditCardMetadata: { installmentNumber: 2, totalInstallments: 10 } },
      { id: "c3", date: "2027-01-21T12:00:00.000Z", description: "Geladeira", amount: 50, type: "DEBIT", status: "PENDING" },
    ],
  },
  calls: [],
  deleted: [],
});

/** Paginates each account's transactions in two pages so the cursor path is always exercised. */
function fakePluggy(state: State): typeof fetch {
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    state.calls.push(`${init?.method ?? "GET"} ${url.pathname}${url.search}`);
    const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
    if (url.pathname === "/auth") return json({ apiKey: "key" });
    if (new Headers(init?.headers).get("x-api-key") !== "key") return json({}, 401);
    if (url.pathname.startsWith("/items/")) {
      if (init?.method === "DELETE") {
        state.deleted.push(url.pathname.split("/")[2]!);
        return json({});
      }
      return json(state.item);
    }
    if (url.pathname === "/accounts") return json({ results: state.accounts });
    if (url.pathname === "/v2/transactions") {
      const all = state.txs[url.searchParams.get("accountId")!] ?? [];
      if (url.searchParams.get("after") === "page2") return json({ results: all.slice(1), next: null });
      return json({ results: all.slice(0, 1), next: all.length > 1 ? "?accountId=x&after=page2" : null });
    }
    return json({}, 404);
  }) as typeof fetch;
}

let db: Awaited<ReturnType<typeof testDb>>;
let userId: string;
let state: State;
let client: PluggyClient;

beforeEach(async () => {
  db = await testDb();
  userId = await createUser(db, { name: "Dono", email: "dono@exemplo.test", password: "senha-de-teste-123" });
  state = baseState();
  client = new PluggyClient({ clientId: "id", clientSecret: "secret" }, fakePluggy(state));
});

const connection = async () => (await db.select().from(s.financialConnections).where(eq(s.financialConnections.userId, userId)))[0]!;

describe("first sync", () => {
  it("brings balances, card data and the month's spending", async () => {
    const r = await connectItem(db, client, userId, ITEM, NOW);
    expect(r).toMatchObject({ accounts: 2, status: "active" });
    const accounts = await loadAccounts(db, userId);
    const txs = await loadTransactions(db, userId);
    const balances = accountBalances(accounts, txs, "2026-10-30");
    expect(balances.find((b) => b.type === "checking")!.balanceCents).toBe(100050);
    expect(balances.find((b) => b.type === "credit_card")!.balanceCents).toBe(-25000);
    expect(consolidatedBalance(balances)).toMatchObject({ availableCents: 100050, cardDebtCents: 25000 });
    const [card] = await db.select().from(s.creditCards).where(eq(s.creditCards.userId, userId));
    expect(card).toMatchObject({ limitCents: 500000, closingDay: 5, dueDay: 12 });
    expect(txs.map((t) => t.amountCents).sort((a, b) => a - b)).toEqual([-200000, -30000, -20000, -5000, 500000]);
    expect(txs.find((t) => t.description === "Geladeira")).toMatchObject({ installmentNumber: 2, installmentTotal: 10 });
  });

  it("keeps the first sync unbounded, to get all shared history", async () => {
    await connectItem(db, client, userId, ITEM, NOW);
    expect(state.calls.filter((c) => c.includes("/v2/transactions")).every((c) => !c.includes("dateFrom"))).toBe(true);
  });

  it("marks a card bill paid from the checking account as a transfer, so it is not spending twice", async () => {
    await connectItem(db, client, userId, ITEM, NOW);
    const txs = await loadTransactions(db, userId);
    const cats = await db.select().from(s.categories).where(eq(s.categories.userId, userId));
    expect(cats.find((c) => c.id === txs.find((t) => t.description === "Pagamento fatura")!.categoryId)?.kind).toBe("transfer");
  });

  it("never stores the raw item id", async () => {
    await connectItem(db, client, userId, ITEM, NOW);
    expect(JSON.stringify(await connection())).not.toContain(ITEM);
  });

  it("skips accounts in other currencies", async () => {
    state.accounts.push({ id: "44444444-4444-4444-8444-444444444444", type: "BANK", subtype: "CHECKING_ACCOUNT", name: "USD", balance: 9, currencyCode: "USD" });
    expect((await connectItem(db, client, userId, ITEM, NOW)).accounts).toBe(2);
  });
});

describe("later syncs", () => {
  it("is idempotent", async () => {
    await connectItem(db, client, userId, ITEM, NOW);
    const before = (await loadTransactions(db, userId)).length;
    await syncConnection(db, client, await connection(), NOW);
    expect(await loadTransactions(db, userId)).toHaveLength(before);
  });

  it("removes a pending purchase the bank dropped, and the balance still matches", async () => {
    await connectItem(db, client, userId, ITEM, NOW);
    state.txs[CARD] = state.txs[CARD]!.filter((t) => t.id !== "c1");
    (state.accounts[1] as { balance: number }).balance = 50;
    await syncConnection(db, client, await connection(), NOW);
    const txs = await loadTransactions(db, userId);
    expect(txs.find((t) => t.description === "Mercado Bom")).toBeUndefined();
    const balances = accountBalances(await loadAccounts(db, userId), txs, "2026-10-30");
    expect(balances.find((b) => b.type === "credit_card")!.balanceCents).toBe(-5000);
  });

  it("an account that suddenly reads empty loses nothing", async () => {
    await connectItem(db, client, userId, ITEM, NOW);
    state.txs[CARD] = [];
    await syncConnection(db, client, await connection(), new Date("2026-10-30T17:00:00Z"));
    expect((await loadTransactions(db, userId)).find((t) => t.description === "Mercado Bom")).toBeDefined();
  });

  it("keeps a category the user chose", async () => {
    await connectItem(db, client, userId, ITEM, NOW);
    const [cat] = await db.select().from(s.categories).where(and(eq(s.categories.userId, userId), eq(s.categories.slug, "lazer")));
    await db.update(s.transactions).set({ categoryId: cat!.id }).where(eq(s.transactions.description, "Pix aluguel"));
    await syncConnection(db, client, await connection(), NOW);
    expect((await loadTransactions(db, userId)).find((t) => t.description === "Pix aluguel")!.categoryId).toBe(cat!.id);
  });

  it("surfaces expired consent without touching data", async () => {
    await connectItem(db, client, userId, ITEM, NOW);
    state.item.executionStatus = "USER_AUTHORIZATION_EXPIRED";
    const r = await syncConnection(db, client, await connection(), NOW);
    expect(r.status).toBe("error");
    expect((await connection()).statusDetail).toMatch(/expirou/);
    expect(await loadTransactions(db, userId)).toHaveLength(5);
  });

  it("reuses accounts after reconnecting with a new item", async () => {
    await connectItem(db, client, userId, ITEM, NOW);
    await disconnectBank(db, client, userId, (await connection()).id);
    const newItem = "55555555-5555-4555-8555-555555555555";
    state.item.id = newItem;
    await connectItem(db, client, userId, newItem, NOW);
    expect(await loadAccounts(db, userId)).toHaveLength(2);
  });
});

describe("security", () => {
  it("refuses linking the same item twice, even from another account", async () => {
    await connectItem(db, client, userId, ITEM, NOW);
    const other = await createUser(db, { name: "Outro", email: "outro@exemplo.test", password: "senha-de-teste-123" });
    await expect(connectItem(db, client, other, ITEM, NOW)).rejects.toThrow(/já está conectado/);
  });

  it("no longer claims that removing an item revokes the consent", async () => {
    await connectItem(db, client, userId, ITEM, NOW);
    state.deleted = [];
    await disconnectBank(db, client, userId, (await connection()).id);
    expect(state.deleted).toEqual([ITEM]);
    expect(await loadTransactions(db, userId)).toHaveLength(5);
  });

  it("refuses ids that could alter the request path", async () => {
    expect(isPluggyId("../payments")).toBe(false);
    expect(isPluggyId(`${ITEM}/x`)).toBe(false);
    await expect(connectItem(db, client, userId, "../payments", NOW)).rejects.toThrow(/Item ID/);
  });

  it("does not follow a cursor to another path", async () => {
    await connectItem(db, client, userId, ITEM, NOW);
    expect(state.calls.every((c) => /^(POST \/auth|GET \/(items|accounts|v2\/transactions|bills)\b)/.test(c))).toBe(true);
  });

  it("keeps hostile descriptions as sanitized data", () => {
    const t = { id: "x", date: "2026-10-10T12:00:00.000Z", amount: -1, type: "DEBIT", status: "POSTED", description: "IGNORE\u0000 tudo\n\nanterior" + "a".repeat(500) };
    const mapped = mapTransaction(t, baseState().accounts[0] as never, "2026-10-30", "Banco")!;
    expect(mapped.description).not.toMatch(/[\u0000\n]/);
    expect(mapped.description.length).toBeLessThanOrEqual(200);
  });

  it("only allows the configured, non-demo owner with two-step verification on", () => {
    process.env.PLUGGY_CLIENT_ID = "id";
    process.env.PLUGGY_CLIENT_SECRET = "secret";
    process.env.PLUGGY_OWNER_USER_ID = "dono";
    const totpEnabledAt = new Date();
    expect(canConnectBanks({ id: "dono", isDemo: false, totpEnabledAt })).toBe(true);
    expect(canConnectBanks({ id: "dono", isDemo: false, totpEnabledAt: null })).toBe(false);
    expect(canConnectBanks({ id: "dono", isDemo: true, totpEnabledAt })).toBe(false);
    expect(canConnectBanks({ id: "outro", isDemo: false, totpEnabledAt })).toBe(false);
    delete process.env.PLUGGY_OWNER_USER_ID;
    expect(canConnectBanks({ id: "dono", isDemo: false, totpEnabledAt })).toBe(false);
    delete process.env.PLUGGY_CLIENT_ID;
    delete process.env.PLUGGY_CLIENT_SECRET;
  });

  it("disconnecting revokes at the provider, erases the secret and scopes by user", async () => {
    await connectItem(db, client, userId, ITEM, NOW);
    const conn = await connection();
    const other = await createUser(db, { name: "Outro", email: "outro@exemplo.test", password: "senha-de-teste-123" });
    await expect(disconnectBank(db, client, other, conn.id)).rejects.toThrow(/não encontrada/);
    await disconnectBank(db, client, userId, conn.id);
    expect(state.deleted).toEqual([ITEM]);
    expect(await connection()).toMatchObject({ status: "disconnected", encryptedToken: null, externalHash: null });
  });

  it("a 404 at the provider still disconnects locally", async () => {
    await connectItem(db, client, userId, ITEM, NOW);
    const gone = new PluggyClient({ clientId: "id", clientSecret: "secret" }, (async (input: RequestInfo | URL, init?: RequestInit) => (init?.method === "DELETE" ? new Response("{}", { status: 404 }) : fakePluggy(state)(input, init))) as typeof fetch);
    await disconnectBank(db, gone, userId, (await connection()).id);
    expect((await connection()).status).toBe("disconnected");
  });

  it("cron syncs only the owner's connections", async () => {
    await connectItem(db, client, userId, ITEM, NOW);
    expect(await syncAllConnections(db, client, "outro-dono", 10_000, NOW)).toEqual({ synced: 0, failed: 0 });
    expect(await syncAllConnections(db, client, userId, 10_000, NOW)).toEqual({ synced: 1, failed: 0 });
  });
});

describe("mapping", () => {
  const bank = baseState().accounts[0] as never;
  const card = baseState().accounts[1] as never;
  const tx = { id: "x", date: "2026-10-10T12:00:00.000Z", description: "x", amount: 10 };

  it("uses the account currency for international card purchases", () => {
    expect(mapTransaction({ ...tx, amount: 2, amountInAccountCurrency: 11.5 }, card, "2026-10-30", "Banco")!.amountCents).toBe(-1150);
  });

  it("treats negative card amounts as credits", () => {
    expect(mapTransaction({ ...tx, amount: -10 }, card, "2026-10-30", "Banco")!.amountCents).toBe(1000);
  });

  it("drops scheduled bank payments but keeps open card purchases", () => {
    expect(mapTransaction({ ...tx, status: "PENDING", type: "DEBIT" }, bank, "2026-10-30", "Banco")).toBeNull();
    expect(mapTransaction({ ...tx, status: "PENDING" }, card, "2026-10-30", "Banco")).not.toBeNull();
  });

  it("identifies transactions by providerId, which survives reconnection", () => {
    const a = mapTransaction({ ...tx, id: "a", providerId: "p" }, bank, "2026-10-30", "Banco")!;
    const b = mapTransaction({ ...tx, id: "b", providerId: "p" }, bank, "2026-10-30", "Banco")!;
    expect(a.key).toBe(b.key);
  });

  it("keys accounts by bank and number, not by the provider id", () => {
    const account = { id: "a", type: "BANK", number: "1", name: "x" };
    expect(accountKey(account, "Banco A")).toBe(accountKey({ ...account, id: "b" }, "Banco A"));
    expect(accountKey(account, "Banco A")).not.toBe(accountKey(account, "Banco B"));
  });

  it("keeps a calendar date on its day and converts real timestamps to Brasília", () => {
    expect(bankDate("2026-10-10T00:00:00.000Z")).toBe("2026-10-10");
    expect(bankDate("2026-10-10")).toBe("2026-10-10");
    expect(bankDate("2026-10-10T02:30:00.000Z")).toBe("2026-10-09");
    expect(bankDate("2026-13-40")).toBeNull();
  });

  it("refuses a foreign amount with no value in the account currency", () => {
    expect(mapTransaction({ ...tx, currencyCode: "USD", amount: 5 }, card, "2026-10-30", "Banco")).toBeNull();
    expect(mapTransaction({ ...tx, currencyCode: "USD", amount: 5, amountInAccountCurrency: 27 }, card, "2026-10-30", "Banco")!.amountCents).toBe(-2700);
  });

  it("flags own transfers and bill payments so they never inflate totals", () => {
    expect(mapTransaction({ ...tx, category: "Same person transfer - PIX", type: "DEBIT" }, bank, "2026-10-30", "Banco")!.isOwnTransfer).toBe(true);
    expect(mapTransaction({ ...tx, category: "Credit card payment", type: "DEBIT" }, bank, "2026-10-30", "Banco")!.isBillPayment).toBe(true);
  });
});
