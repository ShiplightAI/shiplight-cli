/**
 * Playwright Fixture — provides `agent` (WebAgent) to all tests.
 *
 * Generated .yaml.spec.ts files import `test` and `expect` from this module
 * instead of directly from @playwright/test. The `agent` fixture handles
 * SDK configuration and WebAgent creation.
 *
 * Variables are loaded from `use: { variables: { ... } }` in playwright.config.ts.
 * This maps to cloud environments — one project = one environment.
 *
 * Per-test account auth (Case 3): when a test sets `account` via test.use(),
 * the `context` fixture calls the auth_login module's login(credentials)
 * function, which returns a storageState file path. The login function owns
 * the full lifecycle: login flow, caching, and expiration.
 *
 * For shared accounts (Case 1 & 2), use Playwright's standard setup project
 * with auth.setup.ts — no Shiplight fixture involvement needed.
 *
 * NOTE: We use dynamic import() for the SDK because Playwright loads all files
 * via CJS require(). Dynamic import() inside the async fixture function avoids
 * CJS/ESM incompatibility. The module is cached after the first import.
 */

import * as path from 'path';
import * as fs from 'fs';
import { pathToFileURL } from 'url';
import { test as base, expect, chromium, type Browser, type BrowserContext, type LaunchOptions, type Page, type TestInfo, type Video } from '@playwright/test';
import {
  buildPersistentLaunchOptions,
  loadAndExtendCookies,
  prepareExtensionLaunch,
} from './extension-helpers.js';
import { openActionPopup } from './extension-action-popup.js';
import { INIT_SCRIPT, discoverChromiumCdpUrl, registerBrowser, unregisterBrowser, type WebAgent } from 'sdk-core';
import type { VariableStore } from 'shiplight-types';
import type { ShiplightUseOptions } from './config.js';
import { getShiplightEnv } from './dotenvSource.js';

// ============================================================================
// Account Types
// ============================================================================

/**
 * Per-test auth: path to a login script + optional args passed to the login function.
 * A relative auth path is resolved against the project root (the directory holding
 * playwright.config.*), not process.cwd() — see resolveProjectRoot for why the two
 * can diverge, and resolveUserPath for the fallback to the old testDir anchor.
 * The login module must export a login(args, browser?) function that performs the
 * login flow, caches the storageState, and returns the file path. The fixture passes
 * its shared browser instance — the login function must NOT close it, only its context.
 *
 * Usage in playwright.config.ts:
 *   use: {
 *     auth: './auth.login.ts',
 *     args: { username: 'admin@example.com', password: '{{ADMIN_PASSWORD}}' },
 *   }
 */
export interface AuthSpec {
  auth: string;
  args?: Record<string, unknown>;
}

// ============================================================================
// Project Root Resolution
// ============================================================================

/**
 * Resolve the project root used to anchor relative file paths a test declares —
 * `auth`, `extensionDir`, `userDataDir` and `extensionStorageState`. The
 * `upload_file` action's `paths` are NOT anchored here; they keep the older
 * rootDir anchor, see resolveTestDataDir for why.
 *
 * Playwright does NOT chdir to the project root: `process.cwd()` is the directory
 * the test command was invoked from, which is not guaranteed to equal the project
 * root. It diverges whenever the run is launched from elsewhere — e.g.
 * `playwright test --config sub/playwright.config.ts` from a parent dir, or a
 * monorepo invocation pointing at a sub-package config. Anchoring uploads to
 * `process.cwd()` breaks in exactly those cases.
 *
 * The anchor is the directory holding `playwright.config.*`, taken from
 * `testInfo.config.configFile`.
 *
 * This deliberately does NOT use `testInfo.config.rootDir`. Despite the name,
 * rootDir is not the project root: Playwright computes it as
 * `path.resolve(configDir, userConfig.testDir) || configDir`, so any config
 * carrying the conventional `testDir: './tests'` makes rootDir the *test*
 * directory. Anchoring there resolved `extensionDir: ./dist` to
 * `<root>/tests/dist` and left the user with a 2-minute browser-launch timeout
 * and no diagnostic (issue #2208). rootDir remains the fallback for runs with
 * no config file, where it equals the directory Playwright started from.
 */
export function resolveProjectRoot(testInfo: Pick<TestInfo, 'config'>): string {
  // configFile is '' (not undefined) when the run had no config file.
  const configFile = testInfo.config?.configFile;
  if (configFile) return path.dirname(configFile);
  return testInfo.config?.rootDir ?? process.cwd();
}

/**
 * The anchor relative user paths used BEFORE the fix above — Playwright's
 * `config.rootDir`, i.e. the testDir. Feeds resolveUserPath's compatibility
 * fallback and resolveTestDataDir; deliberately NOT exported, so nothing
 * outside this module can start anchoring to it directly.
 */
function resolveLegacyProjectRoot(testInfo: Pick<TestInfo, 'config'>): string {
  return testInfo.config?.rootDir ?? process.cwd();
}

/**
 * The anchor for the `upload_file` action's relative `paths`, which the SDK
 * joins against the agent context's `testDataDir`.
 *
 * Deliberately still `rootDir`, unlike every other user path. The others name a
 * FILE, so resolveUserPath can check where it actually is and keep the old
 * location working. This one is a bare DIRECTORY — the filename only appears
 * later, inside sdk-core, where the join has no fallback and no existence check
 * (see agentFile.ts and agentServices.getTestDataFilePath). There is nothing to
 * probe at fixture time, so moving this anchor would silently relocate every
 * relative upload fixture with no way to rescue it.
 *
 * For projects with no `testDir`, rootDir already equals the config directory,
 * so this is identical to resolveProjectRoot and nothing is left behind by the
 * #2208 fix. Moving the upload anchor needs its own change, with a fallback
 * threaded into sdk-core's join and a deprecation period.
 */
export function resolveTestDataDir(testInfo: Pick<TestInfo, 'config'>): string {
  return resolveLegacyProjectRoot(testInfo);
}

