// The public demonstration (docs/USO_COMPARTILHADO.md, etapa 1), served by scripts/demo-instance.mjs: no login, invented
// data, nothing saved. Runs only in the "demo-publico" project.
import { expect, test } from "@playwright/test";

test("opens straight on the dashboard, with the notice and no login", async ({ page, context }) => {
  // On its deployment "/" redirects to the opening page, a build-time switch (tests/unit/next-config.test.ts). These local
  // servers share the app's build, where "/" is the landing page, so the visit starts at the dashboard itself.
  await page.goto("/inicio");
  await expect(page).toHaveURL(/\/inicio$/);
  await expect(page.getByText("Você está vendo dados de exemplo.")).toBeVisible();
  await expect(page.getByRole("heading", { name: /Olá, Ana/ })).toBeVisible();
  await expect(page.getByRole("button", { name: "Sair" })).toHaveCount(0);
  expect((await context.cookies()).filter((c) => c.name === "tostao_session")).toEqual([]);
  await page.goto("/entrar");
  await expect(page).toHaveURL(/\/inicio$/);
});

test("shows both cards with their bills", async ({ page }) => {
  await page.goto("/cartoes");
  await expect(page.getByRole("button", { name: "Cartão Ipê" }).or(page.getByRole("link", { name: "Cartão Ipê" })).first()).toBeVisible();
  await expect(page.getByText("Cartão Lume").first()).toBeVisible();
  await expect(page.getByText(/mudança.* proposta/)).toHaveCount(0);
});

test("refuses changes with a plain explanation and keeps the data as it was", async ({ page }) => {
  await page.goto("/alertas");
  const before = await page.getByRole("button", { name: "Marcar como lido" }).count();
  expect(before).toBeGreaterThan(0);
  await page.getByRole("button", { name: "Marcar todos como lidos" }).click();
  await expect(page).toHaveURL(/somente-leitura=1/);
  await expect(page.getByRole("status").filter({ hasText: "nada é alterado" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Marcar como lido" })).toHaveCount(before);
});

test("the chat answers from the demo data and keeps nothing", async ({ page, request }) => {
  await page.goto("/chat");
  await expect(page.getByText("Fatos calculados").first()).toBeVisible();
  const res = await request.post("/api/chat", { data: { text: "Qual o meu saldo?" }, headers: { origin: new URL(page.url()).origin } });
  expect(res.status()).toBe(200);
  expect((await res.json()).content).toMatch(/R\$/);
  await page.reload();
  await expect(page.getByText("Qual o meu saldo?")).toHaveCount(0);
});

test("import and other writes are refused by the API", async ({ request, baseURL }) => {
  const res = await request.post("/api/import/preview", { headers: { origin: baseURL! } });
  expect(res.status()).toBe(403);
});
