// User and session persistence, independent of Next.js (testable).
import { and, count, eq, gt, inArray, isNull, lt, or, sql } from "drizzle-orm";
import { z } from "zod";
import type { DB } from "@/db/connection";
import * as s from "@/db/schema";
import { newId } from "../ids";
import { audit } from "../audit";
import { decryptSecret, hashPassword, needsRehash, randomToken, sha256Hex, verifyPassword } from "./crypto";
import { verifyTotp } from "./totp";
import { ensureDefaultCategories, seedDemoData } from "../demo/seed";
import type { LoginContext } from "./login-context";
import { todayInSaoPaulo } from "../dates";

export const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

const COMMON_PASSWORDS = new Set(["1234567890", "12345678910", "0123456789", "1234567891", "senha12345", "senha123456", "password123", "qwertyuiop", "abcdefghij", "1q2w3e4r5t", "tostao1234", "cruzado1234"]);
const weakPassword = (p: string) => COMMON_PASSWORDS.has(p.toLowerCase()) || /^\d+$/.test(p) || new Set(p).size < 4;

export const NewPassword = z
  .string()
  .min(10, "A senha precisa ter pelo menos 10 caracteres.")
  .max(200)
  .refine((p) => !weakPassword(p), "Essa senha é fácil demais de adivinhar. Misture letras e números.");

export const SignupInput = z.object({
  name: z.string().trim().min(2, "Informe seu nome.").max(80),
  email: z.string().trim().toLowerCase().email("E-mail inválido.").max(200),
  password: NewPassword,
});

export const LoginInput = z.object({
  email: z.string().trim().toLowerCase().email("E-mail inválido."),
  password: z.string().min(1, "Informe a senha.").max(200),
  code: z.string().max(10).optional(),
});

export const totpContext = (userId: string) => `totp|${userId}`;

export class EmailTakenError extends Error {
  constructor() {
    super("Já existe uma conta com este e-mail.");
  }
}

export async function createUser(db: DB, input: z.infer<typeof SignupInput>, opts: { isDemo?: boolean } = {}) {
  const [existing] = await db.select({ id: s.users.id }).from(s.users).where(eq(s.users.email, input.email));
  if (existing) throw new EmailTakenError();
  const id = newId();
  // A double submit can pass the check above; the unique constraint settles the race.
  const inserted = await db
    .insert(s.users)
    // Demo accounts never log in with a password; skipping scrypt keeps the public button cheap.
    .values({ id, email: input.email, name: input.name, passwordHash: opts.isDemo ? "demo$sem-senha" : await hashPassword(input.password), isDemo: opts.isDemo ?? false })
    .onConflictDoNothing({ target: s.users.email })
    .returning({ id: s.users.id });
  if (!inserted.length) throw new EmailTakenError();
  await ensureDefaultCategories(db, id);
  await audit(db, id, opts.isDemo ? "auth.demo_created" : "auth.signup");
  return id;
}

/** Consumes a code: the stored step only moves forward, also under concurrent logins, so it cannot be replayed. */
export async function consumeTotp(db: DB, user: typeof s.users.$inferSelect, code: string, now: Date = new Date()): Promise<boolean> {
  if (!user.totpSecret) return false;
  const step = verifyTotp(decryptSecret(user.totpSecret, totpContext(user.id)), code, now, user.totpLastStep);
  if (step === null) return false;
  const claimed = await db
    .update(s.users)
    .set({ totpLastStep: step })
    .where(and(eq(s.users.id, user.id), or(isNull(s.users.totpLastStep), lt(s.users.totpLastStep, step))))
    .returning({ id: s.users.id });
  return claimed.length > 0;
}

/**
 * Fresh proof before irreversible or credential-issuing actions: the password, and the second factor when one is on.
 * A code is consumed only after the password holds, so wrong passwords cannot burn it.
 */
export async function verifyStepUp(db: DB, user: typeof s.users.$inferSelect, password: string, code: string, opts: { secondFactor?: boolean } = {}): Promise<boolean> {
  if (!(await verifyPassword(password, user.passwordHash))) return false;
  return opts.secondFactor === false || !user.totpEnabledAt || consumeTotp(db, user, code);
}

async function checkSecondFactor(db: DB, user: typeof s.users.$inferSelect, code: string): Promise<boolean> {
  return user.totpEnabledAt ? consumeTotp(db, user, code) : true;
}

/** New password: every session and MCP token dies, so whoever had the old one is out. */
export async function changePassword(db: DB, userId: string, password: string) {
  const passwordHash = await hashPassword(password);
  await db.transaction(async (tx) => {
    await tx.update(s.users).set({ passwordHash }).where(eq(s.users.id, userId));
    await tx.delete(s.sessions).where(eq(s.sessions.userId, userId));
    await tx.update(s.mcpTokens).set({ revokedAt: new Date() }).where(and(eq(s.mcpTokens.userId, userId), isNull(s.mcpTokens.revokedAt)));
  });
  await audit(db, userId, "auth.password_changed");
}

export async function endAllSessions(db: DB, userId: string) {
  await db.delete(s.sessions).where(eq(s.sessions.userId, userId));
  await audit(db, userId, "auth.sessions_ended");
}

/** Returns the raw token for the cookie; only its SHA-256 is stored. */
export async function createSession(db: DB, userId: string): Promise<{ token: string; expiresAt: Date }> {
  const token = randomToken();
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS);
  await db.insert(s.sessions).values({ id: sha256Hex(token), userId, expiresAt });
  await db.delete(s.sessions).where(and(eq(s.sessions.userId, userId), lt(s.sessions.expiresAt, new Date())));
  return { token, expiresAt };
}

