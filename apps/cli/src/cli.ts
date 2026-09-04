import { applyShiplightEnvToProcess } from "./dotenvSource.js";
import { checkGlobalInstall, checkVersionFreshness } from "./versionCheck.js";
import { flushTelemetry, trackCommand } from "./telemetry.js";

// Resolve the same `.env` view the spawned Playwright process will resolve:
// walk up to the project root, closest file wins, and let `.env` override the
// shell (FR-008). This replaces a bare `dotenv.config()`, which read only the
// cwd and let the shell win — so the parent and the child could disagree about
// SHIPLIGHT_API_TOKEN. When they did, parent-side readers that resolve against
// raw `process.env` (the action-entity cache, the org-settings pre-flight) saw
// no token and silently downgraded the action cache to Local while the child
// ran authenticated. Assigning onto `process.env` keeps those readers working
// unchanged while giving them the child's view (FR-020, SC-009).
applyShiplightEnvToProcess(process.cwd());

// Block global installs, or warn if one coexists alongside the local install.
checkGlobalInstall();

// Kick off the version freshness check in the background. Fire-and-forget:
// never block command dispatch on network I/O. The warning prints whenever
// the check resolves — typically before the command starts on a warm cache,
// or mid-run on a cold cache. For short-lived commands (--version, --help)
// the process may exit before the fetch completes, which is fine — those
// commands finish fast enough that a mid-flight warning has no value.
void checkVersionFreshness();

function printUsage() {
  console.log(`
Usage: shiplight <command> [options]

Commands:
  setup-api-token  Authenticate with Shiplight and write SHIPLIGHT_API_TOKEN to .env
  create <path>    Scaffold a new Shiplight test project at <path>
  test [args...]   Run Playwright tests (delegates to npx playwright test)
  transpile [glob] Transpile YAML test files to Playwright specs (default: **/*.test.yaml)
  inspect <file>   Parse a YAML test file and output TestFlow JSON
  spec <topic>     Print an authoring reference (topics: yaml, actions)
  debug <file>     Launch the visual debugger for a YAML test file
  report [folder]  Regenerate HTML report from saved artifacts (default: ./shiplight-report)
  report --merge   Merge multiple shard report directories into one combined report

Options:
  --help, -h       Show this help message
  --version, -v    Show version number

Examples:
  shiplight setup-api-token
  shiplight create ./my-tests
  shiplight test --headed
  shiplight transpile
  shiplight transpile "tests/**/*.test.yaml"
  shiplight transpile --strict
  shiplight spec yaml
  shiplight debug tests/login.test.yaml
`);
}

const command = process.argv[2];

// Anonymous usage telemetry: one fire-and-forget event naming the subcommand.
// Started before dispatch so a long-running command's request completes while
// it works; the `flushTelemetry()` awaits below cover the short ones, where
// the exit would otherwise cancel the request mid-flight.
trackCommand(command);

switch (command) {
  case "setup-api-token": {
    const { runSetupApiToken } = await import("./commands/setupApiToken.js");
    await runSetupApiToken(process.argv.slice(3));
    break;
  }
  // Two dispatch patterns coexist here: create/transpile/spec RETURN their
  // exit code (so their error paths are unit-testable without process.exit)
  // and this switch performs the exit; the remaining commands predate that
  // refactor and still own their own process.exit internally.
  case "create": {
    const { runCreate } = await import("./commands/create.js");
    const code = await runCreate(process.argv.slice(3));
    await flushTelemetry();
    process.exit(code);
    break;
  }
  case "debug": {
    const { startDebugger } = await import("./commands/debug.js");
    await startDebugger(process.argv.slice(3));
    break;
  }
  case "test": {
    const { runTests } = await import("./commands/test.js");
    await runTests(process.argv.slice(3));
    break;
  }
  case "report": {
    const { runReport } = await import("./commands/report.js");
    await runReport(process.argv.slice(3));
    break;
  }
  case "transpile": {
    const { runTranspile } = await import("./commands/transpile.js");
    const code = await runTranspile(process.argv.slice(3));
    await flushTelemetry();
    process.exit(code);
    break;
  }
  case "inspect": {
    const { runInspect } = await import("./commands/inspect.js");
    await runInspect(process.argv.slice(3));
    break;
  }
  case "spec": {
    const { runSpec } = await import("./commands/spec.js");
    const code = await runSpec(process.argv.slice(3));
    await flushTelemetry();
    process.exit(code);
    break;
  }
  case "--version":
  case "-v": {
    // `require` is provided by the CLI bundle banner via createRequire(import.meta.url)
    const ver = require("../package.json").version;
    const suffix = process.env.SHIPLIGHT_BUILD_TAG ? `-${process.env.SHIPLIGHT_BUILD_TAG}` : "";
    console.log(`${ver}${suffix}`);
    break;
  }
  case "--help":
  case "-h":
    printUsage();
    break;
  default:
    if (command) {
      console.error(`Unknown command: ${command}\n`);
    }
    printUsage();
    await flushTelemetry();
    process.exit(command ? 1 : 0);
}

// Commands that return rather than exiting internally land here. The flush is
// a no-op unless their telemetry request is still in flight.
await flushTelemetry();
