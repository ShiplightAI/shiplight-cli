import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { parseDebugArgs } from './debug.js';

describe('parseDebugArgs', () => {
  it('applies defaults with no args', () => {
    assert.deepEqual(parseDebugArgs([]), {
      port: 6174,
      portExplicit: false,
      createNew: false,
      noBrowser: true,
      headed: false,
      offline: false,
      help: false,
    });
  });

  it('recognizes --offline (drives the tier pre-flight skip)', () => {
    assert.equal(parseDebugArgs(['--offline']).offline, true);
    assert.equal(parseDebugArgs([]).offline, false);
  });

  it('parses --port <n> and marks it explicit', () => {
    const a = parseDebugArgs(['--port', '7000']);
    assert.equal(a.port, 7000);
    assert.equal(a.portExplicit, true);
  });

  it('parses --url, --new, --headed', () => {
    const a = parseDebugArgs(['--url', 'https://x.test', '--new', '--headed']);
    assert.equal(a.startingUrl, 'https://x.test');
    assert.equal(a.createNew, true);
    assert.equal(a.headed, true);
  });

  it('toggles noBrowser via --open / --no-open (default true)', () => {
    assert.equal(parseDebugArgs(['--open']).noBrowser, false);
    assert.equal(parseDebugArgs(['--no-open']).noBrowser, true);
    assert.equal(parseDebugArgs([]).noBrowser, true);
  });

  it('returns help as a flag rather than exiting (pure)', () => {
    assert.equal(parseDebugArgs(['--help']).help, true);
    assert.equal(parseDebugArgs(['-h']).help, true);
    assert.equal(parseDebugArgs([]).help, false);
  });

  it('takes the first non-flag argument as the target path', () => {
    assert.equal(parseDebugArgs(['tests/login.test.yaml']).targetPath, 'tests/login.test.yaml');
    assert.equal(parseDebugArgs([]).targetPath, undefined);
  });

  it('handles a realistic combined invocation', () => {
    const a = parseDebugArgs(['tests/a.test.yaml', '--offline', '--headed', '--port', '6200']);
    assert.equal(a.targetPath, 'tests/a.test.yaml');
    assert.equal(a.offline, true);
    assert.equal(a.headed, true);
    assert.equal(a.port, 6200);
    assert.equal(a.portExplicit, true);
    assert.equal(a.help, false);
  });
});
