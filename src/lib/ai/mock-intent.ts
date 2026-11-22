// Rule-based pt-BR intent parser used by MockProvider (demo and tests, no external key).
// It maps a question to tool calls; it never computes numbers itself.
import { addDays, monthNames, isValidYmd } from "../dates";
import { parseMoneyToCents } from "../money";
import { stripAccents } from "../text";
import type { PeriodInput } from "../finance/period";

export type Intent = { calls: { name: string; input: Record<string, unknown> }[] } | { clarify: string };

const norm = (s: string) => stripAccents(s).toLowerCase();

const SYNONYMS: Record<string, string[]> = {
  mercado: ["mercado", "supermercado", "feira", "hortifruti", "compras de casa"],
  moradia: ["moradia", "aluguel", "condominio", "casa", "luz", "energia", "internet"],
  transporte: ["transporte", "uber", "corrida", "combustivel", "gasolina", "carro", "mobilidade"],
  saude: ["saude", "farmacia", "remedio", "medico", "consulta", "clinica"],
  lazer: ["lazer", "cinema", "show", "viagem", "passeio", "diversao"],
  educacao: ["educacao", "curso", "escola", "faculdade", "estudo"],
  assinaturas: ["assinaturas", "assinatura", "streaming"],
  restaurantes: ["restaurantes", "restaurante", "comida fora", "lanche", "delivery", "ifood"],
  compras: ["compras", "loja", "eletrodomestico"],
};

