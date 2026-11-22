// Card credits classified by evidence (docs/AUTOCONCILIACAO.md, section 2). A credit is a refund because the purchase
// it undoes exists, and a bill payment because it matches a bill or a payment the bank recorded. Text and the bank's
// operation type only break ties. Pure: the sync applies the result, the screens show the reason.
import { readsLikeBillPayment, readsLikeCashback } from "../categorizer";
import { addDays, diffDays } from "../dates";
import { stripAccents } from "../text";
import type { BankBill, FinTx } from "./core";

export type CategorySource = "user" | "evidence" | "reconciler" | "keyword";
export type BillPayment = { amountCents: number; date: string; mode: string | null; valueType: string | null };
/** payment: pays the bill (out of it). refund: undoes a purchase. credit: cashback and the like. unknown: no decision. */
export type CreditKind = "payment" | "refund" | "credit" | "unknown";

export type SignalCode =
  | "bill-payment" // matches a payment the bank listed for a bill
  | "bill-total" // equals the total of this card's previous bill, inside its payment window
  | "bill-minimum" // equals the minimum of this card's previous bill, inside its payment window
  | "account-debit" // a bank account debit of the same amount a few days around it
  | "op-bill-payment" // operationType PAGAMENTO_FATURA
  | "op-payment" // operationType PAGAMENTO
  | "text-payment"
  | "refund-pair" // a purchase of the same amount, similar merchant, up to 60 days before
  | "refund-partial" // a larger purchase from a similar merchant
  | "refund-amount" // a purchase of the same amount, other merchant
  | "op-refund"
  | "text-refund"
  | "cashback" // operationType CASHBACK or cashback wording
  | "learned"; // a pattern this institution showed before (reconciliation_rules)

export type Signal = { code: SignalCode; kind: CreditKind; points: 1 | 2 | 3; ref?: string };
export type Classification = {
  version: 1;
  kind: CreditKind;
  /** The signal that decided, or "ambiguous". */
  reason: SignalCode | "ambiguous";
  signals: Signal[];
  /** The purchase a refund undoes. */
  matchedTxId: string | null;
  decidedAt: string;
};

/** A learned pattern as the classifier uses it: features → kind, with the points its confidence earns. */
export type LearnedSignal = { pattern: string; kind: CreditKind; points: 2 | 3 };

const REFUND_DAYS = 60;
const PAYMENT_MATCH_DAYS = 3;
const ACCOUNT_DEBIT_DAYS = 5;
// A bill is paid between its closing and some weeks after its due date.
const PAYMENT_WINDOW_AFTER_DUE = 10;

/**
 * An amount that is unlikely to repeat by chance: it has centavos, or it is R$ 100 or more. Small round credits (R$ 10,
 * R$ 20) match bills, minimums and transfers by coincidence, so pairing by amount alone is never strong for them.
 */
export const distinctive = (cents: number) => cents % 100 !== 0 || cents >= 10000;
const opensOf = (b: BankBill) => b.closingDate ?? addDays(b.dueDate, -10);

// Words about the operation, not the merchant.
const NOISE = new Set(["estorno", "estornado", "pagamento", "pagto", "pgto", "pag", "compra", "credito", "debito", "nupay", "pix", "ted", "doc", "cartao", "parcela", "parc", "recebido", "efetuado", "antecipado", "cashback", "ajuste", "com", "via"]);

/** Merchant tokens of a description: words of 3+ letters that are not about the operation. */
export function merchantTokens(description: string): Set<string> {
  return new Set(
    stripAccents(description)
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((w) => w.length >= 3 && !NOISE.has(w) && !/^\d+$/.test(w)),
  );
}

const similar = (a: Set<string>, b: Set<string>) => [...a].some((w) => b.has(w));
const TEXT_REFUND = /\bestorn/i;

