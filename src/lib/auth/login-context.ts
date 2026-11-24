// Where a sign-in came from, kept in the login audit (auth.login, auth.login_failed) so a strange login can be noticed:
// the kind of device read from the user agent, and the IP cut to its network. The full address and the raw user agent
// are never stored (docs/PRIVACY.md).
import { isIP } from "node:net";
import { clientIp } from "@/lib/rate-limit";

export type LoginContext = { device: string; network: string | null };

/** IPv4 cut to /16 and IPv6 to /48: enough to tell a provider or region apart, not to point at one connection. */
export function truncateIp(raw: string): string | null {
  const ip = raw.trim().replace(/^::ffff:(?=\d+\.\d+\.\d+\.\d+$)/i, "");
  const v = isIP(ip);
  if (v === 4) {
    const [a, b] = ip.split(".");
    return `${a}.${b}.0.0/16`;
  }
  if (v === 6) {
    const [head = "", tail = ""] = ip.split("::");
    const left = head ? head.split(":") : [];
    const right = tail ? tail.split(":") : [];
    const groups = ip.includes("::") ? [...left, ...Array(8 - left.length - right.length).fill("0"), ...right] : left;
    return `${groups.slice(0, 3).map((g) => g.replace(/^0+(?=.)/, "").toLowerCase()).join(":")}::/48`;
  }
  return null;
}

/** "celular · Chrome · Android": kind, browser and system, from a fixed list. Anything unknown reads "outro". */
export function describeDevice(ua: string | null | undefined): string {
  if (!ua) return "desconhecido";
  const kind = /iPad|Tablet/i.test(ua) ? "tablet" : /Mobi|iPhone|Android/i.test(ua) ? "celular" : /Windows NT|Macintosh|X11|Linux x86_64|CrOS/i.test(ua) ? "computador" : "outro";
  const browser = /Edg\//.test(ua) ? "Edge" : /OPR\//.test(ua) ? "Opera" : /SamsungBrowser\//.test(ua) ? "Samsung Internet" : /Firefox\/|FxiOS\//.test(ua) ? "Firefox" : /Chrome\/|CriOS\//.test(ua) ? "Chrome" : /Safari\//.test(ua) && /Version\//.test(ua) ? "Safari" : "outro navegador";
  const system = /iPad/.test(ua) ? "iPadOS" : /iPhone|iPod/.test(ua) ? "iOS" : /Android/.test(ua) ? "Android" : /Windows NT/.test(ua) ? "Windows" : /CrOS/.test(ua) ? "ChromeOS" : /Macintosh|Mac OS X/.test(ua) ? "macOS" : /Linux/.test(ua) ? "Linux" : "outro sistema";
  return `${kind} · ${browser} · ${system}`;
}

export function loginContext(headers: Headers): LoginContext {
  return { device: describeDevice(headers.get("user-agent")), network: truncateIp(clientIp(headers)) };
}
