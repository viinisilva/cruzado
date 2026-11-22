import { eq } from "drizzle-orm";
import type { DB } from "@/db/connection";
import * as s from "@/db/schema";
import { todayInSaoPaulo } from "../dates";
import { loadCategories } from "../data/repo";
import { createProvider, providerIsExternal } from "../ai/provider";
import type { AIProvider } from "../ai/types";

/** True when the configured provider sends data off this server and the user has not consented. */
export async function consentMissing(db: DB, userId: string): Promise<boolean> {
  if (!providerIsExternal()) return false;
  const [u] = await db.select({ c: s.users.aiExternalConsentAt }).from(s.users).where(eq(s.users.id, userId));
  return !u?.c;
}

export async function createChatProvider(db: DB, userId: string): Promise<AIProvider> {
  const categories = await loadCategories(db, userId);
  return createProvider(() => ({ today: todayInSaoPaulo(), categories }));
}
