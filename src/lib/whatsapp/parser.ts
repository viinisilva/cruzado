// Deterministic reading of short pt-BR messages. It only proposes fields: identity, ownership, limits and
// persistence are decided by the server. The text is hostile data and never reaches anything that executes.
import type { PaymentMethod } from "@/db/schema";
import { addDays, addMonths, daysInMonth, isValidYmd } from "../dates";
import { parseMoneyToCents } from "../money";
import { stripAccents } from "../text";

export type ParserAccount = { id: string; name: string; institution: string; type: string };

export type ParsedEntry = {
  kind: "entry";
  direction: "expense" | "income";
  amountCents?: number;
  description?: string;
  paymentMethod?: PaymentMethod;
  accountId?: string;
  date: string;
  /** The words leave doubt about what happened: confirm before recording, whatever the mode. */
  needsReview: boolean;
};

export type Parsed =
  | ParsedEntry
  | { kind: "confirm" | "cancel" | "undo" | "question" | "future" | "transfer" | "multiple" | "unknown" }
  | { kind: "correction"; amountCents: number | null };

const AMOUNT = /(?<![a-z0-9/])(?:r\$\s*)?(\d[\d.,]*\d|\d)(\s*mil\b)?(?![a-z0-9/])/g;
const UNITS = /\b(reais|real|conto|contos|pila)\b/g;
const EXPENSE = /\b(gastei|gasto|paguei|pago|comprei|torrei|almocei|jantei|abasteci)\b/;
const INCOME = /\b(recebi|ganhei|caiu|entrou|vendi)\b/;
const ALL_VERBS = /\b(gastei|gasto|paguei|pago|comprei|torrei|recebi|ganhei|caiu|entrou|vendi|foi)\b/g;
const METHODS: [RegExp, PaymentMethod][] = [
  [/\bpix\b/, "pix"],
  [/\b(cartao de credito|credito)\b/, "credito"],
  [/\b(cartao de debito|debito)\b/, "debito"],
  [/\bdinheiro\b/, "dinheiro"],
  [/\bboleto\b/, "boleto"],
  [/\b(ted|doc)\b/, "transferencia"],
];
const METHOD_WORDS = /\b(?:(?:no|na|pelo|pela|via|com|de|em|por)\s+)?(?:o\s+|um\s+|uma\s+)?(pix|cartao de credito|cartao de debito|credito|debito|dinheiro|boleto|ted|doc)\b/g;
const EDGE_WORDS = /^(?:(?:no|na|nos|nas|em|num|numa|de|do|da|dos|das|com|pra|para|pro|pelo|pela|um|uma|uns|umas|o|a|os|as|e|por|hoje|agora)\s+|[\s,.;:!-]+)+|(?:\s+(?:no|na|em|de|do|da|com|pra|para|pelo|pela|e|por)|[\s,.;:!?-]+)+$/;

const norm = (t: string) => [...t.normalize("NFC")].map((c) => stripAccents(c).toLowerCase()[0] ?? " ").join("");

