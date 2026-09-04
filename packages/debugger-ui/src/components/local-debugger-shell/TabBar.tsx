/**
 * TabBar — horizontal strip of open debugger session tabs.
 *
 * Each tab shows the yaml file's basename. Clicking the tab body switches
 * which iframe is visible in DebuggerSessionsHost. Each tab has a close
 * button (≥32px hit target so it works on touch) that DELETEs the session.
 *
 * Status indicators:
 *   - "idle"     → normal tab (no backend session yet), close X visible
 *   - "starting" → spinner instead of the close X
 *   - "running"  → normal tab, close X visible
 *   - "ended"    → grayed-out, click reopens (closed sessions stay in the
 *                  list until garbage-collected by the next poll cycle if
 *                  the server eventually drops them)
 */

import React from "react";
import type { SessionBrief } from "./types";
import { colors } from "./theme";

function basename(p: string): string {
  const idx = Math.max(p.lastIndexOf("/"), p.lastIndexOf("\\"));
  return idx >= 0 ? p.slice(idx + 1) : p;
}

interface Props {
  sessions: SessionBrief[];
  activeSessionId: string | null;
  onActivate: (sessionId: string) => void;
  onClose: (sessionId: string) => void;
}

export function TabBar({ sessions, activeSessionId, onActivate, onClose }: Props) {
  return (
    <div
      role="tablist"
      style={{
        display: "flex",
        alignItems: "stretch",
        height: 36,
        background: colors.bgPanel,
        borderBottom: `1px solid ${colors.bgHover}`,
        overflowX: "auto",
        flexShrink: 0,
      }}
    >
      {sessions.map((s) => {
        const isActive = s.sessionId === activeSessionId;
        const isEnded = s.status === "ended";
        const isStarting = s.status === "starting";
        return (
          <div
            key={s.sessionId}
            role="tab"
            aria-selected={isActive}
            data-testid="debugger-tab"
            data-session-id={s.sessionId}
            data-yaml-path={s.yamlPath}
            data-active={isActive ? "true" : "false"}
            data-status={s.status}
            onClick={() => onActivate(s.sessionId)}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              padding: "0 8px 0 12px",
              borderRight: `1px solid ${colors.bgHover}`,
              background: isActive ? colors.bgBase : "transparent",
              color: isEnded ? colors.textDim : isActive ? colors.textPrimary : colors.textBody,
              fontSize: 13,
              cursor: isEnded ? "not-allowed" : "pointer",
              userSelect: "none",
              maxWidth: 240,
              touchAction: "manipulation",
              borderTop: isActive ? `2px solid ${colors.accent}` : "2px solid transparent",
              boxSizing: "border-box",
            }}
            title={s.yamlPath}
          >
            <span
              style={{
                whiteSpace: "nowrap",
                overflow: "hidden",
                textOverflow: "ellipsis",
                fontStyle: isEnded ? "italic" : "normal",
              }}
            >
              {basename(s.yamlPath)}
            </span>
            {isStarting ? (
              <span style={miniSpinner} aria-label="starting" />
            ) : (
              <button
                type="button"
                aria-label={`Close ${basename(s.yamlPath)}`}
                data-testid="debugger-tab-close"
                onClick={(e) => {
                  e.stopPropagation();
                  onClose(s.sessionId);
                }}
                style={closeBtn}
              >
                ×
              </button>
            )}
          </div>
        );
      })}
    </div>
  );
}

const closeBtn: React.CSSProperties = {
  width: 32,
  height: 32,
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  border: "none",
  background: "transparent",
  color: "inherit",
  cursor: "pointer",
  fontSize: 18,
  lineHeight: 1,
  borderRadius: 4,
  padding: 0,
  flexShrink: 0,
};

const miniSpinner: React.CSSProperties = {
  width: 12,
  height: 12,
  border: `2px solid ${colors.spinnerTrack}`,
  borderTopColor: colors.accent,
  borderRadius: "50%",
  animation: "shp-spin 0.8s linear infinite",
  flexShrink: 0,
};
