import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';

import { dependencyFilter, skipReason } from '../build-workspace-deps.mts';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

/** The exact hook every guarded script must run. Kept literal so drift is visible. */
const HOOK = 'tsx ../../scripts/build-workspace-deps.mts';

/**
 * The hook `apps/mcp-server`'s smoke lanes use instead: they spawn the
 * package's *own* `dist/index.js`, which `<pkg>^...` excludes by design, so
 * they need a build that includes the package itself.
 */
const SELF_BUILD_HOOK = 'pnpm build:deps';

/**
 * Every task that executes code resolving a workspace dependency through its
 * built `dist/`. Named by shape rather than listed one by one so a new lane —
 * the next `test:logic` or `test:browser` — is covered the day it is added,
 * which is exactly how `apps/cli`'s `test:logic` was missed the first time.
 */
function isGuardedScript(name: string): boolean {
  return name === 'typecheck' || name === 'test' || name.startsWith('test:');
}

interface PackageManifest {
  name: string;
  scripts?: Record<string, string>;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
}

/**
 * Every workspace manifest, preferring git's view of them.
 *
 * Git is asked first because a source checkout may hold untracked directories
 * that a bare filesystem walk would mistake for workspace members. The
 * filesystem is the fallback for the case where git cannot answer at all — a
 * fresh export, or an unpacked tarball.
 */
function manifestPaths(): string[] {
  try {
    return execFileSync('git', ['ls-files', 'apps/*/package.json', 'packages/*/package.json'], {
      cwd: REPO_ROOT,
      encoding: 'utf-8',
    })
      .split('\n')
      .filter(Boolean);
  } catch {
    // Not a git checkout — a fresh export, or an unpacked tarball. Walk the
    // filesystem instead. That is only unsafe where untracked leftovers could
    // masquerade as workspace members, which is exactly what git protects
    // against in the source repo and what an export cannot contain.
    return ['apps', 'packages'].flatMap((root) => {
      const base = path.join(REPO_ROOT, root);
      if (!existsSync(base)) return [];
      return readdirSync(base)
        .map((entry) => path.join(root, entry, 'package.json'))
        .filter((file) => existsSync(path.join(REPO_ROOT, file)));
    });
  }
}

function workspaceManifests(): Array<{ dir: string; manifest: PackageManifest }> {
  return manifestPaths()
    .map((file) => ({
      dir: path.dirname(file),
      manifest: JSON.parse(readFileSync(path.join(REPO_ROOT, file), 'utf-8')) as PackageManifest,
    }));
}

function hasWorkspaceDependency(manifest: PackageManifest): boolean {
  const deps = { ...manifest.dependencies, ...manifest.devDependencies };
  return Object.values(deps).some((range) => range.startsWith('workspace:'));
}

/**
 * A script that just calls another `pnpm` script inherits that script's hook,
 * so hooking it too would build the same dependencies twice.
 */
function delegatesToAnotherScript(script: string): boolean {
  return /\bpnpm (run )?(test|typecheck)/.test(script);
}

describe('build-workspace-deps hook coverage', () => {
  it('is wired into every script that reads a workspace dependency from dist', () => {
    const missing: string[] = [];

    for (const { dir, manifest } of workspaceManifests()) {
      if (!hasWorkspaceDependency(manifest)) continue;
      const scripts = manifest.scripts ?? {};

      for (const [name, script] of Object.entries(scripts)) {
        if (name.startsWith('pre') || !isGuardedScript(name)) continue;
        if (delegatesToAnotherScript(script)) continue;

        const hook = scripts[`pre${name}`];
        if (hook !== HOOK && hook !== SELF_BUILD_HOOK) {
          missing.push(`${dir} → "pre${name}": "${HOOK}"`);
        }
      }
    }

    assert.deepEqual(
      missing,
      [],
      'these scripts can run against a stale workspace dist; add the pre-hook:\n' + missing.join('\n')
    );
  });

  it('does not hook packages that have no workspace dependencies', () => {
    // The hook costs a turbo round-trip. A package with nothing upstream of it
    // has nothing to rebuild.
    const pointless: string[] = [];

    for (const { dir, manifest } of workspaceManifests()) {
      if (hasWorkspaceDependency(manifest)) continue;
      for (const [name, script] of Object.entries(manifest.scripts ?? {})) {
        if (script === HOOK) pointless.push(`${dir} → ${name}`);
      }
    }

    assert.deepEqual(pointless, []);
  });

  it('covers the lanes that actually broke, not just test:unit', () => {
    // Regression guard for the first cut of this rule, which listed
    // `['test', 'test:unit', 'typecheck']` and so left `apps/cli`'s
    // `test:logic` — the suite whose stale-dist failure motivated the script —
    // running against whatever `sdk-core/dist` happened to be lying around.
    for (const lane of ['test:logic', 'test:e2e', 'test:browser']) {
      assert.ok(isGuardedScript(lane), `${lane} must be guarded`);
    }
    assert.equal(isGuardedScript('build'), false);
    assert.equal(isGuardedScript('dev'), false);
  });

  it('points at a script that exists', () => {
    assert.ok(existsSync(path.join(REPO_ROOT, 'scripts', 'build-workspace-deps.mts')));
  });
});

describe('skipReason', () => {
  it('builds when a developer runs the task directly', () => {
    assert.equal(skipReason({}), null);
  });

  it('stands down under turbo, which already ran ^build', () => {
    assert.match(String(skipReason({ TURBO_HASH: 'abc123' })), /turbo/);
  });

  it('honours the escape hatch', () => {
    assert.match(String(skipReason({ SHIPLIGHT_SKIP_DEP_BUILD: '1' })), /SHIPLIGHT_SKIP_DEP_BUILD/);
  });

  it('does not treat a negative escape hatch as a request to skip', () => {
    // `SHIPLIGHT_SKIP_DEP_BUILD=0` says "do not skip". Reading any non-empty
    // value as truthy would quietly restore the stale-dist failure.
    for (const value of ['0', 'false', 'off', 'no', '']) {
      assert.equal(skipReason({ SHIPLIGHT_SKIP_DEP_BUILD: value }), null, `value ${JSON.stringify(value)}`);
    }
  });
});

describe('dependencyFilter', () => {
  it('selects the dependencies without the package itself', () => {
    // `shiplightai...` would rebuild the CLI, and any build that runs its own
    // typecheck would then re-enter this hook.
    assert.equal(dependencyFilter('shiplightai'), 'shiplightai^...');
  });
});
