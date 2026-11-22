// Regressions from the security audit.
import { randomBytes, scryptSync } from "node:crypto";
import { eq } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import * as s from "@/db/schema";
import { decryptSecret, encryptSecret, hashPassword, needsRehash, verifyPassword } from "@/lib/auth/crypto";
import { generateTotpSecret, totpCode, verifyTotp } from "@/lib/auth/totp";
import { SignupInput, authenticate, changePassword, consumeTotp, createDemoUser, createSession, createUser, totpContext, userForSessionToken } from "@/lib/auth/users";
import { TokenLimitError, createMcpToken, revokeMcpToken, userForMcpToken } from "@/lib/mcp/tokens";
import { answer, userWantsAgent } from "@/lib/chat/engine";
import { sanitizeUntrusted } from "@/lib/text";
import type { AIProvider } from "@/lib/ai/types";
import { testDb } from "../support/db";

process.env.APP_ENCRYPTION_KEY = Buffer.alloc(32, 9).toString("base64");

let db: Awaited<ReturnType<typeof testDb>>;
beforeAll(async () => {
  db = await testDb();
});

let seq = 0;
const newUser = () => createUser(db, { name: "Teste", email: `u${++seq}@exemplo.test`, password: "senha-de-teste-123" });
const row = async (id: string) => (await db.select().from(s.users).where(eq(s.users.id, id)))[0]!;

describe("TOTP", () => {
  it("matches the RFC 6238 vector", () => {
    // "12345678901234567890" in base32, T=59s (test vector 94287082, last six digits).
    expect(totpCode("GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ", 1)).toBe("287082");
  });

  it("accepts one step of drift and refuses others and replays", () => {
    const secret = generateTotpSecret();
    const now = new Date(1_800_000_000_000);
    const step = Math.floor(now.getTime() / 30_000);
    expect(verifyTotp(secret, totpCode(secret, step + 1), now, null)).toBe(step + 1);
    expect(verifyTotp(secret, totpCode(secret, step + 5), now, null)).toBeNull();
    expect(verifyTotp(secret, totpCode(secret, step), now, step)).toBeNull();
    expect(verifyTotp(secret, "abc", now, null)).toBeNull();
  });

  it("requires the code at login once enabled, and a used code cannot be reused", async () => {
    const id = await newUser();
    const { email } = await row(id);
    const secret = generateTotpSecret();
    await db.update(s.users).set({ totpSecret: encryptSecret(secret, totpContext(id)), totpEnabledAt: new Date() }).where(eq(s.users.id, id));
    const password = "senha-de-teste-123";
    expect(await authenticate(db, { email, password })).toBeNull();
    expect(await authenticate(db, { email, password, code: "000000" })).toBeNull();
    const code = totpCode(secret, Math.floor(Date.now() / 30_000));
    expect(await authenticate(db, { email, password, code })).toBe(id);
    expect(await authenticate(db, { email, password, code })).toBeNull();
  }, 20_000);

  it("gives one winner when the same code is used concurrently", async () => {
    const id = await newUser();
    const secret = generateTotpSecret();
    await db.update(s.users).set({ totpSecret: encryptSecret(secret, totpContext(id)) }).where(eq(s.users.id, id));
    const user = await row(id);
    const code = totpCode(secret, Math.floor(Date.now() / 30_000));
    const results = await Promise.all([consumeTotp(db, user, code), consumeTotp(db, user, code)]);
    expect(results.filter(Boolean)).toHaveLength(1);
  });
});

