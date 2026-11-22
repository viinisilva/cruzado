// Deterministic categorization: the user's own history first, then keyword rules. No LLM.
import { normalizeMerchant, stripAccents } from "./text";

export const DEFAULT_CATEGORIES = [
  { slug: "mercado", name: "Mercado", kind: "expense", color: "emerald" },
  { slug: "moradia", name: "Moradia", kind: "expense", color: "sky" },
  { slug: "transporte", name: "Transporte", kind: "expense", color: "indigo" },
  { slug: "saude", name: "Saúde", kind: "expense", color: "rose" },
  { slug: "lazer", name: "Lazer", kind: "expense", color: "amber" },
  { slug: "educacao", name: "Educação", kind: "expense", color: "violet" },
  { slug: "assinaturas", name: "Assinaturas", kind: "expense", color: "cyan" },
  { slug: "restaurantes", name: "Restaurantes", kind: "expense", color: "orange" },
  { slug: "compras", name: "Compras", kind: "expense", color: "fuchsia" },
  { slug: "outras-despesas", name: "Outras despesas", kind: "expense", color: "slate" },
  { slug: "salario", name: "Salário", kind: "income", color: "emerald" },
  { slug: "outras-receitas", name: "Outras receitas", kind: "income", color: "teal" },
  { slug: "transferencias", name: "Transferências", kind: "transfer", color: "slate" },
  { slug: "pagamento-fatura", name: "Pagamento de fatura", kind: "transfer", color: "slate" },
] as const;

const RULES: { slug: string; words: string[] }[] = [
  { slug: "pagamento-fatura", words: ["pagamento fatura", "pgto fatura", "pag fatura"] },
  // Only movements between the user's own accounts: a Pix to the landlord is a real expense.
  { slug: "transferencias", words: ["entre contas", "mesma titularidade", "aplicacao", "resgate"] },
  { slug: "salario", words: ["salario", "folha", "pagamento salario", "proventos"] },
  { slug: "mercado", words: ["mercado", "supermerc", "hortifruti", "acougue", "padaria", "emporio", "atacad", "sacolao"] },
  { slug: "moradia", words: ["aluguel", "condominio", "energia", "luz", "agua", "saneamento", "gas ", "internet", "imobiliaria", "iptu"] },
  { slug: "transporte", words: ["uber", "mobilidade", " 99 ", "combustivel", "posto", "estacionamento", "pedagio", "metro", "onibus", "bilhete"] },
  { slug: "saude", words: ["farmacia", "drogaria", "clinica", "hospital", "laboratorio", "consulta", "plano de saude", "odonto"] },
  { slug: "educacao", words: ["curso", "escola", "faculdade", "livraria", "udemy", "mensalidade"] },
  { slug: "assinaturas", words: ["stream", "assinatura", "musica", "spotify", "netflix", "prime", "cloud", "app store"] },
  { slug: "restaurantes", words: ["restaurante", "lanchonete", "bar ", "pizzaria", "delivery", "ifood", "cafe", "sabor", "almoco", "jantar", "lanche"] },
  { slug: "lazer", words: ["cinema", "show", "ingresso", "teatro", "pousada", "hotel", "viagem", "parque"] },
  { slug: "compras", words: ["loja", "magazine", "shopping", "casa & cia", "eletro"] },
];

/** A cashback credit lowers the bill like a refund; it is never the bill being paid, whatever the bank calls it. */
export function readsLikeCashback(description: string): boolean {
  return /cash\s*-?\s*back/i.test(description);
}

/**
 * A card credit whose text says it is a payment is the bill being paid ("PAGTO. POR DEB EM C/C", "PAGAMENTO EFETUADO");
 * refunds say "estorno" and cashback says so too: both stay out.
 */
export function readsLikeBillPayment(description: string): boolean {
  const d = ` ${stripAccents(description).toLowerCase()} `;
  return !d.includes("estorno") && !readsLikeCashback(d) && /\s(pagamento|pagto|pgto|pag)[\s.]/.test(d);
}

export function categorizeByKeywords(description: string, amountCents: number, accountType?: string): string {
  const d = ` ${stripAccents(description).toLowerCase()} `;
  // On a card this is the bill being paid; on a checking account it is money coming in.
  if (accountType === "credit_card" && amountCents > 0 && readsLikeBillPayment(description)) return "pagamento-fatura";
  for (const r of RULES) {
    if (r.words.some((w) => d.includes(w))) {
      if (r.slug === "salario" && amountCents < 0) continue;
      return r.slug;
    }
  }
  return amountCents > 0 ? "outras-receitas" : "outras-despesas";
}

/** Picks a category id: same merchant in user's history wins, then keywords. */
export function makeCategorizer(categories: { id: string; slug: string }[], history: { merchant: string; categoryId: string | null }[], accountType?: string) {
  const bySlug = new Map(categories.map((c) => [c.slug, c.id]));
  const byMerchant = new Map<string, string>();
  for (const h of history) if (h.categoryId && !byMerchant.has(h.merchant)) byMerchant.set(h.merchant, h.categoryId);
  return (description: string, amountCents: number): string | null => {
    // A card bill payment is told by its own text, never by history: payment wording is stripped from merchant names, so
    // "PAGAMENTO RECEBIDO" would inherit whatever "PIX RECEBIDO" got, and a payment saved as income would keep it forever.
    if (accountType === "credit_card" && amountCents > 0 && readsLikeBillPayment(description)) return bySlug.get("pagamento-fatura") ?? null;
    // Same for cashback: an older one saved as a bill payment must not teach the next one to skip the bill.
    if (accountType === "credit_card" && amountCents > 0 && readsLikeCashback(description)) return bySlug.get(categorizeByKeywords(description, amountCents, accountType)) ?? null;
    const known = byMerchant.get(normalizeMerchant(description));
    if (known) return known;
    return bySlug.get(categorizeByKeywords(description, amountCents, accountType)) ?? null;
  };
}
