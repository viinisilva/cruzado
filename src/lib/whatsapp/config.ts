// Official WhatsApp Business Cloud API settings. Server-side only: nothing here may ever be NEXT_PUBLIC_.
import { createHmac } from "node:crypto";

export type WhatsappConfig = {
  appSecret: string;
  verifyToken: string;
  phoneNumberId: string;
  accessToken?: string;
  /** Explicit on purpose: Graph versions expire, so a default would silently age. */
  graphVersion?: string;
  displayNumber?: string;
};

/** Enough to receive events. Replies also need `accessToken` and `graphVersion`. */
export function whatsappConfig(): WhatsappConfig | null {
  const { WHATSAPP_APP_SECRET, WHATSAPP_VERIFY_TOKEN, WHATSAPP_PHONE_NUMBER_ID, WHATSAPP_ACCESS_TOKEN, META_GRAPH_API_VERSION, WHATSAPP_DISPLAY_NUMBER } = process.env;
  if (!WHATSAPP_APP_SECRET || !WHATSAPP_VERIFY_TOKEN || !WHATSAPP_PHONE_NUMBER_ID) return null;
  return {
    appSecret: WHATSAPP_APP_SECRET,
    verifyToken: WHATSAPP_VERIFY_TOKEN,
    phoneNumberId: WHATSAPP_PHONE_NUMBER_ID,
    accessToken: WHATSAPP_ACCESS_TOKEN || undefined,
    graphVersion: META_GRAPH_API_VERSION || undefined,
    displayNumber: WHATSAPP_DISPLAY_NUMBER || undefined,
  };
}

/** Keyed, so a leaked table cannot be reversed by hashing every phone number in Brazil. */
export function senderHash(waId: string): string {
  const key = process.env.APP_ENCRYPTION_KEY;
  if (!key) throw new Error("APP_ENCRYPTION_KEY não configurada.");
  return createHmac("sha256", key).update(`wa|${waId}`).digest("hex");
}

export function maskPhone(waId: string): string {
  return `+${waId.slice(0, 2)} ••••• ${waId.slice(-4)}`;
}
