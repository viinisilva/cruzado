// Cartões › Conciliação › "Baixar relatório": a Markdown file with the pending proposals, read-only, for the owner only.
import { readFileSync } from "node:fs";
import { expect, test } from "@playwright/test";

test("downloads the reconciliation report without changing anything", async ({ page }) => {
  await page.goto("/entrar");
  await page.getByRole("button", { name: "Entrar no modo demonstração" }).click();
  await expect(page).toHaveURL(/\/inicio$/);
  await page.goto("/cartoes/conciliacao");
  const pending = page.getByRole("heading", { name: /^Mudanças propostas \(\d+\)$/ });
  const before = await pending.textContent();

  const [download] = await Promise.all([page.waitForEvent("download"), page.getByRole("link", { name: "Baixar relatório" }).click()]);
  expect(download.suggestedFilename()).toMatch(/^conciliacao-\d{4}-\d{2}-\d{2}\.md$/);
  const text = readFileSync((await download.path())!, "utf8");
  expect(text).toContain("# Relatório da conciliação de cartões");
  expect(text).toContain("Nada foi aplicado");

  await page.reload();
  await expect(pending).toHaveText(before!);
});

test("the report is not served without a session", async ({ request }) => {
  const r = await request.get("/cartoes/conciliacao/relatorio", { maxRedirects: 0 });
  expect(r.status()).toBe(307);
  expect(r.headers()["location"]).toMatch(/\/entrar$/);
});
