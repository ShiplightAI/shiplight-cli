/**
 * Pure helper functions for the extension fixture.
 * Extracted so they can be tested directly without launching a browser.
 */

import * as fs from 'fs';
import * as path from 'path';
import { randomUUID } from 'crypto';
import { tmpdir } from 'os';
import type { Cookie, LaunchOptions } from '@playwright/test';

/**
 * Build Chromium launch args to load an unpacked extension.
 *
 * The directory is validated first. Chromium does not fail when
 * `--load-extension` points at something unloadable — it opens a blocking
 * "could not load extension" dialog, so `launchPersistentContext` never
 * resolves and the run dies at the Playwright test timeout with nothing in the
 * output naming the extension or the path (issue #2208). Both a missing
 * directory and a directory without a `manifest.json` were confirmed to hang
 * this way against a real browser, so both are rejected here.
 *
 * @param absoluteExtDir Resolved absolute path to the unpacked extension.
 * @param configuredValue The value as the user wrote it (e.g. `./dist`), echoed
 *   in the error so the message shows both what was written and where it landed.
 */
export function buildExtensionArgs(absoluteExtDir: string, configuredValue?: string): string[] {
  assertLoadableExtensionDir(absoluteExtDir, configuredValue);

  return [
    `--disable-extensions-except=${absoluteExtDir}`,
    `--load-extension=${absoluteExtDir}`,
    '--no-first-run',
    '--disable-default-apps',
  ];
}

const FIXTURE_OWNED_CHROMIUM_SWITCHES = [
  '--load-extension',
  '--disable-extensions-except',
  '--user-data-dir',
  '--remote-debugging-port',
  '--remote-debugging-pipe',
] as const;

/**
 * Merge caller-supplied Chromium flags into a persistent-context launch.
 *
 * Extension contexts also receive an ephemeral CDP port. Playwright's primary
 * connection deliberately omits action-popup targets from `context.pages()`;
 * the port lets the `extensionActionPopup` fixture reconnect and expose that
 * target as a normal Page. Profile-only persistent contexts do not need it.
 *
 * Flags that control the extension, profile, or debugging transport remain
 * fixture-owned. Accepting a second value for one of them is order-dependent
 * in Chromium and can silently load the wrong extension/profile.
 */
export function buildPersistentChromiumArgs(
  extensionArgs: readonly string[],
  launchArgs: readonly string[] = [],
): string[] {
  for (const arg of launchArgs) {
    const reserved = FIXTURE_OWNED_CHROMIUM_SWITCHES.find(
      (prefix) => arg === prefix || arg.startsWith(`${prefix}=`),
    );
    if (reserved) {
      throw new Error(
        `[fixture] launchOptions.args contains "${arg}", but ${reserved} is reserved by the Shiplight extension fixture.`,
      );
    }
  }

  return [
    ...extensionArgs,
    ...launchArgs,
    ...(extensionArgs.length > 0 ? ['--remote-debugging-port=0'] : []),
  ];
}

/** Apply an extension's fixture-owned switches without dropping Playwright launch options. */
export function buildPersistentLaunchOptions(
  extensionArgs: readonly string[],
  launchOptions: LaunchOptions | undefined,
): LaunchOptions {
  const { args = [], ...otherLaunchOptions } = launchOptions ?? {};
  return {
    ...otherLaunchOptions,
    args: buildPersistentChromiumArgs(extensionArgs, args),
  };
}

/**
 * Throw a diagnostic error if the path is not a loadable unpacked extension.
 * The message always names the resolved absolute path — that is the one fact
 * that turns this from a two-minute timeout mystery into a one-line fix.
 */
function assertLoadableExtensionDir(absoluteExtDir: string, configuredValue?: string): void {
  const asWritten = configuredValue !== undefined && configuredValue !== absoluteExtDir
    ? `extensionDir "${configuredValue}" resolved to "${absoluteExtDir}"`
    : `extensionDir "${absoluteExtDir}"`;

  let stat: fs.Stats;
  try {
    stat = fs.statSync(absoluteExtDir);
  } catch (err) {
    // Only ENOENT means "not there". EACCES, ELOOP and friends name a real,
    // different problem that the error object already describes — reporting
    // them as a missing path sends the user off rebuilding a correct one.
    if ((err as NodeJS.ErrnoException)?.code !== 'ENOENT') {
      throw new Error(
        `[fixture] ${asWritten}, which could not be read: ${(err as Error).message}`,
        { cause: err },
      );
    }
    throw new Error(
      `[fixture] ${asWritten}, which does not exist. ` +
      'Relative paths are resolved against the project root (the directory holding playwright.config.*), ' +
      'not the test file. Point extensionDir at the unpacked extension directory — the one containing manifest.json.',
    );
  }

  if (!stat.isDirectory()) {
    throw new Error(
      `[fixture] ${asWritten}, which is not a directory. ` +
      'extensionDir must point at an unpacked extension directory (the one containing manifest.json), not a file or .zip/.crx archive.',
    );
  }

  if (!fs.existsSync(path.join(absoluteExtDir, 'manifest.json'))) {
    throw new Error(
      `[fixture] ${asWritten}, which has no manifest.json. ` +
      'extensionDir must point at an unpacked extension directory. ' +
      'If the extension needs a build step, run it before the test.',
    );
  }
}

