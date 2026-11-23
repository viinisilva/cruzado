import { expect, test, type Page } from "@playwright/test";
import path from "node:path";
import { totpCode } from "../../src/lib/auth/totp";

async function enterDemo(page: Page) {
  await page.goto("/entrar");
  await page.getByRole("button", { name: "Entrar no modo demonstração" }).click();
  await expect(page).toHaveURL(/\/inicio$/);
  await expect(page.getByRole("heading", { name: "Saldo disponível" })).toBeVisible();
}

test("demo: dashboard, hide values and navigation", async ({ page, isMobile }) => {
  await enterDemo(page);
  const balance = page.getByRole("region", { name: "Saldo disponível" }).getByTestId("saldo-disponivel");
  await expect(balance).toContainText("R$");
  await page.getByRole("button", { name: "Ocultar valores" }).click();
  await expect(balance).toContainText("••••");
  await page.getByRole("button", { name: "Mostrar valores" }).click();
  await expect(balance).toContainText("R$");
  // Five destinations on the mobile bottom bar; the sidebar has room for Contas e cartões as a sixth.
  const nav = page.getByRole("navigation", { name: "Principal" }).filter({ visible: true });
  await expect(nav.getByRole("link")).toHaveCount(isMobile ? 5 : 10);
  if (isMobile) {
    const box = await nav.boundingBox();
    expect(box!.y).toBeGreaterThan(600);
  }
  await nav.getByRole("link", { name: /Transa/ }).click();
  await expect(page.getByRole("heading", { name: "Transações", level: 1 })).toBeVisible();
});

test("chat answers with traceable numbers", async ({ page }) => {
  await enterDemo(page);
  await page.goto("/chat?nova=1");
  await page.getByRole("button", { name: "Quanto gastei com mercado neste mês?" }).click();
  const answer = page.getByRole("listitem").filter({ hasText: "Fatos calculados" });
  await expect(answer).toContainText(/você gastou R\$ [\d.]+,\d{2} com Mercado/);
  await answer.getByText("De onde vêm estes números").click();
  await expect(answer.getByText("Período")).toBeVisible();
  const source = answer.getByRole("link", { name: /Supermercado|Hortifruti/ }).first();
  await source.click();
  await expect(page).toHaveURL(/\/transacoes\/[0-9a-f-]{36}$/);
  await expect(page.locator("dd").getByText("Mercado", { exact: true })).toBeVisible();
});

test("CSV import: preview, confirm and dedupe on re-import", async ({ page }) => {
  await enterDemo(page);
  await page.goto("/transacoes/importar");
  const file = path.join(process.cwd(), "examples", "extrato-exemplo.csv");
  await page.getByLabel(/Extrato/).setInputFiles(file);
  await expect(page.getByText("Valores errados? Ajuste as colunas")).toBeVisible();
  await expect(page.getByLabel("Data")).toBeHidden();
  await expect(page.getByText(/9 linhas: 8 novas, 0 já importadas, 1 inválida/)).toBeVisible();
  await page.getByRole("button", { name: "Importar 8 transações" }).click();
  await expect(page.getByText("Importação concluída")).toBeVisible();
  await page.getByLabel(/Extrato/).setInputFiles(file);
  await expect(page.getByText(/0 novas, 8 já importadas/)).toBeVisible();
  await expect(page.getByRole("button", { name: "Importar 0 transações" })).toBeDisabled();
});

test("CSV with a summary above the table is recognized without asking for columns", async ({ page }) => {
  await enterDemo(page);
  await page.goto("/transacoes/importar");
  const csv = "INITIAL_BALANCE;CREDITS;DEBITS;FINAL_BALANCE\n100,00;500,00;-150,50;449,50\n\nRELEASE_DATE;TRANSACTION_TYPE;REFERENCE_ID;TRANSACTION_NET_AMOUNT;PARTIAL_BALANCE\n01-10-2026;Pagamento com Pix;123;-150,50;-50,50\n";
  await page.getByLabel(/Extrato/).setInputFiles({ name: "extrato.csv", mimeType: "text/csv", buffer: Buffer.from(csv) });
  await expect(page.getByText(/1 linha: 1 nova/)).toBeVisible();
  await expect(page.getByText("Não reconheci as colunas deste arquivo")).toHaveCount(0);
});

