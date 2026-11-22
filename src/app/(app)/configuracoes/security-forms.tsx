"use client";
import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { changePasswordAction, confirmTotpAction, disableTotpAction, startTotpAction } from "../../actions/security";
import { Button, Field, FormError, Input, Notice } from "@/components/ui";
import { StepUpCode } from "./step-up";

function Submit({ children, variant = "primary" }: { children: React.ReactNode; variant?: "primary" | "danger" | "secondary" }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" variant={variant} disabled={pending} aria-busy={pending}>
      {pending ? "Aguarde…" : children}
    </Button>
  );
}

export function ChangePasswordForm({ askCode }: { askCode: boolean }) {
  const [state, action] = useActionState(changePasswordAction, {});
  return (
    <form action={action} className="flex flex-col gap-3" noValidate>
      <Field label="Senha atual" htmlFor="pw-current" error={state.fieldErrors?.password}>
        <Input id="pw-current" name="password" type="password" autoComplete="current-password" />
      </Field>
      <Field label="Nova senha" htmlFor="pw-new" error={state.fieldErrors?.newPassword} hint="Mínimo de 10 caracteres.">
        <Input id="pw-new" name="newPassword" type="password" autoComplete="new-password" />
      </Field>
      <StepUpCode id="pw-code" show={askCode} />
      {state.ok ? <Notice tone="positive">{state.message}</Notice> : null}
      <div>
        <Submit variant="secondary">Trocar senha</Submit>
      </div>
    </form>
  );
}

function ConfirmTotp() {
  const [state, action] = useActionState(confirmTotpAction, {});
  if (state.ok) return <Notice tone="positive">{state.message}</Notice>;
  return (
    <form action={action} className="flex flex-col gap-3" noValidate>
      <FormError message={state.error} />
      <Field label="Código de 6 dígitos do aplicativo" htmlFor="totp-confirm" error={state.fieldErrors?.code}>
        <Input id="totp-confirm" name="code" inputMode="numeric" autoComplete="one-time-code" maxLength={6} />
      </Field>
      <div>
        <Submit>Ativar</Submit>
      </div>
    </form>
  );
}

export function EnableTotpForm() {
  const [state, action] = useActionState(startTotpAction, {});
  if (state.ok && state.message) {
    return (
      <div className="flex flex-col gap-3">
        <Notice tone="attention" title="Adicione esta chave ao seu aplicativo autenticador">
          <code data-testid="totp-key" className="block break-all rounded bg-surface p-2 font-mono text-meta">{state.message}</code>
          <p className="mt-2 text-meta">
            Google Authenticator, Authy, 1Password e similares: escolha inserir a chave manualmente, ou <a className="underline" href={state.values?.url}>abra aqui no celular</a>. A chave não será mostrada de novo.
          </p>
        </Notice>
        <ConfirmTotp />
      </div>
    );
  }
  return (
    <form action={action} className="flex flex-col gap-3" noValidate>
      <FormError message={state.error} />
      <Field label="Sua senha" htmlFor="totp-pw" error={state.fieldErrors?.password}>
        <Input id="totp-pw" name="password" type="password" autoComplete="current-password" />
      </Field>
      <div>
        <Submit>Configurar verificação em duas etapas</Submit>
      </div>
    </form>
  );
}

export function DisableTotpForm() {
  const [state, action] = useActionState(disableTotpAction, {});
  return (
    <form action={action} className="flex flex-col gap-3" noValidate>
      <Field label="Sua senha" htmlFor="totp-off-pw" error={state.fieldErrors?.password}>
        <Input id="totp-off-pw" name="password" type="password" autoComplete="current-password" />
      </Field>
      <Field label="Código de 6 dígitos" htmlFor="totp-off-code" error={state.fieldErrors?.code}>
        <Input id="totp-off-code" name="code" inputMode="numeric" autoComplete="one-time-code" maxLength={6} />
      </Field>
      {state.ok ? <Notice tone="positive">{state.message}</Notice> : null}
      <div>
        <Submit variant="danger">Desativar</Submit>
      </div>
    </form>
  );
}
