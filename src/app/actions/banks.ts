"use server";
import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { getDb } from "@/db/client";
import * as s from "@/db/schema";
import { requireWriter } from "@/lib/auth/session";
import { reauthenticate } from "@/lib/auth/reauth";
import { connectItem, deleteBankHistory, disconnectBank, finishConnectAttempt, secretContext, startConnectAttempt, syncConnection, type SyncSummary } from "@/lib/connectors/open-finance";
import { canConnectBanks, isBankOwner, pluggyClientFromEnv, pluggyMode } from "@/lib/connectors/pluggy";
import { decryptSecret } from "@/lib/auth/crypto";
import { rateLimitShared } from "@/lib/rate-limit";
import { plural } from "@/lib/text";
import type { FormState } from "./auth";
import { errorSummary } from "@/lib/log";

const FORBIDDEN: FormState = { error: "Esta instância só permite conectar bancos à conta do proprietário." };
const SLOW_DOWN: FormState = { error: "Muitas tentativas. Aguarde um minuto." };
// Must end before the action times out; whatever is left resumes from the saved cursor.
const INLINE_BUDGET_MS = 8_000;

// Provider errors stay in the log: they can carry status details that mean nothing to the user.
function failed(context: string, e: unknown): FormState {
  console.error(`[banks] ${context}`, errorSummary(e));
  return { error: "Não foi possível falar com o banco agora. Tente novamente em alguns minutos." };
}

function outcome(r: SyncSummary, doneMessage: string): FormState {
  if (r.status === "error") return { error: r.detail };
  if (r.status === "busy") return { ok: true, message: "Já existe uma atualização em andamento." };
  if (r.status === "processing") return { ok: true, message: "O banco ainda está processando. Os dados aparecem assim que ele terminar." };
  if (r.status === "partial") return { ok: true, message: r.detail ?? "Atualização em andamento: continuamos em segundo plano." };
  return { ok: true, message: doneMessage };
}

export async function connectBankAction(_: FormState, form: FormData): Promise<FormState> {
  const user = await requireWriter();
  if (!canConnectBanks(user)) return FORBIDDEN;
  const db = await getDb();
  if (!(await rateLimitShared(db, "sync", user.id)).ok) return SLOW_DOWN;
  // A stolen session alone must not be enough to attach a real bank.
  const denied = await reauthenticate(user, form);
  if (denied) return { fieldErrors: { password: denied } };
  const itemId = String(form.get("itemId") ?? "").trim();
  try {
    const r = await connectItem(db, pluggyClientFromEnv(), user.id, itemId);
    revalidatePath("/", "layout");
    return outcome(r, `Banco conectado: ${plural(r.accounts, "conta", "contas")} e ${plural(r.transactions, "transação", "transações")}.`);
  } catch (e) {
    if (e instanceof Error && /Item ID|já está conectado/.test(e.message)) return { fieldErrors: { itemId: e.message } };
    return failed("connect", e);
  }
}

export type ConnectSession = FormState & { attemptId?: string; accessToken?: string; connectorIds?: number[]; updateItem?: string; includeSandbox?: boolean };

/** Hands the browser a short-lived token for the widget. Client id, secret and API key never leave the server. */
export async function startBankConnectAction(_: ConnectSession, form: FormData): Promise<ConnectSession> {
  const user = await requireWriter();
  if (!canConnectBanks(user) || pluggyMode() !== "connect") return FORBIDDEN;
  const db = await getDb();
  if (!(await rateLimitShared(db, "sync", user.id)).ok) return SLOW_DOWN;
  const denied = await reauthenticate(user, form);
  if (denied) return { fieldErrors: { password: denied } };
  const includeSandbox = process.env.PLUGGY_INCLUDE_SANDBOX === "1";
  try {
    const connectionId = String(form.get("connectionId") ?? "") || undefined;
    return { ok: true, includeSandbox, ...(await startConnectAttempt(db, pluggyClientFromEnv(), user.id, { connectionId, includeSandbox })) };
  } catch (e) {
    if (e instanceof Error && /Nenhuma instituição|não encontrada/.test(e.message)) return { error: e.message };
    return failed("connect-token", e);
  }
}

