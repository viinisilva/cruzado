// Deny by default: every route in src/app is checked against the list in src/lib/route-access.ts.
import { readdirSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { PUBLIC_PAGES, routeAccess } from "@/lib/route-access";

const APP = path.resolve(import.meta.dirname, "../../src/app");

/** URL paths of every page.tsx and route.ts, with route groups removed and dynamic segments filled in. */
function routes(): { url: string; kind: "page" | "api" }[] {
  const out: { url: string; kind: "page" | "api" }[] = [];
  const walk = (dir: string, segs: string[]) => {
    for (const name of readdirSync(dir)) {
      const full = path.join(dir, name);
      if (statSync(full).isDirectory()) {
        const seg = /^\(.*\)$/.test(name) ? null : name.replace(/^\[.*\]$/, "x");
        walk(full, seg ? [...segs, seg] : segs);
      } else if (name === "page.tsx" || name === "route.ts") {
        out.push({ url: `/${segs.join("/")}`, kind: name === "page.tsx" ? "page" : "api" });
      }
    }
  };
  walk(APP, []);
  return out;
}

describe("routeAccess", () => {
  it("without a session, only the listed pages open; every other page sends to the login", () => {
    const pages = routes().filter((r) => r.kind === "page");
    expect(pages.length).toBeGreaterThan(20);
    const open = pages.filter((r) => routeAccess(r.url, { hasSession: false, demo: false }) === "allow").map((r) => r.url).sort();
    expect(open).toEqual([...PUBLIC_PAGES].sort());
    for (const r of pages) if (!PUBLIC_PAGES.has(r.url)) expect(routeAccess(r.url, { hasSession: false, demo: false }), r.url).toBe("login");
  });

  it("without a session, only the self-authenticated APIs answer; the rest get 401", () => {
    const apis = routes().filter((r) => r.kind === "api");
    const open = apis.filter((r) => routeAccess(r.url, { hasSession: false, demo: false }) === "allow").map((r) => r.url).sort();
    expect(open).toEqual(["/api/cron/agents", "/api/cron/banks", "/api/cron/whatsapp", "/api/mcp", "/api/webhooks/pluggy", "/api/whatsapp/webhook"]);
    expect(routeAccess("/api/chat", { hasSession: false, demo: false })).toBe("unauthorized");
    expect(routeAccess("/api/export", { hasSession: false, demo: false })).toBe("unauthorized");
  });

  it("a route that does not exist yet is closed too", () => {
    expect(routeAccess("/admin/convidados", { hasSession: false, demo: false })).toBe("login");
    expect(routeAccess("/api/qualquer-coisa", { hasSession: false, demo: false })).toBe("unauthorized");
    expect(routeAccess("/api/mcpx", { hasSession: false, demo: false })).toBe("unauthorized");
    expect(routeAccess("/entrar/", { hasSession: false, demo: false })).toBe("allow");
  });

  it("with a session or in the public demonstration, the page itself decides", () => {
    expect(routeAccess("/inicio", { hasSession: true, demo: false })).toBe("allow");
    expect(routeAccess("/inicio", { hasSession: false, demo: true })).toBe("allow");
  });
});
