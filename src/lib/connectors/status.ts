import type { ConnectionStatus } from "@/db/schema";

export const CONNECTION_STATUS: Record<ConnectionStatus, { label: string; tone: "positive" | "attention" | "neutral" | "risk" }> = {
  processing: { label: "Processando", tone: "neutral" },
  active: { label: "Conectada", tone: "positive" },
  reauth_required: { label: "Reautorização necessária", tone: "attention" },
  error: { label: "Erro", tone: "risk" },
  disconnected: { label: "Desconectada", tone: "neutral" },
};

export const formatDateTimeBR = (d: Date) => d.toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo", dateStyle: "short", timeStyle: "short" });
