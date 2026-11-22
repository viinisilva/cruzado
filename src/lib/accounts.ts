import "server-only";
import { and, eq } from "drizzle-orm";
import type { DB } from "@/db/connection";
import * as s from "@/db/schema";
import { audit } from "./audit";
import { refreshRecurring } from "./finance/recurring-store";
import { releaseSuperseded } from "./reconcile";

const BATCH = 500;

/**
 * Deletes an account and, by cascade, its card, entries and import history. While a bank is linked the next sync would
 * bring the account back, so it has to be disconnected first. Nothing changes at the bank.
 */
export async function removeAccount(db: DB, userId: string, accountId: string, today: string): Promise<{ transactions: number }> {
  const transactions = await db.transaction(async (tx) => {
    const [account] = await tx
      .select({ id: s.accounts.id, connector: s.financialConnections.connector, status: s.financialConnections.status })
      .from(s.accounts)
      .leftJoin(s.financialConnections, eq(s.accounts.connectionId, s.financialConnections.id))
      .where(and(eq(s.accounts.id, accountId), eq(s.accounts.userId, userId)));
    if (!account) throw new Error("Conta não encontrada.");
    if (account.connector === "open_finance" && account.status !== "disconnected") throw new Error("Desconecte o banco em Integrações antes de remover esta conta.");
    const rows = await tx.select({ id: s.transactions.id }).from(s.transactions).where(and(eq(s.transactions.accountId, accountId), eq(s.transactions.userId, userId)));
    // Entries in other accounts reconciled against these rows must count again, or they would stay hidden for good.
    for (let i = 0; i < rows.length; i += BATCH) await releaseSuperseded(tx, userId, rows.slice(i, i + BATCH).map((r) => r.id));
    await tx.delete(s.accounts).where(and(eq(s.accounts.id, accountId), eq(s.accounts.userId, userId)));
    await audit(tx, userId, "account.deleted", { accountId, transactions: rows.length });
    return rows.length;
  });
  await refreshRecurring(db, userId, today);
  return { transactions };
}

/** Accounts a sync would recreate: linked to a bank that has not been disconnected. */
export async function bankLinkedAccountIds(db: DB, userId: string): Promise<Set<string>> {
  const rows = await db
    .select({ id: s.accounts.id, status: s.financialConnections.status })
    .from(s.accounts)
    .innerJoin(s.financialConnections, eq(s.accounts.connectionId, s.financialConnections.id))
    .where(and(eq(s.accounts.userId, userId), eq(s.financialConnections.connector, "open_finance")));
  return new Set(rows.filter((r) => r.status !== "disconnected").map((r) => r.id));
}
