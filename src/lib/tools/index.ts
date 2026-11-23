// Internal financial tools. The LLM may only choose among these; every number comes from src/lib/finance.
import { z } from "zod";
import { and, eq, ne } from "drizzle-orm";
import * as s from "@/db/schema";
import { formatBRL, formatBasisPoints } from "../money";
import { addDays, formatDateBR, formatRangeBR } from "../dates";
import { sanitizeUntrusted, slugify, stripAccents } from "../text";
import {
  accountBalances,
  applyFilters,
  cashFlow,
  comparePeriods,
  consolidatedBalance,
  creditCardSummary,
  detectPossibleDuplicates,
  detectRecurring,
  spendingByCategory,
  type FinAccount,
  type FinCategory,
  type FinTx,
} from "../finance/core";
import { cardStatements, nextStatement } from "../finance/cards";
import { PeriodInput, previousComparableRange, resolvePeriod, type ResolvedPeriod } from "../finance/period";
import { loadAccounts, loadCards, loadCategories, loadTransactions } from "../data/repo";
import { AGENT_KINDS, AgentRuleSchema, SCHEDULES, describeRule, KIND_LABEL } from "../agents/rule";
import { createAgentDraft } from "../agents/service";
import type { Evidence, SourceLink, ToolContext, ToolDef, ToolResult } from "./types";

function defineTool<S extends z.ZodType>(def: ToolDef<S>): ToolDef {
  return def as unknown as ToolDef;
}

const MAX_TX_LINKS = 8;

const refList = z.array(z.string().min(1).max(80)).max(20);
const Filters = {
  accounts: refList.optional().describe("Nomes ou ids de contas para filtrar"),
  categories: refList.optional().describe("Nomes ou ids de categorias para filtrar"),
};

type Loaded = { accounts: FinAccount[]; categories: FinCategory[] };

async function base(ctx: ToolContext): Promise<Loaded> {
  const [accounts, categories] = await Promise.all([loadAccounts(ctx.db, ctx.userId), loadCategories(ctx.db, ctx.userId)]);
  return { accounts, categories };
}

const norm = (v: string) => stripAccents(v).toLowerCase().trim();

/** Resolves names/ids to ids the user owns. Unknown references become a clarification, never a guess. */
function resolveRefs<T extends { id: string; name: string }>(
  refs: string[] | undefined,
  items: (T & { slug?: string })[],
  kind: "conta" | "categoria",
): { ids?: string[]; names: string[]; unknown: string[] } {
  if (!refs?.length) return { names: [], unknown: [] };
  const ids: string[] = [];
  const names: string[] = [];
  const unknown: string[] = [];
  for (const ref of refs) {
    const r = norm(ref);
    const hit =
      items.find((i) => i.id === ref) ??
      items.find((i) => norm(i.name) === r || i.slug === slugify(ref)) ??
      items.find((i) => norm(i.name).includes(r) || (r.length >= 4 && r.includes(norm(i.name))));
    if (hit) {
      if (!ids.includes(hit.id)) {
        ids.push(hit.id);
        names.push(hit.name);
      }
    } else unknown.push(ref);
  }
  void kind;
  return { ids, names, unknown };
}

function clarify(tool: string, unknown: { accounts: string[]; categories: string[] }, l: Loaded): ToolResult | null {
  if (!unknown.accounts.length && !unknown.categories.length) return null;
  const parts: string[] = [];
  if (unknown.categories.length)
    parts.push(`Não encontrei a categoria "${unknown.categories.join('", "')}". Categorias disponíveis: ${l.categories.filter((c) => c.kind === "expense").map((c) => c.name).join(", ")}.`);
  if (unknown.accounts.length)
    parts.push(`Não encontrei a conta "${unknown.accounts.join('", "')}". Contas disponíveis: ${l.accounts.map((a) => a.name).join(", ")}.`);
  const msg = parts.join(" ");
  return { data: { needsClarification: msg }, evidence: { tool, filters: { accounts: [], categories: [] }, sources: [] }, text: msg, clarification: msg };
}

