import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { isBrokenPipe, formatThrown, createStderrConsole } from './stdioGuards.js';

describe('isBrokenPipe', () => {
  it('is true for an EPIPE error object', () => {
    assert.equal(isBrokenPipe({ code: 'EPIPE' }), true);
    const err = Object.assign(new Error('write EPIPE'), { code: 'EPIPE' });
    assert.equal(isBrokenPipe(err), true);
  });

  it('is false for other errors / non-objects', () => {
    assert.equal(isBrokenPipe({ code: 'ECONNRESET' }), false);
    assert.equal(isBrokenPipe(new Error('nope')), false);
    assert.equal(isBrokenPipe(null), false);
    assert.equal(isBrokenPipe('EPIPE'), false);
    assert.equal(isBrokenPipe(undefined), false);
  });
});

describe('formatThrown', () => {
  it('renders an Error as its stack (or name: message)', () => {
    const err = new Error('boom');
    const out = formatThrown(err);
    assert.match(out, /boom/);
  });

  it('renders a plain object as JSON', () => {
    assert.equal(formatThrown({ a: 1, b: 'x' }), '{"a":1,"b":"x"}');
  });

  it('falls back to String() for a circular object without throwing', () => {
    const circular: Record<string, unknown> = {};
    circular.self = circular;
    assert.doesNotThrow(() => formatThrown(circular));
    assert.equal(formatThrown(circular), '[object Object]');
  });

  it('renders primitives via String()', () => {
    assert.equal(formatThrown(5), '5');
    assert.equal(formatThrown('hello'), 'hello');
    assert.equal(formatThrown(null), 'null');
    assert.equal(formatThrown(undefined), 'undefined');
  });
});

describe('createStderrConsole', () => {
  it('routes all args to the injected writer (stderr in prod), never stdout', () => {
    const writes: string[] = [];
    const log = createStderrConsole((msg) => writes.push(msg));

    log('hello', 'world');
    assert.deepEqual(writes, ['hello world\n']);
  });

  it('formats non-string args through formatThrown', () => {
    const writes: string[] = [];
    const log = createStderrConsole((msg) => writes.push(msg));

    log('count', { n: 2 }, 7);
    assert.equal(writes[0], 'count {"n":2} 7\n');
  });

  it('emits a single newline-terminated record per call', () => {
    const writes: string[] = [];
    const log = createStderrConsole((msg) => writes.push(msg));

    log('a');
    log('b');
    assert.deepEqual(writes, ['a\n', 'b\n']);
  });
});

describe('stdio transport integrity (server install pattern)', () => {
  it('redirected console.* never writes to process.stdout', () => {
    // Mirror server.ts: console.log/info/debug = createStderrConsole(stderrWriter).
    const stderr: string[] = [];
    const stderrConsole = createStderrConsole((m) => stderr.push(m));

    const origLog = console.log;
    const origInfo = console.info;
    const origDebug = console.debug;
    const origStdoutWrite = process.stdout.write;
    let stdoutBytes = 0;
    // Spy on stdout: any write here would corrupt the JSON-RPC channel.
    (process.stdout as unknown as { write: (...a: unknown[]) => boolean }).write = ((chunk: unknown) => {
      stdoutBytes += String(chunk).length;
      return true;
    });
    console.log = stderrConsole as typeof console.log;
    console.info = stderrConsole as typeof console.info;
    console.debug = stderrConsole as typeof console.debug;

    try {
      // Simulate a dependency/tool logging during a call.
      console.log('rogue dependency output');
      console.info({ noisy: true });
      console.debug('trace');
    } finally {
      console.log = origLog;
      console.info = origInfo;
      console.debug = origDebug;
      (process.stdout as unknown as { write: typeof origStdoutWrite }).write = origStdoutWrite;
    }

    assert.equal(stdoutBytes, 0, 'nothing must reach stdout (would corrupt JSON-RPC)');
    assert.equal(stderr.length, 3, 'all console output is captured on the stderr writer');
    assert.match(stderr[0], /rogue dependency output\n$/);
  });
});
