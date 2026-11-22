import type { NextConfig } from "next";

const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "same-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" },
  // Another site's window cannot keep a handle on ours (opened by link or popup).
  { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
];

// No third-party origins by default, so injected code could not send data anywhere (connect-src, form-action, img-src).
// 'unsafe-inline' scripts remain: Next.js inlines them and statically rendered pages cannot carry a nonce.
const contentSecurityPolicy = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data:",
  "font-src 'self'",
  "connect-src 'self'",
  // Only instances using the Pluggy widget open this door. Read at build time.
  ...(process.env.PLUGGY_MODE === "connect" ? ["frame-src https://connect.pluggy.ai"] : []),
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join("; ");

// `next dev` needs eval and a websocket for hot reload.
if (process.env.NODE_ENV === "production") securityHeaders.push({ key: "Content-Security-Policy", value: contentSecurityPolicy });

const config: NextConfig = {
  // The Docker image builds with NEXT_OUTPUT=standalone; local `next start` uses the default output.
  output: process.env.NEXT_OUTPUT === "standalone" ? "standalone" : undefined,
  poweredByHeader: false,
  serverExternalPackages: ["@electric-sql/pglite", "pg"],
  // Migrations are read from disk at runtime, which the file tracer cannot see. So is the demonstration's migrated
  // database (scripts/demo-build.ts), which only exists in that build.
  outputFileTracingIncludes: { "/**/*": ["./drizzle/**/*", "./demo-snapshot/**/*"] },
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
  // Public demonstration only (read at build time): "/" goes to a static page served by the CDN, so the first screen
  // never waits for a cold function (src/lib/demo/opening-page.ts, written by scripts/demo-build.ts).
  async redirects() {
    return process.env.DEMO_INSTANCE === "1" ? [{ source: "/", destination: "/abrindo.html", permanent: false }] : [];
  },
};

export default config;
