// Public demonstration instance (docs/USO_COMPARTILHADO.md, etapa 1): in-memory database, fictitious data, read-only.
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { count, eq, sql } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import * as s from "@/db/schema";
import { bootDemoDatabase, DEMO_USER_ID, answerReadOnly } from "@/lib/demo/instance";
import { loadCards, loadCategories, loadTransactions } from "@/lib/data/repo";
import { cardStatements } from "@/lib/finance/cards";
import { MockProvider } from "@/lib/ai/mock";

const NOW = new Date("2026-11-21T15:00:00Z");
const TODAY = "2026-11-21";

describe("bootDemoDatabase", () => {
  let boot: Awaited<ReturnType<typeof bootDemoDatabase>>;
  beforeAll(async () => {
    boot = await bootDemoDatabase(NOW);
  }, 120_000);

  it("creates one demo user with accounts, two cards and the bank's bills", async () => {
    const { db } = boot;
    const users = await db.select().from(s.users);
    expect(users).toHaveLength(1);
    expect(users[0]).toMatchObject({ id: DEMO_USER_ID, isDemo: true });
    expect(await db.select().from(s.accounts)).toHaveLength(4);
    expect(await db.select().from(s.creditCards)).toHaveLength(2);
    const [{ n }] = (await db.select({ n: count() }).from(s.cardBills)) as [{ n: number }];
    expect(n).toBeGreaterThanOrEqual(8);
    console.log(`[demo] boot ${boot.ms} ms`);
  });

  it("every closed bill matches the bank's total to the cent, after calibration", async () => {
    const { db } = boot;
    const [cards, categories] = await Promise.all([loadCards(db, DEMO_USER_ID), loadCategories(db, DEMO_USER_ID)]);
    for (const card of cards) {
      expect(card.calibration, card.accountId).toBeTruthy();
      const txs = await loadTransactions(db, DEMO_USER_ID, { accountIds: [card.accountId], includeFuture: true, today: TODAY });
      const closed = cardStatements(card, txs, categories, TODAY, 12).filter((st) => st.bankTotalCents !== null);
      expect(closed.length).toBeGreaterThanOrEqual(4);
      for (const st of closed) expect(st.computedCents, `${card.accountId} ${st.dueDate}`).toBe(st.bankTotalCents);
    }
  });

  it("leaves nothing to review: invented data must already agree with the automatic steps", async () => {
    const pending = await boot.db.select().from(s.reconciliationChanges).where(eq(s.reconciliationChanges.status, "proposed"));
    expect(pending).toEqual([]);
  });

  it("has ready conversations, alerts and recurring charges", async () => {
    const { db } = boot;
    const msgs = await db.select().from(s.messages).where(eq(s.messages.role, "assistant"));
    expect(msgs.length).toBeGreaterThanOrEqual(2);
    expect(msgs.every((m) => m.content.length > 20)).toBe(true);
    expect((await db.select().from(s.notifications)).length).toBeGreaterThan(0);
    expect((await db.select().from(s.recurringTransactions)).length).toBeGreaterThan(0);
  });

  it("answers in the chat without storing anything and without the agent-writing tool", async () => {
    const { db } = boot;
    const categories = await loadCategories(db, DEMO_USER_ID);
    const provider = new MockProvider(() => ({ today: TODAY, categories }));
    const before = await Promise.all([db.select({ n: count() }).from(s.messages), db.select({ n: count() }).from(s.conversations), db.select({ n: count() }).from(s.agentRules)]);
    const reply = await answerReadOnly(db, provider, "Quanto gastei com mercado neste mês?", NOW);
    expect(reply.content).toMatch(/R\$/);
    const agent = await answerReadOnly(db, provider, "Me avise quando eu gastar mais de R$ 100 por dia", NOW);
    expect(agent.evidence.draftAgentId).toBeUndefined();
    const after = await Promise.all([db.select({ n: count() }).from(s.messages), db.select({ n: count() }).from(s.conversations), db.select({ n: count() }).from(s.agentRules)]);
    expect(after).toEqual(before);
  });
});

