/**
 * Build the debugger UI bundles that ship inside the CLI tarball.
 *
 * Invoked from tsup's `onSuccess` after tsup wipes dist/. The two vite configs
 * write straight into apps/cli/dist/static-embedded/ and apps/cli/dist/static/.
 *
 * This exists as a script rather than a `cd ... && vite build` chain in
 * onSuccess: tsup hands that string to Node as a single module specifier, and
 * path normalisation eats the `..` segments, so the chain resolved to a
 * nonexistent `apps/cli/scripts/packages/debugger-ui` and the build died before
 * running anything.
 */

import { spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const debuggerUiDir = resolve(here, "../../../packages/debugger-ui");

const configs = ["vite.debugger.config.ts", "vite.debugger-shell.config.ts"];

for (const config of configs) {
  const result = spawnSync("pnpm", ["exec", "vite", "build", "--config", config], {
    cwd: debuggerUiDir,
    stdio: "inherit",
    env: process.env,
  });
  if (result.error) {
    console.error(`[debugger-ui] could not run vite for ${config}:`, result.error.message);
    process.exit(1);
  }
  if (result.status !== 0) {
    console.error(`[debugger-ui] vite build failed for ${config}`);
    process.exit(result.status ?? 1);
  }
}