/** Features that describe a credit for learned rules: never the merchant's text. */
export function creditPattern(t: FinTx, signals: Signal[]): string {
  const pair = signals.some((s) => s.code === "refund-pair") ? "strong" : signals.some((s) => s.code === "refund-partial") ? "partial" : "none";
  const text = TEXT_REFUND.test(t.description) ? "refund" : readsLikeCashback(t.description) ? "cashback" : readsLikeBillPayment(t.description) ? "payment" : "other";
  return `op:${t.operationType ?? "-"}|pair:${pair}|text:${text}`;
}

export type ClassifyInput = {
  card: { accountId: string; bills?: BankBill[] };
  /** Every entry of the card account. */
  txs: FinTx[];
  /** Debits from the person's bank accounts (to pair a bill paid from them). */
  cashDebits?: { amountCents: number; date: string }[];
  learned?: LearnedSignal[];
  today: string;
};

/** Classifies every credit of the card. Purchases are paired one to one, the closest in time first. */
export function classifyCardCredits(input: ClassifyInput): Map<string, Classification> {
  const { card, txs, today } = input;
  const mine = txs.filter((t) => t.accountId === card.accountId);
  const credits = mine.filter((t) => t.amountCents > 0).sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id));
  const charges = mine.filter((t) => t.amountCents < 0);
  const bills = card.bills ?? [];
  const used = new Set<string>();
  const out = new Map<string, Classification>();

  for (const c of credits) {
    const signals: Signal[] = [];
    const tokens = merchantTokens(c.description);
    const before = (t: FinTx) => t.date <= c.date && t.date >= addDays(c.date, -REFUND_DAYS) && !used.has(t.id);
    const closest = (a: FinTx, b: FinTx) => b.date.localeCompare(a.date);
    const pair = charges.filter((t) => before(t) && -t.amountCents === c.amountCents && similar(tokens, merchantTokens(t.description))).sort(closest)[0];
    const partial = !pair ? charges.filter((t) => before(t) && -t.amountCents > c.amountCents && similar(tokens, merchantTokens(t.description))).sort(closest)[0] : undefined;
    const sameAmount = !pair && !partial ? charges.filter((t) => before(t) && -t.amountCents === c.amountCents).sort(closest)[0] : undefined;
    if (pair) signals.push({ code: "refund-pair", kind: "refund", points: 3, ref: pair.id });
    else if (partial) signals.push({ code: "refund-partial", kind: "refund", points: 2, ref: partial.id });
    else if (sameAmount) signals.push({ code: "refund-amount", kind: "refund", points: 1, ref: sameAmount.id });

    const listed = bills.flatMap((b) => b.payments ?? []).some((p) => p.amountCents === c.amountCents && Math.abs(diffDays(p.date, c.date)) <= PAYMENT_MATCH_DAYS);
    if (listed) signals.push({ code: "bill-payment", kind: "payment", points: 3 });
    // Only the bill this credit could be paying: this card's latest bill closed by the credit's date, paid between its
    // closing and a few days after its due date. An old bill of the same amount is a coincidence, not evidence.
    const previous = bills.filter((b) => opensOf(b) <= c.date).sort((a, b) => opensOf(b).localeCompare(opensOf(a)))[0];
    const inWindow = previous && c.date <= addDays(previous.dueDate, PAYMENT_WINDOW_AFTER_DUE);
    const sure = distinctive(c.amountCents);
    if (inWindow && previous.totalCents === c.amountCents) signals.push({ code: "bill-total", kind: "payment", points: sure ? 3 : 2, ref: previous.billRef });
    else if (inWindow && previous.minimumCents === c.amountCents) signals.push({ code: "bill-minimum", kind: "payment", points: sure ? 2 : 1, ref: previous.billRef });
    if (input.cashDebits?.some((d) => -d.amountCents === c.amountCents && Math.abs(diffDays(d.date, c.date)) <= ACCOUNT_DEBIT_DAYS)) signals.push({ code: "account-debit", kind: "payment", points: sure ? 2 : 1 });
    if (c.operationType === "PAGAMENTO_FATURA") signals.push({ code: "op-bill-payment", kind: "payment", points: 2 });
    if (c.operationType === "PAGAMENTO") signals.push({ code: "op-payment", kind: "payment", points: 1 });
    if (readsLikeBillPayment(c.description)) signals.push({ code: "text-payment", kind: "payment", points: 1 });
    if (c.operationType === "ESTORNO") signals.push({ code: "op-refund", kind: "refund", points: 1 });
    if (TEXT_REFUND.test(c.description)) signals.push({ code: "text-refund", kind: "refund", points: 1 });
    // The bank or the text saying cashback outweighs any pairing by amount that a small round credit can get.
    if (c.operationType === "CASHBACK" || readsLikeCashback(c.description)) signals.push({ code: "cashback", kind: "credit", points: 3 });

    const pattern = creditPattern(c, signals);
    for (const l of input.learned ?? []) if (l.pattern === pattern) signals.push({ code: "learned", kind: l.kind, points: l.points });

    const decided = decide(signals);
    const matched = decided.kind === "refund" ? (signals.find((s) => s.kind === "refund" && s.ref)?.ref ?? null) : null;
    if (matched && (pair?.id === matched || partial?.id === matched)) used.add(matched);
    out.set(c.id, { version: 1, kind: decided.kind, reason: decided.reason, signals, matchedTxId: matched, decidedAt: today });
  }
  return out;
}

