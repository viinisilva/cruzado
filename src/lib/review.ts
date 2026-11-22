// What Transactions asks of the user. Each task is real and counted once; "the bank has not settled this yet" is
// information, not a task, because there is nothing for the user to do about it.
import { and, count, desc, eq, inArray, isNull, notInArray } from "drizzle-orm";
import type { DB } from "@/db/connection";
import * as s from "@/db/schema";
import { listMatches } from "./reconcile";

const UNCATEGORIZED_SHOWN = 30;

const open = (userId: string) => and(eq(s.transactions.userId, userId), isNull(s.transactions.supersededBy));

async function matchedIds(db: DB, userId: string) {
  const rows = await db
    .select({ entry: s.reconciliationMatches.entryTxId, bank: s.reconciliationMatches.bankTxId })
    .from(s.reconciliationMatches)
    .where(and(eq(s.reconciliationMatches.userId, userId), eq(s.reconciliationMatches.status, "suggested")));
  return rows.flatMap((r) => [r.entry, r.bank]);
}

const uncategorizedWhere = (userId: string, excluded: string[]) => and(open(userId), isNull(s.transactions.categoryId), excluded.length ? notInArray(s.transactions.id, excluded) : undefined);

const attentionConnections = (db: DB, userId: string) =>
  db
    .select({ id: s.financialConnections.id, label: s.financialConnections.label, status: s.financialConnections.status, detail: s.financialConnections.statusDetail, lastSyncAt: s.financialConnections.lastSyncAt })
    .from(s.financialConnections)
    .where(and(eq(s.financialConnections.userId, userId), eq(s.financialConnections.connector, "open_finance"), inArray(s.financialConnections.status, ["reauth_required", "error"])));

/** Light enough for every Transactions page; the tab shows this number. */
export async function reviewCount(db: DB, userId: string): Promise<number> {
  const excluded = await matchedIds(db, userId);
  const [[uncategorized], matches, connections] = await Promise.all([
    db.select({ n: count() }).from(s.transactions).where(uncategorizedWhere(userId, excluded)),
    db.select({ n: count() }).from(s.reconciliationMatches).where(and(eq(s.reconciliationMatches.userId, userId), eq(s.reconciliationMatches.status, "suggested"))),
    attentionConnections(db, userId),
  ]);
  return Number(uncategorized?.n ?? 0) + Number(matches[0]?.n ?? 0) + connections.length;
}

export async function loadReview(db: DB, userId: string) {
  const excluded = await matchedIds(db, userId);
  const [matches, uncategorized, [total], [pending], connections] = await Promise.all([
    listMatches(db, userId, "suggested"),
    db.select().from(s.transactions).where(uncategorizedWhere(userId, excluded)).orderBy(desc(s.transactions.date), desc(s.transactions.id)).limit(UNCATEGORIZED_SHOWN),
    db.select({ n: count() }).from(s.transactions).where(uncategorizedWhere(userId, excluded)),
    db.select({ n: count() }).from(s.transactions).where(and(open(userId), eq(s.transactions.bankStatus, "pending"))),
    attentionConnections(db, userId),
  ]);
  return { matches, uncategorized, uncategorizedTotal: Number(total?.n ?? 0), pendingAtBank: Number(pending?.n ?? 0), connections };
}
