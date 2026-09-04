/**
 * Debug Command
 *
 * Launches the visual debugger for YAML test files.
 * Starts a local HTTP server immediately (for UI + YAML editing),
 * then lazily creates the appropriate sandbox on first debug action.
 *
 * Accepts an optional path argument:
 *   - File path: opens that file and browses its parent directory
 *   - Directory path: browses that directory (no file pre-selected)
 *   - No argument: browses the current working directory
 */

import * as fs from "fs";
import * as path from "path";
import { writePortFile, removePortFile } from "../debugger/portFile.js";
import { findAvailablePort } from "../debugger/portUtils.js";
import { readShiplightEnv } from "../dotenvSource.js";

const DEFAULT_PORT = 6174;
const PORT_PROBE_COUNT = 10;

function red(text: string): string {
  return process.stderr.isTTY ? `\x1b[31m${text}\x1b[0m` : text;
}

const EMPTY_YAML_TEMPLATE = (url: string) =>
  `goal: New test
base_url: ${url}
statements:
  - URL: /
`;

export interface DebugArgs {
  targetPath?: string;
  port: number;
  portExplicit: boolean;
  startingUrl?: string;
  createNew: boolean;
  noBrowser: boolean;
  headed: boolean;
  offline: boolean;
  /** `--help`/`-h` seen — the caller prints usage and exits. */
  help: boolean;
}

/**
 * Parse `shiplight debug` argv into options. Pure and exported for testing —
 * `startDebugger` itself starts a server and cannot be unit-tested, but the flag
 * handling (including `--offline`, which drives the tier pre-flight) can. `--help`
 * is returned as a flag rather than exiting here, so this stays side-effect-free.
 */
export function parseDebugArgs(args: string[]): DebugArgs {
  const out: DebugArgs = {
    port: DEFAULT_PORT,
    portExplicit: false,
    createNew: false,
    noBrowser: true,
    headed: false,
    offline: false,
    help: false,
  };

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--port" && args[i + 1]) {
      out.port = parseInt(args[i + 1], 10);
      out.portExplicit = true;
      i++;
    } else if (args[i] === "--url" && args[i + 1]) {
      out.startingUrl = args[i + 1];
      i++;
    } else if (args[i] === "--new") {
      out.createNew = true;
    } else if (args[i] === "--open") {
      out.noBrowser = false;
    } else if (args[i] === "--no-open") {
      out.noBrowser = true;
    } else if (args[i] === "--headed") {
      out.headed = true;
    } else if (args[i] === "--offline") {
      out.offline = true;
    } else if (args[i] === "--help" || args[i] === "-h") {
      out.help = true;
    } else if (!args[i].startsWith("--")) {
      out.targetPath = args[i];
    }
  }
  return out;
}

