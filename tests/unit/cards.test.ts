import { describe, expect, it } from "vitest";
import { cardHref, parseCardMonth, parseCardTab } from "@/lib/card-query";
import { accountBalances, creditCardSummary, type CardInfo, type FinAccount, type FinCategory, type FinTx } from "@/lib/finance/core";
import { cardOverviews, cardsDueSoon, cardStatements, installmentPlans, installmentSchedule, installmentsInMonth, nextStatement, statementForMonth } from "@/lib/finance/cards";
import { formatDayMonth, formatMonthYear } from "@/lib/dates";

const cats: FinCategory[] = [
  { id: "c-exp", name: "Compras", slug: "compras", kind: "expense" },
  { id: "c-pay", name: "Pagamento de fatura", slug: "pagamento-fatura", kind: "transfer" },
];
let n = 0;
const tx = (date: string, amountCents: number, over: Partial<FinTx> = {}): FinTx => ({
  id: `t${++n}`,
  accountId: "k",
  categoryId: "c-exp",
  date,
  description: "Compra",
  merchant: "compra",
  amountCents,
  installmentNumber: null,
  installmentTotal: null,
  ...over,
});
const parcel = (date: string, number: number, total: number, cents: number, over: Partial<FinTx> = {}) =>
  tx(date, -cents, { description: `Loja Azul ${number}/${total}`, merchant: "loja azul", installmentNumber: number, installmentTotal: total, ...over });
const card: CardInfo = { accountId: "k", limitCents: 100000, closingDay: 25, dueDay: 5 };

describe("cardStatements", () => {
  it("walks back cycle by cycle, newest first, and dates decide open or closed", () => {
    const [open, closed, older] = cardStatements(card, [], cats, "2026-10-10", 3);
    expect(open).toMatchObject({ cycle: { from: "2026-09-26", to: "2026-10-25" }, dueDate: "2026-11-05", status: "open", paymentWindow: null });
    expect(closed).toMatchObject({ cycle: { from: "2026-08-26", to: "2026-09-25" }, dueDate: "2026-10-05", status: "closed", paymentWindow: { from: "2026-09-26", to: "2026-10-25" } });
    expect(older).toMatchObject({ cycle: { from: "2026-07-26", to: "2026-08-25" }, status: "closed" });
  });

  it("keeps cycles intact over short months when the closing day is clamped", () => {
    const list = cardStatements({ ...card, closingDay: 31, dueDay: 10 }, [], cats, "2026-03-15", 2);
    expect(list.map((s) => s.cycle)).toEqual([{ from: "2026-03-01", to: "2026-03-31" }, { from: "2026-02-01", to: "2026-02-28" }]);
  });

  it("separates charges, refunds and payments, and matches creditCardSummary", () => {
    const txs = [tx("2026-10-01", -30000), tx("2026-10-02", 5000), tx("2026-10-03", 20000, { categoryId: "c-pay" }), tx("2026-10-04", -1000, { accountId: "other" })];
    const [open] = cardStatements(card, txs, cats, "2026-10-10");
    expect(open).toMatchObject({ chargesCents: 30000, refundsCents: 5000, totalCents: 25000, count: 2, paymentsCents: 0 });
    expect(open!.totalCents).toBe(creditCardSummary(card, txs, cats, -10000, "2026-10-10").statementCents);
  });

  it("only reports payments posted after the statement closed, and never decides it was paid", () => {
    const txs = [tx("2026-09-20", -30000), tx("2026-09-20", 99900, { categoryId: "c-pay" }), tx("2026-10-05", 30000, { categoryId: "c-pay" })];
    const [, closed] = cardStatements(card, txs, cats, "2026-10-10");
    expect(closed).toMatchObject({ status: "closed", totalCents: 30000, paymentsCents: 30000 });
    expect(Object.keys(closed!)).not.toContain("paid");
  });

  it("next statement skips due dates in the past", () => {
    const list = cardStatements(card, [], cats, "2026-10-10");
    expect(nextStatement(list, "2026-10-10")?.dueDate).toBe("2026-11-05");
    const closedAndDue = cardStatements(card, [], cats, "2026-09-28");
    expect(nextStatement(closedAndDue, "2026-09-28")?.dueDate).toBe("2026-10-05");
  });
});

