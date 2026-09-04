import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  loadShiplightEnv,
  readShiplightEnv,
  getShiplightEnv,
  findEnvFiles,
  applyShiplightEnvToProcess,
  __setShiplightEnvForTest,
} from './dotenvSource.js';

function makeTmpTree(): { root: string; cleanup: () => void } {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'shiplight-dotenv-test-'));
  return {
    root,
    cleanup: () => fs.rmSync(root, { recursive: true, force: true }),
  };
}

describe('findEnvFiles', () => {
  let tmp: ReturnType<typeof makeTmpTree>;
  let originalCwd: string;

  beforeEach(() => {
    tmp = makeTmpTree();
    originalCwd = process.cwd();
  });

  afterEach(() => {
    process.chdir(originalCwd);
    tmp.cleanup();
  });

  it('returns existing .env files closest-first up to project root', () => {
    fs.mkdirSync(path.join(tmp.root, 'sub', 'deep'), { recursive: true });
    fs.writeFileSync(path.join(tmp.root, '.env'), 'A=root\n');
    fs.writeFileSync(path.join(tmp.root, 'sub', '.env'), 'A=sub\n');
    fs.writeFileSync(path.join(tmp.root, 'sub', 'deep', '.env'), 'A=deep\n');

    process.chdir(tmp.root);
    const found = findEnvFiles(path.join(tmp.root, 'sub', 'deep'));

    assert.deepEqual(found, [
      path.join(tmp.root, 'sub', 'deep', '.env'),
      path.join(tmp.root, 'sub', '.env'),
      path.join(tmp.root, '.env'),
    ]);
  });

  it('returns empty array when no .env files exist', () => {
    process.chdir(tmp.root);
    const found = findEnvFiles(tmp.root);
    assert.deepEqual(found, []);
  });

  it('skips missing intermediate .env files silently', () => {
    fs.mkdirSync(path.join(tmp.root, 'a', 'b'), { recursive: true });
    fs.writeFileSync(path.join(tmp.root, '.env'), 'A=root\n');
    // No .env in 'a/' — should be skipped, not error.
    fs.writeFileSync(path.join(tmp.root, 'a', 'b', '.env'), 'A=leaf\n');

    process.chdir(tmp.root);
    const found = findEnvFiles(path.join(tmp.root, 'a', 'b'));

    assert.deepEqual(found, [
      path.join(tmp.root, 'a', 'b', '.env'),
      path.join(tmp.root, '.env'),
    ]);
  });
});

describe('loadShiplightEnv', () => {
  let tmp: ReturnType<typeof makeTmpTree>;
  let originalCwd: string;

  beforeEach(() => {
    tmp = makeTmpTree();
    originalCwd = process.cwd();
    __setShiplightEnvForTest(undefined);
  });

  afterEach(() => {
    process.chdir(originalCwd);
    tmp.cleanup();
    __setShiplightEnvForTest(undefined);
  });

  it('closest .env wins over parent .env (merge precedence)', () => {
    fs.mkdirSync(path.join(tmp.root, 'sub'), { recursive: true });
    fs.writeFileSync(path.join(tmp.root, '.env'), 'A=root\nB=root-only\n');
    fs.writeFileSync(path.join(tmp.root, 'sub', '.env'), 'A=sub\nC=sub-only\n');

    process.chdir(tmp.root);
    loadShiplightEnv(path.join(tmp.root, 'sub'));

    const env = getShiplightEnv();
    assert.equal(env.A, 'sub', 'closer .env should win');
    assert.equal(env.B, 'root-only', 'root-only key should be present');
    assert.equal(env.C, 'sub-only', 'closer-only key should be present');
  });

  it('exposes process.env values when no .env files exist (CI scenario)', () => {
    process.env.__SHIPLIGHT_TEST_PROBE = 'from-ci';
    try {
      process.chdir(tmp.root);
      loadShiplightEnv(tmp.root);

      const env = getShiplightEnv();
      assert.equal(env.__SHIPLIGHT_TEST_PROBE, 'from-ci');
    } finally {
      delete process.env.__SHIPLIGHT_TEST_PROBE;
    }
  });

  it('.env value overrides process.env value', () => {
    fs.writeFileSync(path.join(tmp.root, '.env'), 'MY_KEY=from-dotenv\n');
    process.env.MY_KEY = 'from-shell';
    try {
      process.chdir(tmp.root);
      loadShiplightEnv(tmp.root);

      const env = getShiplightEnv();
      assert.equal(env.MY_KEY, 'from-dotenv');
    } finally {
      delete process.env.MY_KEY;
    }
  });
});

