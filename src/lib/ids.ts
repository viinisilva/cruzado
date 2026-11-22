import { AsyncLocalStorage } from "node:async_hooks";
import { createHash, randomUUID } from "node:crypto";

type Sequence = { seed: string; next: number };
const sequence = new AsyncLocalStorage<Sequence>();

/** A UUID v4 in shape, derived from the seed and a counter: the same calls in the same order give the same ids. */
function seededUuid(seed: string, n: number): string {
  const h = createHash("sha256").update(`${seed}:${n}`).digest();
  h[6] = (h[6]! & 0x0f) | 0x40; // version 4
  h[8] = (h[8]! & 0x3f) | 0x80; // RFC 4122 variant
  const x = h.subarray(0, 16).toString("hex");
  return `${x.slice(0, 8)}-${x.slice(8, 12)}-${x.slice(12, 16)}-${x.slice(16, 20)}-${x.slice(20, 32)}`;
}

/** A new random id, or the next id of the sequence when running inside withSeededIds. */
export const newId = (): string => {
  const s = sequence.getStore();
  return s ? seededUuid(s.seed, s.next++) : randomUUID();
};

/**
 * Runs `fn` with predictable ids. Only for invented data that every copy must share: each instance of the public
 * demonstration builds its own database, and a link made by one instance (a card, an entry) has to open on the others.
 * Never use it for real users' data.
 */
export function withSeededIds<T>(seed: string, fn: () => Promise<T>): Promise<T> {
  return sequence.run({ seed, next: 0 }, fn);
}
