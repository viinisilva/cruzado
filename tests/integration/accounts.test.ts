import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { and, eq } from "drizzle-orm";
import * as s from "@/db/schema";
import { TODAY, seededUser, testDb } from "../support/db";

type DB = Awaited<ReturnType<typeof testDb>>;
const state = vi.hoisted(() => ({ db: undefined as unknown, user: undefined as unknown }));

vi.mock("@/db/client", () => ({ getDb: async () => state.db }));
vi.mock("@/lib/auth/session", () => ({ requireUser: async () => state.user, requireWriter: async () => state.user }));
vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));
vi.mock("next/navigation", () => ({
  redirect: (to: string) => {
    throw new Error(`redirect:${to}`);
  },
}));

const { quickSetupAction, removeAccountAction, saveAccountAction } = await import("@/app/actions/finance");
const { bankLinkedAccountIds, removeAccount } = await import("@/lib/accounts");
const { canAddAccountsManually } = await import("@/lib/connectors/pluggy");

const PASSWORD = "senha-de-teste-123";
let db: DB;
let ana: Awaited<ReturnType<typeof seededUser>>;
let bruno: Awaited<ReturnType<typeof seededUser>>;
let n = 0;

const form = (fields: Record<string, string>) => {
  const f = new FormData();
  for (const [k, v] of Object.entries(fields)) f.set(k, v);
  return f;
};
const asUser = async (userId: string) => {
  const [user] = await db.select().from(s.users).where(eq(s.users.id, userId));
  state.user = user;
};
const accountsOf = (userId: string) => db.select().from(s.accounts).where(eq(s.accounts.userId, userId));
const addAccount = async (userId: string, connectionId: string | null = null) => {
  const id = `conta-${++n}`;
  await db.insert(s.accounts).values({ id, userId, name: `Conta ${n}`, institution: "Banco Fictício", type: "checking", connectionId });
  return id;
};
const addEntry = async (userId: string, accountId: string, over: Partial<typeof s.transactions.$inferInsert> = {}) => {
  const id = `tx-${++n}`;
  await db.insert(s.transactions).values({ id, userId, accountId, date: TODAY, description: "Compra", merchant: "compra", amountCents: -1000, source: "manual", dedupeKey: id, ...over });
  return id;
};
const addConnection = async (userId: string, status: s.ConnectionStatus, connector: "open_finance" | "demo" = "open_finance") => {
  const id = `conexao-${++n}`;
  await db.insert(s.financialConnections).values({ id, userId, connector, label: "Banco", status });
  return id;
};

beforeAll(async () => {
  db = await testDb();
  state.db = db;
  ana = await seededUser(db, "ana@exemplo.test");
  bruno = await seededUser(db, "bruno@exemplo.test");
}, 60_000);

beforeEach(async () => {
  await asUser(ana.userId);
});

afterEach(() => {
  vi.unstubAllEnvs();
});

const beOwner = (userId: string) => {
  vi.stubEnv("PLUGGY_OWNER_USER_ID", userId);
  vi.stubEnv("PLUGGY_CLIENT_ID", "id-ficticio");
  vi.stubEnv("PLUGGY_CLIENT_SECRET", "segredo-ficticio");
};

describe("adding accounts by hand", () => {
  const newCard = { name: "Cartão Novo", institution: "Banco Fictício", type: "credit_card", limit: "1.000,00", closingDay: "5", dueDay: "12" };

  it("is closed for whoever has the bank integration, on the server and not only on the screen", async () => {
    beOwner(ana.userId);
    const before = (await accountsOf(ana.userId)).length;
    expect(canAddAccountsManually({ id: ana.userId, isDemo: false })).toBe(false);
    expect((await saveAccountAction({}, form(newCard))).error).toContain("conexão com o banco");
    const pick = JSON.stringify([{ bank: "Nubank", checking: true, card: true }]);
    expect((await quickSetupAction({}, form({ selection: pick }))).error).toContain("conexão com o banco");
    expect(await accountsOf(ana.userId)).toHaveLength(before);
  });

  it("still lets the owner edit an existing account", async () => {
    beOwner(ana.userId);
    const id = await addAccount(ana.userId);
    expect(await saveAccountAction({}, form({ id, name: "Nome Novo", institution: "Banco Fictício", type: "checking" }))).toMatchObject({ ok: true });
    expect((await accountsOf(ana.userId)).find((a) => a.id === id)?.name).toBe("Nome Novo");
  });

  it("stays open where there is no bank integration", async () => {
    beOwner(bruno.userId);
    expect(await saveAccountAction({}, form({ ...newCard, name: "Cartão de Quem Não É Dono" }))).toMatchObject({ ok: true });
    vi.unstubAllEnvs();
    expect(canAddAccountsManually({ id: ana.userId, isDemo: false })).toBe(true);
    expect(canAddAccountsManually({ id: ana.userId, isDemo: true })).toBe(true);
  });
});

