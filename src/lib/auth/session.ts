import "server-only";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { cache } from "react";
import { getDb } from "@/db/client";
import type * as s from "@/db/schema";
import { DEMO_USER, DEMO_USER_CREATED_AT, isDemoInstance } from "../demo/instance-env";
import { sameOrigin, sessionCookieOptions } from "./http";
import { createSession, deleteSession, userForSessionToken } from "./users";

export const SESSION_COOKIE = "tostao_session";
/** Shown by the layout when the public demonstration refused a change. */
export const READ_ONLY_PARAM = "somente-leitura";


export async function startSession(userId: string) {
  const db = await getDb();
  const { token, expiresAt } = await createSession(db, userId);
  (await cookies()).set(SESSION_COOKIE, token, sessionCookieOptions(expiresAt));
}

export async function endSession() {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE)?.value;
  if (token) await deleteSession(await getDb(), token);
  store.delete(SESSION_COOKIE);
}

/** The demonstration's single account, exactly as instance.ts inserts it. */
export function demoUser(): typeof s.users.$inferSelect {
  return { ...DEMO_USER, aiExternalConsentAt: null, totpSecret: null, totpEnabledAt: null, totpLastStep: null, createdAt: DEMO_USER_CREATED_AT };
}

export const currentUser = cache(async () => {
  // The public demonstration has a single visitor account and no login: everyone sees the same invented data.
  // Known in advance, so it does not wait for the in-memory database to start.
  if (isDemoInstance()) return demoUser();
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token) return null;
  return userForSessionToken(await getDb(), token);
});

export async function requireUser() {
  const user = await currentUser();
  if (!user) redirect("/entrar");
  return user;
}

/** Where to send a visitor back after a refused change: the page they were on, never another site. */
async function readOnlyTarget(): Promise<string> {
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host");
  try {
    const ref = new URL(h.get("referer") ?? "");
    if (ref.host === host && !ref.pathname.startsWith("//")) {
      ref.searchParams.set(READ_ONLY_PARAM, "1");
      return `${ref.pathname}${ref.search}`;
    }
  } catch {
    // no referer or not a URL
  }
  return `/inicio?${READ_ONLY_PARAM}=1`;
}

/** Login, signup and logout make no sense in the public demonstration. */
export async function blockInDemoInstance() {
  if (isDemoInstance()) redirect(await readOnlyTarget());
}

/** Every Server Action that changes data starts here: the user, and a refusal in the public demonstration. */
export async function requireWriter() {
  await blockInDemoInstance();
  return requireUser();
}

/**
 * CSRF guard for JSON route handlers: state-changing requests must come from our own origin.
 * (Server Actions already enforce this in Next.js.)
 */
export async function assertSameOrigin(req: Request) {
  const origin = req.headers.get("origin");
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host");
  if (!sameOrigin(origin, host)) {
    throw new Response(JSON.stringify({ error: "Origem não permitida." }), { status: 403, headers: { "content-type": "application/json" } });
  }
}
