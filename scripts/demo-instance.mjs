// Local run of the public demonstration exactly as the "cruzado-demo" deployment runs it: `next start` (needs
// `npm run build` first) with DEMO_INSTANCE=1 and every credential blanked. Empty strings matter: Next only fills
// variables from .env.local that are not already defined in the process.
import { spawn } from "node:child_process";

const port = process.env.PORT ?? "3300";
const blank = [
  "DATABASE_URL", "DATABASE_URL_UNPOOLED", "PGLITE_DIR", "PGHOST", "PGHOST_UNPOOLED", "PGUSER", "PGDATABASE", "PGPASSWORD",
  "POSTGRES_URL", "POSTGRES_URL_NON_POOLING", "POSTGRES_URL_NO_SSL", "POSTGRES_PRISMA_URL", "POSTGRES_USER", "POSTGRES_HOST", "POSTGRES_PASSWORD", "POSTGRES_DATABASE", "POSTGRES_URL_UNPOOLED",
  "NEON_PROJECT_ID", "PLUGGY_CLIENT_ID", "PLUGGY_CLIENT_SECRET", "PLUGGY_OWNER_USER_ID", "PLUGGY_WEBHOOK_SECRET", "PLUGGY_MODE", "PLUGGY_INCLUDE_SANDBOX",
  "ANTHROPIC_API_KEY", "ANTHROPIC_AUTH_TOKEN", "OLLAMA_BASE_URL", "CRON_SECRET", "OWNER_USER_ID",
  "WHATSAPP_ACCESS_TOKEN", "WHATSAPP_APP_SECRET", "WHATSAPP_WABA_ID", "WHATSAPP_PHONE_NUMBER_ID", "WHATSAPP_VERIFY_TOKEN",
  "VERCEL", "VERCEL_ENV", "VERCEL_URL", "VERCEL_OIDC_TOKEN", "SKIP_AUTO_MIGRATE",
];
const env = { ...process.env };
for (const k of blank) env[k] = "";
Object.assign(env, { DEMO_INSTANCE: "1", AI_PROVIDER: "mock", APP_URL: `http://localhost:${port}`, NODE_ENV: "production" });

const started = Date.now();
const child = spawn(process.execPath, ["node_modules/next/dist/bin/next", "start", "-p", port], { env, stdio: "inherit", cwd: process.cwd() });
child.on("exit", (code) => process.exit(code ?? 0));
for (const sig of ["SIGINT", "SIGTERM"]) process.on(sig, () => child.kill(sig));
console.log(`[demo-instance] iniciado em ${new Date(started).toISOString()}`);
