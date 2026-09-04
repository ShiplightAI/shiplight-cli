/**
 * Cross-workflow invariant: every job that publishes to npm must be able to
 * authenticate.
 *
 * npm authenticates these workflows by OIDC (trusted publishing). The registry
 * token was removed, so `secrets.NPM_TOKEN` resolves to an empty string and
 * there is NO fallback — a job without `permissions: id-token: write` reaches
 * the registry with no credential at all and dies on `npm error code ENEEDAUTH`.
 *
 * The failure mode is what makes this worth a guard rather than a code review:
 * the permission is declared far from the step that needs it, nothing fails
 * until the very last step, and by then the job has spent its full gate budget
 * (~35 minutes for the CLI). `publish-cli.yml`'s promote job shipped without it
 * and nobody noticed until the first promote was attempted — run 32774879615,
 * which passed every guard and then could not publish.
 *
 * `publish-cli.yml`'s publish job made the inverse mistake readable: its
 * `id-token: write` carried a comment naming only GCP Vertex/WIF, so the
 * permission looked E2E-specific and was dropped from the job that had no E2E.
 */
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { parse } from 'yaml';

/** The slice of the GitHub Actions workflow schema this invariant reads. */
interface WorkflowStep {
  name?: string;
  run?: string;
}
interface WorkflowJob {
  steps?: WorkflowStep[];
  permissions?: Record<string, string>;
}
interface Workflow {
  jobs?: Record<string, WorkflowJob>;
}

interface PublishingJob {
  workflow: string;
  job: string;
  permissions: Record<string, string>;
  steps: WorkflowStep[];
}

const workflowDir = path.join(process.cwd(), '.github/workflows');

/** A step that pushes a package to the registry — excludes `--dry-run` rehearsals. */
function isRealPublishStep(step: WorkflowStep): boolean {
  const run = step?.run ?? '';
  if (!/\b(npm|pnpm)\s+publish\b/.test(run)) return false;
  return !/--dry-run/.test(run);
}

function publishingJobs(): PublishingJob[] {
  const found: PublishingJob[] = [];
  for (const file of readdirSync(workflowDir).filter((f) => f.endsWith('.yml'))) {
    const workflow = parse(readFileSync(path.join(workflowDir, file), 'utf8')) as Workflow;
    for (const [job, definition] of Object.entries(workflow?.jobs ?? {})) {
      if ((definition?.steps ?? []).some(isRealPublishStep)) {
        found.push({
          workflow: file,
          job,
          permissions: definition?.permissions ?? {},
          steps: definition?.steps ?? [],
        });
      }
    }
  }
  return found;
}

test('every npm-publishing job declares id-token: write for trusted publishing', () => {
  const jobs = publishingJobs();

  // Guard the guard: if the detection stops matching, the assertions below pass
  // vacuously and this file silently protects nothing.
  assert.ok(
    jobs.length >= 3,
    `expected to find the CLI, MCP and SDK publish jobs, found ${jobs.length}`,
  );

  for (const { workflow, job, permissions } of jobs) {
    assert.equal(
      permissions['id-token'],
      'write',
      `${workflow} job "${job}" publishes to npm but does not declare id-token: write — ` +
        'trusted publishing has no NPM_TOKEN fallback, so it will fail with ENEEDAUTH',
    );
  }
});

test('the CLI promote path is covered, not just the full publish path', () => {
  // Regression: promote was the job that shipped broken. It is the only
  // publishing job reached by a non-default input, so it is the one a manual
  // test of the workflow is least likely to exercise.
  const jobs = publishingJobs();
  const promote = jobs.find((j) => j.workflow === 'publish-cli.yml' && j.job === 'promote');

  assert.ok(promote, 'publish-cli.yml must still have a promote job that publishes');
  assert.equal(promote.permissions['id-token'], 'write');
});

test('every npm-publishing job fails fast when the id-token is absent', () => {
  // The permission and the preflight are separate mistakes. This assertion
  // exists because the preflight was first added to `publish-cli.yml` by a
  // pattern-anchored edit that matched the `publish` job instead of `promote` —
  // the two jobs have identical `setup-node` + `Configure git identity` runs, so
  // the guard silently landed in the job that was already working. Asserting the
  // permission alone would not have caught that.
  for (const { workflow, job, steps } of publishingJobs()) {
    const preflight = steps.some((step) =>
      /ACTIONS_ID_TOKEN_REQUEST_URL/.test(step?.run ?? ''),
    );
    assert.ok(
      preflight,
      `${workflow} job "${job}" publishes to npm but has no OIDC preflight — a dropped ` +
        'id-token would not surface until the final publish step, after the gates have run',
    );
  }
});
