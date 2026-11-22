// Writes public/landing/guilloche.svg: the fine interlaced line work engraved on banknotes (the Cruzado was the currency
// of 1986). Rosettes from hypotrochoid curves, computed once and committed, so the landing page only shows and rotates
// an image.
//
//   npx tsx scripts/guilloche.ts
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

/**
 * A closed rosette: a circle of radius `base` whose radius swings by `swing` with `lobes` waves, traced `laps` times with
 * the waves a fraction of a lobe further on each lap, so they interlace like banknote engraving and close smoothly.
 */
export function rosette(base: number, swing: number, lobes: number, laps: number, perLobe = 12): string {
  const steps = lobes * perLobe * laps;
  const parts: string[] = [];
  for (let i = 0; i < steps; i++) {
    const t = (i / steps) * laps * 2 * Math.PI;
    const q = lobes + 1 / laps; // after `laps` laps the wave has advanced a whole number of lobes
    const r = base + swing * Math.sin(q * t);
    parts.push(`${Math.round(r * Math.cos(t))} ${Math.round(r * Math.sin(t))}`);
  }
  return `M${parts.join("L")}Z`;
}

const RINGS = [
  { d: rosette(400, 34, 48, 3), stroke: "#c6f36a", opacity: 0.3 },
  { d: rosette(330, 46, 36, 3), stroke: "#7fe0b0", opacity: 0.24 },
  { d: rosette(250, 30, 30, 3), stroke: "#c6f36a", opacity: 0.22 },
  { d: rosette(170, 26, 22, 2), stroke: "#7fe0b0", opacity: 0.2 },
];

const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="-460 -460 920 920" width="920" height="920"><g fill="none" stroke-width="0.9">${RINGS.map((r) => `<path d="${r.d}" stroke="${r.stroke}" stroke-opacity="${r.opacity}"/>`).join("")}</g></svg>\n`;

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(import.meta.filename)) {
  const out = path.resolve(import.meta.dirname, "../public/landing/guilloche.svg");
  mkdirSync(path.dirname(out), { recursive: true });
  writeFileSync(out, svg);
  console.log(`${path.relative(process.cwd(), out)}: ${(svg.length / 1024).toFixed(1)} KB`);
}
