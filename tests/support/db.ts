import { createDb } from "@/db/connection";
import { runMigrations } from "@/db/migrate";
import { createUser } from "@/lib/auth/users";
import { seedDemoData } from "@/lib/demo/seed";

export async function testDb() {
  const db = createDb(); // in-memory PGlite
  await runMigrations(db);
  return db;
}

/** Fixed clock: Wednesday 15/10/2025, 14:00 in São Paulo (17:00 UTC). */
export const NOW = new Date("2025-10-15T17:00:00Z");
export const TODAY = "2025-10-15";

export async function seededUser(db: Awaited<ReturnType<typeof testDb>>, email = "ana@exemplo.test") {
  const userId = await createUser(db, { name: "Ana Teste", email, password: "senha-de-teste-123" });
  const seed = await seedDemoData(db, userId, TODAY, NOW);
  return { userId, ...seed };
}
