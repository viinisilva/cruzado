// Minimal read-only client for the Pluggy API (Open Finance aggregator). Reads, connect tokens and item upkeep only:
// nothing here can move money, and payment endpoints are deliberately not modeled.
import { z } from "zod";

const BASE_URL = "https://api.pluggy.ai";
const TIMEOUT_MS = 20_000;
// API keys last 2 hours; renew earlier so a long sync never runs with an expired one.
const API_KEY_TTL_MS = 100 * 60_000;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Item ids go into URL paths, so anything that is not a plain UUID is refused. */
export const isPluggyId = (id: string) => UUID.test(id);

const PluggyItem = z.object({
  id: z.string(),
  status: z.string(),
  executionStatus: z.string().nullish(),
  clientUserId: z.string().nullish(),
  consentExpiresAt: z.string().nullish(),
  connector: z.object({ name: z.string() }).nullish(),
});
export type PluggyItem = z.infer<typeof PluggyItem>;

const PluggyAccount = z.object({
  id: z.string(),
  type: z.string(),
  subtype: z.string().nullish(),
  number: z.string().nullish(),
  name: z.string(),
  marketingName: z.string().nullish(),
  balance: z.number().nullish(),
  currencyCode: z.string().nullish(),
  creditData: z
    .object({
      creditLimit: z.number().nullish(),
      availableCreditLimit: z.number().nullish(),
      minimumPayment: z.number().nullish(),
      // Always null on Open Finance connectors (docs.pluggy.ai, Accounts): never a source for the closing day there.
      balanceCloseDate: z.string().nullish(),
      balanceDueDate: z.string().nullish(),
    })
    .nullish(),
});
export type PluggyAccount = z.infer<typeof PluggyAccount>;

const PluggyTransaction = z.object({
  id: z.string(),
  date: z.string(),
  description: z.string().nullish(),
  amount: z.number(),
  amountInAccountCurrency: z.number().nullish(),
  currencyCode: z.string().nullish(),
  category: z.string().nullish(),
  status: z.string().nullish(),
  type: z.string().nullish(),
  providerId: z.string().nullish(),
  /** Open Finance only. On cards, PAGAMENTO_FATURA marks a bill payment (also when Pluggy builds "Pagamento recebido"). */
  operationType: z.string().nullish(),
  creditCardMetadata: z
    .object({
      installmentNumber: z.number().nullish(),
      totalInstallments: z.number().nullish(),
      /** The bank's bill this entry was charged in. Missing while pending: the bill does not exist yet. */
      billId: z.string().nullish(),
    })
    .nullish(),
});
export type PluggyTransaction = z.infer<typeof PluggyTransaction>;

const PluggyBill = z.object({
  id: z.string(),
  dueDate: z.string(),
  billClosingDate: z.string().nullish(),
  totalAmount: z.number(),
  totalAmountCurrencyCode: z.string().nullish(),
  minimumPaymentAmount: z.number().nullish(),
  /** The bank's payments of this bill: the strongest evidence that a card credit is a bill payment. */
  payments: z
    .array(z.object({ amount: z.number(), paymentDate: z.string().nullish(), paymentMode: z.string().nullish(), valueType: z.string().nullish(), currencyCode: z.string().nullish() }).passthrough())
    .nullish(),
});
export type PluggyBill = z.infer<typeof PluggyBill>;
const BillsPage = z.object({ results: z.array(PluggyBill), page: z.number().nullish(), totalPages: z.number().nullish() });

const PluggyConnector = z.object({ id: z.number(), name: z.string(), isOpenFinance: z.boolean().nullish(), isSandbox: z.boolean().nullish(), sandbox: z.boolean().nullish() });

const AuthResponse = z.object({ apiKey: z.string() });
const AccountsPage = z.object({ results: z.array(PluggyAccount) });
const TransactionsPage = z.object({ results: z.array(PluggyTransaction), next: z.string().nullish() });
const ConnectorsPage = z.object({ results: z.array(PluggyConnector) });
const ConnectToken = z.object({ accessToken: z.string() });

