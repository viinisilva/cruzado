// Reproducible demo data (fictitious people, institutions and merchants). Same seed + same "today" = same data.
import type { DB } from "@/db/connection";
import * as s from "@/db/schema";
import { newId } from "../ids";
import { addDays, addMonths, daysInMonth, startOfMonth } from "../dates";
import { normalizeMerchant, parseInstallment } from "../text";
import { DEFAULT_CATEGORIES } from "../categorizer";
import { createAgentDraft, runUserAgents } from "../agents/service";
import { refreshRecurring } from "../finance/recurring-store";

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

export async function ensureDefaultCategories(db: DB, userId: string): Promise<Map<string, string>> {
  const ids = new Map<string, string>();
  for (const c of DEFAULT_CATEGORIES) {
    const id = newId();
    const [row] = await db
      .insert(s.categories)
      .values({ id, userId, slug: c.slug, name: c.name, kind: c.kind, color: c.color })
      .onConflictDoUpdate({ target: [s.categories.userId, s.categories.slug], set: { name: c.name } })
      .returning({ id: s.categories.id });
    ids.set(c.slug, row!.id);
  }
  return ids;
}

type Draft = { account: "a" | "b" | "card"; date: string; description: string; amountCents: number; category: string };

/** Generates ~3 months of transactions ending today (inclusive). Pure: depends only on seed and today. */
export function generateDemoTransactions(today: string, seed = 20240501): Draft[] {
  const rnd = mulberry32(seed);
  const between = (min: number, max: number) => Math.round(min + rnd() * (max - min));
  const first = addMonths(startOfMonth(today), -2);
  const out: Draft[] = [];
  const push = (d: Draft) => {
    if (d.date >= first && d.date <= today) out.push(d);
  };
  const months = [0, 1, 2].map((i) => addMonths(first, i)); // first day of each month
  const day = (month: string, d: number) => {
    const [y, m] = month.split("-").map(Number) as [number, number];
    return `${month.slice(0, 7)}-${String(Math.min(d, daysInMonth(y, m))).padStart(2, "0")}`;
  };

  months.forEach((m, idx) => {
    const isSpikeMonth = idx === 1; // previous month: noticeable rise in Lazer
    push({ account: "a", date: day(m, 5), description: "SALARIO EMPRESA FICTICIA ALFA LTDA", amountCents: 785000, category: "salario" });
    push({ account: "b", date: day(m, 18), description: "Freelance Design Projeto Exemplo", amountCents: between(90000, 160000), category: "outras-receitas" });
    push({ account: "a", date: day(m, 10), description: "Aluguel Imobiliaria Lar Doce", amountCents: -210000, category: "moradia" });
    push({ account: "a", date: day(m, 10), description: "Condominio Residencial Ipe Amarelo", amountCents: -48000, category: "moradia" });
    push({ account: "a", date: day(m, 15), description: "Energia Companhia Luz Clara", amountCents: -between(16000, 24000), category: "moradia" });
    push({ account: "a", date: day(m, 12), description: "Internet Fibra Conecta", amountCents: -9990, category: "moradia" });
    push({ account: "a", date: day(m, 6), description: "Transferencia para Cooperativa Horizonte", amountCents: -100000, category: "transferencias" });
    push({ account: "b", date: day(m, 6), description: "Transferencia recebida Banco Aurora", amountCents: 100000, category: "transferencias" });
    // Card subscriptions and education (recurring, same day each month)
    push({ account: "card", date: day(m, 3), description: "StreamFlix Assinatura Mensal", amountCents: -3990, category: "assinaturas" });
    push({ account: "card", date: day(m, 8), description: "Musica Ja Assinatura", amountCents: -2190, category: "assinaturas" });
    push({ account: "card", date: day(m, 20), description: "Curso Online Saber Mais", amountCents: -18900, category: "educacao" });
    // Installment purchase: 10x, started the month before the demo window
    push({ account: "card", date: day(m, 14), description: `Loja Casa & Cia Geladeira ${idx + 2}/10`, amountCents: -38990, category: "compras" });

    for (let w = 0; w < 5; w++) {
      const base = addDays(m, w * 7);
      push({ account: "a", date: addDays(base, between(0, 2)), description: "Supermercado Bom Preco Vila Nova", amountCents: -between(18000, 32000) - (isSpikeMonth ? 4000 : 0), category: "mercado" });
      push({ account: "card", date: addDays(base, between(3, 5)), description: "Hortifruti Vale Verde", amountCents: -between(4000, 9000), category: "mercado" });
      for (let r = 0; r < 3; r++) push({ account: "card", date: addDays(base, between(0, 6)), description: "App Mobilidade Rota", amountCents: -between(1500, 4200), category: "transporte" });
      push({ account: "card", date: addDays(base, between(0, 6)), description: "Lanchonete Ponto Doce", amountCents: -between(2500, 6000), category: "restaurantes" });
    }
    push({ account: "card", date: day(m, 11), description: "Posto Estrela Combustivel", amountCents: -between(18000, 26000), category: "transporte" });
    push({ account: "card", date: day(m, 24), description: "Posto Estrela Combustivel", amountCents: -between(15000, 22000), category: "transporte" });
    push({ account: "a", date: day(m, between(2, 26)), description: "Farmacia Bem Estar", amountCents: -between(3500, 12000), category: "saude" });
    push({ account: "card", date: day(m, 21), description: "Cinema Estacao Central", amountCents: -between(6000, 9000), category: "lazer" });
    if (idx === 0) push({ account: "a", date: day(m, 16), description: "Clinica Vida Plena Consulta", amountCents: -35000, category: "saude" });
    if (isSpikeMonth) {
      push({ account: "card", date: day(m, 13), description: "Pousada Mar Azul Hospedagem", amountCents: -145000, category: "lazer" });
      push({ account: "card", date: day(m, 14), description: "Ingresso Show Festival Fictício", amountCents: -38000, category: "lazer" });
      push({ account: "card", date: day(m, 15), description: "Restaurante Beira Mar Exemplo", amountCents: -26000, category: "restaurantes" });
    }
  });

  // Possible duplicate: same merchant and amount, one day apart, inside the last 30 days.
  push({ account: "card", date: addDays(today, -3), description: "Restaurante Sabor Caseiro", amountCents: -8750, category: "restaurantes" });
  push({ account: "card", date: addDays(today, -2), description: "Restaurante Sabor Caseiro", amountCents: -8750, category: "restaurantes" });
  // Today: enough spending to trip the demo daily-limit agent (R$ 300).
  push({ account: "a", date: today, description: "Supermercado Bom Preco Vila Nova", amountCents: -24590, category: "mercado" });
  push({ account: "a", date: today, description: "Farmacia Bem Estar", amountCents: -7820, category: "saude" });

  // Card bills: paid from conta A on the 10th, covering the previous cycle (closing day 1).
  for (let i = 1; i <= 2; i++) {
    const cycleStart = addMonths(first, i - 1);
    const cycleEnd = addDays(addMonths(first, i), -1);
    const total = out.filter((d) => d.account === "card" && d.date >= cycleStart && d.date <= cycleEnd).reduce((n, d) => n - d.amountCents, 0);
    const payDate = day(addMonths(first, i), 10);
    push({ account: "a", date: payDate, description: "Pagamento fatura Cartao Nimbus", amountCents: -total, category: "pagamento-fatura" });
    push({ account: "card", date: payDate, description: "Pagamento recebido - obrigado", amountCents: total, category: "pagamento-fatura" });
  }
  return out.sort((x, y) => x.date.localeCompare(y.date) || x.description.localeCompare(y.description));
}

