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

function readDoc(): string {
  return readFileSync(path.join(REPO_ROOT, DOC_PATH), 'utf-8');
}

function collectTypeScript(dir: string, acc: string[] = []): string[] {
  for (const entry of readdirSync(path.join(REPO_ROOT, dir), { withFileTypes: true })) {
    const rel = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      collectTypeScript(rel, acc);
    } else if (entry.name.endsWith('.ts') || entry.name.endsWith('.tsx')) {
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

    const missing = documentedIdentifiers(doc).filter((name) => !source.includes(name));

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

  it('keeps the cloud report upload gated on both the flag and a token', () => {
    const doc = readDoc();
    const report = readFileSync(path.join(REPO_ROOT, 'apps/cli/src/commands/report.ts'), 'utf-8');

    // The page tells users `shiplight report` is safe to run without a token.
    // That holds only while the upload needs both conditions.
    assert.match(report, /if \(!isReportToCloudEnabled\(\)\) return;/);
    assert.match(report, /if \(!apiToken\) \{/);
    assert.match(doc, /SHIPLIGHT_REPORT_TO_CLOUD/);
    assert.match(doc, /SHIPLIGHT_API_TOKEN/);
  });
});
