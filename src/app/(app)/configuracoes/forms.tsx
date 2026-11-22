"use client";
import { useActionState, useId, useState } from "react";
import { useFormStatus } from "react-dom";
import { createCategoryAction, removeAccountAction, saveAccountAction } from "../../actions/finance";
import { createMcpTokenAction, deleteAccountAction } from "../../actions/settings";
import type { FormState } from "../../actions/auth";
import { plural } from "@/lib/text";
import { Button, Field, FormError, Input, Notice, Select } from "@/components/ui";
import { StepUpCode } from "./step-up";

function Submit({ children, variant = "primary" }: { children: React.ReactNode; variant?: "primary" | "danger" | "secondary" }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" variant={variant} disabled={pending} aria-busy={pending}>
      {pending ? "Aguarde…" : children}
    </Button>
  );
}

const inv = (s: FormState, k: string) => (s.fieldErrors?.[k] ? { "aria-invalid": true as const, "aria-describedby": `${k}-error` } : {});

export function AccountForm({ initial }: { initial?: { id: string; name: string; institution: string; type: string; opening: string; limit?: string; closingDay?: number; dueDay?: number } }) {
  const [state, action] = useActionState(saveAccountAction, {});
  const [type, setType] = useState(initial?.type ?? "checking");
  const id = useId();
  const e = (k: string) => state.fieldErrors?.[k];
  return (
    <form action={action} className="grid gap-4 sm:grid-cols-2" noValidate>
      {initial ? <input type="hidden" name="id" value={initial.id} /> : null}
      <Field label="Nome" htmlFor={`${id}-name`} error={e("name")}>
        <Input id={`${id}-name`} name="name" defaultValue={initial?.name} {...inv(state, "name")} />
      </Field>
      <Field label="Instituição" htmlFor={`${id}-inst`} error={e("institution")}>
        <Input id={`${id}-inst`} name="institution" defaultValue={initial?.institution} {...inv(state, "institution")} />
      </Field>
      <Field label="Tipo" htmlFor={`${id}-type`}>
        <Select id={`${id}-type`} name="type" value={type} onChange={(ev) => setType(ev.target.value)} disabled={Boolean(initial)}>
          <option value="checking">Conta corrente</option>
          <option value="savings">Poupança</option>
          <option value="credit_card">Cartão de crédito</option>
          <option value="cash">Dinheiro</option>
        </Select>
        {initial ? <input type="hidden" name="type" value={type} /> : null}
      </Field>
      {type !== "credit_card" ? (
        <Field label="Saldo inicial (R$)" htmlFor={`${id}-open`} error={e("openingBalance")} hint="Saldo antes da primeira transação registrada.">
          <Input id={`${id}-open`} name="openingBalance" inputMode="decimal" defaultValue={initial?.opening ?? "0,00"} {...inv(state, "openingBalance")} />
        </Field>
      ) : (
        <>
          <Field label="Limite (R$)" htmlFor={`${id}-limit`} error={e("limit")}>
            <Input id={`${id}-limit`} name="limit" inputMode="decimal" defaultValue={initial?.limit} {...inv(state, "limit")} />
          </Field>
          <Field label="Dia de fechamento" htmlFor={`${id}-close`} error={e("closingDay")}>
            <Input id={`${id}-close`} name="closingDay" type="number" min={1} max={31} defaultValue={initial?.closingDay} {...inv(state, "closingDay")} />
          </Field>
          <Field label="Dia de vencimento" htmlFor={`${id}-due`} error={e("dueDay")}>
            <Input id={`${id}-due`} name="dueDay" type="number" min={1} max={31} defaultValue={initial?.dueDay} {...inv(state, "dueDay")} />
          </Field>
        </>
      )}
      <div className="flex flex-col gap-2 sm:col-span-2">
        <FormError message={state.error} />
        {state.ok ? <Notice tone="positive">{state.message}</Notice> : null}
        <div>
          <Submit>{initial ? "Salvar conta" : "Adicionar conta"}</Submit>
        </div>
      </div>
    </form>
  );
}

