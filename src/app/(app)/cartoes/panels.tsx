import Link from "next/link";
import { ChevronLeft, ChevronRight } from "lucide-react";
import type { ReactNode } from "react";
import { initials } from "@/lib/banks";
import { formatDateBR, formatDayMonth, formatMonthYear, monthName, type DateRange } from "@/lib/dates";
import { closingText, type CardOverview, type CardStatement, type InstallmentPlan, type MonthInstallment } from "@/lib/finance/cards";
import { formatBRL, sumCents } from "@/lib/money";
import { plural, sanitizeUntrusted } from "@/lib/text";
import { txHref } from "@/lib/tx-query";
import { Badge, Card, EmptyState, Notice, cx } from "@/components/ui";
import { PrivateBlock, Sensitive } from "@/components/client";
import { MonthBars, type MonthBar } from "@/components/charts";

const EDIT = "/configuracoes?aba=contas";
const link = "inline-flex min-h-11 items-center text-sm font-semibold text-primary underline-offset-4 hover:underline";
const shortMonth = (ymd: string, today: string) => `${monthName(Number(ymd.slice(5, 7))).slice(0, 3)}${ymd.slice(0, 4) === today.slice(0, 4) ? "" : `/${ymd.slice(2, 4)}`}`;
const monthTitle = (ym: string) => formatMonthYear(`${ym}-01`);
type MonthNavLinks = { prev: string | null; next: string | null };
type Bar = { month: string; cents: number; pending: boolean; href: string };

/** ‹ month › control. Each arrow is a link, so the chosen month lives in the URL and back/forward restore it. */
function MonthNav({ label, title, nav, prevLabel, nextLabel }: { label: string; title: string; nav: MonthNavLinks; prevLabel: string; nextLabel: string }) {
  const arrow = "flex size-11 shrink-0 items-center justify-center transition-colors hover:bg-surface-3";
  return (
    <nav aria-label={label} className="flex w-fit items-center rounded-xl border border-border bg-surface shadow-card">
      {nav.prev ? <Link href={nav.prev} scroll={false} aria-label={prevLabel} className={cx(arrow, "rounded-l-xl")}><ChevronLeft aria-hidden size={18} /></Link> : <span aria-hidden className="w-11" />}
      <span className="min-w-44 px-2 text-center text-[0.9375rem] font-semibold first-letter:uppercase">{title}</span>
      {nav.next ? <Link href={nav.next} scroll={false} aria-label={nextLabel} className={cx(arrow, "rounded-r-xl")}><ChevronRight aria-hidden size={18} /></Link> : <span aria-hidden className="w-11" />}
    </nav>
  );
}

const toBars = (bars: Bar[], selected: string, today: string): MonthBar[] =>
  bars.map((b) => ({ key: b.month, label: shortMonth(`${b.month}-01`, today), month: monthTitle(b.month), cents: b.cents, hatched: b.pending, active: b.month === selected, href: b.href }));

const shortRange = (r: DateRange) => `${formatDateBR(r.from).slice(0, 5)} a ${formatDateBR(r.to).slice(0, 5)}`;

function Headline({ label, value, children }: { label: string; value: ReactNode; children?: ReactNode }) {
  return (
    <div>
      <h2 className="text-[0.9375rem] font-medium text-muted">{label}</h2>
      <p data-testid="cartoes-total" className="mt-1 break-words text-[2.25rem] font-semibold leading-tight tracking-tight tabular-nums sm:text-[2.75rem]">{value}</p>
      {children ? <div className="mt-2 max-w-prose text-sm text-muted">{children}</div> : null}
    </div>
  );
}

function CardIdentity({ card, children }: { card: CardOverview; children?: ReactNode }) {
  return (
    <div className="flex items-center gap-3">
      <span aria-hidden className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-primary-soft text-meta font-bold text-primary">{initials(card.institution)}</span>
      <div className="min-w-0 flex-1">
        <h3 className="break-words text-lg font-semibold leading-snug">{card.name}</h3>
        <p className="break-words text-sm text-muted">{card.institution}</p>
      </div>
      {children}
    </div>
  );
}

