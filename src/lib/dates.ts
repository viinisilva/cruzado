// Calendar dates are "YYYY-MM-DD" strings in America/Sao_Paulo. Date math runs in UTC on those strings.
export const TIMEZONE = "America/Sao_Paulo" as const;

export type DateRange = { from: string; to: string }; // inclusive

const ymdFmt = new Intl.DateTimeFormat("en-CA", { timeZone: TIMEZONE, year: "numeric", month: "2-digit", day: "2-digit" });
const hourFmt = new Intl.DateTimeFormat("en-US", { timeZone: TIMEZONE, hour: "2-digit", hourCycle: "h23" });

export function todayInSaoPaulo(now: Date = new Date()): string {
  return ymdFmt.format(now);
}

export function hourInSaoPaulo(now: Date): number {
  return Number(hourFmt.formatToParts(now).find((p) => p.type === "hour")?.value ?? "0");
}

export function isValidYmd(s: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

const toUtc = (s: string) => new Date(`${s}T00:00:00Z`);
const fromUtc = (d: Date) => d.toISOString().slice(0, 10);

export function addDays(s: string, days: number): string {
  const d = toUtc(s);
  d.setUTCDate(d.getUTCDate() + days);
  return fromUtc(d);
}

export function daysInMonth(year: number, month1: number): number {
  return new Date(Date.UTC(year, month1, 0)).getUTCDate();
}

/** Adds months clamping the day (31/01 + 1 month = 28 or 29/02). */
export function addMonths(s: string, months: number): string {
  const d = toUtc(s);
  const day = d.getUTCDate();
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() + months);
  d.setUTCDate(Math.min(day, daysInMonth(d.getUTCFullYear(), d.getUTCMonth() + 1)));
  return fromUtc(d);
}

export function diffDays(a: string, b: string): number {
  return Math.round((toUtc(b).getTime() - toUtc(a).getTime()) / 86_400_000);
}

/** 0 = Sunday … 6 = Saturday */
export function weekday(s: string): number {
  return toUtc(s).getUTCDay();
}

export function startOfMonth(s: string): string {
  return `${s.slice(0, 7)}-01`;
}

export function endOfMonth(s: string): string {
  const [y, m] = s.split("-").map(Number) as [number, number];
  return `${s.slice(0, 7)}-${String(daysInMonth(y, m)).padStart(2, "0")}`;
}

export function monthRange(s: string): DateRange {
  return { from: startOfMonth(s), to: endOfMonth(s) };
}

/** Monday of the ISO week containing s. */
export function startOfWeek(s: string): string {
  const wd = weekday(s);
  return addDays(s, wd === 0 ? -6 : 1 - wd);
}

export function inRange(s: string, r: DateRange): boolean {
  return s >= r.from && s <= r.to;
}

const MONTHS = [
  "janeiro", "fevereiro", "março", "abril", "maio", "junho",
  "julho", "agosto", "setembro", "outubro", "novembro", "dezembro",
] as const;

export function monthName(month1: number): string {
  return MONTHS[month1 - 1] ?? "";
}

export function monthNames(): readonly string[] {
  return MONTHS;
}

export function formatDateBR(s: string): string {
  const [y, m, d] = s.split("-");
  return `${d}/${m}/${y}`;
}

export function formatRangeBR(r: DateRange): string {
  return r.from === r.to ? formatDateBR(r.from) : `${formatDateBR(r.from)} a ${formatDateBR(r.to)}`;
}

/** "10 de novembro"; the year only appears when it differs from `today`'s. */
export function formatDayMonth(s: string, today: string): string {
  const [y, m, d] = s.split("-");
  return `${Number(d)} de ${monthName(Number(m))}${y === today.slice(0, 4) ? "" : ` de ${y}`}`;
}

/** "novembro de 2026" */
export function formatMonthYear(s: string): string {
  return `${monthName(Number(s.slice(5, 7)))} de ${s.slice(0, 4)}`;
}

/** Parses dd/mm/yyyy, dd/mm/yy, dd-mm-yyyy (each with an optional time), yyyy-mm-dd and yyyymmdd[hhmmss…] (OFX). */
export function parseFlexibleDate(input: string): string | null {
  const s = input.trim();
  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) {
    const out = `${m[1]}-${m[2]}-${m[3]}`;
    return isValidYmd(out) ? out : null;
  }
  m = s.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})(?:[ T].*)?$/);
  if (m) {
    const year = m[3]!.length === 2 ? `20${m[3]}` : m[3]!;
    const out = `${year}-${m[2]!.padStart(2, "0")}-${m[1]!.padStart(2, "0")}`;
    return isValidYmd(out) ? out : null;
  }
  m = s.match(/^(\d{4})(\d{2})(\d{2})/);
  if (m) {
    const out = `${m[1]}-${m[2]}-${m[3]}`;
    return isValidYmd(out) ? out : null;
  }
  return null;
}
