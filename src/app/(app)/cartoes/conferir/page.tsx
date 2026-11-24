import type { Metadata } from "next";
import type { ReactNode } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getDb } from "@/db/client";
import { requireUser } from "@/lib/auth/session";
import { cardHref, parseCardMonth } from "@/lib/card-query";
import { loadAccounts, loadCards, loadCategories, loadTransactions } from "@/lib/data/repo";
import { formatDateBR, formatDayMonth, formatMonthYear, todayInSaoPaulo } from "@/lib/dates";
import { checkStatement, type CheckFlag, type CheckRow, type ExcludedReason, type IncludedReason } from "@/lib/finance/card-check";
import { cardStatements, closingText, installmentLabel, nextStatement, PROJECTION_MATCH_CENTS } from "@/lib/finance/cards";
import type { Confidence, DivergenceReason } from "@/lib/finance/cycles";
import { formatBRL } from "@/lib/money";
import { plural } from "@/lib/text";
import { Badge, Button, ButtonLink, Card, EmptyState, Notice, PageHeader } from "@/components/ui";
import { applySuggestionAction, dismissProjectionAction, restoreProjectionsAction } from "@/app/actions/reconciliation";
import type { CreditKind } from "@/lib/finance/classify";
import type { CandidateChange, SolverResult } from "@/lib/finance/solver";
import { Sensitive } from "@/components/client";

export const metadata: Metadata = { title: "Conferir fatura" };

const link = "font-medium text-primary underline underline-offset-2";
const short = (ymd: string) => formatDateBR(ymd).slice(0, 5);

const REASON: Record<IncludedReason | ExcludedReason, string> = {
  bill: "O banco ligou este lançamento a esta fatura.",
  date: "Entrou pela data, dentro do período da fatura.",
  transfer: "Fora: está numa categoria de pagamento de fatura ou transferência.",
  "other-bill": "Fora: o banco ligou este lançamento a outra fatura.",
  "not-charged": "Não cobrado pelo banco: estava pendente e o banco fechou esta fatura sem ele. Continua guardado, só não soma.",
  late: "Fora: pendente nos últimos dias antes do fechamento, e o banco fechou esta fatura sem ele. Conta na fatura seguinte.",
  carried: "Veio da fatura anterior: estava pendente perto do fechamento e o banco não o cobrou lá.",
  "purchase-date": "Parcela que o banco manda com a data da compra: entra nesta fatura pela numeração.",
  projected: "O banco mandou a parcela anterior desta compra, mas não esta. Ela entra na soma com o valor da parcela recebida e some sozinha quando o banco a enviar.",
};
const FLAG: Record<CheckFlag, { label: string; tone: "attention" | "info" | "risk" }> = {
  pending: { label: "Pendente no banco", tone: "info" },
  "outside-dates": { label: "Data fora do período", tone: "info" },
  "looks-like-payment": { label: "Parece pagamento", tone: "risk" },
  "may-move": { label: "Pode cair na próxima fatura", tone: "attention" },
  scheduled: { label: "Parcela com data futura", tone: "info" },
};

const DIVERGENCE: Record<DivergenceReason, (amount: ReactNode) => ReactNode> = {
  "bank-zero": (a) => <>O banco informou R$ 0,00, mas os lançamentos somam {a}. Costuma acontecer quando a fatura foi paga antes do fechamento e o banco já desconta o pagamento do total, ou quando o banco mandou a fatura incompleta. Confira o valor no app do banco.</>,
  "closing-edge": (a) => <>Um lançamento de {a} na virada do fechamento caiu numa fatura diferente da do banco.</>,
  "pending-not-charged": (a) => <>{a} em lançamentos pendentes que o banco não cobrou nesta fatura.</>,
  "credit-as-payment": (a) => <>Um crédito de {a} (cashback, por exemplo) está sendo tratado como pagamento, mas o banco o descontou da fatura.</>,
  "payment-as-refund": (a) => <>{a} em pagamentos estão sendo descontados como estorno.</>,
  "missing-entries": (a) => <>O banco cobrou {a} a mais do que os lançamentos compartilhados: juros, IOF, tarifas, saldo anterior ou lançamentos que o banco não enviou por Open Finance.</>,
  "extra-entries": (a) => <>Há {a} em lançamentos que o banco não cobrou nesta fatura: compras canceladas, pendentes que não viraram cobrança ou lançamentos que o banco pôs em outra fatura.</>,
};

