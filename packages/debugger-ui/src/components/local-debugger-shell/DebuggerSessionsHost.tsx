/**
 * DebuggerSessionsHost — keeps every session's iframe mounted in one
 * place, regardless of which tab is active. Only the active iframe is
 * visible (display: block); the rest are display: none.
 *
 * All sessions (idle or running) use the same iframe URL at
 * /debugger/:sessionId/ — the server serves the SPA for any existing
 * session. For idle sessions, file-related API calls are handled by the
 * server's fallback router.
 */

import React, { useMemo } from "react";
import type { SessionBrief } from "./types";
import { colors } from "./theme";

interface SessionFrameProps {
  session: SessionBrief;
  isActive: boolean;
}

function SessionFrame({ session, isActive }: SessionFrameProps) {
  const src = useMemo(() => {
    const params = new URLSearchParams({
      embedded: "1",
      yamlPath: session.yamlPath,
    });
    return `/debugger/${encodeURIComponent(session.sessionId)}/?${params.toString()}`;
  }, [session.sessionId, session.yamlPath]);

  return (
    <iframe
      src={src}
      title={`Debugger: ${session.yamlPath}`}
      style={{
        position: "absolute",
        inset: 0,
        width: "100%",
        height: "100%",
        border: "none",
        display: isActive ? "block" : "none",
      }}
      sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-popups-to-escape-sandbox"
    />
  );
}

interface Props {
  sessions: SessionBrief[];
  activeSessionId: string | null;
}

export function DebuggerSessionsHost({ sessions, activeSessionId }: Props) {
  const live = sessions.filter((s) => s.status !== "ended");

  return (
    <div style={{ position: "absolute", inset: 0 }}>
      {live.map((s) => (
        <SessionFrame
          key={s.sessionId}
          session={s}
          isActive={s.sessionId === activeSessionId}
        />
      ))}
      {sessions.length === 0 && (
        <div
          style={{
            position: "absolute",
            inset: 0,
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            color: colors.textDim,
            fontSize: 13,
            textAlign: "center",
            padding: 24,
            pointerEvents: "none",
          }}
        >
          <div style={{ fontSize: 15, color: colors.textMuted, marginBottom: 8 }}>
            No debugger sessions open
          </div>
          <div>Double-click a <code style={inlineCode}>.test.yaml</code> file in the tree to open one.</div>
        </div>
      )}
    </div>
  );
}

const inlineCode: React.CSSProperties = {
  background: colors.bgHover,
  padding: "1px 6px",
  borderRadius: 3,
  fontSize: 12,
  fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
};
