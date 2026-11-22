// The public demonstration must answer before its in-memory database is ready (docs/DEPLOY_DEMO.md): the page frame
// needs the visitor, and a refused change needs nothing at all. Here the database is unreachable, so any wait on it fails.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/db/client", () => ({
  getDb: async () => {
    throw new Error("o banco não deveria ser usado aqui");
  },
}));
vi.mock("next/headers", () => ({
  headers: async () => new Headers({ host: "cruzado-demo.test" }),
  cookies: async () => ({ get: () => undefined }),
}));

const { currentUser, demoUser } = await import("@/lib/auth/session");
const { guard } = await import("@/lib/api");
const { DEMO_USER_ID } = await import("@/lib/demo/instance-env");

describe("public demonstration without waiting for the database", () => {
  beforeEach(() => vi.stubEnv("DEMO_INSTANCE", "1"));
  afterEach(() => vi.unstubAllEnvs());

  it("knows the visitor without the database", async () => {
    expect(await currentUser()).toEqual(demoUser());
    expect(demoUser()).toMatchObject({ id: DEMO_USER_ID, isDemo: true, totpEnabledAt: null });
  });

  it("refuses a change with 403 before touching the database", async () => {
    const req = new Request("https://cruzado-demo.test/api/import/preview", { method: "POST", headers: { origin: "https://cruzado-demo.test" } });
    const g = await guard(req, "import");
    expect("response" in g && g.response?.status).toBe(403);
  });

  it("still refuses another origin first", async () => {
    const req = new Request("https://cruzado-demo.test/api/import/preview", { method: "POST", headers: { origin: "https://outro.test" } });
    const g = await guard(req, "import");
    expect("response" in g && g.response?.status).toBe(403);
    expect("response" in g && (await g.response!.json()).error).toMatch(/Origem/);
  });
});