export async function userForSessionToken(db: DB, token: string) {
  const [row] = await db
    .select({ user: s.users, expiresAt: s.sessions.expiresAt })
    .from(s.sessions)
    .innerJoin(s.users, eq(s.sessions.userId, s.users.id))
    .where(and(eq(s.sessions.id, sha256Hex(token)), gt(s.sessions.expiresAt, new Date())));
  return row?.user ?? null;
}

export async function deleteSession(db: DB, token: string) {
  await db.delete(s.sessions).where(eq(s.sessions.id, sha256Hex(token)));
}

export async function createDemoUser(db: DB, now: Date = new Date()) {
  const suffix = randomToken(6).toLowerCase().replace(/[^a-z0-9]/g, "x");
  const id = await createUser(db, { name: "Ana Exemplo", email: `demo-${suffix}@demo.cruzado.local`, password: randomToken(24) }, { isDemo: true });
  await seedDemoData(db, id, todayInSaoPaulo(now), now);
  return id;
}

/** Removes demo accounts older than `ttlMs`, in batches, so a public instance does not grow forever. */
export async function purgeExpiredDemos(db: DB, now: Date = new Date(), ttlMs = 48 * 60 * 60 * 1000): Promise<number> {
  const rows = await db
    .select({ id: s.users.id })
    .from(s.users)
    .where(and(eq(s.users.isDemo, true), lt(s.users.createdAt, new Date(now.getTime() - ttlMs))))
    .limit(500);
  const ids = rows.map((r) => r.id);
  if (!ids.length) return 0;
  await db.transaction(async (tx) => {
    await tx.update(s.auditEvents).set({ userId: null }).where(inArray(s.auditEvents.userId, ids));
    await tx.delete(s.users).where(inArray(s.users.id, ids));
  });
  return ids.length;
}

/** Deletes the user and every row they own (FK cascades); audit trail is kept but anonymized. */
export async function deleteUserData(db: DB, userId: string) {
  await db.transaction(async (tx) => {
    await tx.update(s.auditEvents).set({ userId: null }).where(eq(s.auditEvents.userId, userId));
    await tx.delete(s.users).where(eq(s.users.id, userId));
  });
  await audit(db, null, "user.deleted");
}

export type SignIn = { status: "ok"; userId: string } | { status: "code-required" } | { status: "wrong-code" } | { status: "invalid" };

/**
 * Login in steps: e-mail and password first, and the two-step code only for an account that has it on. Asking for the
 * code tells whoever typed the password that it was right, the same trade-off most sites make; the login and
 * per-account rate limits (actions/auth.ts) still cap how many passwords anyone can try.
 */
export async function signIn(db: DB, input: z.infer<typeof LoginInput>, from: LoginContext | null = null): Promise<SignIn> {
  // Device kind and truncated network (auth/login-context.ts), never the full IP or the raw user agent.
  const where: Record<string, string | null> = from ? { device: from.device, network: from.network } : {};
  const [user] = await db.select().from(s.users).where(eq(s.users.email, input.email));
  // Hash even when the user does not exist to keep timing similar.
  const ok = user ? await verifyPassword(input.password, user.passwordHash) : (await hashPassword(input.password), false);
  if (!user || !ok) {
    await audit(db, user?.id ?? null, "auth.login_failed", where);
    return { status: "invalid" };
  }
  if (user.totpEnabledAt) {
    if (!input.code) {
      await audit(db, user.id, "auth.login_code_requested", where);
      return { status: "code-required" };
    }
    if (!(await consumeTotp(db, user, input.code))) {
      await audit(db, user.id, "auth.login_failed", { step: "code", ...where });
      await warnOnCodeFailures(db, user.id);
      return { status: "wrong-code" };
    }
  }
  if (needsRehash(user.passwordHash)) {
    await db.update(s.users).set({ passwordHash: await hashPassword(input.password) }).where(eq(s.users.id, user.id));
  }
  await audit(db, user.id, "auth.login", where);
  return { status: "ok", userId: user.id };
}

const CODE_FAILURES = 3;
const CODE_WINDOW_MS = 15 * 60_000;

/**
 * Wrong codes after a right password mean someone else has the password. From the third one in 15 minutes, the owner
 * gets one notification per hour in the app, and the event is audited. (WhatsApp would need a template approved by
 * Meta to start a conversation; see docs/WHATSAPP.md.)
 */
async function warnOnCodeFailures(db: DB, userId: string, now: Date = new Date()) {
  const [{ n } = { n: 0 }] = await db
    .select({ n: count() })
    .from(s.auditEvents)
    .where(
      and(
        eq(s.auditEvents.userId, userId),
        eq(s.auditEvents.action, "auth.login_failed"),
        sql`${s.auditEvents.meta}->>'step' = 'code'`,
        gt(s.auditEvents.createdAt, new Date(now.getTime() - CODE_WINDOW_MS)),
      ),
    );
  if (n < CODE_FAILURES) return;
  const hour = now.toISOString().slice(0, 13);
  const created = await db
    .insert(s.notifications)
    .values({
      id: newId(),
      userId,
      kind: "system",
      severity: "risk",
      title: "Alguém acertou a sua senha e errou o código",
      body: `Houve ${n} tentativas de entrar na sua conta com a senha certa e o código de verificação errado nos últimos 15 minutos. Se não foi você, troque a senha agora: a verificação em duas etapas segurou a entrada, mas a senha pode ter vazado.`,
      links: [{ label: "Trocar a senha", href: "/configuracoes?aba=seguranca" }],
      dedupeKey: `security:code-failures:${hour}`,
    })
    .onConflictDoNothing()
    .returning({ id: s.notifications.id });
  if (created.length) await audit(db, userId, "auth.code_failures_alert", { failures: n });
}
