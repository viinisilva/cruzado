// Behaviors the redesign must keep true: numbers that lead to matching lists, filters that survive, private values.
import { expect, test, type Page } from "@playwright/test";

async function enterDemo(page: Page) {
  await page.goto("/entrar");
  await page.getByRole("button", { name: "Entrar no modo demonstração" }).click();
  await expect(page).toHaveURL(/\/inicio$/);
}

const money = (text: string | null) => text?.match(/[\d.]+,\d{2}/)?.[0];
const outflow = (page: Page) => page.getByText("Saídas", { exact: true }).locator("..");

test("period lives in the URL and the totals lead to lists that add up", async ({ page }) => {
  await enterDemo(page);
  const expenses = () => page.getByRole("link", { name: /R\$/ }).filter({ hasText: "−" });
  const thisMonth = money(await expenses().textContent());
  await page.getByRole("navigation", { name: "Período" }).getByRole("link", { name: "Mês passado" }).click();
  await expect(page).toHaveURL(/periodo=mes-passado/);
  await expect(expenses()).not.toContainText(thisMonth!);
  const lastMonth = money(await expenses().textContent());
  await expenses().click();
  await expect(page).toHaveURL(/fluxo=1/);
  await expect(page).toHaveURL(/tipo=despesa/);
  await expect(outflow(page)).toContainText(lastMonth!);
});

test("balance does not change with the period", async ({ page }) => {
  await enterDemo(page);
  const balance = await page.getByTestId("saldo-disponivel").textContent();
  await page.goto("/inicio?periodo=90d");
  await expect(page.getByTestId("saldo-disponivel")).toHaveText(balance!);
});

test("a category on the dashboard opens exactly that category", async ({ page }) => {
  await enterDemo(page);
  const link = page.getByRole("region", { name: "Gastos por categoria" }).getByRole("link").first();
  const total = money(await link.textContent());
  await link.click();
  await expect(page).toHaveURL(/categoria=/);
  await expect(outflow(page)).toContainText(total!);
});

test("uncategorized filter shows only uncategorized entries", async ({ page }) => {
  await enterDemo(page);
  await page.goto("/transacoes?novo=1");
  await expect(page).toHaveURL(/\/transacoes\/novo$/);
  await page.getByLabel("Descrição", { exact: true }).fill("Sem categoria de teste");
  await page.getByLabel("Valor (R$)").fill("12,34");
  await page.getByRole("button", { name: "Adicionar transação" }).click();
  await expect(page.getByText("Transação adicionada.")).toBeVisible();
  await page.goto("/transacoes?categoria=sem-categoria");
  await expect(page.getByRole("link", { name: /Sem categoria de teste/ })).toBeVisible();
  await expect(page.getByText(/^1 transação\./)).toBeVisible();
  await expect(page.getByRole("link", { name: "Remover filtro: Sem categoria" })).toBeVisible();
});

