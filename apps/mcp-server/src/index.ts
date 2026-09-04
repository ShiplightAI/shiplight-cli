/**
 * Shiplight MCP Server — CLI entry point
 *
 * Handles flags that print-and-exit (--help, --version, etc.) before
 * loading the heavy server module and its dependencies.
 */

declare const __PACKAGE_VERSION__: string;

const version =
  typeof __PACKAGE_VERSION__ !== "undefined" ? __PACKAGE_VERSION__ : "unknown";

const command = process.argv[2];

if (
  process.argv.includes("--version") ||
  process.argv.includes("-v") ||
  command === "version"
) {
  const isLocal = version === "unknown" || process.argv[1]?.includes("/monots");
  process.stdout.write(
    `shiplight-mcp ${isLocal ? `${version}-local` : version}\n`
  );
  process.exit(0);
}

if (process.argv.includes("--chrome-extension-path")) {
  const extPath = new URL("../chrome-extension", import.meta.url).pathname;
  process.stdout.write(extPath + "\n");
  process.exit(0);
}

if (
  process.argv.includes("--help") ||
  process.argv.includes("-h") ||
  command === "help"
) {
  process.stdout.write(`shiplight-mcp ${version}

Usage: shiplight-mcp [options]

Options:
  -v, --version               Print version and exit
  -h, --help                  Show this help message and exit
  --debug                     Enable debug mode (exposes additional relay tools)
  --chrome-extension-path     Print path to bundled Chrome extension and exit

Environment variables:
  PWDEBUG                     Set to "console" for semantic locator generation
  SHIPLIGHT_RELAY_PORT        Port for Chrome extension relay server
  TERMINATION_TIMEOUT         Session termination timeout in ms
`);
  process.exit(0);
}

// Start server (heavy imports happen inside this module)
const { startServer } = await import("./server.js");
await startServer();
