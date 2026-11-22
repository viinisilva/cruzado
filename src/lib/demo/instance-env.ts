// The public demonstration runs as its own deployment with DEMO_INSTANCE=1 (docs/USO_COMPARTILHADO.md, etapa 1).
// Its safety does not rest on code paths: the deployment simply has no way to reach a real database, bank or AI
// account. These checks make a misconfigured deployment refuse to start instead of quietly using a credential.
type Env = Record<string, string | undefined>;

/** The one account of the public demonstration. */
export const DEMO_USER_ID = "demo-publico";

/**
 * The same row the database receives at start (instance.ts). The session reads it from here, so the page frame and
 * "Preparando a demonstração…" can be sent before the database is ready.
 */
export const DEMO_USER = { id: DEMO_USER_ID, email: "ana@exemplo.invalid", name: "Ana Exemplo", passwordHash: "demo$sem-senha", isDemo: true } as const;
export const DEMO_USER_CREATED_AT = new Date("2026-01-01T03:00:00Z");

export const isDemoInstance = (env: Env = process.env) => env.DEMO_INSTANCE === "1";

const FORBIDDEN_EXACT = new Set([
  "DATABASE_URL",
  "DATABASE_URL_UNPOOLED",
  "PGLITE_DIR",
  "ANTHROPIC_API_KEY",
  "ANTHROPIC_AUTH_TOKEN",
  "OLLAMA_BASE_URL",
  "CRON_SECRET",
  "OWNER_USER_ID",
]);
const FORBIDDEN_PREFIX = ["PG", "POSTGRES_", "NEON_", "PLUGGY_", "WHATSAPP_", "GOOGLE_CLIENT_", "SMTP_"];

/** Names (never values) of the variables that must not exist in the demo deployment. Blank values do not count. */
export function demoInstanceProblems(env: Env = process.env): string[] {
  return Object.keys(env)
    .filter((k) => env[k] !== undefined && env[k] !== "")
    .filter((k) => FORBIDDEN_EXACT.has(k) || FORBIDDEN_PREFIX.some((p) => k.startsWith(p)))
    .sort();
}

export function assertDemoInstanceSafe(env: Env = process.env) {
  const bad = demoInstanceProblems(env);
  if (bad.length) throw new Error(`DEMO_INSTANCE=1 não pode ter estas variáveis: ${bad.join(", ")}. Remova-as do projeto da demonstração.`);
}

/** Link to the public demonstration shown on the main app's login page. Only https (or a local address) is accepted. */
export function publicDemoUrl(env: Env = process.env): string | null {
  const v = env.DEMO_URL?.trim();
  if (!v) return null;
  try {
    const u = new URL(v);
    const local = u.hostname === "localhost" || u.hostname === "127.0.0.1";
    return u.protocol === "https:" || (local && u.protocol === "http:") ? u.toString() : null;
  } catch {
    return null;
  }
}
