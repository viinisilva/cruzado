// Scheduled entry point for serverless hosts: runs due agents and housekeeping. Called by Vercel Cron (vercel.json).
import { createHash, timingSafeEqual } from "node:crypto";
import { getDb } from "@/db/client";
import { json } from "@/lib/api";
import { enqueueDueAgents, processJobs } from "@/lib/agents/service";
import { processBankWork } from "@/lib/connectors/bank-work";
import { syncAllConnections } from "@/lib/connectors/open-finance";
import { pluggyClientFromEnv } from "@/lib/connectors/pluggy";
import { purgeExpired } from "@/lib/maintenance";
import { drainWhatsapp } from "@/lib/whatsapp/outbox";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const BUDGET_MS = 45_000;
const BANK_BUDGET_MS = 30_000;
const digest = (s: string) => createHash("sha256").update(s).digest();

function authorized(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  return timingSafeEqual(digest(req.headers.get("authorization") ?? ""), digest(`Bearer ${secret}`));
}

export async function GET(req: Request) {
  if (!authorized(req)) return json({ error: "Não autorizado." }, 401);
  const db = await getDb();
  const started = Date.now();
  // Banks first, so the agents below see today's data.
  const owner = process.env.PLUGGY_OWNER_USER_ID;
  let banks = null;
  if (owner && process.env.PLUGGY_CLIENT_ID) {
    const client = pluggyClientFromEnv();
    await processBankWork(db, client, { budgetMs: BANK_BUDGET_MS / 3 });
    banks = await syncAllConnections(db, client, owner, BANK_BUDGET_MS);
  }
  const enqueued = await enqueueDueAgents(db);
  let done = 0;
  let failed = 0;
  // Failed jobs are rescheduled into the future, so this drains the queue and stops.
  while (Date.now() - started < BUDGET_MS) {
    const r = await processJobs(db);
    done += r.done;
    failed += r.failed;
    if (r.done + r.failed === 0) break;
  }
  const whatsapp = await drainWhatsapp(db, { budgetMs: 5_000 });
  const result = { banks, enqueued, done, failed, whatsapp, purged: await purgeExpired(db) };
  console.log("[cron]", JSON.stringify(result));
  return json(result);
}
