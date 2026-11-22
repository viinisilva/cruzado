// Agent scheduler/worker backed by the PostgreSQL `jobs` table. Run one or more: `npm run worker`.
import { createDb } from "../src/db/connection";
import { runMigrations } from "../src/db/migrate";
import { schedulerTick } from "../src/lib/agents/service";
import { drainWhatsapp } from "../src/lib/whatsapp/outbox";

const INTERVAL_MS = Number(process.env.SCHEDULER_INTERVAL_MS ?? 60_000);
const WHATSAPP_POLL_MS = 5_000;
let nextAgents = 0;
if (!process.env.DATABASE_URL) {
  console.warn("Aviso: sem DATABASE_URL o worker usa o PGlite local, que não aceita dois processos ao mesmo tempo. Use ENABLE_INPROCESS_SCHEDULER=1 no app em vez do worker.");
}
const db = createDb({ databaseUrl: process.env.DATABASE_URL || undefined, pgliteDir: process.env.DATABASE_URL ? undefined : (process.env.PGLITE_DIR ?? ".data/pglite") });
await runMigrations(db);

let stopping = false;
process.on("SIGTERM", () => (stopping = true));
process.on("SIGINT", () => (stopping = true));

console.log(`Worker iniciado (intervalo ${INTERVAL_MS / 1000}s).`);
while (!stopping) {
  if (Date.now() >= nextAgents) {
    nextAgents = Date.now() + INTERVAL_MS;
    try {
      const r = await schedulerTick(db);
      if (r.enqueued || r.done || r.failed) console.log(`[${new Date().toISOString()}] enfileirados=${r.enqueued} concluídos=${r.done} falhas=${r.failed}`);
    } catch (e) {
      console.error("Falha no ciclo do agendador:", e instanceof Error ? e.message : e);
    }
  }
  try {
    const w = await drainWhatsapp(db);
    if (w.processed || w.sent) console.log(`[${new Date().toISOString()}] whatsapp processadas=${w.processed} enviadas=${w.sent}`);
  } catch (e) {
    console.error("Falha na fila do WhatsApp:", e instanceof Error ? e.message.split("\n")[0] : e);
  }
  await new Promise((r) => setTimeout(r, WHATSAPP_POLL_MS));
}
process.exit(0);
