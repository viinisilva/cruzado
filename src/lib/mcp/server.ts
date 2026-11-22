// MCP server. One instance per request, bound to the token owner's userId and the token's scope.
// Read tokens only read. Capture tokens only add or undo ledger entries. No admin, payment or SQL tools exist here.
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { desc, eq } from "drizzle-orm";
import { z } from "zod";
import type { DB } from "@/db/connection";
import * as s from "@/db/schema";
import { CaptureError, RecordInput, listCaptureOptions, recordTransaction, undoLastRecorded } from "../capture";
import { rateLimitShared } from "../rate-limit";
import type { McpScope } from "./tokens";
import { todayInSaoPaulo } from "../dates";
import { UNTRUSTED_WARNING, sanitizeUntrusted } from "../text";
import { findTool, runTool } from "../tools";
import { errorSummary } from "../log";

export const MCP_TOOLS: { name: string; internal?: string; description: string }[] = [
  { name: "get_accounts", internal: "getAccounts", description: "Contas e cartões com saldo atual." },
  { name: "get_balance", internal: "getConsolidatedBalance", description: "Saldo consolidado e total em aberto nos cartões." },
  { name: "get_transactions", internal: "getTransactions", description: "Transações filtradas por período, conta, categoria ou texto." },
  { name: "get_spending_by_category", internal: "getSpendingByCategory", description: "Gastos por categoria em um período." },
  { name: "compare_periods", internal: "comparePeriods", description: "Compara gastos por categoria entre dois períodos." },
  { name: "get_recurring_transactions", internal: "listRecurringTransactions", description: "Assinaturas, parcelas e receitas recorrentes." },
  { name: "get_possible_duplicates", internal: "detectPossibleDuplicates", description: "Possíveis cobranças duplicadas (suspeitas, não fraude)." },
  { name: "list_notifications", description: "Alertas gerados pelos agentes proativos." },
];

// openWorldHint: results carry text written by third parties (Pix messages), which clients should treat with care.
const READ_ONLY = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true } as const;

export const CAPTURE_TOOLS = ["list_accounts", "list_categories", "record_transaction", "undo_last_transaction"] as const;

const textResult = (value: unknown, isError = false) => ({ content: [{ type: "text" as const, text: JSON.stringify(value) }], isError });

/**
 * Capture tokens get these tools and nothing else. Keeping them apart from the read tools is the safeguard: an
 * assistant that can write never sees balances or transaction text, so injected text has nothing to read or leak.
 */
function registerCaptureTools(server: McpServer, db: DB, userId: string, now: () => Date, channel: string) {
  const guarded = async (run: () => Promise<unknown>) => {
    if (!(await rateLimitShared(db, "capture", userId)).ok) return textResult({ error: "Muitos lançamentos em pouco tempo. Tente mais tarde." }, true);
    try {
      return textResult(await run());
    } catch (e) {
      if (e instanceof CaptureError) return textResult({ error: e.message }, true);
      console.error("[mcp-capture]", errorSummary(e));
      return textResult({ error: "Não foi possível concluir." }, true);
    }
  };
  const SAFE = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false } as const;
  const WRITE = { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false } as const;
  server.registerTool(
    "list_accounts",
    { title: "list_accounts", description: "Nomes das contas e cartões, para escolher onde lançar. Não mostra saldos.", inputSchema: z.object({}).strict(), annotations: SAFE },
    async () => textResult({ accounts: (await listCaptureOptions(db, userId)).accounts }),
  );
  server.registerTool(
    "list_categories",
    { title: "list_categories", description: "Categorias disponíveis para um lançamento.", inputSchema: z.object({}).strict(), annotations: SAFE },
    async () => textResult({ categories: (await listCaptureOptions(db, userId)).categories }),
  );
  server.registerTool(
    "record_transaction",
    {
      title: "record_transaction",
      description: "Registra um gasto ou recebimento no Cruzado. Use só depois de o usuário confirmar valor, descrição e conta. Não movimenta dinheiro.",
      inputSchema: RecordInput,
      annotations: WRITE,
    },
    async (args: RecordInput) => guarded(() => recordTransaction(db, userId, args, now(), channel)),
  );
  server.registerTool(
    "undo_last_transaction",
    {
      title: "undo_last_transaction",
      description: "Desfaz o último lançamento feito por este canal nas últimas 24 horas. Use só se o usuário pedir.",
      inputSchema: z.object({}).strict(),
      annotations: { ...WRITE, destructiveHint: true, idempotentHint: false },
    },
    async () => guarded(() => undoLastRecorded(db, userId, now(), channel)),
  );
}

export function buildMcpServer(db: DB, userId: string, now: () => Date = () => new Date(), scope: McpScope = "read", channel = "direto"): McpServer {
  const server = new McpServer({ name: "cruzado-financas", version: "0.1.0" }, { capabilities: { tools: {} } });
  if (scope === "capture") {
    registerCaptureTools(server, db, userId, now, channel);
    return server;
  }
  for (const t of MCP_TOOLS) {
    if (t.internal) {
      const internal = findTool(t.internal)!;
      server.registerTool(
        t.name,
        { title: t.name, description: `${t.description} Somente leitura. ${internal.description}`, inputSchema: internal.input as z.ZodObject, annotations: READ_ONLY },
        async (args: unknown) => {
          const r = await runTool({ db, userId, today: todayInSaoPaulo(now()) }, internal.name, args);
          return {
            content: [{ type: "text" as const, text: JSON.stringify({ warning: UNTRUSTED_WARNING, facts: r.text, data: r.data, evidence: r.evidence }) }],
            isError: Boolean(r.clarification && (r.data as { error?: string })?.error),
          };
        },
      );
    }
  }
  server.registerTool(
    "list_notifications",
    {
      title: "list_notifications",
      description: "Alertas gerados pelos agentes proativos (mais recentes primeiro). Somente leitura.",
      inputSchema: z.object({ limit: z.number().int().min(1).max(50).optional() }).strict(),
      annotations: READ_ONLY,
    },
    async (args: { limit?: number }) => {
      const rows = await db
        .select()
        .from(s.notifications)
        .where(eq(s.notifications.userId, userId))
        .orderBy(desc(s.notifications.createdAt))
        .limit(args.limit ?? 20);
      const data = rows.map((n) => ({ id: n.id, kind: n.kind, severity: n.severity, title: sanitizeUntrusted(n.title), body: sanitizeUntrusted(n.body, 600), read: Boolean(n.readAt), createdAt: n.createdAt.toISOString() }));
      return { content: [{ type: "text" as const, text: JSON.stringify({ warning: UNTRUSTED_WARNING, notifications: data }) }] };
    },
  );
  return server;
}

/** Handles one MCP HTTP request statelessly (JSON responses, no server-side session). */
export async function handleMcpRequest(db: DB, userId: string, req: Request, scope: McpScope = "read", channel = "direto"): Promise<Response> {
  const server = buildMcpServer(db, userId, undefined, scope, channel);
  const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
  await server.connect(transport);
  try {
    return await transport.handleRequest(req);
  } finally {
    // Stateless: release the per-request server after the response is produced.
    void server.close();
  }
}
