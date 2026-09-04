/**
 * FileTreeSidebar — VS Code-style expandable file tree for the local debugger.
 *
 * Directories expand/collapse in-place with lazy-loaded children via GET /api/files.
 * The expandToDir directory starts pre-expanded. A ".." entry at the top allows
 * navigating above the current tree root.
 */

import React, { useCallback, useEffect, useRef, useState } from "react";
import { ScrollArea, Text, UnstyledButton } from "@mantine/core";
import { IconArrowUp, IconChevronDown, IconChevronRight, IconFolder, IconFolderOpen } from "@tabler/icons-react";
import { apiUrl } from "../../utils/apiBase";

/** Small Shiplight brand icon for .test.yaml files. */
function ShiplightFileIcon({ size = 16 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 385 437"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      style={{ flexShrink: 0 }}
    >
      <path d="M345.33,119.27l-68.27,45.65-32.7-13.59L57.96,73.94,179.6,3.72c8.09-4.67,17.99-4.96,26.34-.77l136.4,68.39c19.04,9.55,20.7,36.09,2.99,47.93Z" fill="url(#sl-g1)" />
      <path d="M327.17,363l-121.64,70.22c-8.09,4.67-17.99,4.96-26.34.78l-136.44-68.37c-19.06-9.55-20.71-36.12-2.97-47.95l68.29-45.55,32.7,13.59,186.41,77.28Z" fill="url(#sl-g2)" />
      <path d="M385.02,294v35.67l-223.88-92.99L0,169.8v-2.4c0-28.57,29.05-47.96,55.43-37.01l168.55,69.98,136.34,56.62c14.95,6.21,24.7,20.81,24.7,37Z" fill="url(#sl-g3)" />
      <defs>
        <linearGradient id="sl-g1" x1="57.96" y1="82.46" x2="357.68" y2="82.46" gradientUnits="userSpaceOnUse">
          <stop stopColor="#0fb3df" /><stop offset="1" stopColor="#0f5fdf" />
        </linearGradient>
        <linearGradient id="sl-g2" x1="27.41" y1="354.54" x2="327.17" y2="354.54" gradientUnits="userSpaceOnUse">
          <stop stopColor="#0fb3df" /><stop offset="1" stopColor="#0f5fdf" />
        </linearGradient>
        <linearGradient id="sl-g3" x1="0" y1="228.48" x2="385.02" y2="228.48" gradientUnits="userSpaceOnUse">
          <stop stopColor="#0fb3df" /><stop offset="1" stopColor="#0f5fdf" />
        </linearGradient>
      </defs>
    </svg>
  );
}

interface FileEntry {
  name: string;
  type: "file" | "directory";
  path: string;
}

interface FilesResponse {
  dir: string;
  parent: string | null;
  entries: FileEntry[];
}

interface TreeNode {
  name: string;
  path: string;
  type: "file" | "directory";
  children: TreeNode[] | null; // null = not yet loaded
  expanded: boolean;
}

export interface FileTreeSidebarProps {
  /** The root directory shown at top level of the tree. */
  treeRoot: string;
  /** Directory to auto-expand the tree to on mount. */
  expandToDir: string;
  selectedFile: string | null;
  onSelectFile: (filePath: string) => void;
  onChangeTreeRoot: (dir: string) => void;
  /** Current width in pixels (controlled by parent via drag handle). */
  width: number;
  /** Disable file selection (e.g. while a debug session is active). */
  disabled?: boolean;
}

async function fetchDir(dir: string): Promise<{ entries: FileEntry[]; parent: string | null }> {
  const res = await fetch(apiUrl(`/api/files?dir=${encodeURIComponent(dir)}`));
  if (!res.ok) return { entries: [], parent: null };
  const data: FilesResponse = await res.json();
  return { entries: data.entries, parent: data.parent };
}

function entriesToNodes(entries: FileEntry[]): TreeNode[] {
  return entries.map((e) => ({
    name: e.name,
    path: e.path,
    type: e.type,
    children: e.type === "directory" ? null : undefined as any,
    expanded: false,
  }));
}

