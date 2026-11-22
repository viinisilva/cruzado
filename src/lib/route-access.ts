// Deny by default (docs/USO_COMPARTILHADO.md, etapa 2): a route is open only if it is listed here. Pages and APIs
// still check the session themselves; this list makes a forgotten check on a new route fail closed instead of open.
// Pure, so the test can walk every route in src/app against it.
export type RouteAccess = "allow" | "login" | "unauthorized";

/** Pages anyone can open. */
export const PUBLIC_PAGES = new Set(["/", "/entrar", "/cadastro", "/privacidade", "/termos"]);

/** APIs that authenticate with their own secret instead of the session cookie. */
export const SELF_AUTHENTICATED_APIS = ["/api/cron/", "/api/webhooks/", "/api/whatsapp/webhook", "/api/mcp"];

export function routeAccess(pathname: string, opts: { hasSession: boolean; demo: boolean }): RouteAccess {
  // The public demonstration has no login: every visitor is the demo account, and it refuses writes on its own.
  if (opts.demo || opts.hasSession) return "allow";
  const path = pathname.length > 1 ? pathname.replace(/\/+$/, "") : pathname;
  if (PUBLIC_PAGES.has(path)) return "allow";
  if (path.startsWith("/api/")) return SELF_AUTHENTICATED_APIS.some((p) => (p.endsWith("/") ? path.startsWith(p) : path === p || path.startsWith(`${p}/`))) ? "allow" : "unauthorized";
  return "login";
}
