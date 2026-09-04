/**
 * Statement UIDs must identify a statement, not a checkout.
 *
 * The action-entity cache's outer key (branch + repo-relative file path) is built to travel
 * between machines; before this, the statement keys inside it were not, so CI could download
 * a fully populated store and miss every entry. These tests pin the two properties that make
 * the inner keys travel too, and the fallback for projects with no repository.
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import * as assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, realpathSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { repoRelativeIdentityPath, __resetRepoRootCache } from './statementIdentityPath';
import { parseYamlTestFile } from './yamlParser';

const YAML = `goal: T
statements:
  - intent: Click login
    action: click
    locator: "getByRole('button')"
`;

let scratch: string;

beforeEach(() => {
  // realpath: macOS hands out /var/... symlinks into /private/var, and a walk-up
  // comparison against an unresolved prefix would silently never match.
  scratch = realpathSync(mkdtempSync(join(tmpdir(), 'identity-path-')));
  __resetRepoRootCache();
});
afterEach(() => {
  rmSync(scratch, { recursive: true, force: true });
  __resetRepoRootCache();
});

/** Create `<scratch>/<name>` as a repo containing tests/login.test.yaml. */
function makeRepo(name: string, gitAs: 'dir' | 'file' = 'dir'): { root: string; file: string } {
  const root = join(scratch, name);
  mkdirSync(join(root, 'tests'), { recursive: true });
  if (gitAs === 'dir') mkdirSync(join(root, '.git'));
  else writeFileSync(join(root, '.git'), 'gitdir: /elsewhere/.git/worktrees/wt\n');
  const file = join(root, 'tests', 'login.test.yaml');
  writeFileSync(file, YAML);
  return { root, file };
}

describe('repoRelativeIdentityPath', () => {
  it('reduces an absolute path to its repo-relative form', () => {
    const { file } = makeRepo('repo');
    assert.equal(repoRelativeIdentityPath(file), 'tests/login.test.yaml');
  });

  it('gives two checkouts of the same repo the same identity', () => {
    // The laptop-vs-CI case: same branch, same file, different absolute roots.
    const a = makeRepo('home-runner-work');
    const b = makeRepo('Users-feng-projects');
    assert.notEqual(a.file, b.file, 'fixture must actually differ in absolute path');
    assert.equal(repoRelativeIdentityPath(a.file), repoRelativeIdentityPath(b.file));
  });

  it('treats a worktree root as a repo root', () => {
    // In a worktree `.git` is a FILE pointing at the main repo; it is still the anchor
    // git itself reports, so worktrees of one repo must agree with each other.
    const wt = makeRepo('worktree', 'file');
    assert.equal(repoRelativeIdentityPath(wt.file), 'tests/login.test.yaml');
  });

  it('anchors on the nearest repo when they nest', () => {
    const outer = makeRepo('outer');
    const innerRoot = join(outer.root, 'vendor', 'inner');
    mkdirSync(join(innerRoot, 'tests'), { recursive: true });
    mkdirSync(join(innerRoot, '.git'));
    const innerFile = join(innerRoot, 'tests', 'login.test.yaml');
    writeFileSync(innerFile, YAML);

    assert.equal(repoRelativeIdentityPath(innerFile), 'tests/login.test.yaml');
  });

  it('falls back to the given path when there is no repository', () => {
    const loose = join(scratch, 'loose');
    mkdirSync(loose, { recursive: true });
    const file = join(loose, 'x.test.yaml');
    writeFileSync(file, YAML);

    // Deterministic and unchanged in shape — a repo-less project has no cross-machine
    // cache to share, so the absolute path costs it nothing.
    assert.equal(repoRelativeIdentityPath(file), file);
  });

  it('passes a relative path through, normalising separators', () => {
    assert.equal(repoRelativeIdentityPath('tests/login.test.yaml'), 'tests/login.test.yaml');
    assert.equal(repoRelativeIdentityPath('tests\\login.test.yaml'), 'tests/login.test.yaml');
  });

  it('emits forward slashes so a Windows and a Linux runner agree', () => {
    const { file } = makeRepo('sep');
    assert.equal(repoRelativeIdentityPath(file).includes('\\'), false);
  });
});

describe('statement UIDs follow the identity path', () => {
  it('match across two checkouts of the same repo', () => {
    // The property the whole change exists for: a heal recorded in one checkout is
    // findable from another.
    const a = makeRepo('checkout-a');
    const b = makeRepo('checkout-b');

    const uidA = parseYamlTestFile(YAML, a.file).testFlow!.statements![0].uid;
    const uidB = parseYamlTestFile(YAML, b.file).testFlow!.statements![0].uid;

    assert.equal(uidA, uidB);
  });

  it('still differ for the same relative path in different files', () => {
    const repo = makeRepo('distinct');
    const other = join(repo.root, 'tests', 'checkout.test.yaml');
    writeFileSync(other, YAML);

    const uidLogin = parseYamlTestFile(YAML, repo.file).testFlow!.statements![0].uid;
    const uidCheckout = parseYamlTestFile(YAML, other).testFlow!.statements![0].uid;

    assert.notEqual(uidLogin, uidCheckout, 'the file is still part of the identity');
  });

  it('are stable across repeated parses', () => {
    const { file } = makeRepo('stable');
    assert.equal(
      parseYamlTestFile(YAML, file).testFlow!.statements![0].uid,
      parseYamlTestFile(YAML, file).testFlow!.statements![0].uid,
    );
  });
});
