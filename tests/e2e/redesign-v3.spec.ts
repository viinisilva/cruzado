// The finance views added in redesign v3: categories and recurring charges, plus the tabs that reach them on phones.
import { expect, test, type Page } from "@playwright/test";

async function enterDemo(page: Page) {
  await page.goto("/entrar");
  await page.getByRole("button", { name: "Entrar no modo demonstração" }).click();
  await expect(page).toHaveURL(/\/inicio$/);
}

const money = (text: string | null) => text?.match(/[\d.]+,\d{2}/)?.[0];

/** Clicks a link and waits for the address to change, so a second click never lands on the old page. */
async function go(page: Page, link: ReturnType<Page["getByRole"]>) {
  const before = page.url();
  await link.click();
  await expect(page).not.toHaveURL(before);
}

test("categories page opens exactly that category", async ({ page }) => {
  await enterDemo(page);
  await page.goto("/categorias");
  await expect(page.getByRole("heading", { name: "Categorias", level: 1 })).toBeVisible();
  const link = page.getByRole("list", { name: "Categorias do mês" }).getByRole("link").first();
  const total = money(await link.textContent());
  expect(total).toBeTruthy();
  await link.click();
  await expect(page).toHaveURL(/categoria=/);
  await expect(page.getByText("Saídas", { exact: true }).locator("..")).toContainText(total!);
});

test("categories month lives in the URL and never goes past this month", async ({ page }) => {
  await enterDemo(page);
  await page.goto("/categorias?mes=2099-01");
  await expect(page.getByRole("link", { name: "Próximo mês" })).toHaveCount(0);
  await page.getByRole("link", { name: "Mês anterior" }).click();
  await expect(page).toHaveURL(/mes=\d{4}-\d{2}/);
});

test("recurring page lists detected subscriptions as an estimate", async ({ page }) => {
  await enterDemo(page);
  await page.goto("/recorrentes");
  await expect(page.getByRole("heading", { name: "Recorrentes", level: 1 })).toBeVisible();
  await expect(page.getByText("Estimado pelo histórico. Não confirmado com o banco.")).toBeVisible();
  await expect(page.getByRole("list", { name: "Cobranças recorrentes" }).getByRole("listitem").first()).toBeVisible();
});

test("the one navigation reaches the other views without sideways page scroll", async ({ page, isMobile }) => {
  await enterDemo(page);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  const nav = page.getByRole("navigation", { name: "Principal" }).filter({ visible: true });
  // On a phone the rest lives behind "Mais"; on a computer the sidebar lists it.
  if (isMobile) await nav.getByRole("link", { name: "Mais" }).click();
  await page.getByRole("link", { name: /^Categorias/ }).filter({ visible: true }).first().click();
  await expect(page).toHaveURL(/\/categorias$/);
  if (isMobile) await expect(nav.getByRole("link", { name: "Mais" })).toHaveAttribute("aria-current", "page");
  else await expect(nav.getByRole("link", { name: "Categorias" })).toHaveAttribute("aria-current", "page");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});

test("hidden values leave no amount, percent or chart on the new views", async ({ page }) => {
  await enterDemo(page);
  await page.getByRole("button", { name: "Ocultar valores" }).click();
  for (const href of ["/inicio", "/categorias", "/recorrentes"]) {
    await page.goto(href);
    await expect(page.getByRole("button", { name: "Mostrar valores" })).toBeVisible();
    const seen = await page.evaluate(() => {
      const main = document.querySelector("main")!;
      main.querySelectorAll("details").forEach((d) => (d.open = true));
      return { text: main.innerText, charts: main.querySelectorAll('svg[role="img"], [role="meter"]').length };
    });
    expect(seen.text, href).not.toMatch(/R\$\s?\d/);
    expect(seen.text, href).not.toMatch(/\d+(,\d+)?%/);
    expect(seen.charts, href).toBe(0);
  }
});

test("a recurring row opens one of its real charges", async ({ page }) => {
  await enterDemo(page);
  await page.goto("/recorrentes");
  await page.getByRole("list", { name: "Cobranças recorrentes" }).getByRole("link").first().click();
  await expect(page).toHaveURL(/\/transacoes\/[^/?]+$/);
  await expect(page.getByRole("heading", { level: 1 })).not.toHaveText("Transações");
});

test("hidden values do not color income rows in transactions", async ({ page }) => {
  await enterDemo(page);
  await page.getByRole("button", { name: "Ocultar valores" }).click();
  await page.goto("/transacoes");
  await expect(page.getByRole("button", { name: "Mostrar valores" })).toBeVisible();
  const colored = await page.evaluate(() => [...document.querySelectorAll("main .text-positive, main .text-risk")].filter((e) => e.textContent?.includes("•")).length);
  expect(colored).toBe(0);
});

test("summary figures in transactions stay on one line", async ({ page }) => {
  await enterDemo(page);
  await page.goto("/transacoes");
  const heights = await page.getByRole("region", { name: "Resumo do período" }).locator("dd").evaluateAll((dds) => dds.map((d) => Math.round(d.getBoundingClientRect().height)));
  for (const h of heights) expect(h).toBeLessThanOrEqual(34);
});

test("pace chart axis labels are readable at any width", async ({ page }) => {
  await enterDemo(page);
  const sizes = await page.getByRole("region", { name: "Ritmo de gastos" }).locator("[data-axis]").evaluateAll((els) => els.map((e) => e.getBoundingClientRect().height));
  expect(sizes.length).toBeGreaterThan(0);
  for (const h of sizes) expect(h).toBeGreaterThanOrEqual(12);
});

test("the statement month can be chosen, back to closed ones and ahead to forecasts", async ({ page }) => {
  await enterDemo(page);
  await page.goto("/cartoes");
  const nav = page.getByRole("navigation", { name: "Mês da fatura" });
  const heading = page.getByRole("heading", { name: /^Fatura de / });
  const start = await heading.textContent();
  await go(page, nav.getByRole("link", { name: "Fatura anterior" }));
  await expect(page).toHaveURL(/mes=\d{4}-\d{2}/);
  await expect(heading).not.toHaveText(start!);
  await expect(page.getByRole("listitem").filter({ hasText: "Compras de" }).first()).toContainText("Fechada");
  await page.getByRole("navigation", { name: "Escolher cartão" }).getByRole("link", { name: "Cartão Nimbus" }).click();
  await expect(page).toHaveURL(/mes=\d{4}-\d{2}/);
  await go(page, nav.getByRole("link", { name: "Próxima fatura" }));
  await go(page, nav.getByRole("link", { name: "Próxima fatura" }));
  await expect(page.getByRole("listitem").filter({ hasText: "Compras de" }).first()).toContainText("Prevista");
});

test("installments can be browsed month by month, earlier charges and later forecasts", async ({ page }) => {
  await enterDemo(page);
  await page.goto("/cartoes?aba=parcelas");
  const nav = page.getByRole("navigation", { name: "Mês das parcelas" });
  const table = page.getByRole("table", { name: /^Parcelas de / });
  await go(page, nav.getByRole("link", { name: "Mês anterior" }));
  await expect(page).toHaveURL(/aba=parcelas/);
  await expect(page).toHaveURL(/mes=\d{4}-\d{2}/);
  await expect(table.getByRole("row").filter({ hasText: "Cobrada" }).first()).toBeVisible();
  await go(page, nav.getByRole("link", { name: "Próximo mês" }));
  await go(page, nav.getByRole("link", { name: "Próximo mês" }));
  await expect(table.getByRole("row").filter({ hasText: "Prevista" }).first()).toBeVisible();
});
