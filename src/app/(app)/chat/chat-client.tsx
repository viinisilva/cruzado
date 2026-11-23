"use client";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { RotateCw, Send } from "lucide-react";
import type { AssistantEvidence } from "@/lib/chat/engine";
import { Button, Notice, cx } from "@/components/ui";
import { SensitiveText } from "@/components/client";

export type Msg = { id: string; role: "user" | "assistant"; content: string; evidence?: AssistantEvidence; pending?: boolean };

const SUGGESTIONS = [
  { group: "Entender meus gastos", items: ["Quanto gastei com mercado neste mês?", "Compare meus gastos com o mês passado"] },
  { group: "Ver saldo e cobranças", items: ["Qual é o meu saldo consolidado?", "Quais são minhas próximas cobranças?", "Tem alguma cobrança duplicada?"] },
  { group: "Criar um aviso", items: ["Me avise quando eu gastar mais de R$ 200 por dia com mercado"] },
];

// How close to the end still counts as "reading the latest message".
const FOLLOW_THRESHOLD_PX = 160;

function Evidence({ ev }: { ev: AssistantEvidence }) {
  if (!ev.items.length && !ev.disclaimer && !ev.draftAgentId) return null;
  return (
    <div className="mt-4 flex flex-col gap-2 border-t border-border pt-3 text-sm">
      {ev.draftAgentId ? (
        <Notice tone="attention" title="Aviso criado como rascunho: ainda não está ligado">
          <Link className="font-medium text-primary underline" href={`/agentes?rascunho=${ev.draftAgentId}`}>
            Revisar e confirmar o agente
          </Link>
        </Notice>
      ) : null}
      {ev.items.map((it, i) => (
        <details key={i} className="rounded-xl border border-border bg-surface-2 px-3.5">
          <summary className="flex min-h-11 cursor-pointer items-center font-semibold text-primary">De onde vêm estes números</summary>
          <dl className="grid gap-1 pb-3 text-meta sm:grid-cols-[auto_1fr] sm:gap-x-4">
            {it.period ? (
              <>
                <dt className="text-muted">Período</dt>
                <dd>
                  {it.period.label}
                  {it.period.defaulted ? " (padrão, nenhum período informado)" : ""}
                </dd>
              </>
            ) : null}
            <dt className="text-muted">Contas</dt>
            <dd>{it.filters.accounts.length ? it.filters.accounts.join(", ") : "todas"}</dd>
            <dt className="text-muted">Categorias</dt>
            <dd>{it.filters.categories.length ? it.filters.categories.join(", ") : "todas"}</dd>
            {it.filters.other?.length ? (
              <>
                <dt className="text-muted">Outros filtros</dt>
                <dd>{it.filters.other.join(", ")}</dd>
              </>
            ) : null}
            <dt className="text-muted">Cálculo</dt>
            <dd className="font-mono">{it.tool}</dd>
          </dl>
          {it.notes?.length ? (
            <ul className="list-disc pb-2 pl-5 text-meta text-muted">
              {it.notes.map((n) => (
                <li key={n}><SensitiveText>{n}</SensitiveText></li>
              ))}
            </ul>
          ) : null}
          {it.sources.length ? (
            <ul className="flex flex-col pb-2">
              {it.sources.map((s) => (
                <li key={s.href + s.label}>
                  <Link href={s.href} className="inline-flex min-h-9 items-center text-meta font-medium text-primary underline underline-offset-2">
                    <SensitiveText>{s.label}</SensitiveText>
                  </Link>
                </li>
              ))}
            </ul>
          ) : null}
        </details>
      ))}
      {ev.disclaimer ? <Notice tone="attention">{ev.disclaimer}</Notice> : null}
    </div>
  );
}

const tempId = () => `tmp-${Date.now()}`;

