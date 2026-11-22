import "server-only";
import { getDb } from "@/db/client";
import type { users } from "@/db/schema";
import { audit } from "../audit";
import { rateLimitShared } from "../rate-limit";
import { verifyStepUp } from "./users";

/**
 * Asks for proof again before irreversible or credential-issuing actions, so a stolen session cookie is not enough
 * for them. Demo accounts have no password and only hold fictitious data.
 */
export async function reauthenticate(user: typeof users.$inferSelect, form: FormData, opts: { secondFactor?: boolean } = {}): Promise<string | null> {
  if (user.isDemo) return null;
  const db = await getDb();
  if (!(await rateLimitShared(db, "auth", `reauth:${user.id}`)).ok) return "Muitas tentativas. Aguarde alguns minutos.";
  if (await verifyStepUp(db, user, String(form.get("password") ?? ""), String(form.get("code") ?? ""), opts)) return null;
  await audit(db, user.id, "auth.reauth_failed");
  return user.totpEnabledAt && opts.secondFactor !== false ? "Senha ou código incorreto." : "Senha incorreta.";
}
