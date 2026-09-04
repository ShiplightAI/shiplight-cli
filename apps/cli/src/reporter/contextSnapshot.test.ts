import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { capVariableSnapshot, VARIABLE_VALUE_LIMIT } from './contextSnapshot.js';

describe('capVariableSnapshot', () => {
  it('returns the snapshot untouched when every value is small', () => {
    const snapshot = { user: 'a@example.com', count: 3, nested: { ok: true } };
    assert.equal(capVariableSnapshot(snapshot), snapshot);
  });

  it('truncates an oversized string, keeping its head and original length', () => {
    const value = 'x'.repeat(5000);
    const capped = capVariableSnapshot({ page: value });
    const result = capped.page as string;

    assert.notEqual(capped, undefined);
    assert.ok(result.startsWith('x'.repeat(VARIABLE_VALUE_LIMIT)));
    assert.ok(result.endsWith('[truncated, 5000 chars]'), 'the count is the original total, not the amount dropped');
    assert.equal(result.slice(0, VARIABLE_VALUE_LIMIT), 'x'.repeat(VARIABLE_VALUE_LIMIT));
    assert.ok(result.length < value.length);
  });

  it('measures a string in its own characters, not in the characters of its JSON', () => {
    // 600 quotes JSON-encode to 1202 characters. Measuring the threshold in JSON
    // units while keeping a prefix in raw units capped values that were never
    // oversized, and reported a length the prefix did not match.
    const quotes = '"'.repeat(600);
    assert.equal(capVariableSnapshot({ quotes }).quotes, quotes);
  });

  it('leaves a value alone when the marker would not be shorter', () => {
    // Just above the limit the marker costs more than the characters it drops;
    // replacing there made the report bigger.
    const justOver = 'a'.repeat(VARIABLE_VALUE_LIMIT + 5);
    const recorded = capVariableSnapshot({ justOver }).justOver as string;
    assert.equal(recorded, justOver);

    const wellOver = 'a'.repeat(VARIABLE_VALUE_LIMIT * 3);
    const cappedValue = capVariableSnapshot({ wellOver }).wellOver as string;
    assert.ok(cappedValue.length < wellOver.length);
  });

  it('truncates an oversized object to a marker that still identifies it', () => {
    // The shape that made one test 87 MB: a Node Buffer, which JSON-encodes as
    // a per-byte number array.
    const buffer = { type: 'Buffer', data: Array.from({ length: 4000 }, () => 35) };
    const capped = capVariableSnapshot({ exportedBuffers: { md: buffer } });
    const result = capped.exportedBuffers as string;

    assert.equal(typeof result, 'string');
    assert.ok(result.startsWith(`[truncated, ${JSON.stringify({ md: buffer }).length} chars] `), result.slice(0, 40));
    assert.ok(result.includes('{"md":{"type":"Buffer"'));
    assert.ok(JSON.stringify(result).length < 1400);
  });

  it('caps only the oversized keys and copies rather than mutates', () => {
    const original = { small: 'ok', big: 'y'.repeat(3000) };
    const capped = capVariableSnapshot(original);

    assert.equal(capped.small, 'ok');
    assert.notEqual(capped.big, original.big);
    assert.equal(original.big.length, 3000, 'input must not be mutated');
    assert.notEqual(capped, original);
  });

  it('honors an explicit limit', () => {
    const snapshot = { value: 'z'.repeat(100) };
    assert.equal(capVariableSnapshot(snapshot, 10_000), snapshot);
    assert.notEqual(capVariableSnapshot(snapshot, 50), snapshot);
  });

  it('leaves values JSON.stringify cannot measure alone', () => {
    const snapshot = { fn: () => {}, missing: undefined };
    assert.equal(capVariableSnapshot(snapshot), snapshot);
  });

  it('keeps a value exactly at the limit', () => {
    // `"…"` — the JSON of an n-char string is n + 2 chars.
    const snapshot = { edge: 'a'.repeat(VARIABLE_VALUE_LIMIT - 2) };
    assert.equal(capVariableSnapshot(snapshot), snapshot);
  });
});
