import type { Metadata } from "next";
import Link from "next/link";
import { and, eq, sql } from "drizzle-orm";
import { getDb } from "@/db/client";
import * as s from "@/db/schema";
import { requireUser } from "@/lib/auth/session";
import { initials } from "@/lib/banks";
import { loadAccounts, loadCards, loadCategories, loadTransactions } from "@/lib/data/repo";
import { accountBalances, consolidatedBalance, isFutureEntry } from "@/lib/finance/core";
import { cardOverviews, closingText } from "@/lib/finance/cards";
import { cardHref } from "@/lib/card-query";
import { formatDateBR, formatDayMonth, todayInSaoPaulo } from "@/lib/dates";
import { formatBRL } from "@/lib/money";
import { txHref } from "@/lib/tx-query";
import { Badge, ButtonLink, Card, EmptyState, PageHeader, Stat, linkCls } from "@/components/ui";
import { Sensitive } from "@/components/client";

export const metadata: Metadata = { title: "Contas e cartões" };

const TYPE = { checking: "Conta corrente", savings: "Poupança", credit_card: "Cartão de crédito", cash: "Dinheiro" } as const;
const EDIT = "/configuracoes?aba=contas";

function originOf(sources: Set<string>, connected: boolean): { label: string; tone: "positive" | "neutral" | "attention" } {
  if (connected) return { label: "Conectada", tone: "positive" };
  if (sources.has("demo")) return { label: "Demonstração", tone: "attention" };
  if (sources.has("csv") || sources.has("ofx")) return { label: "Importada", tone: "neutral" };
  return { label: "Manual", tone: "neutral" };
}