export function ChatClient({ initial, conversationId: initialId, initialQuestion, external }: { initial: Msg[]; conversationId?: string; initialQuestion?: string; external: boolean }) {
  const [messages, setMessages] = useState<Msg[]>(initial);
  const [conversationId, setConversationId] = useState(initialId);
  // ?q= only fills the field: a link from another site must never ask something on the user's behalf.
  const [text, setText] = useState(initialQuestion ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [failed, setFailed] = useState<string>();
  const endRef = useRef<HTMLDivElement>(null);
  const following = useRef(true);

  useEffect(() => {
    const onScroll = () => {
      following.current = window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - FOLLOW_THRESHOLD_PX;
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  async function send(q: string) {
    const question = q.trim();
    if (!question || busy) return;
    setBusy(true);
    setError(undefined);
    setFailed(undefined);
    setText("");
    following.current = true;
    const tmp = tempId();
    setMessages((m) => [...m, { id: tmp, role: "user", content: question }, { id: `${tmp}-a`, role: "assistant", content: "", pending: true }]);
    try {
      const res = await fetch("/api/chat", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ text: question, conversationId }) });
      const body = await res.json();
      if (!res.ok) throw new Error(body.message ?? body.error ?? "Não consegui responder agora.");
      setConversationId(body.conversationId);
      setMessages((m) => m.map((x) => (x.id === `${tmp}-a` ? { id: body.messageId, role: "assistant", content: body.content, evidence: body.evidence } : x)));
    } catch (e) {
      // Back to how it was before sending, so retrying cannot leave the question on screen twice.
      setMessages((m) => m.filter((x) => x.id !== tmp && x.id !== `${tmp}-a`));
      setText((current) => current || question);
      setFailed(question);
      setError(e instanceof TypeError ? "Sem conexão. Sua pergunta continua no campo abaixo." : (e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    if (following.current) endRef.current?.scrollIntoView({ block: "end" });
  }, [messages]);

  return (
    <div className="flex flex-col gap-4">
      {external ? <p className="text-meta text-muted">Somente os dados mínimos de cada pergunta são enviados ao provedor externo. Valores são calculados aqui, não pelo modelo.</p> : null}
      <ol className="flex min-h-[40dvh] flex-col gap-4" aria-live="polite" aria-label="Mensagens">
        {messages.length === 0 ? (
          <li className="flex flex-col gap-5 rounded-2xl border border-border bg-surface p-5 shadow-card sm:p-6">
            <div>
              <p className="text-lg font-semibold tracking-tight">Por onde começar</p>
              <p className="text-sm text-muted">Toque numa pergunta ou escreva a sua no campo abaixo.</p>
            </div>
            {SUGGESTIONS.map((s) => (
              <div key={s.group}>
                <p className="mb-2 text-sm font-semibold">{s.group}</p>
                <div className="flex flex-wrap gap-2">
                  {s.items.map((item) => (
                    <button key={item} type="button" onClick={() => void send(item)} className="min-h-11 rounded-xl border border-border bg-surface-2 px-3.5 py-2 text-left text-[0.9375rem] transition-colors hover:border-primary hover:bg-primary-soft hover:text-primary">
                      {item}
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </li>
        ) : null}
        {messages.map((m) => (
          <li key={m.id} className={cx("max-w-[92%] rounded-2xl px-4 py-3 text-[0.9375rem] leading-relaxed sm:max-w-[80%] sm:px-5 sm:py-4", m.role === "user" ? "self-end rounded-br-md bg-primary text-primary-fg" : "self-start rounded-bl-md border border-border bg-surface shadow-card")}>
            <span className="sr-only">{m.role === "user" ? "Você:" : "Cruzado:"}</span>
            {m.pending ? (
              <span className="flex flex-col gap-2" role="status" aria-label="Calculando resposta">
                <span className="skeleton h-3 w-48" />
                <span className="skeleton h-3 w-32" />
              </span>
            ) : (
              <p className="whitespace-pre-line break-words"><SensitiveText>{m.content}</SensitiveText></p>
            )}
            {m.evidence ? <Evidence ev={m.evidence} /> : null}
          </li>
        ))}
      </ol>
      <div ref={endRef} />
      {error ? (
        <div role="alert" className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-risk/40 bg-risk-soft p-3 text-sm font-medium text-risk">
          <span>{error}</span>
          {failed ? (
            <Button type="button" variant="secondary" size="sm" disabled={busy} onClick={() => void send(failed)}>
              <RotateCw aria-hidden size={16} /> Tentar novamente
            </Button>
          ) : null}
        </div>
      ) : null}
      <form
        className="sticky bottom-[calc(5.5rem+env(safe-area-inset-bottom))] flex gap-2 rounded-2xl border border-border-strong/60 bg-surface p-2 shadow-pop focus-within:outline-3 focus-within:outline-offset-2 focus-within:outline-[var(--focus)] lg:bottom-5"
        onSubmit={(e) => {
          e.preventDefault();
          void send(text);
        }}
      >
        <label htmlFor="chat-input" className="sr-only">
          Sua pergunta
        </label>
        <input
          id="chat-input"
          value={text}
          onChange={(e) => setText(e.target.value)}
          maxLength={1000}
          placeholder="Pergunte sobre seus gastos, saldos, assinaturas…"
          className="min-h-12 min-w-0 flex-1 rounded-xl bg-transparent px-3 text-base outline-none placeholder:text-muted"
          autoComplete="off"
        />
        <Button type="submit" size="lg" disabled={busy || !text.trim()} aria-label="Enviar pergunta">
          <Send aria-hidden size={18} />
        </Button>
      </form>
    </div>
  );
}