function txLink(t: FinTx): SourceLink {
  return { label: `${formatDateBR(t.date)} · ${sanitizeUntrusted(t.description, 40)} · ${formatBRL(t.amountCents)}`, href: `/transacoes/${t.id}` };
}

function listLink(period: { from: string; to: string }, opts: { categoryId?: string; accountIds?: string[]; label?: string; ids?: string[] } = {}): SourceLink {
  const p = new URLSearchParams({ de: period.from, ate: period.to });
  if (opts.categoryId) p.set("categoria", opts.categoryId);
  if (opts.accountIds?.length) p.set("contas", opts.accountIds.join(","));
  return { label: opts.label ?? `Ver transações de ${formatRangeBR(period)}`, href: `/transacoes?${p.toString()}` };
}

function txData(t: FinTx, l: Loaded) {
  return {
    id: t.id,
    date: t.date,
    // Untrusted text from bank files: data only, never instructions.
    description: sanitizeUntrusted(t.description),
    amountCents: t.amountCents,
    amount: formatBRL(t.amountCents),
    category: l.categories.find((c) => c.id === t.categoryId)?.name ?? "Sem categoria",
    account: l.accounts.find((a) => a.id === t.accountId)?.name ?? "",
    installment: t.installmentTotal ? `${t.installmentNumber}/${t.installmentTotal}` : undefined,
  };
}

function periodEv(p: ResolvedPeriod): Evidence["period"] {
  return { from: p.from, to: p.to, label: p.label, defaulted: p.defaulted };
}

function defaultedNote(p: ResolvedPeriod): string[] {
  return p.defaulted ? [`Nenhum período foi informado; considerei ${p.label}.`] : [];
}

const getAccounts = defineTool({
  name: "getAccounts",
  description: "Lista as contas, cartões e saldos atuais do usuário (somente leitura).",
  input: z.object({}).strict(),
  async run(ctx) {
    const l = await base(ctx);
    const txs = await loadTransactions(ctx.db, ctx.userId);
    const balances = accountBalances(l.accounts, txs, ctx.today);
    const lines = balances.map((b) => `- ${b.name} (${b.institution}, ${typeLabel(b.type)}): ${formatBRL(b.balanceCents)}`);
    return {
      data: { accounts: balances.map((b) => ({ id: b.id, name: b.name, institution: b.institution, type: b.type, balanceCents: b.balanceCents, balance: formatBRL(b.balanceCents) })) },
      evidence: { tool: "getAccounts", filters: { accounts: [], categories: [] }, sources: [{ label: "Contas e cartões", href: "/configuracoes?aba=contas" }], notes: [`Saldos calculados até ${formatDateBR(ctx.today)}.`] },
      text: balances.length ? `Suas contas:\n${lines.join("\n")}` : "Você ainda não tem contas cadastradas.",
    };
  },
});

function typeLabel(t: FinAccount["type"]): string {
  return { checking: "conta corrente", savings: "poupança", credit_card: "cartão de crédito", cash: "dinheiro" }[t];
}

const getConsolidatedBalance = defineTool({
  name: "getConsolidatedBalance",
  description: "Saldo consolidado das contas (exceto cartões) e total em aberto nos cartões de crédito.",
  input: z.object({}).strict(),
  async run(ctx) {
    const l = await base(ctx);
    const txs = await loadTransactions(ctx.db, ctx.userId);
    const balances = accountBalances(l.accounts, txs, ctx.today);
    const c = consolidatedBalance(balances);
    const text = balances.length
      ? `Saldo consolidado em ${formatDateBR(ctx.today)}: ${formatBRL(c.availableCents)} nas contas. Cartões de crédito em aberto: ${formatBRL(c.cardDebtCents)}. Saldo líquido: ${formatBRL(c.netCents)}.`
      : "Não há contas cadastradas, então não há saldo para calcular.";
    return {
      data: { asOf: ctx.today, availableCents: c.availableCents, cardDebtCents: c.cardDebtCents, netCents: c.netCents, accounts: balances.map((b) => ({ name: b.name, type: b.type, balance: formatBRL(b.balanceCents) })) },
      evidence: {
        tool: "getConsolidatedBalance",
        filters: { accounts: balances.filter((b) => b.type !== "credit_card").map((b) => b.name), categories: [] },
        sources: [{ label: "Contas e cartões", href: "/configuracoes?aba=contas" }],
        notes: ["Saldo = saldo inicial informado + todas as transações registradas até hoje."],
      },
      text,
    };
  },
});