export function RemoveAccountForm({ accountId, name, transactions, askPassword, askCode }: { accountId: string; name: string; transactions: number; askPassword: boolean; askCode: boolean }) {
  const [state, action] = useActionState(removeAccountAction, {});
  const id = useId();
  return (
    <details className="mt-3 rounded-xl border border-border px-3">
      <summary className="flex min-h-11 cursor-pointer items-center text-sm font-medium">Remover esta conta</summary>
      <form action={action} className="flex flex-col gap-3 pb-3" noValidate autoComplete="off">
        <input type="hidden" name="id" value={accountId} />
        <p className="text-sm text-muted">Apaga {name} e {plural(transactions, "transação", "transações")} do Cruzado. Nada muda no banco. Não dá para desfazer.</p>
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
        <div>
          <Submit variant="danger">Remover conta</Submit>
        </div>
      </form>
    </details>
  );
}

export function CategoryForm() {
  const [state, action] = useActionState(createCategoryAction, {});
  return (
    <form action={action} className="flex flex-wrap items-end gap-3" noValidate>
      <div className="min-w-48 flex-1">
        <Field label="Nova categoria" htmlFor="cat-name" error={state.fieldErrors?.name}>
          <Input id="cat-name" name="name" {...inv(state, "name")} />
        </Field>
      </div>
      <div>
        <Field label="Tipo" htmlFor="cat-kind">
          <Select id="cat-kind" name="kind" defaultValue="expense">
            <option value="expense">Despesa</option>
            <option value="income">Receita</option>
            <option value="transfer">Transferência</option>
          </Select>
        </Field>
      </div>
      <Submit>Criar</Submit>
      {state.ok ? <p className="w-full text-sm text-positive">{state.message}</p> : null}
    </form>
  );
}

export function McpTokenForm({ baseUrl, askPassword, askCode }: { baseUrl: string; askPassword: boolean; askCode: boolean }) {
  const [state, action] = useActionState(createMcpTokenAction, {});
  return (
    <div className="flex flex-col gap-3">
      <FormError message={state.error} />
      <form action={action} className="flex flex-wrap items-end gap-3">
        <div className="min-w-48 flex-1">
          <Field label="Nome do cliente" htmlFor="mcp-name">
            <Input id="mcp-name" name="name" placeholder="Claude Code no notebook" />
          </Field>
        </div>
        <div className="min-w-48 flex-1">
          <Field label="Permissão" htmlFor="mcp-scope">
            <Select id="mcp-scope" name="scope" defaultValue="read">
              <option value="read">Consultar (somente leitura)</option>
              <option value="capture">Lançar (WhatsApp, sem ver dados)</option>
            </Select>
          </Field>
        </div>
        {askPassword ? (
          <div className="min-w-48 flex-1">
            <Field label="Sua senha" htmlFor="mcp-pw" error={state.fieldErrors?.password}>
              <Input id="mcp-pw" name="password" type="password" autoComplete="current-password" {...inv(state, "password")} />
            </Field>
          </div>
        ) : null}
        {askCode ? (
          <div className="min-w-48 flex-1">
            <StepUpCode id="mcp-code" />
          </div>
        ) : null}
        <Submit variant="secondary">Gerar token</Submit>
      </form>
      {state.ok && state.message ? (
        <Notice tone="attention" title="Copie agora: o token não será mostrado de novo">
          <code className="block break-all rounded bg-surface p-2 font-mono text-meta">{state.message}</code>
          <p className="mt-2 text-meta">
            Guarde em uma variável de ambiente (por exemplo <code>CRUZADO_MCP_TOKEN</code>) e aponte o cliente para <code>{baseUrl}/api/mcp</code>. Veja docs/MCP.md.
          </p>
        </Notice>
      ) : null}
    </div>
  );
}

export function DeleteAccountForm({ askPassword, askCode }: { askPassword: boolean; askCode: boolean }) {
  const [state, action] = useActionState(deleteAccountAction, {});
  return (
    <form action={action} className="flex flex-col gap-3" noValidate>
      <FormError message={state.error} />
      <Field label="Digite EXCLUIR para confirmar" htmlFor="confirm-delete" error={state.fieldErrors?.confirm}>
        <Input id="confirm-delete" name="confirm" autoComplete="off" defaultValue={state.values?.confirm} {...inv(state, "confirm")} />
      </Field>
      {askPassword ? (
        <Field label="Sua senha" htmlFor="delete-pw" error={state.fieldErrors?.password}>
          <Input id="delete-pw" name="password" type="password" autoComplete="current-password" {...inv(state, "password")} />
        </Field>
      ) : null}
      <StepUpCode id="delete-code" show={askCode} />
      <div>
        <Submit variant="danger">Excluir minha conta e todos os dados</Submit>
      </div>
    </form>
  );
}
