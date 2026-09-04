import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import * as path from 'node:path';
import {
  mergeResolvedContextOptions,
  dropViewportIncompatibleOptions,
  HANDLED_CONTEXT_OPTION_KEYS,
  EXCLUDED_CONTEXT_OPTION_KEYS,
  VIEWPORT_INCOMPATIBLE_OPTIONS,
} from './fixture.js';

/**
 * Extract the comma-separated identifier keys of a `{ ... }` block in a source
 * file — used by the drift guards that parse Playwright internals and our own
 * fixture source. `marker` must end at the block's opening `{`; `closeToken` is
 * the first token that closes the block ('}' or '};'). Shared so the two
 * call sites can't diverge.
 */
function parseIdentifierBlock(src: string, marker: string, closeToken: string): string[] {
  const start = src.indexOf(marker);
  assert.notEqual(start, -1, `Could not locate marker (${JSON.stringify(marker)}); source changed — update this drift guard.`);
  const open = start + marker.length - 1; // index of the opening `{`
  const close = src.indexOf(closeToken, open);
  assert.notEqual(close, -1, `Could not find ${JSON.stringify(closeToken)} closing the block after ${JSON.stringify(marker)}.`);
  const block = src.slice(open + 1, close);
  const keys = block
    .split(',')
    .map((s) => s.trim().split(/[:=]/)[0].trim()) // shorthand / strip aliases & defaults
    .filter(Boolean);
  assert.ok(keys.length > 10, `Parsed too few keys (${keys.length}) after ${JSON.stringify(marker)}; parser likely broke.`);
  return keys;
}

/**
 * Regression: a per-test `use: { ... }` block (emitted by the YAML transpiler as
 * test.use()) silently dropped any context option the PROJECT config also set —
 * most visibly `viewport`. The fixture built context options from
 * `testInfo.project.use` (project-level only), so a project-set key pre-seeded
 * the options object and Playwright's fill-missing merge could never apply the
 * per-test value. Options the project did not set got filled, so they appeared
 * to work. mergeResolvedContextOptions() overlays Playwright's resolved
 * (per-test aware) option-fixture values so per-test use: wins for ALL context
 * options, not just device emulation.
 */

// Mirrors a typical playwright.config.ts `use:` block: viewport + a couple of
// other context options set at the project level.
const PROJECT_USE = {
  headless: false,
  viewport: { width: 1280, height: 720 },
  colorScheme: 'light',
  locale: 'en-US',
  actionTimeout: 15_000,
  screenshot: 'on',
  video: 'on',
  trace: 'on',
};

// What Playwright resolves for a test whose file-level test.use() requests a
// mobile profile + dark mode + a different locale (file-level overrides project).
const RESOLVED_OVERRIDES = {
  viewport: { width: 360, height: 640 },
  isMobile: true,
  hasTouch: true,
  deviceScaleFactor: 3,
  userAgent: 'Mozilla/5.0 (Linux; Android 5.0; SM-G900P) Mobile Safari/537.36',
  colorScheme: 'dark',
  locale: 'fr-FR',
};

