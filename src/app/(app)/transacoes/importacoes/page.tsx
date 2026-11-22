import type { Metadata } from "next";
import { and, desc, eq } from "drizzle-orm";
import { Upload } from "lucide-react";
import { getDb } from "@/db/client";
import * as s from "@/db/schema";
import { requireUser } from "@/lib/auth/session";
import { canConnectBanks } from "@/lib/connectors/pluggy";
import { CONNECTION_STATUS, formatDateTimeBR } from "@/lib/connectors/status";
import { plural } from "@/lib/text";
import { reviewCount } from "@/lib/review";
import { Badge, ButtonLink, Card, CardTitle, EmptyState, PageHeader } from "@/components/ui";
import { TxTabs } from "../tabs";

export const metadata: Metadata = { title: "Importações" };

const HISTORY = 50;

export default async function ImportsPage() {
  const user = await requireUser();
  const db = await getDb();
  const i = s.transactionImports;
  const [imports, connections, toReview] = await Promise.all([
    db.select({ id: i.id, fileName: i.fileName, format: i.format, createdAt: i.createdAt, rowsTotal: i.rowsTotal, rowsImported: i.rowsImported, rowsSkipped: i.rowsSkipped, account: s.accounts.name }).from(i).innerJoin(s.accounts, eq(s.accounts.id, i.accountId)).where(eq(i.userId, user.id)).orderBy(desc(i.createdAt)).limit(HISTORY),
    db.select().from(s.financialConnections).where(and(eq(s.financialConnections.userId, user.id), eq(s.financialConnections.connector, "open_finance"))),
    reviewCount(db, user.id),
  ]);
  const canConnect = canConnectBanks(user);
  return (
    <>
      <PageHeader title="Transações" />
      <TxTabs current="importacoes" reviewCount={toReview} />
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card aria-labelledby="h-file">
          <CardTitle id="h-file">Arquivo do banco</CardTitle>
          <p className="mb-3 text-sm text-muted">Envie um extrato CSV ou OFX. Você confere antes de importar, e o que já existe não entra de novo.</p>
          <ButtonLink href="/transacoes/importar"><Upload aria-hidden size={18} /> Importar extrato</ButtonLink>
        </Card>
        <Card aria-labelledby="h-banks">
          <CardTitle id="h-banks">Bancos conectados</CardTitle>
          {connections.length ? (
            <ul className="mb-2 divide-y divide-border/60 text-sm">
              {connections.map((c) => (
                <li key={c.id} className="py-2">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="font-medium">{c.label}</p>
                    <Badge tone={CONNECTION_STATUS[c.status].tone}>{CONNECTION_STATUS[c.status].label}</Badge>
                  </div>
                  <p className="text-meta text-muted">
                    {c.lastSyncAt ? `Última atualização concluída: ${formatDateTimeBR(c.lastSyncAt)}` : "Nenhuma atualização concluída ainda"}
                    {c.lastSyncSummary ? `, ${plural(c.lastSyncSummary.transactions, "transação lida", "transações lidas")}` : ""}
                  </p>
                  {c.statusDetail ? <p className="text-sm text-attention">{c.statusDetail}</p> : null}
                </li>
              ))}
            </ul>
          ) : (
            <p className="mb-3 text-sm text-muted">{canConnect ? "Nenhum banco conectado ainda." : "A conexão automática com bancos não está disponível nesta conta. Use o extrato em arquivo."}</p>
          )}
          {canConnect ? <ButtonLink href="/configuracoes?aba=integracoes#bancos" variant="secondary">{connections.length ? "Gerenciar bancos" : "Conectar banco"}</ButtonLink> : null}
        </Card>
      </div>

      <section aria-labelledby="h-hist" className="mt-6">
        <h2 id="h-hist" className="mb-3 text-lg font-semibold tracking-tight">Arquivos importados</h2>
        {imports.length ? (
          <ul className="divide-y divide-border/60">
            {imports.map((r) => (
              <li key={r.id} className="py-2 text-sm">
                <p className="break-words font-medium">{r.fileName}</p>
                <p className="text-meta text-muted">
                  {formatDateTimeBR(r.createdAt)} · {r.account} · {r.format.toUpperCase()}: {plural(r.rowsImported, "importada", "importadas")}, {plural(r.rowsSkipped, "ignorada", "ignoradas")}, de {r.rowsTotal.toLocaleString("pt-BR")}
                </p>
              </li>
            ))}
          </ul>
        ) : (
          <EmptyState title="Nenhum arquivo importado">Os extratos que você enviar aparecem aqui, com o que entrou e o que ficou de fora.</EmptyState>
        )}
      </section>
    </>
  );
}
