"use client";
import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { cardHref, type CardTab } from "@/lib/card-query";
import { Select } from "@/components/ui";

/** Many cards do not fit as chips. A native select keeps type-ahead, screen reader support and the phone's own picker. */
export function CardSelect({ value, options, aba, mes }: { value: string; options: { id: string; label: string }[]; aba: CardTab; mes?: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <div className="flex flex-col gap-1.5 sm:max-w-sm">
      <label htmlFor="cartao" className="text-sm font-medium">Cartão</label>
      <Select
        key={value}
        id="cartao"
        defaultValue={value}
        aria-busy={pending}
        onChange={(e) => {
          const cartao = e.target.value || undefined;
          start(() => router.push(cardHref({ cartao, aba, mes }), { scroll: false }));
        }}
      >
        <option value="">Todos os cartões</option>
        {options.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
      </Select>
    </div>
  );
}
