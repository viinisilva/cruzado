// Login in steps (src/lib/auth/users.ts, signIn): e-mail and password first, the two-step code only for accounts that
// have it on. The first step never tells an unknown e-mail from a wrong password, by message or by time; repeated wrong
// codes after a right password mean the password leaked, so the owner is told in the app.
import { and, eq } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import * as s from "@/db/schema";
import { encryptSecret } from "@/lib/auth/crypto";
import { generateTotpSecret, totpCode } from "@/lib/auth/totp";
import { createUser, signIn, totpContext } from "@/lib/auth/users";
import { testDb } from "../support/db";

process.env.APP_ENCRYPTION_KEY = Buffer.alloc(32, 9).toString("base64");

let db: Awaited<ReturnType<typeof testDb>>;
beforeAll(async () => {
  db = await testDb();
});

const password = "senha-de-teste-123";
let seq = 0;
async function newUser(twoStep = false) {
  const email = `etapas${++seq}@exemplo.test`;
  const id = await createUser(db, { name: "Teste", email, password });
  let secret = "";
  if (twoStep) {
    secret = generateTotpSecret();
    await db.update(s.users).set({ totpSecret: encryptSecret(secret, totpContext(id)), totpEnabledAt: new Date() }).where(eq(s.users.id, id));
  }
  return { id, email, secret };
}
const actions = async (userId: string) => (await db.select().from(s.auditEvents).where(eq(s.auditEvents.userId, userId))).map((e) => e.action);
const median = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)]!;
async function timed(fn: () => Promise<unknown>) {
  const t = performance.now();
  await fn();
  return performance.now() - t;
}

describe("signIn, first step", () => {
  it("answers an unknown e-mail exactly like a wrong password, and in about the same time", async () => {
    const { email } = await newUser();
    expect(await signIn(db, { email: "ninguem@exemplo.test", password })).toEqual({ status: "invalid" });
    expect(await signIn(db, { email, password: "outra-senha-qualquer" })).toEqual({ status: "invalid" });
    const unknown: number[] = [];
    const wrong: number[] = [];
    for (let i = 0; i < 3; i++) {
      unknown.push(await timed(() => signIn(db, { email: "ninguem@exemplo.test", password })));
      wrong.push(await timed(() => signIn(db, { email, password: "outra-senha-qualquer" })));
    }
    // Both pay for one scrypt hash, which is most of the time; a missing account must not answer much faster.
    const ratio = median(unknown) / median(wrong);
    expect(ratio).toBeGreaterThan(0.5);
    expect(ratio).toBeLessThan(2);
  }, 60_000);

  it("lets an account without two steps in with e-mail and password", async () => {
    const { id, email } = await newUser();
    expect(await signIn(db, { email, password })).toEqual({ status: "ok", userId: id });
  }, 20_000);
});

describe("signIn, second step", () => {
  it("asks for the code only after the right password, and takes a right code once", async () => {
    const { id, email, secret } = await newUser(true);
    expect(await signIn(db, { email, password: "outra-senha-qualquer" })).toEqual({ status: "invalid" });
    expect(await signIn(db, { email, password })).toEqual({ status: "code-required" });
    expect(await signIn(db, { email, password, code: "000000" })).toEqual({ status: "wrong-code" });
    const code = totpCode(secret, Math.floor(Date.now() / 30_000));
    expect(await signIn(db, { email, password, code })).toEqual({ status: "ok", userId: id });
    // A used code cannot be replayed.
    expect(await signIn(db, { email, password, code })).toEqual({ status: "wrong-code" });
    expect(await actions(id)).toEqual(expect.arrayContaining(["auth.login_code_requested", "auth.login_failed", "auth.login"]));
  }, 30_000);

  it("after 3 wrong codes with the right password, records it and notifies the owner once", async () => {
    const { id, email } = await newUser(true);
    for (let i = 0; i < 2; i++) await signIn(db, { email, password, code: "000000" });
    const notices = () => db.select().from(s.notifications).where(and(eq(s.notifications.userId, id), eq(s.notifications.kind, "system")));
    expect(await notices()).toHaveLength(0);

    await signIn(db, { email, password, code: "111111" });
    const [notice] = await notices();
    expect(notice).toMatchObject({ severity: "risk", title: "Alguém acertou a sua senha e errou o código" });
    expect(notice!.body).toMatch(/troque a senha/i);
    expect(notice!.links).toEqual([{ label: "Trocar a senha", href: "/configuracoes?aba=seguranca" }]);
    expect(await actions(id)).toContain("auth.code_failures_alert");

    // More wrong codes in the same window do not pile up notices.
    await signIn(db, { email, password, code: "222222" });
    expect(await notices()).toHaveLength(1);
  }, 60_000);

  it("does not count wrong passwords toward the leaked-password alert", async () => {
    const { id, email } = await newUser(true);
    for (let i = 0; i < 4; i++) await signIn(db, { email, password: "outra-senha-qualquer", code: "000000" });
    expect(await db.select().from(s.notifications).where(eq(s.notifications.userId, id))).toHaveLength(0);
  }, 60_000);
});

describe("where a sign-in came from", () => {
  it("the login audit keeps the device kind and the truncated network, never the full IP or user agent", async () => {
    const { id, email } = await newUser();
    const ctx = { device: "celular · Chrome · Android", network: "189.45.0.0/16" };
    await signIn(db, { email, password: "outra-senha-qualquer" }, ctx);
    await signIn(db, { email, password }, ctx);
    const rows = await db.select().from(s.auditEvents).where(eq(s.auditEvents.userId, id));
    const metas = rows.filter((r) => r.action === "auth.login" || r.action === "auth.login_failed").map((r) => r.meta);
    expect(metas).toHaveLength(2);
    for (const meta of metas) expect(meta).toEqual(expect.objectContaining(ctx));
    expect(JSON.stringify(rows)).not.toMatch(/189\.45\.\d+\.\d+(?!\/)|Mozilla/);
  });
});
