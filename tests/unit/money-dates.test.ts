import { describe, expect, it } from "vitest";
import { assertCents, changeBasisPoints, formatBasisPoints, formatBRL, parseMoneyToCents, sumCents } from "@/lib/money";
import { addDays, addMonths, daysInMonth, endOfMonth, hourInSaoPaulo, parseFlexibleDate, startOfMonth, startOfWeek, todayInSaoPaulo } from "@/lib/dates";
import { normalizeMerchant, parseInstallment } from "@/lib/text";
import { presetRange, previousComparableRange, resolvePeriod } from "@/lib/finance/period";

describe("parseMoneyToCents", () => {
  it.each([
    ["1.234,56", 123456],
    ["1234,56", 123456],
    ["1,234.56", 123456],
    ["1234.56", 123456],
    ["-R$ 12,30", -1230],
    ["(12,30)", -1230],
    ["12", 1200],
    ["0,1", 10],
    ["1.234", 123400],
    ["1.234.567,89", 123456789],
    ["12,30-", -1230],
    ["+5,00", 500],
  ])("%s → %i", (input, cents) => expect(parseMoneyToCents(input)).toBe(cents));

  it.each(["", "abc", "1,234,5678", "12,345", "R$", "1.23.4,00"])("rejects %s", (input) => {
    expect(parseMoneyToCents(input)).toBeNull();
  });

  it("never produces float artifacts", () => {
    expect(parseMoneyToCents("0,29")).toBe(29);
    expect(parseMoneyToCents("1,15")).toBe(115);
    expect(sumCents([10, 20])).toBe(30);
    expect(() => sumCents([0.1, 0.2])).toThrow();
  });
});

describe("formatting and percentages", () => {
  it("formats BRL", () => {
    expect(formatBRL(123456)).toBe("R$ 1.234,56");
    expect(formatBRL(-5)).toBe("-R$ 0,05");
  });
  it("computes integer basis points", () => {
    expect(changeBasisPoints(10000, 15000)).toBe(5000);
    expect(changeBasisPoints(0, 100)).toBeNull();
    expect(changeBasisPoints(3, 4)).toBe(3333);
  });
});

describe("dates", () => {
  it("uses São Paulo calendar day", () => {
    // 02:30 UTC is still the previous day in São Paulo (UTC-3)
    expect(todayInSaoPaulo(new Date("2025-03-01T02:30:00Z"))).toBe("2025-02-28");
  });
  it("clamps month arithmetic", () => {
    expect(addMonths("2025-01-31", 1)).toBe("2025-02-28");
    expect(addMonths("2024-01-31", 1)).toBe("2024-02-29");
    expect(addMonths("2025-03-15", -3)).toBe("2024-12-15");
    expect(endOfMonth("2025-02-10")).toBe("2025-02-28");
  });
  it("finds Monday", () => {
    expect(startOfWeek("2025-10-15")).toBe("2025-10-13");
    expect(startOfWeek("2025-10-19")).toBe("2025-10-13");
    expect(startOfWeek("2025-10-13")).toBe("2025-10-13");
  });
  it("parses flexible dates", () => {
    expect(parseFlexibleDate("05/10/2025")).toBe("2025-10-05");
    expect(parseFlexibleDate("5/1/25")).toBe("2025-01-05");
    expect(parseFlexibleDate("20251005120000[-3:BRT]")).toBe("2025-10-05");
    expect(parseFlexibleDate("31/02/2025")).toBeNull();
  });
  it("resolves periods and flags defaults", () => {
    expect(resolvePeriod(undefined, "2025-10-15")).toMatchObject({ from: "2025-10-01", to: "2025-10-15", defaulted: true });
    expect(resolvePeriod({ preset: "last_month" }, "2025-10-15")).toMatchObject({ from: "2025-09-01", to: "2025-09-30", defaulted: false });
    expect(resolvePeriod({ from: "2025-10-10", to: "2025-10-01" }, "2025-10-15")).toMatchObject({ from: "2025-10-01", to: "2025-10-10" });
    expect(() => resolvePeriod({ from: "2025-13-01" }, "2025-10-15")).toThrow();
  });
  it("builds comparable previous range", () => {
    expect(previousComparableRange({ from: "2025-10-01", to: "2025-10-15" })).toEqual({ from: "2025-09-01", to: "2025-09-15" });
    expect(previousComparableRange({ from: "2025-03-01", to: "2025-03-31" })).toEqual({ from: "2025-02-01", to: "2025-02-28" });
  });
});