/**
 * Resolve a user-provided relative path (auth script, extensionDir, userDataDir,
 * extensionStorageState) against the project root, falling back to the old
 * rootDir anchor when the file lives only there.
 *
 * Correcting the anchor (see resolveProjectRoot) would otherwise break every
 * project that had these files under `testDir` — they resolved correctly before
 * and would start failing on an unchanged test. The new location wins whenever
 * something is actually there, so the fallback cannot shadow a correct path; it
 * only rescues layouts that used to work. When neither location has the file,
 * the project-root path is returned so the resulting error names where the file
 * is now expected.
 */
export function resolveUserPath(userPath: string, projectRoot: string, legacyRoot: string): string {
  const resolved = path.resolve(projectRoot, userPath);
  if (path.resolve(legacyRoot) === path.resolve(projectRoot)) return resolved;
  if (fs.existsSync(resolved)) return resolved;

  const legacyResolved = path.resolve(legacyRoot, userPath);
  if (legacyResolved !== resolved && fs.existsSync(legacyResolved)) {
    console.warn(
      `[fixture] "${userPath}" was found at "${legacyResolved}" but not at "${resolved}". ` +
      'Relative paths now resolve against the project root (the directory holding playwright.config.*) ' +
      'rather than testDir. Move the file or make the path explicit — this fallback will be removed.',
    );
    return legacyResolved;
  }

  return resolved;
}

// ============================================================================
// Auth Helper
// ============================================================================

/**
 * Calls the auth module's login(args, browser) function.
 * The login function is responsible for performing the login flow,
 * caching/expiring storageState, and returning the path to a storageState JSON file.
 *
 * The browser instance is passed so the login script can create a context on the
 * shared browser process instead of launching its own — cheaper when many accounts
 * log in concurrently. The login script must NOT close the browser, only its context.
 *
 * The module is cached by Node's module system after the first import,
 * so multiple tests sharing the same auth path reuse the same instance.
 */
export async function resolveAuthState(
  spec: AuthSpec,
  browser?: Browser,
  baseURL?: string,
  projectRoot: string = process.cwd(),
  legacyRoot: string = projectRoot,
): Promise<string> {
  // Resolve relative to the project root (the directory holding
  // playwright.config.*), not this file. legacyRoot keeps scripts that still
  // sit under the old testDir anchor working — see resolveUserPath.
  const resolved = resolveUserPath(spec.auth, projectRoot, legacyRoot);
  // Node.js ESM rejects bare absolute paths on Windows ("C:\" is parsed as a
  // URL scheme). Convert to a file:// URL so the ESM loader accepts it on all platforms.
  const authModule = await import(pathToFileURL(resolved).href);
  const loginFn = authModule.login || authModule.default;
  if (typeof loginFn !== 'function') {
    throw new Error(
      `auth module "${spec.auth}" must export a login(args, browser?) function that returns a storageState file path`,
    );
  }

  const args = { ...spec.args };
  if (baseURL && !args.baseUrl) {
    args.baseUrl = baseURL;
  }

  const stateFile = await loginFn(args, browser);
  if (typeof stateFile !== 'string') {
    throw new Error(
      `auth module "${spec.auth}" login() must return a storageState file path (got ${typeof stateFile})`,
    );
  }
  return stateFile;
}

// ============================================================================
// Video Helpers
// ============================================================================

/** Whether to record video based on the Playwright video config value. */
function shouldRecord(video: unknown): boolean {
  if (!video || video === 'off') return false;
  return true;
}

// ============================================================================
// Context option merging
// ============================================================================

/**
 * Standard Playwright context-option `use:` keys whose resolved (per-test aware)
 * values we overlay onto `testInfo.project.use`. Must stay identical to the
 * fixture-arg destructure and the `resolvedContextOptions` object in the
 * `context` fixture below — the drift guard test
 * (fixture.contextOptions.test.ts) asserts this set, together with
 * EXCLUDED_CONTEXT_OPTION_KEYS, equals the full set Playwright actually resolves.
 */
export const HANDLED_CONTEXT_OPTION_KEYS = [
  'acceptDownloads', 'baseURL', 'bypassCSP', 'colorScheme', 'deviceScaleFactor',
  'extraHTTPHeaders', 'geolocation', 'hasTouch', 'httpCredentials', 'ignoreHTTPSErrors',
  'isMobile', 'javaScriptEnabled', 'locale', 'offline', 'permissions', 'proxy',
  'serviceWorkers', 'timezoneId', 'userAgent', 'viewport',
] as const;

/**
 * Context-option keys Playwright resolves that we deliberately do NOT overlay:
 * - `storageState`: the fixture's auth system owns it (see resolveAuthState).
 * - `contextOptions`: raw escape-hatch object, left to flow through unchanged.
 * - `clientCertificates`: specially resolved by Playwright; left untouched.
 */
export const EXCLUDED_CONTEXT_OPTION_KEYS = [
  'storageState', 'contextOptions', 'clientCertificates',
] as const;

/**
 * Context options Playwright rejects when `viewport` is `null` (no fixed
 * viewport / `noDefaultViewport`). Each entry's `conflicts` predicate mirrors
 * the exact condition in Playwright's `validateBrowserContextOptions`:
 *   - `deviceScaleFactor`: throws when `!== void 0` (any defined value).
 *   - `isMobile`: throws when `!!isMobile` (any truthy value).
 * The drift guard test asserts these keys stay in sync with that function, so a
 * future Playwright that adds a new `viewport: null` conflict fails loudly
 * instead of crashing context creation unguarded.
 */
export const VIEWPORT_INCOMPATIBLE_OPTIONS: ReadonlyArray<{
  key: string;
  conflicts: (value: unknown) => boolean;
}> = [
  { key: 'deviceScaleFactor', conflicts: (v) => v !== undefined },
  { key: 'isMobile', conflicts: (v) => !!v },
];

/**
 * Resolve the `viewport: null` ⇄ emulation conflict that Playwright rejects.
 *
 * An explicit `viewport: null` (no fixed viewport, for responsive testing) is
 * incompatible with `deviceScaleFactor` / `isMobile: true` — `browser.newContext`
 * and `launchPersistentContext` THROW on the combination. `viewport: null` is the
 * more specific, intentional per-test signal, so we honor it and drop the
 * incompatible emulation options (e.g. a project sets `deviceScaleFactor: 2`
 * globally and a single test wants a responsive `viewport: null`).
 *
 * Mutates `options` in place; returns the names of the keys that were dropped
 * (so the caller can warn). A no-op unless `options.viewport === null`.
 */