const getTransactions = defineTool({
  name: "getTransactions",
  description: "Lista transações por período, conta, categoria ou texto. Use para mostrar lançamentos específicos.",
  input: z
    .object({
      period: PeriodInput.optional(),
      search: z.string().max(60).optional().describe("Texto a procurar na descrição"),
      kind: z.enum(["expense", "income", "all"]).optional(),
      limit: z.number().int().min(1).max(50).optional(),
      ...Filters,
    })
    .strict(),
  async run(ctx, input) {
    const l = await base(ctx);
    const acc = resolveRefs(input.accounts, l.accounts, "conta");
    const cat = resolveRefs(input.categories, l.categories, "categoria");
    const c = clarify("getTransactions", { accounts: acc.unknown, categories: cat.unknown }, l);
    if (c) return c;
    const p = resolvePeriod(input.period, ctx.today);
    let txs = applyFilters(await loadTransactions(ctx.db, ctx.userId, { range: p }), p, { accountIds: acc.ids, categoryIds: cat.ids });
    if (input.search) {
      const q = norm(input.search);
      txs = txs.filter((t) => norm(t.description).includes(q) || t.merchant.includes(q));
    }
    if (input.kind === "expense") txs = txs.filter((t) => t.amountCents < 0);
    if (input.kind === "income") txs = txs.filter((t) => t.amountCents > 0);
    const limited = txs.slice(0, input.limit ?? 20);
    return {
      data: { period: p, count: txs.length, transactions: limited.map((t) => txData(t, l)) },
      evidence: {
        tool: "getTransactions",
        period: periodEv(p),
        filters: { accounts: acc.names, categories: cat.names, other: input.search ? [`texto: "${sanitizeUntrusted(input.search, 30)}"`] : [] },
        sources: [...limited.slice(0, MAX_TX_LINKS).map(txLink), listLink(p, { categoryId: cat.ids?.[0], accountIds: acc.ids })],
        notes: defaultedNote(p),
      },
      text: txs.length
        ? `Encontrei ${txs.length} transação(ões) em ${p.label}:\n${limited.slice(0, 10).map((t) => `- ${formatDateBR(t.date)} ${sanitizeUntrusted(t.description, 50)}: ${formatBRL(t.amountCents)}`).join("\n")}`
        : `Não encontrei transações em ${p.label} com esses filtros.`,
    };
  },
});

const getSpendingByCategory = defineTool({
  name: "getSpendingByCategory",
  description: "Total gasto por categoria em um período (despesas; transferências e pagamentos de fatura ficam fora). Responde 'quanto gastei com X'.",
  input: z.object({ period: PeriodInput.optional(), ...Filters }).strict(),
  async run(ctx, input) {
    const l = await base(ctx);
    const acc = resolveRefs(input.accounts, l.accounts, "conta");
    const cat = resolveRefs(input.categories, l.categories, "categoria");
    const c = clarify("getSpendingByCategory", { accounts: acc.unknown, categories: cat.unknown }, l);
    if (c) return c;
    const p = resolvePeriod(input.period, ctx.today);
    const txs = await loadTransactions(ctx.db, ctx.userId, { range: p });
    const r = spendingByCategory(txs, l.categories, p, { accountIds: acc.ids, categoryIds: cat.ids });
    const byId = new Map(txs.map((t) => [t.id, t]));
    const sourceTx = r.categories.flatMap((g) => g.transactionIds).map((id) => byId.get(id)!).sort((a, b) => a.amountCents - b.amountCents);
    let text: string;
    if (!r.categories.length) {
      text = cat.names.length
        ? `Não há despesas em ${cat.names.join(", ")} em ${p.label}.`
        : `Não há despesas registradas em ${p.label}.`;
    } else if (cat.names.length) {
      text = `Em ${p.label}, você gastou ${formatBRL(r.totalCents)} com ${cat.names.join(", ")} (${r.categories.reduce((n, g) => n + g.count, 0)} transações).`;
    } else {
      text = `Em ${p.label}, suas despesas somaram ${formatBRL(r.totalCents)}. Por categoria:\n${r.categories.map((g) => `- ${g.name}: ${formatBRL(g.totalCents)} (${g.count})`).join("\n")}`;
    }
    return {
      data: { period: p, totalCents: r.totalCents, total: formatBRL(r.totalCents), categories: r.categories.map((g) => ({ categoryId: g.categoryId, name: g.name, totalCents: g.totalCents, total: formatBRL(g.totalCents), count: g.count })) },
      evidence: {
        tool: "getSpendingByCategory",
        period: periodEv(p),
        filters: { accounts: acc.names, categories: cat.names },
        sources: [
          ...sourceTx.slice(0, MAX_TX_LINKS).map(txLink),
          ...(cat.ids?.length ? cat.ids.map((id) => listLink(p, { categoryId: id, accountIds: acc.ids, label: `Todas as transações de ${l.categories.find((x) => x.id === id)?.name}` })) : [listLink(p, { accountIds: acc.ids })]),
        ],
        notes: [...defaultedNote(p), "Estornos na mesma categoria reduzem o total; transferências e pagamentos de fatura não contam como gasto."],
      },
      text,
    };
  },
});

