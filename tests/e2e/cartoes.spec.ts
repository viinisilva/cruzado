// Finding a card without going to Settings, and every total leading to the entries behind it. Fictitious data only.
import { randomUUID } from "node:crypto";
import { expect, test, type Page } from "@playwright/test";

const LONG_NAME = "Cartão Internacional Corporativo Platinum Ultra Benefícios V";

async function enterDemo(page: Page) {
  await page.goto("/entrar");
  await page.getByRole("button", { name: "Entrar no modo demonstração" }).click();
  await expect(page).toHaveURL(/\/inicio$/);
}

async function signUp(page: Page) {
  await page.goto("/cadastro");
  await page.getByLabel("Nome").fill("Pessoa Sem Cartão");
  await page.getByLabel("E-mail").fill(`cartoes-${randomUUID()}@exemplo.test`);
  await page.getByLabel("Senha").fill(randomUUID());
  await page.getByRole("checkbox").check();
  await page.getByRole("button", { name: "Criar conta" }).click();
  await expect(page).toHaveURL(/\/comecar$/);
}

async function addCard(page: Page, name: string, limit = "1.000,00") {
  await page.goto("/configuracoes?aba=contas");
  await page.getByText("Adicionar conta ou cartão").click();
  const form = page.locator("details", { hasText: "Adicionar conta ou cartão" });
  await form.getByLabel("Nome").fill(name);
  await form.getByLabel("Instituição").fill("Banco Fictício");
  await form.getByLabel("Tipo").selectOption("credit_card");
  await form.getByLabel("Limite (R$)").fill(limit);
  await form.getByLabel("Dia de fechamento").fill("31");
  await form.getByLabel("Dia de vencimento").fill("10");
  await form.getByRole("button", { name: "Adicionar conta" }).click();
  await expect(form.getByRole("status").or(form.getByRole("note"))).toBeVisible();
}

async function addPurchase(page: Page, description: string, value: string, account: string) {
  await page.goto("/transacoes/novo");
  await page.getByLabel("Descrição", { exact: true }).fill(description);
  await page.getByLabel("Valor (R$)").fill(value);
  await page.getByLabel("Conta").selectOption({ label: account });
  await page.getByRole("button", { name: "Adicionar transação" }).click();
  await expect(page.getByText("Transação adicionada.")).toBeVisible();
}

const money = (text: string | null) => text?.match(/[\d.]+,\d{2}/)?.[0];
const total = (page: Page) => page.getByTestId("cartoes-total");
const noSideScroll = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);

test("cards are reachable from the home page and the choice survives every tab", async ({ page }) => {
  await enterDemo(page);
  await page.getByRole("navigation", { name: "Atalhos" }).getByRole("link", { name: "Ver cartões" }).click();
  await expect(page.getByRole("heading", { name: "Cartões", level: 1 })).toBeVisible();

  const picker = page.getByRole("navigation", { name: "Escolher cartão" });
  await expect(picker.getByRole("link", { name: "Todos os cartões" })).toHaveAttribute("aria-current", "true");
  await picker.getByRole("link", { name: "Cartão Nimbus" }).click();
  await expect(page).toHaveURL(/cartao=/);
  await expect(picker.getByRole("link", { name: "Cartão Nimbus" })).toHaveAttribute("aria-current", "true");
  await expect(page.getByText("Mostrando só Cartão Nimbus.")).toBeVisible();

  const tabs = page.getByRole("navigation", { name: "Detalhes dos cartões" });
  await tabs.getByRole("link", { name: "Parcelas" }).click();
  await expect(page).toHaveURL(/aba=parcelas/);
  await expect(page).toHaveURL(/cartao=/);
  await expect(page.getByRole("heading", { name: "Loja Casa & Cia Geladeira" })).toBeVisible();
  await tabs.getByRole("link", { name: "Limites" }).click();
  await expect(page).toHaveURL(/aba=limites/);
  await expect(page).toHaveURL(/cartao=/);
  await expect(page.getByText("Sobra estimada", { exact: true })).toBeVisible();
  await expect(picker.getByRole("link", { name: "Cartão Nimbus" })).toHaveAttribute("aria-current", "true");

  await page.goBack();
  await expect(page).toHaveURL(/aba=parcelas/);
  await expect(picker.getByRole("link", { name: "Cartão Nimbus" })).toHaveAttribute("aria-current", "true");
});

