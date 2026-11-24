// "Parcela prevista" through a real sync: the bank sends only 1/4 of a purchase, the closed bill counts 2/4 as prevista,
// the person can exclude it (stored, scoped to their own cards), and when the bank sends 2/4 later it replaces the
// prevista without counting twice. Synthetic values.
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import * as s from "@/db/schema";
import { createUser } from "@/lib/auth/users";
import { dismissProjection, restoreProjections } from "@/lib/card-reconciliation";
import { connectItem, syncConnection } from "@/lib/connectors/open-finance";
import { PluggyClient } from "@/lib/connectors/pluggy";
import { loadCards, loadCategories, loadTransactions } from "@/lib/data/repo";
import { statementForMonth } from "@/lib/finance/cards";
import { checkStatement } from "@/lib/finance/card-check";
import { fakePluggy, type FakeState } from "../support/pluggy-fake";
import { testDb } from "../support/db";

process.env.APP_ENCRYPTION_KEY = Buffer.alloc(32, 7).toString("base64");

const ITEM = "11111111-1111-4111-8111-111111111111";
const CARD = "33333333-3333-4333-8333-333333333333";
const TODAY = "2026-11-23";
const NOW = new Date(`${TODAY}T15:00:00Z`);
const at = (ymd: string) => `${ymd}T12:00:00.000Z`;
type Row = Record<string, unknown>;
const charge = (id: string, ymd: string, amount: number, extra: Row = {}): Row => ({ id, date: at(ymd), description: `COMPRA ${id}`, amount, type: "DEBIT", status: "POSTED", ...extra });
const bill = (id: string, closing: string, due: string, total: number): Row => ({ id, dueDate: at(due), billClosingDate: at(closing), totalAmount: total, totalAmountCurrencyCode: "BRL", payments: [] });
const first = charge("p1", "2026-10-10", 100.03, { description: "LOJA PARCELADA", creditCardMetadata: { installmentNumber: 1, totalInstallments: 4 } });

let db: Awaited<ReturnType<typeof testDb>>;
let userId: string;
let state: FakeState;
let client: PluggyClient;

beforeEach(async () => {
  db = await testDb();
  userId = await createUser(db, { name: "Dono", email: "dono@exemplo.test", password: "senha-de-teste-123" });
  state = {
    item: ITEM,
    connector: "Banco Teste",
    accounts: [{ id: CARD, type: "CREDIT", subtype: "CREDIT_CARD", number: "2", name: "Cartão", balance: 300, currencyCode: "BRL", creditData: { creditLimit: 5000, availableCreditLimit: 4700, balanceCloseDate: null, balanceDueDate: "2026-12-01" } }],
    txs: { [CARD]: [first, charge("o1", "2026-10-12", 49.97, { creditCardMetadata: { billId: "OUT" } }), charge("n1", "2026-11-05", 200, { creditCardMetadata: { billId: "NOV" } })] },
    bills: { [CARD]: [bill("OUT", "2026-10-20", "2026-11-01", 150), bill("NOV", "2026-11-17", "2026-12-01", 300)] },
    calls: [],
  };
  client = new PluggyClient({ clientId: "id", clientSecret: "secret" }, fakePluggy(state));
  await connectItem(db, client, userId, ITEM, NOW);
});

const resync = async () => {
  const [conn] = await db.select().from(s.financialConnections).where(eq(s.financialConnections.userId, userId));
  await syncConnection(db, client, conn!, NOW);
};

const december = async () => {
  const [cards, txs, cats] = await Promise.all([loadCards(db, userId), loadTransactions(db, userId, { includeFuture: true, today: TODAY }), loadCategories(db, userId)]);
  const card = cards[0]!;
  return { st: statementForMonth(card, txs, cats, TODAY, "2026-12")!, check: checkStatement(card, txs, cats, TODAY, "2026-12")!, card };
};

describe("parcela prevista after a sync", () => {
  it("counts 2/4 as prevista in the closed bill: three cents of rounding from the bank, not a divergence", async () => {
    const { st, check } = await december();
    expect(st.computedCents).toBe(30003);
    expect(check.divergence).toBeNull();
    const prevista = check.included.filter((r) => r.projected);
    expect(prevista).toEqual([expect.objectContaining({ installment: "2/4", amountCents: -10003, reason: "projected" })]);
  });

  it("the person excludes it, it stays excluded, and can be brought back", async () => {
    const { check } = await december();
    const key = check.included.find((r) => r.projected)!.projectionKey!;
    const accountId = (await loadCards(db, userId))[0]!.accountId;
    expect(await dismissProjection(db, userId, accountId, key, TODAY)).toBe(true);
    expect(await dismissProjection(db, userId, accountId, key, TODAY)).toBe(false); // already excluded: nothing stored twice
    const after = await december();
    expect(after.card.dismissedProjections).toEqual([key]);
    expect(after.st.computedCents).toBe(20000);
    await resync();
    expect((await december()).card.dismissedProjections).toEqual([key]); // a sync does not bring it back
    expect(await restoreProjections(db, userId, accountId)).toBe(true);
    expect((await december()).st.computedCents).toBe(30003);
  });

  it("refuses keys that are not a prevista of this person's card", async () => {
    const other = await createUser(db, { name: "Outra", email: "outra@exemplo.test", password: "senha-de-teste-123" });
    const accountId = (await loadCards(db, userId))[0]!.accountId;
    const { check } = await december();
    const key = check.included.find((r) => r.projected)!.projectionKey!;
    expect(await dismissProjection(db, other, accountId, key, TODAY)).toBe(false);
    expect(await dismissProjection(db, userId, accountId, "qualquer-coisa", TODAY)).toBe(false);
    expect(await dismissProjection(db, userId, accountId, `${key.split("#")[0]}#9`, TODAY)).toBe(false); // beyond 4 installments
    expect((await december()).card.dismissedProjections).toEqual([]);
  });

  it("when the bank sends 2/4 later, it replaces the prevista without counting twice", async () => {
    state.txs[CARD]!.push(charge("p2", "2026-11-10", 100, { description: "LOJA PARCELADA", creditCardMetadata: { installmentNumber: 2, totalInstallments: 4, billId: "NOV" } }));
    state.bills[CARD]![1] = bill("NOV", "2026-11-17", "2026-12-01", 300);
    await resync();
    const { st, check } = await december();
    expect(check.included.some((r) => r.projected)).toBe(false);
    expect(st.computedCents).toBe(30000);
  });
});
