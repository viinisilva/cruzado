// Reconciliation through real syncs (docs/AUTOCONCILIACAO.md): old bills only get proposals (the dry run), a bill closed
// after the first run is fixed alone when the answer is unique and has evidence, and every change can be undone.
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import * as s from "@/db/schema";
import { createUser } from "@/lib/auth/users";
import { applyAllProposals, reconciliationHealth, revertChange } from "@/lib/card-reconciliation";
import { connectItem, syncConnection } from "@/lib/connectors/open-finance";
import { PluggyClient } from "@/lib/connectors/pluggy";
import { loadCards, loadCategories, loadTransactions } from "@/lib/data/repo";
import { statementForMonth } from "@/lib/finance/cards";
import { fakePluggy, type FakeState } from "../support/pluggy-fake";
import { testDb } from "../support/db";

process.env.APP_ENCRYPTION_KEY = Buffer.alloc(32, 7).toString("base64");

const ITEM = "11111111-1111-4111-8111-111111111111";
const CARD = "33333333-3333-4333-8333-333333333333";
const CASH = "22222222-2222-4222-8222-222222222222";
const at = (ymd: string) => `${ymd}T12:00:00.000Z`;
type Row = Record<string, unknown>;
const charge = (id: string, ymd: string, amount: number, billId?: string): Row => ({ id, date: at(ymd), description: `COMPRA ${id}`, amount, type: "DEBIT", status: "POSTED", ...(billId ? { creditCardMetadata: { billId } } : {}) });
// A refund the bank marked ESTORNO but worded like a payment, with a same-day debit of the same (distinctive) amount.
const misleading = (id: string, ymd: string, billId: string): Row => ({ id, date: at(ymd), description: "AJUSTE PAGAMENTO", amount: -30.45, type: "CREDIT", status: "POSTED", operationType: "ESTORNO", creditCardMetadata: { billId } });
const bill = (id: string, closing: string, due: string, total: number): Row => ({ id, dueDate: at(due), billClosingDate: at(closing), totalAmount: total, totalAmountCurrencyCode: "BRL", payments: [] });

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
    accounts: [
      { id: CASH, type: "BANK", subtype: "CHECKING_ACCOUNT", number: "1", name: "Conta", balance: 100, currencyCode: "BRL" },
      { id: CARD, type: "CREDIT", subtype: "CREDIT_CARD", number: "2", name: "Cartão", balance: 470, currencyCode: "BRL", creditData: { creditLimit: 5000, availableCreditLimit: 4530, balanceCloseDate: null, balanceDueDate: "2026-11-25" } },
    ],
    txs: {
      [CASH]: [{ id: "k1", date: at("2026-11-05"), description: "TRANSFERENCIA ENVIADA", amount: -30.45, type: "DEBIT", status: "POSTED" }],
      [CARD]: [charge("o1", "2026-10-01", 200, "OCT"), charge("n1", "2026-10-20", 500, "NOV"), misleading("r1", "2026-11-05", "NOV")],
    },
    bills: { [CARD]: [bill("OCT", "2026-10-15", "2026-10-25", 200), bill("NOV", "2026-11-15", "2026-11-25", 469.55)] },
    calls: [],
  };
  client = new PluggyClient({ clientId: "id", clientSecret: "secret" }, fakePluggy(state));
});

const slugOf = async (description: string) => {
  const [txs, cats] = await Promise.all([loadTransactions(db, userId, { includeFuture: true }), loadCategories(db, userId)]);
  const t = txs.find((x) => x.description === description)!;
  return { t, slug: cats.find((c) => c.id === t.categoryId)?.slug };
};

