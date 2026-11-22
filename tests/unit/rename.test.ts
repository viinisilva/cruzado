// The app is called Cruzado (it was Tostão until 21/11/2026). Internal identifiers keep the old name on purpose
// (cookies, localStorage keys, Pluggy clientUserId prefix, MCP token prefix, database and folder names): changing them
// would log people out or break links that already exist. Nothing a person reads may say Tostão.
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { CODE_PATTERN } from "@/lib/whatsapp/link";

const SRC = path.resolve(import.meta.dirname, "../../src");
const files = (dir: string): string[] => readdirSync(dir).flatMap((n) => (statSync(path.join(dir, n)).isDirectory() ? files(path.join(dir, n)) : [path.join(dir, n)]));

describe("rename to Cruzado", () => {
  it("no text in src says Tostão", () => {
    const hits = files(SRC).filter((f) => /\.(tsx?|css)$/.test(f) && /Tost[ãa]o/.test(readFileSync(f, "utf8")));
    expect(hits.map((f) => path.relative(SRC, f))).toEqual([]);
  });

  it("WhatsApp link codes: new prefix, old one still read", () => {
    expect(CODE_PATTERN.test("CRUZADO-ABCDEFGH")).toBe(true);
    expect(CODE_PATTERN.test("TOSTAO-ABCDEFGH")).toBe(true);
    expect(CODE_PATTERN.test("OUTRO-ABCDEFGH")).toBe(false);
  });
});
