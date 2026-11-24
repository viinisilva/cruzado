import type { Metadata } from "next";
import Link from "next/link";
import { getDb } from "@/db/client";
import { requireUser } from "@/lib/auth/session";
import { changeOrigin, isAmbiguous, listChanges, reconciliationHealth, type ChangeOrigin } from "@/lib/card-reconciliation";
import { loadAccounts, loadCategories } from "@/lib/data/repo";
import { formatDateBR } from "@/lib/dates";
import { formatBRL } from "@/lib/money";
import { plural } from "@/lib/text";
import { Button, ButtonLink, Card, EmptyState, Notice, PageHeader } from "@/components/ui";
import { Sensitive } from "@/components/client";
import { ApplyAll } from "./apply-all";
import { applyChangeAction, dismissChangeAction, revertChangeAction } from "@/app/actions/reconciliation";

export const metadata: Metadata = { title: "Conciliação de cartões" };

const link = "font-medium text-primary underline underline-offset-2";

const ORIGIN: Record<ChangeOrigin["origin"], string> = { evidence: "classificação por evidência", reconciler: "conciliação da fatura", suggestion: "sugestão em Conferir fatura" };
/** Who proposed it, and who applied it: the person (one by one or with "Aplicar todas") or the Cruzado alone. */
function authorship(c: ChangeOrigin): string {
  if (c.appliedBy === "system") return `feita sozinha pela ${ORIGIN[c.origin]}`;
  const how = c.via === "all" ? " com Aplicar todas" : c.via === "single" ? " uma a uma" : "";
  return c.origin === "suggestion" ? `aplicada por você${how}, a partir de uma ${ORIGIN.suggestion}` : `proposta pela ${ORIGIN[c.origin]}, aplicada por você${how}`;
}

/**
 * The dry run and its outcome (docs/AUTOCONCILIACAO.md): what the classifier and the reconciler would change in data
 * stored before they existed, what they changed alone, and how each bank's bills have been matching.
 */
