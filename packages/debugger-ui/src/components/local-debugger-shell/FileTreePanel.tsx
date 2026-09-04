/**
 * FileTreePanel — lazy-loaded expandable tree of *.test.yaml files.
 *
 * Talks to GET /api/files?dir=... (testFlow router) for the file listing.
 * Each directory loads its children on first expand. The root starts pre-
 * expanded; nodes inside `expandToDir` (the file passed on the CLI) also
 * auto-expand on mount.
 *
 * Per spec 007: clicking semantics use the sticky-focus pattern from
 * usePointerGestures.ts. Files marked with an active session show a colored
 * dot to the right of the name (so the user can predict what tap-on-focused
 * will do).
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { FileEntry, FilesResponse, SessionBrief } from "./types";
import { usePointerGestures } from "./hooks/usePointerGestures";
import { ContextMenu, type ContextMenuItem } from "./ContextMenu";
import { colors } from "./theme";
import {
  addExpandedPath,
  loadExpandedPaths,
  migrateLegacyExpandedPaths,
  rekeyExpandedPaths,
  removeExpandedPath,
  saveExpandedPaths,
} from "./expandedDirs";

interface TreeNode {
  name: string;
  path: string;
  type: "file" | "directory";
  children: TreeNode[] | null; // null = not yet loaded; [] = loaded empty
  expanded: boolean;
}

async function fetchDir(dir: string): Promise<FilesResponse | null> {
  try {
    const res = await fetch(`/api/files?dir=${encodeURIComponent(dir)}`);
    if (!res.ok) return null;
    return (await res.json()) as FilesResponse;
  } catch {
    return null;
  }
}

function entriesToNodes(entries: FileEntry[]): TreeNode[] {
  return entries.map((e) => ({
    name: e.name,
    path: e.path,
    type: e.type,
    children: e.type === "directory" ? null : [],
    expanded: false,
  }));
}

function updateNode(
  nodes: TreeNode[],
  targetPath: string,
  updater: (n: TreeNode) => TreeNode,
): TreeNode[] {
  return nodes.map((n) => {
    if (n.path === targetPath) return updater(n);
    if (n.children && n.children.length > 0) {
      return { ...n, children: updateNode(n.children, targetPath, updater) };
    }
    return n;
  });
}

interface Props {
  initialDir: string;
  expandToFile: string | null;
  sessions: SessionBrief[];
  focusedPath: string | null;
  onFocus: (path: string | null) => void;
  onOpen: (path: string) => void;
  onCollapse?: () => void;
}

export function FileTreePanel(props: Props) {
  const { initialDir, expandToFile, sessions, focusedPath, onFocus, onOpen, onCollapse } = props;
  const [rootNodes, setRootNodes] = useState<TreeNode[]>([]);
  const [rootDir, setRootDir] = useState<string>(initialDir);
  const [error, setError] = useState<string | null>(null);
  const [menu, setMenu] = useState<{ x: number; y: number; path: string } | null>(null);

  // Files that currently have a live session — used for the colored dot.
  const liveSessionPaths = useMemo(() => {
    const set = new Set<string>();
    for (const s of sessions) {
      if (s.status !== "ended") set.add(s.yamlPath);
    }
    return set;
  }, [sessions]);

  // Expanded-directory state is persisted per project root (see expandedDirs.ts),
  // so the tree never restores — or writes — a directory outside the current
  // project. The set is seeded on the FIRST RENDER, not in the load effect:
  // autoExpandTo paints the tree before its own fetches settle, so a directory
  // toggled during that window would otherwise persist against an empty set and
  // wipe every stored entry. `loadExpandedPaths` is read-only, so seeding here
  // is safe even if React discards the render; the one-shot legacy migration,
  // which deletes a shared key, runs in the effect below instead.
  const expandedSeededRef = useRef(false);
  const expandedPathsRef = useRef<Set<string>>(new Set());
  const expandedRootRef = useRef<string>(initialDir);
  if (!expandedSeededRef.current) {
    expandedSeededRef.current = true;
    expandedPathsRef.current = loadExpandedPaths(initialDir);
  }

  const persistExpanded = useCallback((path: string, expanded: boolean) => {
    const set = expandedPathsRef.current;
    if (expanded) {
      addExpandedPath(set, path);
    } else {
      removeExpandedPath(set, path);
    }
    saveExpandedPaths(expandedRootRef.current, set);
  }, []);

  // Initial fetch + auto-expand chain toward expandToFile + restore saved state
  useEffect(() => {
    let cancelled = false;

    async function load() {
      // One-shot migration off the pre-fix shared key. Deferred to here because
      // it deletes that key: run during render, a render React then threw away
      // would consume the upgrading user's expansion state and commit nothing.
      expandedPathsRef.current = migrateLegacyExpandedPaths(
        expandedRootRef.current,
        expandedPathsRef.current,
      );

      const resp = await fetchDir(initialDir);
      if (cancelled) return;
      if (!resp) {
        setError("Could not load file tree");
        return;
      }
      setRootDir(resp.dir);
      const nodes = entriesToNodes(resp.entries);

      if (expandToFile && expandToFile.startsWith(resp.dir)) {
        await autoExpandTo(nodes, resp.dir, expandToFile, (updated) => {
          if (!cancelled) setRootNodes(updated);
        });
      } else {
        setRootNodes(nodes);
      }

      // Restore previously expanded directories for THIS project root only. The
      // set is already seeded from initialDir; re-key only if the server resolved
      // the root to a different path (symlink, trailing slash), keeping whatever
      // the user toggled while the tree was loading.
      if (resp.dir !== expandedRootRef.current) {
        expandedPathsRef.current = rekeyExpandedPaths(resp.dir, expandedPathsRef.current);
        expandedRootRef.current = resp.dir;
      }
      const saved = expandedPathsRef.current;
      if (saved.size > 0 && !cancelled) {
        const sorted = [...saved].sort(
          (a, b) => a.split("/").length - b.split("/").length,
        );
        for (const dirPath of sorted) {
          if (cancelled) break;
          const dirResp = await fetchDir(dirPath);
          if (!dirResp) {
            saved.delete(dirPath);
            continue;
          }
          const children = entriesToNodes(dirResp.entries);
          setRootNodes((prev) =>
            updateNode(prev, dirPath, (n) => ({ ...n, children, expanded: true })),
          );
        }
        saveExpandedPaths(resp.dir, saved);
      }
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, [initialDir, expandToFile]);

  const expandDir = useCallback(async (node: TreeNode) => {
    const resp = await fetchDir(node.path);
    if (!resp) return;
    const children = entriesToNodes(resp.entries);
    setRootNodes((prev) =>
      updateNode(prev, node.path, (n) => ({ ...n, children, expanded: true })),
    );
    persistExpanded(node.path, true);
  }, [persistExpanded]);

  const toggleDir = useCallback(
    (node: TreeNode) => {
      if (node.expanded) {
        setRootNodes((prev) =>
          updateNode(prev, node.path, (n) => ({ ...n, expanded: false })),
        );
        persistExpanded(node.path, false);
      } else if (node.children === null) {
        void expandDir(node);
      } else {
        setRootNodes((prev) =>
          updateNode(prev, node.path, (n) => ({ ...n, expanded: true })),
        );
        persistExpanded(node.path, true);
      }
    },
    [expandDir, persistExpanded],
  );

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        height: "100%",
        background: colors.bgPanel,
        borderRight: `1px solid ${colors.bgHover}`,
        overflow: "hidden",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          height: 36,
          padding: "0 4px 0 12px",
          fontSize: 11,
          fontWeight: 600,
          textTransform: "uppercase",
          letterSpacing: 0.4,
          color: colors.textMuted,
          borderBottom: `1px solid ${colors.bgHover}`,
          flexShrink: 0,
          boxSizing: "border-box",
        }}
      >
        <span style={{ flex: 1 }}>Tests</span>
        {onCollapse && (
          <button
            type="button"
            aria-label="Collapse sidebar"
            onClick={onCollapse}
            style={{
              width: 24,
              height: 24,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              border: "none",
              background: "transparent",
              color: colors.textMuted,
              cursor: "pointer",
              padding: 0,
              borderRadius: 4,
              flexShrink: 0,
            }}
          >
            <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
              <path d="M10 3.5L5.5 8 10 12.5V3.5z" />
            </svg>
          </button>
        )}
      </div>
      <div
        style={{
          padding: "4px 6px 4px 0",
          fontSize: 11,
          color: colors.textDim,
          flexShrink: 0,
          paddingLeft: 12,
        }}
        title={rootDir}
      >
        {rootDir}
      </div>
      <div
        role="tree"
        aria-label="Test files"
        style={{ flex: 1, overflowY: "auto", padding: "4px 0" }}
      >
        {error && (
          <div style={{ padding: 12, color: colors.textDanger, fontSize: 13 }}>{error}</div>
        )}
        {!error && rootNodes.length === 0 && (
          <div style={{ padding: 12, color: colors.textDim, fontSize: 13 }}>
            No <code>.test.yaml</code> files found.
          </div>
        )}
        <TreeList
          nodes={rootNodes}
          depth={0}
          liveSessionPaths={liveSessionPaths}
          focusedPath={focusedPath}
          onFocus={onFocus}
          onOpen={onOpen}
          onToggleDir={toggleDir}
          onRequestMenu={(path, x, y) => setMenu({ path, x, y })}
        />
      </div>
      {menu && (
        <ContextMenu
          x={menu.x}
          y={menu.y}
          items={menuItemsFor(menu.path, onOpen)}
          onDismiss={() => setMenu(null)}
        />
      )}
    </div>
  );
}

function menuItemsFor(filePath: string, onOpen: (p: string) => void): ContextMenuItem[] {
  const isYaml = filePath.endsWith(".test.yaml") || filePath.endsWith(".test.yml");
  return [
    {
      label: "Open in debugger",
      disabled: !isYaml,
      onSelect: () => {
        if (isYaml) onOpen(filePath);
      },
    },
  ];
}

interface TreeListProps {
  nodes: TreeNode[];
  depth: number;
  liveSessionPaths: Set<string>;
  focusedPath: string | null;
  onFocus: (path: string | null) => void;
  onOpen: (path: string) => void;
  onToggleDir: (node: TreeNode) => void;
  onRequestMenu: (path: string, x: number, y: number) => void;
}

function TreeList(props: TreeListProps) {
  return (
    <>
      {props.nodes.map((n) => (
        <TreeRow key={n.path} node={n} {...props} />
      ))}
    </>
  );
}

interface TreeRowProps extends TreeListProps {
  node: TreeNode;
}

function TreeRow({
  node,
  depth,
  liveSessionPaths,
  focusedPath,
  onFocus,
  onOpen,
  onToggleDir,
  onRequestMenu,
}: TreeRowProps) {
  const isFile = node.type === "file";
  const isDir = node.type === "directory";
  const isFocused = focusedPath === node.path;
  const hasSession = isFile && liveSessionPaths.has(node.path);

  const gestures = usePointerGestures({
    isFocused,
    onFocus: () => onFocus(node.path),
    onOpen: () => {
      if (isFile) onOpen(node.path);
      else onToggleDir(node);
    },
    onContextMenu: (x, y) => {
      onFocus(node.path);
      if (isFile) onRequestMenu(node.path, x, y);
    },
  });

  return (
    <>
      <div
        role="treeitem"
        // Every row is a tab stop. The strict WAI-ARIA pattern is roving
        // tabindex (only the focused row is 0) paired with ArrowUp/Down/
        // Right/Left key handlers for intra-tree navigation. We don't
        // have those handlers yet, and roving tabindex without them
        // leaves keyboard-only users stuck on one row. Until full
        // arrow-key navigation lands, plain tabindex=0 is the more
        // accessible choice. TODO: implement arrow-key handlers.
        tabIndex={0}
        aria-selected={isFocused}
        aria-level={depth + 1}
        aria-expanded={isDir ? node.expanded : undefined}
        aria-label={isFile ? node.name : `Folder ${node.name}`}
        data-testid={isFile ? "file-row" : "dir-row"}
        data-path={node.path}
        data-focused={isFocused ? "true" : "false"}
        data-has-session={hasSession ? "true" : "false"}
        {...gestures}
        style={{
          display: "flex",
          alignItems: "center",
          gap: 6,
          padding: `4px 8px 4px ${8 + depth * 14}px`,
          fontSize: 13,
          color: colors.textBody,
          background: isFocused ? colors.bgHover : "transparent",
          cursor: "pointer",
          userSelect: "none",
          touchAction: "manipulation",
          minHeight: 28,
          boxSizing: "border-box",
        }}
      >
        {isDir && (
          <span style={{ width: 12, color: colors.textMuted, fontSize: 10, flexShrink: 0 }}>
            {node.expanded ? "▾" : "▸"}
          </span>
        )}
        {isFile && <span style={{ width: 12, flexShrink: 0 }} />}
        <span
          title={node.name}
          style={{
            flex: 1,
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
          }}
        >
          {node.name}
        </span>
        {hasSession && (
          <span
            data-testid="session-indicator"
            style={{
              width: 8,
              height: 8,
              borderRadius: "50%",
              background: colors.accent,
              flexShrink: 0,
              marginRight: 4,
            }}
            title="Session running"
          />
        )}
      </div>
      {isDir && node.expanded && node.children && node.children.length > 0 && (
        <div role="group">
          <TreeList
            nodes={node.children}
            depth={depth + 1}
            liveSessionPaths={liveSessionPaths}
            focusedPath={focusedPath}
            onFocus={onFocus}
            onOpen={onOpen}
            onToggleDir={onToggleDir}
            onRequestMenu={onRequestMenu}
          />
        </div>
      )}
    </>
  );
}

/**
 * Walk from `rootDir` down to `targetFile`, fetching + expanding each
 * intermediate directory so the target row is visible after initial load.
 */
async function autoExpandTo(
  nodes: TreeNode[],
  rootDir: string,
  targetFile: string,
  setNodes: (next: TreeNode[]) => void,
): Promise<void> {
  const rel = targetFile.slice(rootDir.length).replace(/^\/+/, "");
  const parts = rel.split("/");
  // Drop the file basename so we only walk directories.
  parts.pop();

  let working = nodes;
  let currentDir = rootDir;
  setNodes(working);

  for (const part of parts) {
    currentDir = currentDir + (currentDir.endsWith("/") ? "" : "/") + part;
    const resp = await fetchDir(currentDir);
    if (!resp) break;
    const kids = entriesToNodes(resp.entries);
    working = updateNode(working, currentDir, (n) => ({
      ...n,
      children: kids,
      expanded: true,
    }));
    setNodes(working);
  }
}