export function dropViewportIncompatibleOptions(options: Record<string, unknown>): string[] {
  if (options.viewport !== null) return [];
  const dropped: string[] = [];
  for (const { key, conflicts } of VIEWPORT_INCOMPATIBLE_OPTIONS) {
    if (conflicts(options[key])) {
      delete options[key];
      dropped.push(key);
    }
  }
  return dropped;
}

/**
 * Merge the project-level `use: { ... }` with the per-test context options
 * Playwright resolved for THIS test.
 *
 * Why this is needed: the Shiplight `context` fixture overrides Playwright's
 * built-in `context` fixture and builds context options from
 * `testInfo.project.use`. That object only carries the PROJECT-level `use:`
 * block — it does NOT contain a per-test `test.use({ ... })` (which is exactly
 * what the transpiled YAML `use:` block emits). When the project sets a context
 * option (e.g. `viewport: 1280x720`), it pre-seeds that key, and Playwright's
 * fill-missing merge (`runBeforeCreateBrowserContext`, which only fills keys NOT
 * already present) can then never apply the per-test value. Options the project
 * did NOT set got filled from the per-test values, so they appeared to work —
 * only project-set keys (viewport, in the typical config) were silently dropped.
 *
 * `resolved` holds the values of Playwright's standard context-option fixtures
 * (viewport, colorScheme, locale, isMobile, ...). Those honor the full override
 * chain (file-level test.use() > project use: > defaults), so applying them over
 * the project use restores the documented precedence for every context option.
 * Keys resolved to `undefined` are skipped so we never inject options the test
 * never asked for.
 *
 * Finally, `dropViewportIncompatibleOptions` resolves the `viewport: null` ⇄
 * emulation conflict that Playwright would otherwise throw on.
 */
export function mergeResolvedContextOptions(
  projectUse: Record<string, unknown>,
  resolved: Record<string, unknown>,
): Record<string, unknown> {
  const merged: Record<string, unknown> = { ...projectUse };
  for (const [key, value] of Object.entries(resolved)) {
    // `null` is meaningful (e.g. viewport: null = no fixed viewport) and is kept;
    // only `undefined` (option unset) is skipped.
    if (value !== undefined) merged[key] = value;
  }

  const dropped = dropViewportIncompatibleOptions(merged);
  if (dropped.length > 0) {
    console.warn(
      `[fixture] "viewport: null" (no fixed viewport) is incompatible with ` +
      `${dropped.join(' and ')}; dropping ${dropped.length > 1 ? 'them' : 'it'} ` +
      `so the browser context can be created.`,
    );
  }

  return merged;
}

/** Whether to retain the video based on the config value and test outcome. */
function shouldRetainVideo(video: unknown, testInfo: TestInfo): boolean {
  if (!video || video === 'off') return false;
  if (video === 'on') return true;
  if (video === 'retain-on-failure') {
    return testInfo.status !== testInfo.expectedStatus;
  }
  if (video === 'on-first-retry') {
    return testInfo.retry > 0;
  }
  // Object form { mode: '...' } or unknown truthy — retain
  if (typeof video === 'object' && video !== null && 'mode' in video) {
    return shouldRetainVideo((video as { mode: string }).mode, testInfo);
  }
  return true;
}

/**
 * Handle video files after context.close() has finalized them.
 * IMPORTANT: video.path() and video.delete() both await an internal artifact
 * promise that only resolves during context.close(). Calling them before
 * context.close() causes a deadlock. So we collect video references first,
 * close the context, then process videos.
 */
async function handleVideosAfterClose(
  videos: Video[],
  video: unknown,
  testInfo: TestInfo,
): Promise<void> {
  const retain = shouldRetainVideo(video, testInfo);
  for (const videoObj of videos) {
    try {
      if (retain) {
        const videoPath = await videoObj.path();
        await testInfo.attach('video', { path: videoPath, contentType: 'video/webm' });
      } else {
        await videoObj.delete();
      }
    } catch (err) {
      // Video may not have produced any frames, or disk/permission error
      console.warn('[fixture] Failed to process video:', err);
    }
  }
}

// ============================================================================
// SDK Loader
// ============================================================================

// Cache the SDK module so dynamic import() only runs once across all tests
let sdkModule: typeof import('sdk-core') | undefined;

async function loadSdk(): Promise<typeof import('sdk-core')> {
  if (sdkModule) return sdkModule;
  sdkModule = await import('sdk-core');
  return sdkModule;
}

// ============================================================================
// Fixtures
// ============================================================================

/**
 * TestContext — Proxy-backed object for reading/writing runtime variables.
 * Supports property-style access: testContext.myVar = 'value' / const v = testContext.myVar
 * Shared with the agent's VariableStore so $variableName in YAML resolves the same values.
 */
export interface TestContext {
  /** @internal Shared VariableStore instance — used by the agent fixture */
  readonly __variableStore: VariableStore;
  get(key: string): any;
  set(key: string, value: any, sensitive?: boolean): void;
  getAll(): Record<string, any>;
  [key: string]: any;
}

const RESERVED_PROPS = new Set(['get', 'set', 'getAll', 'has', '__variableStore']);

export function createTestContext(variableStore: VariableStore): TestContext {
  const ctx: TestContext = {
    __variableStore: variableStore,
    get(key: string) { return variableStore.get(key); },
    set(key: string, value: any, sensitive = false) { variableStore.set(key, value, sensitive); },
    getAll() { return variableStore.getAll(); },
  };

  return new Proxy(ctx, {
    get(target, prop, receiver) {
      if (prop in target) return Reflect.get(target, prop, receiver);
      if (typeof prop === 'string') return target.get(prop);
      return undefined;
    },
    set(target, prop, value) {
      if (typeof prop !== 'string') return Reflect.set(target, prop, value);
      if (RESERVED_PROPS.has(prop)) return Reflect.set(target, prop, value);
      target.set(prop, value);
      return true;
    },
    has(target, prop) {
      if (prop in target) return true;
      if (typeof prop === 'string') return variableStore.has?.(prop) ?? false;
      return false;
    },
  }) as TestContext;
}

