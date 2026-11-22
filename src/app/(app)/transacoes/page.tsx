import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { and, count, eq } from "drizzle-orm";
import { CalendarDays, ChevronLeft, ChevronRight, Hash, Inbox, Plus, Scale, Search, SearchX, SlidersHorizontal, TrendingDown, TrendingUp, X } from "lucide-react";
import { getDb } from "@/db/client";
import * as s from "@/db/schema";
import { requireUser } from "@/lib/auth/session";
import { cardHref } from "@/lib/card-query";
import { loadAccounts, loadCategories, loadCategoryColors, searchTransactions } from "@/lib/data/repo";
import { categoryColor } from "@/lib/finance/views";
import { presetRange } from "@/lib/finance/period";
import { addDays, addMonths, endOfMonth, formatDateBR, startOfMonth, todayInSaoPaulo } from "@/lib/dates";
import { formatBRL } from "@/lib/money";
import { plural } from "@/lib/text";
import { reviewCount } from "@/lib/review";
import { ORIGINS, PAGE_SIZE, UNCATEGORIZED_FILTER, parseTxQuery, txHref, type TxQuery } from "@/lib/tx-query";
import { Badge, Button, ButtonLink, EmptyState, Input, Notice, PageHeader, Select, cx } from "@/components/ui";
import { Sensitive } from "@/components/client";
import { Sheet } from "./sheet";
import { TxTabs } from "./tabs";

export const metadata: Metadata = { title: "Transações" };

const MONTHS = ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"];
const monthLabel = (ymd: string) => {
  const name = MONTHS[Number(ymd.slice(5, 7)) - 1]!;
  return `${name[0]!.toUpperCase()}${name.slice(1)} de ${ymd.slice(0, 4)}`;
};
const dayLabel = (date: string, today: string) => (date === today ? "Hoje" : date === addDays(today, -1) ? "Ontem" : formatDateBR(date));
const TIPO_LABEL = { receita: "Receitas", despesa: "Despesas", transferencia: "Transferências" } as const;
const trigger = "inline-flex min-h-11 items-center gap-2 rounded-xl border border-border bg-surface px-3.5 text-[0.9375rem] font-semibold transition-colors hover:border-border-strong hover:bg-surface-2";

function Hidden({ q, omit = [] }: { q: TxQuery; omit?: (keyof TxQuery)[] }) {
  const values: [string, string | undefined][] = [
    ["de", q.de],
    ["ate", q.ate],
    ["q", q.q],
    ["tipo", q.tipo],
    ["categoria", q.categoria],
    ["contas", q.contas?.join(",")],
    ["origem", q.origem],
    ["status", q.status],
    ["ordem", q.ordem],
    ["fluxo", q.fluxo ? "1" : undefined],
  ];
  return values.filter(([k, v]) => v && !omit.includes(k as keyof TxQuery)).map(([k, v]) => <input key={k} type="hidden" name={k} value={v} />);
}

