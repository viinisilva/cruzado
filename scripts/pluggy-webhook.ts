// Registers the production webhook once, with the secret header the route expects. Pluggy only accepts custom
// headers through this API call. Usage: PLUGGY_CLIENT_ID=... PLUGGY_CLIENT_SECRET=... PLUGGY_WEBHOOK_SECRET=... APP_URL=https://... npx tsx scripts/pluggy-webhook.ts
import { pluggyClientFromEnv } from "../src/lib/connectors/pluggy";

const { APP_URL, PLUGGY_WEBHOOK_SECRET } = process.env;
if (!APP_URL?.startsWith("https://") || !PLUGGY_WEBHOOK_SECRET) throw new Error("Defina APP_URL (https) e PLUGGY_WEBHOOK_SECRET.");
await pluggyClientFromEnv().createWebhook(`${APP_URL}/api/webhooks/pluggy`, PLUGGY_WEBHOOK_SECRET);
console.log("Webhook registrado.");
