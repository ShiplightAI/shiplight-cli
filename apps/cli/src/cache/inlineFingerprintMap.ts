/**
 * Statement UID → inline-entity fingerprint, handed from the transpile pass to the
 * post-run cache write-back.
 *
 * A healed action entity is only worth caching together with a record of what it
 * superseded (see `fingerprintActionEntity`), but the two facts are known in different
 * processes: the inline entity is visible only to the transpiler, which runs while
 * `playwright.config.ts` is loaded in the SPAWNED Playwright process, while the write-back
 * runs in the parent `shiplight test` process after Playwright exits. A file on disk is
 * the seam.
 *
 * Deliberately sourced from the transpiler's own observer rather than by re-parsing YAML
 * in the parent: hook statements (`beforeEach`, `afterAll`, …) are parsed separately and
 * re-keyed with hook-name prefixes inside `transpileFile`, so any re-derivation would have
 * to duplicate that prefixing and would silently miss every hook heal the day it drifted.
 *
 * MERGED, not replaced, on each pass. The transpiler's mtime skip means a pass need not
 * walk every file, and a statement healed this run may have been transpiled by an earlier
 * one. UIDs are stable and position-derived, so merging only ever accumulates statements
 * that genuinely exist; a UID that later disappears is harmless, since lookups only ask
 * about statements that actually healed.
 */

import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { dirname, join } from 'path';

/** Location of the map, relative to the project root. */
export function inlineFingerprintMapPath(cwd: string): string {
  return join(cwd, '.shiplight', 'inline-fingerprints.json');
}

/** Read the map, or an empty one when absent or unreadable. */
export function readInlineFingerprintMap(cwd: string): Record<string, string> {
  try {
    const parsed = JSON.parse(readFileSync(inlineFingerprintMapPath(cwd), 'utf-8'));
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

/**
 * Merge `fingerprints` into the on-disk map.
 *
 * Never throws: an unwritable `.shiplight/` must not fail a test run. The cost of losing
 * the map is that entries go unstamped, which is the grandfathered path — degraded, not
 * broken.
 */
export function mergeInlineFingerprintMap(cwd: string, fingerprints: Record<string, string>): void {
  if (Object.keys(fingerprints).length === 0) return;
  try {
    const merged = { ...readInlineFingerprintMap(cwd), ...fingerprints };
    const target = inlineFingerprintMapPath(cwd);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, JSON.stringify(merged, null, 2));
  } catch {
    // Best effort — see docstring.
  }
}