describe("installmentPlans", () => {
  it("reads progress, remaining value and the last expected date from the rows", () => {
    const [p] = installmentPlans([parcel("2026-09-14", 2, 10, 38990), parcel("2026-10-14", 3, 10, 38990)], "2026-11-01");
    expect(p).toMatchObject({ label: "Loja Azul", current: 3, total: 10, remaining: 7, nextDate: "2026-11-14", lastDate: "2027-05-14", chargedCents: 116970, remainingCents: 272930, estimated: false });
  });

  it("keeps two purchases at the same store apart", () => {
    const plans = installmentPlans([parcel("2026-10-05", 1, 3, 5000), parcel("2026-10-20", 4, 6, 5000)], "2026-10-25");
    expect(plans.map((p) => [p.current, p.total])).toEqual([[1, 3], [4, 6]]);
  });

  it("does not count a purchase twice when the bank moves a date into the next month", () => {
    const plans = installmentPlans([parcel("2026-08-30", 2, 5, 1000), parcel("2026-10-01", 3, 5, 1000)], "2026-10-10");
    expect(plans.map((p) => [p.current, p.remaining])).toEqual([[3, 2]]);
  });

  it("leaves finished purchases out, including those finished only by the passing of time", () => {
    expect(installmentPlans([parcel("2026-09-01", 10, 10, 1000)], "2026-09-02")).toEqual([]);
    expect(installmentPlans([parcel("2026-01-10", 2, 3, 1000)], "2026-10-01")).toEqual([]);
  });

  it("moves forward by date when rows stop arriving, and says so", () => {
    const [p] = installmentPlans([parcel("2026-07-10", 2, 10, 1000)], "2026-10-01");
    expect(p).toMatchObject({ current: 4, remaining: 6, nextDate: "2026-10-10", estimated: true, remainingCents: 6000 });
  });

  it("does not count a future-dated row as charged", () => {
    const [p] = installmentPlans([parcel("2026-10-10", 1, 3, 1000), parcel("2026-11-10", 2, 3, 1000)], "2026-10-20");
    expect(p).toMatchObject({ current: 1, remaining: 2, nextDate: "2026-11-10" });
    const [q] = installmentPlans([parcel("2026-11-10", 1, 3, 1000)], "2026-10-20");
    expect(q).toMatchObject({ current: 0, remaining: 3, nextDate: "2026-11-10" });
  });

  it("ignores refunds and other accounts", () => {
    const rows = [parcel("2026-10-10", 1, 3, 1000, { accountId: "conta" }), tx("2026-10-11", 1000, { installmentNumber: 1, installmentTotal: 3 })];
    expect(installmentPlans(rows, "2026-10-20", ["k"])).toEqual([]);
  });

  it("schedule adds up every open purchase month by month and ends with the last installment", () => {
    const plans = installmentPlans([parcel("2026-10-14", 3, 5, 2000), tx("2026-10-20", -500, { merchant: "outra", description: "Outra 1/2", installmentNumber: 1, installmentTotal: 2 })], "2026-10-25");
    const schedule = installmentSchedule(plans, "2026-10-25", 4);
    expect(schedule.map((m) => [m.month, m.cents, m.count])).toEqual([["2026-10-01", 0, 0], ["2026-11-01", 2500, 2], ["2026-12-01", 2000, 1], ["2027-01-01", 0, 0]]);
  });
});

describe("cardOverviews", () => {
  const accounts: FinAccount[] = [
    { id: "a", name: "Conta", institution: "Banco", type: "checking", openingBalanceCents: 0 },
    { id: "k", name: "Cartão", institution: "Banco", type: "credit_card", openingBalanceCents: 0 },
    { id: "z", name: "Sem dados", institution: "Banco", type: "credit_card", openingBalanceCents: 0 },
  ];
  const txs = [tx("2026-10-01", -30000), parcel("2026-10-02", 1, 3, 10000)];
  const list = cardOverviews(accountBalances(accounts, txs, "2026-10-10"), [card], txs, cats, "2026-10-10");

  it("only lists cards and labels the left-over limit from what was posted", () => {
    expect(list.map((c) => c.id)).toEqual(["k", "z"]);
    expect(list[0]).toMatchObject({ openCents: 40000, limitCents: 100000, leftCents: 60000, futureInstallmentsCents: 20000 });
  });

  it("a card without registered days has no cycle instead of an invented one", () => {
    expect(list[1]).toMatchObject({ info: null, statements: [], next: null, limitCents: 0 });
  });

  it("due soon needs something posted and a date inside the window", () => {
    expect(cardsDueSoon(list, "2026-10-10", 7)).toEqual([]);
    expect(cardsDueSoon(list, "2026-10-10", 30).map((c) => c.id)).toEqual(["k"]);
  });
});

