import type { Metadata } from "next";
import Link from "next/link";
import type { ReactNode } from "react";
import { and, desc, eq, isNotNull, isNull } from "drizzle-orm";
import { ArrowLeftRight, ArrowUpRight, Bell, ChevronRight, CircleAlert, CreditCard, FileUp, Info, MessageCircle, Plus, Sparkles, TriangleAlert } from "lucide-react";
import { getDb } from "@/db/client";
import * as s from "@/db/schema";
import { requireUser } from "@/lib/auth/session";
import { initials } from "@/lib/banks";
import { cardHref } from "@/lib/card-query";
import { loadAccounts, loadCards, loadCategories, loadCategoryColors, loadTransactions } from "@/lib/data/repo";
import { cardOverviews, cardsDueSoon } from "@/lib/finance/cards";
import { accountBalances, cashFlow, consolidatedBalance, detectRecurring, isFutureEntry } from "@/lib/finance/core";
import { HOME_PERIODS, homePeriod, previousComparableRange } from "@/lib/finance/period";
import { categoryColor, categoryComparison, cumulativeSpend, recurringSummary } from "@/lib/finance/views";
import { formatDateBR, formatDayMonth, formatRangeBR, todayInSaoPaulo } from "@/lib/dates";
import { changeBasisPoints, formatBRL, sumCents } from "@/lib/money";
import { alertText, plural, sanitizeUntrusted } from "@/lib/text";
import { UNCATEGORIZED_FILTER, txHref } from "@/lib/tx-query";
import { ButtonLink, CardTitle, ChipLink, EmptyState, Input, MetricCard, cx, linkCls } from "@/components/ui";
import { DeltaChip, PrivateBlock, Sensitive, SensitiveText } from "@/components/client";
import { PaceChart } from "@/components/charts";

export const metadata: Metadata = { title: "Início" };

const QUESTIONS = ["Quanto gastei neste mês?", "Tem alguma cobrança duplicada?", "Quais são minhas próximas cobranças?"];
const RECENT_SHOWN = 6;
const panel = "rounded-2xl border border-border bg-surface p-5 shadow-card sm:p-6";
const row = "flex min-h-14 items-center gap-3 rounded-xl px-2 py-2 transition-colors hover:bg-surface-2";

const SEVERITY = {
  risk: { icon: TriangleAlert, cls: "bg-risk-soft text-risk", label: "Risco" },
  attention: { icon: CircleAlert, cls: "bg-attention-soft text-attention", label: "Atenção" },
  info: { icon: Info, cls: "bg-primary-soft text-primary", label: "Informativo" },
} as const;

function AttentionRow({ href, icon, title, body, severity }: { href: string; icon: ReactNode; title: ReactNode; body: ReactNode; severity: keyof typeof SEVERITY }) {
  return (
    <li>
      <Link href={href} className="-mx-2 flex min-h-14 items-start gap-3 rounded-xl px-2 py-2.5 transition-colors hover:bg-surface-2">
        <span aria-hidden className={cx("mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-lg", SEVERITY[severity].cls)}>{icon}</span>
        <span className="min-w-0 flex-1">
          <span className="sr-only">{SEVERITY[severity].label}: </span>
          <span className="block text-[0.9375rem] font-semibold leading-snug">{title}</span>
          <span className="mt-0.5 line-clamp-2 text-meta text-muted">{body}</span>
        </span>
        <ChevronRight aria-hidden size={18} className="mt-1.5 shrink-0 text-muted" />
      </Link>
    </li>
  );
}

function Avatar({ text, card }: { text: string; card?: boolean }) {
  return <span aria-hidden className={cx("flex size-10 shrink-0 items-center justify-center rounded-xl text-xs font-bold", card ? "bg-primary-soft text-primary" : "bg-surface-3 text-muted")}>{text}</span>;
}

