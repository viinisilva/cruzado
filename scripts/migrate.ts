import { createDb } from "../src/db/connection";
import { runMigrations } from "../src/db/migrate";

const db = createDb({ databaseUrl: process.env.DATABASE_URL || undefined, pgliteDir: process.env.DATABASE_URL ? undefined : (process.env.PGLITE_DIR ?? ".data/pglite") });
const applied = await runMigrations(db);
console.log(applied.length ? `Migrações aplicadas: ${applied.join(", ")}` : "Banco já está atualizado.");
process.exit(0);
