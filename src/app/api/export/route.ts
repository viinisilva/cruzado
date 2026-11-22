import { eq } from "drizzle-orm";
import { getDb } from "@/db/client";
import * as s from "@/db/schema";
import { currentUser } from "@/lib/auth/session";
import { audit } from "@/lib/audit";
import { json } from "@/lib/api";
import { rateLimitShared, tooMany } from "@/lib/rate-limit";
import { todayInSaoPaulo } from "@/lib/dates";

// GET with the session cookie (SameSite=Lax) — only the signed-in user's own rows are selected.
export async function GET() {
  const user = await currentUser();
  if (!user) return json({ error: "Faça login para continuar." }, 401);
  const db = await getDb();
  const rl = await rateLimitShared(db, "sync", `export:${user.id}`);
  if (!rl.ok) return tooMany(rl.retryAfterSec);
  const by = <T extends { userId: unknown }>(t: T) => eq(t.userId as never, user.id);
  const [accounts, cards, categories, transactions, imports, recurring, agents, runs, notifications, conversations, messages, connections] = await Promise.all([
    db.select().from(s.accounts).where(by(s.accounts)),
    db.select().from(s.creditCards).where(by(s.creditCards)),
    db.select().from(s.categories).where(by(s.categories)),
    db.select().from(s.transactions).where(by(s.transactions)),
    db.select().from(s.transactionImports).where(by(s.transactionImports)),
    db.select().from(s.recurringTransactions).where(by(s.recurringTransactions)),
    db.select().from(s.agentRules).where(by(s.agentRules)),
    db.select().from(s.agentRuns).where(by(s.agentRuns)),
    db.select().from(s.notifications).where(by(s.notifications)),
    db.select().from(s.conversations).where(by(s.conversations)),
    db.select().from(s.messages).where(by(s.messages)),
    db.select({ id: s.financialConnections.id, connector: s.financialConnections.connector, label: s.financialConnections.label, status: s.financialConnections.status, lastSyncAt: s.financialConnections.lastSyncAt }).from(s.financialConnections).where(by(s.financialConnections)),
  ]);
  await audit(db, user.id, "data.exported", { transactions: transactions.length });
  const body = {
    exportedAt: new Date().toISOString(),
    format: "cruzado-export-v1",
    note: "Valores monetários em centavos (inteiros). Datas no fuso America/Sao_Paulo.",
    user: { id: user.id, name: user.name, email: user.email, createdAt: user.createdAt, aiExternalConsentAt: user.aiExternalConsentAt },
    connections,
    accounts,
    creditCards: cards,
    categories,
    transactions,
    transactionImports: imports,
    recurringTransactions: recurring,
    agentRules: agents,
    agentRuns: runs,
    notifications,
    conversations,
    messages,
  };
  return new Response(JSON.stringify(body, null, 2), {
    headers: {
      "content-type": "application/json; charset=utf-8",
      "content-disposition": `attachment; filename="cruzado-dados-${todayInSaoPaulo()}.json"`,
      "cache-control": "no-store",
    },
  });
}
