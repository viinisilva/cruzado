"use client";
import { useRouter } from "next/navigation";
import { useActionState, useEffect, useId, useRef, useState } from "react";
import { useFormStatus } from "react-dom";
import { connectBankAction, deleteBankHistoryAction, disconnectBankAction, finishBankConnectAction, startBankConnectAction, syncBankAction, type ConnectSession } from "../../actions/banks";
import { ConfirmSubmit } from "@/components/client";
import { Button, Field, FormError, Input, Notice } from "@/components/ui";
import { StepUpCode } from "./step-up";

function Submit({ children, variant = "primary", size }: { children: React.ReactNode; variant?: "primary" | "danger" | "secondary"; size?: "sm" }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" variant={variant} size={size} disabled={pending} aria-busy={pending}>
      {pending ? "Aguarde…" : children}
    </Button>
  );
}

/** Personal mode: Meu Pluggy has no widget of ours, so the item is authorized there and pasted here. */
export function ConnectBankForm() {
  const [state, action] = useActionState(connectBankAction, {});
  const id = useId();
  return (
    <form action={action} className="grid gap-4 sm:grid-cols-2" noValidate autoComplete="off">
      <Field label="Item ID" htmlFor={`${id}-item`} error={state.fieldErrors?.itemId} hint="No painel do Pluggy, em Applications › Demo › Connected Items.">
        <Input id={`${id}-item`} name="itemId" spellCheck={false} />
      </Field>
      <Field label="Sua senha do Cruzado" htmlFor={`${id}-pw`} error={state.fieldErrors?.password} hint="Nunca a senha do banco.">
        <Input id={`${id}-pw`} name="password" type="password" autoComplete="current-password" />
      </Field>
      <StepUpCode id={`${id}-code`} />
      <div className="flex flex-col gap-2 sm:col-span-2">
        <FormError message={state.error} />
        {state.ok ? <Notice tone="positive">{state.message}</Notice> : null}
        <div>
          <Submit>Conectar banco</Submit>
        </div>
      </div>
    </form>
  );
}

type WidgetResult = { item?: { id?: string; executionStatus?: string | null } };

/** The official widget handles consent and bank login inside its own frame. No bank credential ever passes through here. */
function useBankWidget(session: ConnectSession) {
  const [message, setMessage] = useState<{ tone: "positive" | "attention"; text: string }>();
  const router = useRouter();
  const opened = useRef<string | undefined>(undefined);
  useEffect(() => {
    const { attemptId, accessToken } = session;
    if (!attemptId || !accessToken || opened.current === attemptId) return;
    opened.current = attemptId;
    void (async () => {
      const { PluggyConnect } = await import("pluggy-connect-sdk");
      const widget = new PluggyConnect({
        connectToken: accessToken,
        language: "pt",
        ...(session.includeSandbox ? { includeSandbox: true } : {}),
        ...(session.connectorIds ? { connectorIds: session.connectorIds } : {}),
        ...(session.updateItem ? { updateItem: session.updateItem } : {}),
        onSuccess: async ({ item }: WidgetResult) => {
          setMessage({ tone: "positive", text: "Autorizado. Buscando seus dados…" });
          const r = await finishBankConnectAction(attemptId, item?.id);
          setMessage(r.error ? { tone: "attention", text: r.error } : { tone: "positive", text: r.message ?? "Banco conectado." });
          router.refresh();
        },
        onError: ({ data }: { data?: WidgetResult }) => {
          const pending = data?.item?.executionStatus === "USER_AUTHORIZATION_PENDING";
          setMessage({ tone: "attention", text: pending ? "O banco ainda está confirmando. A conexão aparece aqui quando terminar, mesmo que você feche esta página." : "A autorização não foi concluída. Nada foi conectado; tente de novo." });
        },
      } as ConstructorParameters<typeof PluggyConnect>[0]);
      await widget.init();
    })().catch(() => setMessage({ tone: "attention", text: "Não foi possível abrir a autorização do banco. Tente de novo." }));
  }, [session, router]);
  return message;
}

