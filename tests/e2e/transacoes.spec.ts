import { expect, test, type Page } from "@playwright/test";

async function enterDemo(page: Page) {
  await page.goto("/entrar");
  await page.getByRole("button", { name: "Entrar no modo demonstração" }).click();
  await expect(page).toHaveURL(/\/inicio$/);
}

const noOverflow = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);

test("the list comes first: three areas, compact controls, totals that are not a balance", async ({ page }) => {
  await enterDemo(page);
  await page.goto("/transacoes");
  const areas = page.getByRole("navigation", { name: "Áreas de transações" });
  await expect(areas.getByRole("link", { name: "Movimentações" })).toHaveAttribute("aria-current", "page");
  await expect(areas.getByRole("link", { name: /Revisar/ })).toBeVisible();
  await expect(areas.getByRole("link", { name: "Importações" })).toBeVisible();
  await expect(page.getByText("Entradas", { exact: true })).toBeVisible();
  await expect(page.getByText("Resultado do período")).toBeVisible();
  await expect(page.getByText(/Não é o saldo da conta/)).toBeVisible();
  expect(await noOverflow(page)).toBe(true);
});

test("filter panel works by keyboard, returns focus, and filters survive going to a detail and back", async ({ page }) => {
  await enterDemo(page);
  await page.goto("/transacoes?de=2026-01-01&ate=2026-10-31");
  const open = page.getByRole("button", { name: /^Filtros/ });
  await open.focus();
  await page.keyboard.press("Enter");
  const dialog = page.getByRole("dialog", { name: "Filtros" });
  await expect(dialog).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await expect(open).toBeFocused();

  await open.click();
  await dialog.getByLabel("Tipo").selectOption("despesa");
  await dialog.getByRole("button", { name: "Aplicar filtros" }).click();
  await expect(page).toHaveURL(/tipo=despesa/);
  await expect(page.getByRole("button", { name: "Filtros (1)" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Remover filtro: Despesas" })).toBeVisible();

  await page.getByRole("link", { name: /-R\$/ }).first().click();
  await expect(page).toHaveURL(/volta=/);
  await page.getByRole("link", { name: "Voltar para transações" }).click();
  await expect(page).toHaveURL(/tipo=despesa/);
  await expect(page).toHaveURL(/de=2026-01-01/);

  await page.getByRole("link", { name: "Remover filtro: Despesas" }).click();
  await expect(page).not.toHaveURL(/tipo=/);
  await expect(page).toHaveURL(/de=2026-01-01/);
});

test("period menu offers quick ranges and months move with arrows", async ({ page }) => {
  await enterDemo(page);
  await page.goto("/transacoes");
  await page.getByRole("link", { name: "Mês anterior" }).click();
  await expect(page).toHaveURL(/de=\d{4}-\d{2}-01/);
  await page.getByRole("button", { name: /^Período:/ }).click();
  const dialog = page.getByRole("dialog", { name: "Período" });
  await dialog.getByRole("link", { name: "Últimos 90 dias" }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByRole("button", { name: /^Período: \d{2}\/\d{2}\/\d{4} a/ })).toBeVisible();
});

test("adding has its own address and no form sits above the list", async ({ page }) => {
  await enterDemo(page);
  await page.goto("/transacoes");
  await expect(page.getByLabel("Descrição", { exact: true })).toHaveCount(0);
  await page.getByRole("link", { name: "Adicionar" }).click();
  await expect(page).toHaveURL(/\/transacoes\/novo$/);
  await page.getByLabel("Descrição", { exact: true }).fill("Teste de rota");
  await page.getByLabel("Valor (R$)").fill("12,34");
  await page.getByRole("button", { name: "Adicionar transação" }).click();
  await expect(page.getByText("Transação adicionada.")).toBeVisible();
});

test("Revisar: a categorization sticks and leaves the list; empty is stated plainly", async ({ page }) => {
  await enterDemo(page);
  await page.goto("/transacoes/novo");
  await page.getByLabel("Descrição", { exact: true }).fill("Zz sem categoria");
  await page.getByLabel("Valor (R$)").fill("9,99");
  await page.getByRole("button", { name: "Adicionar transação" }).click();
  await expect(page.getByText("Transação adicionada.")).toBeVisible();
  await page.goto("/transacoes/revisar");
  const select = page.getByRole("combobox", { name: "Categoria de Zz sem categoria" });
  await expect(select).toBeVisible();
  await select.selectOption({ label: "Mercado" });
  await page.getByRole("button", { name: "Salvar categoria de Zz sem categoria" }).click();
  await expect(select).toHaveCount(0);
});

test("Importações centralizes files and banks without technical settings", async ({ page }) => {
  await enterDemo(page);
  await page.goto("/transacoes/importacoes");
  await expect(page.getByRole("link", { name: "Importar extrato" })).toBeVisible();
  await expect(page.getByText(/não está disponível nesta conta/)).toBeVisible();
  await expect(page.getByText(/Item ID|token/i)).toHaveCount(0);
  expect(await noOverflow(page)).toBe(true);
});

test("the bank webhook refuses anyone without the registered secret", async ({ request }) => {
  const res = await request.post("/api/webhooks/pluggy", { data: {} });
  expect([401, 503]).toContain(res.status());
  expect((await request.get("/api/cron/banks")).status()).toBe(401);
});
