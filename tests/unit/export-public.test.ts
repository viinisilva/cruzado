// The public-copy check (scripts/export-public.ts): it must catch real amounts and secrets, and let fiction through.
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { amountPatterns, isExcluded, isPng, isReviewedImage, PUBLIC_AUTHOR, scanText, writePublicCopy } from "../../scripts/export-public";

const kinds = (text: string, amounts: RegExp[] = [], words: string[] = []) => scanText("f", text, amounts, words).map((f) => f.kind);

describe("amountPatterns", () => {
  const p = amountPatterns(102157);
  it.each(["total 1.021,57", "1021,57", "valor: 1021.57", "amountCents: -102157,"])("finds %s", (t) => expect(kinds(t, p)).toEqual(["valor das faturas reais (corpus)"]));
  it.each(["11.021,57", "1021,571", "2102157", "1021,58"])("does not confuse %s", (t) => expect(kinds(t, p)).toEqual([]));
  it("ignores round amounts, which identify no one", () => expect(amountPatterns(10000)).toEqual([]));
});

// Fake secrets are assembled at run time, so this file does not trip the very check it tests.
const j = (...parts: string[]) => parts.join("");

describe("scanText", () => {
  it("finds secrets and private words, by line", () => {
    expect(kinds(j("const k = 'sk-", "ant-api03-abcdefghijklmnopqrstuvwxyz'"))).toContain("chave da Anthropic");
    expect(kinds(j("DATABASE_URL=postgres://owner:", "Sup3rS3cret@ep-x.neon.tech/db"))).toContain("URL de banco com senha");
    expect(kinds(j('token: "AbCdEfGh', '1234567890IjKlMnOp"'))).toContain("token de API genérico");
    expect(kinds(j('itemId: "3f2b9c1e-8d4a-', '4b7e-9c2d-1a5e6f7b8c9d"'))).toContain("Item ID da Pluggy");
    expect(kinds("autor: Fulano de Tal", [], ["fulano de tal"])).toEqual(["termo da lista privada"]);
  });
  it("lets placeholders and test fixtures through", () => {
    expect(kinds("DATABASE_URL: postgres://app:${POSTGRES_PASSWORD}@db:5432/app")).toEqual([]);
    expect(kinds('"TOKEN": "defina-no-seu-ambiente-ou-substitua-localmente"')).toEqual([]);
    expect(kinds('const ITEM = "11111111-1111-4111-8111-111111111111"; // pluggy item')).toEqual([]);
  });
});

describe("isExcluded", () => {
  it.each(["tests/corpus/banks/x/y.json", "docs/HANDOFF.md", "docs/DIAGNOSTICO_2026-11-17.md", "docs/redesign/v3/a.png", ".claude/launch.json", "tests/unit/classify.test.ts", "skills-lock.json", "docs/SECURITY_REVIEW.md", "docs/USO_COMPARTILHADO.md"])("leaves out %s", (f) => expect(isExcluded(f)).toBe(true));
  it.each(["src/app/page.tsx", "docs/ARCHITECTURE.md", "tests/unit/finance.test.ts", ".env.example"])("keeps %s", (f) => expect(isExcluded(f)).toBe(false));
});

describe("isReviewedImage", () => {
  it.each(["docs/readme/inicio-celular.png", "docs/readme/cartoes-1440.png"])("lets %s through", (f) => expect(isReviewedImage(f)).toBe(true));
  it.each(["docs/readme/a.jpg", "docs/readme/sub/a.png", "docs/redesign/a.png", "public/docs/readme/a.png", "docs/readme/../x.png"])("still blocks %s", (f) => expect(isReviewedImage(f)).toBe(false));
});

describe("isPng", () => {
  it("knows a PNG by its first bytes", () => {
    expect(isPng(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0]))).toBe(true);
    expect(isPng(Buffer.from("%PDF-1.7"))).toBe(false);
  });
});

describe("writePublicCopy", () => {
  const sh = (cwd: string, ...args: string[]) => execFileSync("git", args, { cwd, encoding: "utf8" }).trim();
  const files = (m: Record<string, string>) => new Map(Object.entries(m).map(([k, v]) => [k, Buffer.from(v)]));
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), "export-public-"));
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it("starts a fresh history on main, signed by the anonymous GitHub address", () => {
    const dest = path.join(dir, "novo");
    expect(writePublicCopy(dest, files({ "a.txt": "a", "src/b.ts": "b" }))).toBe(true);
    expect(sh(dest, "branch", "--show-current")).toBe("main");
    expect(sh(dest, "rev-list", "--count", "HEAD")).toBe("1");
    expect(sh(dest, "log", "-1", "--format=%ae %ce")).toBe(`${PUBLIC_AUTHOR.email} ${PUBLIC_AUTHOR.email}`);
    expect(sh(dest, "ls-files")).toBe("a.txt\nsrc/b.ts");
  });

  it("refuses a folder that already has files", () => {
    writeFileSync(path.join(dir, "x"), "x");
    expect(() => writePublicCopy(dir, files({ "a.txt": "a" }))).toThrow(/vazia/);
  });

  it("updates a clone with a new commit on top, keeping its history", () => {
    writePublicCopy(dir, files({ "a.txt": "a", "old.txt": "o" }));
    const first = sh(dir, "rev-parse", "HEAD");
    expect(writePublicCopy(dir, files({ "a.txt": "a2", "new/c.txt": "c" }), { update: true, message: "Atualiza" })).toBe(true);
    expect(sh(dir, "rev-list", "--count", "HEAD")).toBe("2");
    expect(sh(dir, "rev-parse", "HEAD~1")).toBe(first);
    expect(sh(dir, "log", "-1", "--format=%s %ae")).toBe(`Atualiza ${PUBLIC_AUTHOR.email}`);
    expect(sh(dir, "ls-files")).toBe("a.txt\nnew/c.txt");
    expect(readFileSync(path.join(dir, "a.txt"), "utf8")).toBe("a2");
  });

  it("makes no commit when nothing changed", () => {
    writePublicCopy(dir, files({ "a.txt": "a" }));
    expect(writePublicCopy(dir, files({ "a.txt": "a" }), { update: true })).toBe(false);
    expect(sh(dir, "rev-list", "--count", "HEAD")).toBe("1");
  });

  it("refuses to update a folder that is not a clean Git clone", () => {
    expect(() => writePublicCopy(dir, files({ "a.txt": "a" }), { update: true })).toThrow(/clone/);
    writePublicCopy(dir, files({ "a.txt": "a" }));
    writeFileSync(path.join(dir, "solto.txt"), "x");
    expect(() => writePublicCopy(dir, files({ "a.txt": "b" }), { update: true })).toThrow(/mudanças/);
  });
});