const comparePeriodsTool = defineTool({
  name: "comparePeriods",
  description: "Compara despesas por categoria entre dois períodos. Sem períodos: mês atual até hoje vs. mesmo intervalo de dias do mês anterior.",
  input: z.object({ current: PeriodInput.optional(), previous: PeriodInput.optional(), ...Filters }).strict(),
  async run(ctx, input) {
    const l = await base(ctx);
    const acc = resolveRefs(input.accounts, l.accounts, "conta");
    const cat = resolveRefs(input.categories, l.categories, "categoria");
    const c = clarify("comparePeriods", { accounts: acc.unknown, categories: cat.unknown }, l);
    if (c) return c;
    const cur = resolvePeriod(input.current, ctx.today);
    const prevRange = input.previous ? resolvePeriod(input.previous, ctx.today) : { ...previousComparableRange(cur), label: "", defaulted: true };
    const prev: ResolvedPeriod = { ...prevRange, label: prevRange.label || formatRangeBR(prevRange) };
    const txs = await loadTransactions(ctx.db, ctx.userId, { range: { from: prev.from < cur.from ? prev.from : cur.from, to: prev.to > cur.to ? prev.to : cur.to } });
    const r = comparePeriods(txs, l.categories, cur, prev, { accountIds: acc.ids, categoryIds: cat.ids });
    const top = r.categories.filter((x) => x.changeCents !== 0).slice(0, 5);
    const text = r.current.totalCents === 0 && r.previous.totalCents === 0
      ? `Não há despesas em nenhum dos dois períodos (${formatRangeBR(cur)} e ${formatRangeBR(prev)}).`
      : `Despesas em ${formatRangeBR(cur)}: ${formatBRL(r.current.totalCents)}; em ${formatRangeBR(prev)}: ${formatBRL(r.previous.totalCents)} (${r.totalChangeCents >= 0 ? "+" : ""}${formatBRL(r.totalChangeCents)}, ${formatBasisPoints(r.totalChangeBp)}).` +
        (top.length ? `\nMaiores variações:\n${top.map((x) => `- ${x.name}: ${formatBRL(x.previousCents)} → ${formatBRL(x.currentCents)} (${x.changeCents >= 0 ? "+" : ""}${formatBRL(x.changeCents)}, ${formatBasisPoints(x.changeBp)})`).join("\n")}` : "");
    return {
      data: {
        current: { ...cur, totalCents: r.current.totalCents },
        previous: { ...prev, totalCents: r.previous.totalCents },
        totalChangeCents: r.totalChangeCents,
        totalChangePercent: formatBasisPoints(r.totalChangeBp),
        categories: r.categories.map((x) => ({ name: x.name, currentCents: x.currentCents, previousCents: x.previousCents, changeCents: x.changeCents, changePercent: formatBasisPoints(x.changeBp) })),
      },
      evidence: {
        tool: "comparePeriods",
        period: { from: cur.from, to: cur.to, label: `${formatRangeBR(cur)} comparado com ${formatRangeBR(prev)}`, defaulted: cur.defaulted },
        filters: { accounts: acc.names, categories: cat.names },
        sources: top.slice(0, 3).flatMap((x) => [
          listLink(cur, { categoryId: x.categoryId === "sem-categoria" ? undefined : x.categoryId, accountIds: acc.ids, label: `${x.name} em ${formatRangeBR(cur)}` }),
          listLink(prev, { categoryId: x.categoryId === "sem-categoria" ? undefined : x.categoryId, accountIds: acc.ids, label: `${x.name} em ${formatRangeBR(prev)}` }),
        ]),
        notes: [...(input.current || input.previous ? [] : ["Comparei o mês atual até hoje com o mesmo número de dias do mês anterior, para não distorcer a comparação."])],
      },
      text,
    };
  },
});

