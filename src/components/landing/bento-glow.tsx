"use client";
// A soft light under the pointer on the feature tiles, on computers only. It sets two CSS variables on the tile being
// hovered; landing.css moves the light with transform.
import { useRef } from "react";

export function BentoGlow({ children, className }: { children: React.ReactNode; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const onPointerMove = (e: React.PointerEvent) => {
    if (e.pointerType !== "mouse") return;
    const tile = (e.target as HTMLElement).closest<HTMLElement>(".lp-tile");
    if (!tile || !ref.current?.contains(tile)) return;
    const r = tile.getBoundingClientRect();
    tile.style.setProperty("--gx", `${Math.round(e.clientX - r.left)}px`);
    tile.style.setProperty("--gy", `${Math.round(e.clientY - r.top)}px`);
  };
  return (
    <div ref={ref} className={className} onPointerMove={onPointerMove}>
      {children}
    </div>
  );
}
