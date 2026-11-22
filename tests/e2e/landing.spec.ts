// The landing page at "/": loads, links where it says, no console errors, the CSP untouched, nothing fetched from another
// host, no layout shift while scrolling, and everything readable with reduced motion.
import { expect, test, type Page } from "@playwright/test";

const CSP = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data:",
  "font-src 'self'",
  "connect-src 'self'",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join("; ");

/** Opens "/" and collects console errors, uncaught errors and any request that leaves this host. */
async function open(page: Page) {
  const problems: string[] = [];
  page.on("console", (m) => m.type() === "error" && problems.push(`console: ${m.text()}`));
  page.on("pageerror", (e) => problems.push(`erro: ${e.message}`));
  page.on("request", (r) => {
    const url = new URL(r.url());
    if (!["localhost", "127.0.0.1"].includes(url.hostname) && url.protocol !== "data:") problems.push(`fora do host: ${r.url()}`);
  });
  const response = await page.goto("/");
  return { response: response!, problems };
}

/** Scrolls to the bottom in steps, as a visitor would, and back to the top. */
async function scrollThrough(page: Page) {
  const height = await page.evaluate(() => document.documentElement.scrollHeight);
  for (let y = 0; y <= height; y += 400) {
    await page.evaluate((top) => window.scrollTo(0, top), y);
    await page.waitForTimeout(60);
  }
  await page.waitForTimeout(800);
}

test("loads the landing page with its own title, headline and links", async ({ page }) => {
  const { response, problems } = await open(page);
  expect(response.status()).toBe(200);
  expect(response.headers()["content-security-policy"]).toBe(CSP);
  await expect(page).toHaveTitle("Cruzado: seu dinheiro, com a prova de cada número");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Seu dinheiro, com a prova de cada número.");
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", "index, follow");
  await expect(page.locator('meta[property="og:image"]')).toHaveAttribute("content", /\/opengraph-image/);

  const hero = page.getByRole("region", { name: "Seu dinheiro, com a prova de cada número." });
  await expect(hero.getByRole("link", { name: "Ver demonstração" })).toHaveAttribute("href", "https://cruzado-demo.vercel.app");
  await expect(hero.getByRole("link", { name: "Ver no GitHub" })).toHaveAttribute("href", "https://github.com/viinisilva/cruzado");
  await expect(page.getByRole("link", { name: "LinkedIn" })).toHaveAttribute("href", "https://www.linkedin.com/in/viinicius-silva");
  await expect(page.getByRole("contentinfo").getByRole("link", { name: "GitHub" })).toHaveAttribute("href", "https://github.com/viinisilva");
  await expect(page.getByRole("link", { name: "Ler o README" })).toHaveAttribute("href", "https://github.com/viinisilva/cruzado#readme");
  await expect(page.getByRole("img", { name: /Tela inicial do Cruzado no celular/ })).toBeVisible();

  await scrollThrough(page);
  expect(problems).toEqual([]);

  // The footer's "Entrar" opens the app's login.
  await page.getByRole("contentinfo").getByRole("link", { name: "Entrar" }).click();
  await expect(page).toHaveURL(/\/entrar$/);
  await expect(page.getByRole("heading", { name: "Entrar", level: 1 })).toBeVisible();
});

test("the link preview image is public", async ({ request }) => {
  const r = await request.get("/opengraph-image");
  expect(r.status()).toBe(200);
  expect(r.headers()["content-type"]).toBe("image/png");
});

test("nothing moves the layout while the page loads and scrolls", async ({ page }) => {
  await page.addInitScript(() => {
    (window as unknown as { __cls: number }).__cls = 0;
    new PerformanceObserver((list) => {
      for (const e of list.getEntries() as unknown as { value: number; hadRecentInput: boolean }[]) {
        if (!e.hadRecentInput) (window as unknown as { __cls: number }).__cls += e.value;
      }
    }).observe({ type: "layout-shift", buffered: true });
  });
  await open(page);
  await page.waitForLoadState("networkidle");
  await scrollThrough(page);
  const cls = await page.evaluate(() => (window as unknown as { __cls: number }).__cls);
  expect(cls).toBeLessThan(0.02);
});

test("the bill story ends matching the bank, and the chat shows its evidence", async ({ page }) => {
  await open(page);
  await scrollThrough(page);
  const bill = page.getByRole("figure", { name: /Exemplo de fatura conferida/ });
  await bill.scrollIntoViewIfNeeded();
  // Scroll to the end of the story: the bill closes and matches.
  await page.evaluate(() => {
    const track = document.querySelector(".lp-story-track")!;
    window.scrollTo(0, track.getBoundingClientRect().bottom + window.scrollY - window.innerHeight);
  });
  await expect(bill.getByText("Bate com o banco")).toBeVisible();
  await expect(bill.getByText("Fechada")).toBeVisible();
  await expect(bill.getByText("Não cobrado pelo banco: fora da soma")).toBeVisible();

  const chat = page.getByRole("group", { name: /Exemplo de conversa/ });
  await chat.scrollIntoViewIfNeeded();
  await expect(chat.getByText(/Você gastou R\$ 1\.172,35 com Mercado/)).toBeVisible();
  await expect(chat.getByText("14 transações")).toBeVisible({ timeout: 8000 });
});

test.describe("with reduced motion", () => {
  test.use({ reducedMotion: "reduce" });

  test("everything is already in place, with no animation", async ({ page }) => {
    const { problems } = await open(page);
    const animated = await page.evaluate(() =>
      [...document.querySelectorAll(".lp *")].filter((el) => getComputedStyle(el).animationName !== "none").map((el) => el.className.toString()),
    );
    expect(animated).toEqual([]);
    await expect(page.locator(".lp-progress")).toBeHidden();
    await expect(page.getByRole("button", { name: "Pausar animações" })).toBeHidden();

    // The finished bill and the finished conversation, without scrolling through any story.
    const bill = page.getByRole("figure", { name: /Exemplo de fatura conferida/ });
    await bill.scrollIntoViewIfNeeded();
    await expect(bill.getByText("Bate com o banco")).toBeVisible();
    for (const row of await bill.locator(".lp-row").all()) await expect(row).toHaveCSS("opacity", "1");
    const chat = page.getByRole("group", { name: /Exemplo de conversa/ });
    await chat.scrollIntoViewIfNeeded();
    await expect(chat.getByText("14 transações")).toBeVisible();
    await expect(chat.getByText(/Você gastou R\$ 1\.172,35/)).toHaveCSS("opacity", "1");
    expect(problems).toEqual([]);
  });
});

test("the pause button stops the decorative loops", async ({ page }) => {
  await open(page);
  const button = page.getByRole("button", { name: "Pausar animações" });
  await button.click();
  await expect(page.getByRole("button", { name: "Retomar animações" })).toBeVisible();
  await expect(page.locator(".lp-rosette").first()).toHaveCSS("animation-play-state", "paused");
  await expect(page.locator(".lp-phone-float")).toHaveCSS("animation-play-state", "paused");
});