export async function finishBankConnectAction(attemptId: string, itemId?: string): Promise<FormState> {
  const user = await requireWriter();
  if (!isBankOwner(user)) return FORBIDDEN;
  const db = await getDb();
  try {
    const client = pluggyClientFromEnv();
    const conn = await finishConnectAttempt(db, client, user.id, String(attemptId), itemId ? String(itemId) : undefined);
    if (!conn) return { error: "Conexão não encontrada." };
    const r = await syncConnection(db, client, conn, new Date(), { budgetMs: INLINE_BUDGET_MS });
    revalidatePath("/", "layout");
    return outcome(r, `Banco conectado: ${plural(r.accounts, "conta", "contas")} e ${plural(r.transactions, "transação", "transações")}.`);
  } catch (e) {
    if (e instanceof Error && /autorização|já está conectado|não encontrada|inválido/.test(e.message)) return { error: e.message };
    return failed("connect-finish", e);
  }
}

export async function syncBankAction(_: FormState, form: FormData): Promise<FormState> {
  const user = await requireWriter();
  if (!canConnectBanks(user)) return FORBIDDEN;
  const db = await getDb();
  if (!(await rateLimitShared(db, "sync", user.id)).ok) return SLOW_DOWN;
  const [conn] = await db
    .select()
    .from(s.financialConnections)
    .where(and(eq(s.financialConnections.id, String(form.get("id") ?? "")), eq(s.financialConnections.userId, user.id)));
  if (!conn?.encryptedToken) return { error: "Conexão não encontrada." };
  try {
    const client = pluggyClientFromEnv();
    // Connect: ask the bank for fresh data, which arrives by webhook. Personal: read what Meu Pluggy already has.
    if (conn.accessMode === "connect") await client.refreshItem(decryptSecret(conn.encryptedToken, secretContext(conn.id)));
    const r = await syncConnection(db, client, conn, new Date(), { budgetMs: INLINE_BUDGET_MS });
    revalidatePath("/", "layout");
    return outcome(r, `Atualizado: ${plural(r.transactions, "transação lida", "transações lidas")}.`);
  } catch (e) {
    return failed("sync", e);
  }
}

export async function disconnectBankAction(_: FormState, form: FormData): Promise<FormState> {
  const user = await requireWriter();
  // The owner must always be able to stop updates, even with two-step verification turned off.
  if (!isBankOwner(user)) return FORBIDDEN;
  try {
    await disconnectBank(await getDb(), pluggyClientFromEnv(), user.id, String(form.get("id") ?? ""));
    revalidatePath("/", "layout");
    return { ok: true, message: "Banco desconectado. Novas atualizações foram interrompidas e o histórico continua aqui. Para encerrar o compartilhamento no banco, confira também o app dele." };
  } catch (e) {
    return failed("disconnect", e);
  }
}

export async function deleteBankHistoryAction(_: FormState, form: FormData): Promise<FormState> {
  const user = await requireWriter();
  if (user.isDemo) return { error: "Indisponível no modo demonstração." };
  if (String(form.get("confirm") ?? "") !== "EXCLUIR") return { fieldErrors: { confirm: "Digite EXCLUIR para confirmar." } };
  const denied = await reauthenticate(user, form);
  if (denied) return { fieldErrors: { password: denied } };
  try {
    await deleteBankHistory(await getDb(), user.id, String(form.get("id") ?? ""));
    revalidatePath("/", "layout");
    return { ok: true, message: "Histórico do banco excluído." };
  } catch (e) {
    if (e instanceof Error && /Desconecte|não encontrada/.test(e.message)) return { error: e.message };
    return failed("delete-history", e);
  }
}
