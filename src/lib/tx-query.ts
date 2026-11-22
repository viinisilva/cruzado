// The transactions list is driven entirely by its URL, so every link into it stays shareable and comparable.
import { addDays, isValidYmd, startOfMonth } from "./dates";

export const UNCATEGORIZED_FILTER = "sem-categoria";
export const PAGE_SIZE = 100;
const MAX_PAGE = 10_000;

export type TxQuery = {
  de?: string;
  ate?: string;
  contas?: string[];
  categoria?: string;
  q?: string;
  tipo?: "receita" | "despesa" | "transferencia";
  origem?: TxOrigin;
  /** Only "pendente" exists: entries the bank has not settled yet. */
  status?: "pendente";
  ordem?: "antigas";
  /** Same rules as the cash-flow totals: transfers are out, refunds count against spending. */
  fluxo?: boolean;
  pagina?: number;
};

export const ORIGINS = { banco: "Banco conectado", arquivo: "Arquivo importado", manual: "Lançamento manual", mensagem: "Mensagem ou assistente" } as const;
export type TxOrigin = keyof typeof ORIGINS;

type RawParams = Record<string, string | string[] | undefined>;

const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

/** Accepts `contas=a,b` from links and repeated `contas=a&contas=b` from the filter form. */
export function parseTxQuery(sp: RawParams, today: string): Required<Pick<TxQuery, "de" | "ate">> & TxQuery {
  const rawFrom = one(sp.de);
  const rawTo = one(sp.ate);
  const narrowed = Boolean(one(sp.q) || one(sp.categoria) || sp.contas || one(sp.tipo) || one(sp.origem) || one(sp.status));
  // A plain visit is about this month; a search or filter without dates should not miss last month's entry.
  const from = rawFrom && isValidYmd(rawFrom) ? rawFrom : narrowed ? addDays(today, -364) : startOfMonth(today);
  const to = rawTo && isValidYmd(rawTo) ? rawTo : today;
  const [de, ate] = from <= to ? [from, to] : [to, from];
  const contas = [sp.contas].flat().flatMap((v) => v?.split(",") ?? []).filter(Boolean);
  const tipo = one(sp.tipo);
  const origem = one(sp.origem);
  const pagina = Number(one(sp.pagina));
  return {
    de,
    ate,
    contas: contas.length ? [...new Set(contas)] : undefined,
    categoria: one(sp.categoria) || undefined,
    q: one(sp.q)?.trim() || undefined,
    tipo: tipo === "receita" || tipo === "despesa" || tipo === "transferencia" ? tipo : undefined,
    origem: origem && origem in ORIGINS ? (origem as TxOrigin) : undefined,
    status: one(sp.status) === "pendente" ? "pendente" : undefined,
    ordem: one(sp.ordem) === "antigas" ? "antigas" : undefined,
    fluxo: one(sp.fluxo) === "1" || undefined,
    pagina: Number.isInteger(pagina) && pagina > 1 ? Math.min(pagina, MAX_PAGE) : undefined,
  };
}

export function txHref(q: TxQuery): string {
  const p = new URLSearchParams();
  if (q.de) p.set("de", q.de);
  if (q.ate) p.set("ate", q.ate);
  if (q.contas?.length) p.set("contas", q.contas.join(","));
  if (q.categoria) p.set("categoria", q.categoria);
  if (q.q) p.set("q", q.q);
  if (q.tipo) p.set("tipo", q.tipo);
  if (q.origem) p.set("origem", q.origem);
  if (q.status) p.set("status", q.status);
  if (q.ordem) p.set("ordem", q.ordem);
  if (q.fluxo) p.set("fluxo", "1");
  if (q.pagina) p.set("pagina", String(q.pagina));
  const s = p.toString();
  return s ? `/transacoes?${s}` : "/transacoes";
}

/** Only same-site paths inside Transactions: this value comes from the URL and ends up in a link and a redirect. */
export function safeTxReturn(value: unknown): string {
  const v = String(value ?? "");
  return /^\/transacoes(\?[^\\]*)?$/.test(v) ? v : "/transacoes";
}
