// Security headers as the production build serves them (next.config.ts). Checked here so a change is deliberate.
import { afterEach, describe, expect, it, vi } from "vitest";

async function headersFor(env: Record<string, string>) {
  vi.resetModules();
  for (const [k, v] of Object.entries(env)) vi.stubEnv(k, v);
  const config = (await import("../../next.config")).default;
  const rules = await config.headers!();
  return Object.fromEntries(rules[0]!.headers.map((h) => [h.key, h.value]));
}

describe("security headers", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("production: strict CSP with no third-party origin, no framing, HSTS, nosniff", async () => {
    const h = await headersFor({ NODE_ENV: "production", PLUGGY_MODE: "" });
    const csp = h["Content-Security-Policy"]!;
    for (const d of ["default-src 'self'", "connect-src 'self'", "img-src 'self' data:", "object-src 'none'", "base-uri 'none'", "form-action 'self'", "frame-ancestors 'none'"]) expect(csp).toContain(d);
    expect(csp).not.toMatch(/https?:\/\//);
    expect(h["X-Frame-Options"]).toBe("DENY");
    expect(h["X-Content-Type-Options"]).toBe("nosniff");
    expect(h["Strict-Transport-Security"]).toMatch(/max-age=\d{8}/);
    expect(h["Referrer-Policy"]).toBe("same-origin");
    expect(h["Cross-Origin-Opener-Policy"]).toBe("same-origin");
  });

  it("opens only the Pluggy widget frame, and only when the widget is in use", async () => {
    const h = await headersFor({ NODE_ENV: "production", PLUGGY_MODE: "connect" });
    expect(h["Content-Security-Policy"]).toContain("frame-src https://connect.pluggy.ai");
    expect(h["Content-Security-Policy"]!.match(/https:\/\/[^\s;]+/g)).toEqual(["https://connect.pluggy.ai"]);
  });
});
