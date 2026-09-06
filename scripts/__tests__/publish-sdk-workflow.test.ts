import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { parse } from 'yaml';

const repoRoot = process.cwd();
const workflowPath = '.github/workflows/publish-sdk.yml';
const workflow = parse(readFileSync(path.join(repoRoot, workflowPath), 'utf8'));
const publishJob = workflow.jobs.publish;
const steps = publishJob.steps;

const stepNamed = (name) => steps.find((step) => step.name === name);
const stepIndex = (name) => steps.findIndex((step) => step.name === name);

test('SDK publish workflow auto-bumps the live npm patch version before building', () => {
  assert.equal(workflow.on.workflow_dispatch.inputs.dry_run.type, 'boolean');
  assert.equal(workflow.on.workflow_dispatch.inputs.dry_run.default, false);
  assert.equal(publishJob.permissions.contents, 'write');

  const checkout = stepNamed('Checkout main');
  assert.equal(checkout.with.ref, 'main');
  // The bump push uses a GitHub App installation token, not the job token and
  // not a release PAT. github.token cannot do this job: pushes made with it do
  // not trigger workflows, so the bump would never reach release-drafter, and
  // it is subject to branch protection. The app token is the same credential
  // sync-yaml-spec.yml uses, so the repository needs one fewer secret.
  assert.equal(checkout.with.token, '${{ steps.app_token.outputs.token }}');
  const appToken = publishJob.steps.find((s) => s.id === 'app_token');
  assert.ok(appToken, 'the checkout token must come from a create-github-app-token step');
  assert.match(String(appToken.uses), /create-github-app-token/);
  assert.match(String(appToken.with?.['private-key']), /SHIPLIGHT_OPS_GITHUB_APP_KEY/);
  assert.equal(checkout.with['fetch-depth'], 0);

  const versions = stepNamed('Compute OLD (live npm) and NEW (patch+1) versions');
  assert.match(versions.run, /npm view @shiplightai\/sdk version/);
  assert.match(versions.run, /v\[2\]\+\+/);

  const bump = stepNamed('Bump packages/sdk-public/package.json to NEW');
  assert.equal(bump['working-directory'], 'packages/sdk-public');
  assert.match(bump.run, /p\.version=process\.env\.NEW_VERSION/);
  assert.ok(stepIndex(versions.name) < stepIndex(bump.name));
  assert.ok(stepIndex(bump.name) < stepIndex('Build SDK with dependencies'));
});

test('SDK publish workflow runs source and published-surface tests as hard gates', () => {
  assert.equal(workflow.jobs['sdk-tests'].uses, './.github/workflows/sdk-tests.yml');
  assert.deepEqual(publishJob.needs, ['sdk-tests']);

  const packageTests = stepNamed('SDK package tests (hard gate)');
  assert.match(packageTests.run, /turbo run test:unit --filter=@shiplightai\/sdk\.\.\./);
  assert.ok(stepIndex('Build SDK with dependencies') < stepIndex(packageTests.name));
  assert.ok(stepIndex(packageTests.name) < stepIndex('Pack candidate tarball'));
});

test('SDK publish workflow compares candidate and live tarball sizes before publishing', () => {
  assert.equal(workflow.on.workflow_dispatch.inputs.max_size_increase_pct.type, 'number');
  assert.equal(workflow.on.workflow_dispatch.inputs.max_size_increase_pct.default, 1);

  const pack = stepNamed('Pack candidate tarball');
  const baseline = stepNamed('Download baseline tarball (@shiplightai/sdk@OLD)');
  const size = stepNamed('Tarball size delta');

  assert.equal(pack['working-directory'], 'packages/sdk-public');
  assert.match(pack.run, /pnpm pack/);
  assert.match(baseline.run, /npm pack @shiplightai\/sdk@\$\{\{ steps\.versions\.outputs\.old \}\}/);
  assert.equal(size.env.MAX_SIZE_INCREASE_PCT, '${{ inputs.max_size_increase_pct }}');
  assert.match(size.run, /BASELINE=/);
  assert.match(size.run, /CANDIDATE=/);
  assert.match(size.run, /p > m/);
  assert.ok(stepIndex(pack.name) < stepIndex(baseline.name));
  assert.ok(stepIndex(baseline.name) < stepIndex(size.name));
  assert.ok(stepIndex(size.name) < stepIndex('npm publish'));
});

