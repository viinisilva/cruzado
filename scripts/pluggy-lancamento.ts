// Read-only: shows what Pluggy actually sends for card entries whose text contains a word, including every field of
// creditCardMetadata (installmentNumber, totalInstallments, totalAmount, purchaseDate, billId…). The app keeps only some
// of them, so this is the way to see the rest. Run it on your own machine; it changes nothing and saves nothing.
//
//   npx tsx scripts/pluggy-lancamento.ts MERCADOLIVRE 2026-09-01 [ELO]
//
// Credentials: PLUGGY_CLIENT_ID and PLUGGY_CLIENT_SECRET come from .env.local or .env.pluggy.local (both ignored by
// git), or from the environment. If one is missing it is asked for without echo: it never shows on screen, in the
// output or in the shell history. Values are never printed.
// Item: PLUGGY_ITEM_ID from the same files, or the item list when the plan allows it (GET /v2/items; Pluggy does not
// offer it on the free plan or on Meu Pluggy accounts), or asked for. The optional third word keeps only card accounts
// whose name contains it (for example ELO).
// Output: only date, text, amount, status, operation type and creditCardMetadata of the matching entries, and the card's
// name. No keys, tokens, ids or other entries.
import { existsSync } from "node:fs";
import path from "node:path";
import { createInterface } from "node:readline";

const BASE = "https://api.pluggy.ai";
const ROOT = path.resolve(import.meta.dirname, "..");

/** Loads the local env files into process.env without printing anything; variables already set win. */
export function loadLocalEnv(files = [".env.local", ".env.pluggy.local"]): string[] {
  const loaded: string[] = [];
  for (const f of files) {
    const p = path.join(ROOT, f);
    if (!existsSync(p)) continue;
    process.loadEnvFile(p);
    loaded.push(f);
  }
  return loaded;
}

/** Asks a question; with `hidden`, what is typed is not echoed. */
function ask(question: string, hidden = false): Promise<string> {
  return new Promise((resolve) => {
    const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    if (hidden) {
      const write = (rl as unknown as { _writeToOutput: (s: string) => void })._writeToOutput.bind(rl);
      (rl as unknown as { _writeToOutput: (s: string) => void })._writeToOutput = (s: string) => write(s.startsWith(question) ? s : "");
    }
    rl.question(question, (answer) => {
      rl.close();
      if (hidden) process.stdout.write("\n");
      resolve(answer.trim());
    });
  });
}

type Item = { id: string; connector?: { name?: string } };

/** The item to read: the only one, or the one whose connector name contains the hint. */
export function pickItem(items: Item[], hint?: string): Item | null {
  if (items.length === 1) return items[0]!;
  const wanted = hint?.toUpperCase();
  const matches = wanted ? items.filter((i) => (i.connector?.name ?? "").toUpperCase().includes(wanted)) : [];
  return matches.length === 1 ? matches[0]! : null;
}

async function call(pathname: string, apiKey?: string, body?: unknown): Promise<{ status: number; json: Record<string, unknown> | null }> {
  const res = await fetch(`${BASE}${pathname}`, {
    method: body ? "POST" : "GET",
    headers: { "content-type": "application/json", ...(apiKey ? { "X-API-KEY": apiKey } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, json: res.ok ? ((await res.json()) as Record<string, unknown>) : null };
}

async function main() {
  const [word = "MERCADOLIVRE", from = "2026-09-01", accountHint] = process.argv.slice(2);
  const files = loadLocalEnv();
  console.log(files.length ? `Credenciais procuradas em: ${files.join(", ")} (valores não são mostrados).` : "Nenhum arquivo .env.local ou .env.pluggy.local encontrado.");
  const clientId = process.env.PLUGGY_CLIENT_ID || (await ask("PLUGGY_CLIENT_ID: "));
  const clientSecret = process.env.PLUGGY_CLIENT_SECRET || (await ask("PLUGGY_CLIENT_SECRET (não aparece ao digitar): ", true));
  if (!clientId || !clientSecret) throw new Error("Sem credenciais da Pluggy.");

  const auth = await call("/auth", undefined, { clientId, clientSecret });
  const apiKey = auth.json?.apiKey as string | undefined;
  if (!apiKey) throw new Error(`A Pluggy recusou as credenciais (HTTP ${auth.status}).`);

  let itemId = process.env.PLUGGY_ITEM_ID;
  if (!itemId) {
    const list = await call("/v2/items", apiKey);
    const items = (list.json?.results as Item[] | undefined) ?? [];
    const item = list.status === 200 ? pickItem(items, accountHint) : null;
    if (item) {
      console.log(`Item encontrado pela lista da Pluggy: ${item.connector?.name ?? "sem nome"}.`);
      itemId = item.id;
    } else {
      console.log(list.status === 200 ? `A lista tem ${items.length} itens; não deu para escolher um sozinho.` : `A Pluggy não lista os itens neste plano (HTTP ${list.status}).`);
      itemId = await ask("Item ID (painel da Pluggy › Applications › Demo › Connected Items, o mesmo colado no Cruzado): ");
    }
  }
  if (!itemId) throw new Error("Sem Item ID.");

  const accounts = ((await call(`/accounts?itemId=${encodeURIComponent(itemId)}`, apiKey)).json?.results as { id: string; type: string; name: string }[] | undefined) ?? [];
  const cards = accounts.filter((a) => a.type === "CREDIT" && (!accountHint || a.name.toUpperCase().includes(accountHint.toUpperCase())));
  if (!cards.length) console.log("Nenhuma conta de cartão encontrada nesse item.");
  let found = 0;
  for (const account of cards) {
    let page = 1;
    let pages = 1;
    do {
      const body = (await call(`/transactions?accountId=${account.id}&from=${from}&pageSize=500&page=${page}`, apiKey)).json;
      pages = Number(body?.totalPages ?? 1);
      for (const t of (body?.results as Record<string, unknown>[] | undefined) ?? []) {
        if (!String(t.description ?? "").toUpperCase().includes(word.toUpperCase())) continue;
        found++;
        console.log(JSON.stringify({ cartao: account.name, data: t.date, texto: t.description, valor: t.amount, status: t.status, operationType: t.operationType ?? null, creditCardMetadata: t.creditCardMetadata ?? null }, null, 2));
      }
      page++;
    } while (page <= pages);
  }
  console.log(`${found} lançamento(s) com "${word}" desde ${from}.`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(import.meta.filename)) await main();
