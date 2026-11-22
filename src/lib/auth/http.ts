// Cookie and origin rules as plain functions, so they can be tested without a request.
type Env = Record<string, string | undefined>;

export function sessionCookieOptions(expires: Date, env: Env = process.env) {
  return {
    httpOnly: true,
    // Secure whenever the public URL is HTTPS (production behind TLS); plain http only for local use.
    secure: (env.APP_URL ?? "").startsWith("https://") || env.COOKIE_SECURE === "1" || Boolean(env.VERCEL),
    sameSite: "lax" as const,
    path: "/",
    expires,
  };
}

/** "Origin: null" (sandboxed pages) is not a parseable URL and must be refused, not crash. */
export function sameOrigin(origin: string | null, host: string | null): boolean {
  return Boolean(origin && host && URL.canParse(origin) && new URL(origin).host === host);
}
