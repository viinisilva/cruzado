import { z } from "zod";
import { addDays, addMonths, endOfMonth, formatRangeBR, isValidYmd, monthName, startOfMonth, startOfWeek, type DateRange } from "../dates";

export const PERIOD_PRESETS = ["this_month", "last_month", "this_week", "last_week", "last_30_days", "last_90_days", "this_year"] as const;
export type PeriodPreset = (typeof PERIOD_PRESETS)[number];

export const PeriodInput = z
  .object({
    preset: z.enum(PERIOD_PRESETS).optional().describe("Período relativo à data de hoje (America/Sao_Paulo)"),
    from: z.string().optional().describe("Data inicial YYYY-MM-DD (inclusiva)"),
    to: z.string().optional().describe("Data final YYYY-MM-DD (inclusiva)"),
  })
  .strict();
export type PeriodInput = z.infer<typeof PeriodInput>;

export type ResolvedPeriod = DateRange & { label: string; defaulted: boolean };

export function presetRange(preset: PeriodPreset, today: string): DateRange {
  switch (preset) {
    case "this_month":
      return { from: startOfMonth(today), to: today };
    case "last_month": {
      const prev = addMonths(startOfMonth(today), -1);
      return { from: prev, to: endOfMonth(prev) };
    }
    case "this_week":
      return { from: startOfWeek(today), to: today };
    case "last_week": {
      const start = addDays(startOfWeek(today), -7);
      return { from: start, to: addDays(start, 6) };
    }
    case "last_30_days":
      return { from: addDays(today, -29), to: today };
    case "last_90_days":
      return { from: addDays(today, -89), to: today };
    case "this_year":
      return { from: `${today.slice(0, 4)}-01-01`, to: today };
  }
}

export const HOME_PERIODS = [
  { id: "mes", label: "Este mês", preset: "this_month" },
  { id: "mes-passado", label: "Mês passado", preset: "last_month" },
  { id: "30d", label: "30 dias", preset: "last_30_days" },
  { id: "90d", label: "90 dias", preset: "last_90_days" },
] as const;

export function homePeriod(id: string | undefined, today: string) {
  const period = HOME_PERIODS.find((p) => p.id === id) ?? HOME_PERIODS[0];
  return { ...period, range: presetRange(period.preset, today) };
}

const PRESET_LABEL: Record<PeriodPreset, (r: DateRange) => string> = {
  this_month: (r) => `${monthName(Number(r.from.slice(5, 7)))} de ${r.from.slice(0, 4)} até hoje`,
  last_month: (r) => `${monthName(Number(r.from.slice(5, 7)))} de ${r.from.slice(0, 4)}`,
  this_week: () => "esta semana (desde segunda-feira)",
  last_week: () => "semana passada (segunda a domingo)",
  last_30_days: () => "últimos 30 dias",
  last_90_days: () => "últimos 90 dias",
  this_year: (r) => `${r.from.slice(0, 4)} até hoje`,
};

/** Resolves a period. When nothing is given, falls back to `fallback` and flags it so the answer says so explicitly. */
export function resolvePeriod(input: PeriodInput | undefined, today: string, fallback: PeriodPreset = "this_month"): ResolvedPeriod {
  if (input?.from || input?.to) {
    const from = input.from ?? input.to!;
    const to = input.to ?? today;
    if (!isValidYmd(from) || !isValidYmd(to)) throw new Error("Datas inválidas: use o formato AAAA-MM-DD.");
    const [a, b] = from <= to ? [from, to] : [to, from];
    return { from: a, to: b, label: formatRangeBR({ from: a, to: b }), defaulted: false };
  }
  const preset = input?.preset ?? fallback;
  const r = presetRange(preset, today);
  return { ...r, label: `${PRESET_LABEL[preset](r)} (${formatRangeBR(r)})`, defaulted: !input?.preset };
}

/** Same-length window in the previous month: day 1..N vs day 1..N. Longer ranges use the window right before them. */
export function previousComparableRange(r: DateRange): DateRange {
  const length = Math.round((Date.parse(r.to) - Date.parse(r.from)) / 86_400_000);
  if (length > 31) {
    const end = addDays(r.from, -1);
    return { from: addDays(end, -length), to: end };
  }
  const from = addMonths(r.from, -1);
  const to = addDays(from, length);
  const prevEnd = endOfMonth(from);
  return { from, to: r.from.slice(8) === "01" && to > prevEnd ? prevEnd : to };
}
