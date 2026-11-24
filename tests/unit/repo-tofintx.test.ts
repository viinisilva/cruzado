// Stored rows become FinTx. Installment numbers missing in the database (stored by an older reader) are read from the
// bank's text at load time, so a row outside the next sync's window is not left without them.
import { describe, expect, it } from "vitest";
import type * as s from "@/db/schema";
import { toFinTx } from "@/lib/data/repo";

const row = (over: Partial<typeof s.transactions.$inferSelect>) =>
  ({ id: "t1", accountId: "k", categoryId: null, date: "2026-10-10", description: "Compra", providerDescription: null, merchant: "compra", amountCents: -9550, installmentNumber: null, installmentTotal: null, bankStatus: "pending", billRef: null, operationType: null, categorySource: null, classification: null, ...over }) as typeof s.transactions.$inferSelect;

describe("toFinTx", () => {
  it("fills missing installment numbers from the bank's text, glued or not", () => {
    expect(toFinTx(row({ providerDescription: "LOJA EXEMPLO02/04", description: "Loja Exemplo" }))).toMatchObject({ installmentNumber: 2, installmentTotal: 4 });
    expect(toFinTx(row({ description: "LOJA 3/10" }))).toMatchObject({ installmentNumber: 3, installmentTotal: 10 });
  });

  it("keeps the stored numbers when there are any, and leaves a plain purchase alone", () => {
    expect(toFinTx(row({ providerDescription: "LOJA 02/04", installmentNumber: 5, installmentTotal: 6 }))).toMatchObject({ installmentNumber: 5, installmentTotal: 6 });
    expect(toFinTx(row({ description: "PADARIA" }))).toMatchObject({ installmentNumber: null, installmentTotal: null });
  });
});
