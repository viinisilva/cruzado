// The cards page is driven by its URL, so back, forward and links inside the app restore the same view.
export const CARD_TABS = [
  { id: "faturas", label: "Faturas" },
  { id: "parcelas", label: "Parcelas" },
  { id: "limites", label: "Limites" },
] as const;

export type CardTab = (typeof CARD_TABS)[number]["id"];

export function parseCardTab(value: string | string[] | undefined): CardTab {
  const v = Array.isArray(value) ? value[0] : value;
  return CARD_TABS.find((t) => t.id === v)?.id ?? "faturas";
}

/** The month being looked at (YYYY-MM): due month on Faturas, charge month on Parcelas. Anything else means "default". */
export function parseCardMonth(value: string | string[] | undefined): string | undefined {
  const v = Array.isArray(value) ? value[0] : value;
  return v && /^\d{4}-(0[1-9]|1[0-2])$/.test(v) ? v : undefined;
}

export function cardHref({ cartao, aba, mes }: { cartao?: string; aba?: CardTab; mes?: string } = {}): string {
  const p = new URLSearchParams();
  if (cartao) p.set("cartao", cartao);
  if (aba && aba !== "faturas") p.set("aba", aba);
  if (mes) p.set("mes", mes);
  const s = p.toString();
  return s ? `/cartoes?${s}` : "/cartoes";
}
