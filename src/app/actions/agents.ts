"use server";
import { and, eq, isNull } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { getDb } from "@/db/client";
import * as s from "@/db/schema";
import { requireWriter } from "@/lib/auth/session";
import { parseMoneyToCents } from "@/lib/money";
import { AgentRuleSchema, type AgentRule } from "@/lib/agents/rule";
import { confirmAgent, createAgentDraft, deleteAgent, runAgent, setAgentPaused, updateAgent } from "@/lib/agents/service";
import { answer } from "@/lib/chat/engine";
import { createChatProvider, consentMissing } from "@/lib/chat/provider-for-user";
import { publicError } from "@/lib/api";
import { rateLimitShared } from "@/lib/rate-limit";
import type { FormState } from "./auth";

function ruleFromForm(form: FormData): { rule?: AgentRule; errors?: Record<string, string> } {
  const kind = String(form.get("kind") ?? "");
  const threshold = String(form.get("threshold") ?? "").trim();
  const thresholdCents = threshold ? parseMoneyToCents(threshold) : undefined;
  if (threshold && (thresholdCents === null || thresholdCents! <= 0)) return { errors: { threshold: "Valor inválido." } };
  const categoryIds = form.getAll("categoryIds").map(String).filter(Boolean);
  const accountIds = form.getAll("accountIds").map(String).filter(Boolean);
  const parsed = AgentRuleSchema.safeParse({
    name: String(form.get("name") ?? "").trim(),
    kind,
    thresholdCents: thresholdCents ?? undefined,
    schedule: form.get("schedule") || undefined,
    filters: categoryIds.length || accountIds.length ? { ...(categoryIds.length ? { categoryIds } : {}), ...(accountIds.length ? { accountIds } : {}) } : undefined,
    timezone: "America/Sao_Paulo",
    enabled: true,
  });
  if (!parsed.success) {
    const errors: Record<string, string> = {};
    for (const i of parsed.error.issues) {
      const key = i.path[0] === "thresholdCents" ? "threshold" : String(i.path[0]);
      errors[key] ??= key === "name" ? "Dê um nome com pelo menos 2 letras." : i.message;
    }
    return { errors };
  }
  return { rule: parsed.data };
}

/** Manual creation still produces a draft: the user reviews the summary and confirms. */
export async function createAgentAction(_: FormState, form: FormData): Promise<FormState> {
  const user = await requireWriter();
  const { rule, errors } = ruleFromForm(form);
  if (!rule) return { fieldErrors: errors };
  await createAgentDraft(await getDb(), user.id, rule, { origin: "manual" });
  revalidatePath("/agentes");
  return { ok: true, message: "Rascunho criado. Revise o resumo e confirme para ativar." };
}

export async function updateAgentAction(_: FormState, form: FormData): Promise<FormState> {
  const user = await requireWriter();
  const { rule, errors } = ruleFromForm(form);
  if (!rule) return { fieldErrors: errors };
  try {
    await updateAgent(await getDb(), user.id, String(form.get("id")), rule);
  } catch (e) {
    return { error: publicError(e, "Não foi possível salvar o agente.") };
  }
  revalidatePath("/agentes");
  return { ok: true, message: "Agente atualizado." };
}

/** Natural language → validated AgentRule draft via the same tool the chat uses. */
export async function draftAgentFromTextAction(_: FormState, form: FormData): Promise<FormState> {
  const user = await requireWriter();
  const text = String(form.get("text") ?? "").trim().slice(0, 1000);
  if (text.length < 5) return { fieldErrors: { text: "Descreva o que o agente deve vigiar." } };
  const db = await getDb();
  if (!(await rateLimitShared(db, "chat", user.id)).ok) return { error: "Muitas solicitações. Tente em instantes." };
  if (await consentMissing(db, user.id)) return { error: "Para usar um provedor de IA externo, autorize o envio de dados em Configurações." };
  const reply = await answer(db, await createChatProvider(db, user.id), user.id, text.startsWith("crie") ? text : `Crie um agente: ${text}`);
  revalidatePath("/agentes");
  if (!reply.evidence.draftAgentId) return { error: reply.content };
  return { ok: true, message: "Rascunho criado a partir do seu pedido. Revise e confirme abaixo." };
}

async function act(form: FormData, fn: (db: Awaited<ReturnType<typeof getDb>>, userId: string, id: string) => Promise<unknown>) {
  const user = await requireWriter();
  await fn(await getDb(), user.id, String(form.get("id") ?? ""));
  revalidatePath("/agentes");
  revalidatePath("/", "layout");
}

export async function confirmAgentAction(form: FormData) {
  await act(form, async (db, userId, id) => {
    const row = await confirmAgent(db, userId, id);
    if (row.status === "active") await runAgent(db, row);
  });
}
export async function pauseAgentAction(form: FormData) {
  await act(form, (db, userId, id) => setAgentPaused(db, userId, id, true));
}
export async function resumeAgentAction(form: FormData) {
  await act(form, (db, userId, id) => setAgentPaused(db, userId, id, false));
}
export async function deleteAgentAction(form: FormData) {
  await act(form, (db, userId, id) => deleteAgent(db, userId, id));
}
export async function runAgentNowAction(form: FormData) {
  await act(form, async (db, userId, id) => {
    const [row] = await db.select().from(s.agentRules).where(and(eq(s.agentRules.id, id), eq(s.agentRules.userId, userId)));
    if (row?.status === "active") await runAgent(db, row);
  });
}

export async function markNotificationsReadAction(form: FormData) {
  const user = await requireWriter();
  const id = String(form.get("id") ?? "");
  const db = await getDb();
  const where = id
    ? and(eq(s.notifications.userId, user.id), eq(s.notifications.id, id))
    : and(eq(s.notifications.userId, user.id), isNull(s.notifications.readAt));
  await db.update(s.notifications).set({ readAt: new Date() }).where(where);
  revalidatePath("/", "layout");
}