function NoCycle() {
  return (
    <EmptyState title="Faltam os dias de fechamento e vencimento" action={<Link href={EDIT} className={link}>Informar os dias</Link>}>
      Sem eles não dá para separar as compras por fatura.
    </EmptyState>
  );
}

function StatementRow({ s, today }: { s: CardStatement; today: string }) {
  const due = formatDayMonth(s.dueDate, today);
  const paymentsHref = s.paymentWindow ? txHref({ contas: [s.accountId], de: s.paymentWindow.from, ate: s.paymentWindow.to, tipo: "transferencia" }) : "";
  return (
    <li className="py-4 first:pt-0 last:pb-0">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[0.9375rem] font-semibold">{s.dueDate < today ? "Venceu" : "Vence"} em {due}</p>
          <p className="text-sm text-muted">Compras de {shortRange(s.cycle)}</p>
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1">
          <p className="text-lg font-semibold tabular-nums"><Sensitive>{formatBRL(s.totalCents)}</Sensitive></p>
          {s.status === "open" ? <Badge tone="attention">Aberta</Badge> : s.status === "future" ? <Badge tone="info">Prevista</Badge> : <Badge>Fechada</Badge>}
        </div>
      </div>
      {s.bankTotalCents !== null ? (
        <p className="mt-1 text-sm text-muted">
          Valor informado pelo banco.
          {s.minimumCents !== null ? <> Pagamento mínimo: <Sensitive>{formatBRL(s.minimumCents)}</Sensitive>.</> : null}
        </p>
      ) : null}
      {s.bankTotalCents !== null && Math.abs(s.bankTotalCents - s.computedCents) >= 100 ? (
        <p className="mt-1 text-sm text-muted">
          Os lançamentos compartilhados somam <Sensitive>{formatBRL(s.computedCents)}</Sensitive>. A diferença de <Sensitive>{formatBRL(Math.abs(s.bankTotalCents - s.computedCents))}</Sensitive> pode ser juros, tarifas, saldo anterior ou lançamentos que o banco não enviou.
        </p>
      ) : null}
      {s.status === "open" ? <p className="mt-1 text-sm text-muted">Fecha {closingText(s)}. Novas compras ainda entram.</p> : null}
      {s.status === "future" ? <p className="mt-1 text-sm text-muted">Abre em {formatDayMonth(s.cycle.from, today)}. Por enquanto mostra só {plural(s.count, "parcela já conhecida", "parcelas já conhecidas")}; compras novas entram depois.</p> : null}
      {s.refundsCents > 0 ? <p className="mt-1 text-sm text-muted">Já desconta <Sensitive>{formatBRL(s.refundsCents)}</Sensitive> em estornos.</p> : null}
      {s.paymentsCents > 0 ? (
        <p className="mt-1 text-sm text-muted">Pagamento lançado entre {shortRange(s.paymentWindow!)}: <Sensitive>{formatBRL(s.paymentsCents)}</Sensitive></p>
      ) : s.status === "closed" && s.dueDate < today ? (
        <p className="mt-1 text-sm text-muted">Nenhum pagamento lançado neste cartão.</p>
      ) : null}
      <div className="flex flex-wrap gap-x-4">
        {s.status === "future" ? null : <Link href={txHref({ contas: [s.accountId], de: s.cycle.from, ate: s.cycle.to, fluxo: true })} aria-label={s.matchesRange ? `Ver ${plural(s.count, "lançamento", "lançamentos")} da fatura que vence em ${due}` : `Ver lançamentos de ${shortRange(s.cycle)}, período da fatura que vence em ${due}`} className={link}>
          {s.matchesRange ? `Ver ${plural(s.count, "lançamento", "lançamentos")}` : "Ver lançamentos do período"}
        </Link>}
        {s.paymentsCents > 0 ? <Link href={paymentsHref} aria-label={`Ver pagamentos da fatura que vence em ${due}`} className={link}>Ver pagamentos</Link> : null}
        {s.status === "future" ? null : <Link href={`/cartoes/conferir?${new URLSearchParams({ cartao: s.accountId, mes: s.dueDate.slice(0, 7) })}`} aria-label={`Conferir a fatura que vence em ${due}`} className={link}>Conferir fatura</Link>}
      </div>
    </li>
  );
}

