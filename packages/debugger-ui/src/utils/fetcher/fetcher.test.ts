/**
 * Tests that the shared fetcher session-scopes its requests via apiUrl().
 *
 * Regression: useReusableSteps / useFunctions call fetcher.get('/api/...')
 * with bare absolute paths. In the embedded debugger SPA those resolve to the
 * origin root and miss the /debugger/:id/ proxy, so reusable-steps/functions
 * were silently absent (OmniTerm) or read the wrong project root (CLI). The
 * fix routes every fetcher request through apiUrl().
 */

import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert";
import { fetcher, nullableFetcher } from "./index";

let calls: string[] = [];

function installFakeFetch() {
  calls = [];
  (globalThis as { fetch?: unknown }).fetch = async (url: unknown) => {
    calls.push(String(url));
    return {
      ok: true,
      status: 200,
      statusText: "OK",
      json: async () => ({ ok: true }),
    };
  };
}

function setSession(prefix: string | null) {
  if (prefix === null) {
    delete (globalThis as { window?: unknown }).window;
    delete (globalThis as { document?: unknown }).document;
    return;
  }
  (globalThis as { window?: unknown }).window = {
    location: { pathname: `${prefix}/`, protocol: "http:", host: "localhost:6174" },
  };
  (globalThis as { document?: unknown }).document = {
    baseURI: `http://localhost:6174${prefix}/`,
  };
}

describe("fetcher — session-scoped via apiUrl", () => {
  beforeEach(installFakeFetch);
  afterEach(() => setSession(null));

  it("prefixes GET requests with the session prefix inside the embedded SPA", async () => {
    setSession("/debugger/sess1");
    await fetcher.get("/api/reusable-steps");
    assert.deepStrictEqual(calls, ["/debugger/sess1/api/reusable-steps"]);
  });

  it("prefixes POST/PUT/DELETE requests too", async () => {
    setSession("/debugger/sess1");
    await fetcher.post("/api/reusable-steps", {});
    await fetcher.put("/api/reusable-steps/1/update", {});
    await fetcher.delete("/api/reusable-steps/1/delete");
    assert.deepStrictEqual(calls, [
      "/debugger/sess1/api/reusable-steps",
      "/debugger/sess1/api/reusable-steps/1/update",
      "/debugger/sess1/api/reusable-steps/1/delete",
    ]);
  });

  it("nullableFetcher is session-scoped as well", async () => {
    setSession("/debugger/sess1");
    await nullableFetcher("/api/functions");
    assert.deepStrictEqual(calls, ["/debugger/sess1/api/functions"]);
  });

  it("leaves paths unchanged outside the embedded SPA (Next.js root mode)", async () => {
    setSession(null);
    await fetcher.get("/api/reusable-steps");
    assert.deepStrictEqual(calls, ["/api/reusable-steps"]);
  });
});
