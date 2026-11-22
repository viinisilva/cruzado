import type { Metadata } from "next";
import Link from "next/link";
import { ChevronLeft, ChevronRight, PieChart } from "lucide-react";
import { getDb } from "@/db/client";
import { requireUser } from "@/lib/auth/session";
import { loadCategories, loadCategoryColors, loadTransactions } from "@/lib/data/repo";
import { spendingByCategory } from "@/lib/finance/core";
import { previousComparableRange } from "@/lib/finance/period";
import { categoryColor, categoryComparison, monthCoverage } from "@/lib/finance/views";
import { addMonths, endOfMonth, formatMonthYear, formatRangeBR, todayInSaoPaulo, type DateRange } from "@/lib/dates";
import { changeBasisPoints, formatBRL } from "@/lib/money";
import { plural } from "@/lib/text";
import { UNCATEGORIZED_FILTER, txHref } from "@/lib/tx-query";
import { ButtonLink, EmptyState, MetricCard, PageHeader } from "@/components/ui";
import { DeltaChip, PrivateBlock, Sensitive } from "@/components/client";
import { CategoryRing } from "@/components/charts";

export const metadata: Metadata = { title: "Categorias" };

const capital = (s: string) => `${s[0]!.toUpperCase()}${s.slice(1)}`;

/** `?mes=YYYY-MM`; anything invalid or in the future falls back to the current month. */
function monthRange(mes: string | undefined, today: string): DateRange {
  const current = today.slice(0, 7);
  const month = mes && /^\d{4}-(0[1-9]|1[0-2])$/.test(mes) && mes <= current ? mes : current;
  const from = `${month}-01`;
  const end = endOfMonth(from);
  return { from, to: end > today ? today : end };
}

