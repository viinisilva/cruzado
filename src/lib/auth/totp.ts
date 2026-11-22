// RFC 6238 time-based one-time codes (SHA-1, 6 digits, 30 s): the parameters every authenticator app supports.
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
const STEP_MS = 30_000;
const WINDOW = [0, -1, 1]; // one step of clock drift either way

function base32Encode(bytes: Buffer): string {
  let bits = "";
  for (const b of bytes) bits += b.toString(2).padStart(8, "0");
  let out = "";
  for (let i = 0; i < bits.length; i += 5) out += ALPHABET[parseInt(bits.slice(i, i + 5).padEnd(5, "0"), 2)];
  return out;
}

function base32Decode(text: string): Buffer {
  let bits = "";
  for (const c of text) bits += ALPHABET.indexOf(c).toString(2).padStart(5, "0");
  const out: number[] = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) out.push(parseInt(bits.slice(i, i + 8), 2));
  return Buffer.from(out);
}

export function generateTotpSecret(): string {
  return base32Encode(randomBytes(20));
}

export function totpCode(secret: string, step: number): string {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(step));
  const mac = createHmac("sha1", base32Decode(secret)).update(counter).digest();
  const offset = mac[mac.length - 1]! & 0xf;
  return String((mac.readUInt32BE(offset) & 0x7fffffff) % 1_000_000).padStart(6, "0");
}

/** Returns the matched step, to be stored so the same code cannot be used twice, or null. */
export function verifyTotp(secret: string, code: string, now: Date, lastStep: number | null): number | null {
  const given = Buffer.from(code.trim().padEnd(6, " ").slice(0, 7));
  const current = Math.floor(now.getTime() / STEP_MS);
  for (const drift of WINDOW) {
    const step = current + drift;
    if (lastStep !== null && step <= lastStep) continue;
    const expected = Buffer.from(totpCode(secret, step));
    if (given.length === expected.length && timingSafeEqual(given, expected)) return step;
  }
  return null;
}

export function otpauthUrl(secret: string, email: string): string {
  const label = encodeURIComponent(`Cruzado:${email}`);
  return `otpauth://totp/${label}?secret=${secret}&issuer=${encodeURIComponent("Cruzado")}&algorithm=SHA1&digits=6&period=30`;
}
