/**
 * Port File
 *
 * Writes/reads JSON files in .shiplight/run/debug-<port>.json so that
 * external tools (e.g. MCP attach_to_browser) can discover running debugger instances.
 *
 * The file is written relative to the YAML file's project root (walking up to find
 * package.json or .shiplight/). Discovery scans from the current working directory.
 */

import * as fs from "fs";
import * as path from "path";

export interface DebuggerPortInfo {
  port: number;
  yamlFile: string;
  pid: number;
  startedAt: string;
}

const RUN_DIR = ".shiplight/run";
const FILE_PREFIX = "debug-";

/**
 * Find the project root by walking up from startDir looking for package.json or .shiplight/.
 */
function findProjectRoot(startDir: string): string | null {
  let dir = path.resolve(startDir);
  while (true) {
    if (
      fs.existsSync(path.join(dir, "package.json")) ||
      fs.existsSync(path.join(dir, ".shiplight"))
    ) {
      return dir;
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

function runDir(projectRoot: string): string {
  return path.join(projectRoot, RUN_DIR);
}

function portFilePath(projectRoot: string, port: number): string {
  return path.join(runDir(projectRoot), `${FILE_PREFIX}${port}.json`);
}

export function writePortFile(port: number, startDir: string): void {
  const projectRoot = findProjectRoot(startDir);
  if (!projectRoot) return;

  const dir = runDir(projectRoot);
  fs.mkdirSync(dir, { recursive: true });

  const info: DebuggerPortInfo = {
    port,
    yamlFile: startDir,
    pid: process.pid,
    startedAt: new Date().toISOString(),
  };
  fs.writeFileSync(portFilePath(projectRoot, port), JSON.stringify(info), "utf-8");
}

export function removePortFile(port: number, startDir: string): void {
  const projectRoot = findProjectRoot(startDir);
  if (!projectRoot) return;
  try {
    fs.unlinkSync(portFilePath(projectRoot, port));
  } catch {
    // Already removed or never written
  }
}

/**
 * Discover running debugger instances by scanning .shiplight/run/ from cwd upward.
 * Filters out stale entries whose pid is no longer running.
 */
export function discoverDebuggers(startDir?: string): DebuggerPortInfo[] {
  const projectRoot = findProjectRoot(startDir ?? process.cwd());
  if (!projectRoot) return [];

  const dir = runDir(projectRoot);
  let files: string[];
  try {
    files = fs.readdirSync(dir).filter(f => f.startsWith(FILE_PREFIX) && f.endsWith(".json"));
  } catch {
    return [];
  }

  const results: DebuggerPortInfo[] = [];
  for (const file of files) {
    const filePath = path.join(dir, file);
    try {
      const content = fs.readFileSync(filePath, "utf-8");
      const info: DebuggerPortInfo = JSON.parse(content);

      // Check if the process is still alive
      try {
        process.kill(info.pid, 0);
      } catch {
        // Process is dead — clean up stale file
        try { fs.unlinkSync(filePath); } catch {}
        continue;
      }

      results.push(info);
    } catch {
      // Malformed file, skip
    }
  }

  return results;
}
