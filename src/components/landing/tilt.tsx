"use client";
// Tilts the phone a little toward the pointer, on computers only. Springs from Motion drive the angle; the island writes
// the transform itself instead of rendering a motion component, which keeps it to a few kilobytes. No effect on touch
// screens or with reduced motion, where the phone just stands still.
import { useEffect, useRef } from "react";
import { useReducedMotion, useSpring } from "motion/react";

const SPRING = { stiffness: 140, damping: 18, mass: 0.6 };

export function Tilt({ children }: { children: React.ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const reduce = useReducedMotion();
  const rotateX = useSpring(0, SPRING);
  const rotateY = useSpring(0, SPRING);

  useEffect(() => {
    const el = ref.current;
    const area = el?.closest<HTMLElement>("[data-tilt-area]");
    if (reduce || !el || !area || !window.matchMedia("(hover: hover) and (pointer: fine)").matches) return;
    const paint = () => (el.style.transform = `rotateX(${rotateX.get().toFixed(2)}deg) rotateY(${rotateY.get().toFixed(2)}deg)`);
    const offX = rotateX.on("change", paint);
    const offY = rotateY.on("change", paint);
    let rect = area.getBoundingClientRect();
    const enter = () => (rect = area.getBoundingClientRect());
    const move = (e: PointerEvent) => {
      rotateY.set(((e.clientX - rect.left) / rect.width - 0.5) * 22);
      rotateX.set(((e.clientY - rect.top) / rect.height - 0.5) * -16);
    };
    const leave = () => {
      rotateX.set(0);
      rotateY.set(0);
    };
    area.addEventListener("pointerenter", enter);
    area.addEventListener("pointermove", move, { passive: true });
    area.addEventListener("pointerleave", leave);
    return () => {
      offX();
      offY();
      area.removeEventListener("pointerenter", enter);
      area.removeEventListener("pointermove", move);
      area.removeEventListener("pointerleave", leave);
      el.style.transform = "";
    };
  }, [reduce, rotateX, rotateY]);

  return (
    <div ref={ref} style={{ willChange: "transform" }}>
      {children}
    </div>
  );
}