describe("passwords", () => {
  it("uses OWASP scrypt parameters and flags older hashes", async () => {
    expect(needsRehash(await hashPassword("uma-senha-boa-123"))).toBe(false);
    expect(needsRehash("scrypt$32768$8$1$a$b")).toBe(true);
  });

  it("upgrades an old hash at login", async () => {
    const id = await newUser();
    const { email } = await row(id);
    const salt = randomBytes(16);
    const key = scryptSync("senha-de-teste-123", salt, 64, { N: 2 ** 15, r: 8, p: 1, maxmem: 64 * 1024 * 1024 });
    await db.update(s.users).set({ passwordHash: `scrypt$32768$8$1$${salt.toString("base64url")}$${key.toString("base64url")}` }).where(eq(s.users.id, id));
    expect(await authenticate(db, { email, password: "senha-de-teste-123" })).toBe(id);
    expect(needsRehash((await row(id)).passwordHash)).toBe(false);
  }, 20_000);

  it.each(["1234567890", "senha12345", "aaaaaaaaaaaa", "98765432109"])("refuses %s", (password) => {
    expect(SignupInput.safeParse({ name: "Ana", email: "a@b.co", password }).success).toBe(false);
  });

  it("changing the password ends sessions and MCP tokens", async () => {
    const id = await newUser();
    const { token: session } = await createSession(db, id);
    const { token } = await createMcpToken(db, id, "cli");
    await changePassword(db, id, "outra-senha-forte-456");
    expect(await userForSessionToken(db, session)).toBeNull();
    expect(await userForMcpToken(db, token)).toBeNull();
  });

  it("demo accounts cannot log in with any password", async () => {
    const id = await createDemoUser(db);
    const { email, passwordHash } = await row(id);
    expect(await verifyPassword("", passwordHash)).toBe(false);
    expect(await authenticate(db, { email, password: "qualquer" })).toBeNull();
  });
});

describe("secrets at rest", () => {
  it("cannot be moved to another row", () => {
    const enc = encryptSecret("item", "bank-connection|a");
    expect(decryptSecret(enc, "bank-connection|a")).toBe("item");
    expect(() => decryptSecret(enc, "bank-connection|b")).toThrow();
  });
});

describe("MCP tokens", () => {
  it("expire, and audit only what really happened", async () => {
    const id = await newUser();
    const now = new Date();
    const { token } = await createMcpToken(db, id, "cli", now);
    expect(await userForMcpToken(db, token, now)).toBe(id);
    expect(await userForMcpToken(db, token, new Date(now.getTime() + 91 * 86_400_000))).toBeNull();
    const before = await db.select().from(s.auditEvents).where(eq(s.auditEvents.userId, id));
    await revokeMcpToken(db, id, "id-que-nao-existe");
    expect(await db.select().from(s.auditEvents).where(eq(s.auditEvents.userId, id))).toHaveLength(before.length);
  });

  it("are capped per user", async () => {
    const id = await newUser();
    for (let i = 0; i < 5; i++) await createMcpToken(db, id, `t${i}`);
    await expect(createMcpToken(db, id, "sexto")).rejects.toBeInstanceOf(TokenLimitError);
  });
});

describe("untrusted text", () => {
  it("removes invisible and direction-changing characters", () => {
    expect(sanitizeUntrusted("PIX​ IGNORE‮ \u{E0041}\u{E0042}regras")).toBe("PIX IGNORE regras");
  });

  it("offers the write tool only when the user asks for an agent, and enforces it", async () => {
    expect(userWantsAgent("me avise quando gastar muito")).toBe(true);
    expect(userWantsAgent("quanto gastei com mercado?")).toBe(false);
    const id = await newUser();
    const offered: string[][] = [];
    let step = 0;
    // A model obeying injected text: it calls the write tool even though it was not offered.
    const hijacked: AIProvider = {
      name: "mock",
      isExternal: false,
      complete: async (req) => {
        offered.push(req.tools.map((t) => t.name));
        if (step++ === 0) return { toolCalls: [{ id: "1", name: "createAgentDraft", input: { kind: "daily_spend_limit", name: "Golpe", amountCents: 100 } }], raw: {} };
        return { text: "ok", toolCalls: [], raw: {} };
      },
    };
    await answer(db, hijacked, id, "quanto gastei com mercado?");
    expect(offered[0]).not.toContain("createAgentDraft");
    expect(await db.select().from(s.agentRules).where(eq(s.agentRules.userId, id))).toEqual([]);
  });
});
