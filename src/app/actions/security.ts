"use server";
import { and, eq, isNull } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { getDb } from "@/db/client";
import * as s from "@/db/schema";
import { encryptSecret } from "@/lib/auth/crypto";
import { reauthenticate } from "@/lib/auth/reauth";
import { startSession, requireWriter } from "@/lib/auth/session";
import { generateTotpSecret, otpauthUrl } from "@/lib/auth/totp";
import { NewPassword, changePassword, consumeTotp, endAllSessions, totpContext } from "@/lib/auth/users";
import { audit } from "@/lib/audit";
import { fieldErrors, type FormState } from "./auth";

export async function changePasswordAction(_: FormState, form: FormData): Promise<FormState> {
  const user = await requireWriter();
  const denied = await reauthenticate(user, form);
  if (denied) return { fieldErrors: { password: denied } };
  const parsed = NewPassword.safeParse(form.get("newPassword"));
  if (!parsed.success) return { fieldErrors: { newPassword: (await fieldErrors(parsed.error))["undefined"] ?? "Senha inválida." } };
  const db = await getDb();
  await changePassword(db, user.id, parsed.data);
  await startSession(user.id);
  revalidatePath("/configuracoes");
  return { ok: true, message: "Senha trocada. Todas as outras sessões foram encerradas e os tokens MCP, revogados." };
}

export async function endSessionsAction(): Promise<void> {
  const user = await requireWriter();
  await endAllSessions(await getDb(), user.id);
  await startSession(user.id);
  revalidatePath("/configuracoes");
}

/** First step: stores the secret, still inactive, and shows it once to be added to the authenticator app. */
export async function startTotpAction(_: FormState, form: FormData): Promise<FormState> {
  const user = await requireWriter();
  if (user.isDemo) return { error: "Indisponível no modo demonstração." };
  if (user.totpEnabledAt) return { error: "A verificação em duas etapas já está ativa." };
  const denied = await reauthenticate(user, form);
  if (denied) return { fieldErrors: { password: denied } };
  const secret = generateTotpSecret();
  await (await getDb())
    .update(s.users)
    .set({ totpSecret: encryptSecret(secret, totpContext(user.id)), totpLastStep: null })
    // Conditional: a parallel request must never replace the secret of an already active 2FA.
    .where(and(eq(s.users.id, user.id), isNull(s.users.totpEnabledAt)));
  revalidatePath("/configuracoes");
  return { ok: true, message: secret, values: { url: otpauthUrl(secret, user.email) } };
}

/** Second step: only a valid code activates it, so nobody locks themselves out with a mistyped key. */
export async function confirmTotpAction(_: FormState, form: FormData): Promise<FormState> {
  const user = await requireWriter();
  const db = await getDb();
  if (!(await consumeTotp(db, user, String(form.get("code") ?? "")))) return { fieldErrors: { code: "Código incorreto. Confira o relógio do celular e tente de novo." } };
  // Activates only the secret this code was checked against, not one swapped in meanwhile.
  const activated = await db
    .update(s.users)
    .set({ totpEnabledAt: new Date() })
    .where(and(eq(s.users.id, user.id), eq(s.users.totpSecret, user.totpSecret ?? ""), isNull(s.users.totpEnabledAt)))
    .returning({ id: s.users.id });
  if (!activated.length) return { error: "A configuração mudou. Recomece a ativação." };
  await audit(db, user.id, "auth.totp_enabled");
  // A session opened before this change was never checked by the new factor.
  await endAllSessions(db, user.id);
  await startSession(user.id);
  revalidatePath("/configuracoes");
  return { ok: true, message: "Verificação em duas etapas ativada." };
}

export async function disableTotpAction(_: FormState, form: FormData): Promise<FormState> {
  const user = await requireWriter();
  // The code is checked below, with its own message.
  const denied = await reauthenticate(user, form, { secondFactor: false });
  if (denied) return { fieldErrors: { password: denied } };
  const db = await getDb();
  if (!(await consumeTotp(db, user, String(form.get("code") ?? "")))) return { fieldErrors: { code: "Código incorreto." } };
  await db.update(s.users).set({ totpSecret: null, totpEnabledAt: null, totpLastStep: null }).where(eq(s.users.id, user.id));
  await audit(db, user.id, "auth.totp_disabled");
  await endAllSessions(db, user.id);
  await startSession(user.id);
  revalidatePath("/configuracoes");
  return { ok: true, message: "Verificação em duas etapas desativada." };
}
