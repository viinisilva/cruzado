import type { Metadata } from "next";
import Link from "next/link";
import { and, count, eq } from "drizzle-orm";
import { getDb } from "@/db/client";
import * as s from "@/db/schema";
import { requireUser } from "@/lib/auth/session";
import { CARD_TABS, cardHref, parseCardMonth, parseCardTab } from "@/lib/card-query";
import { canAddAccountsManually } from "@/lib/connectors/pluggy";
import { loadAccounts, loadCards, loadCategories, loadTransactions } from "@/lib/data/repo";
import { addMonths, todayInSaoPaulo } from "@/lib/dates";
import { accountBalances } from "@/lib/finance/core";
import { cardOverviews, installmentsInMonth, statementForMonth, type CardOverview } from "@/lib/finance/cards";
import { plural } from "@/lib/text";
import { ButtonLink, ChipLink, EmptyState, Notice, PageHeader, cx } from "@/components/ui";
import { InstallmentsPanel, LimitsPanel, StatementsPanel } from "./panels";
import { CardSelect } from "./picker";

export const metadata: Metadata = { title: "Cartões" };

const CHIP_LIMIT = 4;

/** Two cards can share a name; only then the institution joins it. */
const labels = (cards: CardOverview[]) => cards.map((c) => ({ id: c.id, label: cards.filter((o) => o.name === c.name).length > 1 ? `${c.name} (${c.institution})` : c.name }));

