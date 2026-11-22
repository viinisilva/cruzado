// Agent lifecycle (draft → confirm → pause/resume/edit/delete) and idempotent execution.
import { and, eq, inArray, sql } from "drizzle-orm";
import type { DB } from "@/db/connection";
import * as s from "@/db/schema";
import { newId } from "../ids";
import { audit } from "../audit";
import { addMonths, hourInSaoPaulo, todayInSaoPaulo } from "../dates";
import { loadCategories, loadTransactions, ownedIds } from "../data/repo";
import { AgentRuleSchema, normalizeRule, type AgentKind, type AgentRule } from "./rule";
import { evaluate, isDue, periodKeyFor } from "./evaluators";

export type AgentRow = typeof s.agentRules.$inferSelect;

/** Drops filter ids the user does not own (e.g. ids invented by a model or tampered by a client). */
async function scopeRule(db: DB, userId: string, rule: AgentRule): Promise<AgentRule> {
  const accountIds = await ownedIds(db, userId, "accounts", rule.filters?.accountIds);
  const categoryIds = await ownedIds(db, userId, "categories", rule.filters?.categoryIds);
  const filters = accountIds?.length || categoryIds?.length ? { ...(accountIds?.length ? { accountIds } : {}), ...(categoryIds?.length ? { categoryIds } : {}) } : undefined;
  return AgentRuleSchema.parse({ ...rule, filters });
}

export async function createAgentDraft(
  db: DB,
  userId: string,
  rule: AgentRule,
  opts: { origin: "manual" | "natural_language" | "default"; sourceText?: string; status?: "draft" | "active" },
): Promise<string> {
  const scoped = await scopeRule(db, userId, rule);
  const id = newId();
  await db.insert(s.agentRules).values({
    id,
    userId,
    name: scoped.name,
    kind: scoped.kind,
    rule: normalizeRule(scoped),
    status: opts.status ?? "draft",
    origin: opts.origin,
    sourceText: opts.sourceText?.slice(0, 500) ?? null,
  });
  await audit(db, userId, "agent.drafted", { agentId: id, kind: scoped.kind, origin: opts.origin });
  return id;
}

async function getOwned(db: DB, userId: string, id: string): Promise<AgentRow> {
  const [row] = await db.select().from(s.agentRules).where(and(eq(s.agentRules.id, id), eq(s.agentRules.userId, userId)));
  if (!row) throw new Error("Agente não encontrado.");
  return row;
}

/** Human confirmation: the only way a draft becomes active. */
export async function confirmAgent(db: DB, userId: string, id: string) {
  const row = await getOwned(db, userId, id);
  if (row.status !== "draft") return row;
  const rule = AgentRuleSchema.parse(row.rule);
  await db
    .update(s.agentRules)
    .set({ status: rule.enabled ? "active" : "paused", updatedAt: new Date() })
    .where(and(eq(s.agentRules.id, id), eq(s.agentRules.userId, userId)));
  await audit(db, userId, "agent.confirmed", { agentId: id });
  return getOwned(db, userId, id);
}

export async function setAgentPaused(db: DB, userId: string, id: string, paused: boolean) {
  const row = await getOwned(db, userId, id);
  if (row.status === "draft") throw new Error("Confirme o rascunho antes de pausar ou retomar.");
  const rule = { ...(row.rule as AgentRule), enabled: !paused };
  await db
    .update(s.agentRules)
    .set({ status: paused ? "paused" : "active", rule, updatedAt: new Date() })
    .where(and(eq(s.agentRules.id, id), eq(s.agentRules.userId, userId)));
  await audit(db, userId, paused ? "agent.paused" : "agent.resumed", { agentId: id });
}

export async function updateAgent(db: DB, userId: string, id: string, rule: AgentRule) {
  const row = await getOwned(db, userId, id);
  const scoped = await scopeRule(db, userId, { ...rule, kind: row.kind });
  await db
    .update(s.agentRules)
    .set({ name: scoped.name, rule: normalizeRule(scoped), updatedAt: new Date() })
    .where(and(eq(s.agentRules.id, id), eq(s.agentRules.userId, userId)));
  await audit(db, userId, "agent.updated", { agentId: id });
}

export async function deleteAgent(db: DB, userId: string, id: string) {
  await getOwned(db, userId, id);
  await db.delete(s.agentRules).where(and(eq(s.agentRules.id, id), eq(s.agentRules.userId, userId)));
  await audit(db, userId, "agent.deleted", { agentId: id });
}

export async function listAgents(db: DB, userId: string): Promise<AgentRow[]> {
  return db.select().from(s.agentRules).where(eq(s.agentRules.userId, userId)).orderBy(s.agentRules.createdAt);
}

/**
 * Runs one rule for its current period. Idempotent: one agent_runs row per (rule, period) and
 * notifications deduplicated by key, so re-running never duplicates alerts.
 */
