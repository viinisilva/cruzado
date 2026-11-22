// Institutions offered in the first-run setup. Only names: no connection to any of them happens here.
export const BANKS = [
  "Nubank",
  "Itaú",
  "Bradesco",
  "Banco do Brasil",
  "Caixa",
  "Santander",
  "Inter",
  "C6 Bank",
  "Mercado Pago",
  "PicPay",
  "BTG Pactual",
  "Sicoob",
  "Sicredi",
  "Neon",
] as const;

/** Most cards close about a week before the due date; editable later in Configurações. */
export function closingDayFor(dueDay: number): number {
  return dueDay > 7 ? dueDay - 7 : dueDay + 23;
}

export function initials(name: string): string {
  const words = name.trim().split(/\s+/);
  return ((words[0]?.[0] ?? "") + (words[1]?.[0] ?? "")).toUpperCase() || "?";
}
