import type { Metadata } from "next";
import Link from "next/link";
import { getDb } from "@/db/client";
import { requireUser } from "@/lib/auth/session";
import { CONNECTION_STATUS, formatDateTimeBR } from "@/lib/connectors/status";
import { loadCategories } from "@/lib/data/repo";
import { formatDateBR } from "@/lib/dates";
import { formatBRL } from "@/lib/money";
import { plural } from "@/lib/text";
import { loadReview } from "@/lib/review";
import { Badge, Button, ButtonLink, EmptyState, Notice, PageHeader, Select } from "@/components/ui";
import { Sensitive } from "@/components/client";
import { setCategoryAction } from "../../../actions/finance";
import { MatchCard } from "../match-card";
import { TxTabs } from "../tabs";

export const metadata: Metadata = { title: "Revisar transações" };

export default async function ReviewPage() {
  const user = await requireUser();
  const db = await getDb();
  const [review, categories] = await Promise.all([loadReview(db, user.id), loadCategories(db, user.id)]);
  const count = review.matches.length + review.uncategorizedTotal + review.connections.length;
  return (
    <>
      <PageHeader title="Transações" />
      <TxTabs current="revisar" reviewCount={count} />

      {review.connections.length ? (
        <section aria-labelledby="h-rev-bank" className="mb-6">
          <h2 id="h-rev-bank" className="mb-3 text-lg font-semibold tracking-tight">Conexões com o banco</h2>
          <ul className="flex flex-col gap-2">
            {review.connections.map((c) => (
              <li key={c.id} className="rounded-2xl border border-border bg-surface p-4 text-sm shadow-card">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="font-medium">{c.label}</p>
                  <Badge tone={CONNECTION_STATUS[c.status].tone}>{CONNECTION_STATUS[c.status].label}</Badge>
                </div>
                <p className="text-muted">{c.detail ?? "Não foi possível atualizar."} {c.lastSyncAt ? `Dados até ${formatDateTimeBR(c.lastSyncAt)}.` : ""}</p>
                <Link className="mt-1 inline-flex min-h-11 items-center font-medium text-primary" href="/configuracoes?aba=integracoes#bancos">Resolver</Link>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {review.matches.length ? (
        <section aria-labelledby="h-rev-match" className="mb-6">
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
            <h2 id="h-rev-match" className="text-lg font-semibold tracking-tight">{plural(review.matches.length, "Possível duplicidade", "Possíveis duplicidades")}</h2>
            <Link href="/transacoes/conciliar" className="inline-flex min-h-11 items-center text-sm font-medium text-primary">Ver conciliados</Link>
          </div>
          <ul className="flex flex-col gap-3">
            {review.matches.map((m) => (
              <li key={m.id}>
                <MatchCard match={m} />
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {review.uncategorized.length ? (
        <section aria-labelledby="h-rev-cat" className="mb-6">
          <h2 id="h-rev-cat" className="text-lg font-semibold tracking-tight">{plural(review.uncategorizedTotal, "Transação sem categoria", "Transações sem categoria")}</h2>
          <p className="mb-2 text-sm text-muted">Sem categoria, o gasto fica de fora dos relatórios por tipo.</p>
          <ul className="divide-y divide-border/60">
            {review.uncategorized.map((t) => (
              <li key={t.id} className="flex flex-col gap-2 py-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0">
                  <Link href={`/transacoes/${t.id}`} className="block truncate text-sm font-medium hover:underline">{t.description}</Link>
                  <p className="text-meta text-muted tabular-nums">{formatDateBR(t.date)} · <Sensitive>{formatBRL(t.amountCents)}</Sensitive></p>
                </div>
                <form action={setCategoryAction} className="flex shrink-0 items-center gap-2">
                  <input type="hidden" name="id" value={t.id} />
                  <label htmlFor={`cat-${t.id}`} className="sr-only">Categoria de {t.description}</label>
                  <Select id={`cat-${t.id}`} name="categoryId" defaultValue="" required className="min-w-0 sm:w-48">
                    <option value="" disabled>Escolher categoria</option>
                    {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                  </Select>
                  <Button type="submit" variant="secondary" aria-label={`Salvar categoria de ${t.description}`}>Salvar</Button>
                </form>
              </li>
            ))}
          </ul>
          {review.uncategorizedTotal > review.uncategorized.length ? <ButtonLink href="/transacoes?categoria=sem-categoria" variant="secondary">Ver todas</ButtonLink> : null}
        </section>
      ) : null}

      {count === 0 ? <EmptyState title="Nenhuma revisão necessária">Nada aguarda uma decisão sua agora.</EmptyState> : null}

      {review.pendingAtBank ? (
        <Notice tone="info" title="Aguardando o banco">
          {plural(review.pendingAtBank, "lançamento ainda não foi efetivado", "lançamentos ainda não foram efetivados")} pelo banco. Não é preciso fazer nada; {review.pendingAtBank === 1 ? "ele se atualiza" : "eles se atualizam"} sozinho{review.pendingAtBank === 1 ? "" : "s"}.{" "}
          <Link className="font-medium underline" href="/transacoes?status=pendente">Ver</Link>
        </Notice>
      ) : null}
    </>
  );
}
