// Capture tokens: an assistant can add ledger entries but can never read financial data.
import { eq } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import * as s from "@/db/schema";
import { CaptureError, listCaptureOptions, recordTransaction, undoLastRecorded } from "@/lib/capture";
import { loadTransactions } from "@/lib/data/repo";
import { createMcpToken, resolveMcpToken } from "@/lib/mcp/tokens";
import { CAPTURE_TOOLS, MCP_TOOLS, handleMcpRequest } from "@/lib/mcp/server";
import { NOW, TODAY, seededUser, testDb } from "../support/db";

let db: Awaited<ReturnType<typeof testDb>>;
let userId: string;
let accountId: string;
let seq = 0;
const fresh = () => seededUser(db, `cap${++seq}@exemplo.test`);

beforeAll(async () => {
  db = await testDb();
  ({ userId } = await fresh());
  accountId = (await db.select().from(s.accounts).where(eq(s.accounts.userId, userId)))[0]!.id;
});

const mcp = async (user: string, scope: "read" | "capture", method: string, params: unknown = {}) => {
  const req = new Request("http://x/api/mcp", {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json, text/event-stream" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  return (await handleMcpRequest(db, user, req, scope)).json();
};
const base = { amount: "45,50", direction: "expense" as const, description: "Mercado do bairro" };
const later = (minutes: number) => new Date(NOW.getTime() + minutes * 60_000);

describe("recordTransaction", () => {
  it("stores an expense with automatic category and the right sign", async () => {
    const r = await recordTransaction(db, userId, { ...base, accountId }, later(10));
    expect(r).toMatchObject({ recorded: true, amount: "-R$ 45,50", category: "Mercado", date: TODAY });
    const tx = (await loadTransactions(db, userId)).find((t) => t.description === "Mercado do bairro");
    expect(tx).toMatchObject({ amountCents: -4550 });
  });

  it("treats a repeated call as one entry, but the same purchase later as another", async () => {
    const before = (await loadTransactions(db, userId)).length;
    await recordTransaction(db, userId, { ...base, description: "Padaria", accountId }, later(20));
    const again = await recordTransaction(db, userId, { ...base, description: "Padaria", accountId }, later(20));
    expect(again).toMatchObject({ recorded: false, duplicate: true });
    await recordTransaction(db, userId, { ...base, description: "Padaria", accountId }, later(40));
    expect(await loadTransactions(db, userId)).toHaveLength(before + 2);
  });

  it.each([
    [{ amount: "0" }, /Valor/],
    [{ amount: "-10" }, /Valor/],
    [{ amount: "abc" }, /Valor/],
    [{ amount: "100000,01" }, /limite/],
    [{ date: "2099-01-01" }, /futura/],
    [{ date: "2020-01-01" }, /anterior/],
    [{ date: "2025-13-40" }, /inválida/],
  ])("refuses %j", async (patch, message) => {
    await expect(recordTransaction(db, userId, { ...base, accountId, ...patch }, NOW)).rejects.toThrow(message);
  });

  it("asks which account when there is more than one", async () => {
    await expect(recordTransaction(db, userId, base, NOW)).rejects.toThrow(/Em qual conta/);
  });

  it("cannot reach another user's account or category", async () => {
    const other = await fresh();
    const [theirAccount] = await db.select().from(s.accounts).where(eq(s.accounts.userId, other.userId));
    const [theirCategory] = await db.select().from(s.categories).where(eq(s.categories.userId, other.userId));
    await expect(recordTransaction(db, userId, { ...base, accountId: theirAccount!.id }, NOW)).rejects.toBeInstanceOf(CaptureError);
    await expect(recordTransaction(db, userId, { ...base, accountId, categoryId: theirCategory!.id }, NOW)).rejects.toThrow(/Categoria/);
  });

  it("sanitizes the description", async () => {
    await recordTransaction(db, userId, { ...base, accountId, description: "Lanche​‮\n\ncom\u0000 amigos" }, later(60));
    expect((await loadTransactions(db, userId)).some((t) => t.description === "Lanche com amigos")).toBe(true);
  });
});

describe("undo", () => {
  it("removes only the latest assistant entry, within a day", async () => {
    const { userId: user } = await fresh();
    const [account] = await db.select().from(s.accounts).where(eq(s.accounts.userId, user));
    const opts = { ...base, accountId: account!.id };
    const seeded = (await loadTransactions(db, user)).length;
    await expect(undoLastRecorded(db, user, new Date())).rejects.toThrow(/recente/);
    await recordTransaction(db, user, opts, new Date());
    expect(await undoLastRecorded(db, user, new Date())).toMatchObject({ undone: true });
    expect(await loadTransactions(db, user)).toHaveLength(seeded);
    await recordTransaction(db, user, opts, new Date());
    await expect(undoLastRecorded(db, user, new Date(Date.now() + 25 * 60 * 60_000))).rejects.toThrow(/recente/);
  });
});

describe("channels and categories", () => {
  it("one token cannot undo what another recorded", async () => {
    const { userId: user } = await fresh();
    const [account] = await db.select().from(s.accounts).where(eq(s.accounts.userId, user));
    await recordTransaction(db, user, { ...base, accountId: account!.id }, new Date(), "canal-a");
    await expect(undoLastRecorded(db, user, new Date(), "canal-b")).rejects.toThrow(/recente/);
    await expect(undoLastRecorded(db, user, new Date(), "canal-a")).resolves.toMatchObject({ undone: true });
  });

  it("refuses transfer categories and categories of the opposite direction", async () => {
    const cats = await db.select().from(s.categories).where(eq(s.categories.userId, userId));
    const transfer = cats.find((c) => c.kind === "transfer")!;
    const income = cats.find((c) => c.kind === "income")!;
    await expect(recordTransaction(db, userId, { ...base, accountId, categoryId: transfer.id }, NOW)).rejects.toThrow(/Categoria/);
    await expect(recordTransaction(db, userId, { ...base, accountId, categoryId: income.id }, NOW)).rejects.toThrow(/Categoria/);
  });
});

describe("scope isolation", () => {
  it("capture tokens see only capture tools; read tokens only read tools", async () => {
    const capture = (await mcp(userId, "capture", "tools/list")) as { result: { tools: { name: string }[] } };
    expect(capture.result.tools.map((t) => t.name).sort()).toEqual([...CAPTURE_TOOLS].sort());
    const read = (await mcp(userId, "read", "tools/list")) as { result: { tools: { name: string }[] } };
    expect(read.result.tools.map((t) => t.name).sort()).toEqual(MCP_TOOLS.map((t) => t.name).sort());
  });

  it("a capture token cannot call a read tool, and a read token cannot record", async () => {
    const reading = JSON.stringify(await mcp(userId, "capture", "tools/call", { name: "get_transactions", arguments: {} }));
    expect(reading).not.toContain("amountCents");
    const before = (await loadTransactions(db, userId)).length;
    const writing = (await mcp(userId, "read", "tools/call", { name: "record_transaction", arguments: { ...base, accountId } })) as { error?: unknown; result?: { isError?: boolean } };
    expect(writing.error ?? writing.result?.isError).toBeTruthy();
    expect(await loadTransactions(db, userId)).toHaveLength(before);
  });

  it("what capture tokens list carries no balances or history", async () => {
    const text = JSON.stringify(await listCaptureOptions(db, userId));
    expect(text).not.toMatch(/balance|amount|saldo|opening/i);
    const account = (await listCaptureOptions(db, userId)).accounts[0]!;
    expect(Object.keys(account).sort()).toEqual(["id", "name", "type"]);
  });

  it("tokens default to read and carry their scope", async () => {
    const { userId: user } = await fresh();
    const read = await createMcpToken(db, user, "leitura");
    const capture = await createMcpToken(db, user, "whatsapp", undefined, "capture");
    expect((await resolveMcpToken(db, read.token))?.scope).toBe("read");
    expect((await resolveMcpToken(db, capture.token))?.scope).toBe("capture");
  });

  it("stops after the hourly limit", async () => {
    const { userId: user } = await fresh();
    let last: unknown;
    for (let i = 0; i < 31; i++) last = await mcp(user, "capture", "tools/call", { name: "undo_last_transaction", arguments: {} });
    expect(JSON.stringify(last)).toContain("Muitos lançamentos");
  }, 30_000);
});