const getCashFlowSummary = defineTool({
  name: "getCashFlowSummary",
  description: "Receitas, despesas e resultado (entradas menos saídas) em um período, com evolução semanal.",
  input: z.object({ period: PeriodInput.optional(), accounts: Filters.accounts }).strict(),
  async run(ctx, input) {
    const l = await base(ctx);
    const acc = resolveRefs(input.accounts, l.accounts, "conta");
    const c = clarify("getCashFlowSummary", { accounts: acc.unknown, categories: [] }, l);
    if (c) return c;
    const p = resolvePeriod(input.period, ctx.today);
    const txs = await loadTransactions(ctx.db, ctx.userId, { range: p });
    const r = cashFlow(txs, l.categories, p, { accountIds: acc.ids }, "week");
    const byId = new Map(txs.map((t) => [t.id, t]));
    return {
      data: { period: p, incomeCents: r.incomeCents, expenseCents: r.expenseCents, netCents: r.netCents, weeks: r.buckets.map((b) => ({ from: b.from, to: b.to, incomeCents: b.incomeCents, expenseCents: b.expenseCents })) },
      evidence: {
        tool: "getCashFlowSummary",
        period: periodEv(p),
        filters: { accounts: acc.names, categories: [] },
        sources: [...r.incomeTransactionIds.slice(0, 4).map((id) => txLink(byId.get(id)!)), listLink(p, { accountIds: acc.ids })],
        notes: [...defaultedNote(p), "Transferências entre suas contas e pagamentos de fatura não entram como receita nem despesa."],
      },
      text: `Em ${p.label}: receitas ${formatBRL(r.incomeCents)}, despesas ${formatBRL(r.expenseCents)}, resultado ${formatBRL(r.netCents)}.`,
    };
  },
});

const listRecurring = defineTool({
  name: "listRecurringTransactions",
  description: "Assinaturas, parcelas e receitas recorrentes detectadas, com a próxima data prevista.",
  input: z.object({}).strict(),
  async run(ctx) {
    const l = await base(ctx);
    // Read-only: computed on the fly (the stored copy is refreshed on import/sync).
    const items = detectRecurring(await loadTransactions(ctx.db, ctx.userId), l.categories, ctx.today);
    const upcoming = items.filter((i) => i.nextDate <= addDays(ctx.today, 45));
    const label = (k: string) => ({ subscription: "assinatura", installment: "parcela", income: "receita" })[k] ?? k;
    return {
      data: { items: items.map((i) => ({ label: sanitizeUntrusted(i.label), kind: i.kind, amountCents: i.amountCents, amount: formatBRL(i.amountCents), nextDate: i.nextDate, remainingInstallments: i.remainingInstallments, account: l.accounts.find((a) => a.id === i.accountId)?.name })) },
      evidence: {
        tool: "listRecurringTransactions",
        filters: { accounts: [], categories: [] },
        sources: items.slice(0, MAX_TX_LINKS).map((i) => ({ label: `Último lançamento: ${sanitizeUntrusted(i.label, 40)}`, href: `/transacoes/${i.lastTransactionId}` })),
        notes: ["Recorrência estimada a partir do histórico: mesmo estabelecimento em meses consecutivos, com valor e dia parecidos. A data prevista não é garantia de cobrança."],
      },
      text: items.length
        ? `Próximas cobranças e recorrências:\n${upcoming.map((i) => `- ${formatDateBR(i.nextDate)} · ${sanitizeUntrusted(i.label, 50)} (${label(i.kind)}${i.remainingInstallments ? `, faltam ${i.remainingInstallments}` : ""}): ${formatBRL(i.amountCents)}`).join("\n")}`
        : "Não encontrei cobranças recorrentes no histórico disponível (é preciso ao menos dois meses consecutivos).",
    };
  },
});

