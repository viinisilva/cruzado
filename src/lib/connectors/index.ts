// Connector implementations for local data. Open Finance lives in ./open-finance.ts (see docs/OPEN_FINANCE.md).
import { and, eq, gte, lte } from "drizzle-orm";
import type { DB } from "@/db/connection";
import * as s from "@/db/schema";
import { newId } from "../ids";
import type { DateRange } from "../dates";
import { mapCsvRows, parseCsv, type CsvMapping } from "./csv";
import { parseOfx } from "./ofx";
import type { ConnectionResult, ExternalAccount, ExternalTransaction, FinancialDataConnector, SyncResult } from "./types";

/** Demo data lives in our own tables (seeded by src/lib/demo/seed.ts); sync just re-reads it. */
export class DemoConnector implements FinancialDataConnector {
  readonly id = "demo" as const;
  constructor(private db: DB) {}

  async connect(userId: string): Promise<ConnectionResult> {
    const id = newId();
    await this.db.insert(s.financialConnections).values({ id, userId, connector: "demo", label: "Dados de demonstração" });
    return { connectionId: id, status: "active" };
  }

  async sync(connectionId: string): Promise<SyncResult> {
    const accounts = await this.listAccounts(connectionId);
    await this.db.update(s.financialConnections).set({ lastSyncAt: new Date() }).where(eq(s.financialConnections.id, connectionId));
    return { connectionId, accounts: accounts.length, transactions: 0, syncedAt: new Date() };
  }

  async listAccounts(connectionId: string): Promise<ExternalAccount[]> {
    const rows = await this.db.select().from(s.accounts).where(eq(s.accounts.connectionId, connectionId));
    return rows.map((r) => ({ externalId: r.externalId ?? r.id, name: r.name, institution: r.institution, type: r.type }));
  }

  async listTransactions(connectionId: string, range: DateRange): Promise<ExternalTransaction[]> {
    const rows = await this.db
      .select({ t: s.transactions, ext: s.accounts.externalId })
      .from(s.transactions)
      .innerJoin(s.accounts, eq(s.transactions.accountId, s.accounts.id))
      .where(and(eq(s.accounts.connectionId, connectionId), gte(s.transactions.date, range.from), lte(s.transactions.date, range.to)));
    return rows.map(({ t, ext }) => ({ externalId: t.dedupeKey, accountExternalId: ext ?? undefined, date: t.date, description: t.description, amountCents: t.amountCents }));
  }

  async disconnect(connectionId: string): Promise<void> {
    await this.db.update(s.financialConnections).set({ status: "disconnected" }).where(eq(s.financialConnections.id, connectionId));
  }
}

/** File connectors parse one uploaded statement; there is no remote connection to keep. */
abstract class FileConnector implements FinancialDataConnector {
  abstract readonly id: "csv" | "ofx";
  protected rows: ExternalTransaction[] = [];
  async connect(): Promise<ConnectionResult> {
    return { connectionId: `file-${newId()}`, status: "active" };
  }
  async sync(connectionId: string): Promise<SyncResult> {
    return { connectionId, accounts: 1, transactions: this.rows.length, syncedAt: new Date() };
  }
  async listAccounts(): Promise<ExternalAccount[]> {
    return [];
  }
  async listTransactions(_connectionId: string, range: DateRange): Promise<ExternalTransaction[]> {
    return this.rows.filter((r) => r.date >= range.from && r.date <= range.to);
  }
  async disconnect(): Promise<void> {
    this.rows = [];
  }
}

export class CsvConnector extends FileConnector {
  readonly id = "csv" as const;
  constructor(content: string, mapping: CsvMapping) {
    super();
    this.rows = mapCsvRows(parseCsv(content), mapping).flatMap((r) => (r.ok ? [r.tx] : []));
  }
}

export class OfxConnector extends FileConnector {
  readonly id = "ofx" as const;
  private account: ExternalAccount;
  constructor(content: string) {
    super();
    const parsed = parseOfx(content);
    this.rows = parsed.rows.flatMap((r) => (r.ok ? [r.tx] : []));
    this.account = { externalId: parsed.account.accountId ?? "ofx", name: `Conta ${parsed.account.accountId ?? ""}`.trim(), institution: parsed.account.bankId ?? "OFX", type: parsed.account.type };
  }
  override async listAccounts(): Promise<ExternalAccount[]> {
    return [this.account];
  }
}

