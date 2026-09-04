/**
 * Base-URL helper for the local debugger SPA.
 *
 * Lives in utils/ (not under components/local-debugger/) because session-prefix
 * routing is a general concern: the shared `fetcher` and the global fetch
 * interceptor both depend on it. Keeping it here avoids a utils → component
 * layering inversion.
 *
 * The SPA is hosted in four URL shapes:
 *   1. `http://host:port/`                       (legacy CLI single-session root — no longer served)
 *   2. `http://host:port/debugger/:sessionId/`   (testbox iframe / CLI shell iframe)
 *   3. VSCode webview at `vscode-webview://...`  (the http URL lives only in `<base href>`)
 *   4. Inside the main frontend (Next.js)        — API calls mostly don't hit /api/int-runner there
 *
 * When the SPA is at (2) or (3) and issues an absolute-path fetch like
 * `fetch("/api/test-flow")`, the browser resolves it against the document
 * ORIGIN (not the full base URL with its path), so the request hits the
 * server root and bypasses the session-scoped `/debugger/:id/*` proxy.
 *
 * `apiUrl(path)` prepends the detected session prefix so the same fetch
 * works under any host: `fetch(apiUrl("/api/test-flow"))` →
 * `/debugger/:id/api/test-flow`.
 *
 * Detection order:
 *   a. `window.location.pathname` matches /debugger/<id>/ — covers (2)
 *   b. `document.baseURI` matches  /debugger/<id>/ — covers (3) where
 *      window.location is vscode-webview:// but the `<base href>` we
 *      injected encodes the session prefix
 *   c. neither matches → base = "" (root mode for legacy / Next.js)
 */

const SESSION_PREFIX_RE = /^(\/debugger\/[^/]+)(?:\/|$)/;

/**
 * Detect the session prefix from the current document. Computed LAZILY on
 * every call (rather than once at module load) so it is independent of import
 * order and reflects the live document — and so it is testable.
 */
export function getApiBase(): string {
  if (typeof window === "undefined") return "";
  const locMatch = window.location.pathname.match(SESSION_PREFIX_RE);
  if (locMatch) return locMatch[1];
  // Webview fallback: derive from document.baseURI (set via <base href>).
  if (typeof document !== "undefined" && document.baseURI) {
    try {
      const baseMatch = new URL(document.baseURI).pathname.match(SESSION_PREFIX_RE);
      if (baseMatch) return baseMatch[1];
    } catch {
      // Malformed baseURI — fall through.
    }
  }
  return "";
}

/**
 * Prepend the session prefix to an absolute path so SPA calls reach the right
 * session's proxy. Pass-through for relative URLs, full URLs, and paths that
 * are ALREADY prefixed.
 *
 * Idempotent: `apiUrl(apiUrl(p)) === apiUrl(p)`. This is load-bearing — the
 * global fetch interceptor and the fetcher both call apiUrl(), so a path the
 * fetcher already prefixed must not be prefixed again when it reaches the
 * interceptor.
 */
export function apiUrl(path: string): string {
  const base = getApiBase();
  if (!base) return path;
  if (!path.startsWith("/")) return path; // relative
  if (/^https?:\/\//i.test(path)) return path; // fully-qualified (defensive; won't start with "/")
  if (path === base || path.startsWith(`${base}/`)) return path; // already prefixed — idempotent
  return `${base}${path}`;
}
