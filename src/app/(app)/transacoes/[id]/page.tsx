import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { and, eq } from "drizzle-orm";
import { ArrowLeft } from "lucide-react";
import { getDb } from "@/db/client";
import * as s from "@/db/schema";
import { requireUser } from "@/lib/auth/session";
import { loadAccounts, loadCategories } from "@/lib/data/repo";
import { formatDateBR } from "@/lib/dates";
import { formatBRL } from "@/lib/money";
import { PAYMENT_LABEL, originLabel } from "@/lib/finance/labels";
import { safeTxReturn } from "@/lib/tx-query";
import { Card, CardTitle, Notice, PageHeader } from "@/components/ui";
import { ConfirmSubmit, Sensitive } from "@/components/client";
import { deleteTransactionAction } from "../../../actions/finance";
import { EditTransactionForm } from "../forms";

export const metadata: Metadata = { title: "Transação" };

export default async function TransactionPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ volta?: string }> }) {
  const user = await requireUser();
  const { id } = await params;
  const back = safeTxReturn((await searchParams).volta);
  const db = await getDb();
  const [tx] = await db.select().from(s.transactions).where(and(eq(s.transactions.id, id), eq(s.transactions.userId, user.id)));
  if (!tx) notFound();
  const [accounts, categories] = await Promise.all([loadAccounts(db, user.id), loadCategories(db, user.id)]);
  return (
    <>
      <Link href={back} className="mb-3 inline-flex min-h-11 items-center gap-2 text-sm text-primary">
        <ArrowLeft aria-hidden size={18} /> Voltar para transações
      </Link>
      <PageHeader title={tx.description} description={formatDateBR(tx.date)} />
      {tx.supersededBy ? (
        <div className="mb-4">
          <Notice tone="info" title="Conciliado com o extrato">
            Este registro foi substituído pelo lançamento do banco e não entra nas somas. <Link className="font-medium underline" href={`/transacoes/${tx.supersededBy}`}>Ver lançamento do banco</Link>
          </Notice>
        </div>
      ) : null}
      <div className="grid max-w-6xl grid-cols-1 gap-5 lg:grid-cols-2">
        <Card>
          <CardTitle>Detalhes</CardTitle>
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
            <dt className="text-muted">Valor</dt>
            <dd className={`font-semibold tabular-nums ${tx.amountCents > 0 ? "text-positive" : ""}`}>
              <Sensitive>{formatBRL(tx.amountCents)}</Sensitive> <span className="font-normal text-muted">({tx.amountCents < 0 ? "despesa" : "receita"})</span>
            </dd>
            <dt className="text-muted">Conta</dt>
            <dd>{accounts.find((a) => a.id === tx.accountId)?.name}</dd>
            <dt className="text-muted">Categoria</dt>
            <dd>{categories.find((c) => c.id === tx.categoryId)?.name ?? "Sem categoria"}</dd>
            {tx.installmentTotal ? (
              <>
                <dt className="text-muted">Parcela</dt>
                <dd>
                  {tx.installmentNumber} de {tx.installmentTotal}
                </dd>
              </>
            ) : null}
            {tx.paymentMethod ? (
              <>
                <dt className="text-muted">Forma de pagamento</dt>
                <dd>{PAYMENT_LABEL[tx.paymentMethod]}</dd>
              </>
            ) : null}
            {tx.bankStatus === "pending" ? (
              <>
                <dt className="text-muted">Situação</dt>
                <dd>Aguardando o banco</dd>
              </>
            ) : null}
            {tx.providerDescription && tx.providerDescription !== tx.description ? (
              <>
                <dt className="text-muted">Texto do banco</dt>
                <dd className="break-words">{tx.providerDescription}</dd>
              </>
            ) : null}
            {tx.notes ? (
              <>
                <dt className="text-muted">Observação</dt>
                <dd className="break-words">{tx.notes}</dd>
              </>
            ) : null}
            <dt className="text-muted">Origem</dt>
            <dd>{originLabel(tx.source, tx.channel)}</dd>
            <dt className="text-muted">Identificador</dt>
            <dd className="break-all font-mono text-meta">{tx.id}</dd>
          </dl>
        </Card>
        <Card>
          <CardTitle>Ajustar</CardTitle>
          <EditTransactionForm tx={tx} categories={categories} />
          <form action={deleteTransactionAction} className="mt-6 border-t border-border pt-4">
            <input type="hidden" name="id" value={tx.id} />
            <input type="hidden" name="volta" value={back} />
            <p className="mb-2 text-sm text-muted">
              Excluir remove o lançamento só do Cruzado. {tx.source === "csv" || tx.source === "ofx" ? "Se você reimportar o mesmo extrato, ele será importado de novo." : ""}
            </p>
            <ConfirmSubmit confirmLabel="Sim, excluir transação">Excluir transação</ConfirmSubmit>
          </form>
        </Card>
      </div>
    </>
  );
}
