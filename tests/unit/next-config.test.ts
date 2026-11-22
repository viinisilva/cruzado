// "/" is the landing page in the app, and the demonstration's front door in its own deployment. The switch is the build's
// DEMO_INSTANCE (next.config.ts), so it is checked here: the local e2e servers share one build and cannot see it.
import { afterEach, describe, expect, it } from "vitest";
import config from "../../next.config";

const original = process.env.DEMO_INSTANCE;
afterEach(() => {
  if (original === undefined) delete process.env.DEMO_INSTANCE;
  else process.env.DEMO_INSTANCE = original;
});

describe("next.config redirects", () => {
  it("in the public demonstration, '/' goes to its static opening page", async () => {
    process.env.DEMO_INSTANCE = "1";
    expect(await config.redirects!()).toEqual([{ source: "/", destination: "/abrindo.html", permanent: false }]);
  });

  it("in the app, '/' stays the landing page", async () => {
    delete process.env.DEMO_INSTANCE;
    expect(await config.redirects!()).toEqual([]);
  });
});
