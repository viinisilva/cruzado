// Accessible SVG charts: text values, legend, native tooltips (<title>) and a table alternative.
// Income and expense differ by shape (solid vs. hatched), not only by color.
import Link from "next/link";
import { formatBRL } from "@/lib/money";
import { formatRangeBR } from "@/lib/dates";
import { UNCATEGORIZED_FILTER, txHref } from "@/lib/tx-query";
import { PrivateBlock, Sensitive } from "./client";
import { cx } from "./ui";

type Bucket = { label: string; from: string; to: string; incomeCents: number; expenseCents: number };

export function FlowChart({ buckets, title }: { buckets: Bucket[]; title: string }) {
  const max = Math.max(1, ...buckets.flatMap((b) => [b.incomeCents, b.expenseCents]));
  const W = 640;
  const H = 180;
  const pad = 24;
  const groupW = (W - pad) / Math.max(1, buckets.length);
  const barW = Math.min(18, groupW / 3);
  const y = (v: number) => H - pad - ((H - pad * 2) * v) / max;
  return (
    <figure className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-4 text-meta text-muted" aria-hidden>
        <span className="inline-flex items-center gap-1.5">
          <svg width="14" height="14"><rect width="14" height="14" rx="2" fill="var(--chart-in)" /></svg>Receitas
        </span>
        <span className="inline-flex items-center gap-1.5">
          <svg width="14" height="14">
            <rect width="14" height="14" rx="2" fill="url(#hatch-legend)" stroke="var(--chart-out)" />
            <defs>
              <pattern id="hatch-legend" width="4" height="4" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
                <rect width="2" height="4" fill="var(--chart-out)" />
              </pattern>
            </defs>
          </svg>
          Despesas
        </span>
      </div>
      <PrivateBlock fallback="Gráfico oculto: as barras revelariam os valores.">
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`${title}. Valores detalhados na tabela abaixo.`} className="h-auto w-full">
        <defs>
          <pattern id="hatch" width="5" height="5" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
            <rect width="2.5" height="5" fill="var(--chart-out)" />
          </pattern>
        </defs>
        <line x1={pad} x2={W} y1={H - pad} y2={H - pad} stroke="var(--border-strong)" strokeOpacity="0.5" />
        {buckets.map((b, i) => {
          const x = pad + i * groupW + groupW / 2;
          return (
            <g key={b.from}>
              <rect x={x - barW - 1} y={y(b.incomeCents)} width={barW} height={H - pad - y(b.incomeCents)} rx="2" fill="var(--chart-in)">
                <title>{`${formatRangeBR(b)} · Receitas ${formatBRL(b.incomeCents)}`}</title>
              </rect>
              <rect x={x + 1} y={y(b.expenseCents)} width={barW} height={H - pad - y(b.expenseCents)} rx="2" fill="url(#hatch)" stroke="var(--chart-out)">
                <title>{`${formatRangeBR(b)} · Despesas ${formatBRL(b.expenseCents)}`}</title>
              </rect>
              {buckets.length <= 14 && i % Math.ceil(buckets.length / 7) === 0 ? (
                <text x={x} y={H - 6} textAnchor="middle" fontSize="12" fill="var(--text-muted)">
                  {b.label}
                </text>
              ) : null}
            </g>
          );
        })}
      </svg>
      </PrivateBlock>
      <details className="text-sm">
        <summary className="inline-flex min-h-11 cursor-pointer items-center font-semibold text-primary">Ver em tabela</summary>
        <div className="overflow-x-auto">
          <table className="mt-2 w-full text-left">
            <caption className="sr-only">{title}</caption>
            <thead className="text-muted">
              <tr>
                <th scope="col" className="py-1 pr-3 font-medium">Período</th>
                <th scope="col" className="py-1 pr-3 text-right font-medium">Receitas</th>
                <th scope="col" className="py-1 text-right font-medium">Despesas</th>
              </tr>
            </thead>
            <tbody>
              {buckets.map((b) => (
                <tr key={b.from} className="border-t border-border">
                  <td className="py-1.5 pr-3">
                    <Link className="underline underline-offset-2" href={`/transacoes?de=${b.from}&ate=${b.to}`}>
                      {formatRangeBR(b)}
                    </Link>
                  </td>
                  <td className="py-1.5 pr-3 text-right"><Sensitive>{formatBRL(b.incomeCents)}</Sensitive></td>
                  <td className="py-1.5 text-right"><Sensitive>{formatBRL(b.expenseCents)}</Sensitive></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </figure>
  );
}

export type MonthBar = { key: string; label: string; month: string; cents: number; hatched?: boolean; active?: boolean; href?: string };

/** One bar per month. Solid means settled, hatched means it can still change; the highlighted month matches the headline. */
export function MonthBars({ items, title, legend }: { items: MonthBar[]; title: string; legend?: { solid: string; hatched: string } }) {
  const max = Math.max(1, ...items.map((i) => i.cents));
  return (
    <figure className="flex flex-col gap-3">
      {legend ? (
        <div className="flex flex-wrap items-center gap-4 text-meta text-muted" aria-hidden>
          <span className="inline-flex items-center gap-1.5"><span className="size-3.5 rounded-sm bg-[var(--chart-out)]" />{legend.solid}</span>
          <span className="inline-flex items-center gap-1.5"><span className="bar-hatched size-3.5 rounded-sm text-[var(--chart-out)]" />{legend.hatched}</span>
        </div>
      ) : null}
      <PrivateBlock fallback="Gráfico oculto: as barras revelariam os valores.">
        <div role="img" aria-label={`${title}. Valores detalhados na tabela abaixo.`} className="flex items-end gap-1 border-b border-border sm:gap-3">
          {items.map((i) => (
            <div key={i.key} title={`${i.month}: ${formatBRL(i.cents)}`} className={`flex h-32 min-w-0 flex-1 items-end justify-center ${i.active ? "text-primary" : "text-[color-mix(in_srgb,var(--chart-out)_70%,var(--surface))]"}`}>
              <div className={`w-full max-w-10 rounded-t ${i.hatched ? "bar-hatched" : "bg-current"}`} style={{ height: i.cents > 0 ? `${Math.max(4, Math.round((i.cents * 100) / max))}%` : "2px" }} />
            </div>
          ))}
        </div>
        {items.some((i) => i.href) ? (
          <div className="-mt-2 flex gap-1 sm:gap-3">
            {items.map((i) => (
              <Link key={i.key} href={i.href ?? "#"} scroll={false} aria-label={`Ver ${i.month}`} aria-current={i.active ? "true" : undefined} className={`flex min-h-11 min-w-0 flex-1 items-start justify-center truncate rounded-lg pt-1 text-center text-meta transition-colors hover:bg-surface-3 ${i.active ? "font-semibold text-text" : "text-muted"}`}>
                {i.label}
              </Link>
            ))}
          </div>
        ) : (
          <div aria-hidden className="-mt-2 flex gap-1 sm:gap-3">
            {items.map((i) => (
              <span key={i.key} className={`min-w-0 flex-1 truncate text-center text-meta ${i.active ? "font-semibold text-text" : "text-muted"}`}>{i.label}</span>
            ))}
          </div>
        )}
      </PrivateBlock>
      <details className="text-sm">
        <summary className="inline-flex min-h-11 cursor-pointer items-center font-semibold text-primary">Ver em tabela</summary>
        <table className="mt-2 w-full text-left">
          <caption className="sr-only">{title}</caption>
          <thead className="text-muted">
            <tr>
              <th scope="col" className="py-1 pr-3 font-medium">Mês</th>
              <th scope="col" className="py-1 text-right font-medium">Valor</th>
            </tr>
          </thead>
          <tbody>
            {items.map((i) => (
              <tr key={i.key} className="border-t border-border">
                <td className="py-1.5 pr-3 capitalize">{i.month}{legend && i.hatched ? <span className="normal-case text-muted"> ({legend.hatched.toLowerCase()})</span> : null}</td>
                <td className="py-1.5 text-right tabular-nums"><Sensitive>{formatBRL(i.cents)}</Sensitive></td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </figure>
  );
}

export function CategoryBars({ items, totalCents, range }: { items: { categoryId: string; name: string; totalCents: number; count: number }[]; totalCents: number; range: { from: string; to: string } }) {
  const max = Math.max(1, ...items.map((i) => i.totalCents));
  return (
    <ol className="flex flex-col gap-1">
      {items.map((c, i) => {
        const pct = totalCents ? Math.round((c.totalCents * 100) / totalCents) : 0;
        // Spending excludes uncategorized money coming in, so its link must too, or the list would not add up.
        const href = txHref({ de: range.from, ate: range.to, categoria: c.categoryId, tipo: c.categoryId === UNCATEGORIZED_FILTER ? "despesa" : undefined });
        return (
          <li key={c.categoryId}>
            <Link href={href} className="-mx-2 block rounded-xl px-2 py-1.5 transition-colors hover:bg-surface-2">
              <div className="flex items-baseline justify-between gap-3 text-[0.9375rem]">
                <span className="min-w-0 font-medium">
                  <span className="text-muted">{i + 1}.</span> {c.name}
                </span>
                <span className="shrink-0 font-semibold tabular-nums">
                  <Sensitive>{formatBRL(c.totalCents)}</Sensitive>
                  <PrivateBlock>
                    {" "}
                    <span className="font-normal text-muted">· {pct}%</span>
                  </PrivateBlock>
                </span>
              </div>
              <PrivateBlock>
                <div className="mt-1.5 h-2 rounded-full bg-surface-3" aria-hidden>
                  <div className={`h-2 rounded-full ${i === 0 ? "bg-primary" : "bg-primary/65"}`} style={{ width: `${Math.max(2, Math.round((c.totalCents * 100) / max))}%` }} />
                </div>
              </PrivateBlock>
            </Link>
          </li>
        );
      })}
    </ol>
  );
}

const compactBRL = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL", notation: "compact", maximumFractionDigits: 1 });

type PacePoint = { day: number; cents: number };

/**
 * Spending accumulated through the period, against the same stretch of the previous one (dashed).
 * The gap between the two lines answers "am I spending faster than last time?" at a glance.
 */
export function PaceChart({ current, previous, title, currentLabel = "Este período", previousLabel = "Período anterior" }: { current: PacePoint[]; previous: PacePoint[]; title: string; currentLabel?: string; previousLabel?: string }) {
  const W = 640;
  const H = 220;
  const left = 4;
  const right = 12;
  const top = 12;
  const bottom = 6;
  const days = Math.max(2, current.length, previous.length);
  const max = Math.max(1, ...current.map((p) => p.cents), ...previous.map((p) => p.cents));
  const x = (day: number) => left + ((W - left - right) * (day - 1)) / (days - 1);
  const y = (cents: number) => H - bottom - ((H - top - bottom) * cents) / max;
  const line = (pts: PacePoint[]) => pts.map((p) => `${x(p.day).toFixed(1)},${y(p.cents).toFixed(1)}`).join(" ");
  const last = current.at(-1);
  const ticks = [0, 0.5, 1].map((f) => Math.round(max * f));
  const dayTicks = [...new Set([1, Math.ceil(days / 2), days])];
  return (
    <figure className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-4 text-meta text-muted" aria-hidden>
        <span className="inline-flex items-center gap-2"><svg width="18" height="4"><line x1="0" x2="18" y1="2" y2="2" stroke="var(--primary)" strokeWidth="3" strokeLinecap="round" /></svg>{currentLabel}</span>
        <span className="inline-flex items-center gap-2"><svg width="18" height="4"><line x1="0" x2="18" y1="2" y2="2" stroke="var(--text-muted)" strokeWidth="2" strokeDasharray="3 3" /></svg>{previousLabel}</span>
      </div>
      <PrivateBlock fallback="Gráfico oculto: as linhas revelariam os valores.">
        {/* Axis labels are HTML over the drawing, so they keep their real size however narrow the chart gets. */}
        <div className="relative">
          <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" role="img" aria-label={`${title}. Valores detalhados na tabela abaixo.`} className="h-48 w-full overflow-visible sm:h-56">
            {ticks.map((t, i) => (
              <line key={i} x1={left} x2={W - right} y1={y(t)} y2={y(t)} stroke="var(--border)" vectorEffect="non-scaling-stroke" />
            ))}
            {previous.length > 1 ? <polyline points={line(previous)} fill="none" stroke="var(--text-muted)" strokeOpacity="0.8" strokeWidth="2" strokeDasharray="5 5" strokeLinejoin="round" vectorEffect="non-scaling-stroke" /> : null}
            {current.length > 1 ? <polyline points={line(current)} fill="none" stroke="var(--primary)" strokeWidth="3" strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" /> : null}
          </svg>
          {last ? (
            <span aria-hidden className="absolute size-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-primary ring-2 ring-surface" style={{ left: `${(x(last.day) / W) * 100}%`, top: `${(y(last.cents) / H) * 100}%` }} />
          ) : null}
          {/* Zero needs no label: the baseline says it, and a label there would sit on the start of the line. */}
          {ticks.map((t, i) => (i === 0 ? null :
            <span key={i} data-axis aria-hidden className="absolute left-1 -translate-y-full pb-0.5 text-meta leading-none text-muted" style={{ top: `${(y(t) / H) * 100}%` }}>
              {compactBRL.format(t / 100)}
            </span>
          ))}
        </div>
        <div aria-hidden className="relative mt-1.5 h-4">
          {dayTicks.map((d, i) => (
            <span key={d} data-axis className={cx("absolute text-meta leading-none text-muted", i === 0 ? "" : i === dayTicks.length - 1 ? "-translate-x-full" : "-translate-x-1/2")} style={{ left: `${(x(d) / W) * 100}%` }}>
              {i === 0 ? `Dia ${d}` : d}
            </span>
          ))}
        </div>
      </PrivateBlock>
      <details className="text-sm">
        <summary className="inline-flex min-h-11 cursor-pointer items-center font-semibold text-primary">Ver em tabela</summary>
        <div className="max-h-64 overflow-y-auto">
          <table className="mt-2 w-full text-left">
            <caption className="sr-only">{title}</caption>
            <thead className="text-muted">
              <tr>
                <th scope="col" className="py-1 pr-3 font-medium">Dia</th>
                <th scope="col" className="py-1 pr-3 text-right font-medium">{currentLabel}</th>
                <th scope="col" className="py-1 text-right font-medium">{previousLabel}</th>
              </tr>
            </thead>
            <tbody>
              {Array.from({ length: days }, (_, i) => i + 1).map((d) => (
                <tr key={d} className="border-t border-border">
                  <td className="py-1.5 pr-3">{d}</td>
                  <td className="py-1.5 pr-3 text-right tabular-nums">{current[d - 1] ? <Sensitive>{formatBRL(current[d - 1]!.cents)}</Sensitive> : "—"}</td>
                  <td className="py-1.5 text-right tabular-nums">{previous[d - 1] ? <Sensitive>{formatBRL(previous[d - 1]!.cents)}</Sensitive> : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </figure>
  );
}

/** Share of each category as a ring. Decorative next to the list, which carries names and values; hidden with values. */
export function CategoryRing({ rows, title }: { rows: { name: string; cents: number; color: string }[]; title: string }) {
  const total = rows.reduce((s, r) => s + Math.max(0, r.cents), 0);
  const r = 42;
  const c = 2 * Math.PI * r;
  let offset = 0;
  return (
    <PrivateBlock>
      <svg viewBox="0 0 100 100" role="img" aria-label={`${title}. Valores na lista ao lado.`} className="size-36 shrink-0 -rotate-90 sm:size-40">
        <circle cx="50" cy="50" r={r} fill="none" stroke="var(--surface-3)" strokeWidth="12" />
        {total > 0
          ? rows.map((row) => {
              const len = (Math.max(0, row.cents) / total) * c;
              const seg = (
                <circle key={row.name} cx="50" cy="50" r={r} fill="none" stroke={row.color} strokeWidth="12" strokeDasharray={`${Math.max(0, len - 1.2)} ${c}`} strokeDashoffset={-offset}>
                  <title>{row.name}</title>
                </circle>
              );
              offset += len;
              return seg;
            })
          : null}
      </svg>
    </PrivateBlock>
  );
}
