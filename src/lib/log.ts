// What may leave the process about an error. Runtime logs live with a third party, and database errors carry their
// query parameters from the second line on, which here means financial data.
const REDACTIONS: [RegExp, string][] = [
  [/postgres(ql)?:\/\/\S+/gi, "[url]"],
  [/Bearer\s+\S+/gi, "Bearer [oculto]"],
  [/\b(tst_mcp_|sk-ant-)\S+/g, "[token]"],
  [/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, "[id]"],
  [/[\w.+-]+@[\w-]+\.[\w.-]+/g, "[email]"],
  [/\b[A-Za-z0-9_-]{32,}\b/g, "[oculto]"],
  [/\d{6,}/g, "[n]"],
];

/** One short line, safe for logs and for `last_error` columns. Non-errors say nothing: they can be anything. */
export function errorSummary(e: unknown): string {
  if (!(e instanceof Error)) return "erro";
  let line = e.message.split("\n")[0] ?? "";
  for (const [pattern, mask] of REDACTIONS) line = line.replace(pattern, mask);
  return line.slice(0, 200) || "erro";
}

/**
 * User-facing message for a caught error. Only a plain Error thrown by our own code is meant for the user: driver and
 * system errors are subclasses or carry a `code`, and can name hosts, roles or SQL.
 */
export function publicError(e: unknown, fallback: string): string {
  const own = e instanceof Error && Object.getPrototypeOf(e) === Error.prototype && !("code" in e) && !e.message.startsWith("Failed query");
  if (own) return e.message;
  console.error("[api]", errorSummary(e));
  return fallback;
}
