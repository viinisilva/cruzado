// Public demonstration data (docs/USO_COMPARTILHADO.md, etapa 1): fictitious, deterministic and never a real value.
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { generateShowcase } from "@/lib/demo/showcase";
import { demoInstanceProblems, assertDemoInstanceSafe } from "@/lib/demo/instance-env";

const TODAYS = ["2025-10-15", "2026-02-28", "2026-03-03", "2026-11-25", "2026-12-31"];

/** Every amount in the private regression corpus, in cents. The corpus is absent from the public copy. */
function corpusCents(): Set<number> {
  const root = path.resolve(import.meta.dirname, "../corpus/banks");
  const out = new Set<number>();
  if (!existsSync(root)) return out;
  const walk = (v: unknown) => {
    if (Array.isArray(v)) v.forEach(walk);
    else if (v && typeof v === "object") for (const [k, x] of Object.entries(v)) (typeof x === "number" && /^(amount|totalAmount|minimumPaymentAmount|balance|creditLimit|availableCreditLimit)$|Cents$/.test(k) ? out.add(Math.abs(Math.round(/Cents/.test(k) ? x : x * 100))) : walk(x));
  };
  for (const bank of readdirSync(root)) for (const f of readdirSync(path.join(root, bank))) walk(JSON.parse(readFileSync(path.join(root, bank, f), "utf8")));
  out.delete(0);
  return out;
}

const REAL_BRANDS = /nubank|ita[uú]|bradesco|\belo\b|mercado ?pago|mercado ?livre|santander|\binter\b|caixa|banco do brasil|\bc6\b|picpay|amazon|tiktok|ifood|uber|netflix|spotify|capim|99food|bvisab|mastercard/i;

describe("generateShowcase", () => {
  it("is deterministic for the same day", () => {
    expect(generateShowcase("2026-02-28")).toEqual(generateShowcase("2026-02-28"));
  });

  it.each(TODAYS)("covers six months, two cards, bills, installments, a refund and a cashback (%s)", (today) => {
    const sc = generateShowcase(today);
    expect(sc.accounts.map((a) => a.key).sort()).toEqual(["corrente", "ipe", "lume", "poupanca"]);
    expect(sc.cards).toHaveLength(2);
    const months = new Set(sc.transactions.map((t) => t.date.slice(0, 7)));
    expect(months.size).toBeGreaterThanOrEqual(6);
    expect(sc.transactions.every((t) => t.date <= today)).toBe(true);
    for (const card of ["ipe", "lume"] as const) {
      const bills = sc.bills.filter((b) => b.account === card);
      expect(bills.length).toBeGreaterThanOrEqual(4);
      expect(bills.every((b) => b.closingDate < today)).toBe(true);
      // The open bill: entries after the last closing are pending and carry no bill.
      const open = sc.transactions.filter((t) => t.account === card && !t.billKey);
      expect(open.length).toBeGreaterThan(0);
      expect(open.every((t) => t.status === "pending")).toBe(true);
    }
    expect(sc.transactions.some((t) => t.operationType === "ESTORNO")).toBe(true);
    expect(sc.transactions.some((t) => t.operationType === "CASHBACK")).toBe(true);
    expect(sc.transactions.filter((t) => /\d+\/\d+$/.test(t.description)).length).toBeGreaterThan(4);
    expect(sc.conversations.length).toBeGreaterThanOrEqual(2);
  });

  it.each(TODAYS)("bill totals are the sum of their entries, without the payments (%s)", (today) => {
    const sc = generateShowcase(today);
    for (const b of sc.bills) {
      const sum = sc.transactions.filter((t) => t.billKey === b.key && t.category !== "pagamento-fatura").reduce((n, t) => n - t.amountCents, 0);
      expect(b.totalCents, b.key).toBe(sum);
      expect(b.totalCents).toBeGreaterThan(0);
    }
  });

  it("never puts an entry on a closing day, so the demo does not depend on the closing-day rule", () => {
    for (const today of TODAYS) {
      const sc = generateShowcase(today);
      for (const b of sc.bills) expect(sc.transactions.some((t) => t.account === b.account && t.date === b.closingDate)).toBe(false);
    }
  });

  it("uses no real bank, card or store brand", () => {
    const sc = generateShowcase("2026-11-21");
    const texts = [...sc.transactions.map((t) => t.description), ...sc.accounts.flatMap((a) => [a.name, a.institution]), ...sc.conversations.flat()];
    expect(texts.filter((t) => REAL_BRANDS.test(t))).toEqual([]);
  });

  it("shares no amount with the private corpus of real bills", () => {
    const real = corpusCents();
    for (const today of TODAYS) {
      const sc = generateShowcase(today);
      const amounts = [...sc.transactions.map((t) => Math.abs(t.amountCents)), ...sc.bills.map((b) => b.totalCents)];
      expect(amounts.filter((a) => real.has(a))).toEqual([]);
    }
  });
});

describe("demo instance environment", () => {
  it("lists every credential that must not exist in the public demo, by name only", () => {
    const env = { DEMO_INSTANCE: "1", DATABASE_URL: "postgres://x", PGHOST: "", POSTGRES_URL: "y", PLUGGY_CLIENT_ID: "z", ANTHROPIC_API_KEY: "k", APP_URL: "https://x" };
    expect(demoInstanceProblems(env)).toEqual(["ANTHROPIC_API_KEY", "DATABASE_URL", "PLUGGY_CLIENT_ID", "POSTGRES_URL"]);
    expect(() => assertDemoInstanceSafe(env)).toThrow(/DATABASE_URL/);
    expect(() => assertDemoInstanceSafe(env)).not.toThrow(/postgres:\/\/x/);
  });

  it("accepts a clean environment and ignores blank variables", () => {
    expect(demoInstanceProblems({ DEMO_INSTANCE: "1", DATABASE_URL: "", CRON_SECRET: "", NODE_ENV: "production" })).toEqual([]);
  });
});

describe("publicDemoUrl", () => {
  it("accepts https and local addresses only", async () => {
    const { publicDemoUrl } = await import("@/lib/demo/instance-env");
    expect(publicDemoUrl({ DEMO_URL: "https://cruzado-demo.vercel.app" })).toBe("https://cruzado-demo.vercel.app/");
    expect(publicDemoUrl({ DEMO_URL: "http://localhost:3300" })).toBe("http://localhost:3300/");
    expect(publicDemoUrl({ DEMO_URL: "http://exemplo.com" })).toBeNull();
    expect(publicDemoUrl({ DEMO_URL: "javascript:alert(1)" })).toBeNull();
    expect(publicDemoUrl({})).toBeNull();
  });
});
