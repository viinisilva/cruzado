"use client";
import { useActionState, useId, useState } from "react";
import { useFormStatus } from "react-dom";
import { createAgentAction, draftAgentFromTextAction, updateAgentAction } from "../../actions/agents";
import type { FormState } from "../../actions/auth";
import { Button, Field, FormError, Input, Notice, Select, Textarea } from "@/components/ui";

type Opt = { id: string; name: string };
type Kind = "daily_spend_limit" | "weekly_summary" | "possible_duplicate" | "monthly_comparison";

const KINDS: { v: Kind; label: string }[] = [
  { v: "daily_spend_limit", label: "Limite diário de gastos" },
  { v: "weekly_summary", label: "Resumo semanal" },
  { v: "possible_duplicate", label: "Possível cobrança duplicada" },
  { v: "monthly_comparison", label: "Comparação mensal" },
];

const SCHEDULES = [
  { v: "", label: "Padrão do tipo de agente" },
  { v: "continuous", label: "A cada novo lançamento ou importação" },
  { v: "daily", label: "Uma vez por dia" },
  { v: "weekly_monday", label: "Toda segunda-feira, 8h" },
  { v: "monthly_first", label: "Todo dia 1º, 8h" },
];

function Submit({ children }: { children: React.ReactNode }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending} aria-busy={pending}>
      {pending ? "Processando…" : children}
    </Button>
  );
}

export function NaturalLanguageAgentForm() {
  const [state, action] = useActionState(draftAgentFromTextAction, {});
  return (
    <form action={action} className="flex flex-col gap-3" noValidate>
      <Field label="Descreva o agente" htmlFor="nl-text" error={state.fieldErrors?.text} hint="Ex.: “me avise quando eu gastar mais de 200 reais por dia com mercado”">
        <Textarea id="nl-text" name="text" rows={2} maxLength={500} aria-invalid={Boolean(state.fieldErrors?.text)} />
      </Field>
      <FormError message={state.error} />
      {state.ok ? <Notice tone="positive">{state.message}</Notice> : null}
      <div>
        <Submit>Gerar rascunho</Submit>
      </div>
    </form>
  );
}

type Initial = { id?: string; name?: string; kind?: Kind; threshold?: string; schedule?: string; categoryIds?: string[]; accountIds?: string[] };

export function AgentRuleForm({ categories, accounts, initial }: { categories: Opt[]; accounts: Opt[]; initial?: Initial }) {
  const [state, action] = useActionState(initial?.id ? updateAgentAction : createAgentAction, {} as FormState);
  const [kind, setKind] = useState<Kind>(initial?.kind ?? "daily_spend_limit");
  const id = useId();
  const e = (k: string) => state.fieldErrors?.[k];
  return (
    <form action={action} className="grid gap-4 sm:grid-cols-2" noValidate>
      {initial?.id ? <input type="hidden" name="id" value={initial.id} /> : null}
      <Field label="Nome" htmlFor={`${id}-name`} error={e("name")}>
        <Input id={`${id}-name`} name="name" defaultValue={initial?.name} required aria-invalid={Boolean(e("name"))} />
      </Field>
      <Field label="Tipo" htmlFor={`${id}-kind`}>
        {initial?.id ? (
          <>
            <input type="hidden" name="kind" value={kind} />
            <Input id={`${id}-kind`} value={KINDS.find((k) => k.v === kind)?.label} readOnly aria-readonly />
          </>
        ) : (
          <Select id={`${id}-kind`} name="kind" value={kind} onChange={(ev) => setKind(ev.target.value as Kind)}>
            {KINDS.map((k) => (
              <option key={k.v} value={k.v}>
                {k.label}
              </option>
            ))}
          </Select>
        )}
      </Field>
      {kind === "daily_spend_limit" ? (
        <Field label="Limite por dia (R$)" htmlFor={`${id}-threshold`} error={e("threshold")}>
          <Input id={`${id}-threshold`} name="threshold" inputMode="decimal" defaultValue={initial?.threshold} placeholder="200,00" aria-invalid={Boolean(e("threshold"))} />
        </Field>
      ) : null}
      <Field label="Frequência" htmlFor={`${id}-schedule`}>
        <Select id={`${id}-schedule`} name="schedule" defaultValue={initial?.schedule ?? ""}>
          {SCHEDULES.map((s) => (
            <option key={s.v} value={s.v}>
              {s.label}
            </option>
          ))}
        </Select>
      </Field>
      <fieldset className="sm:col-span-2">
        <legend className="mb-1.5 text-sm font-medium">Categorias (vazio = todas)</legend>
        <div className="flex flex-wrap gap-2">
          {categories.map((c) => (
            <label key={c.id} className="flex min-h-11 items-center gap-2 rounded-lg border border-border px-3 text-sm">
              <input type="checkbox" name="categoryIds" value={c.id} defaultChecked={initial?.categoryIds?.includes(c.id)} className="size-4 accent-[var(--primary)]" />
              {c.name}
            </label>
          ))}
        </div>
      </fieldset>
      <fieldset className="sm:col-span-2">
        <legend className="mb-1.5 text-sm font-medium">Contas (vazio = todas)</legend>
        <div className="flex flex-wrap gap-2">
          {accounts.map((a) => (
            <label key={a.id} className="flex min-h-11 items-center gap-2 rounded-lg border border-border px-3 text-sm">
              <input type="checkbox" name="accountIds" value={a.id} defaultChecked={initial?.accountIds?.includes(a.id)} className="size-4 accent-[var(--primary)]" />
              {a.name}
            </label>
          ))}
        </div>
      </fieldset>
      <div className="flex flex-col gap-2 sm:col-span-2">
        <FormError message={state.error} />
        {state.ok ? <Notice tone="positive">{state.message}</Notice> : null}
        <div>
          <Submit>{initial?.id ? "Salvar alterações" : "Criar rascunho"}</Submit>
        </div>
      </div>
    </form>
  );
}