describe('mergeResolvedContextOptions', () => {
  it('applies the per-test viewport over the project viewport (the regression)', () => {
    const merged = mergeResolvedContextOptions(PROJECT_USE, RESOLVED_OVERRIDES);
    assert.deepEqual(merged.viewport, { width: 360, height: 640 });
    assert.equal(merged.isMobile, true);
    assert.equal(merged.hasTouch, true);
    assert.equal(merged.deviceScaleFactor, 3);
    assert.equal(
      merged.userAgent,
      'Mozilla/5.0 (Linux; Android 5.0; SM-G900P) Mobile Safari/537.36',
    );
  });

  it('is not emulation-only: per-test colorScheme/locale override the project too', () => {
    const merged = mergeResolvedContextOptions(PROJECT_USE, RESOLVED_OVERRIDES);
    assert.equal(merged.colorScheme, 'dark');
    assert.equal(merged.locale, 'fr-FR');
  });

  it('preserves unrelated project use: keys (non context-option keys)', () => {
    const merged = mergeResolvedContextOptions(PROJECT_USE, RESOLVED_OVERRIDES);
    assert.equal(merged.headless, false);
    assert.equal(merged.actionTimeout, 15_000);
    assert.equal(merged.screenshot, 'on');
    assert.equal(merged.video, 'on');
    assert.equal(merged.trace, 'on');
  });

  it('keeps project values when the resolved value equals them (no per-test override)', () => {
    // When there is no per-test override, Playwright resolves the project values.
    const resolved = {
      viewport: { width: 1280, height: 720 },
      colorScheme: 'light',
      locale: 'en-US',
      isMobile: false,
      hasTouch: false,
      userAgent: undefined,
      deviceScaleFactor: undefined,
    };
    const merged = mergeResolvedContextOptions(PROJECT_USE, resolved);
    assert.deepEqual(merged.viewport, { width: 1280, height: 720 });
    assert.equal(merged.colorScheme, 'light');
    assert.equal(merged.locale, 'en-US');
    assert.equal(merged.isMobile, false);
  });

  it('skips keys resolved to undefined (never injects unrequested options)', () => {
    const merged = mergeResolvedContextOptions(
      {},
      {
        viewport: { width: 414, height: 896 },
        isMobile: true,
        hasTouch: true,
        userAgent: undefined,
        deviceScaleFactor: undefined,
        proxy: undefined,
        geolocation: undefined,
      },
    );
    assert.deepEqual(merged.viewport, { width: 414, height: 896 });
    assert.equal('userAgent' in merged, false);
    assert.equal('deviceScaleFactor' in merged, false);
    assert.equal('proxy' in merged, false);
    assert.equal('geolocation' in merged, false);
  });

  it('keeps null values (viewport: null = no fixed viewport)', () => {
    const merged = mergeResolvedContextOptions(PROJECT_USE, { viewport: null });
    assert.equal(merged.viewport, null);
  });

  it('does not mutate the input project use object', () => {
    const projectUse = { ...PROJECT_USE };
    mergeResolvedContextOptions(projectUse, RESOLVED_OVERRIDES);
    assert.deepEqual(projectUse.viewport, { width: 1280, height: 720 });
    assert.equal(projectUse.colorScheme, 'light');
    assert.equal('isMobile' in projectUse, false);
  });

  // Playwright throws if `viewport: null` is combined with deviceScaleFactor or
  // isMobile:true. The merge must honor the explicit null and drop the
  // incompatible emulation options so context creation can't crash.
  describe('viewport: null incompatibility resolution', () => {
    it('drops a project-level deviceScaleFactor when a test requests viewport: null', () => {
      const merged = mergeResolvedContextOptions(
        { deviceScaleFactor: 2 }, // project sets DPI globally
        { viewport: null }, // per-test responsive override
      );
      assert.equal(merged.viewport, null);
      assert.equal('deviceScaleFactor' in merged, false);
    });

    it('drops isMobile:true when viewport resolves to null', () => {
      const merged = mergeResolvedContextOptions({}, { viewport: null, isMobile: true });
      assert.equal(merged.viewport, null);
      assert.equal('isMobile' in merged, false);
    });

    it('keeps isMobile:false and hasTouch with viewport: null (Playwright allows those)', () => {
      const merged = mergeResolvedContextOptions(
        {},
        { viewport: null, isMobile: false, hasTouch: true },
      );
      assert.equal(merged.viewport, null);
      assert.equal(merged.isMobile, false);
      assert.equal(merged.hasTouch, true);
    });

    it('leaves deviceScaleFactor/isMobile untouched when viewport is a concrete size', () => {
      const merged = mergeResolvedContextOptions(
        { deviceScaleFactor: 2 },
        { viewport: { width: 390, height: 844 }, isMobile: true },
      );
      assert.deepEqual(merged.viewport, { width: 390, height: 844 });
      assert.equal(merged.deviceScaleFactor, 2);
      assert.equal(merged.isMobile, true);
    });
  });
});

