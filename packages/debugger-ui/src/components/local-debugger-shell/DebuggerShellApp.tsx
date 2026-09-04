/**
 * DebuggerShellApp — root component for the CLI multi-tab debugger shell.
 *
 * Layout:
 *   ┌─────────────────────────────────────────────────────────┐
 *   │ FileTree │  TabBar                                      │
 *   │   (left  │  ─────────────────────────────────────────── │
 *   │   panel) │  DebuggerSessionsHost (iframes per session)  │
 *   └─────────────────────────────────────────────────────────┘
 *
 * Reads `?open=<absolute yamlPath>` on mount and opens an idle tab for it.
 * The backend session is only created when the user clicks "Start Debug".
 * Sticky focus state lives here so it persists as the user navigates the tree.
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSessions } from "./hooks/useSessions";
import { FileTreePanel } from "./FileTreePanel";
import { TabBar } from "./TabBar";
import { DebuggerSessionsHost } from "./DebuggerSessionsHost";
import { colors } from "./theme";

interface BootstrapConfig {
  initialDir: string;
  initialFile: string | null;
}

/**
 * Read the bootstrap config from the URL.
 *
 * - `?open=<abs>` (preferred — set by CLI when launched with a file arg)
 *
 * The initialDir comes from the file-tree API itself (the server-side
 * createTestFlowRouter defaults to initialDir if no ?dir= is passed), so
 * the shell doesn't need it up-front. We fetch /api/files once with no
 * argument and the response carries `dir` + `projectRoot`.
 */
function readBootstrap(): BootstrapConfig {
  if (typeof window === "undefined") return { initialDir: "/", initialFile: null };
  const params = new URLSearchParams(window.location.search);
  const open = params.get("open");
  return {
    initialDir: "/",  // overwritten after the first /api/files call below
    initialFile: open && open.length > 0 ? open : null,
  };
}

