// The read-only Pluggy inspection script: picks the item by itself when it can, and loads local credentials without
// printing them.
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { pickItem } from "../../scripts/pluggy-lancamento";

describe("pickItem", () => {
  it("takes the only item, or the one whose connector matches the hint", () => {
    expect(pickItem([{ id: "a", connector: { name: "MeuPluggy" } }])?.id).toBe("a");
    const two = [{ id: "a", connector: { name: "Nubank" } }, { id: "b", connector: { name: "Bradesco Elo" } }];
    expect(pickItem(two, "elo")?.id).toBe("b");
  });

  it("does not guess between several items", () => {
    const two = [{ id: "a", connector: { name: "Banco A" } }, { id: "b", connector: { name: "Banco B" } }];
    expect(pickItem(two)).toBeNull();
    expect(pickItem(two, "banco")).toBeNull();
  });
});

describe("loading local credentials", () => {
  afterEach(() => vi.restoreAllMocks());

  it("process.loadEnvFile fills the environment and writes nothing to the output", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "env-"));
    const file = path.join(dir, ".env.pluggy.local");
    writeFileSync(file, "PLUGGY_CLIENT_SECRET_TESTE=nao-pode-aparecer\n");
    const out = vi.spyOn(process.stdout, "write");
    const log = vi.spyOn(console, "log");
    process.loadEnvFile(file);
    expect(process.env.PLUGGY_CLIENT_SECRET_TESTE).toBe("nao-pode-aparecer");
    expect([...out.mock.calls, ...log.mock.calls].flat().join("")).not.toContain("nao-pode-aparecer");
    delete process.env.PLUGGY_CLIENT_SECRET_TESTE;
  });
});