test('SDK publish workflow runs every public SDK example against the candidate tarball', () => {
  const checkout = stepNamed('Checkout public SDK examples (ShiplightAI/examples)');
  assert.equal(checkout.uses, 'actions/checkout@v6');
  assert.equal(checkout.with.repository, 'ShiplightAI/examples');
  assert.equal(checkout.with.path, 'examples-repo');

  // The live-AI examples gate needs the 8-vCPU self-hosted runner to run
  // 4-wide; on a 2-vCPU GitHub-hosted runner it took 30+ minutes serially.
  assert.equal(publishJob['runs-on'], 'shiplight-medium');

  const examples = stepNamed('E2E — public SDK examples (hard gate, all must pass)');
  assert.equal(examples['working-directory'], 'examples-repo/sdk-examples');
  assert.equal(examples.env.SHIPLIGHT_API_TOKEN, '${{ secrets.SHIPLIGHT_API_TOKEN }}');
  assert.match(
    examples.run,
    /npm install --no-save "\$\{\{ github\.workspace \}\}\/packages\/sdk-public\/shiplightai-sdk-\$\{\{ steps\.versions\.outputs\.new \}\}\.tgz"/,
  );
  // No --with-deps on shiplight-medium: it shells out to `sudo apt-get`,
  // which cannot prompt on the self-hosted runner. The image has the
  // browser OS libraries pre-baked.
  assert.match(examples.run, /npx playwright install chromium/);
  assert.doesNotMatch(examples.run, /playwright install --with-deps/);
  assert.match(examples.run, /xvfb-run -a npm run "\$example_script"/);

  for (const script of [
    'quickstart',
    'basic',
    'login',
    'self-healing',
    'custom-actions',
    'variables',
    'file-upload',
    'extraction',
  ]) {
    // Entries live in the EXAMPLES bash array as 'script|marker'.
    assert.match(examples.run, new RegExp(`^\\s*'${script}\\|.+'$`, 'm'));
  }

  // The run list is the single source of truth for the script-set guard —
  // deriving EXPECTED_SCRIPTS from EXAMPLES is what stops an example being
  // added to package.json (and to the guard) while never actually running.
  assert.match(examples.run, /EXPECTED_SCRIPTS=\$\(printf '%s\\n' "\$\{EXAMPLES\[@\]\}" \| cut -d'\|' -f1/);
  assert.doesNotMatch(
    examples.run,
    /EXPECTED_SCRIPTS="[a-z-]+ /,
    'EXPECTED_SCRIPTS must be derived from the EXAMPLES array, not restated as a literal',
  );

  // Examples run 4-wide; a failure in any worker must still fail the gate.
  assert.match(examples.run, /xargs -P 4 -I\{\} bash -c 'run_sdk_example "\$@"' _ \{\}/);
  assert.match(examples.run, /export -f run_sdk_example/);

  assert.ok(stepIndex('Pack candidate tarball') < stepIndex(checkout.name));
  assert.ok(stepIndex(checkout.name) < stepIndex(examples.name));
  assert.ok(stepIndex(examples.name) < stepIndex('npm publish'));
});

test('SDK publish workflow dry-runs first and persists the bump only after publishing', () => {
  const dryPublish = stepNamed('npm publish --dry-run');
  const publish = stepNamed('npm publish');
  const commit = stepNamed('Commit bump and push main');

  assert.match(dryPublish.run, /pnpm publish --dry-run/);
  assert.equal(publish.if, '${{ !inputs.dry_run }}');
  assert.equal(commit.if, '${{ !inputs.dry_run }}');
  assert.match(commit.run, /git add packages\/sdk-public\/package\.json/);
  assert.match(commit.run, /git push origin HEAD:main/);
  assert.ok(stepIndex(dryPublish.name) < stepIndex(publish.name));
  assert.ok(stepIndex(publish.name) < stepIndex(commit.name));
});