export default async function CardsPage({ searchParams }: { searchParams: Promise<{ cartao?: string | string[]; aba?: string | string[]; mes?: string | string[] }> }) {
  const user = await requireUser();
  const sp = await searchParams;
  const db = await getDb();
  const today = todayInSaoPaulo();
  const [accounts, categories, txs, cards, links, [proposals]] = await Promise.all([
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
    db.select({ n: count() }).from(s.reconciliationChanges).where(and(eq(s.reconciliationChanges.userId, user.id), eq(s.reconciliationChanges.status, "proposed"))),
  ]);
  // A card from a bank whose first sync has not finished has no cycle yet: it is being calibrated, nothing to ask.
  const overviews = cardOverviews(accountBalances(accounts, txs, today), cards, txs, categories, today).map((o) =>
    !o.info && links.some((l) => l.account === o.id && l.status !== "disconnected") ? { ...o, calibrating: true } : o,
  );

  if (!overviews.length) {
    return (
      <>
        <PageHeader title="Cartões" />
        {canAddAccountsManually(user) ? (
          <EmptyState title="Nenhum cartão ainda" action={<ButtonLink href="/configuracoes?aba=contas">Cadastrar cartão</ButtonLink>}>
            Cadastre um cartão com fechamento, vencimento e limite. Depois importe a fatura ou conecte o banco para ver as compras aqui.
          </EmptyState>
        ) : (
          <EmptyState title="Nenhum cartão ainda" action={<ButtonLink href="/configuracoes?aba=integracoes#bancos">Conectar banco</ButtonLink>}>
            Conecte o banco do seu cartão para ver faturas, parcelas e limite aqui.
          </EmptyState>
        )}
      </>
    );
  }

  const aba = parseCardTab(sp.aba);
  const wanted = Array.isArray(sp.cartao) ? sp.cartao[0] : sp.cartao;
  // Only this user's cards are in the list; a tampered URL behaves like no filter.
  const selected = overviews.find((c) => c.id === wanted) ?? null;
  const shown = selected ? [selected] : overviews;
  const names = labels(overviews);
  const live = shown.map((c) => links.find((l) => l.account === c.id)).filter((l) => l && l.status !== "disconnected");
  const stale = live.some((l) => l?.status === "error" || l?.status === "reauth_required");
  const sources = new Map(overviews.map((c) => {
    const bank = links.find((l) => l.account === c.id && l.status !== "disconnected");
    const synced = bank?.syncedAt ? `Limite e uso informados pelo banco em ${bank.syncedAt.toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" })}.` : "Banco conectado, sem atualização concluída.";
    return [c.id, bank ? synced : user.isDemo ? "Limite de demonstração. Uso calculado pelas compras lançadas." : "Limite cadastrado por você. Uso calculado pelas compras lançadas."];
  }));

  // The month travels with the chosen card; switching tabs starts over, since Faturas counts by due month and Parcelas
  // by the month an installment is charged.
  const thisMonth = today.slice(0, 7);
  const mes = parseCardMonth(sp.mes);
  const monthsAround = (center: string, back: number, ahead: number) => Array.from({ length: back + ahead + 1 }, (_, i) => addMonths(`${center}-01`, i - back).slice(0, 7));
  const href = (m: string) => cardHref({ cartao: selected?.id, aba, mes: m });
  const shownIds = shown.map((c) => c.id);

  const defaultDue = shown.flatMap((c) => (c.next ? [c.next.dueDate.slice(0, 7)] : [])).sort()[0] ?? thisMonth;
  const dueMonth = aba === "faturas" ? (mes ?? defaultDue) : defaultDue;
  const statementsIn = (m: string) => shown.map((c) => ({ card: c, statement: c.info ? statementForMonth(c.info, txs, categories, today, m) : null }));
  const statementBars = aba === "faturas"
    ? monthsAround(defaultDue, 5, 3).map((m) => {
        const list = statementsIn(m).flatMap((x) => (x.statement ? [x.statement] : []));
        return { month: m, cents: Math.max(0, list.reduce((sum, st) => sum + st.totalCents, 0)), pending: list.some((st) => st.status !== "closed"), href: href(m) };
      })
    : [];

  const parcelMonth = aba === "parcelas" ? (mes ?? thisMonth) : thisMonth;
  const parcelBars = aba === "parcelas"
    ? monthsAround(thisMonth, 5, 6).map((m) => {
        const d = installmentsInMonth(txs, today, m, shownIds);
        return { month: m, cents: d.cents, pending: d.items.some((i) => i.projected), href: href(m) };
      })
    : [];
  const anyInstallment = txs.some((t) => t.installmentNumber && t.installmentTotal && shownIds.includes(t.accountId));
  const step = (m: string, n: number) => addMonths(`${m}-01`, n).slice(0, 7);
  const navFor = (m: string) => ({ prev: m > step(thisMonth, -36) ? href(step(m, -1)) : null, next: m < step(thisMonth, 24) ? href(step(m, 1)) : null });

  return (
    <>
      <PageHeader
        title="Cartões"
        description="Faturas, parcelas e limite de cada cartão."
        action={<ButtonLink href="/contas" variant="secondary">Contas e cartões</ButtonLink>}
      />
      {proposals && proposals.n > 0 ? (
        <div className="mb-4">
          <Notice tone="attention" title={`${plural(proposals.n, "mudança proposta", "mudanças propostas")} para as faturas baterem com o banco`}>
            O Cruzado revisou os lançamentos antigos dos seus cartões e não mudou nada sozinho.{" "}
            <Link href="/cartoes/conciliacao" className="font-medium underline underline-offset-2">Ver o relatório</Link>.
          </Notice>
        </div>
      ) : null}

      {overviews.length > CHIP_LIMIT ? (
        <CardSelect value={selected?.id ?? ""} options={names} aba={aba} mes={mes} />
      ) : (
        <nav aria-label="Escolher cartão" className="flex flex-wrap gap-2">
          <ChipLink href={cardHref({ aba, mes })} active={!selected}>Todos os cartões</ChipLink>
          {names.map((n) => (
            <ChipLink key={n.id} href={cardHref({ cartao: n.id, aba, mes })} active={n.id === selected?.id}><span className="truncate">{n.label}</span></ChipLink>
          ))}
        </nav>
      )}
      <p aria-live="polite" className="mt-3 text-sm text-muted">
        {selected ? <>Mostrando só {names.find((n) => n.id === selected.id)?.label}. <Link href={cardHref({ aba, mes })} className="font-medium text-primary underline underline-offset-2">Ver todos os cartões</Link></> : `Mostrando ${plural(overviews.length, "cartão", "cartões")}.`}
      </p>

      <nav aria-label="Detalhes dos cartões" className="mb-6 mt-4 border-b border-border">
        <ul className="grid grid-cols-3 sm:flex sm:gap-8">
          {CARD_TABS.map((t) => (
            <li key={t.id}>
              <Link
                href={cardHref({ cartao: selected?.id, aba: t.id })}
                scroll={false}
                aria-current={t.id === aba ? "page" : undefined}
                className={cx("-mb-px flex min-h-12 items-center justify-center border-b-[3px] text-[0.9375rem] transition-colors sm:px-1", t.id === aba ? "border-primary font-semibold text-primary" : "border-transparent font-medium text-muted hover:border-border-strong hover:text-text")}
              >
                {t.label}
              </Link>
            </li>
          ))}
        </ul>
      </nav>

      {stale ? (
        <div className="mb-4">
          <Notice tone="attention" title="Dados do banco podem estar desatualizados">
            <Link className="font-medium underline" href="/transacoes/revisar">Ver o que houve</Link>
          </Notice>
        </div>
      ) : null}

      {aba === "faturas" ? <StatementsPanel cards={shown} selected={Boolean(selected)} today={today} month={dueMonth} statements={statementsIn(dueMonth)} bars={statementBars} nav={navFor(dueMonth)} /> : null}
      {aba === "parcelas" ? (
        <InstallmentsPanel cards={shown} selected={Boolean(selected)} today={today} month={parcelMonth} data={installmentsInMonth(txs, today, parcelMonth, shownIds)} bars={parcelBars} nav={navFor(parcelMonth)} any={anyInstallment} />
      ) : null}
      {aba === "limites" ? <LimitsPanel cards={shown} sources={sources} /> : null}
    </>
  );
}
