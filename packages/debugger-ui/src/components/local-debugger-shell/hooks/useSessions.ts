/**
 * useSessions — polls GET /api/debugger/sessions and exposes mutations.
 *
 * `openSession` POSTs to the server which creates a session instantly in
 * "idle" status (no Playwright process). The sandbox only starts when the
 * user clicks "Start" in the debugger bar inside the embedded SPA.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import type { SessionBrief } from "../types";

const POLL_INTERVAL_FAST_MS = 1000;
const POLL_INTERVAL_SLOW_MS = 5000;
const POLL_BACKOFF_THRESHOLD = 3;

interface UseSessionsResult {
  sessions: SessionBrief[];
  activeSessionId: string | null;
  setActiveSessionId: (id: string | null) => void;
  openSession: (yamlPath: string) => void;
  closeSession: (sessionId: string) => Promise<void>;
}

export function useSessions(): UseSessionsResult {
  const [sessions, setSessions] = useState<SessionBrief[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const mountedRef = useRef(true);
  const failureCountRef = useRef(0);
  const sessionsRef = useRef(sessions);
  sessionsRef.current = sessions;

  const fetchSessions = useCallback(async (): Promise<boolean> => {
    try {
      const res = await fetch("/api/debugger/sessions", { cache: "no-store" });
      if (!res.ok) return false;
      const data = (await res.json()) as { sessions: SessionBrief[] };
      if (!mountedRef.current) return true;
      setSessions(data.sessions);
      setActiveSessionId((prev) => {
        if (prev) {
          const stillExists = data.sessions.some((s) => s.sessionId === prev);
          if (stillExists) return prev;
        }
        const first = data.sessions.find((s) => s.status !== "ended");
        return first ? first.sessionId : null;
      });
      return true;
    } catch {
      return false;
    }
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    let timer: number | null = null;
    const tick = async () => {
      if (!mountedRef.current) return;
      const ok = await fetchSessions();
      if (!mountedRef.current) return;
      if (ok) {
        failureCountRef.current = 0;
      } else {
        failureCountRef.current += 1;
      }
      const interval =
        failureCountRef.current >= POLL_BACKOFF_THRESHOLD
          ? POLL_INTERVAL_SLOW_MS
          : POLL_INTERVAL_FAST_MS;
      timer = window.setTimeout(tick, interval);
    };
    void tick();
    return () => {
      mountedRef.current = false;
      if (timer !== null) window.clearTimeout(timer);
    };
  }, [fetchSessions]);

  const openSession = useCallback(
    (yamlPath: string): void => {
      const existing = sessionsRef.current.find(
        (s) => s.yamlPath === yamlPath && s.status !== "ended",
      );
      if (existing) {
        setActiveSessionId(existing.sessionId);
        return;
      }
      (async () => {
        try {
          const res = await fetch("/api/debugger/sessions", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ yamlPath }),
          });
          if (!res.ok) return;
          const session = (await res.json()) as SessionBrief;
          setSessions((prev) => [...prev, session]);
          setActiveSessionId(session.sessionId);
        } catch {
          // best-effort
        }
      })();
    },
    [],
  );

  const closeSession = useCallback(
    async (sessionId: string): Promise<void> => {
      try {
        await fetch(`/api/debugger/sessions/${encodeURIComponent(sessionId)}`, {
          method: "DELETE",
        });
      } catch {
        // best-effort
      }
      setSessions((prev) => {
        const next = prev.filter((s) => s.sessionId !== sessionId);
        setActiveSessionId((active) => {
          if (active !== sessionId) return active;
          const remaining = next.filter((s) => s.status !== "ended");
          return remaining[0]?.sessionId ?? null;
        });
        return next;
      });
    },
    [],
  );

  return {
    sessions,
    activeSessionId,
    setActiveSessionId,
    openSession,
    closeSession,
  };
}