describe("reconciliation of closed bills", () => {
  it("a bill closed before the first run only gets a proposal: the dry run", async () => {
    await connectItem(db, client, userId, ITEM, new Date("2026-11-17T15:00:00Z"));
    const { t, slug } = await slugOf("AJUSTE PAGAMENTO");
    expect(slug).toBe("pagamento-fatura");
    expect(t.classification).toMatchObject({ kind: "payment" });
    const changes = await db.select().from(s.reconciliationChanges).where(eq(s.reconciliationChanges.transactionId, t.id));
    expect(changes).toMatchObject([{ status: "proposed", source: "reconciler", after: { change: "to-refund" } }]);
    // Applying the report makes the bill match, and the entry becomes the person's choice.
    expect(await applyAllProposals(db, userId)).toBe(1);
    const after = await slugOf("AJUSTE PAGAMENTO");
    expect(after).toMatchObject({ slug: "outras-despesas", t: { categorySource: "user" } });
  });

  it("a bill closed after the first run is fixed alone, recorded, learned, and can be undone", async () => {
    // First run before the December bill exists.
    state.txs[CARD] = [charge("o1", "2026-10-01", 200, "OCT"), charge("n1", "2026-10-20", 469.55, "NOV")];
    state.txs[CASH] = [];
    await connectItem(db, client, userId, ITEM, new Date("2026-11-17T15:00:00Z"));
    // A month later the December bill closes with the misleading credit in it.
    state.txs[CARD]!.push(charge("d1", "2026-11-20", 500, "DEC"), misleading("r2", "2026-12-05", "DEC"));
    state.txs[CASH] = [{ id: "k2", date: at("2026-12-05"), description: "TRANSFERENCIA ENVIADA", amount: -30.45, type: "DEBIT", status: "POSTED" }];
    state.bills[CARD]!.push(bill("DEC", "2026-12-15", "2026-12-25", 469.55));
    const [conn] = await db.select().from(s.financialConnections).where(eq(s.financialConnections.userId, userId));
    await syncConnection(db, client, conn!, new Date("2026-12-17T15:00:00Z"));

    const { t, slug } = await slugOf("AJUSTE PAGAMENTO");
    expect({ slug, source: t.categorySource }).toEqual({ slug: "outras-despesas", source: "reconciler" });
    const [cards, txs, cats] = await Promise.all([loadCards(db, userId), loadTransactions(db, userId, { includeFuture: true, today: "2026-12-17" }), loadCategories(db, userId)]);
    expect(statementForMonth(cards[0]!, txs, cats, "2026-12-17", "2026-12")).toMatchObject({ computedCents: 46955, bankTotalCents: 46955 });
    const [change] = await db.select().from(s.reconciliationChanges).where(eq(s.reconciliationChanges.transactionId, t.id));
    expect(change).toMatchObject({ status: "applied", source: "reconciler", before: { categorySource: "keyword" } });
    const [rule] = await db.select().from(s.reconciliationRules).where(eq(s.reconciliationRules.userId, userId));
    expect(rule).toMatchObject({ institution: "Banco Teste", change: "to-refund", evidence: 1, contradictions: 0 });
    expect(rule!.pattern).not.toContain("AJUSTE");

    // Undo: the old category comes back, the entry is the person's now, and the rule loses its standing.
    expect(await revertChange(db, userId, change!.id)).toBe(true);
    expect(await slugOf("AJUSTE PAGAMENTO")).toMatchObject({ slug: "pagamento-fatura", t: { categorySource: "user" } });
    const [after] = await db.select().from(s.reconciliationRules).where(eq(s.reconciliationRules.userId, userId));
    expect(after!.contradictions).toBe(1);
    // And the next sync does not apply it again.
    await syncConnection(db, client, conn!, new Date("2026-12-18T15:00:00Z"));
    expect((await slugOf("AJUSTE PAGAMENTO")).slug).toBe("pagamento-fatura");
  });

  it("the health page counts outcomes per bank, without amounts", async () => {
    await connectItem(db, client, userId, ITEM, new Date("2026-11-17T15:00:00Z"));
    const health = await reconciliationHealth(db, userId);
    // October matched; November (closed before the first run) only got a proposal.
    expect(health).toEqual([{ institution: "Banco Teste", bills: 2, matched: 1, fixed: 0, waiting: 1, open: 0, kinds: { "to-refund": 1 } }]);
    await applyAllProposals(db, userId);
    const [conn] = await db.select().from(s.financialConnections).where(eq(s.financialConnections.userId, userId));
    await syncConnection(db, client, conn!, new Date("2026-11-18T15:00:00Z"));
    expect((await reconciliationHealth(db, userId))[0]).toMatchObject({ matched: 1, fixed: 1, waiting: 0 });
    const events = await db.select().from(s.reconciliationEvents);
    expect(JSON.stringify(events)).not.toMatch(/3000|47000|AJUSTE/);
  });
});

describe("review fixes", () => {
  it("a proposal never overwrites a category the person chose after it was made", async () => {
    await connectItem(db, client, userId, ITEM, new Date("2026-11-17T15:00:00Z"));
    const { t } = await slugOf("AJUSTE PAGAMENTO");
    const lazer = (await loadCategories(db, userId)).find((c) => c.slug === "lazer")!.id;
    await db.update(s.transactions).set({ categoryId: lazer, categorySource: "user" }).where(eq(s.transactions.id, t.id));
    expect(await applyAllProposals(db, userId)).toBe(1);
    expect((await slugOf("AJUSTE PAGAMENTO")).slug).toBe("lazer");
    const [change] = await db.select().from(s.reconciliationChanges).where(eq(s.reconciliationChanges.transactionId, t.id));
    expect(change!.status).toBe("dismissed");
  });

  it("a classifier proposal that the evidence no longer supports is retired", async () => {
    await connectItem(db, client, userId, ITEM, new Date("2026-11-17T15:00:00Z"));
    // A legacy credit, proposed as a refund of nothing (fallback), then the bank lists it as a payment of the bill.
    state.txs[CARD]!.push({ id: "c9", date: at("2026-11-16"), description: "CREDITO", amount: -12.34, type: "CREDIT", status: "POSTED" });
    const [conn] = await db.select().from(s.financialConnections).where(eq(s.financialConnections.userId, userId));
    await syncConnection(db, client, conn!, new Date("2026-11-18T15:00:00Z"));
    const credit = (await slugOf("CREDITO")).t;
    const bill = (await loadCategories(db, userId)).find((c) => c.slug === "pagamento-fatura")!.id;
    await db.update(s.transactions).set({ categoryId: bill, categorySource: null }).where(eq(s.transactions.id, credit.id));
    await syncConnection(db, client, conn!, new Date("2026-11-19T15:00:00Z"));
    expect((await db.select().from(s.reconciliationChanges).where(eq(s.reconciliationChanges.transactionId, credit.id))).map((c) => c.status)).toContain("proposed");
    state.bills[CARD]!.push(bill2("DEC2", "2026-12-15", "2026-12-25", 12.34, [{ id: "p", amount: 12.34, paymentDate: at("2026-11-16"), paymentMode: "PIX", valueType: "OTHER" }]));
    await db.update(s.creditCards).set({ billsFetchedAt: null }).where(eq(s.creditCards.userId, userId));
    await syncConnection(db, client, conn!, new Date("2026-11-20T15:00:00Z"));
    const statuses = (await db.select().from(s.reconciliationChanges).where(eq(s.reconciliationChanges.transactionId, credit.id))).map((c) => c.status);
    expect(statuses).not.toContain("proposed");
  });
});

const bill2 = (id: string, closing: string, due: string, total: number, payments: Row[]): Row => ({ id, dueDate: at(due), billClosingDate: at(closing), totalAmount: total, totalAmountCurrencyCode: "BRL", payments });