const CONFIDENCE: Record<Confidence, string> = {
  high: "Aprendido com as faturas do banco.",
  medium: "Aprendido com uma fatura do banco; fica mais seguro a cada fatura nova.",
  low: "As faturas do banco discordam entre si; vale o que aconteceu na maioria.",
  none: "Ainda sem evidência nas faturas do banco: vale a regra mais comum.",
};

const KIND: Record<CreditKind, string> = { payment: "Pagamento de fatura", refund: "Estorno", credit: "Crédito que abate a fatura", unknown: "Crédito sem classe definida" };
const CHANGE: Record<CandidateChange, string> = {
  "to-payment": "tratar como pagamento de fatura (sai da soma)",
  "to-refund": "tratar como estorno (abate a fatura)",
  include: "contar nesta fatura",
  exclude: "tirar desta fatura",
};

/** What the reconciler found: a unique answer, several, or none. Credit changes can be applied here; the rest is information. */
function SolverNotice({ solver, rows }: { solver: SolverResult; rows: CheckRow[] }) {
  if (solver.outcome === "matched") return null;
  if (solver.outcome === "unsolved") {
    return (
      <Notice tone="attention" title={`Não bate por ${formatBRL(Math.abs(solver.gapCents))}`}>
        Nenhuma combinação de até 3 mudanças fecha a diferença ao centavo. O motivo provável está acima.
      </Notice>
    );
  }
  const combos = solver.outcome === "solved" ? [solver.combo] : solver.combos;
  const byId = new Map(rows.map((r) => [r.id, r]));
  return (
    <Notice tone="attention" title={solver.outcome === "solved" ? "Uma mudança fecha a fatura ao centavo" : `${combos.length} combinações fecham a fatura`}>
      {solver.outcome === "ambiguous" ? <p>Como há mais de uma, nada foi mudado. Confira no app do banco qual é a certa.</p> : null}
      {solver.outcome === "solved" && !solver.auto ? <p>Ela fecha só pela conta, sem outra evidência, então nada foi mudado sozinho.</p> : null}
      <ol className="mt-2 grid gap-2">
        {combos.map((combo, i) => (
          <li key={i} className="grid gap-1">
            {combo.map((c) => {
              const r = byId.get(c.txId);
              return (
                <div key={c.txId} className="flex flex-wrap items-center gap-2">
                  <span>
                    {r ? <Link href={`/transacoes/${c.txId}`} className={link}>{r.description}</Link> : "Lançamento"}{" "}
                    (<Sensitive>{formatBRL(Math.abs(r?.amountCents ?? c.effect))}</Sensitive>): {CHANGE[c.change]}
                  </span>
                  {c.change === "to-payment" || c.change === "to-refund" ? (
                    <form action={applySuggestionAction}>
                      <input type="hidden" name="tx" value={c.txId} />
                      <input type="hidden" name="change" value={c.change} />
                      <Button type="submit" size="sm" variant="secondary">Aplicar</Button>
                    </form>
                  ) : null}
                </div>
              );
            })}
          </li>
        ))}
      </ol>
    </Notice>
  );
}

/** Reasons that are simply how a bill works: not repeated on every row. */
const USUAL = new Set<IncludedReason | ExcludedReason>(["date", "bill"]);

