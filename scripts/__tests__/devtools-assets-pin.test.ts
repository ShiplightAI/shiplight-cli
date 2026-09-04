import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

interface Manifest {
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
}

function manifest(rel: string): Manifest {
  return JSON.parse(readFileSync(path.join(REPO_ROOT, rel), 'utf-8')) as Manifest;
}

/**
 * `@shiplightai/devtools-assets` is the one dependency this repository consumes
 * from npm that used to be a workspace package. That conversion is where the
 * pin can silently loosen, so it gets its own guard.
 */
describe('@shiplightai/devtools-assets pin', () => {
  it('is pinned to an exact version, not a range', () => {
    const range = manifest('apps/cli/package.json').dependencies?.['@shiplightai/devtools-assets'];
    assert.ok(range, 'apps/cli must depend on @shiplightai/devtools-assets');

    // A caret or tilde lets a routine CLI upgrade resolve to a different
    // DevTools build. That defeats the reason the package was split out — npm's
    // content-addressed cache can only reuse the tarball across shiplightai
    // upgrades when the version is identical — and it lets a devtools release
    // change the debugger for every user with no CLI release and no rollback.
    // While it lived in the workspace, `workspace:*` was rewritten to an exact
    // version at pack time, so published CLIs have always pinned exactly.
    assert.match(
      range,
      /^\d+\.\d+\.\d+$/,
      `expected an exact version, got ${range} — see the comment above for why a range is wrong`
    );
  });

  it('is not also declared as a workspace package', () => {
    // If it ever returns to the workspace, this pin becomes wrong rather than
    // merely redundant, and the guard above would start failing for the wrong
    // reason. Fail here instead, with an explanation.
    let inWorkspace = false;
    try {
      readFileSync(path.join(REPO_ROOT, 'packages/devtools-assets/package.json'));
      inWorkspace = true;
    } catch {
      // Expected: it is published from the devtools-frontend repository.
    }
    assert.equal(
      inWorkspace,
      false,
      'packages/devtools-assets exists again — if it is back in the workspace, apps/cli should use workspace:* and this guard should be deleted'
    );
  });
});
