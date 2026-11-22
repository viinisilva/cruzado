// The demonstration's static front door (src/lib/demo/opening-page.ts) and the build-time redirect to it.
import { afterEach, describe, expect, it, vi } from "vitest";
import config from "../../next.config";
import { OPENING_PAGE_PATH, OPENING_TARGET, openingPageHtml } from "@/lib/demo/opening-page";
import { routeAccess } from "@/lib/route-access";

describe("opening page", () => {
  const html = openingPageHtml();

  it("says what is happening, in Portuguese, and then opens the dashboard", () => {
    expect(html).toContain('<html lang="pt-BR">');
    expect(html).toContain("Preparando a demonstração…");
    expect(html).toContain('role="status"');
    expect(html).toContain(`location.replace("${OPENING_TARGET}")`);
    expect(html).toContain(`<a href="${OPENING_TARGET}">`); // without JavaScript
  });

  it("loads nothing from anywhere else (the CSP allows only this origin)", () => {
    expect(html).not.toMatch(/(?:src|href)=["']?(?:https?:)?\/\//i);
    expect(html).not.toMatch(/url\(/i);
    expect(html).toContain('name="robots" content="noindex, nofollow"');
  });

  it("bypasses the proxy, from / to the page, so no function runs before it shows", async () => {
    const { config: proxyConfig } = await import("@/proxy");
    const pattern = new RegExp(`^${proxyConfig.matcher[0]}$`);
    expect(pattern.test(OPENING_PAGE_PATH)).toBe(false);
    expect(pattern.test("/")).toBe(false); // the link people open: redirected at the edge, no function
    expect(routeAccess("/", { hasSession: false, demo: false })).toBe("allow"); // so leaving it out changes nothing
    expect(pattern.test("/inicio")).toBe(true);
    expect(routeAccess("/inicio", { hasSession: false, demo: false })).toBe("login");
  });
});

describe("redirect from / (decided at build time)", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("exists only in the public demonstration", async () => {
    vi.stubEnv("DEMO_INSTANCE", "");
    expect(await config.redirects!()).toEqual([]);
    vi.stubEnv("DEMO_INSTANCE", "1");
    expect(await config.redirects!()).toEqual([{ source: "/", destination: OPENING_PAGE_PATH, permanent: false }]);
  });
});
