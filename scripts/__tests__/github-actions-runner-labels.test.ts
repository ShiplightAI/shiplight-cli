import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';

// Every job must run on a GitHub-hosted runner.
//
// Two reasons, and the second is the one that bites silently. The shiplight-*
// self-hosted runners are being decommissioned, so a job pinned to one queues
// forever. And npm rejects a provenance publish from a self-hosted runner:
// these workflows authenticate by OIDC (trusted publishing), which signs a
// sigstore bundle, and the registry answers 422 "Unsupported GitHub Actions
// runner environment: self-hosted". @shiplightai/sdk 0.1.12 failed that way
// after clearing every gate, at the last step of a ~25 minute run.
const repoRoot = process.cwd();
const workflowDir = '.github/workflows';

const allowedLabels = new Set(['ubuntu-latest', 'ubuntu-24.04', 'ubuntu-22.04']);

const workflows = readdirSync(path.join(repoRoot, workflowDir))
  .filter((entry) => entry.endsWith('.yml') || entry.endsWith('.yaml'))
  .sort();

test('the workflow directory is not empty', () => {
  assert.ok(workflows.length > 0, `no workflows found in ${workflowDir}; this guard would vacuously pass`);
});

for (const workflow of workflows) {
  const workflowPath = `${workflowDir}/${workflow}`;

  test(`${workflowPath} runs every job on a GitHub-hosted runner`, () => {
    const source = readFileSync(path.join(repoRoot, workflowPath), 'utf8');
    // Match the directive only, never the prose: a leading `#` means a comment,
    // and several of these files explain the migration in one.
    const labels = [...source.matchAll(/^\s*runs-on:\s*(\S+)\s*$/gm)].map((match) => match[1]);

    for (const label of labels) {
      assert.ok(
        allowedLabels.has(label),
        `${workflowPath} has "runs-on: ${label}"; the shiplight-* self-hosted runners are going away and npm refuses a provenance publish from one. Use ubuntu-latest.`,
      );
    }
  });
}
