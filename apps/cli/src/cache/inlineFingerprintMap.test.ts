/**
 * The UID → inline-fingerprint map, and the write-back stamping that consumes it.
 *
 * The map is the seam between the spawned Playwright process (the only one that sees the
 * YAML's own action entities) and the parent's post-run cache write-back. If it is lost,
 * entries go unstamped and fall back to the grandfathered path — degraded, never wrong.
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import * as assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, readFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import type { ActionStoreEntry } from 'shiplight-types';
import {
  inlineFingerprintMapPath,
  readInlineFingerprintMap,
  mergeInlineFingerprintMap,
} from './inlineFingerprintMap.js';
import { selectStampedFileEntries } from '../commands/test.js';

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'inline-fp-'));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe('inline fingerprint map', () => {
  it('round-trips what it wrote', () => {
    mergeInlineFingerprintMap(dir, { 'uid-a': '{"locator":"x"}' });
    assert.deepEqual(readInlineFingerprintMap(dir), { 'uid-a': '{"locator":"x"}' });
  });

  it('merges rather than replaces, so a pass that skipped files keeps their entries', () => {
    // The transpiler's mtime skip means one pass need not walk every file, while a
    // statement healed this run may have been transpiled by an earlier one.
    mergeInlineFingerprintMap(dir, { 'uid-a': 'A', 'uid-b': 'B' });
    mergeInlineFingerprintMap(dir, { 'uid-b': 'B2', 'uid-c': 'C' });
    assert.deepEqual(readInlineFingerprintMap(dir), { 'uid-a': 'A', 'uid-b': 'B2', 'uid-c': 'C' });
  });

  it('preserves the empty-string fingerprint, which means "superseded nothing"', () => {
    mergeInlineFingerprintMap(dir, { 'uid-a': '' });
    assert.deepEqual(readInlineFingerprintMap(dir), { 'uid-a': '' });
  });

  it('writes nothing for an empty batch', () => {
    mergeInlineFingerprintMap(dir, {});
    assert.deepEqual(readInlineFingerprintMap(dir), {});
  });

  it('reads an absent, malformed, or non-object file as empty', () => {
    assert.deepEqual(readInlineFingerprintMap(dir), {});

    const target = inlineFingerprintMapPath(dir);
    mkdirSync(join(dir, '.shiplight'), { recursive: true });
    writeFileSync(target, 'not json{');
    assert.deepEqual(readInlineFingerprintMap(dir), {});

    writeFileSync(target, '["a"]');
    assert.deepEqual(readInlineFingerprintMap(dir), {}, 'an array is not a map');
  });

  it('does not throw when the target cannot be written', () => {
    // A read-only project directory must degrade to the grandfathered path, not fail a run.
    const file = join(dir, 'not-a-dir');
    writeFileSync(file, 'x');
    assert.doesNotThrow(() => mergeInlineFingerprintMap(file, { 'uid-a': 'A' }));
  });

  it('merges on top of a corrupt file instead of throwing', () => {
    mkdirSync(join(dir, '.shiplight'), { recursive: true });
    writeFileSync(inlineFingerprintMapPath(dir), '}{');
    mergeInlineFingerprintMap(dir, { 'uid-a': 'A' });
    assert.deepEqual(JSON.parse(readFileSync(inlineFingerprintMapPath(dir), 'utf-8')), { 'uid-a': 'A' });
  });
});

describe('selectStampedFileEntries', () => {
  const entry = (locator: string): ActionStoreEntry => ({
    action_entity: { action_description: 'd', action_data: { action_name: 'click', kwargs: {} }, locator },
    updated_at: '2026-01-01T00:00:00.000Z',
    updated_by: { source: 'runner', test_run_id: 1 },
  });

  it('keeps only the UIDs the spec mentions', () => {
    const out = selectStampedFileEntries(
      { 'uid-a': entry('a'), 'uid-b': entry('b') },
      'await agent.step(page, fn, "d", "s1", \'uid-a\', true);',
      {},
    );
    assert.deepEqual(Object.keys(out), ['uid-a']);
  });

  it('stamps the fingerprint the transpiler recorded', () => {
    const out = selectStampedFileEntries({ 'uid-a': entry('a') }, 'uid-a', { 'uid-a': '{"locator":"old"}' });
    assert.equal(out['uid-a'].source_fingerprint, '{"locator":"old"}');
  });

  it('stamps the empty string rather than dropping it', () => {
    // '' means the statement had no inline entity — a real fingerprint, not a missing one.
    const out = selectStampedFileEntries({ 'uid-a': entry('a') }, 'uid-a', { 'uid-a': '' });
    assert.equal(out['uid-a'].source_fingerprint, '');
  });

  it('leaves an entry unstamped when the map has no record of it', () => {
    // Grandfathered, not guessed: a wrong stamp would refuse a valid entry forever.
    const out = selectStampedFileEntries({ 'uid-a': entry('a') }, 'uid-a', {});
    assert.equal('source_fingerprint' in out['uid-a'], false);
  });

  it('does not mutate the entry it was given', () => {
    const input = entry('a');
    selectStampedFileEntries({ 'uid-a': input }, 'uid-a', { 'uid-a': 'F' });
    assert.equal('source_fingerprint' in input, false);
  });
});