export default async function CategoriesPage({ searchParams }: { searchParams: Promise<{ mes?: string | string[] }> }) {
  const user = await requireUser();
  const sp = await searchParams;
  const db = await getDb();
  const today = todayInSaoPaulo();
  const [categories, colors, txs] = await Promise.all([loadCategories(db, user.id), loadCategoryColors(db, user.id), loadTransactions(db, user.id)]);

  const range = monthRange(Array.isArray(sp.mes) ? sp.mes[0] : sp.mes, today);
  const whole = range.to === endOfMonth(range.from);
  // A finished month compares with the whole month before; the current one with the same days of the previous month.
  const previous = whole ? { from: addMonths(range.from, -1), to: endOfMonth(addMonths(range.from, -1)) } : previousComparableRange(range);
  const data = categoryComparison(txs, categories, range, previous);
  const previousTotal = spendingByCategory(txs, categories, previous).totalCents;
  const change = previousTotal > 0 ? changeBasisPoints(previousTotal, data.totalCents) : null;
  const month = capital(formatMonthYear(range.from));
  const prevMonth = addMonths(range.from, -1).slice(0, 7);
  const nextMonth = addMonths(range.from, 1).slice(0, 7);
  const color = (id: string) => categoryColor(colors.get(id));
  const href = (categoryId: string) => txHref({ de: range.from, ate: range.to, categoria: categoryId, tipo: categoryId === UNCATEGORIZED_FILTER ? "despesa" : undefined });

  return (
    <>
      <PageHeader
        title="Categorias"
        description="Para onde foi o dinheiro em cada mês, e o que mudou em relação ao mês anterior."
        action={
          <nav aria-label="Mês" className="flex items-center rounded-xl border border-border bg-surface shadow-card">
            <Link href={`/categorias?mes=${prevMonth}`} aria-label="Mês anterior" className="flex size-11 items-center justify-center rounded-l-xl transition-colors hover:bg-surface-3"><ChevronLeft aria-hidden size={18} /></Link>
            <span className="min-w-36 px-2 text-center text-[0.9375rem] font-semibold">{month}</span>
            {nextMonth <= today.slice(0, 7) ? (
              <Link href={`/categorias?mes=${nextMonth}`} aria-label="Próximo mês" className="flex size-11 items-center justify-center rounded-r-xl transition-colors hover:bg-surface-3"><ChevronRight aria-hidden size={18} /></Link>
            ) : (
              <span aria-hidden className="w-11" />
            )}
          </nav>
        }
      />

      {data.rows.length ? (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,22rem)_minmax(0,1fr)] xl:gap-5">
          <MetricCard
            id="gasto-mes"
            glow
            className="lg:self-start"
            label={`Gasto em ${month.toLowerCase()}`}
            value={<Sensitive>{formatBRL(data.totalCents)}</Sensitive>}
            qualifier={plural(data.rows.length, "categoria", "categorias")}
            delta={<DeltaChip bp={change} goodWhen="down" caption={change === null ? undefined : `contra ${formatRangeBR(previous)}`} />}
          >
            <div className="flex justify-center py-2">
              <CategoryRing title={`Parte de cada categoria no gasto de ${month.toLowerCase()}`} rows={data.rows.map((r) => ({ name: r.name, cents: r.totalCents, color: color(r.categoryId) }))} />
            </div>
            <p className="mt-3 text-meta text-muted">
              {monthCoverage(range)} Sem transferências, pagamentos de fatura e receitas. Estornos descontam da categoria.
            </p>
          </MetricCard>

          <section aria-labelledby="h-lista" className="min-w-0 rounded-2xl border border-border bg-surface p-2 shadow-card sm:p-3">
            <h2 id="h-lista" className="sr-only">Categorias do mês</h2>
            <ol aria-label="Categorias do mês" className="flex flex-col">
              {data.rows.map((r) => (
                <li key={r.categoryId} className="border-t border-border/70 first:border-0">
                  <Link href={href(r.categoryId)} className="flex min-h-16 flex-col gap-2 rounded-xl px-3 py-3 transition-colors hover:bg-surface-2 sm:px-4">
                    <span className="flex items-center justify-between gap-3">
                      <span className="flex min-w-0 items-center gap-3">
                        <span aria-hidden className="flex size-9 shrink-0 items-center justify-center rounded-xl" style={{ background: `color-mix(in srgb, ${color(r.categoryId)} 18%, transparent)`, color: color(r.categoryId) }}>
                          <PieChart size={16} />
                        </span>
                        <span className="min-w-0">
                          <span className="block truncate text-[0.9375rem] font-semibold">{r.name}</span>
                          <span className="block text-meta text-muted">{plural(r.count, "lançamento", "lançamentos")}</span>
                        </span>
                      </span>
                      <span className="flex shrink-0 flex-col items-end gap-1">
                        <span className="text-[0.9375rem] font-semibold tabular-nums"><Sensitive>{formatBRL(r.totalCents)}</Sensitive></span>
                        <DeltaChip bp={r.changeBp} goodWhen="down" />
                      </span>
                    </span>
                    <PrivateBlock>
                      <span className="flex items-center gap-3">
                        <span aria-hidden className="block h-1.5 flex-1 rounded-full bg-surface-3">
                          <span className="block h-1.5 rounded-full" style={{ width: `${Math.max(1, Math.round(r.shareBp / 100))}%`, background: color(r.categoryId) }} />
                        </span>
                        <span className="w-12 shrink-0 text-right text-meta tabular-nums text-muted">{(r.shareBp / 100).toLocaleString("pt-BR", { maximumFractionDigits: 0 })}%</span>
                      </span>
                    </PrivateBlock>
                  </Link>
                </li>
              ))}
            </ol>
          </section>
        </div>
      ) : (
        <EmptyState icon={<PieChart aria-hidden size={22} />} title={`Sem gastos em ${month.toLowerCase()}`} action={<ButtonLink href={txHref({ de: range.from, ate: range.to })} variant="secondary">Ver transações</ButtonLink>}>
          Nenhuma despesa lançada neste mês. Escolha outro mês acima ou importe um extrato.
        </EmptyState>
      )}
    </>
  );
}
