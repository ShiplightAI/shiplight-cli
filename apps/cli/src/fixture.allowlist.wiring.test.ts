import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/**
 * No-bypass wiring guard for the SDK env allowlist.
 *
 * Closes the runtime-wiring residual risk of quality-evidence check
 * exp-env-allowlist (002-shiplightai-cli). `buildSdkEnv()` is already proven in
 * isolation (fixture.allowlist.test.ts), but the security seam only holds if the
 * REAL agent path actually configures the SDK through `buildSdkEnv()` and never
 * leaks `process.env` into the SDK config. The agent fixture is a Playwright
 * fixture (only exercisable with a live browser, i.e. the e2e lane), so this is a
 * CI-gateable source-integrity guard — the same approach the repo uses for the
 * sibling context-option drift guard (fixture.contextOptions.test.ts).
 *
 * If someone changes the agent fixture to feed the SDK from process.env (or any
 * source other than buildSdkEnv), this test fails.
 */

const FIXTURE_PATH = fileURLToPath(new URL('./fixture.ts', import.meta.url));

// Strip comments so explanatory prose mentioning process.env / buildSdkEnv can't
// create false positives or mask a real regression.
function stripComments(src: string): string {
  const noBlock = src.replace(/\/\*[\s\S]*?\*\//g, '');
  // Remove // line comments but protect URL "://" sequences.
  return noBlock.replace(/(^|[^:])\/\/[^\n]*/g, '$1');
}

const code = stripComments(readFileSync(FIXTURE_PATH, 'utf8'));

describe('SDK env allowlist — runtime wiring (no bypass)', () => {
  it('configures the SDK env exclusively via buildSdkEnv()', () => {
    // The fixture binds the map once and reuses it, because the log level is
    // parsed from that same allowlisted map rather than process.env. Both
    // halves are asserted so the binding cannot be swapped for another source.
    assert.match(
      code,
      /const\s+sdkEnv\s*=\s*buildSdkEnv\(\s*\)/,
      'The agent fixture must build the SDK env via buildSdkEnv().'
    );
    assert.match(
      code,
      /configureSdk\(\s*\{\s*env:\s*sdkEnv\b/,
      'The agent fixture must pass that buildSdkEnv() result to configureSdk. ' +
        'If this fails, the SDK env wiring changed — re-verify the allowlist is still the only source.'
    );
  });

  it('never feeds the SDK env from process.env (directly or spread)', () => {
    assert.doesNotMatch(
      code,
      /env:\s*process\.env/,
      'SDK env must never be set to process.env — that bypasses the allowlist.'
    );
    assert.doesNotMatch(
      code,
      /env:\s*\{\s*\.\.\.\s*process\.env/,
      'SDK env must never spread process.env — that bypasses the allowlist.'
    );
    assert.doesNotMatch(
      code,
      /configureSdk\([^)]*process\.env/,
      'configureSdk must not be passed process.env in any form.'
    );
  });

  it('has exactly one configureSdk call, and it uses buildSdkEnv()', () => {
    const calls = code.match(/configureSdk\(/g) ?? [];
    assert.equal(
      calls.length,
      1,
      `Expected exactly one configureSdk() call in fixture.ts, found ${calls.length}. ` +
        'A second call could configure the SDK env through a different (unguarded) source.'
    );
  });
});
