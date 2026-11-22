// AgentRule: the only shape an agent can take. The LLM may propose one, but it is validated here,
// stored as data and executed by deterministic evaluators. No SQL, code or free-form cron is accepted.
import { z } from "zod";
import { formatBRL } from "../money";

export const AGENT_KINDS = ["daily_spend_limit", "weekly_summary", "possible_duplicate", "monthly_comparison"] as const;
export type AgentKind = (typeof AGENT_KINDS)[number];

// Schedules are a closed set of presets, not cron expressions.
export const SCHEDULES = ["continuous", "daily", "weekly_monday", "monthly_first"] as const;
export type Schedule = (typeof SCHEDULES)[number];

const id = z.string().min(1).max(64);

export const AgentRuleSchema = z
  .object({
    name: z.string().trim().min(2).max(80),
    kind: z.enum(AGENT_KINDS),
    filters: z
      .object({
        accountIds: z.array(id).max(20).optional(),
        categoryIds: z.array(id).max(20).optional(),
      })
      .strict()
      .optional(),
    thresholdCents: z.number().int().positive().max(100_000_000_00).optional(),
    schedule: z.enum(SCHEDULES).optional(),
    timezone: z.literal("America/Sao_Paulo"),
    enabled: z.boolean(),
  })
  .strict()
  .superRefine((r, ctx) => {
    if (r.kind === "daily_spend_limit" && !r.thresholdCents) {
      ctx.addIssue({ code: "custom", path: ["thresholdCents"], message: "Informe o valor limite diário." });
    }
  });

export type AgentRule = z.infer<typeof AgentRuleSchema>;

export const DEFAULT_SCHEDULE: Record<AgentKind, Schedule> = {
  daily_spend_limit: "continuous",
  weekly_summary: "weekly_monday",
  possible_duplicate: "daily",
  monthly_comparison: "weekly_monday",
};

export const KIND_LABEL: Record<AgentKind, string> = {
  daily_spend_limit: "Limite diário de gastos",
  weekly_summary: "Resumo semanal",
  possible_duplicate: "Possível cobrança duplicada",
  monthly_comparison: "Comparação mensal",
};

export const SCHEDULE_LABEL: Record<Schedule, string> = {
  continuous: "verifica a cada lançamento ou importação e na verificação periódica",
  daily: "uma vez por dia",
  weekly_monday: "toda segunda-feira, a partir das 8h",
  monthly_first: "todo dia 1º, a partir das 8h",
};

export function normalizeRule(rule: AgentRule): AgentRule & { schedule: Schedule } {
  return { ...rule, schedule: rule.schedule ?? DEFAULT_SCHEDULE[rule.kind] };
}

/** Human-readable summary shown before the user confirms a rule. */
export function describeRule(
  rule: AgentRule,
  names: { accounts: Map<string, string>; categories: Map<string, string> },
  opts: { draft?: boolean } = { draft: true },
): string[] {
  const r = normalizeRule(rule);
  const lines: string[] = [];
  const cats = r.filters?.categoryIds?.map((c) => names.categories.get(c) ?? "categoria desconhecida");
  const accs = r.filters?.accountIds?.map((a) => names.accounts.get(a) ?? "conta desconhecida");
  const scope = `${cats?.length ? `nas categorias ${cats.join(", ")}` : "em todas as categorias"}${accs?.length ? `, contas ${accs.join(", ")}` : ", em todas as contas"}`;
  switch (r.kind) {
    case "daily_spend_limit":
      lines.push(`Avisa quando as despesas de um mesmo dia passarem de ${formatBRL(r.thresholdCents ?? 0)} ${scope}.`);
      break;
    case "weekly_summary":
      lines.push(`Gera um resumo da semana anterior (segunda a domingo) com as principais categorias e variações ${scope}.`);
      break;
    case "possible_duplicate":
      lines.push(`Procura cobranças com mesmo estabelecimento, valor semelhante e até 3 dias de diferença ${scope}. Marca como suspeita, nunca como fraude.`);
      break;
    case "monthly_comparison":
      lines.push(`Compara o mês corrente com o mesmo intervalo de dias do mês anterior e destaca as maiores variações ${scope}.`);
      break;
  }
  lines.push(`Frequência: ${SCHEDULE_LABEL[r.schedule]} (fuso America/Sao_Paulo).`);
  if (opts.draft) lines.push(r.enabled ? "Será ativado após sua confirmação." : "Ficará pausado após a confirmação.");
  return lines;
}
