"use client";
// "Aplicar todas" asks first: a native dialog says how many entries change category. The form carries that count, and
// the server applies nothing if the count is no longer the same (src/lib/card-reconciliation.ts, applyAllProposals).
import { useRef } from "react";
import { Button } from "@/components/ui";
import { applyAllAction } from "@/app/actions/reconciliation";

export function ApplyAll({ count }: { count: number }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const label = count === 1 ? "Aplicar 1 mudança" : `Aplicar ${count} mudanças`;
  return (
    <>
      <Button type="button" onClick={() => dialog.current?.showModal()}>
        {label}
      </Button>
      <dialog ref={dialog} aria-labelledby="apply-all-title" className="w-[min(28rem,calc(100vw-2rem))] rounded-2xl border border-border bg-surface p-6 text-text shadow-pop backdrop:bg-black/40">
        <h2 id="apply-all-title" className="text-lg font-semibold">
          {label}?
        </h2>
        <p className="mt-2 text-base">
          Isso altera a categoria de {count === 1 ? "1 lançamento" : `${count} lançamentos`}. As propostas ambíguas ficam de fora. Depois, cada mudança pode ser desfeita uma a uma.
        </p>
        <form action={applyAllAction} className="mt-5 flex flex-wrap justify-end gap-2">
          <input type="hidden" name="count" value={count} />
          <Button type="button" variant="secondary" onClick={() => dialog.current?.close()}>
            Cancelar
          </Button>
          <Button type="submit">{label}</Button>
        </form>
      </dialog>
    </>
  );
}
