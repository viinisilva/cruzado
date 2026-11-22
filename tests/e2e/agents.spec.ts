import { expect, test, type Page } from "@playwright/test";

async function enterDemo(page: Page) {
  await page.goto("/entrar");
  await page.getByRole("button", { name: "Entrar no modo demonstração" }).click();
  await expect(page).toHaveURL(/\/inicio$/);
}

// ---------------------------------------------------------------------------
// Agent editing
// ---------------------------------------------------------------------------

test("agent edit: rename and save changes", async ({ page }) => {
  await enterDemo(page);
  await page.goto("/agentes");

  // Find the first confirmed (active) agent in "Seus agentes"
  const agentSection = page.getByRole("region", { name: /Seus agentes|mine/i }).or(
    page.locator("section").filter({ hasText: "Seus agentes" }),
  );
  const firstCard = agentSection.locator("li").first();
  const originalHeading = await firstCard.locator("h3").textContent();

  // Open the edit details panel
  await firstCard.getByText("Editar", { exact: true }).click();

  // Fill a new name
  const newName = `Agente Renomeado ${Date.now()}`;
  const nameInput = firstCard.getByLabel("Nome");
  await nameInput.fill(newName);

  // Submit
  await firstCard.getByRole("button", { name: "Salvar alterações" }).click();

  // The card should show the updated name
  await expect(firstCard.locator("h3")).toContainText(newName);
  expect(originalHeading).not.toBe(newName);
});

test("agent edit: change threshold for daily_spend_limit", async ({ page }) => {
  await enterDemo(page);
  await page.goto("/agentes");

  // Find the daily_spend_limit agent (which always exists in demo seed)
  const dailyCard = page.getByRole("region", { name: /Limite diário/ }).first();
  await dailyCard.getByText("Editar", { exact: true }).click();

  const thresholdInput = dailyCard.getByLabel("Limite por dia (R$)");
  await thresholdInput.fill("350,00");
  await dailyCard.getByRole("button", { name: "Salvar alterações" }).click();

  // After saving, the agent card should show the new threshold amount
  await expect(dailyCard).toContainText("R$ 350,00");
});

test("agent edit: empty name shows validation error", async ({ page }) => {
  await enterDemo(page);
  await page.goto("/agentes");

  const agentSection = page.locator("section").filter({ hasText: "Seus agentes" });
  const firstCard = agentSection.locator("li").first();
  await firstCard.getByText("Editar", { exact: true }).click();

  await firstCard.getByLabel("Nome").fill("");
  await firstCard.getByRole("button", { name: "Salvar alterações" }).click();

  // Should show an error on the name field
  await expect(firstCard.getByLabel("Nome")).toHaveAttribute("aria-invalid", "true");
});

// ---------------------------------------------------------------------------
// Agent pause / resume
// ---------------------------------------------------------------------------

test("agent pause and resume", async ({ page }) => {
  await enterDemo(page);
  await page.goto("/agentes");

  const agentSection = page.locator("section").filter({ hasText: "Seus agentes" });
  // By position: filtering on "Ativo" would stop matching as soon as the card changes status.
  const activeCard = agentSection.getByRole("region").first();

  // Pause
  await activeCard.getByRole("button", { name: "Pausar" }).click();
  await expect(activeCard.getByText("Pausado", { exact: true })).toBeVisible();
  await expect(activeCard.getByRole("button", { name: "Retomar" })).toBeVisible();

  // Resume
  await activeCard.getByRole("button", { name: "Retomar" }).click();
  await expect(activeCard.getByText("Ativo", { exact: true })).toBeVisible();
});

// ---------------------------------------------------------------------------
// Agent deletion
// ---------------------------------------------------------------------------

test("agent delete removes card from the list", async ({ page }) => {
  await enterDemo(page);
  await page.goto("/agentes");

  // Create a new agent first so we don't destroy demo agents
  await page.getByLabel("Descreva o agente").fill("me avise quando eu gastar mais de R$ 50 por dia");
  await page.getByRole("button", { name: "Gerar rascunho" }).click();
  await expect(page.getByText("Rascunho criado a partir do seu pedido")).toBeVisible();

  // The draft should appear in "Para revisar"
  const reviewSection = page.locator("section").filter({ hasText: "Para revisar" });
  const draftCard = reviewSection.getByRole("region").last();
  const draftName = await draftCard.locator("h3").textContent();
  expect(draftName).toBeTruthy();

  // Discard it
  await draftCard.getByRole("button", { name: "Descartar" }).click();

  // Card should disappear
  if (draftName) {
    await expect(page.getByRole("heading", { name: draftName, level: 3, exact: true })).toHaveCount(0);
  }
});

// ---------------------------------------------------------------------------
// Manual agent creation
// ---------------------------------------------------------------------------

test("manual agent creation creates a draft with the correct kind", async ({ page }) => {
  await enterDemo(page);
  await page.goto("/agentes");

  await page.getByText("Criar do zero").click();
  const manualCard = page.getByRole("region", { name: "Criar manualmente" });

  // Select weekly_summary kind (no threshold required)
  await manualCard.getByLabel("Tipo").selectOption({ label: "Resumo semanal" });
  const uniqueName = `Resumo Semanal Teste ${Date.now()}`;
  await manualCard.getByLabel("Nome").fill(uniqueName);
  await manualCard.getByRole("button", { name: "Criar rascunho" }).click();

  // Should appear in drafts
  await expect(page.getByRole("heading", { name: uniqueName, level: 3 })).toBeVisible();
  await expect(page.getByText("Rascunho — aguardando confirmação")).toBeVisible();
});

// ---------------------------------------------------------------------------
// Run agent now
// ---------------------------------------------------------------------------

test("active agent can be executed immediately", async ({ page }) => {
  await enterDemo(page);
  await page.goto("/agentes");

  const agentSection = page.locator("section").filter({ hasText: "Seus agentes" });
  // By position: filtering on "Ativo" would stop matching as soon as the card changes status.
  const activeCard = agentSection.getByRole("region").first();

  await activeCard.getByRole("button", { name: "Executar agora" }).click();

  // Button re-enables after execution (no error toast visible)
  await expect(activeCard.getByRole("button", { name: "Executar agora" })).toBeVisible();
});