export function ConnectWidgetForm({ connectionId, label = "Conectar banco" }: { connectionId?: string; label?: string }) {
  const [session, action] = useActionState(startBankConnectAction, {});
  const message = useBankWidget(session);
  const id = useId();
  return (
    <form action={action} className="flex flex-col gap-3" noValidate autoComplete="off">
      {connectionId ? <input type="hidden" name="connectionId" value={connectionId} /> : null}
      <Field label="Sua senha do Cruzado" htmlFor={`${id}-pw`} error={session.fieldErrors?.password} hint="Nunca a senha do banco. A autorização acontece no ambiente do banco.">
        <Input id={`${id}-pw`} name="password" type="password" autoComplete="current-password" />
      </Field>
      <StepUpCode id={`${id}-code`} />
      <FormError message={session.error} />
      <div aria-live="polite">{message ? <Notice tone={message.tone}>{message.text}</Notice> : null}</div>
      <div>
        <Submit>{label}</Submit>
      </div>
    </form>
  );
}

export function BankActions({ connectionId, widget, attention }: { connectionId: string; widget: boolean; attention: boolean }) {
  const [syncState, syncAction] = useActionState(syncBankAction, {});
  const [dropState, dropAction] = useActionState(disconnectBankAction, {});
  return (
    <div className="mt-2 flex flex-col gap-2">
      <div className="flex flex-wrap gap-2">
        <form action={syncAction}>
          <input type="hidden" name="id" value={connectionId} />
          <Submit variant="secondary" size="sm">Atualizar agora</Submit>
        </form>
        <form action={dropAction}>
          <input type="hidden" name="id" value={connectionId} />
          <ConfirmSubmit size="sm" confirmLabel="Sim, desconectar">Desconectar</ConfirmSubmit>
        </form>
      </div>
      <p className="text-meta text-muted">Desconectar interrompe novas atualizações. O histórico já importado continua aqui.</p>
      <FormError message={syncState.error ?? dropState.error} />
      {syncState.ok ? <Notice tone="positive">{syncState.message}</Notice> : null}
      {dropState.ok ? <Notice tone="positive">{dropState.message}</Notice> : null}
      {attention && widget ? (
        <details className="rounded-xl border border-border px-3">
          <summary className="flex min-h-11 cursor-pointer items-center text-sm font-medium">Reautorizar</summary>
          <div className="pb-3">
            <ConnectWidgetForm connectionId={connectionId} label="Reautorizar banco" />
          </div>
        </details>
      ) : null}
    </div>
  );
}

export function DeleteHistoryForm({ connectionId, askPassword, askCode }: { connectionId: string; askPassword: boolean; askCode: boolean }) {
  const [state, action] = useActionState(deleteBankHistoryAction, {});
  const id = useId();
  return (
    <details className="mt-2 rounded-xl border border-border px-3">
      <summary className="flex min-h-11 cursor-pointer items-center text-sm font-medium">Excluir histórico deste banco</summary>
      <form action={action} className="flex flex-col gap-3 pb-3" noValidate autoComplete="off">
        <input type="hidden" name="id" value={connectionId} />
        <p className="text-sm text-muted">Apaga do Cruzado os lançamentos vindos deste banco. O que você adicionou à mão ou importou de arquivo continua. Não dá para desfazer.</p>
        <Field label="Digite EXCLUIR para confirmar" htmlFor={`${id}-c`} error={state.fieldErrors?.confirm}>
          <Input id={`${id}-c`} name="confirm" autoComplete="off" />
        </Field>
        {askPassword ? (
          <Field label="Sua senha do Cruzado" htmlFor={`${id}-p`} error={state.fieldErrors?.password}>
            <Input id={`${id}-p`} name="password" type="password" autoComplete="current-password" />
          </Field>
        ) : null}
        <StepUpCode id={`${id}-k`} show={askCode} />
        <FormError message={state.error} />
        {state.ok ? <Notice tone="positive">{state.message}</Notice> : null}
        <div>
          <Submit variant="danger" size="sm">Excluir histórico</Submit>
        </div>
      </form>
    </details>
  );
}