export function StatementsPanel({ cards, selected, today, month, statements, bars, nav }: { cards: CardOverview[]; selected: boolean; today: string; month: string; statements: { card: CardOverview; statement: CardStatement | null }[]; bars: Bar[]; nav: MonthNavLinks }) {
  const list = statements.flatMap((x) => (x.statement ? [x.statement] : []));
  const total = list.reduce((sum, st) => sum + st.totalCents, 0);
  const kinds = new Set(list.map((st) => st.status));
  const due = list.map((st) => st.dueDate).sort()[0];
  const status =
    kinds.has("future") && kinds.size === 1
      ? "Prevista: só parcelas já conhecidas. Compras novas entram quando a fatura abrir."
      : kinds.has("open")
        ? "Aberta: novas compras ainda entram até o fechamento."
        : list.length
          ? "Fechada."
          : "Nenhuma fatura neste mês.";
  return (
    <div className="flex flex-col gap-5 lg:gap-6">
      <MonthNav label="Mês da fatura" title={`Fatura de ${monthTitle(month)}`} nav={nav} prevLabel="Fatura anterior" nextLabel="Próxima fatura" />
      <Card className="card-glow grid gap-6 lg:grid-cols-[minmax(0,22rem)_minmax(0,1fr)] lg:items-end lg:gap-10">
        <Headline label={`Fatura de ${monthTitle(month)}`} value={<Sensitive>{formatBRL(Math.max(0, total))}</Sensitive>}>
          {status}
          {due ? ` Vencimento: ${formatDayMonth(due, today)}.` : ""}
          {list.length > 1 ? ` Soma ${plural(list.length, "fatura", "faturas")}.` : ""}
        </Headline>
        <MonthBars items={toBars(bars, month, today)} title={`Total por mês de vencimento, em reais, ${selected ? cards[0]!.name : "todos os cartões"}`} legend={{ solid: "Fatura fechada", hatched: "Aberta ou prevista" }} />
      </Card>
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {statements.map(({ card: c, statement }) => (
          <Card key={c.id} className={selected || cards.length === 1 ? "lg:col-span-2" : undefined}>
            <CardIdentity card={c} />
            {c.calibrating ? (
              <div className="mt-3">
                <Notice tone="info" title="Calibrando…">
                  O Cruzado está lendo as faturas do banco para aprender quando este cartão fecha. Você não precisa fazer nada: isso se resolve sozinho na próxima atualização.
                </Notice>
              </div>
            ) : c.info && c.closingDayEstimated ? (
              <div className="mt-3">
                <Notice tone="attention" title={`Fechamento estimado: dia ${c.info.closingDay}`}>
                  O banco não enviou nenhuma fatura deste cartão, então não dá para aprender quando ele fecha. Veja na fatura do banco o dia de fechamento (não o melhor dia de compra) e{" "}
                  <Link href={EDIT} className="font-medium underline underline-offset-2">informe em Configurações</Link>.
                </Notice>
              </div>
            ) : null}
            <div className="mt-4 border-t border-border pt-4">
              {!c.info ? (c.calibrating ? null : <NoCycle />) : statement ? <ul><StatementRow s={statement} today={today} /></ul> : <p className="text-sm text-muted">Sem fatura com vencimento em {monthTitle(month)}.</p>}
            </div>
          </Card>
        ))}
      </div>
      <p className="max-w-prose text-sm text-muted">
        Faturas fechadas mostram o valor informado pelo banco quando ele compartilha a fatura. Sem isso, e na fatura aberta, o valor é a soma do que foi lançado no período; juros, tarifas e saldo de meses anteriores só aparecem no valor do banco. Faturas futuras somam só parcelas já conhecidas.{" "}
        <Link href="/cartoes/conciliacao" className="font-medium underline underline-offset-2">Conciliação de cartões</Link>: o que foi corrigido para as faturas baterem com o banco.
      </p>
    </div>
  );
}

