"use client";
import { useActionState, useId, useState } from "react";
import { useFormStatus } from "react-dom";
import { Check, CreditCard, Landmark, Plus } from "lucide-react";
import { quickSetupAction } from "../../actions/finance";
import { BANKS, initials } from "@/lib/banks";
import { Button, ButtonLink, Card, Field, FormError, Input, cx } from "@/components/ui";

type Pick = { bank: string; checking: boolean; card: boolean; balance: string; limit: string; dueDay: string };

const newPick = (bank: string): Pick => ({ bank, checking: true, card: true, balance: "", limit: "", dueDay: "" });

function Continue({ disabled }: { disabled: boolean }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={disabled || pending} aria-busy={pending}>
      {pending ? "Criando…" : "Criar minhas contas"}
    </Button>
  );
}

function Toggle({ on, onClick, icon, label }: { on: boolean; onClick: () => void; icon: React.ReactNode; label: string }) {
  return (
    <button
      type="button"
      aria-pressed={on}
      onClick={onClick}
      className={cx("inline-flex min-h-11 items-center gap-2 rounded-lg border px-3 text-sm font-medium transition-colors", on ? "border-primary bg-primary-soft text-primary" : "border-border text-muted hover:bg-surface-2")}
    >
      {icon} {label}
    </button>
  );
}

export function BankPicker({ existing }: { existing: string[] }) {
  const [state, action] = useActionState(quickSetupAction, {});
  const [picks, setPicks] = useState<Pick[]>([]);
  const [other, setOther] = useState("");
  const id = useId();

  const selected = (bank: string) => picks.some((p) => p.bank === bank);
  const toggle = (bank: string) => setPicks((all) => (selected(bank) ? all.filter((p) => p.bank !== bank) : [...all, newPick(bank)]));
  const update = (bank: string, patch: Partial<Pick>) => setPicks((all) => all.map((p) => (p.bank === bank ? { ...p, ...patch } : p)));
  const addOther = () => {
    const bank = other.trim();
    if (bank.length >= 2 && !selected(bank)) setPicks((all) => [...all, newPick(bank)]);
    setOther("");
  };

  const payload = JSON.stringify(
    picks.map((p) => ({
      bank: p.bank,
      checking: p.checking,
      card: p.card,
      balance: p.balance || undefined,
      limit: p.limit || undefined,
      dueDay: p.dueDay ? Number(p.dueDay) : undefined,
    })),
  );

  return (
    <form action={action} className="flex flex-col gap-4">
      <input type="hidden" name="selection" value={payload} />
      <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        {BANKS.map((bank) => {
          const on = selected(bank);
          return (
            <li key={bank}>
              <button
                type="button"
                aria-pressed={on}
                onClick={() => toggle(bank)}
                className={cx(
                  "flex min-h-14 w-full items-center gap-3 rounded-xl border p-2.5 text-left text-sm font-medium transition-colors",
                  on ? "border-primary bg-primary-soft" : "border-border bg-surface hover:bg-surface-2",
                )}
              >
                <span className={cx("flex size-9 shrink-0 items-center justify-center rounded-lg text-meta font-semibold", on ? "bg-primary text-primary-fg" : "bg-surface-2 text-muted")}>
                  {on ? <Check aria-hidden size={16} /> : initials(bank)}
                </span>
                <span className="min-w-0 truncate">{bank}</span>
              </button>
            </li>
          );
        })}
      </ul>

      <div className="flex items-end gap-2">
        <div className="min-w-0 flex-1">
          <Field label="Não achou o seu?" htmlFor={`${id}-other`}>
            <Input
              id={`${id}-other`}
              value={other}
              maxLength={40}
              placeholder="Nome do banco ou carteira"
              onChange={(e) => setOther(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  addOther();
                }
              }}
            />
          </Field>
        </div>
        <Button type="button" variant="secondary" onClick={addOther} aria-label="Adicionar banco">
          <Plus aria-hidden size={18} />
        </Button>
      </div>

      {picks.length ? (
        <div className="flex flex-col gap-3">
          <h2 className="text-sm font-semibold">O que você tem em cada um?</h2>
          {picks.map((p) => (
            <Card key={p.bank} className="flex flex-col gap-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="font-medium">{p.bank}</p>
                <div className="flex gap-2">
                  <Toggle on={p.checking} onClick={() => update(p.bank, { checking: !p.checking })} icon={<Landmark aria-hidden size={16} />} label="Conta" />
                  <Toggle on={p.card} onClick={() => update(p.bank, { card: !p.card })} icon={<CreditCard aria-hidden size={16} />} label="Cartão" />
                </div>
              </div>
              {p.checking || p.card ? (
                <div className="grid gap-3 sm:grid-cols-3">
                  {p.checking ? (
                    <Field label="Saldo de hoje (opcional)" htmlFor={`${id}-${p.bank}-bal`}>
                      <Input id={`${id}-${p.bank}-bal`} inputMode="decimal" placeholder="0,00" value={p.balance} onChange={(e) => update(p.bank, { balance: e.target.value })} />
                    </Field>
                  ) : null}
                  {p.card ? (
                    <>
                      <Field label="Limite (opcional)" htmlFor={`${id}-${p.bank}-lim`}>
                        <Input id={`${id}-${p.bank}-lim`} inputMode="decimal" placeholder="0,00" value={p.limit} onChange={(e) => update(p.bank, { limit: e.target.value })} />
                      </Field>
                      <Field label="Vence dia (opcional)" htmlFor={`${id}-${p.bank}-due`}>
                        <Input id={`${id}-${p.bank}-due`} type="number" min={1} max={31} placeholder="10" value={p.dueDay} onChange={(e) => update(p.bank, { dueDay: e.target.value })} />
                      </Field>
                    </>
                  ) : null}
                </div>
              ) : null}
            </Card>
          ))}
        </div>
      ) : null}

      <FormError message={state.error} />
      <div className="flex items-center justify-between gap-2">
        {existing.length ? (
          <ButtonLink href="/comecar?passo=2" variant="ghost">
            Pular
          </ButtonLink>
        ) : (
          <span className="text-meta text-muted">Nada aqui se conecta ao seu banco. Você escolhe o que importar.</span>
        )}
        <Continue disabled={!picks.length} />
      </div>
    </form>
  );
}
