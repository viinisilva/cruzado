import { defineConfig, devices } from "@playwright/test";

const PORT = Number(process.env.E2E_PORT ?? 3100);
const DEMO_PORT = Number(process.env.E2E_DEMO_PORT ?? 3101);
// A second, independent demo instance: links collected on one must open on the other, as on Vercel.
const DEMO_OTHER_PORT = DEMO_PORT + 1;
// E2E_DEMO_REMOTE=https://cruzado-demo.vercel.app checks the published demo instead: no local server is started and
// only the demo's link check runs (tests/e2e/demo-publico-links.spec.ts).
const REMOTE = process.env.E2E_DEMO_REMOTE;
process.env.E2E_DEMO_OTHER_URL = REMOTE ?? `http://localhost:${DEMO_OTHER_PORT}`;
const demoServer = (port: number) => ({ command: "node scripts/demo-instance.mjs", url: `http://localhost:${port}/privacidade`, reuseExistingServer: false, timeout: 120_000, env: { PORT: String(port) } });

export default defineConfig({
  testDir: "tests/e2e",
  timeout: 60_000,
  fullyParallel: false,
  workers: 1,
  reporter: [["list"]],
  use: { baseURL: `http://localhost:${PORT}`, trace: "retain-on-failure", locale: "pt-BR", timezoneId: "America/Sao_Paulo" },
  projects: REMOTE
    ? [{ name: "demo-publicada", testMatch: /demo-publico-links/, use: { ...devices["Pixel 7"], viewport: { width: 375, height: 812 }, baseURL: REMOTE } }]
    : [
    { name: "desktop", testIgnore: /demo-publico/, use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 } } },
    { name: "mobile", testIgnore: /demo-publico/, use: { ...devices["Pixel 7"], viewport: { width: 375, height: 812 } } },
    // The public demonstration runs as its own server, exactly as its deployment does (scripts/demo-instance.mjs).
    { name: "demo-publico", testMatch: /demo-publico/, use: { ...devices["Pixel 7"], viewport: { width: 375, height: 812 }, baseURL: `http://localhost:${DEMO_PORT}` } },
  ],
  webServer: REMOTE
    ? []
    : [
    {
      // Separate embedded database so e2e never touches local data. Requires `npm run build` first.
      command: `node node_modules/next/dist/bin/next start -p ${PORT}`,
      url: `http://localhost:${PORT}/entrar`,
      reuseExistingServer: false,
      timeout: 120_000,
      env: { PGLITE_DIR: process.env.E2E_PGLITE_DIR ?? ".data/e2e", AI_PROVIDER: "mock", RATE_LIMIT_AUTH_MAX: "1000", APP_ENCRYPTION_KEY: Buffer.alloc(32, 1).toString("base64"), WHATSAPP_APP_SECRET: "e2e-app-secret", WHATSAPP_VERIFY_TOKEN: "e2e-verify", WHATSAPP_PHONE_NUMBER_ID: "100200300" },
    },
    demoServer(DEMO_PORT),
    demoServer(DEMO_OTHER_PORT),
  ],
});