/**
 * Drift guard: the `context` fixture explicitly lists the context-option
 * fixtures it overlays (HANDLED_CONTEXT_OPTION_KEYS). That list mirrors the set
 * Playwright resolves into a browser context — but Playwright owns that set and
 * can add to it (e.g. a future `reducedMotion`/`forcedColors`). If it does, a
 * per-test `use:` override of the new option would be silently dropped, exactly
 * like the original viewport bug.
 *
 * This test reads the authoritative set straight from Playwright's
 * `_combinedContextOptions` fixture (the destructure of every option it forwards
 * to `browser.newContext()`) and asserts our handled + intentionally-excluded
 * lists cover it exactly. When this fails after a Playwright bump, add the new
 * key to HANDLED_CONTEXT_OPTION_KEYS (and the fixture destructure / object) or to
 * EXCLUDED_CONTEXT_OPTION_KEYS with a reason.
 */
describe('context option drift guard', () => {
  /** Parse the option keys Playwright's _combinedContextOptions resolves. */
  function readPlaywrightContextOptionKeys(): Set<string> {
    const require = createRequire(import.meta.url);
    // package.json is always exported; derive lib/index.js from its dir so we
    // don't depend on a subpath export that Playwright may not expose.
    const pkgJsonPath = require.resolve('playwright/package.json');
    const libPath = path.join(path.dirname(pkgJsonPath), 'lib', 'index.js');
    const src = readFileSync(libPath, 'utf8');
    return new Set(parseIdentifierBlock(src, '_combinedContextOptions: [async ({', '}'));
  }

  it('our handled + excluded keys cover exactly what Playwright resolves', () => {
    const playwrightKeys = readPlaywrightContextOptionKeys();
    const ours = new Set<string>([...HANDLED_CONTEXT_OPTION_KEYS, ...EXCLUDED_CONTEXT_OPTION_KEYS]);

    const missing = [...playwrightKeys].filter((k) => !ours.has(k)).sort();
    const stale = [...ours].filter((k) => !playwrightKeys.has(k)).sort();

    assert.deepEqual(
      missing,
      [],
      `Playwright resolves context option(s) we neither handle nor exclude: ${missing.join(', ')}. ` +
        'Add each to HANDLED_CONTEXT_OPTION_KEYS (and the context fixture destructure + ' +
        'resolvedContextOptions) so per-test use: overrides apply, or to ' +
        'EXCLUDED_CONTEXT_OPTION_KEYS with a reason.',
    );
    assert.deepEqual(
      stale,
      [],
      `We list context option(s) Playwright no longer resolves: ${stale.join(', ')}. ` +
        'Remove them from HANDLED_/EXCLUDED_CONTEXT_OPTION_KEYS.',
    );
  });

  it('handled and excluded sets are disjoint', () => {
    const overlap = HANDLED_CONTEXT_OPTION_KEYS.filter((k) =>
      (EXCLUDED_CONTEXT_OPTION_KEYS as readonly string[]).includes(k),
    );
    assert.deepEqual(overlap, [], `Keys in both handled and excluded: ${overlap.join(', ')}`);
  });

  // The context fixture resolves per-test option values into a `fixtureOptionValues`
  // bag, then overlays them strictly via HANDLED_CONTEXT_OPTION_KEYS. The runtime
  // loop in the fixture throws if a HANDLED key is missing from the bag — but that
  // loop only runs when the `context` fixture is instantiated, which the unit /
  // logic suites never do. This parses the bag straight from source so the
  // bag↔HANDLED invariant is enforced in CI, not only in real `playwright test`.
  it('fixtureOptionValues bag in the context fixture matches HANDLED_CONTEXT_OPTION_KEYS', () => {
    const fixtureSrcPath = fileURLToPath(new URL('./fixture.ts', import.meta.url));
    const src = readFileSync(fixtureSrcPath, 'utf8');
    const bagKeys = parseIdentifierBlock(src, 'const fixtureOptionValues: Record<string, unknown> = {', '};');

    assert.deepEqual(
      [...bagKeys].sort(),
      [...HANDLED_CONTEXT_OPTION_KEYS].sort(),
      'The context fixture\'s fixtureOptionValues bag has drifted from HANDLED_CONTEXT_OPTION_KEYS. ' +
        'A per-test override of any divergent key would be silently dropped. Keep the fixture ' +
        'destructure, fixtureOptionValues, and HANDLED_CONTEXT_OPTION_KEYS identical.',
    );
  });

  // dropViewportIncompatibleOptions hardcodes which options Playwright rejects
  // alongside `viewport: null`. Playwright owns that list (in
  // validateBrowserContextOptions) and could add to it. Parse the authoritative
  // `noDefaultViewport && ...` throw conditions straight from playwright-core and
  // assert our VIEWPORT_INCOMPATIBLE_OPTIONS covers exactly them — so a future
  // Playwright conflict fails this test instead of crashing context creation.
  it('VIEWPORT_INCOMPATIBLE_OPTIONS matches Playwright validateBrowserContextOptions', () => {
    const require = createRequire(import.meta.url);
    // validateBrowserContextOptions lives in playwright-core; resolve it via the
    // playwright package (which depends on it) so we read the version actually used.
    // Playwright has moved this source between bundle layouts (the old
    // `lib/coreBundle.js` was removed around 1.5x in favor of the unbundled
    // `lib/server/browserContext.js`), so probe the known locations and fail with
    // a clear message — not a raw ENOENT — if a future refactor moves it again.
    const pwRequire = createRequire(require.resolve('playwright/package.json'));
    const corePkg = pwRequire.resolve('playwright-core/package.json');
    const coreDir = path.dirname(corePkg);
    const candidates = [
      path.join(coreDir, 'lib', 'server', 'browserContext.js'),
      path.join(coreDir, 'lib', 'coreBundle.js'),
    ];
    const libPath = candidates.find((p) => existsSync(p));
    assert.ok(
      libPath,
      `Could not find validateBrowserContextOptions source in playwright-core (checked ${candidates.join(', ')}); ` +
        'Playwright internals moved — update this drift guard.',
    );
    const src = readFileSync(libPath, 'utf8');

    const fnStart = src.indexOf('function validateBrowserContextOptions(');
    assert.notEqual(fnStart, -1, 'Could not locate validateBrowserContextOptions in playwright-core; internals changed.');
    // The function body ends right before the next function declaration.
    const fnEnd = src.indexOf('\nfunction ', fnStart + 1);
    const body = src.slice(fnStart, fnEnd === -1 ? fnStart + 2000 : fnEnd);

    // Match `noDefaultViewport && [!!]<obj>.<optionName>` — the conflicting option.
    const re = /noDefaultViewport\s*&&\s*(?:!!\s*)?[\w.$]+\.(\w+)\b/g;
    const playwrightKeys = new Set<string>();
    let m: RegExpExecArray | null;
    while ((m = re.exec(body)) !== null) playwrightKeys.add(m[1]);
    assert.ok(
      playwrightKeys.size > 0,
      'Parsed no `noDefaultViewport && ...` conflicts; the parser likely broke — review the drift guard.',
    );

    const ours = new Set(VIEWPORT_INCOMPATIBLE_OPTIONS.map((o) => o.key));
    assert.deepEqual(
      [...playwrightKeys].sort(),
      [...ours].sort(),
      `Playwright's viewport:null incompatibility set ${JSON.stringify([...playwrightKeys].sort())} ` +
        `differs from VIEWPORT_INCOMPATIBLE_OPTIONS ${JSON.stringify([...ours].sort())}. ` +
        'Update VIEWPORT_INCOMPATIBLE_OPTIONS (and dropViewportIncompatibleOptions) so the combo ' +
        'is dropped instead of crashing context creation.',
    );
  });

  it('dropViewportIncompatibleOptions only mutates when viewport is null', () => {
    // Sanity: a concrete viewport leaves emulation options untouched.
    const concrete = { viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true };
    assert.deepEqual(dropViewportIncompatibleOptions(concrete), []);
    assert.equal(concrete.deviceScaleFactor, 3);

    // viewport: null drops both incompatible options.
    const responsive: Record<string, unknown> = { viewport: null, deviceScaleFactor: 3, isMobile: true };
    assert.deepEqual(dropViewportIncompatibleOptions(responsive).sort(), ['deviceScaleFactor', 'isMobile']);
    assert.equal('deviceScaleFactor' in responsive, false);
    assert.equal('isMobile' in responsive, false);
  });
});