describe("boot from the build's migrated database (snapshot.ts)", () => {
  it("gives the same demonstration as a fresh start, and the session's demo user is the row in the database", async () => {
    const { buildDemoSnapshot, readDemoSnapshot } = await import("@/lib/demo/snapshot");
    const { demoUser } = await import("@/lib/auth/session");
    const snapshot = await buildDemoSnapshot();
    const fromSnapshot = await bootDemoDatabase(NOW, { snapshot });
    const fresh = await bootDemoDatabase(NOW);
    const counts = async (db: typeof fresh.db) =>
      Promise.all([s.accounts, s.creditCards, s.cardBills, s.transactions, s.notifications, s.messages, s.recurringTransactions].map(async (t) => ((await db.select({ n: count() }).from(t)) as [{ n: number }])[0].n));
    expect(await counts(fromSnapshot.db)).toEqual(await counts(fresh.db));
    expect(await fromSnapshot.db.select().from(s.users)).toEqual([demoUser()]);
    expect(await readDemoSnapshot(path.join(process.cwd(), "nao-existe", "base.tgz"))).toBeUndefined();
    console.log(`[demo] boot ${fromSnapshot.ms} ms com o banco migrado, ${fresh.ms} ms sem`);
  }, 120_000);
});

describe("read-only guard", () => {
  // Every Server Action must pass through requireWriter (or blockInDemoInstance for the login actions), which refuses
  // in the public demo. A new action without it fails here.
  it("covers every exported Server Action", () => {
    const dir = path.resolve(import.meta.dirname, "../../src/app/actions");
    const missing: string[] = [];
    for (const f of readdirSync(dir)) {
      const src = readFileSync(path.join(dir, f), "utf8");
      const guarded = /requireWriter\(|blockInDemoInstance\(/;
      const chunks = src.split(/(?=^(?:export )?async function )/m).slice(1);
      // Private helpers that start with the guard (e.g. agents.ts `act`) count for the actions that call them.
      const helpers = chunks.filter((c) => !c.startsWith("export") && guarded.test(c)).map((c) => /async function (\w+)/.exec(c)![1]!);
      for (const part of chunks.filter((c) => c.startsWith("export"))) {
        const name = /export async function (\w+)/.exec(part)![1]!;
        if (name === "fieldErrors") continue; // helper, not a form action
        if (!guarded.test(part) && !helpers.some((h) => part.includes(`${h}(`))) missing.push(`${f}:${name}`);
      }
    }
    expect(missing).toEqual([]);
  });
});

// Each Vercel instance boots its own copy of the demo. A link made by one instance (a card, an entry, a conversation)
// must open on any other, so two boots on the same day must produce the same ids, whatever the time of day.
describe("bootDemoDatabase ids", () => {
  const idsOf = async (db: Awaited<ReturnType<typeof bootDemoDatabase>>["db"]) => {
    const tables = (await db.execute(sql`select table_name from information_schema.columns where table_schema = 'public' and column_name = 'id' order by table_name`)).rows.map((r) => String((r as { table_name: string }).table_name));
    const out: Record<string, string[]> = {};
    for (const t of tables) out[t] = (await db.execute(sql.raw(`select id::text as id from "${t}" order by id`))).rows.map((r) => String((r as { id: string }).id));
    return out;
  };

  it("are the same in two instances booted on the same day", async () => {
    const morning = await idsOf((await bootDemoDatabase(new Date("2026-11-21T10:05:00Z"))).db);
    const night = await idsOf((await bootDemoDatabase(new Date("2026-11-22T01:40:00Z"))).db);
    expect(morning.accounts!.length).toBe(4);
    expect(morning.transactions!.length).toBeGreaterThan(100);
    expect(night).toEqual(morning);
  }, 240_000);

  it("are valid UUIDs that do not repeat", async () => {
    const { users, ...rest } = await idsOf((await bootDemoDatabase(NOW)).db);
    expect(users).toEqual([DEMO_USER_ID]); // fixed on purpose (instance-env.ts)
    const all = Object.values(rest).flat();
    expect(all.every((id) => /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(id))).toBe(true);
    expect(new Set(all).size).toBe(all.length);
  }, 120_000);
});
