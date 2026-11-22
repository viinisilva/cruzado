"use client";
// Pauses the decorative loops of the landing page (guilloché, drifting light, floating phone, pulses), which keep moving
// for more than five seconds (WCAG 2.2.2). Scroll-driven effects follow the visitor's own scrolling and stay as they are.
import { useState } from "react";
import { Pause, Play } from "lucide-react";

export function MotionToggle() {
  const [paused, setPaused] = useState(false);
  const toggle = () => {
    const next = !paused;
    setPaused(next);
    document.querySelector<HTMLElement>(".lp")?.setAttribute("data-motion", next ? "paused" : "on");
  };
  return (
    <button type="button" className="lp-motion-toggle" onClick={toggle}>
      {paused ? <Play size={14} aria-hidden /> : <Pause size={14} aria-hidden />}
      {paused ? "Retomar animações" : "Pausar animações"}
    </button>
  );
}
