// Data for the public demonstration (docs/USO_COMPARTILHADO.md, etapa 1). Everything here is invented: people,
// institutions, stores and amounts. Pure and deterministic: same "today" → same data, relative to that day, so "this
// month" always has entries. Separate from seed.ts, whose fixed amounts the test suite depends on.
import { addDays, addMonths, daysInMonth, startOfMonth } from "../dates";

export type ShowcaseAccountKey = "corrente" | "poupanca" | "ipe" | "lume";
type CardKey = "ipe" | "lume";

export type ShowcaseAccount = {
  key: ShowcaseAccountKey;
  name: string;
  institution: string;
  type: "checking" | "savings" | "credit_card";
  openingBalanceCents: number;
};

export type ShowcaseCard = { account: CardKey; limitCents: number; closingDay: number; dueDay: number };

export type ShowcaseBill = { account: CardKey; key: string; closingDate: string; dueDate: string; totalCents: number; minimumCents: number };

export type ShowcaseTx = {
  account: ShowcaseAccountKey;
  date: string;
  description: string;
  amountCents: number;
  category: string;
  /** Card entries of a closed bill carry that bill; entries of the open bill carry none and are pending, as banks send them. */
  billKey?: string;
  status?: "pending" | "posted";
  operationType?: string;
};

export type Showcase = {
  accounts: ShowcaseAccount[];
  cards: ShowcaseCard[];
  bills: ShowcaseBill[];
  transactions: ShowcaseTx[];
  /** Questions asked at boot, each in its own conversation, so the chat opens with real answers. */
  conversations: string[][];
};

export const SHOWCASE_ACCOUNTS: ShowcaseAccount[] = [
  { key: "corrente", name: "Conta Aurora", institution: "Banco Aurora (fictício)", type: "checking", openingBalanceCents: 284_317 },
  { key: "poupanca", name: "Poupança Aurora", institution: "Banco Aurora (fictício)", type: "savings", openingBalanceCents: 1_183_459 },
  { key: "ipe", name: "Cartão Ipê", institution: "Ipê Cartões (fictício)", type: "credit_card", openingBalanceCents: 0 },
  { key: "lume", name: "Cartão Lume", institution: "Lume Banco Digital (fictício)", type: "credit_card", openingBalanceCents: 0 },
];

// Ipê closes early in the month and is due the same month; Lume closes late and is due the next month.
const CARDS: ShowcaseCard[] = [
  { account: "ipe", limitCents: 650_000, closingDay: 3, dueDay: 10 },
  { account: "lume", limitCents: 420_000, closingDay: 25, dueDay: 1 },
];

const CONVERSATIONS = [["Quanto gastei com mercado neste mês?"], ["Quais são as minhas assinaturas?"], ["Como está a fatura do cartão?"]];

function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const dayOf = (month: string, d: number) => {
  const [y, m] = month.split("-").map(Number) as [number, number];
  return `${month.slice(0, 7)}-${String(Math.min(d, daysInMonth(y, m))).padStart(2, "0")}`;
};

type CardCycle = { key: string; closingDate: string; dueDate: string; prevClosing: string };

/** Bank-like cycles: a bill holds entries after the previous closing and before its own closing. */
function cyclesFor(card: ShowcaseCard, first: string, today: string): CardCycle[] {
  const out: CardCycle[] = [];
  for (let i = -1; i <= 8; i++) {
    const month = addMonths(first, i);
    const closingDate = dayOf(month, card.closingDay);
    const dueMonth = card.dueDay > card.closingDay ? month : addMonths(month, 1);
    const prevClosing = dayOf(addMonths(month, -1), card.closingDay);
    out.push({ key: `${card.account}-${closingDate.slice(0, 7)}`, closingDate, dueDate: dayOf(dueMonth, card.dueDay), prevClosing });
    if (closingDate > addMonths(today, 1)) break;
  }
  return out;
}