function findAndUpdate(
  nodes: TreeNode[],
  targetPath: string,
  updater: (node: TreeNode) => TreeNode,
): TreeNode[] {
  return nodes.map((node) => {
    if (node.path === targetPath) {
      return updater(node);
    }
    if (node.children && targetPath.startsWith(node.path + "/")) {
      return { ...node, children: findAndUpdate(node.children, targetPath, updater) };
    }
    return node;
  });
}

function TreeItem({
  node,
  depth,
  selectedFile,
  onToggle,
  onSelect,
  onDrillDown,
}: {
  node: TreeNode;
  depth: number;
  selectedFile: string | null;
  onToggle: (path: string) => void;
  onSelect: (path: string) => void;
  onDrillDown: (path: string) => void;
}) {
  const isDir = node.type === "directory";
  const isSelected = !isDir && node.path === selectedFile;
  const paddingLeft = 8 + depth * 16;

  const rowStyle: React.CSSProperties = {
    display: "flex",
    alignItems: "center",
    gap: 4,
    paddingLeft,
    paddingRight: 8,
    paddingTop: 2,
    paddingBottom: 2,
    width: "100%",
    fontSize: 13,
    borderRadius: 0,
    background: isSelected ? "var(--mantine-color-blue-light)" : "transparent",
  };

  // For files: single click selects
  if (!isDir) {
    return (
      <UnstyledButton
        onClick={() => onSelect(node.path)}
        style={{ ...rowStyle, cursor: "pointer" }}
        styles={{ root: { "&:hover": { background: "var(--mantine-color-default-hover)" } } }}
      >
        <span style={{ width: 20, flexShrink: 0 }} />
        <ShiplightFileIcon size={16} />
        <Text size="sm" truncate style={{ flex: 1, lineHeight: "22px" }}>
          {node.name}
        </Text>
      </UnstyledButton>
    );
  }

  // For directories:
  // - Chevron click: expand/collapse
  // - Name double-click: drill down
  return (
    <>
      <div
        style={{ ...rowStyle, cursor: "default" }}
        onMouseEnter={(e) => { e.currentTarget.style.background = "var(--mantine-color-default-hover)"; }}
        onMouseLeave={(e) => { e.currentTarget.style.background = isSelected ? "var(--mantine-color-blue-light)" : "transparent"; }}
      >
        <span
          onClick={(e) => { e.stopPropagation(); onToggle(node.path); }}
          style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", width: 20, height: 22, flexShrink: 0, cursor: "pointer", borderRadius: 3 }}
        >
          {node.expanded ? <IconChevronDown size={16} /> : <IconChevronRight size={16} />}
        </span>
        <span onDoubleClick={() => onDrillDown(node.path)} style={{ display: "inline-flex", flexShrink: 0, cursor: "pointer" }}>
          {node.expanded ? (
            <IconFolderOpen size={16} style={{ color: "var(--mantine-color-yellow-6)" }} />
          ) : (
            <IconFolder size={16} style={{ color: "var(--mantine-color-yellow-6)" }} />
          )}
        </span>
        <Text
          size="sm"
          truncate
          onDoubleClick={() => onDrillDown(node.path)}
          style={{ flex: 1, lineHeight: "22px", cursor: "pointer" }}
        >
          {node.name}
        </Text>
      </div>
      {node.expanded && node.children && (
        node.children.length === 0 ? (
          <Text size="xs" c="dimmed" style={{ paddingLeft: paddingLeft + 34 }} py={2}>
            (empty)
          </Text>
        ) : (
          node.children.map((child) => (
            <TreeItem
              key={child.path}
              node={child}
              depth={depth + 1}
              selectedFile={selectedFile}
              onToggle={onToggle}
              onSelect={onSelect}
              onDrillDown={onDrillDown}
            />
          ))
        )
      )}
    </>
  );
}

