"use server";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import type { z } from "zod";
import { getDb } from "@/db/client";
import { demoOpen, signupOpen } from "@/lib/auth/access";
import { sha256Hex } from "@/lib/auth/crypto";
import { blockInDemoInstance, endSession, startSession } from "@/lib/auth/session";
import { EmailTakenError, LoginInput, SignupInput, authenticate, createDemoUser, createUser } from "@/lib/auth/users";
import { errorSummary } from "@/lib/log";
import { clientIp, rateLimitShared } from "@/lib/rate-limit";

export type FormState = { error?: string; fieldErrors?: Record<string, string>; ok?: boolean; message?: string; values?: Record<string, string> };

export async function fieldErrors(err: z.ZodError): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  for (const i of err.issues) out[String(i.path[0])] ??= i.message;
  return out;
}

async function clientKey() {
  return clientIp(await headers());
}

export async function loginAction(_: FormState, form: FormData): Promise<FormState> {
  await blockInDemoInstance();
  const values = { email: String(form.get("email") ?? "") };
  const db = await getDb();
  if (!(await rateLimitShared(db, "auth", await clientKey())).ok) return { error: "Muitas tentativas. Aguarde alguns minutos.", values };
  const parsed = LoginInput.safeParse({ email: form.get("email"), password: form.get("password"), code: form.get("code") ?? undefined });
  if (!parsed.success) return { fieldErrors: await fieldErrors(parsed.error), values };
  // Per-account ceiling so rotating IPs does not give unlimited guesses. Hashed: this table keeps no e-mails.
  if (!(await rateLimitShared(db, "authEmail", sha256Hex(parsed.data.email))).ok) return { error: "Muitas tentativas. Aguarde alguns minutos.", values };
  const userId = await authenticate(db, parsed.data);
  if (!userId) return { error: "E-mail, senha ou código incorretos.", values };
  await startSession(userId);
  redirect("/inicio");
}

export async function signupAction(_: FormState, form: FormData): Promise<FormState> {
  await blockInDemoInstance();
  const values = { name: String(form.get("name") ?? ""), email: String(form.get("email") ?? ""), terms: String(form.get("terms") ?? "") };
  if (!signupOpen()) return { error: "Esta instância não aceita novos cadastros.", values };
  const db = await getDb();
  if (!(await rateLimitShared(db, "auth", await clientKey())).ok) return { error: "Muitas tentativas. Aguarde alguns minutos.", values };
  const parsed = SignupInput.safeParse({ name: form.get("name"), email: form.get("email"), password: form.get("password") });
  if (!parsed.success) return { fieldErrors: await fieldErrors(parsed.error), values };
  if (form.get("terms") !== "on") return { fieldErrors: { terms: "É preciso aceitar os termos (rascunho) e a política de privacidade." }, values };
  let userId: string;
  try {
    userId = await createUser(db, parsed.data);
  } catch (e) {
    if (e instanceof EmailTakenError) return { fieldErrors: { email: e.message }, values };
    console.error("[signup]", errorSummary(e));
    return { error: "Não foi possível criar a conta. Tente novamente.", values };
  }
  await startSession(userId);
  redirect("/comecar");
}

export async function demoAction(): Promise<void> {
  await blockInDemoInstance();
  if (!demoOpen()) redirect("/entrar");
  const db = await getDb();
  const perIp = await rateLimitShared(db, "auth", `demo:${await clientKey()}`);
  if (!perIp.ok || !(await rateLimitShared(db, "demoGlobal", "all")).ok) redirect("/entrar?erro=limite");
  const userId = await createDemoUser(db);
  await startSession(userId);
  redirect("/inicio");
}

export async function logoutAction(): Promise<void> {
  await blockInDemoInstance();
  await endSession();
  redirect("/entrar");
}