export function resolveDate(n: string, today: string): string | null {
  if (/\banteontem\b/.test(n)) return addDays(today, -2);
  if (/\bontem\b/.test(n)) return addDays(today, -1);
  const full = n.match(/(?<![\d/])(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?(?![\d/])/);
  if (full) {
    const year = full[3] ? (full[3].length === 2 ? `20${full[3]}` : full[3]) : today.slice(0, 4);
    const candidate = `${year}-${full[2]!.padStart(2, "0")}-${full[1]!.padStart(2, "0")}`;
    if (!isValidYmd(candidate)) return null;
    return !full[3] && candidate > today ? addMonths(candidate, -12) : candidate;
  }
  const day = n.match(/\bdia (\d{1,2})\b/);
  if (day) {
    const d = Number(day[1]);
    const month = d <= Number(today.slice(8)) ? today : addMonths(`${today.slice(0, 7)}-01`, -1);
    const [y, m] = month.split("-").map(Number) as [number, number];
    if (d < 1 || d > daysInMonth(y, m)) return null;
    return `${month.slice(0, 7)}-${String(d).padStart(2, "0")}`;
  }
  return today;
}

export function amountFrom(text: string): number | null {
  const m = [...norm(text).matchAll(AMOUNT)];
  return m.length === 1 ? centsOf(m[0]!) : null;
}

function centsOf(m: RegExpMatchArray): number | null {
  const cents = parseMoneyToCents(m[1]!);
  return cents === null ? null : m[2] ? cents * 1000 : cents;
}

export function matchAccount(text: string, accounts: ParserAccount[]): ParserAccount | undefined {
  const n = norm(text);
  const hit = (label: string) => new RegExp(`(?<![a-z0-9])${norm(label).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![a-z0-9])`).test(n);
  const byLength = [...accounts].sort((a, b) => b.name.length - a.name.length);
  return byLength.find((a) => hit(a.name)) ?? byLength.find((a) => hit(a.institution));
}

export function parseMessage(raw: string, accounts: ParserAccount[], today: string): Parsed {
  const original = raw.normalize("NFC").replace(/\s+/g, " ").trim().slice(0, 500);
  // Both strings keep the same length, so a match in `n` blanks the same span of the text the user typed.
  let text = original;
  let n = norm(original);
  const blank = (re: RegExp) => {
    const flags = re.flags.includes("g") ? re.flags : `${re.flags}g`;
    for (const m of [...n.matchAll(new RegExp(re.source, flags))]) {
      const spaces = " ".repeat(m[0].length);
      n = n.slice(0, m.index) + spaces + n.slice(m.index + m[0].length);
      text = text.slice(0, m.index) + spaces + text.slice(m.index + m[0].length);
    }
  };

  if (/^(sim|s|confirmar|confirma|confirmo|ok|pode|isso)[.!]?$/.test(n)) return { kind: "confirm" };
  if (/^(nao|n|cancelar|cancela|cancele)[.!]?$/.test(n)) return { kind: "cancel" };
  if (/^(desfazer|desfaz|desfaca|apagar|apaga)\b/.test(n)) return { kind: "undo" };
  const fix = n.match(/^(?:corrigir|corrige|corrija|mudar|muda)\b(?:\s+(?:para|pra))?\s*(.*)$/);
  if (fix) return { kind: "correction", amountCents: amountFrom(fix[1] ?? "") };
  if (n.endsWith("?") || /^(quanto|qual|quais|quando|como|cade|onde|por que|porque|saldo|extrato)\b/.test(n)) return { kind: "question" };
  if (/\bnao (gastei|paguei|comprei|recebi)\b/.test(n)) return { kind: "unknown" };
  if (/\b(vou|irei|vamos|pretendo|preciso|devo|quero)\b/.test(n) || /\b(amanha|depois de amanha|semana que vem|mes que vem)\b/.test(n)) return { kind: "future" };
  if (/\bentre (as |minhas |as minhas )?contas\b|\b(para|pra|pro) (a |o )?(minha|meu)\b.*\b(conta|poupanca)\b|\bmesma titularidade\b/.test(n)) return { kind: "transfer" };

  const account = matchAccount(original, accounts);
  if (account) {
    for (const label of [account.name, account.institution]) {
      blank(new RegExp(`(?:\\b(?:no|na|pelo|pela|do|da|via|com|em|de)\\s+)?(?:cartao\\s+(?:do\\s+|da\\s+)?)?(?<![a-z0-9])${norm(label).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![a-z0-9])`));
    }
  }
  const date = resolveDate(n, today);
  blank(/(?<![\d/])\d{1,2}\/\d{1,2}(?:\/\d{2,4})?(?![\d/])/);
  blank(/\b(?:dia \d{1,2}|anteontem|ontem|hoje)\b/);

  const amounts = [...n.matchAll(AMOUNT)];
  if (amounts.length > 1) return { kind: "multiple" };
  const amountCents = amounts[0] ? (centsOf(amounts[0]) ?? undefined) : undefined;
  const paymentMethod = METHODS.find(([re]) => re.test(n))?.[1] ?? (/\bcartao\b/.test(n) ? "credito" : undefined);
  const income = INCOME.test(n);
  const expense = EXPENSE.test(n);
  if (!income && !expense && amountCents === undefined) return { kind: "unknown" };
  if (date === null) return { kind: "unknown" };

  blank(AMOUNT);
  blank(UNITS);
  blank(METHOD_WORDS);
  blank(/\bcartao\b/);
  blank(ALL_VERBS);
  let description = text.replace(/\s+/g, " ").trim();
  for (let previous = ""; previous !== description; ) {
    previous = description;
    const lowered = norm(description);
    const start = lowered.match(EDGE_WORDS);
    if (start?.index !== undefined) description = (description.slice(0, start.index) + description.slice(start.index + start[0].length)).trim();
  }
  description = description.slice(0, 120);

  return {
    kind: "entry",
    direction: income ? "income" : "expense",
    amountCents,
    description: description.length >= 2 ? description[0]!.toUpperCase() + description.slice(1) : undefined,
    paymentMethod,
    accountId: account?.id,
    date,
    // No verb says nothing about what happened, and a Pix received may be a refund or money between own accounts.
    needsReview: (!income && !expense) || (income && paymentMethod === "pix"),
  };
}