const detectDuplicates = defineTool({
  name: "detectPossibleDuplicates",
  description: "Procura possíveis cobranças duplicadas (mesmo estabelecimento, valor semelhante, até 3 dias). Resultado é suspeita, não fraude.",
  input: z.object({ period: PeriodInput.optional() }).strict(),
  async run(ctx, input) {
    const l = await base(ctx);
    const p = resolvePeriod(input.period, ctx.today, "last_30_days");
    const txs = await loadTransactions(ctx.db, ctx.userId, { range: p });
    const pairs = detectPossibleDuplicates(txs);
    return {
      data: { period: p, pairs: pairs.map((x) => ({ a: txData(x.a, l), b: txData(x.b, l), daysApart: x.daysApart, reason: x.reason })) },
      evidence: {
        tool: "detectPossibleDuplicates",
        period: periodEv(p),
        filters: { accounts: [], categories: [] },
        sources: pairs.slice(0, 4).flatMap((x) => [txLink(x.a), txLink(x.b)]),
        notes: [...defaultedNote(p), "São apenas suspeitas: confira com o extrato oficial e, se for o caso, contate a instituição."],
      },
      text: pairs.length
        ? `Encontrei ${pairs.length} possível(is) duplicidade(s) em ${p.label}:\n${pairs.map((x) => `- ${sanitizeUntrusted(x.a.description, 40)}: ${formatBRL(x.a.amountCents)} em ${formatDateBR(x.a.date)} e ${formatBRL(x.b.amountCents)} em ${formatDateBR(x.b.date)} (${x.reason})`).join("\n")}`
        : `Não encontrei possíveis duplicidades em ${p.label}.`,
    };
  },
});