export default async function AccountsPage() {
  const user = await requireUser();
  const db = await getDb();
  const today = todayInSaoPaulo();
  const [accounts, categories, withFuture, cards, links, origins] = await Promise.all([
    loadAccounts(db, user.id),
    loadCategories(db, user.id),
    loadTransactions(db, user.id, { includeFuture: true, today }),
    loadCards(db, user.id),
    db
      .select({ account: s.accounts.id, syncedAt: s.financialConnections.lastSyncAt, status: s.financialConnections.status })
      .from(s.accounts)
      .innerJoin(s.financialConnections, eq(s.accounts.connectionId, s.financialConnections.id))
      // Demo accounts also have a connection row; only Open Finance means a real bank is linked.
      .where(and(eq(s.accounts.userId, user.id), eq(s.financialConnections.connector, "open_finance"))),
    db
      .select({ account: s.transactions.accountId, source: s.transactions.source, n: sql<number>`count(*)` })
      .from(s.transactions)
      .where(eq(s.transactions.userId, user.id))
      .groupBy(s.transactions.accountId, s.transactions.source),
  ]);
  // Future card installments only count in their card bill; the rest of this page waits for their date.
  const txs = withFuture.filter((t) => !isFutureEntry(t, today));
  const balances = accountBalances(accounts, txs, today);
  const total = consolidatedBalance(balances);
  const overviews = cardOverviews(balances, cards, withFuture, categories, today);

  const details =(id: string) => {
    const link = links.find((l) => l.account === id && l.status !== "disconnected");
    const origin = originOf(new Set(origins.filter((o) => o.account === id).map((o) => o.source)), Boolean(link));
    const lastTx = txs.find((t) => t.accountId === id);
    const updated = link?.syncedAt
      ? `Atualizada em ${link.syncedAt.toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" })}`
      : lastTx
        ? `Última transação em ${formatDateBR(lastTx.date)}`
        : "Sem transações ainda";
    return { origin, updated };
  };

  const renderItem = (b: (typeof balances)[number]) => {
    const { origin, updated } = details(b.id);
    const card = cards.find((c) => c.accountId === b.id);
    const next = overviews.find((c) => c.id === b.id)?.next;
    const open = overviews.find((c) => c.id === b.id)?.statements.find((st) => st.status === "open");
    return (
      <li key={b.id} className="flex flex-col rounded-2xl border border-border bg-surface p-5 shadow-card">
        <div className="flex items-start gap-3">
          <span aria-hidden className={`flex size-11 shrink-0 items-center justify-center rounded-xl text-sm font-bold ${b.type === "credit_card" ? "bg-primary-soft text-primary" : "bg-surface-3 text-muted"}`}>{initials(b.institution)}</span>
          <div className="min-w-0 flex-1">
            <h3 className="break-words text-lg font-semibold leading-snug">{b.name}</h3>
            <p className="break-words text-sm text-muted">{TYPE[b.type]} · {b.institution}</p>
          </div>
          <Badge tone={origin.tone}>{origin.label}</Badge>
        </div>
        <p className="mt-4 border-t border-border pt-4 text-sm font-medium text-muted">{b.type === "credit_card" ? "Em aberto (total lançado)" : "Saldo"}</p>
        <p className="mt-0.5 text-[1.625rem] font-semibold leading-8 tracking-tight tabular-nums"><Sensitive>{formatBRL(b.type === "credit_card" ? Math.max(0, -b.balanceCents) : b.balanceCents)}</Sensitive></p>
        {card ? (
          <p className="mt-1 text-sm text-muted">
            {card.limitCents > 0 ? <>Limite cadastrado: <Sensitive>{formatBRL(card.limitCents)}</Sensitive> · </> : "Limite não informado · "}
            {open ? `fecha ${closingText(open)}` : `fecha dia ${card.closingDay}`}{next ? `, vence em ${formatDayMonth(next.dueDate, today)}` : ""}
          </p>
        ) : null}
        <p className="mt-1 text-meta text-muted">{updated}</p>
        <div className="mt-auto flex flex-wrap gap-x-5 pt-3">
          {b.type === "credit_card" ? <Link href={cardHref({ cartao: b.id })} className={linkCls}>Ver faturas e limite</Link> : null}
          <Link href={txHref({ contas: [b.id] })} className={linkCls}>Ver transações</Link>
          <Link href={EDIT} className={linkCls}>Editar</Link>
        </div>
      </li>
    );
  };

  const cash = balances.filter((b) => b.type !== "credit_card");
  const credit = balances.filter((b) => b.type === "credit_card");

  return (
    <>
      <PageHeader title="Contas e cartões" description="Onde está o seu dinheiro e de onde vem cada dado." action={<ButtonLink href={EDIT} variant="secondary">Gerenciar</ButtonLink>} />
      {balances.length ? (
        <div className="flex flex-col gap-8">
          <Card aria-label="Resumo">
            <dl className="grid gap-6 sm:grid-cols-2 lg:max-w-3xl">
              <Stat size="lg" label="Saldo disponível" value={<Sensitive>{formatBRL(total.availableCents)}</Sensitive>} hint="Soma das contas, sem os cartões." />
              <Stat size="lg" label="Em aberto nos cartões" value={<Sensitive>{formatBRL(total.cardDebtCents)}</Sensitive>} hint="Total lançado, não é a fatura fechada." />
            </dl>
          </Card>
          {cash.length ? (
            <section aria-labelledby="h-c">
              <h2 id="h-c" className="mb-3 text-lg font-semibold tracking-tight">Contas</h2>
              <ul className="grid grid-cols-1 gap-4 lg:grid-cols-2 2xl:grid-cols-3">{cash.map(renderItem)}</ul>
            </section>
          ) : null}
          {credit.length ? (
            <section aria-labelledby="h-k">
              <div className="mb-2 flex items-center justify-between gap-2">
                <h2 id="h-k" className="text-lg font-semibold tracking-tight">Cartões</h2>
                <Link href={cardHref()} className={linkCls}>Ver faturas, parcelas e limites</Link>
              </div>
              <ul className="grid grid-cols-1 gap-4 lg:grid-cols-2 2xl:grid-cols-3">{credit.map(renderItem)}</ul>
            </section>
          ) : null}
        </div>
      ) : (
        <EmptyState title="Nenhuma conta ainda" action={<ButtonLink href="/comecar">Escolher meus bancos</ButtonLink>}>
          Cadastre seus bancos e importe um extrato para ver tudo aqui.
        </EmptyState>
      )}
    </>
  );
}
