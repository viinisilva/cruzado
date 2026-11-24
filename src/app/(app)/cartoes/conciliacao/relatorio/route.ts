// "Baixar relatório" on Cartões › Conciliação: the pending proposals with their evidence and their effect on the bills,
// as a Markdown file. GET only and read-only: it simulates the changes in memory and writes nothing.
import { getDb } from "@/db/client";
import { requireUser } from "@/lib/auth/session";
import { listChanges } from "@/lib/card-reconciliation";
import { loadAccounts, loadCards, loadCategories, loadTransactions } from "@/lib/data/repo";
import { todayInSaoPaulo } from "@/lib/dates";
import { buildReconciliationReport, reportMarkdown } from "@/lib/finance/reconciliation-report";

export const dynamic = "force-dynamic";

export async function GET() {
  const user = await requireUser();
  const db = await getDb();
  const today = todayInSaoPaulo();
  const [proposed, cards, txs, categories, accounts] = await Promise.all([
    listChanges(db, user.id, ["proposed"]),
    loadCards(db, user.id),
    loadTransactions(db, user.id, { includeFuture: true, today }),
    loadCategories(db, user.id),
    loadAccounts(db, user.id),
  ]);
  const report = buildReconciliationReport({
    today,
    cards,
    txs,
    categories,
    accounts,
    proposals: proposed.map((c) => ({ id: c.id, txId: c.txId, accountId: c.accountId, before: c.before, after: c.after, reason: c.reason })),
  });
  return new Response(reportMarkdown(report), {
    headers: {
      "content-type": "text/markdown; charset=utf-8",
      "content-disposition": `attachment; filename="conciliacao-${today}.md"`,
      "cache-control": "no-store",
    },
  });
}