export async function startDebugger(args: string[]) {
  const { targetPath, port: parsedPort, portExplicit, startingUrl, createNew, noBrowser, headed, offline, help } =
    parseDebugArgs(args);
  let port = parsedPort;
  if (help) {
    printUsage();
    process.exit(0);
  }

  // Resolve initialDir and initialFile from the target path
  let initialDir: string;
  let initialFile: string | undefined;

  if (targetPath) {
    const resolved = path.resolve(targetPath);

    if (fs.existsSync(resolved) && fs.statSync(resolved).isDirectory()) {
      // Directory mode
      initialDir = resolved;
    } else {
      // File mode (existing or to-be-created with --new)
      initialDir = path.dirname(resolved);
      initialFile = resolved;
    }
  } else {
    // No argument: use current working directory
    initialDir = process.cwd();
  }

  // --new mode: create the YAML file if it doesn't exist
  if (createNew && initialFile && !fs.existsSync(initialFile)) {
    const dir = path.dirname(initialFile);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    const url = startingUrl || "https://example.com";
    fs.writeFileSync(initialFile, EMPTY_YAML_TEMPLATE(url), "utf-8");
    console.log(`Created new test file: ${initialFile}`);
  }

  // Validate file exists if one was specified
  if (initialFile && !fs.existsSync(initialFile)) {
    console.error(`Error: File not found: ${initialFile}`);
    console.error(`Hint: Use --new to create a new test file.`);
    process.exit(1);
  }

  // Detect Playwright config
  const { findPlaywrightConfig } =
    await import("../debugger/playwrightDebug.js");

  const configPath = findPlaywrightConfig(initialDir);
  const projectRoot = configPath ? path.dirname(configPath) : initialDir;

  // Load .env from the project root (where playwright.config.ts lives)
  // so API keys defined there are available to the agent.
  // override: true ensures project .env takes precedence over shell env vars
  // (e.g. a stale OPENAI_API_KEY in the shell won't shadow the project's key).
  const dotenv = await import("dotenv");
  dotenv.config({ path: path.join(projectRoot, ".env"), override: true });

  if (!configPath) {
    console.error("Error: No Playwright config found in " + initialDir);
    console.error("A Playwright config (playwright.config.ts) is required for the debugger.");
    process.exit(1);
  }

  // Pre-flight: LLM tier selection (design §2). Resolve the org-settings map once
  // and inject it into process.env, from which every inner `playwright test`
  // process the manager spawns inherits it (spawnPlaywrightProcess spreads
  // `...process.env`). Pinned for the debugger's lifetime rather than re-fetched
  // per session — a deliberate simplification: the debugger is an interactive,
  // one-test-at-a-time tool, not a long billed suite, so the determinism concern
  // that motivates per-run pinning does not bite here.
  //
  // Unlike `shiplight test`, a rejected token does NOT abort here (see
  // resolveTierEnvForDebugger). Resolve the fetch's env from the SAME walk-up
  // `.env` chain the inner `playwright test` process uses (config.ts →
  // loadShiplightEnv), so a token/tier declared in a parent-dir `.env` is seen
  // here too and the debugger cannot fetch under a different token than the
  // session runs under. The resulting map is injected back into process.env so
  // inner sessions inherit it.
  {
    const { resolveTierEnvForDebugger } = await import("../orgSettings.js");
    const { envPatch, info, warnings } = await resolveTierEnvForDebugger(
      readShiplightEnv(projectRoot),
      { offline },
    );
    Object.assign(process.env, envPatch);
    for (const line of info) console.log(`[shiplight] ${line}`);
    for (const warning of warnings) console.warn(`[shiplight] ${warning}`);
  }

  // Start the unified debugger server (serves UI + YAML API + manager-backed proxy)
  const { startDebuggerServer } = await import("../debugger/index.js");

  if (initialFile) {
    console.log(`Starting debugger for: ${initialFile}`);
  } else {
    console.log(`Starting debugger in: ${initialDir}`);
  }
  if (configPath) {
    console.log(`Using Playwright config: ${configPath}`);
  }

  // Probe for a free port only on the default path; --port respects the user's exact choice.
  if (!portExplicit) {
    const available = await findAvailablePort(DEFAULT_PORT, PORT_PROBE_COUNT);
    if (available === null) {
      console.error(
        red(
          `Error: No available port found in range ${DEFAULT_PORT}-${DEFAULT_PORT + PORT_PROBE_COUNT - 1}.`
        )
      );
      console.error(
        red("Close some debugger sessions, or pass --port <number> to pick a specific port.")
      );
      process.exit(1);
    }
    if (available !== DEFAULT_PORT) {
      console.log(`Port ${DEFAULT_PORT} is in use; using port ${available} instead.`);
    }
    port = available;
  }

  let server;
  try {
    server = await startDebuggerServer({
      initialDir,
      initialFile,
      projectRoot,
      port,
      headed,
    });
  } catch (err: any) {
    if (err?.code === "EADDRINUSE") {
      console.error(red(`Error: Port ${port} is already in use.`));
      const hint = portExplicit
        ? "Try a different port number, or omit --port to let shiplight auto-pick one."
        : "All probed ports became busy after selection — re-run shiplight debug to retry.";
      console.error(red(hint));
      process.exit(1);
    }
    throw err;
  }

  writePortFile(port, initialDir);

  console.log(`Debugger running at: ${server.url}`);
  console.log("");
  console.log("Press Ctrl+C to stop.");

  // Open browser
  if (!noBrowser) {
    try {
      const { default: open } = await import("open");
      await open(server.url);
    } catch {
      // open package not available — user can navigate manually
    }
  }

  // Graceful shutdown
  let shuttingDown = false;
  const shutdown = async () => {
    if (shuttingDown) {
      console.log("\nForce exiting...");
      process.exit(1);
    }
    shuttingDown = true;
    console.log("\nShutting down...");

    const forceExit = setTimeout(() => {
      console.error("Cleanup timed out, force exiting.");
      process.exit(1);
    }, 5000);

    try {
      removePortFile(port, initialDir);
      await server.close();
    } catch {
      // Ignore cleanup errors
    }
    clearTimeout(forceExit);
    process.exit(0);
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

function printUsage() {
  console.log(
    "Usage: shiplight debug [file-or-dir] [options]"
  );
  console.log("");
  console.log("Arguments:");
  console.log("  file-or-dir              YAML test file or directory (default: cwd)");
  console.log("");
  console.log("Options:");
  console.log("  --port <number>          Server port (default: 6174)");
  console.log("  --url <url>              Override starting URL for the test");
  console.log("  --new                    Create a new test file if it doesn't exist");
  console.log("  --open                   Auto-open the debugger in your browser");
  console.log("  --no-open                Don't auto-open the browser (default)");
  console.log("  --headed                 Force a visible Chromium window (overrides use.headless)");
  console.log("  --offline                Skip the pre-flight call to Shiplight cloud for org");
  console.log("                           settings. Uses built-in model defaults. (SHIPLIGHT_OFFLINE=1)");
  console.log("  -h, --help               Show this help message");
  console.log("");
  console.log("Examples:");
  console.log("  shiplight debug                              # browse cwd");
  console.log("  shiplight debug tests/                       # browse tests/ directory");
  console.log("  shiplight debug tests/login.test.yaml        # open specific file");
  console.log(
    "  shiplight debug tests/login.test.yaml --port 8080"
  );
  console.log(
    "  shiplight debug tests/checkout.test.yaml --new --url https://myapp.com/checkout"
  );
}
