// A fake Pluggy for integration tests, behaving as docs.pluggy.ai documents Open Finance: date windows by dateFrom,
// a separate createdAtFrom read, bills with payments, and no categories.
type Row = Record<string, unknown>;
/** `billsStatus`: answer /bills with this error status, as a bank that refuses the product does. */
export type FakeState = { item: string; connector: string; accounts: Row[]; txs: Record<string, Row[]>; bills: Record<string, Row[]>; calls: string[]; billsStatus?: number };

export function fakePluggy(state: FakeState): typeof fetch {
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    state.calls.push(`${init?.method ?? "GET"} ${url.pathname}${url.search}`);
    const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
    if (url.pathname === "/auth") return json({ apiKey: "key" });
    if (url.pathname.startsWith("/items/")) return json({ id: state.item, status: "UPDATED", executionStatus: "SUCCESS", connector: { name: state.connector } });
    if (url.pathname === "/accounts") return json({ results: state.accounts });
    if (url.pathname === "/v2/transactions") {
      const all = state.txs[url.searchParams.get("accountId")!] ?? [];
      const from = url.searchParams.get("dateFrom");
      const created = url.searchParams.get("createdAtFrom");
      if (created) return json({ results: all.filter((t) => String(t.createdAt ?? "2000-01-01") >= created), next: null });
      return json({ results: from ? all.filter((t) => String(t.date) >= from) : all, next: null });
    }
    if (url.pathname === "/bills") {
      if (state.billsStatus) return json({ code: state.billsStatus }, state.billsStatus);
      const results = state.bills[url.searchParams.get("accountId")!] ?? [];
      return json({ page: 1, total: results.length, totalPages: 1, results });
    }
    return json({}, 404);
  }) as typeof fetch;
}