export function DebuggerShellApp() {
  const bootstrap = useMemo(readBootstrap, []);
  const [resolvedInitialDir, setResolvedInitialDir] = useState<string | null>(null);
  const [focusedPath, setFocusedPath] = useState<string | null>(bootstrap.initialFile);
  const sessionsState = useSessions();
  const autoOpenedRef = useRef(false);

  const [asideWidth, setAsideWidth] = useState(280);
  const [isDragging, setIsDragging] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const dragCleanupRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    return () => {
      dragCleanupRef.current?.();
    };
  }, []);

  const onResizeStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    const startX = e.clientX;
    const startWidth = asideWidth;
    setIsDragging(true);

    const onMouseMove = (ev: MouseEvent) => {
      const newWidth = Math.max(160, Math.min(600, startWidth + ev.clientX - startX));
      setAsideWidth(newWidth);
    };
    const cleanup = () => {
      setIsDragging(false);
      document.removeEventListener("mousemove", onMouseMove);
      document.removeEventListener("mouseup", cleanup);
      dragCleanupRef.current = null;
    };
    dragCleanupRef.current?.();
    dragCleanupRef.current = cleanup;
    document.addEventListener("mousemove", onMouseMove);
    document.addEventListener("mouseup", cleanup);
  }, [asideWidth]);

  // Resolve the initial directory by hitting /api/files with no ?dir. The
  // server returns the CLI-provided initialDir + projectRoot, which we use
  // as the tree root.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/files");
        if (!res.ok) return;
        const data = (await res.json()) as { dir: string };
        if (!cancelled) setResolvedInitialDir(data.dir);
      } catch {
        // ignore — surface as empty tree
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Auto-open the file passed via ?open= (or seeded by the CLI). Only once.
  const { openSession } = sessionsState;
  useEffect(() => {
    if (autoOpenedRef.current) return;
    if (!bootstrap.initialFile) return;
    autoOpenedRef.current = true;
    openSession(bootstrap.initialFile);
  }, [bootstrap.initialFile, openSession]);

  return (
    <>
      <style>{globalCss}</style>
      <div
        style={{
          display: "flex",
          height: "100%",
          width: "100%",
          color: colors.textBody,
          fontFamily:
            "-apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif",
          cursor: isDragging ? "col-resize" : undefined,
          userSelect: isDragging ? "none" : undefined,
        }}
      >
        {isDragging && (
          <div
            style={{
              position: "fixed",
              inset: 0,
              zIndex: 9999,
              cursor: "col-resize",
            }}
          />
        )}
        <aside
          data-testid="file-tree-panel"
          style={{
            width: collapsed ? 36 : asideWidth,
            flexShrink: 0,
            height: "100%",
            background: colors.bgPanel,
            position: "relative",
            overflow: "hidden",
            transition: isDragging ? "none" : "width 200ms ease",
          }}
        >
          {/* Collapsed: expand button */}
          <div
            style={{
              position: "absolute",
              inset: 0,
              opacity: collapsed ? 1 : 0,
              pointerEvents: collapsed ? "auto" : "none",
              transition: "opacity 200ms ease",
            }}
          >
            <button
              type="button"
              aria-label="Expand sidebar"
              onClick={() => setCollapsed(false)}
              style={toggleBtnStyle}
            >
              <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
                <path d="M6 3.5L10.5 8 6 12.5V3.5z" />
              </svg>
            </button>
          </div>
          {/* Expanded: file tree + resize handle */}
          <div
            style={{
              width: asideWidth,
              height: "100%",
              opacity: collapsed ? 0 : 1,
              pointerEvents: collapsed ? "none" : "auto",
              transition: "opacity 200ms ease",
            }}
          >
            {resolvedInitialDir && (
              <FileTreePanel
                initialDir={resolvedInitialDir}
                expandToFile={bootstrap.initialFile}
                sessions={sessionsState.sessions}
                focusedPath={focusedPath}
                onFocus={setFocusedPath}
                onOpen={(path) => {
                  setFocusedPath(path);
                  sessionsState.openSession(path);
                }}
                onCollapse={() => setCollapsed(true)}
              />
            )}
            {!resolvedInitialDir && (
              <div style={{ padding: 12, color: colors.textDim, fontSize: 13 }}>
                Loading file tree…
              </div>
            )}
          </div>
          {!collapsed && (
            <div
              data-testid="resize-handle"
              role="separator"
              aria-orientation="vertical"
              onMouseDown={onResizeStart}
              style={{
                position: "absolute",
                top: 0,
                right: 0,
                width: 4,
                height: "100%",
                cursor: "col-resize",
                zIndex: 10,
              }}
            />
          )}
        </aside>
        <main
          data-testid="main-panel"
          style={{
            flex: 1,
            display: "flex",
            flexDirection: "column",
            minWidth: 0,
            height: "100%",
            position: "relative",
          }}
        >
          <TabBar
            sessions={sessionsState.sessions}
            activeSessionId={sessionsState.activeSessionId}
            onActivate={sessionsState.setActiveSessionId}
            onClose={(sid) => void sessionsState.closeSession(sid)}
          />
          <div
            data-testid="sessions-host"
            style={{ flex: 1, position: "relative", minHeight: 0 }}
          >
            <DebuggerSessionsHost
              sessions={sessionsState.sessions}
              activeSessionId={sessionsState.activeSessionId}
            />
          </div>
        </main>
      </div>
    </>
  );
}

const toggleBtnStyle: React.CSSProperties = {
  width: 36,
  height: 36,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  border: "none",
  background: "transparent",
  color: colors.textMuted,
  cursor: "pointer",
  padding: 0,
  borderBottom: `1px solid ${colors.bgHover}`,
  boxSizing: "border-box",
};

const globalCss = `
  html, body, #root { height: 100%; margin: 0; padding: 0; }
  * { box-sizing: border-box; }
  * { scrollbar-width: thin; scrollbar-color: ${colors.bgInputHint} transparent; }
  @keyframes shp-spin { to { transform: rotate(360deg); } }
`;