describe('readShiplightEnv', () => {
  let tmp: ReturnType<typeof makeTmpTree>;
  let originalCwd: string;

  beforeEach(() => {
    tmp = makeTmpTree();
    originalCwd = process.cwd();
    __setShiplightEnvForTest(undefined);
  });

  afterEach(() => {
    process.chdir(originalCwd);
    tmp.cleanup();
    __setShiplightEnvForTest(undefined);
  });

  it('merges with the same precedence as loadShiplightEnv', () => {
    fs.mkdirSync(path.join(tmp.root, 'sub'), { recursive: true });
    fs.writeFileSync(path.join(tmp.root, '.env'), 'A=root\nB=root-only\n');
    fs.writeFileSync(path.join(tmp.root, 'sub', '.env'), 'A=sub\n');

    process.chdir(tmp.root);
    const env = readShiplightEnv(path.join(tmp.root, 'sub'));

    assert.equal(env.A, 'sub');
    assert.equal(env.B, 'root-only');
  });

  it('lets .env override the shell, so the CLI parent sees the token the child will', () => {
    fs.writeFileSync(path.join(tmp.root, '.env'), 'SHIPLIGHT_API_TOKEN=from-dotenv\n');
    process.env.SHIPLIGHT_API_TOKEN = 'from-shell';
    try {
      process.chdir(tmp.root);
      assert.equal(readShiplightEnv(tmp.root).SHIPLIGHT_API_TOKEN, 'from-dotenv');
    } finally {
      delete process.env.SHIPLIGHT_API_TOKEN;
    }
  });

  it('is pure — reading the view never installs it', () => {
    fs.writeFileSync(path.join(tmp.root, '.env'), 'MY_KEY=from-dotenv\n');
    process.chdir(tmp.root);

    readShiplightEnv(tmp.root);

    // Stash still unset, so getShiplightEnv falls through to process.env.
    // Installing the view is a separate, explicit step: `loadShiplightEnv`
    // sets the stash, `applyShiplightEnvToProcess` mutates process.env for
    // the CLI parent. Keeping the read pure is what lets a caller compare the
    // two views without side effects (the parity tests below do exactly that).
    assert.equal(getShiplightEnv().MY_KEY, undefined);
  });
});

describe('getShiplightEnv fallback', () => {
  beforeEach(() => {
    __setShiplightEnvForTest(undefined);
  });

  afterEach(() => {
    __setShiplightEnvForTest(undefined);
  });

  it('falls back to process.env when loadShiplightEnv was never called', () => {
    process.env.__SHIPLIGHT_TEST_FALLBACK = 'visible-via-fallback';
    try {
      const env = getShiplightEnv();
      assert.equal(env.__SHIPLIGHT_TEST_FALLBACK, 'visible-via-fallback');
    } finally {
      delete process.env.__SHIPLIGHT_TEST_FALLBACK;
    }
  });

  it('returns the stash (not process.env) once explicitly loaded', () => {
    __setShiplightEnvForTest({ MY_KEY: 'from-stash' });
    process.env.__SHIPLIGHT_TEST_LEAK = 'should-not-leak';
    try {
      const env = getShiplightEnv();
      assert.equal(env.MY_KEY, 'from-stash');
      assert.equal(env.__SHIPLIGHT_TEST_LEAK, undefined);
    } finally {
      delete process.env.__SHIPLIGHT_TEST_LEAK;
    }
  });
});

describe('applyShiplightEnvToProcess — CLI parent/child token parity (SC-009)', () => {
  let tmp: ReturnType<typeof makeTmpTree>;
  let originalCwd: string;
  let originalToken: string | undefined;

  beforeEach(() => {
    tmp = makeTmpTree();
    originalCwd = process.cwd();
    originalToken = process.env.SHIPLIGHT_API_TOKEN;
  });

  afterEach(() => {
    process.chdir(originalCwd);
    if (originalToken === undefined) delete process.env.SHIPLIGHT_API_TOKEN;
    else process.env.SHIPLIGHT_API_TOKEN = originalToken;
    tmp.cleanup();
  });

  it('lets .env override a shell token, so parent readers see what the child will', () => {
    // The regression this pins: the parent used a bare `dotenv.config()`, which
    // never overwrites an already-set variable. A stale shell token therefore
    // beat the project's `.env` in the parent while the child — which walks up
    // with `.env` winning — ran under the `.env` token. The action-entity cache
    // reads parent-side `process.env`, so it silently downgraded to Local.
    fs.writeFileSync(path.join(tmp.root, '.env'), 'SHIPLIGHT_API_TOKEN=from-dotenv\n');
    process.env.SHIPLIGHT_API_TOKEN = 'from-shell';

    applyShiplightEnvToProcess(tmp.root);

    assert.equal(process.env.SHIPLIGHT_API_TOKEN, 'from-dotenv');
  });

  it('agrees with the child view the spawned process resolves for the same dir', () => {
    fs.mkdirSync(path.join(tmp.root, 'sub'), { recursive: true });
    fs.writeFileSync(path.join(tmp.root, '.env'), 'SHIPLIGHT_API_TOKEN=root-token\n');
    fs.writeFileSync(path.join(tmp.root, 'sub', '.env'), 'SHIPLIGHT_API_TOKEN=closest-token\n');
    process.env.SHIPLIGHT_API_TOKEN = 'from-shell';

    const startDir = path.join(tmp.root, 'sub');
    applyShiplightEnvToProcess(startDir);
    const childView = readShiplightEnv(startDir);

    // Closest .env wins in both, and neither falls back to the shell.
    assert.equal(process.env.SHIPLIGHT_API_TOKEN, 'closest-token');
    assert.equal(process.env.SHIPLIGHT_API_TOKEN, childView.SHIPLIGHT_API_TOKEN);
  });

  it('keeps shell-only variables that no .env declares', () => {
    fs.writeFileSync(path.join(tmp.root, '.env'), 'SHIPLIGHT_API_TOKEN=from-dotenv\n');
    process.env.SHIPLIGHT_PARITY_SHELL_ONLY = 'kept';
    try {
      applyShiplightEnvToProcess(tmp.root);
      assert.equal(process.env.SHIPLIGHT_PARITY_SHELL_ONLY, 'kept');
    } finally {
      delete process.env.SHIPLIGHT_PARITY_SHELL_ONLY;
    }
  });
});
