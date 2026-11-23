// The app's simpler shell (design phase 2): one navigation with "Mais", "Meus avisos" apart from "Notificações", the bill
// check in plain words, the demo notice once, and a login that asks only for e-mail and password first.
import { expect, test, type Page } from "@playwright/test";

async function enterDemo(page: Page) {
  await page.goto("/entrar");
  await page.getByRole("button", { name: "Entrar no modo demonstração" }).click();
  await expect(page).toHaveURL(/\/inicio$/);
}

test("login asks only for e-mail and password first, under the banknote panel", async ({ page }) => {
  await page.goto("/entrar");
  await expect(page.getByLabel("E-mail")).toBeVisible();
  await expect(page.getByLabel("Senha")).toBeVisible();
  await expect(page.getByLabel("Código de verificação")).toHaveCount(0);
  await expect(page.getByText("Seu dinheiro, com a prova de cada número.")).toBeVisible();
  await expect(page.getByRole("link", { name: "Sobre o Cruzado" })).toHaveAttribute("href", "/");
});

test("one navigation: four daily places and Mais, no tabs on top, the demo notice once", async ({ page, isMobile }) => {
  await enterDemo(page);
  const nav = page.getByRole("navigation", { name: "Principal" }).filter({ visible: true });
  for (const name of ["Início", "Transações", "Cartões", "Perguntar"]) await expect(nav.getByRole("link", { name, exact: true })).toBeVisible();
  if (isMobile) await expect(nav.getByRole("link", { name: "Mais" })).toBeVisible();
  else for (const name of ["Meus avisos", "Notificações", "Configurações"]) await expect(nav.getByRole("link", { name, exact: true })).toBeVisible();
  await expect(page.getByRole("navigation", { name: "Visões de finanças" })).toHaveCount(0);
  await expect(page.getByText("Você está vendo dados de exemplo.")).toHaveCount(1);
  await expect(page.locator("header").getByText(/^Demo|^Demonstração$/)).toHaveCount(0);

  await nav.getByRole("link", { name: "Cartões", exact: true }).click();
  await expect(page).toHaveURL(/\/cartoes/);
  await expect(nav.getByRole("link", { name: "Cartões", exact: true })).toHaveAttribute("aria-current", "page");
});

test("Mais tells what each place is for, and Meus avisos is not Notificações", async ({ page }) => {
  await enterDemo(page);
  await page.goto("/mais");
  await expect(page.getByRole("heading", { name: "Mais", level: 1 })).toBeVisible();
  const main = page.locator("main");
  await expect(main.getByRole("link", { name: /Meus avisos As regras que você escolhe/ })).toHaveAttribute("href", "/agentes");
  await expect(main.getByRole("link", { name: /Notificações O que os seus avisos já encontraram/ })).toHaveAttribute("href", "/alertas");
  await main.getByRole("link", { name: /Meus avisos/ }).click();
  await expect(page.getByRole("heading", { name: "Meus avisos", level: 1 })).toBeVisible();
  await expect(page.getByText(/Os avisos que já chegaram ficam em Notificações/)).toBeVisible();
  await expect(page.locator("main")).not.toContainText(/America\/Sao_Paulo|Executar agora|agente/);
  await page.goto("/alertas");
  await expect(page.getByRole("heading", { name: "Notificações", level: 1 })).toBeVisible();
});

test("the bill check opens with one plain sentence and keeps the method behind Como calculamos?", async ({ page }) => {
  await enterDemo(page);
  await page.goto("/cartoes");
  await page.getByRole("link", { name: /Conferir a fatura/ }).first().click();
  await expect(page.getByRole("heading", { name: "Conferir fatura", level: 1 })).toBeVisible();
  const summary = page.getByRole("region", { name: /^Fatura de / });
  await expect(summary.getByText(/soma|fechou em/).first()).toBeVisible();
  const how = summary.locator("details", { hasText: "Como calculamos?" });
  await expect(how).not.toHaveAttribute("open", "");
  await how.locator("summary").click();
  await expect(how).toHaveAttribute("open", "");
  // The usual reason is not repeated on every row.
  await expect(page.getByText("Entrou pela data, dentro do período da fatura.")).toHaveCount(0);
});