export default async function ReconciliationPage() {
  const user = await requireUser();
  const db = await getDb();
  const [proposed, applied, health, accounts, categories] = await Promise.all([
    listChanges(db, user.id, ["proposed"]),
    listChanges(db, user.id, ["applied"]),
    reconciliationHealth(db, user.id),
    loadAccounts(db, user.id),
    loadCategories(db, user.id),
  ]);
  const cat = (id: unknown) => (typeof id === "string" && categories.find((c) => c.id === id)?.name) || "Sem categoria";
  const acc = (id: string) => accounts.find((a) => a.id === id)?.name ?? "Cartão";
  const bulk = proposed.filter((c) => !isAmbiguous(c));

  return (
    <>
      <PageHeader title="Conciliação de cartões" description="O que o Cruzado mudou ou quer mudar para as faturas baterem com o banco." action={<ButtonLink href="/cartoes" variant="secondary">Voltar para Cartões</ButtonLink>} />
      <div className="grid gap-4">
        <Card aria-labelledby="propostas">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 id="propostas" className="text-lg font-semibold">Mudanças propostas ({proposed.length})</h2>
              <p className="text-sm text-muted">Relatório sobre dados antigos: nada aqui foi aplicado. Cada uma pode ser aplicada ou descartada.</p>
            </div>
            <div className="flex flex-wrap gap-2">
              {/* A file to review calmly or send: every proposal, its evidence and its effect on the bills. Changes nothing. */}
              <a href="/cartoes/conciliacao/relatorio" download className="inline-flex min-h-11 items-center rounded-xl border border-border-strong bg-surface px-4 text-sm font-semibold hover:bg-surface-2">
                Baixar relatório
              </a>
              {bulk.length ? <ApplyAll count={bulk.length} /> : null}
            </div>
          </div>
          {proposed.length ? (
            <ul className="mt-3 divide-y divide-border">
              {proposed.map((c) => (
                <li key={c.id} className="flex flex-wrap items-start justify-between gap-3 py-3">
                  <div className="min-w-0">
                    <Link href={`/transacoes/${c.txId}`} className={link}>{c.description}</Link>
                    <p className="text-sm text-muted">{formatDateBR(c.date)} · {acc(c.accountId)} · <Sensitive>{formatBRL(Math.abs(c.amountCents))}</Sensitive></p>
                    <p className="text-sm">{cat(c.before.categoryId)} → <strong className="font-semibold">{cat(c.after.categoryId)}</strong></p>
                    <p className="text-sm text-muted">{c.reason}</p>
                    {isAmbiguous(c) ? <p className="text-sm font-medium text-attention">Ambígua: a evidência não decidiu. Fica fora de “Aplicar todas”; confira e aplique só se fizer sentido.</p> : null}
                  </div>
                  <div className="flex gap-2">
                    <form action={applyChangeAction}><input type="hidden" name="id" value={c.id} /><Button type="submit" size="sm">Aplicar</Button></form>
                    <form action={dismissChangeAction}><input type="hidden" name="id" value={c.id} /><Button type="submit" size="sm" variant="secondary">Descartar</Button></form>
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-3 text-sm text-muted">Nenhuma mudança esperando revisão.</p>
          )}
        </Card>

        <Card aria-labelledby="aplicadas">
          <h2 id="aplicadas" className="text-lg font-semibold">Mudanças aplicadas ({applied.length})</h2>
          <p className="text-sm text-muted">Feitas pelo Cruzado ou por você. Desfazer volta a categoria anterior e a deixa como escolha sua.</p>
          {applied.length ? (
            <ul className="mt-3 divide-y divide-border">
              {applied.map((c) => (
                <li key={c.id} className="flex flex-wrap items-start justify-between gap-3 py-3">
                  <div className="min-w-0">
                    <Link href={`/transacoes/${c.txId}`} className={link}>{c.description}</Link>
                    <p className="text-sm text-muted">{formatDateBR(c.date)} · {acc(c.accountId)} · <Sensitive>{formatBRL(Math.abs(c.amountCents))}</Sensitive> · {authorship(changeOrigin(c))}</p>
                    <p className="text-sm">{cat(c.before.categoryId)} → <strong className="font-semibold">{cat(c.after.categoryId)}</strong></p>
                    <p className="text-sm text-muted">{c.reason}</p>
                  </div>
                  <form action={revertChangeAction}><input type="hidden" name="id" value={c.id} /><Button type="submit" size="sm" variant="secondary">Desfazer</Button></form>
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-3 text-sm text-muted">Nenhuma ainda.</p>
          )}
        </Card>

        <Card aria-labelledby="saude">
          <h2 id="saude" className="text-lg font-semibold">Saúde da conciliação</h2>
          <p className="mb-3 text-sm text-muted">Faturas fechadas com total do banco nos últimos 12 meses, pela situação mais recente de cada uma.</p>
          {health.length ? (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="text-muted">
                  <tr><th scope="col" className="py-2 pr-3 font-medium">Banco</th><th scope="col" className="px-3 font-medium">Faturas</th><th scope="col" className="px-3 font-medium">Bateram</th><th scope="col" className="px-3 font-medium">Corrigidas</th><th scope="col" className="px-3 font-medium">Esperando você</th><th scope="col" className="px-3 font-medium">Sem solução</th></tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {health.map((h) => (
                    <tr key={h.institution}>
                      <th scope="row" className="py-2 pr-3 font-medium">{h.institution}</th>
                      <td className="px-3 tabular-nums">{h.bills}</td>
                      <td className="px-3 tabular-nums">{h.matched}</td>
                      <td className="px-3 tabular-nums">{h.fixed}</td>
                      <td className="px-3 tabular-nums">{h.waiting}</td>
                      <td className="px-3 tabular-nums">{h.open}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <EmptyState title="Nada medido ainda">Os números aparecem depois da próxima sincronização de um cartão com faturas do banco.</EmptyState>
          )}
          <Notice tone="info" title="O que entra aqui">
            Só a situação de cada fatura e o tipo de mudança. Nenhum valor nem descrição é guardado neste registro.
          </Notice>
        </Card>
      </div>
    </>
  );
}