export function FileTreeSidebar({
  treeRoot,
  expandToDir,
  selectedFile,
  onSelectFile,
  onChangeTreeRoot,
  width,
  disabled,
}: FileTreeSidebarProps) {
  const [nodes, setNodes] = useState<TreeNode[]>([]);
  const [parentDir, setParentDir] = useState<string | null>(null);
  const initializedRef = useRef(false);

  const loadRoot = useCallback(async (dir: string) => {
    const { entries, parent } = await fetchDir(dir);
    setNodes(entriesToNodes(entries));
    setParentDir(parent);
  }, []);

  useEffect(() => {
    loadRoot(treeRoot);
  }, [treeRoot, loadRoot]);

  // Auto-expand the path from treeRoot down to expandToDir on first mount
  useEffect(() => {
    if (initializedRef.current || nodes.length === 0) return;
    if (!expandToDir || expandToDir === treeRoot) {
      initializedRef.current = true;
      return;
    }

    const doExpand = async () => {
      const segments: string[] = [];
      let current = expandToDir;
      while (current !== treeRoot && current.startsWith(treeRoot + "/")) {
        segments.unshift(current);
        current = current.substring(0, current.lastIndexOf("/"));
      }
      if (segments.length === 0) {
        initializedRef.current = true;
        return;
      }

      let currentNodes = [...nodes];
      for (const seg of segments) {
        const { entries } = await fetchDir(seg);
        const children = entriesToNodes(entries);
        currentNodes = findAndUpdate(currentNodes, seg, (n) => ({
          ...n,
          expanded: true,
          children,
        }));
      }
      setNodes(currentNodes);
      initializedRef.current = true;
    };

    doExpand();
  }, [nodes, expandToDir, treeRoot]);

  const handleToggle = useCallback(async (dirPath: string) => {
    setNodes((prev) => {
      const node = findNode(prev, dirPath);
      if (!node) return prev;

      if (node.expanded) {
        return findAndUpdate(prev, dirPath, (n) => ({ ...n, expanded: false }));
      }

      if (node.children !== null) {
        return findAndUpdate(prev, dirPath, (n) => ({ ...n, expanded: true }));
      }

      fetchDir(dirPath).then(({ entries }) => {
        setNodes((prev2) =>
          findAndUpdate(prev2, dirPath, (n) => ({
            ...n,
            expanded: true,
            children: entriesToNodes(entries),
          })),
        );
      });

      return findAndUpdate(prev, dirPath, (n) => ({ ...n, expanded: true }));
    });
  }, []);

  return (
    <div
      style={{
        width,
        minWidth: 180,
        display: "flex",
        flexDirection: "column",
        height: "100%",
        position: "relative",
      }}
    >
      {/* Disabled overlay when debug session is active */}
      {disabled && (
        <div
          style={{
            position: "absolute",
            inset: 0,
            zIndex: 10,
            display: "flex",
            alignItems: "flex-start",
            justifyContent: "center",
            background: "rgba(0, 0, 0, 0.6)",
            padding: "40px 16px 16px",
          }}
        >
          <Text size="xs" ta="center" style={{ color: "#f0c040" }}>
            Debug session active.
          </Text>
        </div>
      )}
      {/* Header */}
      <Text
        size="xs"
        fw={600}
        c="dimmed"
        px="sm"
        py={6}
        tt="uppercase"
        style={{ borderBottom: "1px solid var(--mantine-color-default-border)", letterSpacing: 0.5 }}
      >
        Shiplight Finder
      </Text>

      {/* File tree */}
      <ScrollArea style={{ flex: 1 }} offsetScrollbars>
        {parentDir && (
          <UnstyledButton
            onClick={() => onChangeTreeRoot(parentDir)}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 6,
              paddingLeft: 8,
              paddingRight: 8,
              paddingTop: 3,
              paddingBottom: 3,
              width: "100%",
              fontSize: 13,
              borderBottom: "1px solid var(--mantine-color-default-border)",
            }}
          >
            <IconArrowUp size={14} style={{ flexShrink: 0, color: "var(--mantine-color-dimmed)" }} />
            <Text size="sm" c="dimmed" style={{ lineHeight: "22px" }}>Go up</Text>
          </UnstyledButton>
        )}
        {nodes.map((node) => (
          <TreeItem
            key={node.path}
            node={node}
            depth={0}
            selectedFile={selectedFile}
            onToggle={handleToggle}
            onSelect={disabled ? () => {} : onSelectFile}
            onDrillDown={onChangeTreeRoot}
          />
        ))}
      </ScrollArea>
    </div>
  );
}

function findNode(nodes: TreeNode[], targetPath: string): TreeNode | null {
  for (const node of nodes) {
    if (node.path === targetPath) return node;
    if (node.children && targetPath.startsWith(node.path + "/")) {
      const found = findNode(node.children, targetPath);
      if (found) return found;
    }
  }
  return null;
}
