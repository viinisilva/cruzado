"use client";
import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { confirmLinkAction, createLinkCodeAction, updateLinkSettingsAction } from "../../actions/whatsapp";
import { Button, Field, FormError, Input, Notice, Select } from "@/components/ui";
import { StepUpCode } from "./step-up";

type Account = { id: string; name: string; type: string };

function Submit({ children, variant = "primary" }: { children: React.ReactNode; variant?: "primary" | "secondary" }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" variant={variant} disabled={pending} aria-busy={pending}>
      {pending ? "Aguarde…" : children}
    </Button>
  );
}

export function LinkCodeForm({ displayNumber }: { displayNumber?: string }) {
  const [state, action] = useActionState(createLinkCodeAction, {});
  const code = state.ok ? state.message : undefined;
  return (
    <div className="flex flex-col gap-3">
      <FormError message={state.error} />
      {code ? (
        <Notice tone="attention" title="Envie este código pelo WhatsApp">
          <code data-testid="wa-code" className="block break-all rounded bg-surface p-2 font-mono text-sm">{code}</code>
          <p className="mt-2 text-meta">Vale por 10 minutos e funciona uma vez.</p>
          {displayNumber ? (
            <a className="mt-2 inline-flex min-h-11 items-center font-medium underline" href={`https://wa.me/${displayNumber}?text=${encodeURIComponent(code)}`}>
              Abrir conversa no WhatsApp
            </a>
          ) : null}
        </Notice>
      ) : null}
      <form action={action}>
        <Submit variant={code ? "secondary" : "primary"}>{code ? "Gerar outro código" : "Gerar código"}</Submit>
      </form>
    </div>
  );
}

function SettingsFields({ accounts, accountId, mode }: { accounts: Account[]; accountId?: string | null; mode: string }) {
  const usable = accounts.filter((a) => a.type !== "credit_card" && a.type !== "cash");
  return (
    <>
      <Field label="Conta padrão para Pix e débito" htmlFor="wa-account">
        <Select id="wa-account" name="accountId" defaultValue={accountId ?? usable[0]?.id ?? ""}>
          {usable.map((a) => (
            <option key={a.id} value={a.id}>{a.name}</option>
          ))}
        </Select>
      </Field>
      <fieldset>
        <legend className="mb-1.5 text-sm font-medium">Modo de registro</legend>
        <div className="flex flex-col gap-2">
          <label className="flex min-h-11 items-center gap-2 text-sm">
            <input type="radio" name="mode" value="auto" defaultChecked={mode === "auto"} className="size-4 shrink-0 accent-[var(--primary)]" />
            Registrar automaticamente mensagens completas
          </label>
          <label className="flex min-h-11 items-center gap-2 text-sm">
            <input type="radio" name="mode" value="review" defaultChecked={mode === "review"} className="size-4 shrink-0 accent-[var(--primary)]" />
            Sempre revisar antes
          </label>
        </div>
      </fieldset>
    </>
  );
}

export function ConfirmLinkForm({ accounts, phone, askPassword, askCode }: { accounts: Account[]; phone: string; askPassword: boolean; askCode: boolean }) {
  const [state, action] = useActionState(confirmLinkAction, {});
  return (
    <form action={action} className="flex flex-col gap-3" noValidate>
      <Notice tone="attention" title={`Este número é seu? ${phone}`}>Só confirme se foi você quem enviou o código.</Notice>
      <SettingsFields accounts={accounts} mode="auto" />
      {askPassword ? (
        <Field label="Sua senha" htmlFor="wa-pw" error={state.fieldErrors?.password}>
          <Input id="wa-pw" name="password" type="password" autoComplete="current-password" />
        </Field>
      ) : null}
      <StepUpCode id="wa-code" show={askCode} />
      <FormError message={state.error} />
      <div>
        <Submit>Confirmar número</Submit>
      </div>
    </form>
  );
}

export function LinkSettingsForm({ accounts, accountId, mode }: { accounts: Account[]; accountId: string | null; mode: string }) {
  const [state, action] = useActionState(updateLinkSettingsAction, {});
  return (
    <form action={action} className="flex flex-col gap-3" noValidate>
      <SettingsFields accounts={accounts} accountId={accountId} mode={mode} />
      <FormError message={state.error} />
      {state.ok ? <Notice tone="positive">{state.message}</Notice> : null}
      <div>
        <Submit variant="secondary">Salvar preferências</Submit>
      </div>
    </form>
  );
}
