import { useMemo } from "react";

/**
 * Returns `true` when the debugger SPA is rendered inside the Shiplight
 * testbox's `/debugger/:sessionId/` iframe (which always sets
 * `?embedded=1` in the URL). When `true`, the UI must suppress its own
 * file-navigation chrome — the testbox's OmniTerm file explorer is the
 * single source of file navigation (see Phase 4 spec FR-013).
 *
 * Memoized on first render. Safe to call during SSR: returns `false`
 * when `window` is unavailable.
 */
export function useIsEmbedded(): boolean {
  return useMemo(() => {
    if (typeof window === "undefined") return false;
    return new URLSearchParams(window.location.search).get("embedded") === "1";
  }, []);
}
