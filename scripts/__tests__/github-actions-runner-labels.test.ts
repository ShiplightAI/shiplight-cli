import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { parse } from 'yaml';

// Every job must run on a GitHub-hosted runner.
//
// Two reasons, and the second is the one that bites silently. The shiplight-*
// self-hosted runners are being decommissioned, so a job pinned to one queues
// forever. And npm rejects a provenance publish from a self-hosted runner:
// these workflows authenticate by OIDC (trusted publishing), which signs a
// sigstore bundle, and the registry answers 422 "Unsupported GitHub Actions
// runner environment: self-hosted". @shiplightai/sdk 0.1.12 failed that way
// after clearing every gate, at the last step of a ~25 minute run.
//
// The workflow is parsed rather than scanned for `runs-on:` lines: a regex over
// the source misses the multi-line sequence form, which would then pass while
// naming a self-hosted runner. Parsing also means prose in comments — several of
// these files explain this migration — can never trip the guard.
const repoRoot = process.cwd();
const workflowDir = '.github/workflows';

const allowedLabels = new Set(['ubuntu-latest', 'ubuntu-24.04', 'ubuntu-22.04']);

type Workflow = { jobs?: Record<string, { 'runs-on'?: string | string[] }> };

const workflows = readdirSync(path.join(repoRoot, workflowDir))
  .filter((entry) => entry.endsWith('.yml') || entry.endsWith('.yaml'))
  .sort();

test('the workflow directory is not empty', () => {
  assert.ok(workflows.length > 0, `no workflows found in ${workflowDir}; this guard would vacuously pass`);
});

for (const workflow of workflows) {
  const workflowPath = `${workflowDir}/${workflow}`;

  test(`${workflowPath} runs every job on a GitHub-hosted runner`, () => {
    const parsed = parse(readFileSync(path.join(repoRoot, workflowPath), 'utf8')) as Workflow;

    for (const [jobName, job] of Object.entries(parsed.jobs ?? {})) {
      // A job that calls a reusable workflow declares `uses:` and no runner of
      // its own; the called workflow is checked when this loop reaches its file.
      if (job['runs-on'] === undefined) continue;

      const labels = Array.isArray(job['runs-on']) ? job['runs-on'] : [job['runs-on']];
      for (const label of labels) {
        assert.ok(
          allowedLabels.has(label),
          `${workflowPath} job "${jobName}" has runs-on "${label}"; the shiplight-* self-hosted runners are going away and npm refuses a provenance publish from one. Use ubuntu-latest.`,
        );
      }
    }
  });
}
