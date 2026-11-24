// What the login audit keeps about where a sign-in came from: the kind of device (from the user agent) and the IP cut
// to its network (/16 for IPv4, /48 for IPv6), so a strange login can be noticed without storing a full address.
import { describe, expect, it } from "vitest";
import { describeDevice, loginContext, truncateIp } from "@/lib/auth/login-context";

describe("truncateIp", () => {
  it("keeps only the network part", () => {
    expect(truncateIp("189.45.201.7")).toBe("189.45.0.0/16");
    expect(truncateIp("2804:14c:5b81:9e00:1d2:3e4f:aa:1")).toBe("2804:14c:5b81::/48");
    expect(truncateIp("2804::1")).toBe("2804:0:0::/48");
    expect(truncateIp("::ffff:10.1.2.3")).toBe("10.1.0.0/16");
  });

  it("anything else is not an address", () => {
    expect(truncateIp("local")).toBeNull();
    expect(truncateIp("")).toBeNull();
    expect(truncateIp("999.1.1.1")).toBeNull();
    expect(truncateIp("<script>")).toBeNull();
  });
});

describe("describeDevice", () => {
  it("reads kind, browser and system, never the raw string", () => {
    expect(describeDevice("Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1")).toBe("celular · Safari · iOS");
    expect(describeDevice("Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36")).toBe("celular · Chrome · Android");
    expect(describeDevice("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36 Edg/131.0.0.0")).toBe("computador · Edge · Windows");
    expect(describeDevice("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7; rv:133.0) Gecko/20100101 Firefox/133.0")).toBe("computador · Firefox · macOS");
    expect(describeDevice("Mozilla/5.0 (iPad; CPU OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1")).toBe("tablet · Safari · iPadOS");
    expect(describeDevice("curl/8.5.0")).toBe("outro · outro navegador · outro sistema");
    expect(describeDevice(null)).toBe("desconhecido");
  });

  it("loginContext takes both from the request headers", () => {
    const h = new Headers({ "x-forwarded-for": "189.45.201.7, 10.0.0.1", "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/131.0.0.0 Safari/537.36" });
    expect(loginContext(h)).toEqual({ device: "computador · Chrome · Windows", network: "189.45.0.0/16" });
    expect(loginContext(new Headers())).toEqual({ device: "desconhecido", network: null });
  });
});