function PlanRow({ plan, cardName, today }: { plan: InstallmentPlan; cardName?: string; today: string }) {
  const label = sanitizeUntrusted(plan.label, 60);
  return (
    <li className="rounded-2xl border border-border bg-surface p-5 shadow-card">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="break-words text-[0.9375rem] font-semibold leading-snug">{label}</h3>
          <p className="text-sm text-muted">{plan.current} de {plan.total}{cardName ? ` no ${cardName}` : ""}</p>
        </div>
        <p className="shrink-0 font-semibold tabular-nums"><Sensitive>{formatBRL(plan.installmentCents)}</Sensitive><span className="sr-only"> por parcela</span></p>
      </div>
      <div role="progressbar" aria-label={`${label}: parcelas já lançadas`} aria-valuemin={0} aria-valuemax={plan.total} aria-valuenow={plan.current} className="mt-3 h-2 rounded-full bg-surface-3">
        <div className="h-2 rounded-full bg-primary" style={{ width: `${Math.round((plan.current * 100) / plan.total)}%` }} />
      </div>
      <dl className="mt-2 flex flex-wrap justify-between gap-x-4 text-sm">
        <div className="flex gap-1"><dt className="text-muted">Já lançado:</dt><dd className="tabular-nums"><Sensitive>{formatBRL(plan.chargedCents)}</Sensitive></dd></div>
        <div className="flex gap-1"><dt className="text-muted">Falta:</dt><dd className="tabular-nums"><Sensitive>{formatBRL(plan.remainingCents)}</Sensitive></dd></div>
      </dl>
      <p className="mt-2 border-t border-border pt-2 text-sm text-muted">
        {plural(plan.remaining, "parcela restante", "parcelas restantes")}. Próxima em {formatDayMonth(plan.nextDate, today)}, última em {formatMonthYear(plan.lastDate)}.
      </p>
      {plan.estimated ? <p className="mt-1 text-sm text-muted">Sem lançamentos recentes: a posição foi estimada pela data da compra.</p> : null}
      <Link href={txHref({ contas: [plan.accountId], q: plan.label, de: plan.firstDate, ate: today })} aria-label={`Ver parcelas lançadas de ${label}`} className={link}>Ver parcelas lançadas</Link>
    </li>
  );
}