const getCreditCardSummary = defineTool({
  name: "getCreditCardSummary",
  description: "Faturas do cartão de crédito: a próxima a vencer (com o total informado pelo banco quando ele compartilhou), o ciclo aberto com o valor lançado até agora, limite usado e disponível.",
  input: z.object({ account: z.string().max(80).optional().describe("Nome ou id do cartão") }).strict(),
  async run(ctx, input) {
    const l = await base(ctx);
    const cards = await loadCards(ctx.db, ctx.userId);
    const cardAccounts = l.accounts.filter((a) => a.type === "credit_card");
    const acc = resolveRefs(input.account ? [input.account] : undefined, cardAccounts, "conta");
    const c = clarify("getCreditCardSummary", { accounts: acc.unknown, categories: [] }, { ...l, accounts: cardAccounts });
    if (c) return c;
    const selected = cards.filter((k) => !acc.ids || acc.ids.includes(k.accountId));
    if (!selected.length) {
      return { data: { cards: [] }, evidence: { tool: "getCreditCardSummary", filters: { accounts: [], categories: [] }, sources: [] }, text: "Não há cartão de crédito cadastrado." };
    }
    const txs = await loadTransactions(ctx.db, ctx.userId, { accountIds: selected.map((k) => k.accountId), includeFuture: true, today: ctx.today });
    const balances = accountBalances(cardAccounts, txs, ctx.today);
    const summaries = selected.map((k) => {
      const name = cardAccounts.find((a) => a.id === k.accountId)?.name ?? "Cartão";
      const statements = cardStatements(k, txs, l.categories, ctx.today);
      const sum = creditCardSummary(k, txs, l.categories, balances.find((b) => b.id === k.accountId)?.balanceCents ?? 0, ctx.today, statements.find((st) => st.status === "open") ?? statements[0]);
      const next = nextStatement(statements, ctx.today);
      const left = k.availableCents ?? sum.availableCents;
      return { name, accountId: k.accountId, ...sum, next, left, leftFromBank: k.availableCents != null, closingDayEstimated: k.closingDaySource === "estimated" };
    });
    return {
      data: {
        cards: summaries.map((x) => ({
          name: x.name,
          cycle: x.cycle,
          dueDate: x.dueDate,
          statementCents: x.statementCents,
          usedCents: x.usedCents,
          limitCents: x.limitCents,
          estimatedLeftCents: x.limitCents > 0 && !x.leftFromBank ? x.availableCents : null,
          availableFromBankCents: x.leftFromBank ? x.left : null,
          closingDayEstimated: x.closingDayEstimated,
          nextBill: x.next ? { dueDate: x.next.dueDate, totalCents: x.next.totalCents, bankTotalCents: x.next.bankTotalCents, entriesCents: x.next.computedCents, status: x.next.status } : null,
        })),
      },
      evidence: {
        tool: "getCreditCardSummary",
        period: summaries[0] ? { ...summaries[0].cycle, label: `ciclo da fatura atual (${formatRangeBR(summaries[0].cycle)})`, defaulted: false } : undefined,
        filters: { accounts: summaries.map((x) => x.name), categories: [] },
        sources: summaries.map((x) => listLink(x.cycle, { accountIds: [x.accountId], label: `Lançamentos da fatura ${x.name}` })),
        notes: [
          "Quando o banco compartilha a fatura, o total dela é o do banco. Sem isso, o valor é a soma dos lançamentos importados, e a fatura oficial do emissor prevalece.",
          "Sobra estimada é o limite menos o que foi lançado. O banco também pode reservar parcelas futuras e compras em processamento.",
          ...(summaries.some((x) => x.closingDayEstimated) ? ["O dia de fechamento de pelo menos um cartão é estimado: o Open Finance não informa esse dia. Confira em Configurações."] : []),
        ],
      },
      text: summaries
        .map((x) => {
          const limit = x.limitCents <= 0
            ? `Usado ${formatBRL(x.usedCents)}. Limite não informado.`
            : x.leftFromBank
              ? `Limite usado ${formatBRL(x.usedCents)} de ${formatBRL(x.limitCents)}; disponível informado pelo banco: ${formatBRL(x.left)}.`
              : `Limite usado ${formatBRL(x.usedCents)} de ${formatBRL(x.limitCents)} (sobra estimada ${formatBRL(x.availableCents)}, não é o disponível do banco).`;
          const due = x.next && x.next.status === "closed"
            ? `Fatura fechada de ${formatBRL(x.next.totalCents)} vence em ${formatDateBR(x.next.dueDate)}${x.next.bankTotalCents !== null ? " (valor informado pelo banco)" : ""}. `
            : "";
          return `${x.name}: ${due}fatura atual (${formatRangeBR(x.cycle)}) com ${formatBRL(x.statementCents)} lançados até agora, vence em ${formatDateBR(x.dueDate)}. ${limit}`;
        })
        .join("\n"),
    };
  },
});

const listActiveAgents = defineTool({
  name: "listActiveAgents",
  description: "Lista os agentes proativos do usuário e seus estados.",
  input: z.object({}).strict(),
  async run(ctx) {
    const rows = await ctx.db.select().from(s.agentRules).where(and(eq(s.agentRules.userId, ctx.userId), ne(s.agentRules.status, "draft")));
    const statusLabel = { active: "ativo", paused: "pausado", draft: "rascunho" } as const;
    return {
      data: { agents: rows.map((r) => ({ id: r.id, name: r.name, kind: r.kind, status: r.status })) },
      evidence: { tool: "listActiveAgents", filters: { accounts: [], categories: [] }, sources: [{ label: "Abrir Meus avisos", href: "/agentes" }] },
      text: rows.length ? `Seus avisos:\n${rows.map((r) => `- ${r.name} (${KIND_LABEL[r.kind]}): ${statusLabel[r.status]}`).join("\n")}` : "Você ainda não tem avisos configurados.",
    };
  },
});

