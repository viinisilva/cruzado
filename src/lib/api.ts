import "server-only";
import { getDb } from "@/db/client";
import { currentUser, assertSameOrigin } from "./auth/session";
import { rateLimitShared, tooMany, type LIMITS } from "./rate-limit";
import { isDemoInstance } from "./demo/instance-env";

export function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });
}

export { publicError } from "./log";

/** Auth + CSRF + rate limit for JSON route handlers. Returns the user or a Response to send back. */
export async function guard(req: Request, limit: keyof typeof LIMITS, opts: { mutation?: boolean } = { mutation: true }) {
  if (opts.mutation) {
    try {
      await assertSameOrigin(req);
    } catch (r) {
      if (r instanceof Response) return { response: r };
      throw r;
    }
  }
  // The public demonstration only reads, and says so before anything else: refusing must not wait for its database.
  // The chat is the one exception, limited per address in its route.
  if (isDemoInstance() && limit !== "chat" && opts.mutation) return { response: json({ error: "Na demonstração, nada é alterado." }, 403) };
  const user = await currentUser();
  if (!user) return { response: json({ error: "Faça login para continuar." }, 401) };
  if (isDemoInstance() && limit === "chat") return { user };
  const rl = await rateLimitShared(await getDb(), limit, user.id);
  if (!rl.ok) return { response: tooMany(rl.retryAfterSec) };
  return { user };
}
