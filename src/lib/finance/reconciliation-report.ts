// The reconciliation report (Cartões › Conciliação › "Baixar relatório"): every proposal waiting for review, with the
// evidence behind it and what it would do to the bills. Pure: it only simulates the category changes in memory, so
// downloading it never changes any data (docs/BANCOS_2026-11.md, item 3).
import { checkStatement } from "./card-check";
import { cardStatements } from "./cards";
import type { CardInfo, FinCategory, FinTx } from "./core";
import type { CreditKind, SignalCode } from "./classify";
import { formatDateBR, formatMonthYear } from "../dates";
import { formatBRL } from "../money";

export type ReportProposal = { id: string; txId: string; accountId: string; before: Record<string, unknown>; after: Record<string, unknown>; reason: string };

export type ReportInput = {
  today: string;
  cards: CardInfo[];
  txs: FinTx[];
  categories: FinCategory[];
  accounts: { id: string; name: string }[];
  proposals: ReportProposal[];
};

export type ReportEvidence = { code: SignalCode; label: string; kind: CreditKind; points: number; ref: string | null };

export type ReportRow = {
  id: string;
  date: string;
  description: string;
  amountCents: number;
  accountName: string;
  from: string;
  to: string;
  reason: string;
  evidence: ReportEvidence[];
  /** The bill (month it comes due) this entry belongs to, if any of the last 12 months. */
  billMonth: string | null;
  /** What this change alone does to that bill's sum of entries. */
  deltaCents: number;
};

export type ReportBill = { accountName: string; month: string; status: "open" | "closed" | "future"; bankTotalCents: number | null; beforeCents: number; afterCents: number; matchesBefore: boolean; matchesAfter: boolean };

export type ReconciliationReport = { today: string; proposals: ReportRow[]; bills: ReportBill[]; skipped: number };

export const SIGNAL_LABEL: Record<SignalCode, string> = {
  "bill-payment": "Bate com um pagamento que o banco listou para a fatura",
  "bill-total": "É igual ao total da fatura anterior, no período de pagamento",
  "bill-minimum": "É igual ao mínimo da fatura anterior, no período de pagamento",
  "account-debit": "Há um débito do mesmo valor numa conta, poucos dias antes ou depois",
  "op-bill-payment": "O banco marcou como pagamento de fatura",
  "op-payment": "O banco marcou como pagamento",
  "text-payment": "O texto diz pagamento",
  "refund-pair": "Existe uma compra do mesmo valor e de comerciante parecido antes dele",
  "refund-partial": "Existe uma compra parecida, de valor maior, antes dele",
  "refund-amount": "Existe uma compra do mesmo valor, de outro comerciante",
  "op-refund": "O banco marcou como estorno",
  "text-refund": "O texto diz estorno",
  cashback: "É cashback",
  learned: "Este banco já mostrou este padrão antes",
};
const KIND_LABEL: Record<CreditKind, string> = { payment: "pagamento", refund: "estorno", credit: "crédito que abate a fatura", unknown: "indefinido" };

/** The months of the last 12 bills and the open one, for one card. */
const monthsOf = (card: CardInfo, txs: FinTx[], cats: FinCategory[], today: string) => cardStatements(card, txs, cats, today, 13).map((s) => s.dueDate.slice(0, 7));

/** The same entries with some proposals applied: only the category changes, as applying would do. */
function withChanges(txs: FinTx[], proposals: ReportProposal[]): FinTx[] {
  const to = new Map(proposals.map((p) => [p.txId, p.after.categoryId]));
  return txs.map((t) => (to.has(t.id) && typeof to.get(t.id) === "string" ? { ...t, categoryId: to.get(t.id) as string } : t));
}