export default async function TransactionsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const user = await requireUser();
  const sp = await searchParams;
  if (sp.novo) redirect("/transacoes/novo"); // older links
  const db = await getDb();
  const today = todayInSaoPaulo();
  const q = parseTxQuery(sp, today);
  const [accounts, categories, colors] = await Promise.all([loadAccounts(db, user.id), loadCategories(db, user.id), loadCategoryColors(db, user.id)]);
  // Only ids this user owns survive; a tampered URL behaves like no filter.
  const contas = q.contas?.filter((id) => accounts.some((a) => a.id === id));
  const categoria = q.categoria === UNCATEGORIZED_FILTER || categories.some((c) => c.id === q.categoria) ? q.categoria : undefined;
  const query = { ...q, contas: contas?.length ? contas : undefined, categoria };
  const [result, toReview, [pendingRows], [outdated]] = await Promise.all([
    // A list of card accounts only also shows installments the bank already dated later, as the card bill counts them.
    searchTransactions(db, user.id, query, categories, { includeFuture: !!contas?.length && contas.every((id) => accounts.some((a) => a.id === id && a.type === "credit_card")) }),
    reviewCount(db, user.id),
    db.select({ n: count() }).from(s.transactions).where(and(eq(s.transactions.userId, user.id), eq(s.transactions.bankStatus, "pending"))),
    db.select({ n: count() }).from(s.financialConnections).where(and(eq(s.financialConnections.userId, user.id), eq(s.financialConnections.status, "error"))),
  ]);
  const shown = result.rows;
  const lastPage = Math.max(1, Math.ceil(result.total / PAGE_SIZE));
  const catName = new Map(categories.map((c) => [c.id, c.name]));
  const account = new Map(accounts.map((a) => [a.id, a]));
  const single = query.contas?.length === 1 ? account.get(query.contas[0]!) : undefined;
  const onlyCard = single?.type === "credit_card" ? single : undefined;
  const byDate = new Map<string, typeof shown>();
  for (const t of shown) byDate.set(t.date, [...(byDate.get(t.date) ?? []), t]);

  const base = { ...query, pagina: undefined };
  const wholeMonth = q.de === startOfMonth(q.de) && (q.ate === endOfMonth(q.de) || q.ate === today);
  const periodLabel = wholeMonth ? monthLabel(q.de) : `${formatDateBR(q.de)} a ${formatDateBR(q.ate)}`;
  const monthHref = (ymd: string) => {
    const end = endOfMonth(ymd);
    return txHref({ ...base, de: ymd, ate: end > today ? today : end });
  };
  const anchor = startOfMonth(q.de);
  const nextMonth = addMonths(anchor, 1);
  const quick = [
    { label: "Este mês", ...presetRange("this_month", today) },
    { label: "Mês passado", ...presetRange("last_month", today) },
    { label: "Últimos 30 dias", from: addDays(today, -29), to: today },
    { label: "Últimos 90 dias", from: addDays(today, -89), to: today },
    { label: "Últimos 12 meses", from: addDays(today, -364), to: today },
  ];

  const categoryLabel = query.categoria === UNCATEGORIZED_FILTER ? "Sem categoria" : catName.get(query.categoria ?? "");
  const chips: { label: string; href: string }[] = [
    ...(query.q ? [{ label: `Busca: ${query.q}`, href: txHref({ ...base, q: undefined }) }] : []),
    ...(query.tipo ? [{ label: TIPO_LABEL[query.tipo], href: txHref({ ...base, tipo: undefined }) }] : []),
    ...(categoryLabel ? [{ label: categoryLabel, href: txHref({ ...base, categoria: undefined }) }] : []),
    ...(query.contas ?? []).map((id) => ({ label: account.get(id)?.name ?? "Conta", href: txHref({ ...base, contas: query.contas?.filter((c) => c !== id) }) })),
    ...(query.origem ? [{ label: ORIGINS[query.origem], href: txHref({ ...base, origem: undefined }) }] : []),
    ...(query.status ? [{ label: "Aguardando o banco", href: txHref({ ...base, status: undefined }) }] : []),
    ...(query.fluxo ? [{ label: "Sem transferências", href: txHref({ ...base, fluxo: undefined }) }] : []),
  ];
  const filterCount = chips.filter((c) => !c.label.startsWith("Busca:")).length;
  const hasFilters = chips.length > 0;
  // The plain view has no state worth carrying into a detail link.
  const here = hasFilters || sp.de || sp.ate || query.ordem || query.pagina ? txHref(query) : "/transacoes";
  const detailHref = (id: string) => (here === "/transacoes" ? `/transacoes/${id}` : `/transacoes/${id}?volta=${encodeURIComponent(here)}`);

  return (
    <>
      <PageHeader
        title="Transações"
        description="Busque, filtre e confira cada lançamento. Os filtros ficam no endereço da página."
        action={<ButtonLink href="/transacoes/novo"><Plus aria-hidden size={18} /> Adicionar</ButtonLink>}
      />
      <TxTabs current="movimentacoes" reviewCount={toReview} />

      <section aria-label="Resumo do período" className="mb-5">
        <dl className="grid grid-cols-2 gap-3 lg:grid-cols-4 lg:gap-4" aria-live="polite">
          <div className="flex min-w-0 items-start gap-3 rounded-2xl border border-border bg-surface p-4 shadow-card sm:p-5">
            <span aria-hidden className="hidden size-9 shrink-0 items-center justify-center rounded-xl sm:flex bg-surface-3 text-muted"><Hash size={18} /></span>
            <div className="min-w-0">
              <dt className="text-sm font-medium text-muted">Transações</dt>
              <dd className="mt-0.5 break-words text-lg font-semibold tracking-tight tabular-nums sm:text-[1.375rem]">{result.total.toLocaleString("pt-BR")}</dd>
            </div>
          </div>
          <div className="flex min-w-0 items-start gap-3 rounded-2xl border border-border bg-surface p-4 shadow-card sm:p-5">
            <span aria-hidden className="hidden size-9 shrink-0 items-center justify-center rounded-xl sm:flex bg-risk-soft text-risk"><TrendingDown size={18} /></span>
            <div className="min-w-0">
              <dt className="text-sm font-medium text-muted">Saídas</dt>
              <dd className="mt-0.5 break-words text-lg font-semibold tracking-tight tabular-nums sm:text-[1.375rem]"><Sensitive>{formatBRL(-result.expenseCents)}</Sensitive></dd>
            </div>
          </div>
          <div className="flex min-w-0 items-start gap-3 rounded-2xl border border-border bg-surface p-4 shadow-card sm:p-5">
            <span aria-hidden className="hidden size-9 shrink-0 items-center justify-center rounded-xl sm:flex bg-positive-soft text-positive"><TrendingUp size={18} /></span>
            <div className="min-w-0">
              <dt className="text-sm font-medium text-muted">Entradas</dt>
              <dd className="mt-0.5 break-words text-lg font-semibold tracking-tight tabular-nums sm:text-[1.375rem]"><Sensitive shownClassName="text-positive">{`+${formatBRL(result.incomeCents)}`}</Sensitive></dd>
            </div>
          </div>
          <div className="flex min-w-0 items-start gap-3 rounded-2xl border border-border bg-surface p-4 shadow-card sm:p-5">
            <span aria-hidden className="hidden size-9 shrink-0 items-center justify-center rounded-xl sm:flex bg-primary-soft text-primary"><Scale size={18} /></span>
            <div className="min-w-0">
              <dt className="text-sm font-medium text-muted">Resultado do período</dt>
              <dd className="mt-0.5 break-words text-lg font-semibold tracking-tight tabular-nums sm:text-[1.375rem]"><Sensitive shownClassName={result.incomeCents - result.expenseCents < 0 ? "text-risk" : undefined}>{formatBRL(result.incomeCents - result.expenseCents)}</Sensitive></dd>
            </div>
          </div>
        </dl>
        <p className="mt-2.5 text-meta text-muted">{plural(result.total, "transação", "transações")}. Sem transferências e pagamentos de fatura. Não é o saldo da conta. Período: {periodLabel}.</p>
      </section>
      <div className="flex flex-col gap-4">
        <div className="min-w-0">
          <div className="rounded-2xl border border-border bg-surface p-3 shadow-card sm:p-4">
            <div className="flex flex-wrap items-center gap-2 sm:gap-3">
              <div className="flex items-center rounded-xl border border-border bg-surface-2">
                <Link href={monthHref(addMonths(anchor, -1))} aria-label="Mês anterior" className="flex size-11 items-center justify-center rounded-l-xl transition-colors hover:bg-surface-3"><ChevronLeft aria-hidden size={18} /></Link>
                <Sheet label={<><CalendarDays aria-hidden size={16} className="hidden text-muted sm:block" /> {periodLabel}</>} title="Período" ariaLabel={`Período: ${periodLabel}. Alterar`} triggerClassName="inline-flex min-h-11 items-center gap-2 px-2 text-[0.9375rem] font-semibold transition-colors hover:bg-surface-3">
                  <ul className="mb-4 flex flex-col gap-1">
                    {quick.map((p) => (
                      <li key={p.label}>
                        <Link href={txHref({ ...base, de: p.from, ate: p.to })} className="flex min-h-11 items-center rounded-xl px-3 text-[0.9375rem] hover:bg-surface-3">{p.label}</Link>
                      </li>
                    ))}
                  </ul>
                  <form method="get" className="grid grid-cols-2 gap-3 border-t border-border pt-4" aria-label="Escolher datas">
                    <Hidden q={query} omit={["de", "ate"]} />
                    <div className="flex min-w-0 flex-col gap-1.5">
                      <label htmlFor="de" className="text-sm font-semibold">De</label>
                      <Input id="de" name="de" type="date" defaultValue={q.de} />
                    </div>
                    <div className="flex min-w-0 flex-col gap-1.5">
                      <label htmlFor="ate" className="text-sm font-semibold">Até</label>
                      <Input id="ate" name="ate" type="date" defaultValue={q.ate} />
                    </div>
                    <Button className="col-span-2">Aplicar período</Button>
                  </form>
                </Sheet>
                {nextMonth <= today ? (
                  <Link href={monthHref(nextMonth)} aria-label="Próximo mês" className="flex size-11 items-center justify-center rounded-r-xl transition-colors hover:bg-surface-3"><ChevronRight aria-hidden size={18} /></Link>
                ) : (
                  <span aria-hidden className="w-2" />
                )}
              </div>
              <form method="get" role="search" aria-label="Buscar transações" className="order-last w-full sm:order-none sm:w-auto sm:min-w-48 sm:flex-1">
                <Hidden q={query} omit={["q"]} />
                <label htmlFor="busca" className="sr-only">Buscar por descrição</label>
                <div className="relative">
                  <Search aria-hidden size={18} className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-muted" />
                  <Input id="busca" name="q" type="search" defaultValue={query.q ?? ""} placeholder="Buscar por descrição" className="pl-10" />
                </div>
              </form>
              <Sheet
                label={<><SlidersHorizontal aria-hidden size={18} /> Filtros{filterCount ? ` (${filterCount})` : ""}</>}
                title="Filtros"
                triggerClassName={cx(trigger, "ml-auto sm:ml-0", filterCount > 0 && "border-primary bg-primary-soft text-primary")}
              >
                <form method="get" className="flex flex-col gap-4" aria-label="Filtros">
                  <Hidden q={query} omit={["tipo", "categoria", "contas", "origem", "status", "ordem"]} />
                  <div className="flex flex-col gap-1.5">
                    <label htmlFor="tipo" className="text-sm font-semibold">Tipo</label>
                    <Select id="tipo" name="tipo" defaultValue={query.tipo ?? ""}>
                      <option value="">Todas</option>
                      {Object.entries(TIPO_LABEL).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                    </Select>
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <label htmlFor="categoria" className="text-sm font-semibold">Categoria</label>
                    <Select id="categoria" name="categoria" defaultValue={query.categoria ?? ""}>
                      <option value="">Todas</option>
                      <option value={UNCATEGORIZED_FILTER}>Sem categoria</option>
                      {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                    </Select>
                  </div>
                  <fieldset>
                    <legend className="mb-1 text-sm font-semibold">Contas e cartões</legend>
                    <div className="flex flex-col">
                      {accounts.map((a) => (
                        <label key={a.id} className="flex min-h-11 items-center gap-3 rounded-lg px-1 text-[0.9375rem] hover:bg-surface-3">
                          <input type="checkbox" name="contas" value={a.id} defaultChecked={query.contas?.includes(a.id)} className="size-[18px] shrink-0 accent-[var(--primary)]" />
                          <span className="min-w-0 truncate">{a.name}</span>
                        </label>
                      ))}
                    </div>
                  </fieldset>
                  <div className="flex flex-col gap-1.5">
                    <label htmlFor="origem" className="text-sm font-semibold">Origem</label>
                    <Select id="origem" name="origem" defaultValue={query.origem ?? ""}>
                      <option value="">Todas</option>
                      {Object.entries(ORIGINS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                    </Select>
                  </div>
                  {pendingRows?.n ? (
                    <label className="flex min-h-11 items-center gap-3 text-[0.9375rem]">
                      <input type="checkbox" name="status" value="pendente" defaultChecked={query.status === "pendente"} className="size-[18px] accent-[var(--primary)]" />
                      Só o que aguarda o banco
                    </label>
                  ) : null}
                  <div className="flex flex-col gap-1.5">
                    <label htmlFor="ordem" className="text-sm font-semibold">Ordem</label>
                    <Select id="ordem" name="ordem" defaultValue={query.ordem ?? ""}>
                      <option value="">Mais recentes primeiro</option>
                      <option value="antigas">Mais antigas primeiro</option>
                    </Select>
                  </div>
                  <Button>Aplicar filtros</Button>
                </form>
              </Sheet>
            </div>

            {chips.length ? (
              <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-border pt-3">
                <span className="text-meta font-medium text-muted">Filtros ativos:</span>
                {chips.map((c) => (
                  <Link key={c.label} href={c.href} aria-label={`Remover filtro: ${c.label}`} className="inline-flex min-h-9 max-w-full items-center gap-1.5 rounded-full border border-primary/30 bg-primary-soft px-3 text-sm font-medium text-primary transition-colors hover:border-primary">
                    <span className="truncate">{c.label}</span> <X aria-hidden size={14} className="shrink-0" />
                  </Link>
                ))}
                <Link href={txHref({ de: sp.de ? q.de : undefined, ate: sp.ate ? q.ate : undefined })} className="inline-flex min-h-9 items-center px-1 text-sm font-semibold text-primary underline-offset-4 hover:underline">Limpar</Link>
              </div>
            ) : null}
          </div>
        </div>

        <div className="flex min-w-0 flex-col gap-4">

          {onlyCard ? (
            <Notice tone="info">
              Vendo só {onlyCard.name}. <Link className="font-semibold text-primary underline underline-offset-2" href={cardHref({ cartao: onlyCard.id })}>Ver faturas deste cartão</Link>
            </Notice>
          ) : null}

          {outdated?.n ? (
            <Notice tone="attention">
              Dados bancários podem estar desatualizados. <Link className="font-semibold text-primary underline" href="/transacoes/revisar">Ver o que houve</Link>
            </Notice>
          ) : null}

          {shown.length ? (
            <div className="flex flex-col gap-4">
              <div className="overflow-clip rounded-2xl border border-border bg-surface shadow-card">
                <div aria-hidden className="hidden grid-cols-[minmax(0,1fr)_10rem_10rem_8.5rem] gap-x-4 border-b border-border bg-surface-2 px-5 py-2.5 text-meta font-medium text-muted lg:grid">
                  <span>Descrição</span>
                  <span>Categoria</span>
                  <span>Conta ou cartão</span>
                  <span className="text-right">Valor</span>
                </div>
                {[...byDate.entries()].map(([date, list]) => (
                  <section key={date} aria-labelledby={`d-${date}`} className="border-b border-border last:border-0">
                    <h2 id={`d-${date}`} className="sticky top-[3.6rem] z-[1] bg-surface/95 px-4 pb-1 pt-4 text-sm font-semibold backdrop-blur sm:px-5">{dayLabel(date, today)}</h2>
                    <ul>
                      {list.map((t) => {
                        const acc = account.get(t.accountId);
                        const category = catName.get(t.categoryId ?? "") ?? "Sem categoria";
                        return (
                          <li key={t.id} className="border-t border-border/60 first:border-0">
                            <Link href={detailHref(t.id)} className="grid min-h-16 grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-0.5 px-4 py-3 transition-colors hover:bg-surface-2 sm:px-5 lg:grid-cols-[minmax(0,1fr)_10rem_10rem_8.5rem]">
                              <p className="min-w-0 break-words text-[0.9375rem] font-medium leading-snug">
                                {t.description}
                                {t.bankStatus === "pending" ? <span className="ml-2 inline-block align-middle"><Badge>Aguardando o banco</Badge></span> : null}
                              </p>
                              <span className={cx("row-span-2 text-right text-[0.9375rem] font-semibold tabular-nums lg:order-last lg:row-span-1")}>
                                <Sensitive shownClassName={t.amountCents > 0 ? "text-positive" : undefined}>{t.amountCents > 0 ? `+${formatBRL(t.amountCents)}` : formatBRL(t.amountCents)}</Sensitive>
                              </span>
                              <p className="min-w-0 truncate text-meta text-muted lg:hidden">{category} · {acc?.name}</p>
                              <p className="hidden min-w-0 lg:block">
                                <span className={cx("inline-flex max-w-full items-center gap-1.5 rounded-full px-2.5 py-0.5 text-meta font-medium", t.categoryId ? "bg-surface-3 text-text" : "bg-attention-soft text-attention")}>{t.categoryId ? <span aria-hidden className="size-2 shrink-0 rounded-full" style={{ background: categoryColor(colors.get(t.categoryId)) }} /> : null}<span className="truncate">{category}</span></span>
                              </p>
                              <p className="hidden min-w-0 truncate text-sm text-muted lg:block">{acc?.name}</p>
                            </Link>
                          </li>
                        );
                      })}
                    </ul>
                  </section>
                ))}
              </div>
              {lastPage > 1 ? (
                <nav aria-label="Páginas" className="flex flex-wrap items-center justify-center gap-3">
                  {result.page > 1 ? <ButtonLink href={txHref({ ...query, pagina: result.page === 2 ? undefined : result.page - 1 })} variant="secondary">Página anterior</ButtonLink> : null}
                  <p className="text-sm text-muted">Página {result.page.toLocaleString("pt-BR")} de {lastPage.toLocaleString("pt-BR")}</p>
                  {result.page < lastPage ? <ButtonLink href={txHref({ ...query, pagina: result.page + 1 })} variant="secondary">Próxima página</ButtonLink> : null}
                </nav>
              ) : null}
            </div>
          ) : hasFilters ? (
            <EmptyState icon={<SearchX aria-hidden size={22} />} title="Nada encontrado com estes filtros" action={<ButtonLink href="/transacoes" variant="secondary">Limpar filtros</ButtonLink>}>
              Tente outro período, outra busca ou remova um dos filtros acima.
            </EmptyState>
          ) : (
            <EmptyState icon={<Inbox aria-hidden size={22} />} title={sp.de ? "Nenhuma transação neste período" : "Nenhuma transação este mês"} action={<ButtonLink href="/transacoes/importacoes">Trazer transações</ButtonLink>}>
              Importe um extrato, conecte um banco ou adicione um lançamento.
            </EmptyState>
          )}
        </div>
      </div>
    </>
  );
}