/**
 * Parse the `SHIPLIGHT_VARS_OVERRIDE` env var.
 * Returns null when unset, throws on invalid JSON or non-string values.
 */
export function parseVarsOverrideEnv(raw: string | undefined): Record<string, string> | null {
  if (!raw) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new Error(`SHIPLIGHT_VARS_OVERRIDE is not valid JSON: ${(err as Error).message}`);
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('SHIPLIGHT_VARS_OVERRIDE must be a JSON object');
  }
  const out: Record<string, string> = {};
  for (const [key, val] of Object.entries(parsed as Record<string, unknown>)) {
    if (typeof val !== 'string') {
      throw new Error(`SHIPLIGHT_VARS_OVERRIDE key "${key}" must be a string`);
    }
    out[key] = val;
  }
  return out;
}

/**
 * Check whether a key was declared `sensitive: true` in the resolved
 * `use.variables` declarations. Test-level overrides project-level.
 */
export function isDeclaredSensitive(
  key: string,
  projectVariables: ShiplightUseOptions['variables'],
  testVariables: ShiplightUseOptions['variables'],
): boolean {
  const check = (vars: ShiplightUseOptions['variables']): boolean | null => {
    if (!vars || !(key in vars)) return null;
    const decl = vars[key];
    if (decl && typeof decl === 'object' && 'value' in decl) {
      return decl.sensitive === true;
    }
    return false;
  };
  const testFlag = check(testVariables);
  if (testFlag !== null) return testFlag;
  const projFlag = check(projectVariables);
  if (projFlag !== null) return projFlag;
  return false;
}

/**
 * Apply CLI / env overrides (`SHIPLIGHT_VARS_OVERRIDE`) to the variable store
 * with highest priority. Sensitivity is inherited from whichever declaration
 * the key already has in project/test `use.variables`; undeclared keys are
 * stored as non-sensitive.
 *
 * Exported for testing.
 */
export function applyVarsOverride(
  variableStore: VariableStore,
  projectVariables: ShiplightUseOptions['variables'],
  testVariables: ShiplightUseOptions['variables'],
  envVar: string | undefined = process.env.SHIPLIGHT_VARS_OVERRIDE,
): void {
  const overrides = parseVarsOverrideEnv(envVar);
  if (!overrides) return;
  for (const [key, value] of Object.entries(overrides)) {
    const sensitive = isDeclaredSensitive(key, projectVariables, testVariables);
    variableStore.set(key, value, sensitive);
  }
}

/**
 * Explicit allowlist of environment variable names that Shiplight forwards
 * into sdk-core's internal `SdkConfig.env`. sdk-core is strict — it reads
 * env vars only from `SdkConfig.env`, never from `process.env` directly —
 * so this allowlist is the single point where user-visible env state
 * crosses into the agent runtime.
 *
 * Source is `.env`, not `process.env`. Reads go through
 * `getShiplightEnv()` (see `dotenvSource.ts`) so that a stale shell-level
 * `OPENAI_API_KEY` (or any other provider key) cannot silently override
 * the user's `.env` and bypass the Shiplight LLM proxy. CI runners that
 * inject secrets via env vars instead of a `.env` file are still supported
 * via the fallback in `getShiplightEnv()`.
 *
 * To add a new env var that sdk-core should honor, append it here AND make
 * sure a corresponding consumer exists in `packages/sdk-core/src`. Do NOT
 * spread `process.env` into this object — the allowlist exists so that user
 * test code cannot exfiltrate arbitrary shell state through the SDK.
 *
 * **Not on this list: `WEB_AGENT_MODEL` / `COMPUTER_USE_MODEL` /
 * `WEB_AGENT_FALLBACK_MODELS`.** Those are read by the `resolve*FromEnv`
 * helpers in `shiplight-types`, called with `getShiplightEnv()` in the agent
 * fixture below. The resolved values are passed as constructor parameters to
 * `createAgentContext`, not through `SdkConfig.env`. They do not need to be on
 * the allowlist. (`WEB_AGENT_LLM_TIMEOUT_MS` IS on the list — it is read via
 * `getSdkConfig().env` by the executor, not threaded through the context.)
 *
 * Keep in sync with the "Environment variables" section of the public
 * documentation at `docs.shiplight.ai/local/cli-reference`.
 */
export const SDK_ENV_ALLOWLIST = [
  // LLM provider API keys
  'GOOGLE_API_KEY',
  'ANTHROPIC_API_KEY',
  'OPENAI_API_KEY',
  'OPENROUTER_API_KEY',
  // Custom endpoint for OpenAI-compatible APIs (self-hosted, proxies, Ollama)
  'OPENAI_BASE_URL',
  // Route Anthropic and Google through Vertex AI
  'ANTHROPIC_MODELS_USE_VERTEXAI',
  'GOOGLE_GENAI_USE_VERTEXAI',
  'GOOGLE_CLOUD_PROJECT',
  'GOOGLE_CLOUD_LOCATION',
  // Email-extract tool (extract_email_content)
  'MAILGUN_API_KEY',
  'MAILGUN_DOMAIN',
  // Shiplight cloud token — sdk-core uses it to route LLM calls through the
  // Shiplight LLM proxy for shp_* tokens like shp_pat_* and shp_ctx_* when no
  // direct provider key is set.
  'SHIPLIGHT_API_TOKEN',
  // Override for the Shiplight API base URL (defaults to api.shiplight.ai for
  // supported shp_* tokens). Same env var the
  // other Shiplight HTTP clients (action-cache, run-upload) read; one knob
  // points the whole CLI at a different host (staging, local core-api).
  // The LLM proxy itself sits at `${base}/llm/...`.
  'SHIPLIGHT_API_URL',
  // Per-attempt web-agent LLM request timeout in ms (0 disables). Bounds a
  // hung upstream so the agent can fall over to WEB_AGENT_FALLBACK_MODELS.
  'WEB_AGENT_LLM_TIMEOUT_MS',
  // sdk-core log verbosity (debug|info|warn|error|silent).
  'SDK_LOG_LEVEL',
  // Local-testing override for the TypeScript DOM tree; falls through to
  // organization settings when unset.
  'USE_DOM_TREE_TS',
  // Testbox browser-registry endpoint. Registration is a no-op when unset.
  'OMNITERM_BROWSER_REGISTRY_URL',
] as const;

