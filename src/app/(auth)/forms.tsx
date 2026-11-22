"use client";
import Link from "next/link";
import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { demoAction, loginAction, signupAction, type FormState } from "../actions/auth";
import { Button, Field, FormError, Input } from "@/components/ui";

function Submit({ children, variant = "primary" }: { children: React.ReactNode; variant?: "primary" | "secondary" }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" variant={variant} disabled={pending} aria-busy={pending} className="w-full">
      {pending ? "Aguarde…" : children}
    </Button>
  );
}

const err = (s: FormState, k: string) => s.fieldErrors?.[k];
const aria = (s: FormState, k: string) => (err(s, k) ? { "aria-invalid": true, "aria-describedby": `${k}-error` } : {});

export function DemoButton() {
  return (
    <form action={demoAction}>
      <Submit variant="secondary">Entrar no modo demonstração</Submit>
    </form>
  );
}

export function LoginForm({ canSignup }: { canSignup: boolean }) {
  const [state, action] = useActionState(loginAction, {});
  return (
    <form action={action} className="flex flex-col gap-4" noValidate>
      <FormError message={state.error} />
      <Field label="E-mail" htmlFor="email" error={err(state, "email")}>
        <Input id="email" name="email" type="email" autoComplete="email" spellCheck={false} required defaultValue={state.values?.email} {...aria(state, "email")} />
      </Field>
      <Field label="Senha" htmlFor="password" error={err(state, "password")}>
        <Input id="password" name="password" type="password" autoComplete="current-password" required {...aria(state, "password")} />
      </Field>
      <Field label="Código de verificação" htmlFor="code" hint="Só se você ativou a verificação em duas etapas.">
        <Input id="code" name="code" inputMode="numeric" autoComplete="one-time-code" spellCheck={false} maxLength={6} />
      </Field>
      <Submit>Entrar</Submit>
      {canSignup ? (
        <p className="text-sm text-muted">
          Não tem conta?{" "}
          <Link href="/cadastro" className="font-medium text-primary underline underline-offset-2">
            Criar conta
          </Link>
        </p>
      ) : null}
    </form>
  );
}

export function SignupForm() {
  const [state, action] = useActionState(signupAction, {});
  return (
    <form action={action} className="flex flex-col gap-4" noValidate>
      <FormError message={state.error} />
      <Field label="Nome" htmlFor="name" error={err(state, "name")}>
        <Input id="name" name="name" autoComplete="name" required defaultValue={state.values?.name} {...aria(state, "name")} />
      </Field>
      <Field label="E-mail" htmlFor="email" error={err(state, "email")}>
        <Input id="email" name="email" type="email" autoComplete="email" spellCheck={false} required defaultValue={state.values?.email} {...aria(state, "email")} />
      </Field>
      <Field label="Senha" htmlFor="password" error={err(state, "password")} hint="Mínimo de 10 caracteres.">
        <Input id="password" name="password" type="password" autoComplete="new-password" required minLength={10} aria-describedby={err(state, "password") ? "password-error" : "password-hint"} aria-invalid={Boolean(err(state, "password"))} />
      </Field>
      <div className="flex flex-col gap-1">
        <label className="flex min-h-11 items-start gap-3 text-sm">
          <input type="checkbox" name="terms" defaultChecked={state.values?.terms === "on"} className="mt-1 size-5 shrink-0 accent-[var(--primary)]" aria-describedby={err(state, "terms") ? "terms-error" : undefined} />
          <span>
            Li o rascunho dos <a className="text-primary underline" href="/termos">termos</a> e da <a className="text-primary underline" href="/privacidade">política de privacidade</a>.
          </span>
        </label>
        {err(state, "terms") ? (
          <p id="terms-error" role="alert" className="text-sm text-risk">
            {err(state, "terms")}
          </p>
        ) : null}
      </div>
      <Submit>Criar conta</Submit>
      <p className="text-sm text-muted">
        Já tem conta?{" "}
        <Link href="/entrar" className="font-medium text-primary underline underline-offset-2">
          Entrar
        </Link>
      </p>
    </form>
  );
}