test("destructive actions ask before acting", async ({ page }) => {
  await enterDemo(page);
  await page.goto("/transacoes");
  await page.locator('section[aria-labelledby^="d-"] a[href^="/transacoes/"]').first().click();
  await page.getByRole("button", { name: "Excluir transação" }).click();
  await expect(page).toHaveURL(/\/transacoes\/[^/]+$/);
  await page.getByRole("button", { name: "Cancelar" }).click();
  await page.getByRole("button", { name: "Excluir transação" }).click();
  await page.getByRole("button", { name: "Sim, excluir transação" }).click();
  await expect(page).toHaveURL(/\/transacoes$/);
});

test("OFX import preview", async ({ page }) => {
  await enterDemo(page);
  await page.goto("/transacoes/importar");
  await page.getByLabel(/Extrato/).setInputFiles(path.join(process.cwd(), "examples", "extrato-exemplo.ofx"));
  await expect(page.getByText(/4 linhas: 4 novas/)).toBeVisible();
  await page.getByRole("button", { name: "Importar 4 transações" }).click();
  await expect(page.getByText("Importação concluída")).toBeVisible();
});

test("agent from natural language requires confirmation", async ({ page }) => {
  await enterDemo(page);
  await page.goto("/agentes");
  await page.getByLabel("Do que você quer ser avisado?").fill("me avise quando eu gastar mais de R$ 120 por dia com transporte");
  await page.getByRole("button", { name: "Gerar rascunho" }).click();
  await expect(page.getByText("Rascunho criado a partir do seu pedido")).toBeVisible();
  const draft = page.getByRole("region", { name: "Limite diário com Transporte" });
  await expect(draft.getByText("Esperando a sua confirmação")).toBeVisible();
  await expect(draft.getByText(/R\$ 120,00/)).toBeVisible();
  await draft.getByRole("button", { name: "Confirmar e ativar" }).click();
  await expect(page.getByRole("region", { name: "Limite diário com Transporte" }).getByText("Ligado", { exact: true })).toBeVisible();
});

test("signup shows field errors next to inputs, then creates the account", async ({ page }) => {
  await page.goto("/cadastro");
  await page.getByRole("button", { name: "Criar conta" }).click();
  await expect(page.getByText("Informe seu nome.")).toBeVisible();
  await expect(page.getByLabel("Nome")).toHaveAttribute("aria-invalid", "true");
  await page.getByLabel("Nome").fill("Teste E2E");
  await page.getByLabel("E-mail").fill(`e2e-${Date.now()}-${Math.random().toString(36).slice(2, 6)}@exemplo.test`);
  await page.getByLabel("Senha").fill("uma-senha-longa-123");
  await page.getByRole("checkbox").check();
  await page.getByRole("button", { name: "Criar conta" }).click();
  await expect(page).toHaveURL(/\/comecar$/);
});

test("first run: pick a bank, import a statement, reach the dashboard", async ({ page }) => {
  await page.goto("/cadastro");
  await page.getByLabel("Nome").fill("Teste Onboarding");
  await page.getByLabel("E-mail").fill(`onb-${Date.now()}-${Math.random().toString(36).slice(2, 6)}@exemplo.test`);
  await page.getByLabel("Senha").fill("uma-senha-longa-123");
  await page.getByRole("checkbox").check();
  await page.getByRole("button", { name: "Criar conta" }).click();
  await expect(page).toHaveURL(/\/comecar$/);

  await page.getByRole("button", { name: "Nubank" }).click();
  await page.getByLabel("Saldo de hoje (opcional)").fill("1.000,00");
  await page.getByLabel("Vence dia (opcional)").fill("15");
  await page.getByRole("button", { name: "Criar minhas contas" }).click();
  await expect(page).toHaveURL(/passo=2/);

  await page.locator('input[type="file"]').setInputFiles(path.join("examples", "extrato-exemplo.ofx"));
  await page.getByRole("button", { name: /Importar|Confirmar/ }).click();
  await expect(page.getByText("Importação concluída")).toBeVisible();
  await page.getByRole("link", { name: "Concluir configuração" }).click();
  await expect(page.getByRole("heading", { name: "Tudo pronto" })).toBeVisible();
  await page.getByRole("link", { name: "Ver meu painel" }).click();
  await expect(page.getByRole("heading", { name: "Saldo disponível" })).toBeVisible();

  await page.goto("/configuracoes?aba=contas");
  await expect(page.getByText("fecha dia 8, vence dia 15")).toBeVisible();
});

