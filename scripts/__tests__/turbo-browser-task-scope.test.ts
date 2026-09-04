/**
 * Guards where the `test:browser` task is declared.
 *
 * Turbo creates a task node for every workspace a task is defined for. Defining
 * `test:browser` in the ROOT turbo.json therefore gave every package a node
 * — a no-op for the 36 without the script, but each one still resolved
 * `dependsOn: ["build"]`, so the Browser Tests lane built the entire monorepo.
 *
 * That stayed invisible while `--affected` was narrow. Any change to
 * pnpm-lock.yaml is a turbo global dependency, marks every package affected,
 * and the lane went from ~2min to 14-18min — 650s of builds (the v1 API
 * alone 5m49s, a sunset package) around 11s of actual browser tests.
 *
 * Declaring the task in each owning package instead bounds the graph to 13
 * tasks / 10 packages no matter how wide `--affected` gets.
 */
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import ts from 'typescript';

const repoRoot = process.cwd();
const TASK = 'test:browser';

/** turbo.json permits comments, so it needs a JSONC-tolerant reader. */
function readTurboConfig(relativePath: string): Record<string, unknown> {
  const absolute = path.join(repoRoot, relativePath);
  const parsed = ts.parseConfigFileTextToJson(absolute, readFileSync(absolute, 'utf8'));
  assert.equal(parsed.error, undefined, `${relativePath} is not parseable`);
  return parsed.config as Record<string, unknown>;
}

function tasksOf(config: Record<string, unknown>): Record<string, unknown> {
  return (config.tasks ?? {}) as Record<string, unknown>;
}

/** Every workspace directory under the globbed roots, with its package.json. */
function workspaces(): { dir: string; manifest: Record<string, unknown> }[] {
  const found: { dir: string; manifest: Record<string, unknown> }[] = [];

  for (const root of ['apps', 'packages']) {
    const absoluteRoot = path.join(repoRoot, root);
    if (!existsSync(absoluteRoot)) continue;

    for (const entry of readdirSync(absoluteRoot, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const dir = path.join(root, entry.name);
      const manifestPath = path.join(repoRoot, dir, 'package.json');
      if (!existsSync(manifestPath)) continue;
      found.push({ dir, manifest: JSON.parse(readFileSync(manifestPath, 'utf8')) });
    }
  }

  return found;
}

const owners = workspaces().filter(({ manifest }) => {
  const scripts = (manifest.scripts ?? {}) as Record<string, string>;
  return typeof scripts[TASK] === 'string';
});

test('root turbo.json does not declare test:browser', () => {
  assert.ok(
    !(TASK in tasksOf(readTurboConfig('turbo.json'))),
    `${TASK} must not be declared in the root turbo.json — a root definition gives every ` +
      'workspace a task node, and each no-op node still resolves dependsOn: ["build"], ' +
      'which rebuilds the whole monorepo for this lane. Declare it in the owning packages instead.',
  );
});

test('every package with a test:browser script declares the task in its own turbo.json', () => {
  assert.ok(owners.length > 0, 'expected at least one package to define a test:browser script');

  const missing = owners
    .filter(({ dir }) => {
      const config = path.join(dir, 'turbo.json');
      if (!existsSync(path.join(repoRoot, config))) return true;
      return !(TASK in tasksOf(readTurboConfig(config)));
    })
    .map(({ dir }) => dir);

  assert.deepEqual(
    missing,
    [],
    `these packages have a ${TASK} script but do not declare the task in their own turbo.json, ` +
      'so turbo will not run it: ' +
      missing.join(', '),
  );
});

test('no package declares test:browser without owning the script', () => {
  const ownerDirs = new Set(owners.map(({ dir }) => dir));

  const stray = workspaces()
    .filter(({ dir }) => !ownerDirs.has(dir))
    .filter(({ dir }) => {
      const config = path.join(dir, 'turbo.json');
      if (!existsSync(path.join(repoRoot, config))) return false;
      return TASK in tasksOf(readTurboConfig(config));
    })
    .map(({ dir }) => dir);

  assert.deepEqual(stray, [], `these packages declare ${TASK} but have no such script: ${stray.join(', ')}`);
});

test('the declared task keeps the settings the lane depends on', () => {
  for (const { dir } of owners) {
    const declared = tasksOf(readTurboConfig(path.join(dir, 'turbo.json')))[TASK] as Record<string, unknown>;

    // Own build, not just dependencies' — the suites execute against dist/.
    assert.deepEqual(declared.dependsOn, ['build'], `${dir}: ${TASK} must depend on its own build`);
    // Browser results are not reproducible from inputs alone; caching them
    // would let a green cache entry stand in for a suite that never ran.
    assert.equal(declared.cache, false, `${dir}: ${TASK} must not be cached`);
  }
});
