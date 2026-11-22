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

/** "Por que eu criei o Cruzado", in the author's voice, reviewed by the author on 22/11/2026. */
export const WHY = [
  "Sou estudante de Sistemas de Informação e queria uma coisa simples: entender para onde ia o meu dinheiro. Só que, quando fui conferir, a fatura do cartão não batia com a soma das compras que eu via. Tinha estorno que eu não sabia ligar à compra, parcela que mudava de mês e lançamento pendente que nunca chegava a ser cobrado.",
  "Então comecei a construir um app que mostrasse a conta inteira, centavo por centavo, sem pedir a senha do banco e sem mexer no dinheiro. O Cruzado nasceu disso: primeiro para mim, e agora, aos poucos, para quem quiser usar também.",
];

/** Short answers in plain language. They must stay true to what the app does (docs/SECURITY.md, docs/OPEN_FINANCE.md). */
export const FAQ = [
  {
    q: "É seguro conectar meu banco?",
    a: "A conexão é feita pelo Open Finance, por meio da Pluggy, uma empresa especializada nessa ligação. A permissão é só de leitura: o Cruzado vê contas, saldos, cartões e faturas, mas não consegue fazer Pix, pagamentos nem transferências. Você pode revogar a permissão quando quiser, e os dados da conexão ficam guardados cifrados. Para convidados, a conexão com bancos está sendo liberada aos poucos; enquanto isso, dá para importar extratos em CSV ou OFX.",
  },
  {
    q: "Vocês veem a minha senha do banco?",
    a: "Não. Você autoriza o acesso no ambiente do próprio banco, e o Cruzado nunca pede nem guarda essa senha. A senha que você cria para entrar no Cruzado também não fica guardada: fica só um código embaralhado que não pode ser revertido.",
  },
  {
    q: "É grátis?",
    a: "Sim. O Cruzado é um projeto pessoal e de código aberto, sem cobrança. Quem quiser pode instalar a própria cópia de graça, seguindo o README no GitHub.",
  },
  {
    q: "Como faço para usar?",
    a: "Por enquanto, o uso é só por convite: me chame no LinkedIn. Enquanto isso, a demonstração mostra tudo funcionando com dados de exemplo, sem cadastro.",
  },
];