export default async function Dashboard({ searchParams }: { searchParams: Promise<{ periodo?: string }> }) {
  const user = await requireUser();
  const sp = await searchParams;
  const db = await getDb();
  const today = todayInSaoPaulo();
  const [accounts, categories, colors, withFuture, cards, unread, synced] = await Promise.all([
    loadAccounts(db, user.id),
    loadCategories(db, user.id),
    loadCategoryColors(db, user.id),
    loadTransactions(db, user.id, { includeFuture: true, today }),
    loadCards(db, user.id),
    db.select().from(s.notifications).where(and(eq(s.notifications.userId, user.id), isNull(s.notifications.readAt))).orderBy(desc(s.notifications.createdAt)).limit(30),
    db
      .select({ at: s.financialConnections.lastSyncAt })
      .from(s.financialConnections)
      // Demo data also has a connection row; only a real bank link can claim a sync time.
      .where(and(eq(s.financialConnections.userId, user.id), eq(s.financialConnections.connector, "open_finance"), isNotNull(s.financialConnections.lastSyncAt)))
      .orderBy(desc(s.financialConnections.lastSyncAt))
      .limit(1),
  ]);
  // Future card installments only count in their card bill; the rest of this page waits for their date.
  const txs = withFuture.filter((t) => !isFutureEntry(t, today));
  const firstName = user.name.split(" ")[0];

  if (!accounts.length) {
    return (
      <div className="flex max-w-3xl flex-col gap-6">
        <h1 className="text-[1.75rem] font-semibold leading-tight tracking-tight sm:text-[2rem]">Olá, {firstName}</h1>
        <EmptyState icon={<Sparkles aria-hidden size={22} />} title="Vamos organizar suas finanças" action={<ButtonLink href="/comecar">Começar agora</ButtonLink>}>
          Escolha seus bancos e importe um extrato. Leva poucos minutos.
        </EmptyState>
      </div>
    );
  }

  const period = homePeriod(sp.periodo, today);
  const range = period.range;
  const previousRange = previousComparableRange(range);
  const balances = accountBalances(accounts, txs, today);
  const total = consolidatedBalance(balances);
  const flow = cashFlow(txs, categories, range);
  const previous = cashFlow(txs, categories, previousRange);
  // Only a positive amount spent before is a base for a percent; refunds or nothing make it arbitrary.
  const hasHistory = previous.expenseCents > 0;
  const change = hasHistory ? changeBasisPoints(previous.expenseCents, flow.expenseCents) : null;
  const pace = cumulativeSpend(txs, categories, range);
  const pacePrevious = cumulativeSpend(txs, categories, previousRange);
  const byCategory = categoryComparison(txs, categories, range, previousRange);
  const recurring = recurringSummary(detectRecurring(txs, categories, today));
  const attention = [...unread].sort((a, b) => Number(a.severity === "info") - Number(b.severity === "info")).slice(0, 3);
  const cash = balances.filter((b) => b.type !== "credit_card");
  const periodLabel = formatRangeBR(range);
  const flowLink = { de: range.from, ate: range.to, fluxo: true };
  const overviews = cardOverviews(balances, cards, withFuture, categories, today);
  const dueSoon = cardsDueSoon(overviews, today);
  const nextCard = overviews.filter((c) => c.next).sort((a, b) => a.next!.dueDate.localeCompare(b.next!.dueDate))[0];
  const onlyCard = overviews.length === 1 ? overviews[0]!.id : undefined;
  const known = overviews.filter((c) => c.limitCents > 0);
  const limitUsed = sumCents(known.map((c) => c.openCents));
  const limitTotal = sumCents(known.map((c) => c.limitCents));
  const plans = overviews.flatMap((c) => c.plans);
  const catName = new Map(categories.map((c) => [c.id, c.name]));
  const attentionCount = dueSoon.length + unread.length;
  const color = (id: string) => categoryColor(colors.get(id));

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
        <div className="min-w-0">
          <h1 className="text-[1.75rem] font-semibold leading-tight tracking-tight sm:text-[2rem]">Olá, {firstName}</h1>
          <p className="mt-1.5 text-[0.9375rem] text-muted">
            Período analisado: <span className="font-medium text-text">{periodLabel}</span>
            {txs[0] ? <span className="block sm:inline"><span aria-hidden className="hidden sm:inline"> · </span>última transação em {formatDateBR(txs[0].date)}</span> : null}
            {synced[0]?.at ? <span className="block sm:inline"><span aria-hidden className="hidden sm:inline"> · </span>banco atualizado em {synced[0].at.toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" })}</span> : null}
          </p>
        </div>
        <nav aria-label="Período" className="scroll-fade -mx-4 flex gap-2 overflow-x-auto px-4 sm:mx-0 sm:flex-wrap sm:overflow-visible sm:px-0 sm:[mask-image:none] xl:shrink-0">
          {HOME_PERIODS.map((p) => (
            <ChipLink key={p.id} href={`/inicio?periodo=${p.id}`} active={p.id === period.id}>
              {p.label}
            </ChipLink>
          ))}
        </nav>
      </header>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2 xl:grid-cols-12 xl:gap-5">
        <MetricCard
          id="saldo"
          glow
          className="xl:col-span-5"
          label="Saldo disponível"
          testId="saldo-disponivel"
          value={<Sensitive>{formatBRL(total.availableCents)}</Sensitive>}
          qualifier={`em ${plural(cash.length, "conta", "contas")}`}
        >
          <p className="-mt-3 mb-4 text-meta text-muted">Soma das contas, sem os cartões. Não muda com o período.</p>
          <section aria-labelledby="h-contas" className="flex flex-1 flex-col border-t border-border pt-3">
            <div className="flex items-center justify-between gap-2">
              <h3 id="h-contas" className="text-sm font-semibold">Contas e cartões</h3>
              <Link href="/contas" className={linkCls}>Ver todas</Link>
            </div>
            <ul className="-mx-2 flex flex-col">
              {balances.map((b) => {
                const isCard = b.type === "credit_card";
                return (
                  <li key={b.id} className="border-t border-border/70 first:border-0">
                    <Link href={isCard ? cardHref({ cartao: b.id }) : txHref({ contas: [b.id] })} className={row}>
                      <Avatar text={initials(b.institution)} card={isCard} />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[0.9375rem] font-medium">{b.name}</span>
                        <span className="block truncate text-meta text-muted">{isCard ? "Cartão" : "Conta"} · {b.institution}</span>
                      </span>
                      <span className="shrink-0 text-right text-[0.9375rem] font-semibold tabular-nums">
                        <Sensitive>{formatBRL(isCard ? Math.max(0, -b.balanceCents) : b.balanceCents)}</Sensitive>
                        {isCard ? <span className="block text-meta font-normal text-muted">em aberto</span> : null}
                      </span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          </section>
        </MetricCard>

        <MetricCard
          id="ritmo"
          className="xl:col-span-7"
          label="Ritmo de gastos"
          value={
            <Link href={txHref({ ...flowLink, tipo: "despesa" })} className="inline-flex items-baseline gap-1.5 underline-offset-4 hover:underline">
              <span aria-hidden>−</span> <Sensitive>{formatBRL(flow.expenseCents)}</Sensitive>
            </Link>
          }
          qualifier={`em despesas, ${periodLabel}`}
          delta={<DeltaChip bp={change} goodWhen="down" caption={hasHistory ? `contra ${formatRangeBR(previousRange)}` : undefined} />}
        >
          <PaceChart current={pace} previous={pacePrevious} title={`Despesas acumuladas por dia, ${periodLabel}, contra ${formatRangeBR(previousRange)}`} />
          <dl className="mt-4 grid grid-cols-2 gap-4 border-t border-border pt-4">
            <div>
              <dt className="text-sm font-medium text-muted">Receitas</dt>
              <dd>
                <Link href={txHref({ ...flowLink, tipo: "receita" })} className="inline-flex min-h-11 items-center gap-1 text-lg font-semibold tabular-nums underline-offset-4 hover:underline">
                  <span aria-hidden>+</span> <Sensitive shownClassName="text-positive">{formatBRL(flow.incomeCents)}</Sensitive>
                </Link>
              </dd>
            </div>
            <div>
              <dt className="text-sm font-medium text-muted">Resultado do período</dt>
              <dd className="flex min-h-11 items-center text-lg font-semibold tabular-nums">
                <Sensitive shownClassName={flow.netCents < 0 ? "text-risk" : undefined}>
                  {formatBRL(flow.netCents)}
                  {flow.netCents < 0 ? <span className="sr-only"> (negativo)</span> : null}
                </Sensitive>
              </dd>
              <dd className="text-meta text-muted">Receitas menos despesas, sem transferências.</dd>
            </div>
          </dl>
        </MetricCard>

        {overviews.length ? (
          <MetricCard
            id="h-cartoes"
            className="xl:col-span-7"
            label="Cartões"
            value={<Sensitive>{formatBRL(total.cardDebtCents)}</Sensitive>}
            qualifier="em aberto, total lançado"
            action={<Link href={cardHref()} className={linkCls}>Ver cartões</Link>}
          >
            <ul className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <li>
                <Link href={cardHref({ cartao: nextCard?.id ?? onlyCard })} className="flex h-full min-h-28 flex-col justify-between gap-2 rounded-xl bg-surface-2 p-4 transition-colors hover:bg-surface-3">
                  <span className="text-sm text-muted">{nextCard?.next ? `Próxima fatura, ${nextCard.name}` : "Próxima fatura"}</span>
                  {nextCard?.next ? (
                    <span>
                      <span className="block text-xl font-semibold tabular-nums"><Sensitive>{formatBRL(nextCard.next.totalCents)}</Sensitive></span>
                      <span className="block text-meta text-muted">Vence em {formatDayMonth(nextCard.next.dueDate, today)}. {nextCard.next.bankTotalCents !== null ? "Valor informado pelo banco." : nextCard.next.status === "open" ? "Total lançado até agora." : "Soma dos lançamentos."}</span>
                    </span>
                  ) : (
                    <span className="text-meta text-muted">Informe fechamento e vencimento para ver aqui.</span>
                  )}
                </Link>
              </li>
              <li>
                <Link href={cardHref({ cartao: onlyCard, aba: "parcelas" })} className="flex h-full min-h-28 flex-col justify-between gap-2 rounded-xl bg-surface-2 p-4 transition-colors hover:bg-surface-3">
                  <span className="text-sm text-muted">Parcelas</span>
                  <span>
                    <span className="block text-xl font-semibold tabular-nums">{plans.length.toLocaleString("pt-BR")}</span>
                    <span className="block text-meta text-muted">{plans.length === 1 ? "compra em andamento" : "compras em andamento"}</span>
                  </span>
                </Link>
              </li>
              <li>
                <Link href={cardHref({ cartao: onlyCard, aba: "limites" })} className="flex h-full min-h-28 flex-col justify-between gap-2 rounded-xl bg-surface-2 p-4 transition-colors hover:bg-surface-3">
                  <span className="text-sm text-muted">Limite usado</span>
                  {limitTotal > 0 ? (
                    <span>
                      <span className="block text-xl font-semibold tabular-nums"><Sensitive>{formatBRL(limitUsed)}</Sensitive></span>
                      <span className="block text-meta text-muted">de <Sensitive>{formatBRL(limitTotal)}</Sensitive></span>
                      <PrivateBlock>
                        <span aria-hidden className="mt-2 block h-1.5 rounded-full bg-surface-3">
                          <span className={cx("block h-1.5 rounded-full", limitUsed > limitTotal ? "bg-risk" : "bg-primary")} style={{ width: `${Math.min(100, Math.max(1, Math.round((limitUsed * 100) / limitTotal)))}%` }} />
                        </span>
                      </PrivateBlock>
                    </span>
                  ) : (
                    <span className="text-meta text-muted">Limite não informado</span>
                  )}
                </Link>
              </li>
            </ul>
          </MetricCard>
        ) : null}

        <section aria-labelledby="atencao" className={cx(panel, "flex flex-col", overviews.length ? "xl:col-span-5" : "xl:col-span-12")}>
          <CardTitle
            id="atencao"
            description={attentionCount ? `${plural(attentionCount, "item", "itens")} para conferir` : "Nada pendente agora"}
            action={<Link href="/alertas" className={linkCls}>Ver alertas</Link>}
          >
            Precisa da sua atenção
          </CardTitle>
          {dueSoon.length || attention.length ? (
            <ul className="flex flex-col gap-0.5">
              {dueSoon.map((c) => (
                <AttentionRow
                  key={c.id}
                  href={cardHref({ cartao: c.id })}
                  severity="attention"
                  icon={<CreditCard size={16} />}
                  title={`${c.name} vence em ${formatDayMonth(c.next!.dueDate, today)}`}
                  body={<>{c.next!.bankTotalCents !== null ? "Valor informado pelo banco" : c.next!.status === "open" ? "Total lançado até agora" : "Soma dos lançamentos"}: <Sensitive>{formatBRL(c.next!.totalCents)}</Sensitive></>}
                />
              ))}
              {attention.map((a) => {
                const Icon = SEVERITY[a.severity].icon;
                return <AttentionRow key={a.id} href={a.links[0]?.href ?? "/alertas"} severity={a.severity} icon={<Icon size={16} />} title={<SensitiveText>{a.title}</SensitiveText>} body={<SensitiveText>{alertText(a.body)}</SensitiveText>} />;
              })}
            </ul>
          ) : (
            <div className="flex flex-1 flex-col items-start justify-center gap-2 rounded-xl bg-surface-2 p-4 text-sm text-muted">
              <Bell aria-hidden size={20} className="text-primary" />
              Quando um agente encontrar algo ou um cartão estiver para vencer, aparece aqui.
            </div>
          )}
          {unread.length > attention.length ? <p className="mt-auto pt-3 text-meta text-muted">Mais {plural(unread.length - attention.length, "alerta não lido", "alertas não lidos")} em Alertas.</p> : null}
        </section>

        <section aria-labelledby="categorias" className={cx(panel, "xl:col-span-5")}>
          <CardTitle id="categorias" description={periodLabel}>
            Gastos por categoria
          </CardTitle>
          {byCategory.rows.length ? (
            <ol className="flex flex-col gap-1">
              {byCategory.rows.slice(0, 5).map((c) => (
                <li key={c.categoryId}>
                  <Link
                    href={txHref({ de: range.from, ate: range.to, categoria: c.categoryId, tipo: c.categoryId === UNCATEGORIZED_FILTER ? "despesa" : undefined })}
                    className="-mx-2 block rounded-xl px-2 py-2 transition-colors hover:bg-surface-2"
                  >
                    <span className="flex items-center justify-between gap-3 text-[0.9375rem]">
                      <span className="flex min-w-0 items-center gap-2 font-medium">
                        <span aria-hidden className="size-2.5 shrink-0 rounded-full" style={{ background: color(c.categoryId) }} />
                        <span className="truncate">{c.name}</span>
                      </span>
                      <span className="shrink-0 font-semibold tabular-nums"><Sensitive>{formatBRL(c.totalCents)}</Sensitive></span>
                    </span>
                    <PrivateBlock>
                      <span aria-hidden className="mt-1.5 block h-1.5 rounded-full bg-surface-3">
                        <span className="block h-1.5 rounded-full" style={{ width: `${Math.max(2, Math.round(c.shareBp / 100))}%`, background: color(c.categoryId) }} />
                      </span>
                    </PrivateBlock>
                  </Link>
                </li>
              ))}
            </ol>
          ) : (
            <EmptyState title="Sem despesas neste período" />
          )}
          <Link href={`/categorias?mes=${range.from.slice(0, 7)}`} className={cx(linkCls, "mt-2")}>Ver todas as categorias</Link>
        </section>

        <section aria-labelledby="h-recentes" className={cx(panel, "xl:col-span-7")}>
          <CardTitle
            id="h-recentes"
            action={
              <span className="flex items-center gap-4">
                <Link href="/transacoes/novo" className={linkCls}><Plus aria-hidden size={16} /> Adicionar</Link>
                <Link href="/transacoes" className={linkCls}>Ver todas</Link>
              </span>
            }
          >
            Transações recentes
          </CardTitle>
          {txs.length ? (
            <ul className="-mx-2 flex flex-col">
              {txs.slice(0, RECENT_SHOWN).map((t) => (
                <li key={t.id} className="border-t border-border/70 first:border-0">
                  <Link href={`/transacoes/${t.id}`} className={row}>
                    <Avatar text={initials(t.description)} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[0.9375rem] font-medium">{sanitizeUntrusted(t.description, 80)}</span>
                      <span className="block truncate text-meta text-muted">{formatDateBR(t.date)} · {catName.get(t.categoryId ?? "") ?? "Sem categoria"}</span>
                    </span>
                    <span className="shrink-0 text-[0.9375rem] font-semibold tabular-nums">
                      <Sensitive shownClassName={t.amountCents > 0 ? "text-positive" : undefined}>{t.amountCents > 0 ? `+${formatBRL(t.amountCents)}` : formatBRL(t.amountCents)}</Sensitive>
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          ) : (
            <EmptyState title="Nenhuma transação ainda" action={<ButtonLink href="/transacoes/importar">Importar extrato</ButtonLink>} />
          )}
        </section>

        <MetricCard
          id="h-recorrentes"
          className="xl:col-span-5"
          label="Recorrentes"
          value={recurring.subscriptions.length ? <Sensitive>{formatBRL(recurring.monthlyCents)}</Sensitive> : "Nenhuma"}
          qualifier={recurring.subscriptions.length ? `por mês, ${plural(recurring.subscriptions.length, "cobrança", "cobranças")}` : "cobrança recorrente encontrada"}
          action={<Link href="/recorrentes" className={linkCls}>Ver todas</Link>}
        >
          {recurring.subscriptions.length ? (
            <ul className="-mx-2 flex flex-col">
              {recurring.subscriptions.slice(0, 3).map((r) => (
                <li key={r.lastTransactionId} className="border-t border-border/70 first:border-0">
                  <Link href={`/transacoes/${r.lastTransactionId}`} className={row}>
                    <Avatar text={initials(r.label)} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[0.9375rem] font-medium">{sanitizeUntrusted(r.label, 60)}</span>
                      <span className="block text-meta text-muted">Próxima prevista: {formatDateBR(r.nextDate)}</span>
                    </span>
                    <span className="shrink-0 text-[0.9375rem] font-semibold tabular-nums"><Sensitive>{formatBRL(-r.amountCents)}</Sensitive></span>
                  </Link>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-muted">Aparecem depois de dois meses seguidos de cobrança no mesmo lugar.</p>
          )}
          <p className="mt-auto pt-3 text-meta text-muted">Estimado pelo histórico. Não confirmado com o banco.</p>
        </MetricCard>

        <section aria-labelledby="perguntar" className={cx(panel, "card-glow xl:col-span-7")}>
          <CardTitle id="perguntar" description="Os números vêm dos seus dados, com a origem de cada um.">Pergunte ou vá direto ao ponto</CardTitle>
          <form action="/chat" method="get" className="flex gap-2">
            <label htmlFor="q" className="sr-only">Sua pergunta</label>
            <Input id="q" name="q" placeholder="Quanto gastei com mercado?…" required className="min-w-0 flex-1" />
            <button aria-label="Levar pergunta para o chat" className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-xl bg-primary text-primary-fg shadow-card transition-colors hover:bg-primary-hover">
              <Sparkles aria-hidden size={18} />
            </button>
          </form>
          <ul className="mt-3 flex flex-wrap gap-2">
            {QUESTIONS.map((q) => (
              <li key={q}>
                <Link href={`/chat?q=${encodeURIComponent(q)}`} className="inline-flex min-h-11 items-center gap-1.5 rounded-xl border border-border px-3 text-sm transition-colors hover:border-primary/50 hover:text-primary">
                  {q} <ArrowUpRight aria-hidden size={14} className="shrink-0 text-muted" />
                </Link>
              </li>
            ))}
          </ul>
          <nav aria-label="Atalhos" className="mt-5 grid grid-cols-1 gap-2 border-t border-border pt-4 min-[420px]:grid-cols-2">
            <ButtonLink href={cardHref()} variant="secondary" className="justify-start"><CreditCard aria-hidden size={18} /> Ver cartões</ButtonLink>
            <ButtonLink href="/transacoes" variant="secondary" className="justify-start"><ArrowLeftRight aria-hidden size={18} /> Ver transações</ButtonLink>
            <ButtonLink href="/transacoes/importar" variant="secondary" className="justify-start"><FileUp aria-hidden size={18} /> Importar extrato</ButtonLink>
            <ButtonLink href="/chat" variant="secondary" className="justify-start"><MessageCircle aria-hidden size={18} /> Perguntar ao assistente</ButtonLink>
          </nav>
        </section>
      </div>
    </div>
  );
}