test("choosing a card changes the totals and the items together", async ({ page }) => {
  await enterDemo(page);
  await addCard(page, "Cartão Solar");
  await addPurchase(page, "Livraria Teste", "150,00", "Cartão Solar");
  await page.goto("/cartoes?aba=limites");
  const picker = page.getByRole("navigation", { name: "Escolher cartão" });

  const everything = money(await total(page).textContent());
  await expect(page.getByRole("heading", { name: "Cartão Nimbus" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Cartão Solar" })).toBeVisible();

  await picker.getByRole("link", { name: "Cartão Solar" }).click();
  await expect(total(page)).toContainText("150,00");
  await expect(total(page)).not.toContainText(everything!);
  await expect(page.getByRole("heading", { name: "Cartão Nimbus" })).toHaveCount(0);

  await page.getByRole("link", { name: "Ver todos os cartões" }).click();
  await expect(total(page)).toContainText(everything!);
});

test("a statement opens the entries that make up its total, and back restores the view", async ({ page }) => {
  await enterDemo(page);
  await page.goto("/cartoes");
  await page.getByRole("navigation", { name: "Escolher cartão" }).getByRole("link", { name: "Cartão Nimbus" }).click();
  await expect(page).toHaveURL(/cartao=/);
  const cards = page.url();
  const row = page.getByRole("listitem").filter({ hasText: "Compras de" }).first();
  const value = money(await row.textContent());
  await row.getByRole("link", { name: /^Ver \d+ lançamentos? da fatura/ }).click();
  await expect(page).toHaveURL(/fluxo=1/);
  await expect(page.getByRole("link", { name: "Remover filtro: Cartão Nimbus" })).toBeVisible();
  await expect(page.getByText("Resultado do período").locator("..")).toContainText(value!);
  await expect(page.getByRole("link", { name: "Ver faturas deste cartão" })).toBeVisible();
  await page.goBack();
  await expect(page).toHaveURL(cards);
  await expect(page.getByText("Mostrando só Cartão Nimbus.")).toBeVisible();
});

test("installments list only what is left and open the charged entries", async ({ page }) => {
  await enterDemo(page);
  await addCard(page, "Cartão Solar");
  await addPurchase(page, "Notebook Teste 1/3", "100,00", "Cartão Solar");
  await page.goto("/cartoes?aba=parcelas");
  const plan = page.getByRole("listitem").filter({ hasText: "Notebook Teste" });
  await expect(plan).toContainText("1 de 3");
  await expect(plan).toContainText("200,00");
  await expect(plan.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "1");
  await plan.getByRole("link", { name: /Ver parcelas lançadas/ }).click();
  await expect(page.getByText(/^1 transação\./)).toBeVisible();
});

test("hiding values leaves no amount in text, tooltips or accessible names", async ({ page }) => {
  await enterDemo(page);
  const leaks = () =>
    page.evaluate(() => {
      const main = document.querySelector("main")!;
      main.querySelectorAll("details").forEach((d) => (d.open = true));
      const attrs = [...main.querySelectorAll("[title],[aria-label]")].map((e) => `${e.getAttribute("title") ?? ""} ${e.getAttribute("aria-label") ?? ""}`);
      return { text: main.innerText, attrs: attrs.join(" "), bars: main.querySelectorAll('[role="meter"], [role="img"], title').length };
    });
  await page.goto("/cartoes");
  await page.getByRole("button", { name: "Ocultar valores" }).click();
  for (const href of ["/cartoes", "/cartoes?aba=parcelas", "/cartoes?aba=limites", "/contas", "/inicio"]) {
    await page.goto(href);
    await expect(page.getByRole("button", { name: "Mostrar valores" })).toBeVisible();
    const seen = await leaks();
    expect(seen.text, href).not.toMatch(/R\$\s?\d/);
    expect(seen.attrs, href).not.toMatch(/R\$\s?\d/);
    expect(seen.bars, href).toBe(0);
    if (href.includes("limites")) expect(seen.text).not.toMatch(/\d+% do limite/);
  }
});

test("someone without cards learns how to add one", async ({ page }) => {
  await signUp(page);
  await page.goto("/cartoes");
  await expect(page.getByText("Nenhum cartão ainda")).toBeVisible();
  await page.getByRole("link", { name: "Cadastrar cartão" }).click();
  await expect(page).toHaveURL(/configuracoes\?aba=contas/);
});

test("many cards use a select, long names do not break the page, and a tampered id shows everything", async ({ page }) => {
  test.setTimeout(120_000);
  await enterDemo(page);
  await addCard(page, LONG_NAME, "999.999.999,99");
  await addPurchase(page, "Compra grande fictícia", "9.876.543,21", LONG_NAME);
  await page.goto("/cartoes");
  await expect(page.getByText(/Cartão Internacional/).first()).toBeVisible();
  expect(await noSideScroll(page)).toBe(true);
  for (const name of ["Cartão Dois", "Cartão Três", "Cartão Quatro"]) await addCard(page, name);

  await page.goto("/cartoes?aba=limites");
  await expect(page.getByRole("navigation", { name: "Escolher cartão" })).toHaveCount(0);
  await page.getByLabel("Cartão", { exact: true }).selectOption({ label: "Cartão Três" });
  await expect(page).toHaveURL(/cartao=.*aba=limites/);
  await expect(page.getByRole("heading", { name: "Cartão Três" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Cartão Dois" })).toHaveCount(0);
  await expect(page.getByLabel("Cartão", { exact: true })).not.toHaveValue("");
  expect(await noSideScroll(page)).toBe(true);

  await page.goto("/cartoes?cartao=nao-existe");
  await expect(page.getByText(/^Mostrando 5 cartões\./)).toBeVisible();
  for (const aba of ["parcelas", "limites"]) {
    await page.goto(`/cartoes?aba=${aba}`);
    expect(await noSideScroll(page)).toBe(true);
  }
});

test("a card set up without a limit says so and never invents one", async ({ page }) => {
  await signUp(page);
  await page.getByRole("button", { name: "Mercado Pago" }).click();
  await page.getByRole("button", { name: "Criar minhas contas" }).click();
  await expect(page).not.toHaveURL(/\/comecar$/);
  await page.goto("/cartoes?aba=limites");
  await expect(page.getByText("Limite ainda não informado")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Cartão Mercado Pago" })).toBeVisible();
  await expect(page.getByText("Sobra estimada", { exact: true })).toHaveCount(0);
});

test("the tabs work from the keyboard and show focus", async ({ page, isMobile }) => {
  test.skip(isMobile, "teclado físico");
  await enterDemo(page);
  await page.goto("/cartoes");
  const tab = page.getByRole("navigation", { name: "Detalhes dos cartões" }).getByRole("link", { name: "Parcelas" });
  await tab.focus();
  expect(await tab.evaluate((e) => getComputedStyle(e).outlineStyle)).not.toBe("none");
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/aba=parcelas/);
});
