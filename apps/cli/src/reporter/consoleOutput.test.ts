import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { MAX_CONSOLE_CONTENT_CHARS, captureConsoleOutput } from './consoleOutput.js';

describe('captureConsoleOutput', () => {
  it('joins string chunks in order', () => {
    assert.equal(captureConsoleOutput(['first ', 'second ', 'third']), 'first second third');
  });

  it('decodes Buffer chunks, which is what Playwright hands back for piped output', () => {
    assert.equal(
      captureConsoleOutput([Buffer.from('from a buffer'), ' and a string']),
      'from a buffer and a string',
    );
  });

  it('returns undefined for no output, so the field is omitted', () => {
    // Not `''` — an empty string would ship a key on every silent test.
    assert.equal(captureConsoleOutput([]), undefined);
    assert.equal(captureConsoleOutput(['']), undefined);
  });

  it('keeps output that fits under the cap untouched', () => {
    const text = 'x'.repeat(MAX_CONSOLE_CONTENT_CHARS);
    assert.equal(captureConsoleOutput([text]), text);
  });

  it('truncates past the cap and says how much it dropped', () => {
    // Uncapped, one chatty test can dominate report-data.json and the upload.
    const text = 'x'.repeat(MAX_CONSOLE_CONTENT_CHARS + 500);
    const result = captureConsoleOutput([text]);

    assert.ok(result);
    assert.ok(result.startsWith('[shiplight] 500 earlier character(s) truncated\n'));
  });

  it('caps the content, with the marker on top of it', () => {
    // The constant bounds the kept output, not the returned string — the
    // marker adds ~50 bytes. Naming it CONTENT rather than OUTPUT keeps that
    // honest, and this pins the relationship so it cannot drift.
    const marker = '[shiplight] 500 earlier character(s) truncated\n';
    const result = captureConsoleOutput(['x'.repeat(MAX_CONSOLE_CONTENT_CHARS + 500)]);

    assert.ok(result);
    assert.equal(result.length, MAX_CONSOLE_CONTENT_CHARS + marker.length);
    assert.equal(result.slice(marker.length).length, MAX_CONSOLE_CONTENT_CHARS);
  });

  it('keeps the tail, where a failing test printed the useful part', () => {
    const result = captureConsoleOutput(['NOISE'.repeat(100) + 'THE ACTUAL ERROR'], 20);

    assert.ok(result);
    assert.ok(result.endsWith('THE ACTUAL ERROR'));
    assert.equal(result.includes('NOISE'.repeat(100)), false);
  });

  it('caps the joined total, not each chunk', () => {
    // Playwright delivers output in many small writes; capping per chunk would
    // never trigger no matter how much a test printed.
    const chunks = Array.from({ length: 10 }, () => 'y'.repeat(10));
    const result = captureConsoleOutput(chunks, 25);

    assert.ok(result);
    assert.ok(result.startsWith('[shiplight] 75 earlier character(s) truncated\n'));
  });
});