export function generateShowcase(today: string, seed = 20261121): Showcase {
  const rnd = mulberry32(seed);
  // Odd cents on purpose: real-looking amounts that are not anyone's real amounts.
  const between = (min: number, max: number) => Math.round(min + rnd() * (max - min)) | 1;
  const first = addMonths(startOfMonth(today), -5);
  const months = [0, 1, 2, 3, 4, 5].map((i) => addMonths(first, i));
  const raw: ShowcaseTx[] = [];
  const push = (t: ShowcaseTx) => raw.push(t);

  months.forEach((m, idx) => {
    // Checking account: income, home and transfers to savings.
    push({ account: "corrente", date: dayOf(m, 5), description: "SALARIO EMPRESA EXEMPLO ALFA LTDA", amountCents: 642_037, category: "salario" });
    push({ account: "corrente", date: dayOf(m, 8), description: "Aluguel Imobiliaria Morada Feliz", amountCents: -189_013, category: "moradia" });
    push({ account: "corrente", date: dayOf(m, 9), description: "Condominio Residencial Jacaranda", amountCents: -44_731, category: "moradia" });
    push({ account: "corrente", date: dayOf(m, 14), description: "Energia Companhia Luz do Vale", amountCents: -between(15_000, 23_000), category: "moradia" });
    push({ account: "corrente", date: dayOf(m, 12), description: "Internet Fibra Rapida", amountCents: -10_489, category: "moradia" });
    push({ account: "corrente", date: dayOf(m, 6), description: "Transferencia entre contas Poupanca Aurora", amountCents: -50_000 - idx * 1_003, category: "transferencias" });
    push({ account: "poupanca", date: dayOf(m, 6), description: "Transferencia entre contas Conta Aurora", amountCents: 50_000 + idx * 1_003, category: "transferencias" });
    push({ account: "poupanca", date: dayOf(m, 28), description: "Rendimento poupanca", amountCents: between(5_900, 7_100), category: "outras-receitas" });
    for (let w = 0; w < 4; w++) push({ account: "corrente", date: addDays(m, w * 7 + between(0, 2)), description: "Supermercado Bom Preco", amountCents: -between(17_000, 31_000), category: "mercado" });
    push({ account: "corrente", date: dayOf(m, between(2, 26)), description: "Farmacia Saude Sempre", amountCents: -between(3_100, 11_900), category: "saude" });
    if (idx === 2) push({ account: "corrente", date: dayOf(m, 17), description: "Clinica Bem Viver Consulta", amountCents: -31_013, category: "saude" });
    if (idx % 2 === 1) push({ account: "corrente", date: dayOf(m, 21), description: "Freelance Revisao de Textos", amountCents: between(70_000, 120_000), category: "outras-receitas" });

    // Card Ipê: the everyday card.
    push({ account: "ipe", date: dayOf(m, 12), description: "Musica Ja Assinatura", amountCents: -2_193, category: "assinaturas" });
    push({ account: "ipe", date: dayOf(m, 18), description: "Curso Online Aprender Mais", amountCents: -14_907, category: "educacao" });
    push({ account: "ipe", date: dayOf(m, 5), description: `Loja Lar e Cia Sofa ${idx + 2}/10`, amountCents: -24_991, category: "compras" });
    for (let w = 0; w < 4; w++) {
      const base = addDays(m, w * 7);
      push({ account: "ipe", date: addDays(base, between(1, 5)), description: "Hortifruti Vale Verde", amountCents: -between(3_900, 8_900), category: "mercado" });
      push({ account: "ipe", date: addDays(base, between(0, 6)), description: "Padaria Pao Quente", amountCents: -between(1_300, 3_900), category: "mercado" });
      push({ account: "ipe", date: addDays(base, between(0, 6)), description: "App Mobilidade Rota", amountCents: -between(1_500, 4_300), category: "transporte" });
    }
    push({ account: "ipe", date: dayOf(m, 11), description: "Posto Estrela Combustivel", amountCents: -between(17_000, 25_000), category: "transporte" });
    push({ account: "ipe", date: dayOf(m, 23), description: "Posto Estrela Combustivel", amountCents: -between(14_000, 21_000), category: "transporte" });

    // Card Lume: subscriptions, eating out and a larger purchase in installments.
    push({ account: "lume", date: dayOf(m, 7), description: "StreamFlix Assinatura Mensal", amountCents: -3_991, category: "assinaturas" });
    push({ account: "lume", date: dayOf(m, 15), description: "Nuvem Fotos Assinatura", amountCents: -991, category: "assinaturas" });
    push({ account: "lume", date: dayOf(m, 10), description: `Eletro Ponto Notebook ${idx + 1}/6`, amountCents: -41_253, category: "compras" });
    for (let w = 0; w < 3; w++) push({ account: "lume", date: addDays(m, w * 9 + between(0, 4)), description: "Lanchonete Ponto Doce", amountCents: -between(2_300, 5_900), category: "restaurantes" });
    push({ account: "lume", date: dayOf(m, 20), description: "Cinema Estacao Central", amountCents: -between(5_100, 8_900), category: "lazer" });
    if (idx === 3) {
      push({ account: "lume", date: dayOf(m, 13), description: "Pousada Mar Sereno Hospedagem", amountCents: -98_713, category: "lazer" });
      push({ account: "lume", date: dayOf(m, 14), description: "Restaurante Beira Rio", amountCents: -21_389, category: "restaurantes" });
    }
  });

  // A purchase and its refund on Ipê; a cashback on Lume.
  push({ account: "ipe", date: dayOf(months[3]!, 16), description: "Loja Casa Bonita", amountCents: -12_989, category: "compras" });
  push({ account: "ipe", date: dayOf(months[3]!, 27), description: "Estorno Loja Casa Bonita", amountCents: 12_989, category: "compras", operationType: "ESTORNO" });
  push({ account: "lume", date: dayOf(months[2]!, 19), description: "Cashback Lume", amountCents: 737, category: "outras-despesas", operationType: "CASHBACK" });
  // A possible duplicate a few days ago, for the alert.
  push({ account: "lume", date: addDays(today, -4), description: "Restaurante Sabor Caseiro", amountCents: -8_753, category: "restaurantes" });
  push({ account: "lume", date: addDays(today, -3), description: "Restaurante Sabor Caseiro", amountCents: -8_753, category: "restaurantes" });

  const transactions: ShowcaseTx[] = [];
  const bills: ShowcaseBill[] = [];
  for (const card of CARDS) {
    const cycles = cyclesFor(card, first, today);
    const cardStart = cycles.find((c) => c.prevClosing >= first)?.prevClosing ?? first;
    const own = raw
      .filter((t) => t.account === card.account && t.date <= today)
      .map((t) => {
        // Never on a closing day: which bill gets that day is a bank rule the demo should not depend on.
        const onClosing = cycles.some((c) => c.closingDate === t.date);
        return onClosing ? { ...t, date: addDays(t.date, t.date === today ? -1 : 1) } : t;
      })
      .filter((t) => t.date > cardStart && t.date <= today);
    const closed = cycles.filter((c) => c.closingDate < today && c.prevClosing >= cardStart);
    const placed = own.map((t) => {
      const cycle = cycles.find((c) => t.date > c.prevClosing && t.date < c.closingDate);
      const isClosed = cycle ? closed.includes(cycle) : false;
      return { ...t, billKey: isClosed ? cycle!.key : undefined, status: isClosed ? ("posted" as const) : ("pending" as const) };
    });
    for (const c of closed) {
      const totalCents = placed.filter((t) => t.billKey === c.key).reduce((n, t) => n - t.amountCents, 0);
      bills.push({ account: card.account, key: c.key, closingDate: c.closingDate, dueDate: c.dueDate, totalCents, minimumCents: Math.round(totalCents * 0.15) | 1 });
    }
    transactions.push(...placed);
    // Each closed bill is paid in full on its due date: a debit in checking and a credit on the card.
    const name = SHOWCASE_ACCOUNTS.find((a) => a.key === card.account)!.name;
    for (const b of bills.filter((x) => x.account === card.account && x.dueDate <= today)) {
      transactions.push({ account: "corrente", date: b.dueDate, description: `Pagamento fatura ${name}`, amountCents: -b.totalCents, category: "pagamento-fatura" });
      const cycle = cycles.find((c) => b.dueDate > c.prevClosing && b.dueDate < c.closingDate);
      const inClosed = cycle && closed.includes(cycle) ? cycle.key : undefined;
      const date = cycles.some((c) => c.closingDate === b.dueDate) ? addDays(b.dueDate, 1) : b.dueDate;
      if (date <= today) transactions.push({ account: card.account, date, description: "Pagamento recebido obrigado", amountCents: b.totalCents, category: "pagamento-fatura", operationType: "PAGAMENTO_FATURA", billKey: inClosed, status: inClosed ? "posted" : "pending" });
    }
  }
  transactions.push(...raw.filter((t) => (t.account === "corrente" || t.account === "poupanca") && t.date >= first && t.date <= today));
  transactions.sort((x, y) => x.date.localeCompare(y.date) || x.account.localeCompare(y.account) || x.description.localeCompare(y.description));
  bills.sort((x, y) => x.closingDate.localeCompare(y.closingDate) || x.account.localeCompare(y.account));
  return { accounts: SHOWCASE_ACCOUNTS, cards: CARDS, bills, transactions, conversations: CONVERSATIONS };
}