export class PluggyError extends Error {
  constructor(
    public status: number,
    /** Seconds the provider asked us to wait, when it said so. */
    public retryAfter?: number,
  ) {
    super(`Pluggy respondeu com erro (HTTP ${status}).`);
  }
}

/** A failure worth retrying by itself; anything else needs a person or a code change. */
export function isTransient(e: unknown): boolean {
  if (e instanceof PluggyError) return e.status === 408 || e.status === 429 || e.status >= 500;
  return e instanceof Error && (e.name === "TimeoutError" || e.name === "AbortError" || e.name === "TypeError");
}

export class PluggyClient {
  private apiKey?: { value: string; expiresAt: number };

  constructor(
    private credentials: { clientId: string; clientSecret: string },
    private fetchImpl: typeof fetch = fetch,
  ) {}

  private async send(path: string, init: RequestInit): Promise<Response> {
    return this.fetchImpl(`${BASE_URL}${path}`, { ...init, redirect: "error", signal: AbortSignal.timeout(TIMEOUT_MS) });
  }

  private async key(): Promise<string> {
    if (this.apiKey && this.apiKey.expiresAt > Date.now()) return this.apiKey.value;
    const res = await this.send("/auth", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(this.credentials),
    });
    // Status only: provider bodies may echo request data, and this message reaches logs.
    if (!res.ok) throw new Error(`Pluggy recusou a autenticação (HTTP ${res.status}).`);
    const { apiKey } = AuthResponse.parse(await res.json());
    this.apiKey = { value: apiKey, expiresAt: Date.now() + API_KEY_TTL_MS };
    return apiKey;
  }

  private async request(path: string, method = "GET", body?: unknown): Promise<Response> {
    const call = async () =>
      this.send(path, {
        method,
        headers: { "x-api-key": await this.key(), ...(body === undefined ? {} : { "content-type": "application/json" }) },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
    let res = await call();
    if (res.status === 401) {
      this.apiKey = undefined;
      res = await call();
    }
    if (!res.ok) {
      const wait = Number(res.headers.get("ratelimit-reset") ?? res.headers.get("retry-after"));
      throw new PluggyError(res.status, Number.isFinite(wait) && wait > 0 ? wait : undefined);
    }
    return res;
  }

  async getItem(itemId: string): Promise<PluggyItem> {
    if (!isPluggyId(itemId)) throw new Error("Identificador de conexão inválido.");
    return PluggyItem.parse(await (await this.request(`/items/${itemId}`)).json());
  }

  async listAccounts(itemId: string): Promise<PluggyAccount[]> {
    if (!isPluggyId(itemId)) throw new Error("Identificador de conta inválido.");
    const page = AccountsPage.parse(await (await this.request(`/accounts?itemId=${itemId}`)).json());
    return page.results;
  }

  /**
   * One page of an account's transactions. `next` is a query string and null ends the list, so a `next` without a
   * cursor is a broken contract: stopping there would silently present a truncated history as complete.
   */
  async transactionsPage(accountId: string, opts: { from?: string; createdFrom?: string; after?: string | null }) {
    if (!isPluggyId(accountId)) throw new Error("Identificador de conta inválido.");
    const query = new URLSearchParams({ accountId });
    // The API refuses dateFrom together with createdAtFrom: one or the other.
    if (opts.createdFrom) query.set("createdAtFrom", opts.createdFrom);
    else if (opts.from) query.set("dateFrom", opts.from);
    if (opts.after) query.set("after", opts.after);
    const body = TransactionsPage.parse(await (await this.request(`/v2/transactions?${query}`)).json());
    if (!body.next) return { results: body.results, after: null };
    // Only the cursor value is reused; a full `next` string would let a response redirect the request.
    const after = new URLSearchParams(body.next.replace(/^[^?]*\?/, "")).get("after");
    if (!after || after === opts.after) throw new Error("Paginação de transações inválida: cursor ausente ou repetido.");
    return { results: body.results, after };
  }

  /**
   * The card issuer's bills (closed ones; the open bill has no total yet). Open Finance allows about 30 listings a
   * month per person and institution, so callers must not ask more than once a day.
   */
  async listBills(accountId: string): Promise<PluggyBill[]> {
    if (!isPluggyId(accountId)) throw new Error("Identificador de conta inválido.");
    const out: PluggyBill[] = [];
    for (let page = 1; page <= 20; page++) {
      const body = BillsPage.parse(await (await this.request(`/bills?${new URLSearchParams({ accountId, pageSize: "500", page: String(page) })}`)).json());
      out.push(...body.results);
      if (!body.totalPages || page >= body.totalPages) break;
    }
    return out;
  }

  /** Widget list: regulated Open Finance connectors only. Sandbox ones are added only when asked for. */
  async listOpenFinanceConnectorIds(includeSandbox: boolean): Promise<number[]> {
    const query = new URLSearchParams({ countries: "BR", isOpenFinance: "true" });
    if (includeSandbox) query.set("sandbox", "true");
    const page = ConnectorsPage.parse(await (await this.request(`/connectors?${query}`)).json());
    return page.results.filter((c) => c.isOpenFinance === true || (includeSandbox && (c.isSandbox || c.sandbox))).map((c) => c.id);
  }

  /** Good for 30 minutes. With `itemId` the token can only update that item. */
  async createConnectToken(opts: { clientUserId: string; itemId?: string }): Promise<string> {
    if (opts.itemId && !isPluggyId(opts.itemId)) throw new Error("Identificador de conexão inválido.");
    // No webhookUrl here: a per-token webhook cannot carry the secret header, so it would be refused on arrival.
    const body = { ...(opts.itemId ? { itemId: opts.itemId } : {}), options: { clientUserId: opts.clientUserId, avoidDuplicates: true } };
    return ConnectToken.parse(await (await this.request("/connect_token", "POST", body)).json()).accessToken;
  }

  /** User-triggered only: Pluggy limits this route and keeps items fresh by itself. */
  async refreshItem(itemId: string): Promise<void> {
    if (!isPluggyId(itemId)) throw new Error("Identificador de conexão inválido.");
    await this.request(`/items/${itemId}`, "PATCH", {});
  }

  /** Pluggy signs nothing: the header set here is the only proof a delivery came from this registration. */
  async createWebhook(url: string, secret: string): Promise<void> {
    await this.request("/webhooks", "POST", { event: "all", url, headers: { authorization: `Bearer ${secret}` } });
  }

  /** Removes the connection at the provider. Its docs do not promise this revokes the consent at the bank. */
  async deleteItem(itemId: string): Promise<void> {
    if (!isPluggyId(itemId)) throw new Error("Identificador de conexão inválido.");
    await this.request(`/items/${itemId}`, "DELETE");
  }
}

/** Personal instance: only one Cruzado account may link banks (Meu Pluggy is single-person by contract). */
export function isBankOwner(user: { id: string; isDemo: boolean }): boolean {
  const owner = process.env.PLUGGY_OWNER_USER_ID;
  return Boolean(owner) && user.id === owner && !user.isDemo && Boolean(process.env.PLUGGY_CLIENT_ID && process.env.PLUGGY_CLIENT_SECRET);
}

/** Real bank data demands more than a password: the owner must have two-step verification on. */
export function canConnectBanks(user: { id: string; isDemo: boolean; totpEnabledAt: Date | null }): boolean {
  return isBankOwner(user) && Boolean(user.totpEnabledAt);
}

/** Whoever has the bank integration gets accounts and cards from it. Everyone else has no other way to create one. */
export function canAddAccountsManually(user: { id: string; isDemo: boolean }): boolean {
  return !isBankOwner(user);
}

/** `connect` opens the official widget and needs a developer contract; it does not lift the owner rule above. */
export const pluggyMode = (): "personal" | "connect" => (process.env.PLUGGY_MODE === "connect" ? "connect" : "personal");

export function pluggyClientFromEnv(): PluggyClient {
  const clientId = process.env.PLUGGY_CLIENT_ID;
  const clientSecret = process.env.PLUGGY_CLIENT_SECRET;
  if (!clientId || !clientSecret) throw new Error("PLUGGY_CLIENT_ID e PLUGGY_CLIENT_SECRET não configurados.");
  return new PluggyClient({ clientId, clientSecret });
}
