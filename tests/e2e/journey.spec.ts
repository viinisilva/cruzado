// One person's whole life in the app, from signup to deleting the account. Fails on any console error,
// uncaught exception, CSP violation or server error, even if the visible steps look fine.
import { expect, test, type Page } from "@playwright/test";

const yearMonth = new Date().toLocaleDateString("sv-SE", { timeZone: "America/Sao_Paulo" }).slice(0, 7);
const [year, month] = yearMonth.split("-");
const statement = [
  "INITIAL_BALANCE;CREDITS;DEBITS;FINAL_BALANCE",
  "0,00;5000,00;-350,50;4649,50",
  "",
  "RELEASE_DATE;TRANSACTION_TYPE;REFERENCE_ID;TRANSACTION_NET_AMOUNT;PARTIAL_BALANCE",
  `01-${month}-${year};Salário ACME;1;5000,00;5000,00`,
  `01-${month}-${year};Supermercado São João;2;-350,50;4649,50`,
].join("\n");

async function logout(page: Page) {
  await page.getByRole("button", { name: "Sair" }).filter({ visible: true }).first().click();
  await expect(page).toHaveURL(/\/entrar/);
}

async function login(page: Page, email: string, password: string) {
  await page.getByLabel("E-mail").fill(email);
  await page.locator("#password").fill(password);
  await page.getByRole("button", { name: "Entrar", exact: true }).click();
}