const DraftInput = z
  .object({
    name: z.string().min(2).max(80),
    kind: z.enum(AGENT_KINDS),
    accounts: Filters.accounts,
    categories: Filters.categories,
    thresholdCents: z.number().int().positive().optional().describe("Valor limite em centavos (ex.: R$ 200 = 20000)"),
    schedule: z.enum(SCHEDULES).optional(),
    sourceText: z.string().max(500).describe("Pedido original do usuário"),
  })
  .strict();

const createAgentDraftTool = defineTool({
  name: "createAgentDraft",
  description:
    "Cria um RASCUNHO de agente proativo a partir do pedido do usuário. Nunca ativa: o usuário revisa e confirma na tela. Tipos: daily_spend_limit, weekly_summary, possible_duplicate, monthly_comparison.",
  input: DraftInput,
  async run(ctx, input) {
    const l = await base(ctx);
    const acc = resolveRefs(input.accounts, l.accounts, "conta");
    const cat = resolveRefs(input.categories, l.categories, "categoria");
    const c = clarify("createAgentDraft", { accounts: acc.unknown, categories: cat.unknown }, l);
    if (c) return c;
    const parsed = AgentRuleSchema.safeParse({
      name: input.name,
      kind: input.kind,
      filters: acc.ids || cat.ids ? { ...(acc.ids ? { accountIds: acc.ids } : {}), ...(cat.ids ? { categoryIds: cat.ids } : {}) } : undefined,
      thresholdCents: input.thresholdCents,
      schedule: input.schedule,
      timezone: "America/Sao_Paulo",
      enabled: true,
    });
    if (!parsed.success) {
      const msg = `Preciso de mais detalhes para criar o aviso: ${parsed.error.issues.map((i) => i.message).join("; ")}`;
      return { data: { needsClarification: msg }, evidence: { tool: "createAgentDraft", filters: { accounts: [], categories: [] }, sources: [] }, text: msg, clarification: msg };
    }
    const id = await createAgentDraft(ctx.db, ctx.userId, parsed.data, { origin: "natural_language", sourceText: input.sourceText });
    const summary = describeRule(parsed.data, {
      accounts: new Map(l.accounts.map((a) => [a.id, a.name])),
      categories: new Map(l.categories.map((x) => [x.id, x.name])),
    });
    return {
      data: { draftId: id, status: "draft", summary },
      evidence: {
        tool: "createAgentDraft",
        filters: { accounts: acc.names, categories: cat.names },
        sources: [{ label: "Revisar e confirmar o aviso", href: `/agentes?rascunho=${id}` }],
        notes: ["O aviso ainda NÃO está ligado. Ele só começa depois que você confirmar."],
      },
      text: `Preparei um rascunho de aviso "${parsed.data.name}":\n${summary.map((x) => `- ${x}`).join("\n")}\nRevise e confirme para ligá-lo.`,
      draftAgentId: id,
    };
  },
});

export const TOOLS: ToolDef[] = [
  getAccounts,
  getConsolidatedBalance,
  getTransactions,
  getSpendingByCategory,
  comparePeriodsTool,
  getCashFlowSummary,
  listRecurring,
  detectDuplicates,
  getCreditCardSummary,
  listActiveAgents,
  createAgentDraftTool,
];

export function findTool(name: string): ToolDef | undefined {
  return TOOLS.find((t) => t.name === name);
}

/** Validates model-provided input and runs the tool. Invalid input is reported back, never executed. */
export async function runTool(ctx: ToolContext, name: string, rawInput: unknown): Promise<ToolResult> {
  const tool = findTool(name);
  if (!tool) throw new Error(`Ferramenta desconhecida: ${name}`);
  const parsed = tool.input.safeParse(rawInput ?? {});
  if (!parsed.success) {
    const msg = `Entrada inválida para ${name}: ${parsed.error.issues.map((i) => `${i.path.join(".")} ${i.message}`).join("; ")}`;
    return { data: { error: msg }, evidence: { tool: name, filters: { accounts: [], categories: [] }, sources: [] }, text: msg, clarification: msg };
  }
  return tool.run(ctx, parsed.data);
}