/**
 * Sum the points per kind; the top kind wins with at least one medium or strong signal. A tie, or strong evidence on two
 * sides (a refund the size of the bill), is "unknown": wording must not break that tie, the bank's total will.
 */
export function decide(signals: Signal[]): { kind: CreditKind; reason: SignalCode | "ambiguous" } {
  if (new Set(signals.filter((s) => s.points === 3).map((s) => s.kind)).size > 1) return { kind: "unknown", reason: "ambiguous" };
  const score = new Map<CreditKind, number>();
  for (const s of signals) score.set(s.kind, (score.get(s.kind) ?? 0) + s.points);
  const ranked = [...score.entries()].sort((a, b) => b[1] - a[1]);
  const [top, second] = ranked;
  if (!top || (second && second[1] === top[1])) return { kind: "unknown", reason: "ambiguous" };
  const best = signals.filter((s) => s.kind === top[0]).sort((a, b) => b.points - a.points)[0]!;
  if (best.points < 2) return { kind: "unknown", reason: "ambiguous" };
  return { kind: top[0], reason: best.code };
}

/** True when the classification rests on more than arithmetic and wording: what the reconciler needs to act alone. */
export function hasEvidenceFor(classification: Classification | null | undefined, kind: CreditKind): boolean {
  const real: SignalCode[] = ["bill-payment", "bill-total", "bill-minimum", "account-debit", "op-bill-payment", "op-payment", "refund-pair", "refund-partial", "op-refund", "cashback", "learned"];
  return !!classification?.signals.some((s) => s.kind === kind && real.includes(s.code));
}

/** One sentence for Conferir. */
export const SIGNAL_TEXT: Record<SignalCode | "ambiguous", string> = {
  "bill-payment": "o banco listou este pagamento na fatura",
  "bill-total": "o valor é igual ao total da fatura anterior deste cartão",
  "bill-minimum": "o valor é igual ao pagamento mínimo da fatura anterior deste cartão",
  "account-debit": "saiu o mesmo valor de uma conta sua nos mesmos dias",
  "op-bill-payment": "o banco marcou como pagamento de fatura",
  "op-payment": "o banco marcou como pagamento",
  "text-payment": "o texto diz pagamento",
  "refund-pair": "existe a compra do mesmo valor e do mesmo estabelecimento",
  "refund-partial": "existe uma compra maior do mesmo estabelecimento",
  "refund-amount": "existe uma compra do mesmo valor",
  "op-refund": "o banco marcou como estorno",
  "text-refund": "o texto diz estorno",
  cashback: "é cashback ou crédito do banco",
  learned: "este banco já mostrou esse padrão antes",
  ambiguous: "as evidências empatam; o fechamento da fatura decide",
};
