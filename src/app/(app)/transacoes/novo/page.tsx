import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { getDb } from "@/db/client";
import { requireUser } from "@/lib/auth/session";
import { loadAccounts, loadCategories } from "@/lib/data/repo";
import { todayInSaoPaulo } from "@/lib/dates";
import { ButtonLink, Card, EmptyState, PageHeader } from "@/components/ui";
import { NewTransactionForm } from "../forms";

export const metadata: Metadata = { title: "Adicionar transação" };

export default async function NewTransactionPage() {
  const user = await requireUser();
  const db = await getDb();
  const [accounts, categories] = await Promise.all([loadAccounts(db, user.id), loadCategories(db, user.id)]);
  return (
    <>
      <Link href="/transacoes" className="mb-3 inline-flex min-h-11 items-center gap-2 text-sm text-primary">
        <ArrowLeft aria-hidden size={18} /> Voltar para transações
      </Link>
      <PageHeader title="Adicionar transação" />
      <Card className="max-w-3xl">
        {accounts.length ? (
          <NewTransactionForm accounts={accounts} categories={categories} today={todayInSaoPaulo()} />
        ) : (
          <EmptyState title="Cadastre uma conta primeiro" action={<ButtonLink href="/comecar">Escolher meus bancos</ButtonLink>} />
        )}
      </Card>
    </>
  );
}
