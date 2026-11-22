// Tying a WhatsApp number to a Cruzado account. Proof needs both sides: a code from the signed-in app sent from the
// phone, then a confirmation back in the app showing that phone. An id typed in a message proves nothing.
import { randomInt } from "node:crypto";
import { and, desc, eq, gt, ne } from "drizzle-orm";
import type { DB } from "@/db/connection";
import * as s from "@/db/schema";
import { audit } from "../audit";
import { sha256Hex } from "../auth/crypto";
import { isOwnerId, OwnerOnlyError } from "../auth/access";
import { newId } from "../ids";

const CODE_TTL_MS = 10 * 60_000;
const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
// CRUZADO- since the rename; TOSTAO- is still accepted, for a code generated just before it.
export const CODE_PATTERN = /\b(?:CRUZADO|TOSTAO)-[A-Z2-9]{8}\b/;

export async function createLinkCode(db: DB, userId: string, now: Date = new Date()): Promise<{ code: string; expiresAt: Date }> {
  if (!isOwnerId(userId)) throw new OwnerOnlyError();
  const code = `CRUZADO-${Array.from({ length: 8 }, () => ALPHABET[randomInt(ALPHABET.length)]).join("")}`;
  const expiresAt = new Date(now.getTime() + CODE_TTL_MS);
  await db.transaction(async (tx) => {
    await tx.delete(s.whatsappLinkCodes).where(eq(s.whatsappLinkCodes.userId, userId));
    await tx.insert(s.whatsappLinkCodes).values({ id: newId(), userId, codeHash: sha256Hex(code), expiresAt });
    await audit(tx, userId, "whatsapp.link_requested");
  });
  return { code, expiresAt };
}

export type WhatsappStatus = typeof s.whatsappLinks.$inferSelect | null;

export async function currentLink(db: DB, userId: string): Promise<WhatsappStatus> {
  const [row] = await db
    .select()
    .from(s.whatsappLinks)
    .where(and(eq(s.whatsappLinks.userId, userId), ne(s.whatsappLinks.status, "disabled")))
    .orderBy(desc(s.whatsappLinks.createdAt))
    .limit(1);
  return row ?? null;
}

/** What the settings page shows: messages waiting on an answer, and recent ones that could not be processed. */
export async function linkHealth(db: DB, link: NonNullable<WhatsappStatus>, now: Date = new Date()) {
  const [drafts, failed] = await Promise.all([
    db.select({ id: s.whatsappDrafts.id }).from(s.whatsappDrafts).where(and(eq(s.whatsappDrafts.linkId, link.id), eq(s.whatsappDrafts.status, "open"), gt(s.whatsappDrafts.expiresAt, now))),
    link.waHash ? db.select({ id: s.whatsappInbox.id }).from(s.whatsappInbox).where(and(eq(s.whatsappInbox.senderHash, link.waHash), eq(s.whatsappInbox.status, "failed"), gt(s.whatsappInbox.receivedAt, new Date(now.getTime() - 7 * 86_400_000)))) : [],
  ]);
  return { openDrafts: drafts.length, failed: failed.length };
}

/** Only the signed-in owner gets here. Writing stays off until this runs. */
export async function confirmLink(db: DB, userId: string, input: { accountId: string; mode: "auto" | "review" }, now: Date = new Date()) {
  if (!isOwnerId(userId)) throw new OwnerOnlyError();
  const [account] = await db.select({ id: s.accounts.id, archived: s.accounts.archived }).from(s.accounts).where(and(eq(s.accounts.id, input.accountId), eq(s.accounts.userId, userId)));
  if (!account || account.archived) throw new Error("Escolha uma conta válida.");
  const updated = await db
    .update(s.whatsappLinks)
    .set({ status: "active", confirmedAt: now, defaultAccountId: account.id, mode: input.mode })
    .where(and(eq(s.whatsappLinks.userId, userId), eq(s.whatsappLinks.status, "pending")))
    .returning({ id: s.whatsappLinks.id });
  if (!updated.length) throw new Error("Nenhum número aguardando confirmação.");
  await audit(db, userId, "whatsapp.linked");
}

export async function updateLinkSettings(db: DB, userId: string, input: { accountId: string; mode: "auto" | "review" }) {
  const [account] = await db.select({ id: s.accounts.id, archived: s.accounts.archived }).from(s.accounts).where(and(eq(s.accounts.id, input.accountId), eq(s.accounts.userId, userId)));
  if (!account || account.archived) throw new Error("Escolha uma conta válida.");
  await db.update(s.whatsappLinks).set({ defaultAccountId: account.id, mode: input.mode }).where(and(eq(s.whatsappLinks.userId, userId), eq(s.whatsappLinks.status, "active")));
  await audit(db, userId, "whatsapp.settings_changed");
}

/** Takes effect at once: the processor re-reads the link inside each message's transaction. */
export async function disconnectLink(db: DB, userId: string) {
  await db.transaction(async (tx) => {
    const links = await tx.select({ id: s.whatsappLinks.id }).from(s.whatsappLinks).where(and(eq(s.whatsappLinks.userId, userId), ne(s.whatsappLinks.status, "disabled")));
    for (const l of links) {
      await tx.update(s.whatsappDrafts).set({ status: "cancelled" }).where(and(eq(s.whatsappDrafts.linkId, l.id), eq(s.whatsappDrafts.status, "open")));
      await tx.update(s.whatsappLinks).set({ status: "disabled", waHash: null, waEncrypted: null }).where(eq(s.whatsappLinks.id, l.id));
    }
    await tx.delete(s.whatsappLinkCodes).where(eq(s.whatsappLinkCodes.userId, userId));
    await audit(tx, userId, "whatsapp.disconnected");
  });
}
