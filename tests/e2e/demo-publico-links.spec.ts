// Every link of the public demonstration that carries an id (a card, an account, an entry, a conversation…) must open,
// on the instance that made it and on another one. On Vercel each instance builds its own in-memory copy of the demo,
// so ids have to match across instances (src/lib/ids.ts, withSeededIds).
//
// Locally: two demo instances (playwright.config.ts). Against the published demo:
//   E2E_DEMO_REMOTE=https://cruzado-demo.vercel.app npx playwright test tests/e2e/demo-publico-links.spec.ts
import { expect, test, type Page } from "@playwright/test";

const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;
const NOTICE = "Você está vendo dados de exemplo.";

/** Where the crawl starts: every screen of the app that lists cards, accounts, entries, agents or conversations. */
const SOURCES = ["/inicio", "/transacoes", "/contas", "/cartoes", "/recorrentes", "/agentes", "/alertas", "/chat", "/categorias", "/cartoes/conciliacao"];

/** The screen's own text, by path: proves the right screen opened, not just "some page without an error". */
const SCREEN_TEXT: [RegExp, (page: Page) => ReturnType<Page["getByRole"]>][] = [
  [/^\/transacoes\/[0-9a-f-]{36}$/, (p) => p.getByRole("heading", { name: "Detalhes" })],
  [/^\/cartoes\/conferir$/, (p) => p.getByRole("heading", { level: 1, name: "Conferir fatura" })],
  [/^\/cartoes\/conciliacao$/, (p) => p.getByRole("heading", { level: 1, name: "Conciliação de cartões" })],
  [/^\/cartoes$/, (p) => p.getByRole("heading", { level: 1, name: "Cartões" })],
  [/^\/transacoes$/, (p) => p.getByRole("heading", { level: 1, name: "Transações" })],
  [/^\/contas$/, (p) => p.getByRole("heading", { level: 1, name: "Contas e cartões" })],
  [/^\/recorrentes$/, (p) => p.getByRole("heading", { level: 1, name: "Recorrentes" })],
  [/^\/agentes$/, (p) => p.getByRole("heading", { level: 1, name: "Meus avisos" })],
  [/^\/alertas$/, (p) => p.getByRole("heading", { level: 1, name: "Notificações" })],
  [/^\/chat$/, (p) => p.getByRole("heading", { level: 1, name: "Assistente" })],
  [/^\/categorias$/, (p) => p.getByRole("heading", { level: 1, name: "Categorias" })],
  [/^\/inicio$/, (p) => p.getByRole("heading", { level: 1, name: /Olá/ })],
];

/** Same screen with a different id counts once; three of each is enough to catch a broken kind of link. */
const shape = (href: string) => {
  const u = new URL(href, "http://x");
  return `${u.pathname.replace(new RegExp(UUID, "gi"), ":id")}?${[...u.searchParams.keys()].sort().join("&")}`;
};

async function idLinks(page: Page, path: string): Promise<string[]> {
  await page.goto(path);
  await page.waitForLoadState("networkidle");
  const hrefs = await page.locator("a[href]").evaluateAll((els) => els.map((e) => e.getAttribute("href") ?? ""));
  return hrefs.filter((h) => h.startsWith("/") && UUID.test(h));
}

async function expectScreen(page: Page, href: string) {
  await page.waitForLoadState("networkidle");
  const where = `${href} (aberto em ${page.url()})`;
  await expect(page.getByRole("heading", { name: "Página não encontrada" }), where).toHaveCount(0);
  await expect(page.getByText(NOTICE).first(), where).toBeVisible();
  const path = new URL(page.url()).pathname;
  const own = SCREEN_TEXT.find(([r]) => r.test(path));
  expect(own, `tela sem texto próprio cadastrado em SCREEN_TEXT: ${path}`).toBeTruthy();
  await expect(own![1](page).first(), where).toBeVisible();
}

test("every link with an id opens its own screen, on this instance and on another", async ({ page }) => {
  test.setTimeout(600_000);
  const other = process.env.E2E_DEMO_OTHER_URL!;
  const found = new Map<string, { href: string; from: string }>();
  const perShape = new Map<string, number>();
  const add = (href: string, from: string) => {
    const k = shape(href);
    if (found.has(href) || (perShape.get(k) ?? 0) >= 3) return;
    perShape.set(k, (perShape.get(k) ?? 0) + 1);
    found.set(href, { href, from });
  };
  for (const src of SOURCES) for (const h of await idLinks(page, src)) add(h, src);
  // One level deeper: the screens those links open have links of their own (a bill's entries, an entry's card).
  for (const { href } of [...found.values()]) for (const h of await idLinks(page, href)) add(h, href);

  const kinds = new Set([...found.keys()].map(shape));
  console.log(`[demo-links] ${found.size} links com id, ${kinds.size} tipos: ${[...kinds].sort().join(" · ")}`);
  expect(found.size).toBeGreaterThan(5);
  expect([...kinds].some((k) => k.startsWith("/cartoes/conferir"))).toBe(true);
  expect([...kinds].some((k) => k.startsWith("/transacoes/:id"))).toBe(true);

  for (const { href, from } of found.values()) {
    // Clicked where it was shown, as a visitor would. Links hidden at this width are opened directly.
    await page.goto(from);
    await page.waitForLoadState("networkidle");
    const link = page.locator(`a[href="${href}"]:visible`).first();
    if (await link.count()) await link.click();
    else await page.goto(href);
    await page.waitForURL((u) => u.pathname === new URL(href, "http://x").pathname);
    await expectScreen(page, href);
    // The same link on another instance.
    await page.goto(new URL(href, other).toString());
    await expectScreen(page, href);
  }
});