function Rows({ rows, reason, empty, open, accountId }: { rows: (CheckRow & { reason?: IncludedReason | ExcludedReason })[]; reason: boolean; empty: string; open?: boolean; accountId?: string }) {
  if (!rows.length) return <p className="text-sm text-muted">{empty}</p>;
  return (
    <ul className="divide-y divide-border">
      {rows.map((r) => (
        <li key={r.id} className="py-3 first:pt-0 last:pb-0">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              {r.projected ? (
                // Not a bank entry: there is no page to open, only the label and the way to exclude it.
                <p className="break-words text-[0.9375rem] font-medium">
                  {r.installment ? installmentLabel(r.description) : r.description}
                  {r.installment ? <span className="text-muted"> · parcela {r.installment}</span> : null}
                </p>
              ) : (
                <Link href={`/transacoes/${r.id}`} className="break-words text-[0.9375rem] font-medium hover:underline">
                  {r.installment ? installmentLabel(r.description) : r.description}
                  {r.installment ? <span className="text-muted"> · parcela {r.installment}</span> : null}
                </Link>
              )}
              <p className="text-sm text-muted">{formatDateBR(r.date)} · {r.categoryName}</p>
            </div>
            <p className="shrink-0 text-[0.9375rem] font-semibold tabular-nums">
              <Sensitive>{r.amountCents > 0 ? `− ${formatBRL(r.amountCents)}` : formatBRL(-r.amountCents)}</Sensitive>
            </p>
          </div>
          {r.projected ? (
            <div className="mt-1.5 flex flex-wrap items-center gap-2">
              <Badge tone="attention">Parcela prevista — o banco não enviou</Badge>
              {accountId && r.projectionKey ? (
                <form action={dismissProjectionAction}>
                  <input type="hidden" name="account" value={accountId} />
                  <input type="hidden" name="key" value={r.projectionKey} />
                  <Button type="submit" size="sm" variant="secondary">Excluir prevista</Button>
                </form>
              ) : null}
            </div>
          ) : null}
          {reason && r.reason && !USUAL.has(r.reason) ? <p className="mt-1 text-sm text-muted">{REASON[r.reason]}</p> : null}
          {r.decision ? (
            <p className="mt-1 text-sm text-muted">
              <strong className="font-semibold text-text">{KIND[r.decision.kind]}</strong>: {r.decision.why}
              {r.decision.matched ? <> (<Link href={`/transacoes/${r.decision.matched.id}`} className={link}>{r.decision.matched.description}, {short(r.decision.matched.date)}</Link>)</> : null}.
              {r.chosenByUser ? " A categoria foi escolhida por você e não muda sozinha." : ""}
            </p>
          ) : null}
          {/* In an open bill almost everything is still pending at the bank: that is the rule, not news. */}
          {r.flags.filter((f) => !(open && f === "pending")).length ? (
            <div className="mt-1.5 flex flex-wrap gap-1.5">
              {r.flags.filter((f) => !(open && f === "pending")).map((f) => <Badge key={f} tone={FLAG[f].tone}>{FLAG[f].label}</Badge>)}
            </div>
          ) : null}
        </li>
      ))}
    </ul>
  );
}

