// Full path against the built app: a signed Meta-shaped event, the real route, the real queue, the real screens.
import { createHmac, randomUUID } from "node:crypto";
import { expect, test, type APIRequestContext, type Page } from "@playwright/test";

const WA = () => `55119${Math.floor(10000000 + Math.random() * 89999999)}`;

function signed(text: string, from: string) {
  const body = JSON.stringify({
    object: "whatsapp_business_account",
    entry: [{ changes: [{ value: { metadata: { phone_number_id: "100200300" }, messages: [{ id: `wamid.e2e-${randomUUID()}`, from, timestamp: String(Math.floor(Date.now() / 1000)), type: "text", text: { body: text } }] } }] }],
  });
  return { body, sig: `sha256=${createHmac("sha256", "e2e-app-secret").update(body).digest("hex")}` };
}

async function send(request: APIRequestContext, text: string, from: string) {
  const { body, sig } = signed(text, from);
  const res = await request.post("/api/whatsapp/webhook", { data: body, headers: { "content-type": "application/json", "x-hub-signature-256": sig } });
  expect(res.status()).toBe(200);
}

async function noOverflow(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
}

test("from code to confirmed number, recorded expense and reconciliation", async ({ page, request }) => {
  test.setTimeout(150_000);
  const password = "uma-senha-bem-grande-123";
  const wa = WA();

  await test.step("sign up with one bank account", async () => {
    await page.goto("/cadastro");
    await page.getByLabel("Nome").fill("Pessoa WhatsApp");
    await page.getByLabel("E-mail").fill(`wa-${randomUUID()}@exemplo.test`);
    await page.getByLabel("Senha").fill(password);
    await page.getByRole("checkbox").check();
    await page.getByRole("button", { name: "Criar conta" }).click();
    await expect(page).toHaveURL(/\/comecar$/);
    await page.getByRole("button", { name: "Mercado Pago" }).click();
    await page.getByRole("button", { name: "Criar minhas contas" }).click();
    await expect(page).not.toHaveURL(/\/comecar$/);
  });

  await test.step("unlinked: steps, then a code that alone enables nothing", async () => {
    await page.goto("/configuracoes?aba=whatsapp");
    await expect(page.getByText("Gere um código aqui.")).toBeVisible();
    await noOverflow(page);
    await page.getByRole("button", { name: "Gerar código" }).focus();
    await page.keyboard.press("Enter");
    const code = await page.getByTestId("wa-code").innerText();
    expect(code).toMatch(/^CRUZADO-/);
    await send(request, code, wa);
    await expect(async () => {
      await page.reload();
      await expect(page.getByText(/Este número é seu\?/)).toBeVisible({ timeout: 1000 });
    }).toPass({ timeout: 20_000 });
    await expect(page.getByText(wa)).toHaveCount(0);
    await expect(page.getByText(new RegExp(`••••• ${wa.slice(-4)}`))).toBeVisible();
    await send(request, "gastei 99 no pix no mercado", wa);
    await page.goto("/transacoes");
    await expect(page.getByRole("link", { name: /mercado/i })).toHaveCount(0);
  });

  await test.step("confirmation needs the password", async () => {
    await page.goto("/configuracoes?aba=whatsapp");
    await page.getByLabel("Sua senha").fill("senha-errada");
    await page.getByRole("button", { name: "Confirmar número" }).click();
    await expect(page.getByText("Senha incorreta.")).toBeVisible();
    await page.getByLabel("Sua senha").fill(password);
    await page.getByRole("button", { name: "Confirmar número" }).click();
    await expect(page.getByText("Conectado", { exact: true })).toBeVisible();
    await expect(page.getByText("Registrar automaticamente mensagens completas")).toBeVisible();
    await noOverflow(page);
  });

  await test.step("the reference message shows up with method and origin", async () => {
    await send(request, "Gastei 60 reais no Pix no restaurante", wa);
    await expect(async () => {
      await page.goto("/transacoes");
      await expect(page.getByRole("link", { name: /Restaurante/ }).first()).toBeVisible({ timeout: 1000 });
    }).toPass({ timeout: 20_000 });
    await page.getByRole("link", { name: /Restaurante/ }).first().click();
    await expect(page.getByText("Pix", { exact: true })).toBeVisible();
    await expect(page.getByText(/Mensagem no WhatsApp/)).toBeVisible();
  });

  await test.step("the same payment in a statement is suggested, confirmed once, undoable", async () => {
    await page.goto("/transacoes/conciliar");
    await expect(page.getByText("Nada para revisar")).toBeVisible();
    await page.goto("/transacoes/importar");
    const today = new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Sao_Paulo" }).format(new Date());
    await page.locator('input[type="file"]').setInputFiles({ name: "extrato.csv", mimeType: "text/csv", buffer: Buffer.from(`Data;Descrição;Valor\n${today};COMPRA RESTAURANTE;-60,00\n`) });
    await page.getByRole("button", { name: "Importar 1 transação" }).click();
    await expect(page.getByText("Importação concluída")).toBeVisible();
    await page.goto("/transacoes/conciliar");
    await expect(page.getByText(/^Você informou ·/)).toBeVisible();
    await noOverflow(page);
    await page.getByRole("button", { name: "É o mesmo gasto" }).click();
    await expect(page.getByText("Já conciliados")).toBeVisible();
    await page.goto("/transacoes?q=restaurante");
    await expect(page.locator('section[aria-labelledby^="d-"] li')).toHaveCount(1);
    await page.goto("/transacoes/conciliar");
    await page.getByRole("button", { name: "Desfazer conciliação" }).click();
    await page.getByRole("button", { name: "Sim, desfazer" }).click();
    await expect(page.getByText("Já conciliados")).toHaveCount(0);
    await page.goto("/transacoes?q=restaurante");
    await expect(page.locator('section[aria-labelledby^="d-"] li')).toHaveCount(2);
  });

  await test.step("disconnecting stops writes", async () => {
    await page.goto("/configuracoes?aba=whatsapp");
    await page.getByRole("button", { name: "Desconectar WhatsApp" }).click();
    await page.getByRole("button", { name: "Sim, desconectar" }).click();
    await expect(page.getByText("Gere um código aqui.")).toBeVisible();
    await send(request, "gastei 77 no pix na farmacia", wa);
    await page.waitForTimeout(1500);
    await page.goto("/transacoes?q=farmacia");
    await expect(page.locator('section[aria-labelledby^="d-"] li')).toHaveCount(0);
  });
});

test("the route refuses unsigned events and a wrong verify token", async ({ request }) => {
  expect((await request.post("/api/whatsapp/webhook", { data: "{}", headers: { "content-type": "application/json" } })).status()).toBe(401);
  expect((await request.get("/api/whatsapp/webhook?hub.mode=subscribe&hub.verify_token=x&hub.challenge=1")).status()).toBe(403);
  const ok = await request.get("/api/whatsapp/webhook?hub.mode=subscribe&hub.verify_token=e2e-verify&hub.challenge=77");
  expect(await ok.text()).toBe("77");
});

test("demo sessions cannot link a number", async ({ page }) => {
  await page.goto("/entrar");
  await page.getByRole("button", { name: "Entrar no modo demonstração" }).click();
  await expect(page).toHaveURL(/\/inicio$/);
  // WhatsApp is the administrator's only (docs/USO_COMPARTILHADO.md, decisão 6): a demo session does not even see the tab.
  await page.goto("/configuracoes?aba=whatsapp");
  await expect(page.getByRole("link", { name: "WhatsApp" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Gerar código" })).toHaveCount(0);
});
