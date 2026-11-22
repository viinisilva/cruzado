// Creates a local demo login with fictitious data. Password comes from SEED_DEMO_PASSWORD or is generated and printed once.
import { randomBytes } from "node:crypto";
import { eq } from "drizzle-orm";
import { createDb } from "../src/db/connection";
import { runMigrations } from "../src/db/migrate";
import * as s from "../src/db/schema";
import { createUser } from "../src/lib/auth/users";
import { seedDemoData } from "../src/lib/demo/seed";
import { todayInSaoPaulo } from "../src/lib/dates";

const email = process.env.SEED_DEMO_EMAIL ?? "demo@cruzado.local";
const password = process.env.SEED_DEMO_PASSWORD ?? randomBytes(9).toString("base64url");

const db = createDb({ databaseUrl: process.env.DATABASE_URL || undefined, pgliteDir: process.env.DATABASE_URL ? undefined : (process.env.PGLITE_DIR ?? ".data/pglite") });
await runMigrations(db);
const [existing] = await db.select().from(s.users).where(eq(s.users.email, email));
if (existing) {
  console.log(`Usuário ${email} já existe; nada a fazer.`);
} else {
  const id = await createUser(db, { name: "Ana Exemplo", email, password }, { isDemo: true });
  const r = await seedDemoData(db, id, todayInSaoPaulo());
  console.log(`Usuário demo criado: ${email}`);
  if (!process.env.SEED_DEMO_PASSWORD) console.log(`Senha gerada (mostrada só agora): ${password}`);
  console.log(`${r.transactions} transações fictícias.`);
}
process.exit(0);
