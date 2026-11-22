import type { Metadata } from "next";
import Link from "next/link";
import { CalendarClock, ChevronRight, Repeat } from "lucide-react";
import { getDb } from "@/db/client";
import { requireUser } from "@/lib/auth/session";
import { initials } from "@/lib/banks";
import { loadAccounts, loadCategories, loadTransactions } from "@/lib/data/repo";
import { detectRecurring, type RecurringItem } from "@/lib/finance/core";
import { recurringSummary } from "@/lib/finance/views";
import { formatDayMonth, todayInSaoPaulo } from "@/lib/dates";
import { formatBRL } from "@/lib/money";
import { plural, sanitizeUntrusted } from "@/lib/text";
import { ButtonLink, EmptyState, MetricCard, PageHeader, cx } from "@/components/ui";
import { Sensitive } from "@/components/client";

export const metadata: Metadata = { title: "Recorrentes" };

const NOTE = "Estimado pelo histórico. Não confirmado com o banco.";

function ItemRow({ item, account, category, today, income }: { item: RecurringItem; account?: string; category?: string; today: string; income?: boolean }) {
  const label = sanitizeUntrusted(item.label, 60);
  // The latest charge itself: a description search would miss bank descriptions that differ from the merchant key.
  const href = `/transacoes/${item.lastTransactionId}`;
  return (
    <li className="border-t border-border/70 first:border-0">
      <Link href={href} aria-label={`Ver a última cobrança de ${label}`} className="flex min-h-20 items-center gap-3 rounded-xl px-3 py-3 transition-colors hover:bg-surface-2 sm:gap-4 sm:px-4">
        <span aria-hidden className={cx("flex size-11 shrink-0 items-center justify-center rounded-xl text-sm font-bold", income ? "bg-positive-soft text-positive" : "bg-primary-soft text-primary")}>{initials(label)}</span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[0.9375rem] font-semibold">{label}</span>
          <span className="block truncate text-meta text-muted">{[account, category].filter(Boolean).join(" · ")}</span>
          <span className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-meta text-muted">
            <span className="inline-flex items-center gap-1"><CalendarClock aria-hidden size={13} /> Próxima prevista: {formatDayMonth(item.nextDate, today)}</span>
            <span>{plural(item.transactionIds.length, "pagamento", "pagamentos")} até agora</span>
          </span>
        </span>
        <span className="flex shrink-0 items-center gap-2">
          <span className="text-right">
            <span className="block text-[0.9375rem] font-semibold tabular-nums">
              <Sensitive shownClassName={income ? "text-positive" : undefined}>{formatBRL(Math.abs(item.amountCents))}</Sensitive>
            </span>
            <span className="block text-meta text-muted">por mês</span>
          </span>
          <ChevronRight aria-hidden size={18} className="text-muted" />
        </span>
      </Link>
    </li>
  );
}

export default async function RecurringPage() {
  const user = await requireUser();
  const db = await getDb();
  const today = todayInSaoPaulo();
  const [accounts, categories, txs] = await Promise.all([loadAccounts(db, user.id), loadCategories(db, user.id), loadTransactions(db, user.id)]);
  const summary = recurringSummary(detectRecurring(txs, categories, today));
  const accountName = new Map(accounts.map((a) => [a.id, a.name]));
  const categoryName = new Map(categories.map((c) => [c.id, c.name]));
  const row = (item: RecurringItem, income?: boolean) => (
    <ItemRow key={item.lastTransactionId} item={item} account={accountName.get(item.accountId)} category={item.categoryId ? categoryName.get(item.categoryId) : undefined} today={today} income={income} />
  );

  return (
    <>
      <PageHeader title="Recorrentes" description="Assinaturas e contas que se repetem todo mês, encontradas no seu histórico." />

      {summary.subscriptions.length ? (
        <div className="flex flex-col gap-5">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3 xl:gap-5">
            <MetricCard id="r-qtd" glow label="Cobranças ativas" value={summary.subscriptions.length.toLocaleString("pt-BR")} qualifier="encontradas no histórico" />
            <MetricCard id="r-mes" label="Estimativa por mês" value={<Sensitive>{formatBRL(summary.monthlyCents)}</Sensitive>} qualifier="por mês" />
            <MetricCard id="r-ano" label="Projeção de 12 meses" value={<Sensitive>{formatBRL(summary.yearlyCents)}</Sensitive>} qualifier="se nada mudar" />
          </div>
          <p className="-mt-2 text-meta text-muted">{NOTE} Valores repetem a última cobrança de cada uma. Parcelas ficam em Cartões.</p>

          <section aria-labelledby="h-cobrancas" className="rounded-2xl border border-border bg-surface p-2 shadow-card sm:p-3">
            <h2 id="h-cobrancas" className="px-3 pb-1 pt-2 text-lg font-semibold tracking-tight sm:px-4">Cobranças, pela próxima data</h2>
            <ul aria-label="Cobranças recorrentes" className="flex flex-col">{summary.subscriptions.map((s) => row(s))}</ul>
          </section>

          {summary.incomes.length ? (
            <section aria-labelledby="h-receitas" className="rounded-2xl border border-border bg-surface p-2 shadow-card sm:p-3">
              <h2 id="h-receitas" className="px-3 pb-1 pt-2 text-lg font-semibold tracking-tight sm:px-4">Receitas recorrentes</h2>
              <ul aria-label="Receitas recorrentes" className="flex flex-col">{summary.incomes.map((s) => row(s, true))}</ul>
            </section>
          ) : null}
        </div>
      ) : (
        <EmptyState icon={<Repeat aria-hidden size={22} />} title="Nenhuma cobrança recorrente encontrada" action={<ButtonLink href="/transacoes/importar" variant="secondary">Importar extrato</ButtonLink>}>
          Uma cobrança aparece aqui depois de dois meses seguidos no mesmo lugar, com valor parecido. Com mais histórico, a lista fica mais completa.
        </EmptyState>
      )}
    </>
  );
}
