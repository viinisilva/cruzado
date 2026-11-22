// Money is always an integer number of cents (BRL). Never floats for stored or computed amounts.

const brl = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });

export function formatBRL(cents: number): string {
  // Division happens only at the presentation boundary.
  return brl.format(cents / 100).replace(/ /g, " ");
}

export function assertCents(value: number): number {
  if (!Number.isSafeInteger(value)) throw new Error(`Valor monetário inválido (centavos não inteiros): ${value}`);
  return value;
}

const GROUPED_DOT = /^\d{1,3}(\.\d{3})+$/;
const GROUPED_COMMA = /^\d{1,3}(,\d{3})+$/;

/**
 * Parses a Brazilian or international money string into integer cents without float math.
 * Accepts "1.234,56", "1234,56", "1,234.56", "1234.56", "-R$ 12,30", "(12,30)", "12".
 * Returns null when the text is not a valid amount.
 */
export function parseMoneyToCents(input: string): number | null {
  let s = input.trim();
  if (!s) return null;
  let negative = false;
  if (/^\(.*\)$/.test(s)) {
    negative = true;
    s = s.slice(1, -1);
  }
  s = s.replace(/R\$|BRL|\s/gi, "");
  if (s.startsWith("-")) {
    negative = !negative;
    s = s.slice(1);
  } else if (s.startsWith("+")) {
    s = s.slice(1);
  }
  if (s.endsWith("-")) {
    negative = !negative;
    s = s.slice(0, -1);
  }
  if (!/^[\d.,]+$/.test(s)) return null;

  const lastComma = s.lastIndexOf(",");
  const lastDot = s.lastIndexOf(".");
  let intPart: string;
  let fracPart = "";
  const decimalSep = lastComma > lastDot ? "," : lastDot > lastComma ? "." : null;
  if (decimalSep) {
    const idx = s.lastIndexOf(decimalSep);
    const after = s.slice(idx + 1);
    const otherSep = decimalSep === "," ? "." : ",";
    const sepCount = s.split(decimalSep).length - 1;
    // "1.234" (dot followed by exactly 3 digits, no comma) is a pt-BR thousands separator.
    const looksLikeThousands = after.length === 3 && !s.includes(otherSep) && (decimalSep === "." || sepCount > 1);
    if (looksLikeThousands || sepCount > 1) {
      if (s.includes(otherSep) || !(GROUPED_DOT.test(s) || GROUPED_COMMA.test(s))) return null;
      intPart = s.replace(/[.,]/g, "");
    } else {
      const head = s.slice(0, idx);
      if (head.includes(otherSep) && !(otherSep === "." ? GROUPED_DOT : GROUPED_COMMA).test(head)) return null;
      intPart = head.replace(/[.,]/g, "");
      fracPart = after;
    }
  } else {
    intPart = s;
  }
  if (fracPart.length > 2) return null;
  if (!/^\d*$/.test(intPart) || !/^\d*$/.test(fracPart)) return null;
  if (!intPart && !fracPart) return null;
  const cents = Number(intPart || "0") * 100 + Number((fracPart + "00").slice(0, 2));
  if (!Number.isSafeInteger(cents)) return null;
  return negative ? -cents : cents;
}

/** Hides amounts inside free text (alerts, chat answers) when the user chose to hide values. */
export function maskMoney(text: string): string {
  return text
    .replace(/[-+]?\s?R\$\s?\d[\d.,]*\d|[-+]?\s?R\$\s?\d/g, " R$ ••••")
    .replace(/\b\d[\d.,]*\s*(reais|real)\b/gi, "•••• reais")
    .replace(/\bBRL\s?\d[\d.,]*/g, "BRL ••••")
    // A change like "-21,2%" tells how one amount compares to another; the summary already hides it, free text must too.
    .replace(/[-+]?\d[\d.,]*\s?%/g, "••%")
    .replace(/^ /, "");
}

export function sumCents(values: number[]): number {
  let total = 0;
  for (const v of values) total += v;
  return assertCents(total);
}

/** Percentage change in basis points (1% = 100) to stay integer; null when the base is zero. */
export function changeBasisPoints(previous: number, current: number): number | null {
  if (previous === 0) return null;
  return Math.round(((current - previous) * 10000) / Math.abs(previous));
}

export function formatBasisPoints(bp: number | null): string {
  if (bp === null) return "sem base de comparação";
  const sign = bp > 0 ? "+" : "";
  return `${sign}${(bp / 100).toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%`;
}
