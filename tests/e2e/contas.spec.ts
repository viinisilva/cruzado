// Removing an account from Settings. Fictitious data only; the demo has no password, so only the typed word applies.
import { expect, test, type Page } from "@playwright/test";

async function enterDemo(page: Page) {
  await page.goto("/entrar");
  await page.getByRole("button", { name: "Entrar no modo demonstração" }).click();
  await expect(page).toHaveURL(/\/inicio$/);
}

test("an account can be removed from Editar, with a confirmation first", async ({ page }) => {
  await enterDemo(page);
  await page.goto("/configuracoes?aba=contas");
  const item = page.getByRole("listitem").filter({ hasText: "Cartão Nimbus" });
  await item.getByText("Editar", { exact: true }).click();
  await item.getByText("Remover esta conta").click();
  await expect(item.getByText(/Apaga Cartão Nimbus e \d+ transaç/)).toBeVisible();

  await item.getByRole("button", { name: "Remover conta" }).click();
  await expect(item.getByText("Digite EXCLUIR para confirmar.")).toBeVisible();
  await expect(page.getByRole("listitem").filter({ hasText: "Cartão Nimbus" })).toBeVisible();

  await item.getByLabel("Digite EXCLUIR para confirmar").fill("EXCLUIR");
  await item.getByRole("button", { name: "Remover conta" }).click();
  await expect(page).toHaveURL(/removida=1/);
  await expect(page.getByText("Conta removida.")).toBeVisible();
  await expect(page.getByRole("listitem").filter({ hasText: "Cartão Nimbus" })).toHaveCount(0);

  await page.goto("/cartoes");
  await expect(page.getByText("Nenhum cartão ainda")).toBeVisible();
});
