import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { getDb } from "@/db/client";
import { requireUser } from "@/lib/auth/session";
import { listMatches } from "@/lib/reconcile";
import { Card, EmptyState, PageHeader } from "@/components/ui";
import { ConfirmSubmit } from "@/components/client";
import { undoMatchAction } from "../../../actions/whatsapp";
import { MatchCard, MatchSide } from "../match-card";

export const metadata: Metadata = { title: "Conciliar com o extrato" };

export default async function ReconcilePage() {
  const user = await requireUser();
  const db = await getDb();
  const [suggested, confirmed] = await Promise.all([listMatches(db, user.id, "suggested"), listMatches(db, user.id, "confirmed")]);
  return (
    <>
      <Link href="/transacoes/revisar" className="mb-3 inline-flex min-h-11 items-center gap-2 text-sm text-primary">
        <ArrowLeft aria-hidden size={18} /> Voltar para Revisar
      </Link>
      <PageHeader title="Possíveis correspondências" description="Gastos que parecem ter sido registrados duas vezes. Só você decide: duas compras iguais podem ser reais." />
      {suggested.length ? (
        <ul className="flex flex-col gap-3">
          {suggested.map((m) => (
            <li key={m.id}>
              <MatchCard match={m} />
            </li>
          ))}
        </ul>
      ) : (
        <EmptyState title="Nada para revisar">Quando um extrato trouxer um gasto parecido com o que você informou, ele aparece aqui.</EmptyState>
      )}
      {confirmed.length ? (
        <section aria-labelledby="h-conc" className="mt-6">
          <h2 id="h-conc" className="mb-3 text-lg font-semibold tracking-tight">Já conciliados</h2>
          <ul className="flex flex-col gap-3">
            {confirmed.map((m) => (
              <li key={m.id}>
                <Card>
                  <MatchSide label="Mantido" tx={m.bank} />
                  <form action={undoMatchAction} className="mt-2">
                    <input type="hidden" name="id" value={m.id} />
                    <ConfirmSubmit size="sm" confirmLabel="Sim, desfazer">Desfazer conciliação</ConfirmSubmit>
                  </form>
                </Card>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </>
  );
}
