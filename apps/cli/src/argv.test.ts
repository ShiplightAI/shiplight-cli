import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { looksLikeFlag, takeFlagValues } from './argv.js';

describe('takeFlagValues', () => {
  it('returns no occurrences when the flag is absent', () => {
    const { occurrences, remaining } = takeFlagValues(['--open', 'folder'], '--trigger');
    assert.deepEqual(occurrences, []);
    assert.deepEqual(remaining, ['--open', 'folder']);
  });

  it('takes the space-separated form and removes both tokens', () => {
    const { occurrences, remaining } = takeFlagValues(['--trigger', 'Jenkins', '--open'], '--trigger');
    assert.deepEqual(occurrences, [{ value: 'Jenkins', inline: false }]);
    assert.deepEqual(remaining, ['--open']);
  });

  it('takes the inline form and marks it as such', () => {
    const { occurrences, remaining } = takeFlagValues(['--trigger=Jenkins'], '--trigger');
    assert.deepEqual(occurrences, [{ value: 'Jenkins', inline: true }]);
    assert.deepEqual(remaining, []);
  });

  it('reports a missing value at the end of argv', () => {
    const { occurrences, remaining } = takeFlagValues(['folder', '--trigger'], '--trigger');
    assert.deepEqual(occurrences, [{ inline: false }]);
    assert.deepEqual(remaining, ['folder']);
  });

  it('never swallows a following double-dash flag', () => {
    const { occurrences, remaining } = takeFlagValues(['--trigger', '--open'], '--trigger');
    assert.deepEqual(occurrences, [{ inline: false }]);
    assert.deepEqual(remaining, ['--open'], 'the flag must still reach its own parser');
  });

  it('never swallows a following single-dash flag', () => {
    // The rule both hand-rolled parsers used to disagree on. `-o` is a real
    // flag; taking it as a value silently drops the output directory.
    const { occurrences, remaining } = takeFlagValues(['--trigger', '-o', 'out/'], '--trigger');
    assert.deepEqual(occurrences, [{ inline: false }]);
    assert.deepEqual(remaining, ['-o', 'out/']);
  });

  it('allows a dash-prefixed value through the inline spelling', () => {
    const { occurrences } = takeFlagValues(['--trigger=-nightly'], '--trigger');
    assert.deepEqual(occurrences, [{ value: '-nightly', inline: true }]);
  });

  it('keeps an empty inline value distinguishable from a missing one', () => {
    // `--trigger=` gave a value (the empty string); `--trigger` gave none.
    // Callers treat both as blank, but only after seeing the difference.
    const { occurrences } = takeFlagValues(['--trigger='], '--trigger');
    assert.deepEqual(occurrences, [{ value: '', inline: true }]);
  });

  it('returns every occurrence in command-line order', () => {
    const { occurrences } = takeFlagValues(['--trigger', 'A', '--trigger=B', '--trigger'], '--trigger');
    assert.deepEqual(occurrences, [
      { value: 'A', inline: false },
      { value: 'B', inline: true },
      { inline: false },
    ]);
  });

  it('does not match a longer flag that shares the prefix', () => {
    // `--vars` must not consume `--vars-file` or its value.
    const { occurrences, remaining } = takeFlagValues(['--vars-file', 'a.json', '--vars', 'K=1'], '--vars');
    assert.deepEqual(occurrences, [{ value: 'K=1', inline: false }]);
    assert.deepEqual(remaining, ['--vars-file', 'a.json']);
  });

  it('does not match a longer inline flag that shares the prefix', () => {
    const { occurrences, remaining } = takeFlagValues(['--vars-file=a.json'], '--vars');
    assert.deepEqual(occurrences, []);
    assert.deepEqual(remaining, ['--vars-file=a.json']);
  });

  it('leaves positional arguments untouched', () => {
    const { remaining } = takeFlagValues(['shard-0/', '--trigger', 'CI', 'shard-1/'], '--trigger');
    assert.deepEqual(remaining, ['shard-0/', 'shard-1/']);
  });
});

describe('looksLikeFlag', () => {
  it('treats both dash counts as flags', () => {
    assert.equal(looksLikeFlag('--merge'), true);
    assert.equal(looksLikeFlag('-o'), true);
  });

  it('treats paths as paths', () => {
    assert.equal(looksLikeFlag('shiplight-report'), false);
    assert.equal(looksLikeFlag('./-nightly'), false, 'the documented escape for a dash-leading path');
    assert.equal(looksLikeFlag('/abs/path'), false);
  });
});
