import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Check, FileUp, PartyPopper } from "lucide-react";
import { getDb } from "@/db/client";
import { requireUser } from "@/lib/auth/session";
import { canAddAccountsManually } from "@/lib/connectors/pluggy";
import { loadAccounts, loadTransactions } from "@/lib/data/repo";
import { plural } from "@/lib/text";
import { ButtonLink, Card, Notice, cx } from "@/components/ui";
import { ImportWizard } from "../transacoes/importar/wizard";
import { BankPicker } from "./bank-picker";

export const metadata: Metadata = { title: "Primeiros passos" };

const STEPS = ["Seus bancos", "Seu extrato", "Tudo pronto"];

function Stepper({ current }: { current: number }) {
  return (
    <ol className="mb-6 grid grid-cols-3 gap-2" aria-label="Progresso">
      {STEPS.map((label, i) => {
        const n = i + 1;
        const done = n < current;
        return (
          <li key={label} aria-current={n === current ? "step" : undefined} className="flex flex-col gap-2">
            <span className={cx("h-1.5 rounded-full", n <= current ? "bg-primary" : "bg-surface-2")} />
            <span className={cx("flex items-center gap-1 text-meta font-medium", n === current ? "text-text" : "text-muted")}>
              {done ? <Check aria-hidden size={14} className="text-positive" /> : null}
              {label}
            </span>
          </li>
        );
      })}
    </ol>
  );
}

export default async function OnboardingPage({ searchParams }: { searchParams: Promise<{ passo?: string }> }) {
  const user = await requireUser();
  const { passo } = await searchParams;
  const db = await getDb();
  const [accounts, txs] = await Promise.all([loadAccounts(db, user.id), loadTransactions(db, user.id)]);
  const step = passo === "3" ? 3 : passo === "2" ? 2 : 1;
  if (step > 1 && !accounts.length) redirect("/comecar");

  return (
    <div className="mx-auto max-w-2xl">
      <Stepper current={step} />

      {step === 1 && canAddAccountsManually(user) ? (
        <>
          <h1 className="text-2xl font-semibold tracking-tight">Olá, {user.name.split(" ")[0]}! Onde está o seu dinheiro?</h1>
          <p className="mb-5 mt-1 text-sm text-muted">Escolha seus bancos e carteiras digitais. Leva menos de um minuto.</p>
          <BankPicker existing={accounts.map((a) => a.institution)} />
        </>
      ) : null}

      {step === 1 && !canAddAccountsManually(user) ? (
        <>
          <h1 className="text-2xl font-semibold tracking-tight">Olá, {user.name.split(" ")[0]}! Conecte seu banco</h1>
          <p className="mb-5 mt-1 text-sm text-muted">Contas, cartões e transações chegam pela conexão. O Cruzado só lê os dados e nunca vê a senha do banco.</p>
          <ButtonLink href="/configuracoes?aba=integracoes#bancos">Conectar banco</ButtonLink>
        </>
      ) : null}

      {step === 2 ? (
        <>
          <h1 className="text-2xl font-semibold tracking-tight">Traga suas transações</h1>
          <p className="mb-5 mt-1 text-sm text-muted">Com o extrato, seus gastos aparecem organizados por categoria na hora.</p>
          <Card className="mb-4">
            <div className="flex gap-3">
              <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-primary-soft text-primary">
                <FileUp aria-hidden size={20} />
              </span>
              <div className="text-sm">
                <p className="font-medium">Como pegar o arquivo</p>
                <ol className="mt-1 list-decimal pl-4 text-muted">
                  <li>Abra o app ou o site do seu banco e vá em Extrato.</li>
                  <li>Procure a opção de exportar e escolha OFX. Se não houver, use CSV.</li>
                  <li>Envie o arquivo abaixo e confira a prévia antes de confirmar.</li>
                </ol>
                <p className="mt-2 text-meta text-muted">O arquivo é lido e descartado. O Cruzado não acessa seu banco nem pede a senha dele.</p>
              </div>
            </div>
          </Card>
          <ImportWizard accounts={accounts.map((a) => ({ id: a.id, name: a.name, type: a.type }))} />
          <div className="mt-4 flex justify-end">
            <ButtonLink href="/comecar?passo=3" variant="secondary">
              Concluir configuração
            </ButtonLink>
          </div>
        </>
      ) : null}

      {step === 3 ? (
        <Card className="flex flex-col items-center gap-3 py-10 text-center">
          <span className="flex size-14 items-center justify-center rounded-2xl bg-positive-soft text-positive">
            <PartyPopper aria-hidden size={28} />
          </span>
          <h1 className="text-2xl font-semibold tracking-tight">Tudo pronto</h1>
          <p className="max-w-md text-sm text-muted">
            {plural(accounts.length, "conta", "contas")} e {plural(txs.length, "transação", "transações")} no Cruzado. Sempre que quiser atualizar, importe um extrato novo: o que já existe não é duplicado.
          </p>
          <ButtonLink href="/inicio">Ver meu painel</ButtonLink>
          {!txs.length ? (
            <div className="mt-2 w-full max-w-md text-left">
              <Notice tone="info">Sem extrato, o painel fica vazio. Você pode lançar gastos à mão em Transações.</Notice>
            </div>
          ) : null}
        </Card>
      ) : null}
    </div>
  );
}
