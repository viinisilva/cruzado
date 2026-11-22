// Drains bank events, resumes interrupted syncs and, for the owner, syncs every connection again (each sync ends by
// recalibrating the cards, docs/CALIBRACAO_CARTAO.md). Scheduled in vercel.json as the evening run, next to the
// morning one in /api/cron/agents; calling it more often from an external scheduler (docs/OPEN_FINANCE.md) is what
// makes retries happen in minutes. With the Pluggy webhook off, these scheduled runs are the main path.
import { createHash, timingSafeEqual } from "node:crypto";
import { getDb } from "@/db/client";
import { json } from "@/lib/api";
import { processBankWork } from "@/lib/connectors/bank-work";
import { syncAllConnections } from "@/lib/connectors/open-finance";
import { pluggyClientFromEnv } from "@/lib/connectors/pluggy";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const BUDGET_MS = 45_000;
const STALE_MS = 6 * 60 * 60_000;
const digest = (v: string) => createHash("sha256").update(v).digest();

export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || !timingSafeEqual(digest(req.headers.get("authorization") ?? ""), digest(`Bearer ${secret}`))) return json({ error: "Não autorizado." }, 401);
  if (!process.env.PLUGGY_CLIENT_ID) return json({ skipped: true });
  const db = await getDb();
  const client = pluggyClientFromEnv();
  const started = Date.now();
  const work = await processBankWork(db, client, { budgetMs: BUDGET_MS / 3 });
  const owner = process.env.PLUGGY_OWNER_USER_ID;
  // Connections synced in the last hours are skipped: an external scheduler may call this every few minutes.
  const banks = owner ? await syncAllConnections(db, client, owner, BUDGET_MS - (Date.now() - started), new Date(), { staleMs: STALE_MS }) : null;
  console.log("[cron:banks]", JSON.stringify({ work, banks }));
  return json({ work, banks });
}