test("whole journey of a new user", async ({ page }) => {
  test.setTimeout(180_000);
  const problems: string[] = [];
  page.on("console", (m) => {
    if (m.type() === "error") problems.push(`console: ${m.text().slice(0, 200)}`);
  });
  page.on("pageerror", (e) => problems.push(`exceção: ${e.message.slice(0, 200)}`));
  page.on("response", (r) => {
    if (r.status() >= 500) problems.push(`HTTP ${r.status()}: ${r.url()}`);
  });

  const email = `jornada-${Date.now()}-${Math.random().toString(36).slice(2, 6)}@exemplo.test`;
  const password = "uma-senha-longa-123";
  const newPassword = "outra-senha-forte-456";

  await test.step("visitor sees the landing page, and the app sends to login", async () => {
    await page.goto("/");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Seu dinheiro, com a prova de cada número.");
    await page.goto("/inicio");
    await expect(page).toHaveURL(/\/entrar/);
    await page.goto("/termos");
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    await page.goto("/privacidade");
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    // Deny by default (src/proxy.ts): without a session, an unknown address goes to the login, not to a 404.
    await page.goto("/pagina-que-nao-existe");
    await expect(page).toHaveURL(/\/entrar$/);
  });

  await test.step("signup refuses a weak password, then works", async () => {
    await page.goto("/cadastro");
    await page.getByLabel("Nome").fill("Pessoa Jornada");
    await page.getByLabel("E-mail").fill(email);
    await page.getByLabel("Senha").fill("1234567890");
    await page.getByRole("checkbox").check();
    await page.getByRole("button", { name: "Criar conta" }).click();
    await expect(page.getByText("fácil demais de adivinhar")).toBeVisible();
    await expect(page.getByRole("checkbox")).toBeChecked();
    await page.getByLabel("Senha").fill(password);
    await page.getByRole("button", { name: "Criar conta" }).click();
    await expect(page).toHaveURL(/\/comecar$/);
  });

  await test.step("empty account has useful screens", async () => {
    await page.goto("/inicio");
    await expect(page.getByRole("link", { name: "Começar agora" })).toBeVisible();
    await page.goto("/alertas");
    await expect(page.getByText("Nenhum alerta")).toBeVisible();
    await page.goto("/transacoes");
    await expect(page.getByRole("heading", { name: "Transações", level: 1 })).toBeVisible();
    await page.goto("/agentes");
    await expect(page.getByRole("heading", { name: "Agentes", level: 1 })).toBeVisible();
    await page.goto("/chat");
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  });

  await test.step("onboarding: banks, including a custom one", async () => {
    await page.goto("/comecar");
    await page.getByRole("button", { name: "Mercado Pago" }).click();
    await page.getByLabel("Não achou o seu?").fill("Banco da Esquina");
    await page.getByRole("button", { name: "Adicionar banco" }).click();
    await expect(page.getByText("O que você tem em cada um?")).toBeVisible();
    await page.getByRole("button", { name: "Criar minhas contas" }).click();
    await expect(page).toHaveURL(/passo=2/);
  });

  await test.step("onboarding: statement with a summary block, in Latin-1", async () => {
    await page.locator('input[type="file"]').setInputFiles({ name: "extrato.csv", mimeType: "text/csv", buffer: Buffer.from(statement, "latin1") });
    await expect(page.getByText(/2 linhas: 2 novas/)).toBeVisible();
    await expect(page.getByRole("cell", { name: "Supermercado São João" })).toBeVisible();
    await page.getByRole("button", { name: "Importar 2 transações" }).click();
    await expect(page.getByText("Importação concluída")).toBeVisible();
    await page.getByRole("link", { name: "Concluir configuração" }).click();
    await expect(page.getByRole("heading", { name: "Tudo pronto" })).toBeVisible();
    await page.getByRole("link", { name: "Ver meu painel" }).click();
    await expect(page.getByTestId("saldo-disponivel")).toContainText("4.649,50");
  });

  await test.step("transactions: add, edit, delete", async () => {
    await page.goto("/transacoes");
    await expect(page.getByText("Supermercado São João")).toBeVisible();
    await page.getByRole("link", { name: "Adicionar" }).click();
    await page.getByLabel("Descrição", { exact: true }).fill("Almoço de teste");
    await page.getByLabel("Valor (R$)").fill("50,00");
    await page.getByRole("button", { name: "Adicionar transação" }).click();
    await expect(page.getByText("Transação adicionada.")).toBeVisible();
    await page.goto("/transacoes");
    await page.getByRole("link", { name: /Almoço de teste/ }).click();
    await page.getByLabel("Observação").fill("Com a equipe");
    await page.getByRole("button", { name: "Salvar alterações" }).click();
    await expect(page.getByText("Alterações salvas.")).toBeVisible();
    await page.getByRole("button", { name: "Excluir transação" }).click();
    await page.getByRole("button", { name: "Sim, excluir transação" }).click();
    await expect(page).toHaveURL(/\/transacoes$/);
    await expect(page.getByRole("link", { name: /Almoço de teste/ })).toHaveCount(0);
  });

  await test.step("chat answers from the imported data", async () => {
    await page.goto("/chat?nova=1");
    await page.getByRole("textbox").first().fill("qual meu saldo?");
    await page.keyboard.press("Enter");
    await expect(page.getByText(/4\.649,50/).first()).toBeVisible();
  });

  await test.step("agent: draft, confirm, run", async () => {
    await page.goto("/agentes");
    await page.getByLabel("Descreva o agente").fill("me avise quando eu gastar mais de R$ 100 por dia");
    await page.getByRole("button", { name: "Gerar rascunho" }).click();
    await expect(page.getByText("Rascunho criado a partir do seu pedido")).toBeVisible();
    await page.getByRole("button", { name: "Confirmar e ativar" }).click();
    await expect(page.getByRole("button", { name: "Executar agora" })).toBeVisible();
    await page.getByRole("button", { name: "Executar agora" }).click();
  });

  await test.step("settings: every tab opens and works", async () => {
    await page.goto("/configuracoes?aba=contas");
    await expect(page.getByText("Conta atualizada").or(page.getByText("Cartão Mercado Pago")).first()).toBeVisible();
    await page.goto("/configuracoes?aba=categorias");
    await page.getByLabel("Nova categoria").fill("Pets da jornada");
    await page.getByRole("button", { name: "Criar" }).click();
    await expect(page.getByText("Categoria criada.")).toBeVisible();
    await page.goto("/configuracoes?aba=preferencias");
    await expect(page.getByRole("heading", { name: "Aparência" })).toBeVisible();
    await page.goto("/configuracoes?aba=integracoes");
    await page.locator("#mcp-pw").fill("senha-errada-123");
    await page.getByRole("button", { name: "Gerar token" }).click();
    await expect(page.getByText("Senha incorreta.")).toBeVisible();
    await page.locator("#mcp-pw").fill(password);
    await page.getByRole("button", { name: "Gerar token" }).click();
    await expect(page.getByText("Copie agora")).toBeVisible();
    await page.getByRole("button", { name: "Revogar" }).click();
    await page.getByRole("button", { name: "Sim, revogar" }).click();
    await expect(page.getByText("Revogado")).toBeVisible();
    await page.goto("/configuracoes?aba=dados");
    const exported = await page.request.get("/api/export");
    expect(exported.status()).toBe(200);
    expect(JSON.stringify(await exported.json())).toContain("Supermercado");
  });

  await test.step("password change: old one stops working", async () => {
    await page.goto("/configuracoes?aba=seguranca");
    await page.locator("#pw-current").fill(password);
    await page.locator("#pw-new").fill(newPassword);
    await page.getByRole("button", { name: "Trocar senha" }).click();
    await expect(page.getByText("Senha trocada.")).toBeVisible();
    await logout(page);
    await login(page, email, password);
    await expect(page.getByText("E-mail, senha ou código incorretos.")).toBeVisible();
    await login(page, email, newPassword);
    await expect(page).toHaveURL(/\/inicio$/);
  });

  await test.step("account deletion: needs the password and removes everything", async () => {
    await page.goto("/configuracoes?aba=dados");
    await page.getByLabel("Digite EXCLUIR para confirmar").fill("EXCLUIR");
    await page.locator("#delete-pw").fill("senha-errada-123");
    await page.getByRole("button", { name: "Excluir minha conta e todos os dados" }).click();
    await expect(page.getByText("Senha incorreta.")).toBeVisible();
    await expect(page.getByLabel("Digite EXCLUIR para confirmar")).toHaveValue("EXCLUIR");
    await page.locator("#delete-pw").fill(newPassword);
    await page.getByRole("button", { name: "Excluir minha conta e todos os dados" }).click();
    await expect(page).toHaveURL(/conta-excluida/);
    await login(page, email, newPassword);
    await expect(page.getByText("E-mail, senha ou código incorretos.")).toBeVisible();
  });

  // The 404 page above is requested on purpose, and the browser logs that status as a console error.
  expect(problems.filter((p) => !p.includes("404"))).toEqual([]);
});