/**
 * Build everything the persistent-context launch needs, in the order that keeps
 * failures cheap: validate the extension directory FIRST, then allocate the
 * profile directory.
 *
 * Order matters. prepareProfileDir creates a temp directory and, with a
 * userDataDir set, `cpSync`-copies an entire Chrome profile into it. The
 * extension validation throws before the caller's try/finally cleanup is
 * entered, so doing it the other way round leaks a full profile copy per test
 * on exactly the path this validation exists to catch (issue #2208).
 *
 * @param absoluteExtDir Resolved extension directory, or undefined.
 * @param configuredExtDir The extensionDir value as the user wrote it, for errors.
 * @param absoluteProfileDir Resolved userDataDir, or undefined for a fresh profile.
 */
export function prepareExtensionLaunch(
  absoluteExtDir: string | undefined,
  configuredExtDir: string | undefined,
  absoluteProfileDir: string | undefined,
): { extensionArgs: string[]; resolvedProfileDir: string } {
  const extensionArgs = absoluteExtDir
    ? buildExtensionArgs(absoluteExtDir, configuredExtDir)
    : [];

  return { extensionArgs, resolvedProfileDir: prepareProfileDir(absoluteProfileDir) };
}

/** Read a storageState JSON file and return cookies with expiration extended to 1 year. */
export function loadAndExtendCookies(storageStatePath: string): Cookie[] | null {
  if (!fs.existsSync(storageStatePath)) {
    console.warn(`[fixture] extensionStorageState file not found: ${storageStatePath}`);
    return null;
  }

  let state: unknown;
  try {
    state = JSON.parse(fs.readFileSync(storageStatePath, 'utf-8'));
  } catch (err) {
    throw new Error(`[fixture] Failed to parse extensionStorageState at ${storageStatePath}: ${err}`);
  }
  const parsed = state as { cookies?: unknown };
  if (!Array.isArray(parsed.cookies)) return null;

  const expires = (Date.now() + 365 * 24 * 60 * 60 * 1000) / 1000;
  // Filter out malformed cookies missing required fields
  const validCookies = parsed.cookies.filter((c: any) =>
    c && typeof c === 'object' && typeof c.name === 'string' && typeof c.domain === 'string'
  );
  if (validCookies.length < parsed.cookies.length) {
    console.warn(`[fixture] Skipped ${parsed.cookies.length - validCookies.length} malformed cookies (missing name or domain)`);
  }
  return validCookies.map((cookie: Cookie) => ({ ...cookie, expires }));
}

/**
 * Prepare a user-data directory for the persistent context.
 *
 * When extensionUserDataDir is set, copies the base profile into a temp directory
 * for isolation. Each test gets its own copy to avoid SingletonLock conflicts in
 * parallel runs. The copy is placed under tmpdir() so orphaned dirs don't pollute
 * the project directory. Note: new cookies/sessions acquired during the test are
 * NOT written back to the base profile — the copy is deleted after the test.
 *
 * When extensionUserDataDir is not set, creates a fresh temp directory.
 *
 * A relative extensionUserDataDir is resolved against projectRoot — the directory
 * holding playwright.config.*, not process.cwd(), which is not guaranteed to be the
 * project root. Callers in the fixture pass an already-resolved absolute path (see
 * resolveUserPath); the projectRoot parameter defaults to process.cwd() for direct
 * callers and tests.
 */
export function prepareProfileDir(
  extensionUserDataDir: string | undefined,
  projectRoot: string = process.cwd(),
): string {
  if (extensionUserDataDir) {
    const baseDir = path.resolve(projectRoot, extensionUserDataDir);
    const userDataDir = path.join(tmpdir(), `ext-profile-${randomUUID()}`);
    if (fs.existsSync(baseDir)) {
      try {
        fs.cpSync(baseDir, userDataDir, { recursive: true });
      } catch (err) {
        try {
          fs.rmSync(userDataDir, { recursive: true, force: true });
        } catch (cleanupErr) {
          console.warn('[fixture] Failed to clean up partial profile copy:', userDataDir, cleanupErr);
        }
        throw new Error(`[fixture] Failed to copy extension profile from ${baseDir}: ${err}`);
      }
      const lockFile = path.join(userDataDir, 'SingletonLock');
      if (fs.existsSync(lockFile)) fs.rmSync(lockFile, { force: true });
    } else {
      fs.mkdirSync(userDataDir, { recursive: true });
    }
    return userDataDir;
  }

  const userDataDir = path.join(tmpdir(), `ext-profile-${randomUUID()}`);
  fs.mkdirSync(userDataDir, { recursive: true });
  return userDataDir;
}