/** Creates accounts, card, categories, transactions and the four default agents for a demo user. */
export async function seedDemoData(db: DB, userId: string, today: string, now: Date = new Date()) {
  const cats = await ensureDefaultCategories(db, userId);
  const connectionId = newId();
  await db.insert(s.financialConnections).values({ id: connectionId, userId, connector: "demo", label: "Dados de demonstração", lastSyncAt: now });
  const acc = { a: newId(), b: newId(), card: newId() };
  await db.insert(s.accounts).values([
    { id: acc.a, userId, connectionId, externalId: "demo-a", name: "Conta Aurora", institution: "Banco Aurora (fictício)", type: "checking", openingBalanceCents: 320000 },
    { id: acc.b, userId, connectionId, externalId: "demo-b", name: "Conta Horizonte", institution: "Cooperativa Horizonte (fictícia)", type: "checking", openingBalanceCents: 500000 },
    { id: acc.card, userId, connectionId, externalId: "demo-card", name: "Cartão Nimbus", institution: "Nimbus Cartões (fictício)", type: "credit_card", openingBalanceCents: 0 },
  ]);
  await db.insert(s.creditCards).values({ id: newId(), userId, accountId: acc.card, limitCents: 800000, closingDay: 1, dueDay: 10 });

  const drafts = generateDemoTransactions(today);
  const rows = drafts.map((d, i) => {
    const inst = parseInstallment(d.description);
    return {
      id: newId(),
      userId,
      accountId: acc[d.account],
      categoryId: cats.get(d.category) ?? null,
      date: d.date,
      description: d.description,
      merchant: normalizeMerchant(d.description),
      amountCents: d.amountCents,
      installmentNumber: inst?.number ?? null,
      installmentTotal: inst?.total ?? null,
      source: "demo" as const,
      dedupeKey: `demo:${i}:${d.date}`,
    };
  });
  for (let i = 0; i < rows.length; i += 200) await db.insert(s.transactions).values(rows.slice(i, i + 200));

  const base = { timezone: "America/Sao_Paulo" as const, enabled: true };
  await createAgentDraft(db, userId, { ...base, name: "Limite diário de R$ 300", kind: "daily_spend_limit", thresholdCents: 30000 }, { origin: "default", status: "active" });
  await createAgentDraft(db, userId, { ...base, name: "Resumo semanal", kind: "weekly_summary" }, { origin: "default", status: "active" });
  await createAgentDraft(db, userId, { ...base, name: "Cobranças duplicadas", kind: "possible_duplicate" }, { origin: "default", status: "active" });
  await createAgentDraft(db, userId, { ...base, name: "Comparação mensal", kind: "monthly_comparison" }, { origin: "default", status: "active" });

  await refreshRecurring(db, userId, today);
  await runUserAgents(db, userId, now);
  return { accounts: acc, transactions: rows.length };
}
