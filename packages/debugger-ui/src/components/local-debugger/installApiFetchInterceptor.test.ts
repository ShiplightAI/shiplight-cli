/**
 * Tests for the global fetch interceptor installed at the embedded SPA entry.
 *
 * This is the structural guarantee: every network call — fetcher, raw fetch,
 * SWR, third-party libs — passes through window.fetch, so rewriting it once
 * makes it impossible to bypass the session proxy from inside the iframe with
 * a bare /api/ path. It complements (does not replace) the explicit apiUrl()
 * in the fetcher, and must compose with it without double-prefixing.
 */

import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert";
import { installApiFetchInterceptor } from "./installApiFetchInterceptor";

let calls: string[] = [];

function setSession(prefix: string | null) {
  if (prefix === null) {
    delete (globalThis as { window?: unknown }).window;
    delete (globalThis as { document?: unknown }).document;
    return;
  }
  const w: { location: object; fetch?: unknown } = {
    location: {
      pathname: `${prefix}/`,
      protocol: "http:",
      host: "localhost:6174",
      origin: "http://localhost:6174",
    },
  };
  (globalThis as { window?: unknown }).window = w;
  (globalThis as { document?: unknown }).document = {
    baseURI: `http://localhost:6174${prefix}/`,
  };
}

function installFakeFetchOnWindow() {
  calls = [];
  const w = (globalThis as { window: { fetch: unknown } }).window;
  w.fetch = async (url: unknown) => {
    calls.push(String(url));
    return { ok: true, status: 200, json: async () => ({}) };
  };
}

describe("installApiFetchInterceptor", () => {
  afterEach(() => setSession(null));

  beforeEach(() => {
    setSession("/debugger/xyz");
    installFakeFetchOnWindow();
    installApiFetchInterceptor();
  });

  it("rewrites a bare /api string path to the session prefix", async () => {
    await (globalThis as { window: { fetch: typeof fetch } }).window.fetch("/api/functions/create");
    assert.deepStrictEqual(calls, ["/debugger/xyz/api/functions/create"]);
  });

  it("does NOT double-prefix an already-scoped path (composes with fetcher)", async () => {
    await (globalThis as { window: { fetch: typeof fetch } }).window.fetch(
      "/debugger/xyz/api/reusable-steps",
    );
    assert.deepStrictEqual(calls, ["/debugger/xyz/api/reusable-steps"]);
  });

  it("leaves non-/api absolute paths untouched (assets, etc.)", async () => {
    await (globalThis as { window: { fetch: typeof fetch } }).window.fetch("/static/app.js");
    assert.deepStrictEqual(calls, ["/static/app.js"]);
  });

  it("leaves fully-qualified URLs untouched", async () => {
    await (globalThis as { window: { fetch: typeof fetch } }).window.fetch("https://x.com/api/y");
    assert.deepStrictEqual(calls, ["https://x.com/api/y"]);
  });

  it("rewrites URL objects with a same-origin /api path", async () => {
    await (globalThis as { window: { fetch: typeof fetch } }).window.fetch(
      new URL("http://localhost:6174/api/functions"),
    );
    // URL is normalised back to a string for the underlying call.
    assert.deepStrictEqual(calls, ["http://localhost:6174/debugger/xyz/api/functions"]);
  });

  it("does NOT rewrite a cross-origin URL whose path starts with /api/", async () => {
    await (globalThis as { window: { fetch: typeof fetch } }).window.fetch(
      new URL("https://third-party.com/api/data"),
    );
    assert.deepStrictEqual(calls, ["https://third-party.com/api/data"]);
  });

  it("is idempotent — installing twice does not wrap twice", async () => {
    installApiFetchInterceptor();
    await (globalThis as { window: { fetch: typeof fetch } }).window.fetch("/api/x");
    assert.deepStrictEqual(calls, ["/debugger/xyz/api/x"]);
  });
});
