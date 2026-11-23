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
  continuous: "confere a cada compra nova ou extrato importado, e uma vez por dia",
  daily: "uma vez por dia",
  weekly_monday: "toda segunda-feira de manhã",
  monthly_first: "todo dia 1º de manhã",
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
      lines.push(`Manda um resumo da semana anterior (de segunda a domingo), com o que mais pesou e o que mais mudou, ${scope}.`);
      break;
    case "possible_duplicate":
      lines.push(`Procura cobranças com mesmo estabelecimento, valor semelhante e até 3 dias de diferença ${scope}. É só uma suspeita, para você conferir.`);
      break;
    case "monthly_comparison":
      lines.push(`Compara os gastos deste mês com os mesmos dias do mês passado e mostra o que mais mudou, ${scope}.`);
      break;
  }
  lines.push(`Quando: ${SCHEDULE_LABEL[r.schedule]}, no horário de Brasília.`);
  if (opts.draft) lines.push(r.enabled ? "Começa a valer depois que você confirmar." : "Fica pausado depois que você confirmar.");
  return lines;
}
