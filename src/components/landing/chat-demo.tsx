"use client";
// A question being typed, the answer, then the evidence chips in a cascade. Plays once, when the chat scrolls into view.
// The server renders the finished conversation; screen readers get it whole, and reduced motion shows it as is.
// The fades are CSS transitions on data-phase (landing.css), so this island stays small.
import { useEffect, useRef, useState } from "react";
import { CalendarDays, ListChecks, Tags, Wallet } from "lucide-react";

const QUESTION = "Quanto gastei com mercado este mês?";
const ANSWER =
  "Você gastou R$ 1.172,35 com Mercado de 1 a 22 de novembro, em 14 compras. A maior parte foi no Supermercado Bom Preço: R$ 846,10.";
const CHIPS = [
  { icon: CalendarDays, text: "Período: 1 a 22 de novembro" },
  { icon: Tags, text: "Categoria: Mercado" },
  { icon: Wallet, text: "Contas: todas" },
  { icon: ListChecks, text: "14 transações" },
];

type Phase = "idle" | "typing" | "thinking" | "done";

export function ChatDemo() {
  const ref = useRef<HTMLDivElement>(null);
  const [phase, setPhase] = useState<Phase>("done");
  const [typed, setTyped] = useState(QUESTION.length);

  useEffect(() => {
    const el = ref.current;
    if (!el || !window.matchMedia("(prefers-reduced-motion: no-preference)").matches) return;
    // Only when it starts below the fold: a visitor who reloads in the middle of the page sees it finished.
    if (el.getBoundingClientRect().top <= window.innerHeight) return;
    const timers: number[] = [];
    const at = (ms: number, fn: () => void) => timers.push(window.setTimeout(fn, ms));
    const play = () => {
      setPhase("typing");
      for (let i = 1; i <= QUESTION.length; i++) at(250 + i * 38, () => setTyped(i));
      const typedAt = 250 + QUESTION.length * 38;
      at(typedAt + 250, () => setPhase("thinking"));
      at(typedAt + 1150, () => setPhase("done"));
    };
    const io = new IntersectionObserver(
      ([entry]) => {
        if (!entry?.isIntersecting) return;
        io.disconnect();
        play();
      },
      { threshold: 0.5 },
    );
    setPhase("idle");
    setTyped(0);
    io.observe(el);
    return () => {
      io.disconnect();
      timers.forEach(clearTimeout);
    };
  }, []);

  return (
    <div ref={ref} className="lp-chat" data-phase={phase} aria-label="Exemplo de conversa com dados fictícios" role="group">
      <p className="lp-bubble-q">
        <span className="sr-only">{QUESTION}</span>
        {/* The untyped rest is there but invisible, so the bubble keeps its final size while the text appears. */}
        <span aria-hidden>
          {QUESTION.slice(0, typed)}
          {phase === "typing" ? <span className="lp-caret" /> : null}
          <span style={{ opacity: 0 }}>{QUESTION.slice(typed)}</span>
        </span>
      </p>

      {/* The dots and the answer share one cell, so the dots never push anything down. */}
      <div className="lp-stack">
        <p className="lp-bubble-a lp-chat-answer">{ANSWER}</p>
        <div className="lp-thinking" aria-hidden>
          <span />
          <span />
          <span />
        </div>
      </div>

      <div>
        <p className="lp-evidence-title">De onde vêm estes números</p>
        <ul className="lp-chips" style={{ marginTop: "0.6rem" }}>
          {CHIPS.map(({ icon: Icon, text }, i) => (
            <li key={text} className="lp-chip" style={{ "--i": i } as React.CSSProperties}>
              <Icon size={15} aria-hidden />
              {text}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