test("filters combine, survive each other and clear predictably", async ({ page }) => {
  await enterDemo(page);
  await page.goto("/transacoes");
  await page.getByRole("button", { name: /^Filtros/ }).click();
  const panel = page.getByRole("dialog", { name: "Filtros" });
  const boxes = panel.getByRole("checkbox");
  await boxes.nth(0).check();
  await boxes.nth(1).check();
  await panel.getByRole("button", { name: "Aplicar filtros" }).click();
  await expect(page).toHaveURL(/contas=/);
  await page.getByRole("button", { name: /^Filtros/ }).click();
  await panel.getByLabel("Tipo").selectOption("despesa");
  await panel.getByRole("button", { name: "Aplicar filtros" }).click();
  await expect(page).toHaveURL(/tipo=despesa/);
  await expect(page).toHaveURL(/contas=[^&]+(%2C|,|&contas=)/);
  await page.getByRole("button", { name: /^Período:/ }).click();
  await page.getByRole("dialog", { name: "Período" }).getByRole("link", { name: "Últimos 90 dias" }).click();
  await expect(page.getByRole("button", { name: /^Período: \d{2}\// })).toBeVisible();
  await expect(page).toHaveURL(/tipo=despesa/);
  await page.getByLabel("Buscar por descrição").fill("mercado");
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/q=mercado/);
  await expect(page).toHaveURL(/tipo=despesa/);
  await expect(page).toHaveURL(/contas=/);
  await expect(page).toHaveURL(/de=/);
  await page.getByRole("link", { name: "Limpar", exact: true }).click();
  await expect(page).not.toHaveURL(/tipo=|q=|contas=/);
  await expect(page).toHaveURL(/de=/);
});

test("more than 300 entries: totals cover the whole filter and pages are stable", async ({ page }) => {
  test.setTimeout(120_000);
  await enterDemo(page);
  await page.goto("/transacoes/importar");
  const lines = Array.from({ length: 350 }, (_, i) => `2026-10-01;Carga de teste ${i};-1,00`).join("\n");
  await page.getByLabel(/Extrato/).setInputFiles({ name: "carga.csv", mimeType: "text/csv", buffer: Buffer.from(`Data;Descrição;Valor\n${lines}\n`) });
  await page.getByRole("button", { name: "Importar 350 transações" }).click();
  await expect(page.getByText("Importação concluída")).toBeVisible();
  await page.goto("/transacoes?q=Carga");
  await expect(page.getByText(/350 transações/)).toBeVisible();
  await expect(outflow(page)).toContainText("350,00");
  await expect(page.getByText("Página 1 de 4")).toBeVisible();
  await expect(page.getByRole("link", { name: /Carga de teste/ })).toHaveCount(100);
  await page.getByRole("link", { name: "Próxima página" }).click();
  await expect(page.getByText("Página 2 de 4")).toBeVisible();
  await expect(page).toHaveURL(/q=Carga/);
  await expect(outflow(page)).toContainText("350,00");
  await page.goto("/transacoes?q=Carga&pagina=4");
  await expect(page.getByRole("link", { name: "Próxima página" })).toHaveCount(0);
  await expect(page.getByRole("link", { name: /Carga de teste/ })).toHaveCount(50);
});

test("values chosen hidden are hidden in the first HTML, before any script runs", async ({ page, context }) => {
  await enterDemo(page);
  await page.getByRole("button", { name: "Ocultar valores" }).click();
  await expect(page.getByRole("button", { name: "Mostrar valores" })).toBeVisible();
  const cookies = await context.cookies();
  const res = await context.request.get("/inicio", { headers: { cookie: cookies.map((c) => `${c.name}=${c.value}`).join("; ") } });
  const visible = (await res.text()).replace(/<script[\s\S]*?<\/script>/g, "");
  expect(visible).not.toMatch(/R\$(\s|&nbsp;| )?\d/);
});

test("hiding values leaves no amount on screen, in tooltips or in names", async ({ page }) => {
  await enterDemo(page);
  await page.getByRole("button", { name: "Ocultar valores" }).click();
  await expect(page.getByRole("button", { name: "Mostrar valores" })).toBeVisible();
  const leak = /R\$\s?\d/;
  for (const url of ["/inicio", "/transacoes", "/alertas", "/agentes", "/contas", "/configuracoes?aba=contas"]) {
    await page.goto(url);
    await expect(page.getByRole("button", { name: "Mostrar valores" })).toBeVisible();
    await expect(page.locator("main")).not.toContainText(leak);
    expect(await page.locator("main svg title").count(), url).toBe(0);
  }
  await page.goto("/chat?nova=1");
  await page.getByRole("button", { name: "Qual é o meu saldo consolidado?" }).click();
  await expect(page.getByText("Fatos calculados")).toBeVisible();
  await expect(page.locator("main")).not.toContainText(leak);
});

test("chat keeps the question on failure and a retry does not duplicate it", async ({ page }) => {
  await enterDemo(page);
  await page.goto("/chat?nova=1");
  let fail = true;
  await page.route("**/api/chat", async (route) => {
    if (fail) {
      fail = false;
      await route.abort();
    } else {
      await route.continue();
    }
  });
  const input = page.getByLabel("Sua pergunta");
  await input.fill("qual meu saldo?");
  await page.getByRole("button", { name: "Enviar pergunta" }).click();
  await expect(page.getByText("Sem conexão")).toBeVisible();
  await expect(input).toHaveValue("qual meu saldo?");
  await page.getByRole("button", { name: "Tentar novamente" }).click();
  await expect(page.getByText("Fatos calculados")).toBeVisible();
  await expect(page.getByRole("listitem").filter({ hasText: "Você:" })).toHaveCount(1);
  await expect(page.getByText("Sem conexão")).toHaveCount(0);
});

test("a template fills the form and only creates a draft", async ({ page }) => {
  await enterDemo(page);
  await page.goto("/agentes");
  const active = await page.getByRole("button", { name: "Pausar" }).count();
  await page.getByRole("link", { name: /Receber resumo semanal/ }).click();
  await expect(page).toHaveURL(/modelo=resumo-semanal/);
  const form = page.getByRole("region", { name: "Receber resumo semanal" });
  await expect(form.getByLabel("Nome")).toHaveValue("Resumo da semana");
  await form.getByRole("button", { name: "Criar rascunho" }).click();
  await expect(page.getByRole("heading", { name: "Resumo da semana", level: 3 })).toBeVisible();
  await expect(page.getByRole("button", { name: "Confirmar e ativar" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Pausar" })).toHaveCount(active);
});

test("demo data never claims a real bank connection", async ({ page }) => {
  await enterDemo(page);
  await expect(page.locator("main")).not.toContainText("banco atualizado");
  await page.goto("/contas");
  await expect(page.locator("main")).not.toContainText("Conectada");
});

test("very long text and very large values do not break the layout", async ({ page }) => {
  await enterDemo(page);
  await page.goto("/transacoes/importar");
  const long = `Compra com uma descrição extremamente comprida ${"x".repeat(120)}`;
  await page.getByLabel(/Extrato/).setInputFiles({ name: "grande.csv", mimeType: "text/csv", buffer: Buffer.from(`Data;Descrição;Valor\n2026-10-01;${long};9.999.999,99\n`) });
  await page.getByRole("button", { name: "Importar 1 transação" }).click();
  await expect(page.getByText("Importação concluída")).toBeVisible();
  for (const url of ["/transacoes?q=extremamente", "/inicio", "/contas"]) {
    await page.goto(url);
    await expect(page.locator("main")).toBeVisible();
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow, url).toBe(0);
  }
});

test("keyboard reaches the skip link, the main actions and shows focus", async ({ page, isMobile }) => {
  test.skip(isMobile, "teclado físico");
  await enterDemo(page);
  await page.goto("/inicio");
  await page.keyboard.press("Tab");
  await expect(page.getByRole("link", { name: "Pular para o conteúdo" })).toBeFocused();
  const period = page.getByRole("navigation", { name: "Período" }).getByRole("link", { name: "90 dias" });
  await period.focus();
  await expect(period).toBeFocused();
  expect(await period.evaluate((e) => getComputedStyle(e).outlineStyle)).not.toBe("none");
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/periodo=90d/);
});

test("accounts page shows origin and leads to transactions", async ({ page }) => {
  await enterDemo(page);
  await page.getByRole("region", { name: "Contas e cartões" }).getByRole("link", { name: "Ver todas" }).click();
  await expect(page.getByRole("heading", { name: "Contas e cartões", level: 1 })).toBeVisible();
  await expect(page.locator("main").getByText("Demonstração").first()).toBeVisible();
  await page.getByRole("link", { name: "Ver transações" }).first().click();
  await expect(page).toHaveURL(/contas=/);
});