export async function runAgent(db: DB, row: AgentRow, now: Date = new Date()) {
  const today = todayInSaoPaulo(now);
  const rule = AgentRuleSchema.parse(row.rule);
  const [transactions, categories] = await Promise.all([
    loadTransactions(db, row.userId, { range: { from: addMonths(today, -12), to: today } }),
    loadCategories(db, row.userId),
  ]);
  const result = evaluate(row.id, rule, { transactions, categories }, today);
  let created = 0;
  await db.transaction(async (tx) => {
    await tx
      .insert(s.agentRuns)
      .values({ id: newId(), userId: row.userId, ruleId: row.id, periodKey: result.periodKey, status: "ok", summary: result.summary, finishedAt: now })
      .onConflictDoUpdate({
        target: [s.agentRuns.ruleId, s.agentRuns.periodKey],
        set: { runCount: sql`${s.agentRuns.runCount} + 1`, summary: result.summary, finishedAt: now, status: "ok" },
      });
    for (const n of result.notifications) {
      const inserted = await tx
        .insert(s.notifications)
        .values({ id: newId(), userId: row.userId, ruleId: row.id, kind: row.kind, ...n })
        .onConflictDoNothing({ target: [s.notifications.userId, s.notifications.dedupeKey] })
        .returning({ id: s.notifications.id });
      created += inserted.length;
    }
    await tx.update(s.agentRules).set({ lastRunAt: now }).where(eq(s.agentRules.id, row.id));
  });
  return { periodKey: result.periodKey, created, evaluated: result.notifications.length };
}

/** Runs a user's active agents right away (after import/sync). Optional kinds filter. */
export async function runUserAgents(db: DB, userId: string, now: Date = new Date(), kinds?: AgentKind[]) {
  const conds = [eq(s.agentRules.userId, userId), eq(s.agentRules.status, "active")];
  if (kinds?.length) conds.push(inArray(s.agentRules.kind, kinds));
  const rows = await db.select().from(s.agentRules).where(and(...conds));
  const out = [];
  for (const r of rows) out.push(await runAgent(db, r, now));
  return out;
}

/** Scheduler: enqueue a job for each due rule; the job dedupe key makes enqueueing idempotent. */
export async function enqueueDueAgents(db: DB, now: Date = new Date()): Promise<number> {
  const today = todayInSaoPaulo(now);
  const hour = hourInSaoPaulo(now);
  const rows = await db.select().from(s.agentRules).where(eq(s.agentRules.status, "active"));
  let n = 0;
  for (const r of rows) {
    const rule = normalizeRule(AgentRuleSchema.parse(r.rule));
    if (!isDue(rule.schedule, today, hour)) continue;
    const period = periodKeyFor(rule.schedule, today);
    // Continuous rules are re-checked every 15 minutes; others once per period.
    const slot = rule.schedule === "continuous" ? `:${Math.floor((now.getTime() / 60000) / 15)}` : "";
    const inserted = await db
      .insert(s.jobs)
      .values({ id: newId(), type: "agent.run", payload: { ruleId: r.id }, dedupeKey: `agent:${r.id}:${period}${slot}`, runAt: now })
      .onConflictDoNothing({ target: s.jobs.dedupeKey })
      .returning({ id: s.jobs.id });
    n += inserted.length;
  }
  return n;
}

/** Worker: claims queued jobs with SKIP LOCKED so several workers can run safely. */
export async function processJobs(db: DB, now: Date = new Date(), limit = 20): Promise<{ done: number; failed: number }> {
  // Requeue jobs stuck in "running" for more than 10 minutes (crashed worker).
  await db.execute(sql`UPDATE jobs SET status = 'queued', locked_at = NULL WHERE status = 'running' AND locked_at < ${new Date(now.getTime() - 600_000)}`);
  const claimed = await db.execute(sql`
    UPDATE jobs SET status = 'running', locked_at = ${now}, attempts = attempts + 1
    WHERE id IN (
      SELECT id FROM jobs WHERE status = 'queued' AND run_at <= ${now}
      ORDER BY run_at LIMIT ${limit} FOR UPDATE SKIP LOCKED
    )
    RETURNING id, type, payload, attempts`);
  let done = 0;
  let failed = 0;
  for (const job of claimed.rows as { id: string; type: string; payload: { ruleId: string }; attempts: number }[]) {
    try {
      if (job.type !== "agent.run") throw new Error(`Tipo de job desconhecido: ${job.type}`);
      const [row] = await db.select().from(s.agentRules).where(eq(s.agentRules.id, job.payload.ruleId));
      if (row && row.status === "active") await runAgent(db, row, now);
      await db.update(s.jobs).set({ status: "done", lockedAt: null }).where(eq(s.jobs.id, job.id));
      done++;
    } catch (err) {
      const retry = job.attempts < 3;
      await db
        .update(s.jobs)
        .set({
          status: retry ? "queued" : "failed",
          lockedAt: null,
          runAt: new Date(now.getTime() + 60_000 * job.attempts),
          lastError: err instanceof Error ? err.message.slice(0, 300) : "erro",
        })
        .where(eq(s.jobs.id, job.id));
      failed++;
    }
  }
  return { done, failed };
}

export async function schedulerTick(db: DB, now: Date = new Date()) {
  const enqueued = await enqueueDueAgents(db, now);
  const r = await processJobs(db, now);
  return { enqueued, ...r };
}
