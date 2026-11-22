import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { getDb } from "@/db/client";
import { requireUser } from "@/lib/auth/session";
import { loadAccounts } from "@/lib/data/repo";
import { ButtonLink, EmptyState, PageHeader } from "@/components/ui";
import { ImportWizard } from "./wizard";

export const metadata: Metadata = { title: "Importar extrato" };

export default async function ImportPage() {
  const user = await requireUser();
  const accounts = await loadAccounts(await getDb(), user.id);
  return (
    <>
      <Link href="/transacoes" className="mb-3 inline-flex min-h-11 items-center gap-2 text-sm text-primary">
        <ArrowLeft aria-hidden size={18} /> Voltar para transações
      </Link>
      <PageHeader
        title="Importar extrato"
        description="Envie o arquivo CSV ou OFX do seu banco. Você confere tudo antes de confirmar, e o arquivo não fica guardado."
      />
      {accounts.length ? (
        <ImportWizard accounts={accounts.map((a) => ({ id: a.id, name: a.name, type: a.type }))} />
      ) : (
        <EmptyState title="Cadastre uma conta antes de importar" action={<ButtonLink href="/comecar">Escolher meus bancos</ButtonLink>} />
      )}
    </>
  );
}
