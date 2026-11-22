// Everything the landing page shows about money is invented, with the same names as the public demonstration
// (src/lib/demo/showcase.ts). No real account, bank or amount appears here.

export const DEMO_URL = "https://cruzado-demo.vercel.app";
export const REPO_URL = "https://github.com/viinisilva/cruzado";
export const README_URL = "https://github.com/viinisilva/cruzado#readme";
export const ARCHITECTURE_URL = "https://github.com/viinisilva/cruzado/blob/main/docs/ARCHITECTURE.md";
export const LINKEDIN_URL = "https://www.linkedin.com/in/viinicius-silva";
export const GITHUB_PROFILE_URL = "https://github.com/viinisilva";

/** Tests that run, as of 22/11/2026: `npx vitest run` and `npx playwright test --list` (minus the 3 skipped on purpose). Update when the suite grows. */
export const TESTS = { unitAndIntegration: 730, endToEnd: 151 };
export const SCREENS = 19;

export type BillRow = {
  id: string;
  merchant: string;
  date: string;
  cents: number;
  /** refund: a credit that undoes the purchase `undoes`; phantom: pending, then left out when the bank closes the bill. */
  kind?: "refund" | "phantom";
  undoes?: string;
  note?: string;
};

/** Cartão Ipê, October bill: the order in which the rows enter while the visitor scrolls. */
export const BILL: BillRow[] = [
  { id: "hortifruti", merchant: "Hortifruti Vale Verde", date: "03/10", cents: 6_420 },
  { id: "padaria", merchant: "Padaria Pão Quente", date: "04/10", cents: 3_845 },
  { id: "sofa", merchant: "Loja Lar e Cia, sofá 7/10", date: "05/10", cents: 24_991 },
  { id: "posto", merchant: "Posto Estrela Combustível", date: "11/10", cents: 21_230 },
  { id: "musica", merchant: "Música Já, assinatura", date: "12/10", cents: 2_193 },
  { id: "curso", merchant: "Curso Online Aprender Mais", date: "18/10", cents: 14_907 },
  { id: "casa", merchant: "Loja Casa Bonita", date: "16/10", cents: 12_989 },
  { id: "estorno", merchant: "Estorno Loja Casa Bonita", date: "27/10", cents: -12_989, kind: "refund", undoes: "casa", note: "Abate a compra de 16/10" },
  { id: "rota", merchant: "App Mobilidade Rota", date: "30/10", cents: 2_760, kind: "phantom", note: "Pendente" },
];

/** What the bank says the bill is. The rows above add up to it once the phantom entry leaves the sum. */
export const BANK_TOTAL_CENTS = 73_586;

/**
 * Story steps while scrolling: 1..BILL.length bring one row each; then the bill closes (the phantom row leaves the
 * sum) and finally the bank's total appears.
 */
export const STEP_CLOSED = BILL.length + 1;
export const STEP_MATCHED = BILL.length + 2;

export const PHASES = [
  { from: 1, title: "As compras entram na fatura", text: "Cada lançamento cai na fatura certa, pela data e pelo ciclo do cartão." },
  { from: 8, title: "Um estorno abate a compra", text: "O crédito é estorno porque existe a compra que ele desfaz, não porque o texto diz." },
  { from: 9, title: "Um pendente que o banco não cobrou", text: "Quando a fatura fecha sem ele, sai da soma e fica guardado para conferência." },
  { from: STEP_MATCHED, title: "Bate com o banco", text: "A soma dos lançamentos é igual ao total que o banco informou." },
] as const;

/** Sum shown at a given step: rows that entered, without the phantom once the bill closed. */
export function billSum(step: number): number {
  let sum = 0;
  BILL.forEach((row, i) => {
    if (i + 1 > step) return;
    if (row.kind === "phantom" && step >= STEP_CLOSED) return;
    sum += row.cents;
  });
  return sum;
}

export const brl = (cents: number) => (cents / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