describe("text", () => {
  it("normalizes merchants and installments", () => {
    expect(normalizeMerchant("Loja Casa & Cia Geladeira 3/10")).toBe(normalizeMerchant("LOJA CASA & CIA GELADEIRA 4/10"));
    expect(normalizeMerchant("Compra Cartão VISA Farmácia Bem-Estar 123")).toBe("farmacia bem estar");
    expect(parseInstallment("Geladeira 3/10")).toEqual({ number: 3, total: 10 });
    expect(parseInstallment("Pedido 12/05")).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// assertCents
// ---------------------------------------------------------------------------

describe("assertCents", () => {
  it("returns the value when it is a safe integer", () => {
    expect(assertCents(0)).toBe(0);
    expect(assertCents(12345)).toBe(12345);
    expect(assertCents(-9999)).toBe(-9999);
    expect(assertCents(Number.MAX_SAFE_INTEGER)).toBe(Number.MAX_SAFE_INTEGER);
  });

  it("throws for non-integer values (floats)", () => {
    expect(() => assertCents(0.1)).toThrow();
    expect(() => assertCents(1.5)).toThrow();
    expect(() => assertCents(123.99)).toThrow();
  });

  it("throws for unsafe integers", () => {
    expect(() => assertCents(Number.MAX_SAFE_INTEGER + 1)).toThrow();
  });

  it("throws for NaN and Infinity", () => {
    expect(() => assertCents(NaN)).toThrow();
    expect(() => assertCents(Infinity)).toThrow();
    expect(() => assertCents(-Infinity)).toThrow();
  });
});

// ---------------------------------------------------------------------------
// formatBasisPoints
// ---------------------------------------------------------------------------

describe("formatBasisPoints", () => {
  it("null → 'sem base de comparação'", () => {
    expect(formatBasisPoints(null)).toBe("sem base de comparação");
  });

  it("positive → '+X%' format", () => {
    expect(formatBasisPoints(5000)).toBe("+50%");
    expect(formatBasisPoints(100)).toBe("+1%");
    expect(formatBasisPoints(50)).toBe("+0,5%");
  });

  it("negative → '-X%' format (no explicit plus sign)", () => {
    expect(formatBasisPoints(-5000)).toBe("-50%");
    expect(formatBasisPoints(-100)).toBe("-1%");
  });

  it("zero → '0%'", () => {
    expect(formatBasisPoints(0)).toBe("0%");
  });
});

// ---------------------------------------------------------------------------
// dates – additional coverage
// ---------------------------------------------------------------------------

describe("dates – additional coverage", () => {
  it("hourInSaoPaulo extracts the São Paulo hour", () => {
    // 2025-10-15T11:00:00Z = 08:00 in São Paulo (UTC-3)
    expect(hourInSaoPaulo(new Date("2025-10-15T11:00:00Z"))).toBe(8);
    // 2025-10-15T00:00:00Z = 21:00 on the previous day in São Paulo
    expect(hourInSaoPaulo(new Date("2025-10-15T00:00:00Z"))).toBe(21);
  });

  it("addDays handles month and year boundaries", () => {
    expect(addDays("2025-01-31", 1)).toBe("2025-02-01");
    expect(addDays("2025-12-31", 1)).toBe("2026-01-01");
    expect(addDays("2025-03-01", -1)).toBe("2025-02-28");
    expect(addDays("2024-03-01", -1)).toBe("2024-02-29"); // leap year
  });

  it("daysInMonth returns correct values including leap years", () => {
    expect(daysInMonth(2025, 2)).toBe(28);
    expect(daysInMonth(2024, 2)).toBe(29);
    expect(daysInMonth(2025, 1)).toBe(31);
    expect(daysInMonth(2025, 4)).toBe(30);
    expect(daysInMonth(2025, 12)).toBe(31);
  });

  it("startOfMonth returns YYYY-MM-01", () => {
    expect(startOfMonth("2025-10-15")).toBe("2025-10-01");
    expect(startOfMonth("2025-01-01")).toBe("2025-01-01");
  });

  it("addMonths handles December → January year boundary", () => {
    expect(addMonths("2025-12-15", 1)).toBe("2026-01-15");
    expect(addMonths("2025-01-01", -1)).toBe("2024-12-01");
  });

  it("startOfWeek on Sunday goes back to previous Monday", () => {
    // 2025-10-19 is Sunday
    expect(startOfWeek("2025-10-19")).toBe("2025-10-13");
    // 2025-10-20 is Monday
    expect(startOfWeek("2025-10-20")).toBe("2025-10-20");
    // 2025-10-26 is Sunday, week started on 2025-10-20
    expect(startOfWeek("2025-10-26")).toBe("2025-10-20");
  });

  it("startOfWeek crosses year boundary correctly", () => {
    // 2026-01-04 is a Sunday; Monday of that week = 2025-12-29
    expect(startOfWeek("2026-01-04")).toBe("2025-12-29");
  });
});

// ---------------------------------------------------------------------------
// presetRange
// ---------------------------------------------------------------------------

describe("presetRange", () => {
  const today = "2025-10-15";

  it("this_month: from start of month to today", () => {
    expect(presetRange("this_month", today)).toEqual({ from: "2025-10-01", to: today });
  });

  it("last_month: full previous calendar month", () => {
    expect(presetRange("last_month", today)).toEqual({ from: "2025-09-01", to: "2025-09-30" });
  });

  it("last_month in January wraps to December of previous year", () => {
    expect(presetRange("last_month", "2025-01-15")).toEqual({ from: "2024-12-01", to: "2024-12-31" });
  });

  it("this_week: from Monday to today", () => {
    // 2025-10-15 is Wednesday; Monday = 2025-10-13
    expect(presetRange("this_week", today)).toEqual({ from: "2025-10-13", to: today });
  });

  it("last_week: previous Monday to Sunday", () => {
    // Mon 2025-10-13 − 7 days = Mon 2025-10-06; +6 = Sun 2025-10-12
    expect(presetRange("last_week", today)).toEqual({ from: "2025-10-06", to: "2025-10-12" });
  });

  it("last_30_days and last_90_days", () => {
    const r30 = presetRange("last_30_days", today);
    expect(r30).toEqual({ from: "2025-09-16", to: today });
    const r90 = presetRange("last_90_days", today);
    expect(r90).toEqual({ from: "2025-07-18", to: today });
  });

  it("this_year: from Jan 1 to today", () => {
    expect(presetRange("this_year", today)).toEqual({ from: "2025-01-01", to: today });
  });

  it("this_year on Jan 1 → single-day range", () => {
    expect(presetRange("this_year", "2025-01-01")).toEqual({ from: "2025-01-01", to: "2025-01-01" });
  });

  it("last_month in February of a leap year → Feb 1–29", () => {
    expect(presetRange("last_month", "2024-03-10")).toEqual({ from: "2024-02-01", to: "2024-02-29" });
  });
});

// ---------------------------------------------------------------------------
// previousComparableRange – edge cases
// ---------------------------------------------------------------------------

describe("previousComparableRange – edge cases", () => {
  it("January 1-15 → December 1-15", () => {
    expect(previousComparableRange({ from: "2025-01-01", to: "2025-01-15" })).toEqual({ from: "2024-12-01", to: "2024-12-15" });
  });

  it("March 1-31 → February 1-28 (clamped to end of February)", () => {
    // from Feb-1, length=30 → Mar-3; but from starts on 1st so clamp to end of prev month.
    expect(previousComparableRange({ from: "2025-03-01", to: "2025-03-31" })).toEqual({ from: "2025-02-01", to: "2025-02-28" });
  });

  it("March 1-31 on leap year → February 1-29", () => {
    expect(previousComparableRange({ from: "2024-03-01", to: "2024-03-31" })).toEqual({ from: "2024-02-01", to: "2024-02-29" });
  });

  it("mid-month range preserves length", () => {
    // Oct 1-15: 14 days; Sep 1 + 14 = Sep 15
    expect(previousComparableRange({ from: "2025-10-01", to: "2025-10-15" })).toEqual({ from: "2025-09-01", to: "2025-09-15" });
  });
});
