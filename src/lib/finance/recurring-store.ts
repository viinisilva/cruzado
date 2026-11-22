import { and, eq, inArray } from "drizzle-orm";
import type { DB } from "@/db/connection";
import * as s from "@/db/schema";
import { newId } from "../ids";
import { loadCategories, loadTransactions } from "../data/repo";
import { detectRecurring, type RecurringItem } from "./core";

/**
 * Recomputes recurring items from history and stores them (idempotent upsert per merchant+kind). Two purchases at one
 * store share a row here, last one wins: this table only feeds the export, and screens and chat use detectRecurring.
 */
export async function refreshRecurring(db: DB, userId: string, today: string): Promise<RecurringItem[]> {
  const [txs, categories] = await Promise.all([loadTransactions(db, userId), loadCategories(db, userId)]);
  const items = detectRecurring(txs, categories, today);
  await db.transaction(async (tx) => {
    for (const i of items) {
      await tx
        .insert(s.recurringTransactions)
        .values({
          id: newId(),
          userId,
          accountId: i.accountId,
          categoryId: i.categoryId,
          merchant: i.merchant,
          label: i.label,
          kind: i.kind,
          amountCents: i.amountCents,
          nextDate: i.nextDate,
          remainingInstallments: i.remainingInstallments,
          lastTransactionId: i.lastTransactionId,
        })
        .onConflictDoUpdate({
          target: [s.recurringTransactions.userId, s.recurringTransactions.merchant, s.recurringTransactions.kind],
          set: {
            label: i.label,
            amountCents: i.amountCents,
            nextDate: i.nextDate,
            remainingInstallments: i.remainingInstallments,
            lastTransactionId: i.lastTransactionId,
            updatedAt: new Date(),
          },
        });
    }
    const keep = items.map((i) => `${i.merchant}|${i.kind}`);
    const existing = await tx.select().from(s.recurringTransactions).where(eq(s.recurringTransactions.userId, userId));
    const stale = existing.filter((e) => !keep.includes(`${e.merchant}|${e.kind}`)).map((e) => e.id);
    if (stale.length) {
      await tx.delete(s.recurringTransactions).where(and(eq(s.recurringTransactions.userId, userId), inArray(s.recurringTransactions.id, stale)));
    }
  });
  return items;
}