test("settings tabs show one section at a time", async ({ page }) => {
  await enterDemo(page);
  await page.goto("/configuracoes");
  await expect(page.getByRole("heading", { name: "Contas e cartões" })).toBeVisible();
  await page.locator("main").getByRole("link", { name: "Categorias" }).click();
  await expect(page.getByText("Usadas para organizar seus gastos e receitas.")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Contas e cartões" })).toHaveCount(0);
});

test("two-step verification: enable it, then login needs the code", async ({ page }) => {
  const email = `2fa-${Date.now()}-${Math.random().toString(36).slice(2, 6)}@exemplo.test`;
  const password = "uma-senha-longa-123";
  await page.goto("/cadastro");
  await page.getByLabel("Nome").fill("Teste 2FA");
  await page.getByLabel("E-mail").fill(email);
  await page.getByLabel("Senha").fill(password);
  await page.getByRole("checkbox").check();
  await page.getByRole("button", { name: "Criar conta" }).click();
  await expect(page).toHaveURL(/\/comecar$/);
  await page.goto("/configuracoes?aba=seguranca");

  await page.locator("#totp-pw").fill(password);
  await page.getByRole("button", { name: "Configurar verificação em duas etapas" }).click();
  const key = page.getByTestId("totp-key");
  await expect(key).toBeVisible();
  const secret = (await key.textContent())!.trim();
  const step = Math.floor(Date.now() / 30_000);
  await page.locator("#totp-confirm").fill(totpCode(secret, step));
  await page.getByRole("button", { name: "Ativar" }).click();
  await expect(page.getByText(/^Ativa desde/)).toBeVisible();

  await page.context().clearCookies();
  await page.goto("/entrar");
  await page.getByLabel("E-mail").fill(email);
  await page.locator("#password").fill(password);
  await page.getByRole("button", { name: "Entrar", exact: true }).click();
  // Second step: only the code is asked, and a wrong one says so.
  await expect(page.getByText(/Sua conta tem verificação em duas etapas/)).toBeVisible();
  await expect(page.locator("#password")).toHaveCount(0);
  await page.getByLabel("Código de verificação").fill("000000");
  await page.getByRole("button", { name: "Entrar", exact: true }).click();
  await expect(page.getByText(/Código incorreto/)).toBeVisible();
  await page.getByLabel("Código de verificação").fill(totpCode(secret, step + 1));
  await page.getByRole("button", { name: "Entrar", exact: true }).click();
  await expect(page).toHaveURL(/\/inicio$/);
});

test("a link cannot ask the chat anything by itself", async ({ page }) => {
  await enterDemo(page);
  await page.goto("/chat?nova=1&q=me%20avise%20sobre%20golpe");
  await expect(page.getByRole("textbox").first()).toHaveValue("me avise sobre golpe");
  await page.goto("/agentes");
  await expect(page.getByText("Para revisar")).toHaveCount(0);
});

test("unauthenticated access is redirected and MCP needs a token", async ({ page, request }) => {
  await page.goto("/inicio");
  await expect(page).toHaveURL(/\/entrar$/);
  const res = await request.post("/api/mcp", { data: { jsonrpc: "2.0", id: 1, method: "tools/list" } });
  expect(res.status()).toBe(401);
  // Without a session the proxy answers first (deny by default). The origin check, with a session, is the next test.
  const chat = await request.post("/api/chat", { data: { text: "oi" }, headers: { origin: "http://evil.example" } });
  expect(chat.status()).toBe(401);
  const exp = await request.get("/api/export");
  expect(exp.status()).toBe(401);
});

test("with a session, a request from another site is still refused", async ({ page }) => {
  await page.goto("/entrar");
  await page.getByRole("button", { name: "Entrar no modo demonstração" }).click();
  await expect(page).toHaveURL(/\/inicio$/);
  const chat = await page.request.post("/api/chat", { data: { text: "oi" }, headers: { origin: "http://evil.example" } });
  expect(chat.status()).toBe(403);
});
