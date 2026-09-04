import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { OUTPUT_FORMAT_REVISION, TRANSPILER_CACHE_KEY, TRANSPILER_VERSION } from './version';

describe('transpiler cache key', () => {
  it('combines the package version with the output-format revision', () => {
    assert.equal(TRANSPILER_CACHE_KEY, `${TRANSPILER_VERSION}+fmt${OUTPUT_FORMAT_REVISION}`);
  });

  it('pins the current output-format revision', () => {
    // Deliberate change detector. `TRANSPILER_VERSION` is always `dev` when the
    // CLI runs from source, so it cannot invalidate already-generated
    // `.yaml.spec.ts` files when the emitted code changes shape — only this
    // revision can. If you changed what the transpiler emits, bump the constant
    // and this number together; nothing else catches a forgotten bump.
    assert.equal(OUTPUT_FORMAT_REVISION, 2);
  });

  it('is a single line with no whitespace, so it cannot break the header comment', () => {
    assert.doesNotMatch(TRANSPILER_CACHE_KEY, /\s/);
  });
});
