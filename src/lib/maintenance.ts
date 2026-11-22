// Periodic cleanup of data that only grows: demo accounts, finished jobs, expired sessions and counters.
import { and, inArray, lt } from "drizzle-orm";
import type { DB } from "@/db/connection";
import * as s from "@/db/schema";
import { purgeExpiredDemos } from "./auth/users";

const JOB_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;
const EVENT_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;

export async function purgeExpired(db: DB, now: Date = new Date()) {
  const demos = await purgeExpiredDemos(db, now);
  await db.delete(s.sessions).where(lt(s.sessions.expiresAt, now));
  await db.delete(s.rateLimits).where(lt(s.rateLimits.resetAt, now));
  await db.delete(s.jobs).where(and(inArray(s.jobs.status, ["done", "failed"]), lt(s.jobs.runAt, new Date(now.getTime() - JOB_RETENTION_MS))));
  // Event ids outlive any redelivery window; once settled, the rows hold no text and no phone number.
  const cutoff = new Date(now.getTime() - EVENT_RETENTION_MS);
  await db.delete(s.whatsappInbox).where(and(lt(s.whatsappInbox.receivedAt, cutoff), inArray(s.whatsappInbox.status, ["recorded", "ignored", "failed", "awaiting_input"])));
  await db.delete(s.whatsappOutbox).where(and(lt(s.whatsappOutbox.createdAt, cutoff), inArray(s.whatsappOutbox.status, ["sent", "unknown", "failed", "expired"])));
  await db.delete(s.whatsappLinkCodes).where(lt(s.whatsappLinkCodes.expiresAt, now));
  await db.delete(s.bankWebhookEvents).where(and(lt(s.bankWebhookEvents.receivedAt, cutoff), inArray(s.bankWebhookEvents.status, ["done", "ignored", "failed"])));
  await db.delete(s.bankConnectAttempts).where(lt(s.bankConnectAttempts.expiresAt, cutoff));
  return { demos };
}
