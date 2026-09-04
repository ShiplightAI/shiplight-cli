/**
 * Shared types for the CLI debugger multi-tab shell.
 */

export type SessionStatus = "idle" | "starting" | "running" | "ended";

/**
 * Wire shape returned by GET /api/debugger/sessions and POST /api/debugger/sessions.
 * Mirrors `DebuggerSession` in apps/cli/src/debugger/manager.ts (subset the UI needs).
 */
export interface SessionBrief {
  sessionId: string;
  yamlPath: string;
  startedAt: string;
  status: SessionStatus;
}

export interface FileEntry {
  name: string;
  type: "file" | "directory";
  path: string;
}

export interface FilesResponse {
  dir: string;
  parent: string | null;
  entries: FileEntry[];
  initialFile: string | null;
  projectRoot: string;
}
