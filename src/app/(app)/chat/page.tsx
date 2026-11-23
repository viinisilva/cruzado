import type { Metadata } from "next";
import { getDb } from "@/db/client";
import { requireUser } from "@/lib/auth/session";
import { latestConversationId, loadConversation, type AssistantEvidence } from "@/lib/chat/engine";
import { configuredProviderName, providerIsExternal } from "@/lib/ai/provider";
import { consentMissing } from "@/lib/chat/provider-for-user";
import { ShieldCheck } from "lucide-react";
import { ButtonLink, Notice, PageHeader } from "@/components/ui";
import { ChatClient, type Msg } from "./chat-client";

export const metadata: Metadata = { title: "Chat" };

const PROVIDER_LABEL = { mock: "modo demonstração (respostas determinísticas, sem IA externa)", anthropic: "Claude (Anthropic, externo)", ollama: "Ollama (modelo local)" } as const;

export default async function ChatPage({ searchParams }: { searchParams: Promise<{ q?: string; nova?: string }> }) {
  const user = await requireUser();
  const sp = await searchParams;
  const db = await getDb();
  const conversationId = sp.nova ? null : await latestConversationId(db, user.id);
  const rows = conversationId ? await loadConversation(db, user.id, conversationId) : [];
  const initial: Msg[] = rows.map((m) => ({ id: m.id, role: m.role, content: m.content, evidence: (m.evidence as AssistantEvidence | null) ?? undefined }));
  const provider = configuredProviderName();
  const blocked = await consentMissing(db, user.id);

  return (
    <>
      <PageHeader
        title="Assistente"
        description="Pergunte do seu jeito. Os números vêm dos seus dados e você pode conferir a origem de cada um."
        action={
          <ButtonLink href="/chat?nova=1" variant="secondary">
            Nova conversa
          </ButtonLink>
        }
      />
      <div className="grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="min-w-0 max-w-4xl">
          {blocked ? (
            <Notice tone="attention" title="Autorização necessária">
              Este servidor está configurado para usar {PROVIDER_LABEL[provider]}. Para conversar, autorize o envio dos dados mínimos necessários em{" "}
              <a className="font-medium text-primary underline" href="/configuracoes?aba=preferencias">
                Configurações › Inteligência artificial
              </a>
              .
            </Notice>
          ) : (
            <ChatClient initial={initial} conversationId={conversationId ?? undefined} initialQuestion={sp.q?.slice(0, 1000)} external={providerIsExternal()} />
          )}
        </div>
        <aside aria-label="Sobre o assistente" className="order-first flex flex-col gap-3 xl:order-none xl:sticky xl:top-20 xl:self-start">
          <section className="hidden rounded-2xl border border-border bg-surface p-5 shadow-card xl:block">
            <h2 className="flex items-center gap-2 text-base font-semibold"><ShieldCheck aria-hidden size={18} className="text-primary" /> Como as respostas são feitas</h2>
            <ul className="mt-3 flex flex-col gap-2.5 text-sm text-muted">
              <li>Os valores são calculados pelo Cruzado com os seus dados, não inventados pelo modelo.</li>
              <li>Abaixo de cada resposta, “De onde vêm estes números” mostra período, contas, categorias e as transações usadas.</li>
              <li>Pedidos de aviso viram um rascunho em Meus avisos: nada começa sem a sua confirmação.</li>
            </ul>
          </section>
          <details className="rounded-2xl border border-border bg-surface px-4 text-sm text-muted shadow-card xl:px-5">
            <summary className="flex min-h-11 cursor-pointer items-center font-medium text-text">{provider === "mock" ? "Modo demonstração: entende perguntas comuns" : "Sobre este assistente"}</summary>
            <p className="pb-3">Provedor: {PROVIDER_LABEL[provider]}.</p>
          </details>
        </aside>
      </div>
    </>
  );
}