function MonthTable({ data, month, cardName, today }: { data: { items: MonthInstallment[] }; month: string; cardName?: (id: string) => string | undefined; today: string }) {
  if (!data.items.length) return <EmptyState title={`Nenhuma parcela em ${monthTitle(month)}`}>Use as setas para ver outros meses.</EmptyState>;
  return (
    <div className="overflow-hidden rounded-2xl border border-border bg-surface shadow-card">
      <table className="w-full text-left text-sm">
        <caption className="sr-only">Parcelas de {monthTitle(month)}</caption>
        <thead className="border-b border-border bg-surface-2 text-meta text-muted">
          <tr>
            <th scope="col" className="px-4 py-2.5 font-medium sm:px-5">Compra</th>
            <th scope="col" className="hidden px-3 py-2.5 font-medium sm:table-cell">Data</th>
            <th scope="col" className="px-3 py-2.5 font-medium">Situação</th>
            <th scope="col" className="px-4 py-2.5 text-right font-medium sm:px-5">Valor</th>
          </tr>
        </thead>
        <tbody>
          {data.items.map((i) => {
            const label = sanitizeUntrusted(i.label, 60);
            const card = cardName?.(i.accountId);
            return (
              <tr key={i.key} className="border-t border-border/70 first:border-0">
                <td className="px-4 py-3 sm:px-5">
                  {i.projected ? <span className="font-medium">{label}</span> : <Link href={`/transacoes/${i.key}`} className="font-medium underline-offset-4 hover:underline">{label}</Link>}
                  <span className="block text-meta text-muted">
                    {i.number} de {i.total}
                    {card ? ` · ${card}` : ""}
                    <span className="sm:hidden"> · {formatDayMonth(i.date, today)}</span>
                  </span>
                </td>
                <td className="hidden px-3 py-3 text-muted sm:table-cell">{formatDayMonth(i.date, today)}</td>
                <td className="px-3 py-3">{i.projected ? <Badge tone="info">Prevista</Badge> : <Badge>Cobrada</Badge>}</td>
                <td className="px-4 py-3 text-right font-semibold tabular-nums sm:px-5"><Sensitive>{formatBRL(i.cents)}</Sensitive></td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export function InstallmentsPanel({ cards, selected, today, month, data, bars, nav, any }: { cards: CardOverview[]; selected: boolean; today: string; month: string; data: { items: MonthInstallment[]; cents: number; count: number }; bars: Bar[]; nav: MonthNavLinks; any: boolean }) {
  const plans = cards.flatMap((c) => c.plans.map((p) => ({ plan: p, cardName: selected ? undefined : c.name }))).sort((a, b) => a.plan.nextDate.localeCompare(b.plan.nextDate));
  if (!plans.length && !any) {
    return (
      <EmptyState title="Nenhuma compra parcelada ainda">
        Parcelas aparecem quando o banco informa ou quando a descrição traz algo como 3/10.
      </EmptyState>
    );
  }
  const thisMonth = today.slice(0, 7);
  const remainingCents = sumCents(plans.map((p) => p.plan.remainingCents));
  const remaining = sumCents(plans.map((p) => p.plan.remaining));
  const lastDate = plans.map((p) => p.plan.lastDate).sort().at(-1);
  const names = new Map(cards.map((c) => [c.id, c.name]));
  const when = month < thisMonth ? "Cobradas neste mês." : month === thisMonth ? "Cobradas e previstas para este mês." : "Previstas pelas compras em andamento. Compras novas podem somar.";
  return (
    <div className="flex flex-col gap-5 lg:gap-6">
      <MonthNav label="Mês das parcelas" title={monthTitle(month)} nav={nav} prevLabel="Mês anterior" nextLabel="Próximo mês" />
      <Card className="card-glow grid gap-6 lg:grid-cols-[minmax(0,22rem)_minmax(0,1fr)] lg:items-end lg:gap-10">
        <Headline label={`Parcelas de ${monthTitle(month)}`} value={<Sensitive>{formatBRL(data.cents)}</Sensitive>}>
          {when} {plural(data.count, "parcela", "parcelas")}.
          {lastDate ? (
            <>
              {" "}Ao todo, faltam <Sensitive>{formatBRL(remainingCents)}</Sensitive> em {plural(remaining, "parcela", "parcelas")}, até {formatMonthYear(lastDate)}.
            </>
          ) : null}
        </Headline>
        <MonthBars title={`Parcelas por mês, em reais, ${selected ? cards[0]!.name : "todos os cartões"}`} items={toBars(bars, month, today)} legend={{ solid: "Cobradas", hatched: "Com parcelas previstas" }} />
      </Card>
      <section aria-labelledby="h-mes-parcelas" className="flex flex-col gap-3">
        <h2 id="h-mes-parcelas" className="text-lg font-semibold tracking-tight first-letter:uppercase">Parcelas de {monthTitle(month)}</h2>
        <MonthTable data={data} month={month} today={today} cardName={selected ? undefined : (id) => names.get(id)} />
      </section>
      {plans.length ? (
        <section aria-labelledby="h-andamento" className="flex flex-col gap-3">
          <h2 id="h-andamento" className="text-lg font-semibold tracking-tight">Compras em andamento</h2>
          <ul className="grid grid-cols-1 gap-4 lg:grid-cols-2 2xl:grid-cols-3">{plans.map(({ plan, cardName }) => <PlanRow key={plan.key} plan={plan} cardName={cardName} today={today} />)}</ul>
        </section>
      ) : null}
      <p className="max-w-prose text-sm text-muted">Parcelas previstas repetem a última parcela lançada. A data é a do lançamento previsto, que pode cair em outra fatura.</p>
    </div>
  );
}

function Meter({ label, used, limit }: { label: string; used: number; limit: number }) {
  const pct = Math.round((used * 100) / limit);
  return (
    <PrivateBlock>
      <div className="mt-3">
        <div role="meter" aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.min(100, pct)} className="h-3 overflow-hidden rounded-full bg-surface-3">
          <div className={cx("h-3 rounded-full", pct > 100 ? "bg-risk" : "bg-primary")} style={{ width: `${Math.min(100, Math.max(1, pct))}%` }} />
        </div>
        <p className="mt-1 text-sm text-muted">{pct.toLocaleString("pt-BR")}% do limite usado</p>
      </div>
    </PrivateBlock>
  );
}

export function LimitsPanel({ cards, sources }: { cards: CardOverview[]; sources: Map<string, string> }) {
  const known = cards.filter((c) => c.limitCents > 0);
  const used = sumCents(known.map((c) => c.openCents));
  const limit = sumCents(known.map((c) => c.limitCents));
  return (
    <div className="flex flex-col gap-5 lg:gap-6">
      {known.length ? (
        <Card className="card-glow lg:max-w-3xl">
          <Headline label="Limite usado" value={<Sensitive>{formatBRL(used)}</Sensitive>}>
            De <Sensitive>{formatBRL(limit)}</Sensitive> de limite{known.length < cards.length ? `. Soma só ${plural(known.length, "cartão com limite informado", "cartões com limite informado")}.` : "."}
          </Headline>
          <Meter label="Limite usado no total" used={used} limit={limit} />
        </Card>
      ) : (
        <>
          <h2 className="sr-only">Limites</h2>
          <EmptyState title="Limite ainda não informado" action={<Link href={EDIT} className={link}>Informar limite</Link>}>
            Com o limite cadastrado, mostramos quanto dele já foi usado.
          </EmptyState>
        </>
      )}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {cards.map((c) => (
          <Card key={c.id}>
            <CardIdentity card={c}>{c.limitCents > 0 && c.openCents > c.limitCents ? <Badge tone="risk">Acima do limite</Badge> : null}</CardIdentity>
            {c.limitCents > 0 && known.length > 1 ? <Meter label={`Limite usado em ${c.name}`} used={c.openCents} limit={c.limitCents} /> : null}
            <dl className="mt-4 grid grid-cols-1 gap-x-4 gap-y-3 border-t border-border pt-4 text-sm min-[22rem]:grid-cols-2">
              <div><dt className="text-muted">Usado</dt><dd className="text-base font-semibold tabular-nums"><Sensitive>{formatBRL(c.openCents)}</Sensitive></dd></div>
              <div><dt className="text-muted">Limite</dt><dd className="text-base font-semibold tabular-nums">{c.limitCents > 0 ? <Sensitive>{formatBRL(c.limitCents)}</Sensitive> : "Não informado"}</dd></div>
              {c.limitCents > 0 ? <div><dt className="text-muted">{c.leftFromBank ? "Disponível (banco)" : "Sobra estimada"}</dt><dd className="text-base font-semibold tabular-nums"><Sensitive>{formatBRL(c.leftCents)}</Sensitive></dd></div> : null}
              {c.futureInstallmentsCents > 0 ? <div><dt className="text-muted">Parcelas ainda por vir</dt><dd className="text-base font-semibold tabular-nums"><Sensitive>{formatBRL(c.futureInstallmentsCents)}</Sensitive></dd></div> : null}
            </dl>
            <p className="mt-2 text-meta text-muted">{sources.get(c.id)}</p>
            <div className="flex flex-wrap gap-x-4">
              <Link href={txHref({ contas: [c.id], fluxo: true })} aria-label={`Ver compras de ${c.name}`} className={link}>Ver compras</Link>
              {c.limitCents > 0 ? null : <Link href={EDIT} aria-label={`Informar limite de ${c.name}`} className={link}>Informar limite</Link>}
            </div>
          </Card>
        ))}
      </div>
      <p className="max-w-prose text-sm text-muted">
        Disponível (banco) é o limite livre informado pelo banco. Quando ele não informa, mostramos a sobra estimada: o limite menos o que foi lançado, sem as reservas que o banco pode fazer para parcelas futuras e compras em processamento.
      </p>
    </div>
  );
}