describe("card URLs and dates", () => {
  it("tab survives the URL and unknown values fall back", () => {
    expect(parseCardTab("limites")).toBe("limites");
    expect(parseCardTab("<script>")).toBe("faturas");
    expect(parseCardTab(["parcelas", "x"])).toBe("parcelas");
    expect(cardHref({ cartao: "abc", aba: "parcelas" })).toBe("/cartoes?cartao=abc&aba=parcelas");
    expect(cardHref({ aba: "faturas" })).toBe("/cartoes");
  });

  it("reads dates the way people say them", () => {
    expect(formatDayMonth("2026-12-03", "2026-11-01")).toBe("3 de dezembro");
    expect(formatDayMonth("2027-01-03", "2026-11-01")).toBe("3 de janeiro de 2027");
    expect(formatMonthYear("2027-01-03")).toBe("janeiro de 2027");
  });
});

describe("statementForMonth", () => {
  const today = "2026-10-10";
  const txs = [tx("2026-08-01", -4000), parcel("2026-10-14", 3, 5, 2000)];

  it("finds a closed statement by the month it comes due", () => {
    expect(statementForMonth(card, txs, cats, today, "2026-09")).toMatchObject({ dueDate: "2026-09-05", cycle: { from: "2026-07-26", to: "2026-08-25" }, status: "closed", totalCents: 4000 });
  });

  it("returns the open statement for its own due month", () => {
    expect(statementForMonth(card, txs, cats, today, "2026-11")).toMatchObject({ dueDate: "2026-11-05", status: "open" });
  });

  it("forecasts a future statement only from installments already known", () => {
    expect(statementForMonth(card, txs, cats, today, "2026-12")).toMatchObject({ dueDate: "2026-12-05", cycle: { from: "2026-10-26", to: "2026-11-25" }, status: "future", totalCents: 2000, count: 1, paymentWindow: null });
  });

  it("has nothing too far away in either direction", () => {
    expect(statementForMonth(card, txs, cats, today, "2020-01")).toBeNull();
    expect(statementForMonth(card, txs, cats, today, "2030-01")).toBeNull();
  });
});

describe("installmentsInMonth", () => {
  const today = "2026-10-25";
  const txs = [parcel("2026-09-14", 2, 5, 2000), parcel("2026-10-14", 3, 5, 2000), tx("2026-08-03", -700, { description: "Fone 2/2", merchant: "fone", installmentNumber: 2, installmentTotal: 2 })];

  it("lists what was charged in a past month, including purchases already finished", () => {
    expect(installmentsInMonth(txs, today, "2026-09")).toMatchObject({ cents: 2000, count: 1, items: [{ label: "Loja Azul", number: 2, total: 5, cents: 2000, projected: false }] });
    expect(installmentsInMonth(txs, today, "2026-08").items).toMatchObject([{ label: "Fone", number: 2, total: 2, projected: false }]);
  });

  it("forecasts later months from the purchases still open, up to the last installment", () => {
    expect(installmentsInMonth(txs, today, "2026-12").items).toMatchObject([{ number: 5, total: 5, cents: 2000, projected: true }]);
    expect(installmentsInMonth(txs, today, "2027-01")).toMatchObject({ cents: 0, count: 0, items: [] });
  });

  it("keeps only the chosen cards", () => {
    expect(installmentsInMonth(txs, today, "2026-09", ["outro"]).count).toBe(0);
  });
});

describe("parseCardMonth", () => {
  it("accepts a real YYYY-MM and nothing else", () => {
    expect(parseCardMonth("2026-12")).toBe("2026-12");
    expect(parseCardMonth(["2026-01", "x"])).toBe("2026-01");
    expect(parseCardMonth("2026-13")).toBeUndefined();
    expect(parseCardMonth("dez")).toBeUndefined();
    expect(parseCardMonth(undefined)).toBeUndefined();
  });
  it("travels in card links", () => {
    expect(cardHref({ cartao: "k", aba: "parcelas", mes: "2026-12" })).toBe("/cartoes?cartao=k&aba=parcelas&mes=2026-12");
  });
});