export function parsePeriod(text: string, today: string): PeriodInput | undefined {
  const t = norm(text);
  if (/\bhoje\b/.test(t)) return { from: today, to: today };
  if (/\bontem\b/.test(t)) {
    const y = addDays(today, -1);
    return { from: y, to: y };
  }
  const lastN = t.match(/ultimos?\s+(\d{1,3})\s+dias/);
  if (lastN) return { from: addDays(today, -(Number(lastN[1]) - 1)), to: today };
  if (/semana passada|ultima semana|semana anterior/.test(t)) return { preset: "last_week" };
  if (/(esta|nesta|essa|nessa) semana|semana atual/.test(t)) return { preset: "this_week" };
  if (/mes passado|ultimo mes|mes anterior/.test(t)) return { preset: "last_month" };
  if (/(este|neste|esse|nesse) mes|mes atual|\bno mes\b/.test(t)) return { preset: "this_month" };
  if (/(este|neste|esse|nesse) ano|ano atual/.test(t)) return { preset: "this_year" };
  const dates = [...t.matchAll(/(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?/g)].map((m) => {
    const y = m[3] ? (m[3].length === 2 ? `20${m[3]}` : m[3]) : today.slice(0, 4);
    return `${y}-${m[2]!.padStart(2, "0")}-${m[1]!.padStart(2, "0")}`;
  }).filter(isValidYmd);
  if (dates.length >= 2) return { from: dates[0]!, to: dates[1]! };
  if (dates.length === 1) return { from: dates[0]!, to: dates[0]! };
  const months = monthNames().map(norm);
  for (let i = 0; i < 12; i++) {
    if (new RegExp(`\\b${months[i]}\\b`).test(t)) {
      let year = Number(today.slice(0, 4));
      const mm = String(i + 1).padStart(2, "0");
      if (`${year}-${mm}` > today.slice(0, 7)) year -= 1;
      const last = new Date(Date.UTC(year, i + 1, 0)).getUTCDate();
      const to = `${year}-${mm}-${last}` > today ? today : `${year}-${mm}-${last}`;
      return { from: `${year}-${mm}-01`, to };
    }
  }
  return undefined;
}

function findCategories(text: string, categories: { name: string; slug: string }[]): string[] {
  const t = ` ${norm(text)} `;
  const found: string[] = [];
  for (const c of categories) {
    const words = new Set([norm(c.name), c.slug.replace(/-/g, " "), ...(SYNONYMS[c.slug] ?? [])]);
    if ([...words].some((w) => new RegExp(`[^a-z]${w}s?[^a-z]`).test(t))) found.push(c.name);
  }
  return found;
}

/** "com X" where X is not a known category → pass it through so the tool asks for clarification. */
function unknownCategory(text: string): string | undefined {
  const m = norm(text).match(/\b(?:com|em|de)\s+([a-z]{3,20})(?:\s|\?|$)/);
  const stop = new Set(["mes", "semana", "hoje", "ontem", "ano", "dias", "cartao", "conta", "despesas", "gastos", "media", "total"]);
  return m && !stop.has(m[1]!) && !monthNames().map(norm).includes(m[1]!) ? m[1] : undefined;
}

function parseAmount(text: string): number | undefined {
  const m = text.match(/R\$\s*([\d.,]+)|([\d.,]+)\s*(?:reais|real)\b|\bde\s+([\d.,]+)\b/i);
  const raw = m?.[1] ?? m?.[2] ?? m?.[3];
  if (!raw) return undefined;
  const cents = parseMoneyToCents(raw);
  return cents && cents > 0 ? cents : undefined;
}

export function parseIntent(text: string, ctx: { today: string; categories: { name: string; slug: string; kind: string }[] }): Intent {
  const t = norm(text);
  const period = parsePeriod(text, ctx.today);
  const expenseCats = ctx.categories.filter((c) => c.kind === "expense");
  const cats = findCategories(text, expenseCats);
  const withPeriod = (input: Record<string, unknown>) => (period ? { ...input, period } : input);

  if (/\b(crie|criar|cria|configure|configurar|me avis[ea]|avise-me|me notifique|quero (um )?(agente|alerta)|monitore)\b/.test(t)) {
    const base = { sourceText: text.slice(0, 500), ...(cats.length ? { categories: cats } : {}) };
    if (/duplic/.test(t)) return { calls: [{ name: "createAgentDraft", input: { ...base, name: "Cobranças duplicadas", kind: "possible_duplicate" } }] };
    if (/resumo|toda semana|semanal|toda segunda/.test(t)) return { calls: [{ name: "createAgentDraft", input: { ...base, name: "Resumo semanal", kind: "weekly_summary" } }] };
    if (/compar|mes anterior|mensal/.test(t)) return { calls: [{ name: "createAgentDraft", input: { ...base, name: "Comparação mensal", kind: "monthly_comparison" } }] };
    const amount = parseAmount(text);
    if (/dia|diari|passar de|ultrapass|mais de|acima de|limite/.test(t)) {
      if (!amount) return { clarify: "Qual valor limite por dia você quer usar? Por exemplo: “me avise quando eu gastar mais de R$ 200 por dia com mercado”." };
      const scope = cats.length ? ` com ${cats.join(", ")}` : "";
      return { calls: [{ name: "createAgentDraft", input: { ...base, name: `Limite diário${scope}`, kind: "daily_spend_limit", thresholdCents: amount } }] };
    }
    return { clarify: "Posso criar agentes de quatro tipos: limite diário de gastos, resumo semanal, possível cobrança duplicada e comparação mensal. Qual deles você quer?" };
  }
  if (/\bagentes?\b|alertas ativos/.test(t)) return { calls: [{ name: "listActiveAgents", input: {} }] };
  if (/duplic|cobrad[oa] duas vezes|cobranca repetida/.test(t)) return { calls: [{ name: "detectPossibleDuplicates", input: withPeriod({}) }] };
  if (/assinatura|recorrente|proximas cobrancas|proximos? (pagamentos|vencimentos)|parcela/.test(t)) return { calls: [{ name: "listRecurringTransactions", input: {} }] };
  if (/fatura|limite do cartao|cartao de credito|\bcartao\b/.test(t)) return { calls: [{ name: "getCreditCardSummary", input: {} }] };
  if (/compar|em relacao ao|versus|\bvs\b|aumentou|diminuiu|variacao/.test(t)) {
    return { calls: [{ name: "comparePeriods", input: { ...(period && !("preset" in period && period.preset === "last_month") ? { current: period } : {}), ...(cats.length ? { categories: cats } : {}) } }] };
  }
  if (/saldo|quanto (eu )?tenho|patrimonio|dinheiro disponivel/.test(t)) return { calls: [{ name: "getConsolidatedBalance", input: {} }] };
  if (/\bcontas\b|minhas contas/.test(t)) return { calls: [{ name: "getAccounts", input: {} }] };
  if (/receita|entrada|ganhei|recebi|fluxo|sobrou|economizei|resultado do mes/.test(t)) return { calls: [{ name: "getCashFlowSummary", input: withPeriod({}) }] };
  if (/gast|despesa|paguei|custo|quanto foi|onde (foi|vai) (meu|o) dinheiro/.test(t)) {
    const unknown = cats.length ? undefined : unknownCategory(text);
    return { calls: [{ name: "getSpendingByCategory", input: withPeriod(cats.length ? { categories: cats } : unknown ? { categories: [unknown] } : {}) }] };
  }
  if (/transac|lancamento|extrato|mostre|liste|compras/.test(t)) return { calls: [{ name: "getTransactions", input: withPeriod(cats.length ? { categories: cats } : {}) }] };
  return {
    clarify:
      "Não entendi bem a pergunta. Posso responder, por exemplo: “quanto gastei com mercado neste mês?”, “qual meu saldo?”, “compare meus gastos com o mês passado”, “quais assinaturas eu tenho?” ou “me avise quando gastar mais de R$ 200 por dia”.",
  };
}
