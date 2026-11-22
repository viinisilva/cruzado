import { headers } from "next/headers";
import { z } from "zod";
import { getDb } from "@/db/client";
import { guard, json, publicError } from "@/lib/api";
import { answer } from "@/lib/chat/engine";
import { consentMissing, createChatProvider } from "@/lib/chat/provider-for-user";
import { isDemoInstance } from "@/lib/demo/instance-env";
import { clientIp, rateLimitShared, tooMany } from "@/lib/rate-limit";
import { loadCategories } from "@/lib/data/repo";
import { MockProvider } from "@/lib/ai/mock";
import { todayInSaoPaulo } from "@/lib/dates";

const Body = z.object({ text: z.string().trim().min(1).max(1000), conversationId: z.string().max(64).optional() });

export async function POST(req: Request) {
  const g = await guard(req, "chat");
  if (g.response) return g.response;
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return json({ error: "Escreva uma pergunta de até 1000 caracteres." }, 400);
  const db = await getDb();
  if (isDemoInstance()) {
    // Every visitor shares the demo account, so the ceiling is per address. Answers come from the built-in rules
    // (no AI service, no cost) and nothing is stored.
    const rl = await rateLimitShared(db, "demoChat", clientIp(await headers()));
    if (!rl.ok) return tooMany(rl.retryAfterSec);
    const { answerReadOnly } = await import("@/lib/demo/instance");
    const categories = await loadCategories(db, g.user.id);
    const provider = new MockProvider(() => ({ today: todayInSaoPaulo(), categories }));
    try {
      return json(await answerReadOnly(db, provider, parsed.data.text));
    } catch (e) {
      return json({ error: publicError(e, "Falha no chat.") }, 500);
    }
  }
  if (await consentMissing(db, g.user.id)) {
    return json({ error: "consent_required", message: "Este servidor usa um provedor de IA externo. Autorize o envio de dados em Configurações para usar o chat." }, 403);
  }
  try {
    const provider = await createChatProvider(db, g.user.id);
    return json(await answer(db, provider, g.user.id, parsed.data.text, { conversationId: parsed.data.conversationId }));
  } catch (e) {
    return json({ error: publicError(e, "Falha no chat.") }, 500);
  }
}
