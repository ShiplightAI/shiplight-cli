import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';

/**
 * Every workflow that mints a shiplight-ops App installation token.
 *
 * The App token is the only credential these workflows cannot get from
 * `github.token`: pushes made with the job token do not trigger workflows, so a
 * release bump would never reach release-drafter.
 */
const repoRoot = process.cwd();
const appTokenWorkflows = [
  '.github/workflows/publish-cli.yml',
  '.github/workflows/publish-mcp.yml',
  '.github/workflows/publish-sdk.yml',
  '.github/workflows/sync-yaml-spec.yml',
];

/**
 * Org-level Actions variables that were scoped to "private and internal
 * repositories". This repository is public, so they resolve to the empty string
 * here and `actions/create-github-app-token` fails its first step with
 * "The 'client-id' (or deprecated 'app-id') input must be set to a non-empty
 * string" — before any gate runs.
 *
 * The App ID and the org name are not secrets, so nothing is gained by reading
 * them from org config: `owner` comes from the built-in `github.repository_owner`
 * and the identity from a variable this repository can actually see.
 */
const removedOrgVariables = ['vars.ORGANIZATION_NAME', 'vars.SHIPLIGHT_OPS_GITHUB_APP_ID'];

for (const workflowPath of appTokenWorkflows) {
  const source = readFileSync(path.join(repoRoot, workflowPath), 'utf8');

  test(`${workflowPath} mints its App token with client-id, not the deprecated app-id`, () => {
    assert.match(
      source,
      /client-id: \$\{\{ vars\.SHIPLIGHT_OPS_GITHUB_CLIENT_ID \}\}/,
      `${workflowPath} must pass client-id from vars.SHIPLIGHT_OPS_GITHUB_CLIENT_ID`,
    );
    assert.equal(
      /^\s*app-id:/m.test(source),
      false,
      `${workflowPath} still uses the deprecated app-id input; use client-id instead`,
    );
  });

  test(`${workflowPath} takes the App token owner from github.repository_owner`, () => {
    assert.match(
      source,
      /owner: \$\{\{ github\.repository_owner \}\}/,
      `${workflowPath} must read owner from the built-in github.repository_owner`,
    );
  });

  for (const removed of removedOrgVariables) {
    test(`${workflowPath} does not reference ${removed}`, () => {
      assert.equal(
        source.includes(removed),
        false,
        `${workflowPath} references ${removed}, an org variable this public repository cannot read`,
      );
    });
  }

  test(`${workflowPath} reads the App private key from a secret`, () => {
    assert.match(
      source,
      /private-key: \$\{\{ secrets\.SHIPLIGHT_OPS_GITHUB_APP_KEY \}\}/,
      `${workflowPath} must read the App private key from secrets.SHIPLIGHT_OPS_GITHUB_APP_KEY`,
    );
  });
}

test('every workflow that mints an App token is covered by this guard', () => {
  const workflowDir = path.join(repoRoot, '.github/workflows');
  const generators = readdirSync(workflowDir)
    .filter((entry) => entry.endsWith('.yml') || entry.endsWith('.yaml'))
    .map((entry) => `.github/workflows/${entry}`)
    .filter((workflowPath) =>
      readFileSync(path.join(repoRoot, workflowPath), 'utf8').includes('actions/create-github-app-token'),
    );

  assert.deepEqual(
    generators.sort(),
    [...appTokenWorkflows].sort(),
    'a workflow started or stopped minting an App token; update appTokenWorkflows so the guard still covers every one',
  );
});
