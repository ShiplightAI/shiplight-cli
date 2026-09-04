/**
 * shiplightConfig() — Playwright config helper
 *
 * Called in playwright.config.ts. Transpiles YAML test files and returns
 * a partial config that makes them discoverable by Playwright.
 */

import dotenv from 'dotenv';
import { defineConfig as pwDefineConfig, type PlaywrightTestConfig, type ReporterDescription } from '@playwright/test';
import { transpileAllYamlTests } from './transpile';
import { loadStagedActionEntityStores } from './cache/actionEntityCacheStore.js';
import { loadShiplightEnv, findEnvFiles } from './dotenvSource.js';
import { resolveRunId } from './runId.js';

export interface ShiplightOptions {
  /**
   * Directory to scan for .test.yaml files. Defaults to SHIPLIGHT_PROJECT_ROOT
   * (set by `shiplight test`, honoring -c/--config), else process.cwd(). When
   * invoking `playwright test` directly with `-c` pointing at a config outside
   * the cwd, pass scanDir explicitly to anchor the scan to your config directory.
   */
  scanDir?: string;
  /** Load .env file automatically (default: true). Set to false if you manage env vars yourself. */
  dotenv?: boolean;
}

/** Custom `use` options that Shiplight adds to Playwright projects. */
export interface ShiplightUseOptions {
  /** Path to an auth login script (resolved relative to project root). */
  auth?: string;
  /** Arguments passed to the auth login function. */
  args?: Record<string, unknown>;
  /** Variables available to tests via `testContext` / `$`. Maps to cloud environment variables. */
  variables?: Record<string, string | { value: string; sensitive?: boolean }>;
}

/**
 * Transpile all .test.yaml files and return a partial Playwright config.
 *
 * Generated files use the `.yaml.spec.ts` extension, which is matched by
 * Playwright's default `testMatch` pattern. If you override `testMatch` in
 * your config, make sure it includes `*.yaml.spec.ts` (or `*.spec.ts`).
 *
 * Usage in playwright.config.ts:
 * ```ts
 * import { defineConfig, shiplightConfig } from 'shiplightai';
 *
 * export default defineConfig({
 *   ...shiplightConfig(),
 *   testDir: './tests',
 * });
 * ```
 */
/**
 * Resolve the scan dir and project root for a shiplightConfig() call.
 *
 * - `projectRoot`: the true project root — the fallback base for `template:` and
 *   function references during transpilation. Honors -c/--config via
 *   SHIPLIGHT_PROJECT_ROOT (set by `shiplight test`), else process.cwd(), because
 *   at config-eval time process.cwd() is the invocation dir, not necessarily the
 *   config dir.
 * - `scanDir`: where to glob *.test.yaml, plus the base for .env discovery and
 *   the action cache. An explicit scanDir narrows it to a subfolder; otherwise it
 *   equals projectRoot.
 *
 * The two are kept SEPARATE on purpose: narrowing the scan must NOT change
 * template-reference resolution, which stays anchored to the project root.
 *
 * Exported for testing.
 */
export function resolveScanRoots(
  options: Pick<ShiplightOptions, 'scanDir'>,
  env: NodeJS.ProcessEnv,
  cwd: string,
): { scanDir: string; projectRoot: string } {
  const projectRoot = env.SHIPLIGHT_PROJECT_ROOT || cwd;
  const scanDir = options.scanDir || projectRoot;
  return { scanDir, projectRoot };
}

export function shiplightConfig(options: ShiplightOptions = {}): PlaywrightTestConfig<ShiplightUseOptions> {
  const { scanDir, projectRoot } = resolveScanRoots(options, process.env, process.cwd());

  // Load .env files walking up from the scan dir (opt out with dotenv: false)
  if (options.dotenv !== false) {
    loadDotenvWalkUp(scanDir);
  }

  // Load cached action entities from .shiplight/action-cache/ (written by orchestrator pre-step)
  const actionEntityStores = loadStagedActionEntityStores(scanDir);

  // Transpile all *.test.yaml → *.yaml.spec.ts (next to source)
  transpileAllYamlTests({ cwd: scanDir, projectRoot, actionEntityStores });

  const explicitReportDir = process.env.SHIPLIGHT_REPORT_DIR;

  // Generate a stable run ID for this invocation. Re-use if already set —
  // `shiplight test` publishes one before spawning us (so its post-test scan can
  // find this run's artifacts), and watch mode re-evaluates this config.
  const runId = resolveRunId(process.env);
  process.env.SHIPLIGHT_RUN_ID = runId;
  const standardReporters: ReporterDescription[] = [];

  if (process.env.PLAYWRIGHT_JSON_OUTPUT_FILE) {
    standardReporters.push(['json', { outputFile: process.env.PLAYWRIGHT_JSON_OUTPUT_FILE }]);
  }

  if (explicitReportDir) {
    return {
      outputDir: `test-results/${runId}`,
      reporter: [
        ['list'],
        ['shiplightai/reporter', { outputFolder: explicitReportDir, open: 'never' }],
        ...standardReporters,
      ],
    };
  }

  return {
    outputDir: `test-results/${runId}`,
    reporter: [
      ['list'],
      ['shiplightai/reporter', {
        outputFolder: `shiplight-report/${runId}`,
        latestSymlinkDir: 'shiplight-report',
        open: 'never',
      }],
      ...standardReporters,
    ],
  };
}

/**
 * Typed wrapper around Playwright's `defineConfig` that understands Shiplight's
 * custom `use` options (`variables`, `auth`, `args`).
 *
 * Usage in playwright.config.ts:
 * ```ts
 * import { defineConfig, shiplightConfig } from 'shiplightai';
 *
 * export default defineConfig({
 *   ...shiplightConfig(),
 *   testDir: './tests',
 *   projects: [{
 *     name: 'default',
 *     use: { variables: { token: 'abc' } },
 *   }],
 * });
 * ```
 */
export function defineConfig(config: PlaywrightTestConfig<ShiplightUseOptions>, ...configs: PlaywrightTestConfig<ShiplightUseOptions>[]): PlaywrightTestConfig<ShiplightUseOptions> {
  return pwDefineConfig<ShiplightUseOptions>(config, ...configs);
}

/**
 * Two-step .env load: populate the Shiplight stash that fixture/cache
 * modules read (see dotenvSource.ts), then the conventional dotenv.config()
 * mutation so user test code reading process.env keeps working.
 */
function loadDotenvWalkUp(startDir: string): void {
  loadShiplightEnv(startDir);

  // Closest .env first — dotenv.config() doesn't overwrite already-set
  // vars, so closer files win when multiple .env files exist.
  for (const f of findEnvFiles(startDir)) {
    dotenv.config({ path: f });
  }
}