/**
 * Pick the allowlisted env vars out of a source record (defaults to the
 * Shiplight `.env` stash via `getShiplightEnv()`) and return them as a
 * plain object with empty-string fallbacks. The empty-string default is
 * deliberate — sdk-core checks `config.env?.KEY` for truthiness, and an
 * empty string is falsy, so an unset allowlisted key behaves the same as
 * an entirely missing key.
 */
export function buildSdkEnv(
  source: Record<string, string | undefined> = getShiplightEnv()
): Record<string, string> {
  const env: Record<string, string> = {};
  for (const key of SDK_ENV_ALLOWLIST) {
    env[key] = source[key] ?? '';
  }
  return env;
}

/** Require a resolved model and explain OpenRouter's explicit model format. */
export function requireWebAgentModel(
  env: Record<string, string | undefined>,
  model: string | undefined,
): string {
  if (model) return model;
  if (env.OPENROUTER_API_KEY) {
    throw new Error(
      'OPENROUTER_API_KEY requires an explicit OpenRouter model. ' +
      'Set WEB_AGENT_MODEL=openrouter:<provider>/<model> in your .env file.',
    );
  }
  throw new Error('No AI model configured. Set WEB_AGENT_MODEL, GOOGLE_API_KEY, ANTHROPIC_API_KEY, OPENAI_API_KEY, SHIPLIGHT_API_TOKEN, or Google Vertex via ADC (GOOGLE_GENAI_USE_VERTEXAI=true + GOOGLE_CLOUD_PROJECT) in your .env file (or in the runner environment for CI).');
}

/**
 * Return the context's initial page when one already exists, as it does for a
 * persistent Chromium context. Service workers are not included in pages(), so
 * the existing page is safe to use as the test's main page.
 */
export async function resolveTestPage(context: BrowserContext): Promise<Page> {
  return context.pages()[0] ?? await context.newPage();
}

const persistentProfileDirs = new WeakMap<BrowserContext, string>();

type ShiplightFixtures = {
  agent: WebAgent;
  testContext: TestContext;
  $: TestContext;
  ctx: TestContext;
  account: AuthSpec | undefined;
  extensionDir: string | undefined;
  userDataDir: string | undefined;
  extensionStorageState: string | undefined;
  extensionActionPopup: Page;
  autoDismissModal: boolean;
  variables: ShiplightUseOptions['variables'];
};

