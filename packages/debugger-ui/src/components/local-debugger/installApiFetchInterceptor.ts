/**
 * Global fetch interceptor for the embedded debugger SPA.
 *
 * The structural guarantee behind the apiUrl() routing: rather than rely on
 * every call site remembering to wrap its path, this patches window.fetch once
 * at the SPA entry so that ANY same-origin `/api/...` request — issued by the
 * shared fetcher, a raw fetch(), SWR, or a third-party lib — is rewritten to
 * the session-scoped `/debugger/:id/api/...` path before it leaves the iframe.
 *
 * It composes with the explicit apiUrl() in the fetcher: a path the fetcher
 * already prefixed starts with `/debugger/...`, not `/api/`, so it is left
 * untouched here (and apiUrl() is idempotent regardless). Non-/api paths
 * (static assets, etc.) and fully-qualified URLs are never rewritten.
 *
 * Install is idempotent (marker on the patched function), so double-entry or
 * HMR can't stack wrappers.
 */

import { apiUrl } from "../../utils/apiBase";

type Fetch = typeof window.fetch;
type MarkedFetch = Fetch & { __apiInterceptor?: boolean };

function rewrite(input: RequestInfo | URL): RequestInfo | URL {
  if (typeof input === "string") {
    return input.startsWith("/api/") ? apiUrl(input) : input;
  }
  if (input instanceof URL) {
    // Only same-origin /api paths — never rewrite a cross-origin URL's path
    // (e.g. fetch(new URL("https://third-party.com/api/x"))).
    const sameOrigin =
      typeof window !== "undefined" && input.origin === window.location.origin;
    if (sameOrigin && input.pathname.startsWith("/api/")) {
      const next = new URL(input.href);
      next.pathname = apiUrl(next.pathname);
      return next;
    }
    return input;
  }
  // Request objects carry an already-resolved absolute URL with no reliable way
  // to recover the author's intended relative path; this SPA never builds them
  // with bare /api paths, so leave them untouched.
  return input;
}

export function installApiFetchInterceptor(): void {
  if (typeof window === "undefined") return;
  const current = window.fetch as MarkedFetch;
  if (current.__apiInterceptor) return;

  const original = current.bind(window);
  const patched: MarkedFetch = (input, init) => original(rewrite(input), init);
  patched.__apiInterceptor = true;
  window.fetch = patched;
}
