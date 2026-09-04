import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { runInspect } from './inspect.js';

/**
 * Tests for `shiplight inspect`.
 *
 * Closes quality-evidence gap exp-inspect-command (002-shiplightai-cli): the
 * inspect command previously had no test. It parses a YAML test file and prints
 * the resulting TestFlow JSON (or stats), and must fail cleanly on a bad path.
 *
 * runInspect drives console + process.exit directly, so we capture console output
 * and make process.exit throw a catchable sentinel (otherwise it would kill the
 * test runner).
 */

const VALID_YAML = `
goal: Login and verify dashboard
base_url: https://app.example.com
statements:
  - intent: Enter username
  - intent: Enter password
  - intent: Click login button
`;

class ExitError extends Error {
  constructor(public code: number | undefined) {
    super(`process.exit(${code})`);
  }
}

let logs: string[];
let errs: string[];
let origLog: typeof console.log;
let origErr: typeof console.error;
let origExit: typeof process.exit;
let tmp: string;

beforeEach(() => {
  logs = [];
  errs = [];
  origLog = console.log;
  origErr = console.error;
  origExit = process.exit;
  console.log = (...a: unknown[]) => { logs.push(a.join(' ')); };
  console.error = (...a: unknown[]) => { errs.push(a.join(' ')); };
  process.exit = ((code?: number) => { throw new ExitError(code); }) as typeof process.exit;
  tmp = mkdtempSync(path.join(tmpdir(), 'shiplight-inspect-'));
});

afterEach(() => {
  console.log = origLog;
  console.error = origErr;
  process.exit = origExit;
  rmSync(tmp, { recursive: true, force: true });
});

describe('shiplight inspect', () => {
  it('prints TestFlow JSON for a valid YAML file', async () => {
    const file = path.join(tmp, 'login.test.yaml');
    writeFileSync(file, VALID_YAML);

    await runInspect([file]);

    assert.equal(logs.length, 1, 'should print one JSON document');
    const output = JSON.parse(logs[0]);
    assert.equal(output.testFlow.goal, 'Login and verify dashboard');
    assert.equal(output.testFlow.statements.length, 3);
    assert.equal(output.testFlow.statements[0].type, 'DRAFT');
  });

  it('prints a stats summary with --stats', async () => {
    const file = path.join(tmp, 'login.test.yaml');
    writeFileSync(file, VALID_YAML);

    await runInspect([file, '--stats']);

    const out = logs.join('\n');
    assert.match(out, /Goal: Login and verify dashboard/);
    assert.match(out, /Statements: 3/);
    assert.match(out, /DRAFT: 3/);
  });

  it('exits non-zero with a clear error when the file is missing', async () => {
    const missing = path.join(tmp, 'does-not-exist.test.yaml');

    await assert.rejects(
      () => runInspect([missing]),
      (err: unknown) => err instanceof ExitError && err.code === 1,
    );
    assert.match(errs.join('\n'), /file not found/i);
  });

  it('exits non-zero on malformed YAML', async () => {
    const file = path.join(tmp, 'bad.test.yaml');
    writeFileSync(file, 'goal: Test\nstatements:\n  - 12345\n'); // plain scalar statement is invalid

    await assert.rejects(
      () => runInspect([file]),
      (err: unknown) => err instanceof ExitError && err.code === 1,
    );
    assert.match(errs.join('\n'), /Error parsing/i);
  });
});
