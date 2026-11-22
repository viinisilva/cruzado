// Screenshots for the public README (docs/readme/*.png), taken only from the public demonstration.
//
//   npx tsx scripts/readme-shots.ts
//
// The demonstration has invented data and no login. To keep it that way, this script:
//   - opens only https://cruzado-demo.vercel.app and aborts any request to another host;
//   - refuses to take a picture unless the page shows the notice "Você está vendo dados de exemplo.";
//   - starts from a clean browser, without cookies or saved sessions.
// scripts/export-public.ts lets through only the PNGs of docs/readme/, which come from here.
import { mkdirSync } from "node:fs";
import path from "node:path";
import { chromium, devices, type Page } from "@playwright/test";

export const DEMO = "https://cruzado-demo.vercel.app";
const OUT = path.resolve(import.meta.dirname, "../docs/readme");
const NOTICE = "Você está vendo dados de exemplo.";

const VIEWS = [
  { name: "celular", options: { ...devices["Pixel 7"], viewport: { width: 390, height: 844 } } },
  { name: "computador", options: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 } } },
];

const NOT_FOUND = "Página não encontrada";

/** Checked after the page settles: during a client-side navigation the previous page (and its notice) is still on screen. */
async function ensureDemo(page: Page) {
  await page.waitForLoadState("networkidle");
  if (new URL(page.url()).origin !== DEMO) throw new Error(`Saiu da demonstração: ${page.url()}`);
  await page.getByText(NOTICE).first().waitFor({ state: "visible", timeout: 30_000 });
  if (await page.getByText(NOT_FOUND).count()) throw new Error(`Página não encontrada: ${page.url()}`);
}

const SHOTS: { file: string; open: (page: Page) => Promise<void> }[] = [
  { file: "inicio", open: async (p) => void (await p.goto(`${DEMO}/inicio`)) },
  { file: "cartoes", open: async (p) => void (await p.goto(`${DEMO}/cartoes`)) },
  {
    file: "conferir-fatura",
    open: async (p) => {
      await p.goto(`${DEMO}/cartoes`);
      const href = await p.getByRole("link", { name: /Conferir a fatura/ }).first().getAttribute("href");
      await p.goto(new URL(href!, DEMO).toString());
      await p.getByRole("heading", { level: 1, name: "Conferir fatura" }).waitFor({ timeout: 30_000 });
    },
  },
  {
    file: "chat",
    open: async (p) => {
      await p.goto(`${DEMO}/chat`);
      await p.getByPlaceholder(/Pergunte sobre seus gastos/).fill("Quanto gastei com mercado este mês?");
      await p.getByRole("button", { name: "Enviar pergunta" }).click();
      await p.getByRole("status", { name: "Calculando resposta" }).waitFor({ state: "detached", timeout: 30_000 });
    },
  },
];

async function main() {
  mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch();
  try {
    for (const view of VIEWS) {
      const context = await browser.newContext({ ...view.options, locale: "pt-BR", timezoneId: "America/Sao_Paulo", colorScheme: "light" });
      await context.route("**/*", (route) => (new URL(route.request().url()).origin === DEMO ? route.continue() : route.abort()));
      const page = await context.newPage();
      for (const shot of SHOTS) {
        await shot.open(page);
        await ensureDemo(page);
        const file = path.join(OUT, `${shot.file}-${view.name}.png`);
        await page.screenshot({ path: file });
        console.log(path.relative(process.cwd(), file));
      }
      await context.close();
    }
  } finally {
    await browser.close();
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(import.meta.filename)) await main();
