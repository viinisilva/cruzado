// Runs before every page and API (static files and "/" excluded). Only an optimistic check: is there a session cookie at all?
// The real check, against the database, stays in each page and route. See src/lib/route-access.ts.
import { NextResponse, type NextRequest } from "next/server";
import { routeAccess } from "@/lib/route-access";

const SESSION_COOKIE = "tostao_session"; // same as src/lib/auth/session.ts, which is server-only

export function proxy(req: NextRequest) {
  const access = routeAccess(req.nextUrl.pathname, { hasSession: Boolean(req.cookies.get(SESSION_COOKIE)?.value), demo: process.env.DEMO_INSTANCE === "1" });
  if (access === "allow") return NextResponse.next();
  if (access === "unauthorized") {
    return new NextResponse(JSON.stringify({ error: "Faça login para continuar." }), { status: 401, headers: { "content-type": "application/json", "cache-control": "no-store" } });
  }
  return NextResponse.redirect(new URL("/entrar", req.url));
}

export const config = {
  // "/" is left out: it is public anyway (route-access.ts), its page checks the session itself, and in the public
  // demonstration it must reach the static front door without waking a function (src/lib/demo/opening-page.ts).
  matcher: ["/((?!$|_next/static|_next/image|favicon.ico|.*\.(?:svg|png|jpg|jpeg|webp|ico|webmanifest|txt|html|woff2?)$).*)"],
};
