"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getDb } from "@/db/client";
import { publicError } from "@/lib/api";
import { reauthenticate } from "@/lib/auth/reauth";
import { requireWriter } from "@/lib/auth/session";
import { rateLimitShared } from "@/lib/rate-limit";
import { confirmMatch, dismissMatch, undoMatch } from "@/lib/reconcile";
import { confirmLink, createLinkCode, disconnectLink, updateLinkSettings } from "@/lib/whatsapp/link";
import { isOwnerId, OwnerOnlyError } from "@/lib/auth/access";
import type { FormState } from "./auth";

const Settings = z.object({ accountId: z.string().min(1, "Escolha a conta padrão."), mode: z.enum(["auto", "review"]) });
const PATH = "/configuracoes";

export async function createLinkCodeAction(_: FormState): Promise<FormState> {
  const user = await requireWriter();
  if (user.isDemo) return { error: "Indisponível no modo demonstração." };
  if (!isOwnerId(user.id)) return { error: new OwnerOnlyError().message };
  const db = await getDb();
  if (!(await rateLimitShared(db, "sync", `wa-code:${user.id}`)).ok) return { error: "Muitas tentativas. Aguarde um minuto." };
  const { code } = await createLinkCode(db, user.id);
  return { ok: true, message: code };
}

export async function confirmLinkAction(_: FormState, form: FormData): Promise<FormState> {
  const user = await requireWriter();
  const parsed = Settings.safeParse({ accountId: form.get("accountId"), mode: form.get("mode") });
  if (!parsed.success) return { error: "Escolha a conta padrão e o modo de registro." };
  // Turning writes on is the moment a stolen session would want, so it asks for the password.
  const denied = await reauthenticate(user, form);
  if (denied) return { fieldErrors: { password: denied } };
  try {
    await confirmLink(await getDb(), user.id, parsed.data);
  } catch (e) {
    return { error: publicError(e, "Não foi possível confirmar.") };
  }
  revalidatePath(PATH);
  return { ok: true, message: "WhatsApp conectado." };
}

export async function updateLinkSettingsAction(_: FormState, form: FormData): Promise<FormState> {
  const user = await requireWriter();
  const parsed = Settings.safeParse({ accountId: form.get("accountId"), mode: form.get("mode") });
  if (!parsed.success) return { error: "Escolha a conta padrão e o modo de registro." };
  try {
    await updateLinkSettings(await getDb(), user.id, parsed.data);
  } catch (e) {
    return { error: publicError(e, "Não foi possível salvar.") };
  }
  revalidatePath(PATH);
  return { ok: true, message: "Preferências salvas." };
}

export async function disconnectLinkAction(): Promise<void> {
  const user = await requireWriter();
  await disconnectLink(await getDb(), user.id);
  revalidatePath(PATH);
}

async function onMatch(form: FormData, fn: typeof confirmMatch) {
  const user = await requireWriter();
  await fn(await getDb(), user.id, String(form.get("id") ?? ""));
  revalidatePath("/", "layout");
}

export async function confirmMatchAction(form: FormData) {
  await onMatch(form, confirmMatch);
}

export async function dismissMatchAction(form: FormData) {
  await onMatch(form, dismissMatch);
}

export async function undoMatchAction(form: FormData) {
  await onMatch(form, undoMatch);
}