// No worker-scoped fixtures today — CDP-URL discovery happens in the
// per-browser fixture below using sdk-core's `discoverChromiumCdpUrl`.
export const test = base.extend<ShiplightFixtures>({
  // Fixture option: set via test.use({ auth: './auth.login.ts', args: { ... } })
  // Legacy: also accepts test.use({ account: { auth_login: './auth.login.ts', ... } })
  account: [undefined, { option: true }],

  // Fixture option: set via test.use({ autoDismissModal: true }) or in playwright.config.ts
  // When true, uses multi-step self-healing strategy that can dismiss unexpected modals.
  autoDismissModal: [false, { option: true }],

  // Fixture option: set via test.use({ variables: { ... } }) to override project-level variables.
  // Test-level variables take precedence over project-level variables (individual keys are overridden).
  variables: [undefined, { option: true }],

  // Fixture option: set via test.use({ extensionDir: './chrome-extension' })
  // Launches a persistent Chromium context with the extension loaded.
  // Point it at the UNPACKED extension directory — the one containing
  // manifest.json — not a .zip/.crx.
  // A relative path resolves against the PROJECT ROOT (the directory holding
  // playwright.config.*), not the test file's directory, so the value does not
  // change when a test file moves. The directory is validated before launch:
  // Chromium blocks on an unloadable extension until the test timeout instead
  // of reporting an error, so a bad path throws here (issue #2208).
  // Note: mutually exclusive with "account".
  extensionDir: [undefined, { option: true }],

  // Fixture option: set via test.use({ userDataDir: './chrome-profile' })
  // Chrome user data directory for persistent profile. Launches a persistent Chromium context.
  // Can be used with or without extensionDir. A relative path resolves against
  // the project root, same as extensionDir.
  userDataDir: [undefined, { option: true }],

  // Fixture option: set via test.use({ extensionStorageState: 'auth/storage-state.json' })
  // Loads cookies into persistent extension context (since storageState doesn't work with persistent context).
  extensionStorageState: [undefined, { option: true }],

  // Dev-box hook: inject --remote-debugging-port=0 into Chromium launch args
  // so the browser's CDP is reachable externally by the dev-box UI. Port 0
  // lets Chromium pick a free port itself — avoids races with any other Chrome
  // camping a pre-allocated port. Opt-in via OMNITERM_BROWSER_REGISTRY_URL (no-op
  // for normal `shiplight test` runs outside a dev-box).
  launchOptions: async ({ launchOptions }, use) => {
    if (!process.env.OMNITERM_BROWSER_REGISTRY_URL) {
      await use(launchOptions);
      return;
    }
    const existingArgs = (launchOptions as LaunchOptions | undefined)?.args ?? [];
    const extended: LaunchOptions = {
      ...launchOptions,
      args: [...existingArgs, '--remote-debugging-port=0'],
    };
    await use(extended);
  },

  // Dev-box hook: after Playwright launches Chromium, discover its CDP URL
  // via the shared `discoverChromiumCdpUrl` helper (walks ps tree, reads
  // DevToolsActivePort), then register with the browser registry. `ownerId`
  // falls through from SHIPLIGHT_OWNER_ID env automatically.
  browser: async ({ browser }, use) => {
    let registryId: string | null = null;
    if (process.env.OMNITERM_BROWSER_REGISTRY_URL) {
      try {
        const cdpUrl = await discoverChromiumCdpUrl(process.pid);
        const workerIdx = process.env.TEST_WORKER_INDEX ?? '?';
        registryId = await registerBrowser({
          cdpUrl,
          label: `shiplight test w${workerIdx}`,
          pid: process.pid,
        });
      } catch {
        // Best-effort — registry is optional.
      }
    }
    await use(browser);
    await unregisterBrowser(registryId);
  },

  context: async ({
    browser, account, extensionDir, userDataDir, extensionStorageState, launchOptions,
    // Standard Playwright context-option fixtures, resolved with per-test
    // test.use() taking precedence over project use:. These names must match
    // HANDLED_CONTEXT_OPTION_KEYS (verified by the drift guard test). Excluded:
    // storageState (auth owns it), contextOptions/clientCertificates.
    acceptDownloads, baseURL, bypassCSP, colorScheme, deviceScaleFactor,
    extraHTTPHeaders, geolocation, hasTouch, httpCredentials, ignoreHTTPSErrors,
    isMobile, javaScriptEnabled, locale, offline, permissions, proxy,
    serviceWorkers, timezoneId, userAgent, viewport,
  }, use: (r: BrowserContext) => Promise<void>, testInfo: TestInfo) => {
    const usePersistentContext = extensionDir || userDataDir;
    // Anchor user-provided relative paths (auth, extensionDir, userDataDir,
    // extensionStorageState) to the project root, not process.cwd() — see
    // resolveProjectRoot. legacyRoot feeds resolveUserPath's compatibility
    // fallback for files that still sit under the old testDir anchor.
    const projectRoot = resolveProjectRoot(testInfo);
    const legacyRoot = resolveLegacyProjectRoot(testInfo);

    // Per-test `use: { ... }` (emitted as test.use() by the YAML transpiler)
    // overrides the project-level use. testInfo.project.use does NOT include
    // these, so we apply Playwright's resolved option-fixture values on top.
    // See mergeResolvedContextOptions() for the full rationale.
    //
    // The resolved values are collected into a bag and the overlay is built
    // strictly from HANDLED_CONTEXT_OPTION_KEYS. This keeps the applied set in
    // lockstep with what the drift guard validates: a key listed in
    // HANDLED_CONTEXT_OPTION_KEYS but missing from this bag throws loudly here
    // (instead of silently dropping the per-test override — the bug this whole
    // mechanism exists to fix), and a key missing from the destructure above is
    // a compile error (referencing an undeclared identifier in the bag).
    const fixtureOptionValues: Record<string, unknown> = {
      acceptDownloads, baseURL, bypassCSP, colorScheme, deviceScaleFactor,
      extraHTTPHeaders, geolocation, hasTouch, httpCredentials, ignoreHTTPSErrors,
      isMobile, javaScriptEnabled, locale, offline, permissions, proxy,
      serviceWorkers, timezoneId, userAgent, viewport,
    };
    const resolvedContextOptions: Record<string, unknown> = {};
    for (const key of HANDLED_CONTEXT_OPTION_KEYS) {
      if (!(key in fixtureOptionValues)) {
        throw new Error(
          `[fixture] HANDLED_CONTEXT_OPTION_KEYS lists "${key}" but the context ` +
          `fixture does not resolve it — add "${key}" to the fixture destructure ` +
          `and fixtureOptionValues so per-test use: overrides apply.`,
        );
      }
      resolvedContextOptions[key] = fixtureOptionValues[key];
    }

    if (usePersistentContext) {
      // Persistent context: used for extensions, persistent Chrome profiles, or both
      if (account || (testInfo.project.use as ShiplightUseOptions).auth) {
        throw new Error(
          'Cannot use both "extensionDir"/"userDataDir" and "auth" — persistent context tests manage their own context. ' +
          'Use extensionStorageState for authentication instead.',
        );
      }

      // Persistent context only works with Chromium
      const configuredBrowser = (testInfo.project.use as any)?.browserName;
      if (configuredBrowser && configuredBrowser !== 'chromium') {
        console.warn(`[fixture] Persistent context requires Chromium but project is configured for "${configuredBrowser}". Forcing Chromium.`);
      }

      // Chrome extensions require headed mode — headless Chromium cannot load extensions.
      const headless = process.env.PLAYWRIGHT_HEADLESS === 'true';
      if (extensionDir && headless) {
        console.warn('[fixture] PLAYWRIGHT_HEADLESS=true with extensionDir — Chrome extensions will not function in headless mode.');
      }

      // Validates the extension directory and throws early — Chromium would
      // otherwise block on an unloadable extension until the test timeout
      // (issue #2208). Validation runs before the profile directory is
      // allocated, so a bad path costs nothing; see prepareExtensionLaunch.
      const { extensionArgs, resolvedProfileDir } = prepareExtensionLaunch(
        extensionDir ? resolveUserPath(extensionDir, projectRoot, legacyRoot) : undefined,
        extensionDir,
        userDataDir ? resolveUserPath(userDataDir, projectRoot, legacyRoot) : undefined,
      );

      // Forward project config (locale, timezoneId, viewport, etc.) to persistent context.
      // Per-test use: overrides project use: (see mergeResolvedContextOptions).
      // Strip options that are incompatible with persistent context or handled separately.
      const projectUse = mergeResolvedContextOptions(testInfo.project.use as Record<string, unknown>, resolvedContextOptions) as any;
      const {
        storageState: _ss,
        account: _acct,
        extensionDir: _ed,
        userDataDir: _eud,
        extensionStorageState: _ess,
        launchOptions: _lo,
        autoDismissModal: _adm,
        video,
        ...contextOptions
      } = projectUse;

      // Set up video recording if configured in project
      const recordVideo = shouldRecord(video) ? { dir: testInfo.outputDir } : undefined;

      let context: BrowserContext | undefined;
      try {
        const {
          headless: _configuredHeadless,
          ...persistentLaunchOptions
        } = buildPersistentLaunchOptions(
          extensionArgs,
          launchOptions as LaunchOptions | undefined,
        );
        context = await chromium.launchPersistentContext(resolvedProfileDir, {
          ...persistentLaunchOptions,
          ...contextOptions,
          headless,
          args: persistentLaunchOptions.args,
          // Use `in` rather than `??` so an explicit `viewport: null` (no fixed
          // viewport, for responsive testing) is honored instead of coerced to
          // 1280x720 — matching the default (newContext) path. Falls back to a
          // sane default only when viewport was never resolved at all.
          viewport: 'viewport' in contextOptions ? contextOptions.viewport : { width: 1280, height: 720 },
          ...(recordVideo ? { recordVideo } : {}),
        });
        persistentProfileDirs.set(context, resolvedProfileDir);

        // Load storage state (cookies) into persistent context
        // (persistent context doesn't support storageState option directly, so we load manually)
        if (extensionStorageState) {
          const resolvedPath = resolveUserPath(extensionStorageState, projectRoot, legacyRoot);
          const cookies = loadAndExtendCookies(resolvedPath);
          if (cookies) {
            await context.addCookies(cookies);
          }
        }

        await use(context);
      } finally {
        // Collect video references before closing — video.path()/delete() await
        // an internal promise that only resolves during context.close().
        const videos = (context?.pages().map(p => p.video()).filter((v): v is Video => v !== null)) ?? [];
        await context?.close().catch((err) => {
          console.warn('[fixture] Failed to close persistent context:', err);
        });
        await handleVideosAfterClose(videos, video, testInfo);
        // Only clean up temp profile dirs (not user-provided ones)
        if (!userDataDir) {
          try {
            fs.rmSync(resolvedProfileDir, { recursive: true, force: true });
          } catch (err) {
            console.warn('[fixture] Failed to clean up temp profile dir:', resolvedProfileDir, err);
          }
        }
      }
    } else {
      // Default context (auth-based or plain)
      // Per-test use: overrides project use: (see mergeResolvedContextOptions).
      const contextOptions = mergeResolvedContextOptions(testInfo.project.use as Record<string, unknown>, resolvedContextOptions) as any;
      const useOptions = testInfo.project.use as ShiplightUseOptions;

      // Resolve auth spec from either new format (auth + args in use) or legacy (account fixture)
      const authSpec: AuthSpec | undefined = useOptions.auth
        ? { auth: useOptions.auth, args: useOptions.args }
        : account;

      if (authSpec) {
        if (!authSpec.auth) {
          throw new Error(
            'Auth is declared but missing the script path. ' +
            'Provide auth in playwright.config.ts: use: { auth: \'./auth.login.ts\' }',
          );
        }
        contextOptions.storageState = await resolveAuthState(authSpec, browser, baseURL, projectRoot, legacyRoot);
      }

      // Translate Playwright's video shorthand into newContext format
      const video = contextOptions.video;
      if (shouldRecord(video) && !contextOptions.recordVideo) {
        contextOptions.recordVideo = { dir: testInfo.outputDir };
      }

      const context = await browser.newContext(contextOptions);
      context.addInitScript(INIT_SCRIPT);
      try {
        await use(context);
      } finally {
        // Collect video references before closing — video.path()/delete() await
        // an internal promise that only resolves during context.close().
        const videos = context.pages().map(p => p.video()).filter((v): v is Video => v !== null);
        await context.close();
        await handleVideosAfterClose(videos, video, testInfo);
      }
    }
  },

  // Override page for extension mode — use the initial page from persistent context.
  // Page lifecycle: in extension mode, context.close() in the context fixture's finally
  // block handles closing all pages, so we don't close explicitly here.
  // In non-extension mode, context.close() also cascades, matching Playwright's default.
  page: async ({ context }, use) => {
    const page = await resolveTestPage(context);
    await use(page);
  },

  // The real Chrome toolbar popup. Playwright intentionally omits action-popup
  // targets from the primary persistent context's pages(), so this fixture
  // opens it through chrome.action.openPopup() and reattaches over CDP.
  extensionActionPopup: async ({ context, extensionDir }, use) => {
    if (!extensionDir) {
      throw new Error(
        '[fixture] extensionActionPopup requires use: { extensionDir: "..." }.',
      );
    }
    const profileDir = persistentProfileDirs.get(context);
    if (!profileDir) {
      throw new Error('[fixture] Could not resolve the persistent extension profile.');
    }

    const popup = await openActionPopup(context, profileDir);
    try {
      await use(popup);
    } finally {
      await popup.close().catch(() => {});
    }
  },

  // testContext fixture — created first, shared VariableStore with the agent
  testContext: async ({ variables: testVariables }, use: (r: TestContext) => Promise<void>, testInfo: TestInfo) => {
    const { VariableStore } = await loadSdk();
    const variableStore = new VariableStore();

    const loadVariables = (vars: ShiplightUseOptions['variables']) => {
      if (!vars) return;
      for (const [key, val] of Object.entries(vars)) {
        if (typeof val === 'string') {
          variableStore.set(key, val, false);
        } else if (val && typeof val === 'object' && 'value' in val) {
          variableStore.set(key, val.value, val.sensitive === true);
        }
      }
    };

    // Load project-level variables first, then test-level variables override them
    const projectVariables = (testInfo.project.use as ShiplightUseOptions).variables;
    loadVariables(projectVariables);
    loadVariables(testVariables);

    // CLI / env overrides (highest priority). Set via `shiplight test --vars` or
    // by setting SHIPLIGHT_VARS_OVERRIDE='{"KEY":"value"}' directly.
    // Sensitivity is inherited from whichever declaration the key already has;
    // overrides cannot themselves declare sensitivity.
    applyVarsOverride(variableStore, projectVariables, testVariables);

    const testCtx = createTestContext(variableStore);
    // Expose on global so transpiled code can reference testContext, $, ctx
    (global as any).testContext = testCtx;
    (global as any).$ = testCtx;
    (global as any).ctx = testCtx;

    await use(testCtx);

    delete (global as any).testContext;
    delete (global as any).$;
    delete (global as any).ctx;
  },

  // $ and ctx are aliases for testContext
  $: async ({ testContext }, use) => { await use(testContext); },
  ctx: async ({ testContext }, use) => { await use(testContext); },

  agent: async ({ page, testContext, autoDismissModal }, use: (r: WebAgent) => Promise<void>, testInfo: TestInfo) => {
    const { WebAgent, createAgentContext, configureSdk, parseSdkLogLevelFromEnv } = await loadSdk();

    // Forward only the allowlisted env vars — see SDK_ENV_ALLOWLIST above.
    // The log level is parsed from that same map rather than process.env, so
    // sdk-core never reads ambient environment (001 FR-010).
    const sdkEnv = buildSdkEnv();
    const logLevel = parseSdkLogLevelFromEnv(sdkEnv);
    configureSdk({
      env: sdkEnv,
      ...(logLevel !== undefined && { logLevel }),
    });

    const { resolveWebAgentModelFromEnv, resolveComputerUseModelFromEnv, resolveWebAgentFallbackModelsFromEnv } = await import('shiplight-types');
    // Reads from the Shiplight `.env` stash, not process.env — same reason
    // as buildSdkEnv() above: shell-level provider keys must not silently
    // override what the user declared in their project's .env.
    const shiplightEnv = getShiplightEnv();
    const model = requireWebAgentModel(shiplightEnv, resolveWebAgentModelFromEnv(shiplightEnv));
    const computerUseModel = resolveComputerUseModelFromEnv(shiplightEnv);
    // Fallback chain (WEB_AGENT_FALLBACK_MODELS; on by default, opt out with an
    // empty value). Resolved here alongside the primary model and passed via
    // createAgentContext, like WEB_AGENT_MODEL.
    const fallbackModels = resolveWebAgentFallbackModelsFromEnv(shiplightEnv);

    // Share the same VariableStore so $variableName and testContext.variableName resolve identically
    const variableStore = testContext.__variableStore;
    const agentCtx = createAgentContext({ model, fallbackModels, computer_use_model: computerUseModel, variableStore, autoDismissModal, testDataDir: resolveTestDataDir(testInfo), downloadDir: path.join(testInfo.outputDir, 'downloads') });
    const artifactsDir = path.join(testInfo.outputDir, 'artifacts');
    agentCtx.stepTracking = { results: {}, artifactsDir };
    const agent = new WebAgent(agentCtx);

    // Initialize tab manager for multi-tab support (switch_tab, close_tab)
    const context = page.context();
    agent.agentServices.setupPageTracking(context);

    // Set up download tracking and dialog handling for all existing pages
    for (const p of context.pages()) {
      agent.setupDownloadTracking(p);
      agent.setupDialogHandling(p);
    }

    // Set up download tracking and dialog handling for new pages (popups/new tabs)
    context.on('page', (p) => {
      agent.setupDownloadTracking(p);
      agent.setupDialogHandling(p);
    });

    // Expose agent globally so transpiled CODE/functions can reference it
    (global as any).agent = agent;

    await use(agent);

    delete (global as any).agent;

    // Attach step results for the Shiplight reporter
    try {
      const outputDir = testInfo.outputDir;
      await agent.writeExecutionResults(outputDir);
      const fsp = await import('fs/promises');

      const testResultsPath = path.join(outputDir, 'test-results.json');
      const stat = await fsp.stat(testResultsPath).catch(() => null);
      if (stat) {
        await testInfo.attach('shiplight-results', {
          path: testResultsPath,
          contentType: 'application/json',
        });
      }

      // Per-step LLM usage (spec 047 analytics plane) — its own attachment rather than
      // relying on the reporter deriving a directory from the `shiplight-results` path:
      // that path is unreliable by the time the reporter sees it (it commonly hands the
      // reporter an in-memory `body` for this attachment instead), so a sibling-directory
      // guess silently finds nothing. An attachment survives that the same way stepResults
      // already does.
      const aiActionsPath = path.join(outputDir, 'ai-actions.json');
      const aiActionsStat = await fsp.stat(aiActionsPath).catch(() => null);
      if (aiActionsStat) {
        await testInfo.attach('shiplight-ai-actions', {
          path: aiActionsPath,
          contentType: 'application/json',
        });
      }
    } catch (err) {
      console.error('[Shiplight] Failed to attach step results:', err);
    }

    // Persist new action entities from self-healing (if any)
    // Written to test artifacts so the orchestrator can upload to cloud cache later.
    try {
      const newEntities = agent.getNewActionEntities();
      if (newEntities.size > 0) {
        const { createEmptyStore, createRunnerStoreEntry } = await import('shiplight-types');
        const fsp = await import('fs/promises');
        const store = createEmptyStore();
        for (const [stmtUid, actionEntity] of newEntities) {
          store.entries[stmtUid] = createRunnerStoreEntry(actionEntity, 0);
        }
        const serialized = JSON.stringify(store, null, 2);

        // Attached for ANY outcome, because the reporter reads this to count
        // healing for the run's cache summary and a heal is precisely a cached
        // entity that did NOT work. Gating the attachment on `passed` — as the
        // cache write-back below is — would drop every heal from a test that
        // later failed for an unrelated reason and leave those statements
        // counted as successful cache hits: the exact inverse of what happened,
        // on the runs where the number matters most. Attached as a body so it
        // travels independently of the on-disk file.
        await testInfo.attach('shiplight-new-action-entities', {
          body: Buffer.from(serialized, 'utf-8'),
          contentType: 'application/json',
        });

        // Written to test artifacts ONLY on success — this file is what the
        // orchestrator's post-test scan uploads to the cloud cache, and an
        // entity resolved during a failing test is not something to serve to
        // future runs.
        if (testInfo.status === 'passed') {
          const cachePath = path.join(testInfo.outputDir, 'new-action-entities.json');
          await fsp.writeFile(cachePath, serialized);
          console.log(`[Shiplight] ${newEntities.size} healed action entit${newEntities.size === 1 ? 'y' : 'ies'} saved`);
        }
      }
    } catch (err) {
      // Don't fail the test if we can't persist action entities
      console.warn('[Shiplight] Failed to persist new action entities:', err);
    }
  },
});

export { expect };
