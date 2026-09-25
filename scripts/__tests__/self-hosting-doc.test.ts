import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const DOC_PATH = 'apps/cli/docs/self-hosting.md';

/**
 * Directories the self-hosting page describes. The page is the only place that
 * tells a self-hosting user which knobs exist, so a rename anywhere in here has
 * to reach it.
 */
const SOURCE_ROOTS = [
  'apps/cli/src',
  'packages/types/src',
  'packages/telemetry/src',
];

/**
 * Names the page may use that belong to somebody else — Playwright, the runner,
 * the shell — so documenting one is not evidence of a stale Shiplight symbol.
 * Without this the guard fires on the next CI snippet the page grows.
 */
const EXTERNAL_IDENTIFIERS = new Set([
  'CI',
  'DO_NOT_TRACK',
  'GITHUB_TOKEN',
  'NODE_OPTIONS',
  'PLAYWRIGHT_BROWSERS_PATH',
]);

function readDoc(): string {
  return readFileSync(path.join(REPO_ROOT, DOC_PATH), 'utf-8');
}

/**
 * Production sources only. A name kept alive solely by a test fixture is exactly
 * the stale reference this guard exists to catch, so counting test files as
 * evidence would defeat it.
 */
function collectTypeScript(dir: string, acc: string[] = []): string[] {
  for (const entry of readdirSync(path.join(REPO_ROOT, dir), { withFileTypes: true })) {
    const rel = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      collectTypeScript(rel, acc);
    } else if (/\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name)) {
      acc.push(readFileSync(path.join(REPO_ROOT, rel), 'utf-8'));
    }
  }
  return acc;
}

/** Every SCREAMING_SNAKE_CASE token the doc names. */
function documentedIdentifiers(doc: string): string[] {
  const matches = doc.match(/\b[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+\b/g) ?? [];
  return [...new Set(matches)];
}

/**
 * The self-hosting page is the one document a user follows with no Shiplight
 * account behind them: a stale env var name there does not degrade the setup,
 * it silently leaves the run pointed at a default the page told them they had
 * overridden. `SHIPLIGHT_ACTION_CACHE_BACKEND` is the sharpest case — misspell
 * it and the backend quietly falls back to `auto`, which sends the cache to
 * Shiplight Cloud the moment a token is present.
 *
 * These guards are deliberately shallow. They prove the names the page hands a
 * user still exist in the source; they do not re-test the behaviour behind them,
 * which is covered where that behaviour lives.
 */
describe('self-hosting documentation', () => {
  it('names only environment variables and symbols that exist in the source', () => {
    const doc = readDoc();
    const source = SOURCE_ROOTS.flatMap((root) => collectTypeScript(root)).join('\n');
    const documented = documentedIdentifiers(doc).filter((name) => !EXTERNAL_IDENTIFIERS.has(name));

    // Without a floor the whole guard passes vacuously: empty the page, or
    // restructure it so no SCREAMING_SNAKE token survives, and `missing` is []
    // while nothing at all has been checked.
    assert.ok(
      documented.length >= 5,
      `expected ${DOC_PATH} to document several identifiers, found ${documented.length} — has the page been emptied or restructured?`
    );

    // Word-bounded, not a substring: `SHIPLIGHT_TELEMETRY` is a strict prefix of
    // `SHIPLIGHT_TELEMETRY_HOST`, so `includes` would let the shorter name
    // survive its own deletion on the strength of the longer one.
    const missing = documented.filter((name) => !new RegExp(`\\b${name}\\b`).test(source));

    assert.deepEqual(
      missing,
      [],
      `${DOC_PATH} names identifiers no longer present in ${SOURCE_ROOTS.join(', ')}: ${missing.join(', ')}`
    );
  });

  it('documents exactly the action cache backends the CLI accepts', () => {
    const doc = readDoc();
    const store = readFileSync(
      path.join(REPO_ROOT, 'apps/cli/src/cache/actionEntityCacheStore.ts'),
      'utf-8'
    );

    // The error message in createActionEntityCache is the authoritative list.
    const accepted = store.match(
      /SHIPLIGHT_ACTION_CACHE_BACKEND must be ([a-z, ]+?)\./
    );
    assert.ok(accepted, 'createActionEntityCache must reject unknown backends by name');

    const values = accepted[1]
      .split(',')
      .map((v) => v.trim().replace(/^or\s+/, ''))
      .filter(Boolean);
    assert.deepEqual(values.slice().sort(), ['auto', 'cloud', 'local']);

    for (const value of values) {
      assert.match(
        doc,
        new RegExp(`\`${value}\``),
        `${DOC_PATH} must document the \`${value}\` backend`
      );
    }
  });

  it('points at the action cache directory the local backend actually uses', () => {
    const doc = readDoc();
    const store = readFileSync(
      path.join(REPO_ROOT, 'apps/cli/src/cache/actionEntityCacheStore.ts'),
      'utf-8'
    );

    const dir = store.match(/const CACHE_DIR = '([^']+)'/);
    assert.ok(dir, 'LocalActionEntityCache must define CACHE_DIR');
    assert.ok(
      doc.includes(dir[1]),
      `${DOC_PATH} must reference the real cache directory (${dir[1]}) — CI cache steps in the page restore and save that exact path`
    );
  });

  it('names every variable that can switch the cloud report upload on', async () => {
    const doc = readDoc();

    // The page tells a self-hoster `shiplight report` is safe to run, so it has
    // to name every variable that flips the upload on. `isReportToCloudEnabled`
    // honours a legacy alias as well as the canonical name; the page missed it
    // once already, and a runner image carrying the old one would upload.
    const { isReportToCloudEnabled } = await import('../../apps/cli/src/commands/report.ts');
    const flags = ['SHIPLIGHT_REPORT_TO_CLOUD', 'REPORT_TO_CLOUD'];

    for (const flag of flags) {
      const previous = process.env[flag];
      try {
        delete process.env.SHIPLIGHT_REPORT_TO_CLOUD;
        delete process.env.REPORT_TO_CLOUD;
        process.env[flag] = '1';
        assert.equal(
          isReportToCloudEnabled(),
          true,
          `${flag} no longer enables the upload — drop it from ${DOC_PATH} if it is gone`
        );
      } finally {
        delete process.env[flag];
        if (previous !== undefined) process.env[flag] = previous;
      }
    }

    for (const flag of flags) {
      assert.match(
        doc,
        new RegExp(`\\b${flag}\\b`),
        `${DOC_PATH} must name ${flag} — it switches the cloud upload on`
      );
    }

    // The token is the second half of the gate the page relies on.
    assert.match(doc, /\bSHIPLIGHT_API_TOKEN\b/);
  });
});
