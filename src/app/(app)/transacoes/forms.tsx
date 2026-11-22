"use client";
import { useActionState, useEffect, useRef } from "react";
import { useFormStatus } from "react-dom";
import { createTransactionAction, updateTransactionAction } from "../../actions/finance";
import type { FormState } from "../../actions/auth";
import { Button, Field, FormError, Input, Notice, Select, Textarea } from "@/components/ui";

type Opt = { id: string; name: string };

function Submit({ children }: { children: React.ReactNode }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending} aria-busy={pending}>
      {pending ? "Salvando…" : children}
    </Button>
  );
}

const err = (s: FormState, k: string) => s.fieldErrors?.[k];
const a = (s: FormState, k: string) => (err(s, k) ? { "aria-invalid": true as const, "aria-describedby": `${k}-error` } : {});

export function NewTransactionForm({ accounts, categories, today }: { accounts: Opt[]; categories: (Opt & { kind: string })[]; today: string }) {
  const [state, action] = useActionState(createTransactionAction, {});
  const ref = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (state.ok) ref.current?.reset();
  }, [state]);
  return (
    <form ref={ref} action={action} className="grid gap-4 sm:grid-cols-2" noValidate>
      <div className="sm:col-span-2">
        <FormError message={state.error} />
        {state.ok ? <Notice tone="positive">{state.message}</Notice> : null}
      </div>
      <fieldset className="sm:col-span-2">
        <legend className="mb-1.5 text-sm font-medium">Tipo</legend>
        <div className="flex gap-2">
          {[
            ["expense", "Despesa"],
            ["income", "Receita"],
          ].map(([v, l]) => (
            <label key={v} className="flex min-h-11 items-center gap-2 rounded-lg border border-border px-3 text-sm">
              <input type="radio" name="direction" value={v} defaultChecked={v === "expense"} className="size-4 accent-[var(--primary)]" />
              {l}
            </label>
          ))}
        </div>
      </fieldset>
      <Field label="Descrição" htmlFor="description" error={err(state, "description")}>
        <Input id="description" name="description" required {...a(state, "description")} />
      </Field>
      <Field label="Valor (R$)" htmlFor="amount" error={err(state, "amount")} hint="Ex.: 123,45">
        <Input id="amount" name="amount" inputMode="decimal" required {...a(state, "amount")} />
      </Field>
      <Field label="Data" htmlFor="date" error={err(state, "date")}>
        <Input id="date" name="date" type="date" defaultValue={today} required {...a(state, "date")} />
      </Field>
      <Field label="Conta" htmlFor="accountId" error={err(state, "accountId")}>
        <Select id="accountId" name="accountId" required {...a(state, "accountId")}>
          {accounts.map((o) => (
            <option key={o.id} value={o.id}>
              {o.name}
            </option>
          ))}
        </Select>
      </Field>
      <Field label="Categoria" htmlFor="categoryId">
        <Select id="categoryId" name="categoryId" defaultValue="">
          <option value="">Sem categoria</option>
          {categories.map((o) => (
            <option key={o.id} value={o.id}>
              {o.name}
            </option>
          ))}
        </Select>
      </Field>
      <Field label="Observação (opcional)" htmlFor="notes">
        <Input id="notes" name="notes" maxLength={500} />
      </Field>
      <div className="sm:col-span-2">
        <Submit>Adicionar transação</Submit>
      </div>
    </form>
  );
}

export function EditTransactionForm({ tx, categories }: { tx: { id: string; description: string; categoryId: string | null; notes: string | null }; categories: Opt[] }) {
  const [state, action] = useActionState(updateTransactionAction, {});
  return (
    <form action={action} className="flex flex-col gap-4" noValidate>
      <input type="hidden" name="id" value={tx.id} />
      <FormError message={state.error} />
      {state.ok ? <Notice tone="positive">{state.message}</Notice> : null}
      <Field label="Descrição" htmlFor="description" error={err(state, "description")}>
        <Input id="description" name="description" defaultValue={tx.description} required {...a(state, "description")} />
      </Field>
      <Field label="Categoria" htmlFor="categoryId">
        <Select id="categoryId" name="categoryId" defaultValue={tx.categoryId ?? ""}>
          <option value="">Sem categoria</option>
          {categories.map((o) => (
            <option key={o.id} value={o.id}>
              {o.name}
            </option>
          ))}
        </Select>
      </Field>
      <Field label="Observação" htmlFor="notes">
        <Textarea id="notes" name="notes" defaultValue={tx.notes ?? ""} rows={3} maxLength={500} />
      </Field>
      <div>
        <Submit>Salvar alterações</Submit>
      </div>
    </form>
  );
}
