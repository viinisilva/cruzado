// Behavior a serverless deployment depends on.
import { eq } from "drizzle-orm";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { runMigrations } from "@/db/migrate";
import * as s from "@/db/schema";
import { EmailTakenError, createDemoUser, createUser, purgeExpiredDemos } from "@/lib/auth/users";
import { runAgent } from "@/lib/agents/service";
import { commitImport } from "@/lib/importer";
import { purgeExpired } from "@/lib/maintenance";
import { rateLimitShared } from "@/lib/rate-limit";
import { GET } from "@/app/api/cron/agents/route";
import { NOW, seededUser, testDb } from "../support/db";

let db: Awaited<ReturnType<typeof testDb>>;
beforeAll(async () => {
  db = await testDb();
  vi.doMock("@/db/client", () => ({ getDb: async () => db }));
});

describe("migrations", () => {
  it("is idempotent and safe to run concurrently", async () => {
    const fresh = await testDb();
    const results = await Promise.all([runMigrations(fresh), runMigrations(fresh)]);
    expect(results.flat()).toEqual([]);
  });
});

describe("shared rate limit", () => {
  it("counts across calls and reopens after the window", async () => {
    const t0 = new Date("2026-01-01T00:00:00Z");
    for (let i = 0; i < 10; i++) expect((await rateLimitShared(db, "auth", "1.2.3.4", t0)).ok).toBe(true);
    const blocked = await rateLimitShared(db, "auth", "1.2.3.4", t0);
    expect(blocked).toEqual({ ok: false, retryAfterSec: 600 });
    expect((await rateLimitShared(db, "auth", "1.2.3.4", new Date("2026-01-01T00:11:00Z"))).ok).toBe(true);
  });
});

describe("signup", () => {
  it("settles a double submit with a clean error, never a raw SQL message", async () => {
    const input = { name: "Bia", email: "bia@exemplo.test", password: "senha-de-teste-123" };
    const results = await Promise.allSettled([createUser(db, input), createUser(db, input)]);
    const rejected = results.filter((r) => r.status === "rejected");
    expect(rejected).toHaveLength(1);
    expect((rejected[0] as PromiseRejectedResult).reason).toBeInstanceOf(EmailTakenError);
  });
});

describe("agents on leap day", () => {
  it("runs on 29/02", async () => {
    const { userId } = await seededUser(db, "bissexto@exemplo.test");
    const [rule] = await db.select().from(s.agentRules).where(eq(s.agentRules.userId, userId));
    await expect(runAgent(db, rule!, new Date("2028-02-29T15:00:00Z"))).resolves.toBeDefined();
  });
});

describe("import", () => {
  it("handles a large statement in batches and re-imports idempotently", async () => {
    const { userId } = await seededUser(db, "grande@exemplo.test");
    const [account] = await db.select().from(s.accounts).where(eq(s.accounts.userId, userId));
    const lines = Array.from({ length: 1200 }, (_, i) => `2025-10-01;Compra loja ${i};-1,00`).join("\n");
    const req = { format: "csv" as const, fileName: "x.csv", content: `Data;Descrição;Valor\n${lines}\n`, accountId: account!.id };
    expect((await commitImport(db, userId, req, NOW)).imported).toBe(1200);
    expect((await commitImport(db, userId, req, NOW)).imported).toBe(0);
  });

  it("refuses statements in another currency", async () => {
    const { userId } = await seededUser(db, "dolar@exemplo.test");
    const [account] = await db.select().from(s.accounts).where(eq(s.accounts.userId, userId));
    const content = "<OFX><CURDEF>USD<STMTTRN><DTPOSTED>20251001<TRNAMT>-1.00<FITID>1</STMTTRN></OFX>";
    await expect(commitImport(db, userId, { format: "ofx", fileName: "x.ofx", content, accountId: account!.id }, NOW)).rejects.toThrow(/BRL/);
  });
});

describe("housekeeping", () => {
  it("removes only expired demo accounts", async () => {
    const demo = await createDemoUser(db, NOW);
    const later = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000);
    expect(await purgeExpiredDemos(db, new Date())).toBe(0);
    await purgeExpired(db, later);
    expect(await db.select().from(s.users).where(eq(s.users.id, demo))).toEqual([]);
  });
});

describe("cron endpoint", () => {
  it("rejects calls without the secret, and fails closed when none is configured", async () => {
    delete process.env.CRON_SECRET;
    expect((await GET(new Request("http://x/api/cron/agents", { headers: { authorization: "Bearer undefined" } }))).status).toBe(401);
    process.env.CRON_SECRET = "segredo";
    expect((await GET(new Request("http://x/api/cron/agents"))).status).toBe(401);
    expect((await GET(new Request("http://x/api/cron/agents", { headers: { authorization: "Bearer errado" } }))).status).toBe(401);
    delete process.env.CRON_SECRET;
  });
});
