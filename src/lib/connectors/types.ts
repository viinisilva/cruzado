// Contract every financial data source implements. All connectors are READ-ONLY:
// there is no method to move money, pay, transfer or change anything at an institution.
import type { DateRange } from "../dates";

export type ConnectionResult = { connectionId: string; status: "active" | "pending_consent" | "error"; message?: string };

export type SyncResult = { connectionId: string; accounts: number; transactions: number; syncedAt: Date };

export type ExternalAccount = {
  externalId: string;
  name: string;
  institution: string;
  type: "checking" | "savings" | "credit_card" | "cash";
  balanceCents?: number;
};

export type ExternalTransaction = {
  externalId?: string; // FITID (OFX) or provider id, used for idempotent dedupe
  accountExternalId?: string;
  date: string; // YYYY-MM-DD
  description: string;
  amountCents: number; // negative = expense
};

export interface FinancialDataConnector {
  readonly id: "demo" | "csv" | "ofx" | "open_finance";
  connect(userId: string): Promise<ConnectionResult>;
  sync(connectionId: string): Promise<SyncResult>;
  listAccounts(connectionId: string): Promise<ExternalAccount[]>;
  listTransactions(connectionId: string, range: DateRange): Promise<ExternalTransaction[]>;
  disconnect(connectionId: string): Promise<void>;
}
