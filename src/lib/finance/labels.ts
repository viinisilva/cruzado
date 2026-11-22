import type { PaymentMethod } from "@/db/schema";

export const PAYMENT_LABEL: Record<PaymentMethod, string> = {
  pix: "Pix",
  debito: "Débito",
  credito: "Crédito",
  dinheiro: "Dinheiro",
  boleto: "Boleto",
  transferencia: "Transferência",
};

const SOURCE_LABEL: Record<string, string> = {
  demo: "Dados de demonstração",
  csv: "Importação CSV",
  ofx: "Importação OFX",
  manual: "Lançamento manual",
  open_finance: "Open Finance",
};

/** Origin (where the data came from) and channel (how an assistant entry arrived) are different facts. */
export function originLabel(source: string, channel: string | null): string {
  if (source !== "assistant") return SOURCE_LABEL[source] ?? source;
  if (channel === "whatsapp") return "Mensagem no WhatsApp";
  if (channel === "mcp") return "Cliente MCP";
  return "Assistente";
}
