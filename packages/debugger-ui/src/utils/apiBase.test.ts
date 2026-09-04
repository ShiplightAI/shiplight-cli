/**
 * Tests for the session-prefix URL helper used by the debugger SPA.
 *
 * The embedded debugger SPA is hosted under /debugger/:sessionId/. Absolute
 * fetches like fetch("/api/reusable-steps") resolve against the ORIGIN, not
 * the document's path, so without rewriting they bypass the session-scoped
 * proxy and either return HTML (OmniTerm plugin) or hit the wrong project
 * root (CLI outer server). apiUrl() prepends the detected session prefix.
 *
 * Two properties are load-bearing and tested here:
 *   1. apiUrl() is computed LAZILY (reads window each call) so it works no
 *      matter the module-load order — and so it's testable.
 *   2. apiUrl() is IDEMPOTENT. Both the global fetch interceptor and the
 *      fetcher wrapper call apiUrl(); an already-prefixed path must not be
 *      prefixed twice (e.g. /debugger/x/api/y must stay as-is).
 */

import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert";
import { apiUrl } from "./apiBase";

function setSession(prefix: string) {
  (globalThis as { window?: unknown }).window = {
    location: { pathname: `${prefix}/`, protocol: "http:", host: "localhost:6174" },
  };
  (globalThis as { document?: unknown }).document = {
    baseURI: `http://localhost:6174${prefix}/`,
  };
}

function clearSession() {
  delete (globalThis as { window?: unknown }).window;
  delete (globalThis as { document?: unknown }).document;
}

describe("apiUrl — session-prefix routing", () => {
  afterEach(clearSession);

  describe("no session prefix (Next.js / SSR / root mode)", () => {
    beforeEach(clearSession);

    it("passes absolute /api paths through unchanged", () => {
      assert.strictEqual(apiUrl("/api/reusable-steps"), "/api/reusable-steps");
    });
  });

  describe("inside /debugger/:id/ (embedded SPA)", () => {
    beforeEach(() => setSession("/debugger/abc123"));

    it("prefixes an absolute /api path with the session prefix", () => {
      assert.strictEqual(
        apiUrl("/api/reusable-steps"),
        "/debugger/abc123/api/reusable-steps",
      );
    });

    it("is IDEMPOTENT — an already-prefixed path is returned unchanged", () => {
      // This guards the interceptor+fetcher composition: fetcher prefixes the
      // path, then the global window.fetch interceptor sees the prefixed path
      // and must NOT prefix it again.
      assert.strictEqual(
        apiUrl("/debugger/abc123/api/reusable-steps"),
        "/debugger/abc123/api/reusable-steps",
      );
    });

    it("leaves relative paths untouched", () => {
      assert.strictEqual(apiUrl("api/x"), "api/x");
      assert.strictEqual(apiUrl("./x"), "./x");
    });

    it("leaves fully-qualified URLs untouched", () => {
      assert.strictEqual(apiUrl("https://example.com/api/x"), "https://example.com/api/x");
    });

    it("is computed lazily — reflects the prefix even though the module was imported with no window", () => {
      // apiBase was imported at the top of this file while window was unset.
      // A non-lazy const-at-load implementation would be stuck at "". This
      // assertion fails for that implementation and passes for the lazy one.
      assert.strictEqual(apiUrl("/api/x"), "/debugger/abc123/api/x");
    });
  });
});
