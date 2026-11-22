// Optional in-process scheduler (single instance / PGlite). For multiple replicas run `npm run worker` instead.
// On Vercel timers do not survive between requests; vercel.json calls /api/cron/agents.
import { errorSummary } from "@/lib/log";

export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  // The public demonstration refuses to start with any credential in its environment (docs/USO_COMPARTILHADO.md).
  const { isDemoInstance, assertDemoInstanceSafe } = await import("./lib/demo/instance-env");
  if (isDemoInstance()) {
    assertDemoInstanceSafe();
    return;
  }
  if (process.env.ENABLE_INPROCESS_SCHEDULER !== "1" || process.env.VERCEL) return;
  const { getDb } = await import("./db/connection");
  const { schedulerTick } = await import("./lib/agents/service");
  const interval = Number(process.env.SCHEDULER_INTERVAL_MS ?? 60_000);
  const tick = async () => {
    try {
      await schedulerTick(await getDb());
    } catch (e) {
      console.error("[scheduler]", errorSummary(e));
    }
  };
  setTimeout(tick, 5_000);
  setInterval(tick, interval).unref();
}
