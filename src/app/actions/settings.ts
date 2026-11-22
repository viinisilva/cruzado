"use server";
import { and, eq, isNotNull } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getDb } from "@/db/client";
import * as s from "@/db/schema";
import { endSession, requireWriter } from "@/lib/auth/session";
import { deleteUserData } from "@/lib/auth/users";
import { audit } from "@/lib/audit";
import { disconnectBank } from "@/lib/connectors/open-finance";
import { pluggyClientFromEnv } from "@/lib/connectors/pluggy";
import { reauthenticate } from "@/lib/auth/reauth";
import { TokenLimitError, createMcpToken, revokeMcpToken } from "@/lib/mcp/tokens";
import type { FormState } from "./auth";
import { OwnerOnlyError } from "@/lib/auth/access";
import { errorSummary } from "@/lib/log";

export async function setAiConsentAction(form: FormData) {
  const user = await requireWriter();
  const grant = form.get("grant") === "1";
  const db = await getDb();
  await db.update(s.users).set({ aiExternalConsentAt: grant ? new Date() : null }).where(eq(s.users.id, user.id));
  await audit(db, user.id, grant ? "ai.consent_granted" : "ai.consent_revoked");
  revalidatePath("/", "layout");
}

export async function createMcpTokenAction(_: FormState, form: FormData): Promise<FormState> {
  const user = await requireWriter();
  // A token is lasting read access to everything, so a session alone must not be able to mint one.
  const denied = await reauthenticate(user, form);
  if (denied) return { fieldErrors: { password: denied } };
  const name = String(form.get("name") ?? "").trim() || "Cliente MCP";
  try {
    const scope = form.get("scope") === "capture" ? "capture" : "read";
    const { token } = await createMcpToken(await getDb(), user.id, name, undefined, scope);
    revalidatePath("/configuracoes");
    // Shown once; only its hash is stored.
    return { ok: true, message: token };
  } catch (e) {
    return { error: e instanceof TokenLimitError || e instanceof OwnerOnlyError ? e.message : "Não foi possível criar o token." };
  }
}

export async function revokeMcpTokenAction(form: FormData) {
  const user = await requireWriter();
  await revokeMcpToken(await getDb(), user.id, String(form.get("id") ?? ""));
  revalidatePath("/configuracoes");
}

export async function deleteAccountAction(_: FormState, form: FormData): Promise<FormState> {
  const user = await requireWriter();
  if (String(form.get("confirm") ?? "").trim().toUpperCase() !== "EXCLUIR") return { fieldErrors: { confirm: "Digite EXCLUIR para confirmar." } };
  const denied = await reauthenticate(user, form);
  if (denied) return { fieldErrors: { password: denied }, values: { confirm: "EXCLUIR" } };
  const db = await getDb();
  // Removes each connection at the provider first. Consent at the bank or in Meu Pluggy is ended there, by the user.
  const links = await db
    .select({ id: s.financialConnections.id })
    .from(s.financialConnections)
    .where(and(eq(s.financialConnections.userId, user.id), isNotNull(s.financialConnections.encryptedToken)));
  try {
    for (const link of links) await disconnectBank(db, pluggyClientFromEnv(), user.id, link.id);
  } catch (e) {
    console.error("[delete-account]", errorSummary(e));
    return { error: "Não foi possível remover a conexão com o banco no provedor. Nada foi excluído; tente novamente." };
  }
  await endSession();
  await deleteUserData(db, user.id);
  redirect("/entrar?conta-excluida=1");
}
