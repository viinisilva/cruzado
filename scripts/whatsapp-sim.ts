// Local simulator: signs a Meta-shaped event and posts it to your own dev server. It uses the normal signature check;
// there is no bypass anywhere in the app. Usage: npx tsx scripts/whatsapp-sim.ts "gastei 60 no pix no mercado" [waId]
import { createHmac, randomUUID } from "node:crypto";

const [text = "gastei 60 no pix no restaurante", waId = "5511999990000"] = process.argv.slice(2);
const base = process.env.SIM_URL ?? "http://localhost:3000";
const { hostname } = new URL(base);
if (hostname !== "localhost" && hostname !== "127.0.0.1") throw new Error("O simulador só fala com localhost.");
const secret = process.env.WHATSAPP_APP_SECRET;
const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID;
if (!secret || !phoneNumberId) throw new Error("Defina WHATSAPP_APP_SECRET e WHATSAPP_PHONE_NUMBER_ID, os mesmos do servidor local.");

const body = JSON.stringify({
  object: "whatsapp_business_account",
  entry: [{ changes: [{ value: { metadata: { phone_number_id: phoneNumberId }, messages: [{ id: `wamid.sim-${randomUUID()}`, from: waId, timestamp: String(Math.floor(Date.now() / 1000)), type: "text", text: { body: text } }] } }] }],
});
const res = await fetch(`${base}/api/whatsapp/webhook`, {
  method: "POST",
  headers: { "content-type": "application/json", "x-hub-signature-256": `sha256=${createHmac("sha256", secret).update(body).digest("hex")}` },
  body,
});
console.log(res.status, await res.text());