describe("removing an account", () => {
  it("needs the word, then the password, and removes nothing until both are right", async () => {
    const id = await addAccount(ana.userId);
    expect((await removeAccountAction({}, form({ id, confirm: "excluir", password: PASSWORD }))).fieldErrors?.confirm).toBeDefined();
    expect((await removeAccountAction({}, form({ id, confirm: "EXCLUIR", password: "errada" }))).fieldErrors?.password).toBe("Senha incorreta.");
    expect((await accountsOf(ana.userId)).some((a) => a.id === id)).toBe(true);
  });

  it("removes the account with its entries, card and imports, and returns to the list", async () => {
    const id = await addAccount(ana.userId);
    await addEntry(ana.userId, id);
    await db.insert(s.creditCards).values({ id: `cartao-${id}`, userId: ana.userId, accountId: id, limitCents: 1, closingDay: 1, dueDay: 10 });
    await expect(removeAccountAction({}, form({ id, confirm: "EXCLUIR", password: PASSWORD }))).rejects.toThrow("redirect:/configuracoes?aba=contas&removida=1");
    expect(await db.select().from(s.accounts).where(eq(s.accounts.id, id))).toEqual([]);
    expect(await db.select().from(s.transactions).where(eq(s.transactions.accountId, id))).toEqual([]);
    expect(await db.select().from(s.creditCards).where(eq(s.creditCards.accountId, id))).toEqual([]);
    const events = await db.select().from(s.auditEvents).where(and(eq(s.auditEvents.userId, ana.userId), eq(s.auditEvents.action, "account.deleted")));
    expect(events.map((e) => e.meta)).toContainEqual({ accountId: id, transactions: 1 });
  });

  it("cannot reach another person's account", async () => {
    const id = await addAccount(bruno.userId);
    expect((await removeAccountAction({}, form({ id, confirm: "EXCLUIR", password: PASSWORD }))).error).toBe("Conta não encontrada.");
    await expect(removeAccount(db, ana.userId, id, TODAY)).rejects.toThrow("não encontrada");
    expect((await accountsOf(bruno.userId)).some((a) => a.id === id)).toBe(true);
  });

  it("refuses an account from a linked bank, which the next sync would bring back", async () => {
    const connection = await addConnection(ana.userId, "active");
    const id = await addAccount(ana.userId, connection);
    expect((await bankLinkedAccountIds(db, ana.userId)).has(id)).toBe(true);
    expect((await removeAccountAction({}, form({ id, confirm: "EXCLUIR", password: PASSWORD }))).error).toContain("Desconecte");
    expect((await accountsOf(ana.userId)).some((a) => a.id === id)).toBe(true);
  });

  it("allows it once the bank is disconnected, and treats demo links as plain accounts", async () => {
    const off = await addAccount(ana.userId, await addConnection(ana.userId, "disconnected"));
    const demo = await addAccount(ana.userId, await addConnection(ana.userId, "active", "demo"));
    const linked = await bankLinkedAccountIds(db, ana.userId);
    expect(linked.has(off) || linked.has(demo)).toBe(false);
    await removeAccount(db, ana.userId, off, TODAY);
    await removeAccount(db, ana.userId, demo, TODAY);
    expect((await accountsOf(ana.userId)).some((a) => a.id === off || a.id === demo)).toBe(false);
  });

  it("brings back entries elsewhere that were reconciled against the removed rows", async () => {
    const other = await addAccount(ana.userId);
    const removed = await addAccount(ana.userId);
    const bankRow = await addEntry(ana.userId, removed, { source: "open_finance" });
    const entry = await addEntry(ana.userId, other, { supersededBy: bankRow });
    expect(await removeAccount(db, ana.userId, removed, TODAY)).toEqual({ transactions: 1 });
    const [row] = await db.select().from(s.transactions).where(eq(s.transactions.id, entry));
    expect(row!.supersededBy).toBeNull();
  });

  it("drops recurring charges that only existed on the removed account", async () => {
    const [card] = (await accountsOf(ana.userId)).filter((a) => a.id === ana.accounts.card);
    await removeAccount(db, ana.userId, card!.id, TODAY);
    const left = await db.select().from(s.recurringTransactions).where(eq(s.recurringTransactions.userId, ana.userId));
    expect(left.some((r) => r.accountId === card!.id)).toBe(false);
  });
});
