"use client";
// "A fatura que bate com o banco": while the visitor scrolls, invented entries enter the Cartão Ipê bill one by one, a
// refund undoes a purchase, a pending entry the bank never charged leaves the sum, and the bank's total appears.
//
// The server renders the finished bill, so without scripts, with reduced motion, or for a screen reader everything is
// already there. Rows never leave the layout: they only fade and move (opacity, transform), so nothing shifts.
import { useEffect, useRef, useState } from "react";
import { useMotionValueEvent, useReducedMotion, useScroll } from "motion/react";
import { BANK_TOTAL_CENTS, BILL, PHASES, STEP_CLOSED, STEP_MATCHED, billSum, brl } from "./content";

/** Which step of the story a scroll progress (0 to 1) shows. The last steps get a little more room. */
const stepAt = (p: number) => Math.max(0, Math.min(STEP_MATCHED, Math.floor(p * (STEP_MATCHED + 1.4))));

export function BillStory() {
  const track = useRef<HTMLDivElement>(null);
  const totalRef = useRef<HTMLSpanElement>(null);
  const reduce = useReducedMotion();
  const [step, setStep] = useState(STEP_MATCHED);
  const [scrolly, setScrolly] = useState(false);
  const { scrollYProgress } = useScroll({ target: track, offset: ["start 0.15", "end end"] });

  useEffect(() => {
    if (reduce || !window.matchMedia("(prefers-reduced-motion: no-preference) and (scripting: enabled)").matches) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- the server renders the finished bill; the scroll story starts after hydration
    setScrolly(true);
    setStep(stepAt(scrollYProgress.get()));
  }, [reduce, scrollYProgress]);

  useMotionValueEvent(scrollYProgress, "change", (p) => {
    if (scrolly) setStep(stepAt(p));
  });

  // The running total counts to its new value instead of jumping.
  const sum = billSum(step);
  const shown = useRef(sum);
  useEffect(() => {
    const el = totalRef.current;
    if (!el) return;
    if (!scrolly) {
      el.textContent = brl(sum);
      shown.current = sum;
      return;
    }
    // A short ease-out count from the shown value to the new sum.
    const from = shown.current;
    const start = performance.now();
    let frame = 0;
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / 450);
      const v = from + (sum - from) * (1 - (1 - t) ** 3);
      shown.current = v;
      el.textContent = brl(Math.round(v));
      if (t < 1) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [sum, scrolly]);

  const closed = step >= STEP_CLOSED;
  const matched = step >= STEP_MATCHED;
  const phase = [...PHASES].reverse().find((p) => step >= p.from) ?? PHASES[0];

  return (
    <div ref={track} className="lp-story-track" data-scrolly={scrolly}>
      <div className="lp-story-sticky lp-story-grid">
        <ol className="lp-phases" aria-label="O que acontece com a fatura">
          {PHASES.map((p) => (
            <li key={p.title} className="lp-phase" data-active={scrolly ? p === phase : true}>
              <h3 className="lp-phase-title">{p.title}</h3>
              <p>{p.text}</p>
            </li>
          ))}
        </ol>

        <figure className="lp-bill" aria-label="Exemplo de fatura conferida, com dados fictícios">
          <div className="lp-bill-head">
            <div>
              <p style={{ fontWeight: 600, fontSize: "1.0625rem" }}>Fatura de outubro</p>
              <p className="lp-row-meta">Cartão Ipê, Ipê Cartões (fictício)</p>
            </div>
            <span className={`lp-badge ${closed ? "lp-badge-closed" : "lp-badge-open"}`}>{closed ? "Fechada" : "Aberta"}</span>
          </div>

          <ul className="lp-rows">
            {BILL.map((row, i) => {
              const entered = step >= i + 1;
              const left = row.kind === "phantom" && closed;
              const undone = BILL.some((r) => r.undoes === row.id && step >= BILL.indexOf(r) + 1);
              const tag = row.kind === "phantom" ? (closed ? "Não cobrado pelo banco: fora da soma" : row.note) : row.note;
              return (
                <li key={row.id} className="lp-row" data-state={!entered ? "hidden" : left ? "left" : "in"} data-kind={row.kind} data-undone={undone}>
                  <span className="lp-row-meta">{row.date}</span>
                  <span className="lp-row-name">{row.merchant}</span>
                  <span className="lp-row-value">{row.cents < 0 ? `− ${brl(-row.cents)}` : brl(row.cents)}</span>
                  {tag ? <span className="lp-row-tag">{tag}</span> : null}
                </li>
              );
            })}
          </ul>

          <div className="lp-bill-foot">
            <p className="lp-bill-line lp-bill-total">
              <span>Soma dos lançamentos</span>
              <span ref={totalRef} aria-hidden>
                {brl(sum)}
              </span>
              <span className="sr-only">{brl(BANK_TOTAL_CENTS)}</span>
            </p>
            <p className="lp-bill-line lp-bank-line lp-row-meta" data-shown={matched}>
              <span>Total informado pelo banco</span>
              <span>{brl(BANK_TOTAL_CENTS)}</span>
            </p>
            <p className="lp-match" data-shown={matched}>
              <svg className="lp-check" viewBox="0 0 24 24" aria-hidden focusable="false">
                <circle cx="12" cy="12" r="11" fill="currentColor" />
                <path d="M7 12.5l3.2 3.2L17 9" fill="none" stroke="var(--surface)" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
              Bate com o banco
            </p>
          </div>
        </figure>
      </div>
    </div>
  );
}
