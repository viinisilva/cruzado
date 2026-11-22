"use client";
// Strip at the top of every screen while someone is looking at invented data, plus a short explanation right after
// the public demonstration refused a change (the Server Action sends them back with ?somente-leitura=1).
import { Info } from "lucide-react";
import { useSearchParams } from "next/navigation";

export function DemoBanner({ readOnly }: { readOnly: boolean }) {
  const refused = useSearchParams().get("somente-leitura") === "1";
  return (
    <div className="border-b border-border/70 bg-surface-3/60">
      <p className="mx-auto flex w-full max-w-[1480px] items-center gap-2 px-4 py-1.5 text-meta text-muted sm:px-6 lg:px-10">
        <Info aria-hidden size={14} className="shrink-0" />
        Você está vendo dados de exemplo.
        {readOnly ? <span className="hidden sm:inline">Nada do que você fizer aqui é salvo.</span> : null}
      </p>
      {refused ? (
        <p role="status" className="mx-auto w-full max-w-[1480px] px-4 pb-2 text-sm font-medium text-attention sm:px-6 lg:px-10">
          Na demonstração dá para olhar tudo, mas nada é alterado. Para usar com os seus dados, peça um convite.
        </p>
      ) : null}
    </div>
  );
}