export default async function CheckStatementPage({ searchParams }: { searchParams: Promise<{ cartao?: string | string[]; mes?: string | string[] }> }) {
  const user = await requireUser();
  const sp = await searchParams;
  const wanted = Array.isArray(sp.cartao) ? sp.cartao[0] : sp.cartao;
  const db = await getDb();
  const today = todayInSaoPaulo();
  const [accounts, categories, txs, cards] = await Promise.all([loadAccounts(db, user.id), loadCategories(db, user.id), loadTransactions(db, user.id, { includeFuture: true, today }), loadCards(db, user.id)]);
  // Only this user's cards are looked up: an id from another account is simply not found.
  const account = accounts.find((a) => a.id === wanted && a.type === "credit_card");
  if (!account) notFound();
  const card = cards.find((c) => c.accountId === account.id);
  const back = cardHref({ cartao: account.id, mes: parseCardMonth(sp.mes) });
  const header = <PageHeader title="Conferir fatura" description={`${account.name} · ${account.institution}`} action={<ButtonLink href={back} variant="secondary">Voltar para Cartões</ButtonLink>} />;
  if (!card) {
    return (
      <>
        {header}
        <EmptyState title="Faltam os dias de fechamento e vencimento" action={<ButtonLink href="/configuracoes?aba=contas">Informar os dias</ButtonLink>}>
          Sem eles não dá para separar as compras por fatura.
        </EmptyState>
      </>
    );
  }
  const month = parseCardMonth(sp.mes) ?? nextStatement(cardStatements(card, txs, categories, today), today)?.dueDate.slice(0, 7) ?? today.slice(0, 7);
  const check = checkStatement(card, txs, categories, today, month);
  if (!check) {
    return (
      <>
        {header}
        <EmptyState title="Nada para conferir neste mês">Esta fatura ainda não abriu. Só existem as parcelas previstas, que aparecem em Cartões › Parcelas.</EmptyState>
      </>
    );
  }
  const st = check.statement;
  // Paid early, the bank shows the balance left: the bill's value is the sum of its entries, and nothing diverges.
  const gap = st.paidEarly ? 0 : st.bankTotalCents !== null ? st.bankTotalCents - st.computedCents : null;
  const monthName = formatMonthYear(`${month}-01`);
  const money = (c: number) => <Sensitive>{formatBRL(c)}</Sensitive>;
  const summary =
    st.status === "open" ? (
      <>Até agora, a fatura de {monthName} soma <strong>{money(st.computedCents)}</strong>. Ela ainda está aberta: {st.closingSource === "fixed" ? `fecha no dia ${check.closingDay}` : `fecha ${closingText(st)}`} e vence em {formatDayMonth(st.dueDate, today)}. O total pode mudar até o fechamento.</>
    ) : st.bankTotalCents === null ? (
      <>A fatura de {monthName} fechou em <strong>{money(st.computedCents)}</strong>, pela soma dos lançamentos. O banco não informou o total desta fatura.</>
    ) : st.paidEarly ? (
      <>A fatura de {monthName} fechou em <strong>{money(st.computedCents)}</strong> e foi paga antecipadamente em {short(st.paidEarly.date)}. Por isso o banco mostra só o saldo que falta pagar, <strong>{money(st.bankTotalCents)}</strong>.</>
    ) : st.projected.count > 0 && Math.abs(gap!) <= PROJECTION_MATCH_CENTS ? (
      <>A fatura de {monthName} fechou em <strong>{money(st.bankTotalCents)}</strong>, segundo o banco. A soma dá <strong>{money(st.computedCents)}</strong> contando {st.projected.count === 1 ? "uma parcela prevista" : `${st.projected.count} parcelas previstas`} ({money(st.projected.cents)}) que o banco não enviou{gap === 0 ? ", e bate com o banco." : <>. A diferença de {money(Math.abs(gap!))} é arredondamento de centavos entre as parcelas, não juros nem tarifas.</>}</>
    ) : gap === 0 ? (
      <>A fatura de {monthName} fechou em <strong>{money(st.computedCents)}</strong>, o mesmo valor que o banco informou.</>
    ) : (
      <>Os lançamentos da fatura de {monthName} somam <strong>{money(st.computedCents)}</strong>, mas o banco informou <strong>{money(st.bankTotalCents)}</strong>. A diferença é de {money(Math.abs(gap!))}, e o motivo provável está logo abaixo.</>
    );

  return (
    <>
      {header}
      <div className="grid gap-4">
        <Card aria-labelledby="resumo">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 id="resumo" className="text-lg font-semibold first-letter:uppercase">Fatura de {formatMonthYear(`${month}-01`)}</h2>
              <p className="text-sm text-muted">Compras de {short(st.cycle.from)} a {short(st.cycle.to)} · {st.dueDate < today ? "venceu" : "vence"} em {formatDayMonth(st.dueDate, today)}</p>
            </div>
            {st.status === "open" ? <Badge tone="attention">Aberta</Badge> : st.paidEarly ? <Badge tone="positive">Paga antecipadamente</Badge> : gap === 0 || (st.projected.count > 0 && Math.abs(gap!) <= PROJECTION_MATCH_CENTS) ? <Badge tone="positive">Bate com o banco</Badge> : <Badge>Fechada</Badge>}
          </div>
          <p className="mt-3 max-w-prose text-base leading-relaxed">{summary}</p>
          <dl className="mt-4 grid gap-2 text-[0.9375rem] sm:max-w-md">
            <div className="flex justify-between gap-3"><dt className="text-muted">Compras e tarifas</dt><dd className="tabular-nums"><Sensitive>{formatBRL(check.chargesCents)}</Sensitive></dd></div>
            <div className="flex justify-between gap-3"><dt className="text-muted">Créditos descontados</dt><dd className="tabular-nums"><Sensitive>− {formatBRL(check.creditsCents)}</Sensitive></dd></div>
            <div className="flex justify-between gap-3 border-t border-border pt-2 font-semibold"><dt>Soma dos lançamentos</dt><dd className="tabular-nums"><Sensitive>{formatBRL(st.computedCents)}</Sensitive></dd></div>
            {st.bankTotalCents !== null ? (
              <>
                <div className="flex justify-between gap-3 font-semibold"><dt>{st.paidEarly ? "Saldo informado pelo banco" : "Valor informado pelo banco"}</dt><dd className="tabular-nums"><Sensitive>{formatBRL(st.bankTotalCents)}</Sensitive></dd></div>
                {st.paidEarly ? (
                  <div className="flex justify-between gap-3"><dt className="text-muted">Pago antecipadamente em {short(st.paidEarly.date)}</dt><dd className="tabular-nums"><Sensitive>{formatBRL(st.paidEarly.cents)}</Sensitive></dd></div>
                ) : (
                  <div className="flex justify-between gap-3"><dt className="text-muted">Diferença</dt><dd className="tabular-nums"><Sensitive>{formatBRL(gap!)}</Sensitive></dd></div>
                )}
              </>
            ) : null}
          </dl>
          <details className="group mt-4 rounded-xl border border-border bg-surface-2 px-4 open:pb-3">
            <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-3 font-semibold [&::-webkit-details-marker]:hidden">
              Como calculamos?
              <span aria-hidden className="text-xl leading-none text-primary transition-transform group-open:rotate-45 motion-reduce:transition-none">+</span>
            </summary>
          {st.closingSource === "fixed" ? (
            <p className="text-sm text-muted">
              Fechamento no dia {check.closingDay}, vencimento no dia {check.dueDay}.{" "}
              {check.closingDaySource === "estimated" ? (
                <>O dia de fechamento é uma <strong className="font-semibold text-text">estimativa</strong>, porque o banco não enviou nenhuma fatura. <Link href="/configuracoes?aba=contas" className={link}>Informe o dia certo</Link> para as compras caírem na fatura certa.</>
              ) : check.closingDaySource === "user" ? "Dia informado por você." : check.closingDaySource === "bank" ? "Dia informado pelo banco." : null}
            </p>
          ) : (
            <div className="grid gap-1 text-sm text-muted">
              <p>
                {st.closingSource === "bank"
                  ? `Fechou ${closingText(st)}, data informada pelo banco.`
                  : `${st.status === "open" ? "Fecha" : "Deve ter fechado"} ${closingText(st)}: previsão pelo vencimento e pelo intervalo entre fechamento e vencimento das faturas anteriores.`}
              </p>
              <p>
                Compras feitas no dia do fechamento entram na fatura {check.rule === "next" ? "seguinte" : "que fecha"}. {CONFIDENCE[check.ruleConfidence]}
              </p>
            </div>
          )}
          {st.status === "open" ? (
            <p className="mt-2 text-sm text-muted">
              O banco só informa o total depois do fechamento, então uma fatura aberta é a soma dos lançamentos. Parcelas que o banco já lançou com data futura entram aqui e só contam nos gastos quando a data chegar.
            </p>
          ) : null}
          </details>
        </Card>

        {check.divergence ? (
          <Notice tone="attention" title="Motivo provável da diferença">
            {st.gapCandidate?.kind === "earlier-purchase" ? (
              <>
                Possível parcela de compra anterior que o banco não enviou:{" "}
                <Link href={`/transacoes/${st.gapCandidate.id}`} className={link}>{st.gapCandidate.description}</Link>, <Sensitive>{formatBRL(st.gapCandidate.amountCents)}</Sensitive> em {short(st.gapCandidate.date)}. Ela tem o valor que falta, e o comerciante não aparece nesta fatura. Confira no app do banco se esta fatura cobra uma parcela dessa compra.
              </>
            ) : st.gapCandidate ? (
              <>
                A diferença é exatamente {st.gapCandidate.installment ? "a parcela" : "o lançamento"}{" "}
                <Link href={`/transacoes/${st.gapCandidate.id}`} className={link}>{st.gapCandidate.description}</Link>, de {short(st.gapCandidate.date)} (<Sensitive>{formatBRL(st.gapCandidate.amountCents)}</Sensitive>), que ficou fora desta fatura. O banco provavelmente a cobrou aqui.
              </>
            ) : (
              DIVERGENCE[check.divergence.reason](<Sensitive>{formatBRL(check.divergence.amountCents)}</Sensitive>)
            )}
          </Notice>
        ) : null}
        <SolverNotice solver={check.solver} rows={[...check.included, ...check.excluded, ...check.nearby]} />

        {check.suspectPaymentsCents > 0 ? (
          <Notice tone="risk" title="Pagamento sendo descontado como estorno">
            <Sensitive>{formatBRL(check.suspectPaymentsCents)}</Sensitive> em créditos têm texto de pagamento de fatura e estão sendo descontados desta fatura. Se forem mesmo pagamentos, mude a categoria deles para &quot;Pagamento de fatura&quot;.
          </Notice>
        ) : null}

        <Card aria-labelledby="entram">
          <h2 id="entram" className="mb-3 text-lg font-semibold">Entram na fatura ({check.included.length})</h2>
          <Rows rows={check.included} reason open={st.status === "open"} accountId={account.id} empty="Nenhum lançamento nesta fatura." />
          {card.dismissedProjections?.length ? (
            <form action={restoreProjectionsAction} className="mt-3 flex flex-wrap items-center gap-2 text-sm text-muted">
              <input type="hidden" name="account" value={account.id} />
              {plural(card.dismissedProjections.length, "parcela prevista excluída", "parcelas previstas excluídas")} por você neste cartão.
              <Button type="submit" size="sm" variant="secondary">Voltar a contar</Button>
            </form>
          ) : null}
        </Card>

        {check.excluded.length ? (
          <Card aria-labelledby="fora">
            <h2 id="fora" className="mb-1 text-lg font-semibold">Ficaram de fora ({check.excluded.length})</h2>
            <p className="mb-3 text-sm text-muted">Lançamentos deste cartão, com data dentro do período, que não somam na fatura.</p>
            <Rows rows={check.excluded} reason empty="Nenhum." />
          </Card>
        ) : null}

        {check.nearby.length ? (
          <details className="group rounded-2xl border border-border bg-surface p-4 sm:px-6">
            <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-3 text-lg font-semibold [&::-webkit-details-marker]:hidden">
              <span id="perto">Perto do fechamento ({check.nearby.length})</span>
              <span aria-hidden className="text-xl leading-none text-primary transition-transform group-open:rotate-45 motion-reduce:transition-none">+</span>
            </summary>
            <p className="mb-3 text-sm text-muted">
              {plural(5, "dia", "dias")} antes e depois do período, sem fatura do banco. Se o app do banco mostra algum destes nesta fatura, o dia de fechamento está errado.
            </p>
            <Rows rows={check.nearby} reason={false} open={st.status === "open"} empty="Nenhum." />
          </details>
        ) : null}
      </div>
    </>
  );
}