export function buildReconciliationReport(input: ReportInput): ReconciliationReport {
  const { today, cards, txs, categories } = input;
  const byId = new Map(txs.map((t) => [t.id, t]));
  const catName = (id: unknown) => (typeof id === "string" && categories.find((c) => c.id === id)?.name) || "Sem categoria";
  const accName = (id: string) => input.accounts.find((a) => a.id === id)?.name ?? "Cartão";
  const live = input.proposals.filter((p) => byId.has(p.txId));
  const after = withChanges(txs, live);

  const rows: ReportRow[] = [];
  const bills: ReportBill[] = [];
  for (const card of cards) {
    const mine = live.filter((p) => p.accountId === card.accountId);
    if (!mine.length) continue;
    const months = monthsOf(card, txs, categories, today);
    const checks = new Map(months.map((m) => [m, { before: checkStatement(card, txs, categories, today, m), after: checkStatement(card, after, categories, today, m) }]));

    for (const p of mine) {
      const t = byId.get(p.txId)!;
      const has = (c: ReturnType<typeof checkStatement>) => Boolean(c && [...c.included, ...c.excluded].some((r) => r.id === t.id));
      const billMonth = months.find((m) => has(checks.get(m)!.after) || has(checks.get(m)!.before)) ?? null;
      let deltaCents = 0;
      if (billMonth) {
        const alone = checkStatement(card, withChanges(txs, [p]), categories, today, billMonth);
        const before = checks.get(billMonth)!.before;
        deltaCents = (alone?.statement.computedCents ?? 0) - (before?.statement.computedCents ?? 0);
      }
      const ref = (id?: string) => {
        const r = id ? byId.get(id) : undefined;
        return r ? `${r.description}, ${formatDateBR(r.date)}, ${formatBRL(Math.abs(r.amountCents))}` : null;
      };
      rows.push({
        id: p.id,
        date: t.date,
        description: t.description,
        amountCents: t.amountCents,
        accountName: accName(card.accountId),
        from: catName(p.before.categoryId),
        to: catName(p.after.categoryId),
        reason: p.reason,
        evidence: (t.classification?.signals ?? []).map((s) => ({ code: s.code, label: SIGNAL_LABEL[s.code], kind: s.kind, points: s.points, ref: ref(s.ref) })),
        billMonth,
        deltaCents,
      });
    }

    for (const m of months) {
      const { before, after: then } = checks.get(m)!;
      if (!before || !then || before.statement.computedCents === then.statement.computedCents) continue;
      const bank = before.statement.bankTotalCents;
      bills.push({
        accountName: accName(card.accountId),
        month: m,
        status: before.statement.status,
        bankTotalCents: bank,
        beforeCents: before.statement.computedCents,
        afterCents: then.statement.computedCents,
        matchesBefore: bank !== null && before.statement.computedCents === bank,
        matchesAfter: bank !== null && then.statement.computedCents === bank,
      });
    }
  }
  rows.sort((a, b) => a.accountName.localeCompare(b.accountName) || b.date.localeCompare(a.date));
  return { today, proposals: rows, bills, skipped: input.proposals.length - live.length };
}

const billLabel = (month: string) => `Fatura de ${formatMonthYear(`${month}-01`)}`;
const money = (c: number) => formatBRL(c);
const signed = (c: number) => (c === 0 ? "sem efeito na soma" : `${c > 0 ? "+" : "−"} ${money(Math.abs(c))} na soma`);

/** The report as a Markdown document to read, keep or send. */
export function reportMarkdown(r: ReconciliationReport): string {
  const out: string[] = [];
  out.push("# Relatório da conciliação de cartões", "");
  out.push(`Gerado em ${formatDateBR(r.today)}. Nada foi aplicado: este arquivo só mostra o que mudaria. Contém valores e descrições dos seus lançamentos.`, "");
  if (!r.proposals.length) {
    out.push("Nenhuma mudança esperando revisão.", "");
    return out.join("\n");
  }
  out.push(`## Mudanças propostas (${r.proposals.length})`, "");
  let card = "";
  r.proposals.forEach((p, i) => {
    if (p.accountName !== card) {
      card = p.accountName;
      out.push(`### ${card}`, "");
    }
    out.push(`${i + 1}. **${p.description}**, ${formatDateBR(p.date)}, ${money(Math.abs(p.amountCents))} ${p.amountCents > 0 ? "(crédito)" : "(débito)"}`);
    out.push(`   - Mudança: ${p.from} → ${p.to}`);
    out.push(`   - Motivo: ${p.reason}`);
    if (p.evidence.length) {
      out.push("   - Evidência:");
      for (const e of p.evidence) out.push(`     - ${e.label} (${e.points} ${e.points === 1 ? "ponto" : "pontos"} para ${KIND_LABEL[e.kind]})${e.ref ? `: ${e.ref}` : ""}`);
    } else out.push("   - Evidência: nenhum sinal guardado para este lançamento.");
    out.push(`   - Efeito: ${p.billMonth ? `${billLabel(p.billMonth).toLowerCase()}, ${signed(p.deltaCents)}` : "fora das faturas dos últimos 12 meses"}`, "");
  });
  if (r.skipped) out.push(`${r.skipped === 1 ? "1 proposta ficou de fora porque o lançamento" : `${r.skipped} propostas ficaram de fora porque os lançamentos`} não existe${r.skipped === 1 ? "" : "m"} mais.`, "");

  out.push("## Efeito nas faturas, aplicando todas", "");
  if (!r.bills.length) out.push("Nenhuma fatura muda de soma.", "");
  else {
    out.push("| Cartão | Fatura | Situação | Banco | Hoje | Depois | Resultado |", "| --- | --- | --- | --- | --- | --- | --- |");
    for (const b of r.bills) {
      const result = b.bankTotalCents === null ? "sem total do banco" : b.matchesAfter ? (b.matchesBefore ? "continua batendo" : "passa a bater") : b.matchesBefore ? "deixa de bater" : `diferença de ${money(Math.abs(b.bankTotalCents - b.afterCents))}`;
      out.push(`| ${b.accountName} | ${billLabel(b.month)} | ${b.status === "open" ? "aberta" : b.status === "closed" ? "fechada" : "futura"} | ${b.bankTotalCents === null ? "—" : money(b.bankTotalCents)} | ${money(b.beforeCents)} | ${money(b.afterCents)} | ${result} |`);
    }
    out.push("");
  }
  return out.join("\n");
}
