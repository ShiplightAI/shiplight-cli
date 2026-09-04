// Guards the canonical observation contract between the publish workflows and
// the quality scanner. The scanner selects the newest completed workflow run,
// including failed runs, and suffix-matches observation_path within each
// selected artifact.
//
// Every release path must therefore:
// - assemble failure-aware observations after its intended proof producers;
// - upload each canonical file through the artifact selected for that profile;
// - use an exact quality-tools version in the release environment; and
// - keep observation transfer optional on the tarball-only promote path.

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { parse } from 'yaml';

const repoRoot = process.cwd();
const parseYamlFile = (relativePath) => parse(readFileSync(path.join(repoRoot, relativePath), 'utf8'));

const OBSERVATION_SOURCES_PATH = '.quality/config/observation-sources.yaml';
const OBSERVATION_PATH = 'quality-observations.json';

// Bumping this pin: the release workflows run `npx --yes` against this exact
// version, so it MUST already be published to npm when the bump merges —
// confirm with `npm view @shiplightai/quality-tools@<version> version`. An
// unpublished pin does not fail loudly: convert_junit/convert_playwright treat
// a non-zero exit as "input rejected", warn, and drop that shard, so the
// release still succeeds while every lane silently stops contributing
// observations. That is exactly how 0.3.0 discarded the CLI and sdk-core unit
// reports (it keyed test_case on the bare <testcase name>, so same-named cases
// in different describe blocks collided and voided the manifest); 0.3.2 is the
// first release that qualifies a colliding case with its suite path.
const QUALITY_TOOLS_INTERFACE = '@shiplightai/quality-tools@0.3.2 observations';

// A gate that ran and failed must be recorded as a failure, never as a pass or
// as an absent observation. Every arm is pinned: an edit that swaps two arms
// would otherwise report a failed release gate as proof the gate passed.
const GATE_OUTCOME_STATUSES = {
  success: 'pass',
  failure: 'fail',
  cancelled: 'error',
  '""|skipped': 'skipped',
  '*': 'error',
};

const gateOutcomeStatuses = (run) => {
  const block = /case\s+"\$outcome"\s+in\b([\s\S]*?)\besac\b/.exec(String(run ?? ''));
  if (block === null) {
    return null;
  }
  return Object.fromEntries(
    [...block[1].matchAll(/^\s*(\S+)\)\s*status=(\S+)\s*;;/gm)].map((arm) => [arm[1], arm[2]]),
  );
};

const SDK_ARTIFACT = {
  name: 'sdk-tests-observations',
  canonicalPath: '/tmp/qc-observations/engine/quality-observations.json',
  uploadCondition: 'always',
};

const WORKFLOW_CONTRACTS = [
  {
    profileId: 'monots-cli-publish',
    workflowPath: '.github/workflows/publish-cli.yml',
    selectedArtifactNames: ['quality-cli-observations', SDK_ARTIFACT.name],
    paths: [
      {
        name: 'full-publish',
        jobIds: ['sdk-tests', 'publish'],
        artifacts: [
          SDK_ARTIFACT,
          {
            name: 'quality-cli-observations',
            canonicalPath: '/tmp/qc-observations/cli/quality-observations.json',
            uploadCondition: 'always',
          },
        ],
        finalizers: [
          {
            name: 'Build canonical SDK observations',
            after: ['Engine-fixture browser tests — keyless (hard gate)'],
            converterKinds: ['from-junit'],
            gateOutcomes: [
              {
                stepName: 'sdk-core unit tests (hard gate)',
                stepId: 'sdk_unit_gate',
              },
              {
                stepName: 'Engine-fixture browser tests — keyless (hard gate)',
                stepId: 'engine_fixture_gate',
              },
            ],
            requiredInputs: ['sdk-core-unit.junit.xml', 'engine-fixture.junit.xml'],
          },
          {
            name: 'Build canonical CLI observations',
            after: [
              'E2E — example-homepage (hard gate)',
              'E2E — google-search (soft, live-AI flake tolerated)',
              'E2E — public examples suite (hard gate, all must pass)',
            ],
            converterKinds: ['from-junit', 'from-playwright'],
            gateOutcomes: [
              {
                stepName: 'Unit + logic tests (hard gate)',
                stepId: 'unit_logic_gate',
              },
              {
                stepName: 'Browser e2e — keyless lane (hard gate)',
                stepId: 'browser_e2e_gate',
              },
              {
                stepName: 'E2E — example-homepage (hard gate)',
                stepId: 'example_homepage_gate',
              },
              {
                stepName: 'E2E — public examples suite (hard gate, all must pass)',
                stepId: 'public_examples_gate',
              },
            ],
            requiredInputs: [
              'unit.junit.xml',
              'logic.playwright.json',
              'browser-e2e.junit.xml',
              'example-homepage.playwright.json',
              'google-search.playwright.json',
            ],
          },
        ],
      },
      {
        name: 'promote',
        jobIds: ['promote'],
        artifacts: [
          {
            name: 'quality-cli-observations',
            canonicalPath: '/tmp/promote-observations/cli-artifact/quality-observations.json',
            uploadCondition: 'restaged',
          },
          {
            name: SDK_ARTIFACT.name,
            canonicalPath: '/tmp/promote-observations/sdk-artifact/quality-observations.json',
            uploadCondition: 'restaged',
          },
        ],
        optionalTransferStep: "Restage the validated dry-run's canonical observations",
      },
    ],
  },
  {
    profileId: 'monots-mcp-publish',
    workflowPath: '.github/workflows/publish-mcp.yml',
    selectedArtifactNames: ['quality-mcp-observations', SDK_ARTIFACT.name],
    paths: [
      {
        name: 'full-publish',
        jobIds: ['sdk-tests', 'publish'],
        artifacts: [
          SDK_ARTIFACT,
          {
            name: 'quality-mcp-observations',
            canonicalPath: '/tmp/qc-observations/mcp/quality-observations.json',
            uploadCondition: 'always',
          },
        ],
        finalizers: [
          {
            name: 'Build canonical SDK observations',
            after: ['Engine-fixture browser tests — keyless (hard gate)'],
            converterKinds: ['from-junit'],
            gateOutcomes: [
              {
                stepName: 'sdk-core unit tests (hard gate)',
                stepId: 'sdk_unit_gate',
              },
              {
                stepName: 'Engine-fixture browser tests — keyless (hard gate)',
                stepId: 'engine_fixture_gate',
              },
            ],
            requiredInputs: ['sdk-core-unit.junit.xml', 'engine-fixture.junit.xml'],
          },
          {
            name: 'Build canonical MCP observations',
            after: ['Browser behavior tests (hard gate)'],
            converterKinds: ['from-junit'],
            gateOutcomes: [
              {
                stepName: 'Unit tests (hard gate)',
                stepId: 'unit_gate',
              },
              {
                stepName: 'Browser behavior tests (hard gate)',
                stepId: 'browser_gate',
              },
            ],
            requiredInputs: [
              'unit.junit.xml',
              'mcp-server-unit.junit.xml',
              'types-roundtrip.junit.xml',
              'browser-tests.junit.xml',
            ],
          },
        ],
      },
    ],
  },
];

const observationSources = parseYamlFile(OBSERVATION_SOURCES_PATH);

const resolveExpressions = (value) => value.replace(/\$\{\{[^}]*\}\}/g, 'x');

/** A job's steps, following a call into another workflow in this repo. */
function stepsForJob(job) {
  if (typeof job.uses === 'string' && job.uses.startsWith('./')) {
    const calledWorkflow = parseYamlFile(job.uses.slice(2));
    return Object.values(calledWorkflow.jobs ?? {}).flatMap((calledJob) => stepsForJob(calledJob));
  }
  return job.steps ?? [];
}

function uploadSteps(steps) {
  return steps.filter((step) => typeof step.uses === 'string' && step.uses.startsWith('actions/upload-artifact'));
}

function uploadNamed(steps, artifactName) {
  return uploadSteps(steps).find(
    (step) => typeof step.with?.name === 'string' && resolveExpressions(step.with.name) === artifactName,
  );
}

function stepNamed(steps, name) {
  return steps.find((step) => step.name === name);
}

function isAlways(value) {
  return typeof value === 'string' && value.includes('always()');
}

test('SDK workflow keeps raw reports in a non-selected diagnostic artifact', () => {
  const sdkWorkflow = parseYamlFile('.github/workflows/sdk-tests.yml');
  const steps = stepsForJob(sdkWorkflow.jobs['sdk-tests']);
  const upload = uploadNamed(steps, 'sdk-tests-diagnostics');

  assert.ok(upload, 'sdk-tests-diagnostics upload not found');
  assert.ok(String(upload.with?.path ?? '').includes('sdk-core-unit.junit.xml'));
  assert.ok(String(upload.with?.path ?? '').includes('engine-fixture.junit.xml'));
  assert.ok(isAlways(upload.if), 'SDK diagnostics must upload after a failed gate');
  assert.equal(
    observationSources.profiles.some((profile) => profile.github?.artifact_names?.includes('sdk-tests-diagnostics')),
    false,
    'raw diagnostic reports must not be selected as canonical observations',
  );
});

for (const contract of WORKFLOW_CONTRACTS) {
  const workflow = parseYamlFile(contract.workflowPath);
  const profile = observationSources.profiles.find((candidate) => candidate.id === contract.profileId);

  test(`${OBSERVATION_SOURCES_PATH} defines exact canonical profile ${contract.profileId}`, () => {
    assert.ok(profile, `observation profile ${contract.profileId} not found`);
    assert.equal(profile.transport, 'github-actions');
    assert.equal(profile.observation_path, OBSERVATION_PATH);
    assert.deepEqual(
      [...(profile.github?.artifact_names ?? [])].sort(),
      [...contract.selectedArtifactNames].sort(),
      'profile selectors must name only the dedicated canonical artifacts',
    );
    assert.equal(Object.hasOwn(profile, 'source_kind'), false);
    assert.equal(Object.hasOwn(profile, 'adapters'), false);
  });

  test(`${contract.workflowPath} has no unmodelled workflow path`, () => {
    const declaredJobIds = new Set(contract.paths.flatMap((entry) => entry.jobIds));
    const undeclared = Object.keys(workflow.jobs ?? {}).filter((jobId) => !declaredJobIds.has(jobId));

    assert.deepEqual(undeclared, [], `${contract.workflowPath} gained unmodelled job(s): ${undeclared.join(', ')}`);
  });

  for (const workflowPath of contract.paths) {
    const steps = workflowPath.jobIds.flatMap((jobId) => {
      const job = workflow.jobs?.[jobId];
      assert.ok(job, `${contract.workflowPath} has no job ${jobId}`);
      return stepsForJob(job);
    });

    test(`${contract.profileId} ${workflowPath.name} uploads each canonical file through its selected artifact`, () => {
      for (const artifact of workflowPath.artifacts) {
        const upload = uploadNamed(steps, artifact.name);
        assert.ok(upload, `${workflowPath.name} does not upload selected artifact ${artifact.name}`);
        assert.ok(
          String(upload.with?.path ?? '').includes(artifact.canonicalPath),
          `${artifact.name} upload does not contain ${artifact.canonicalPath}`,
        );
        if (artifact.uploadCondition === 'always') {
          assert.ok(isAlways(upload.if), `${artifact.name} must upload after a failed gate`);
        } else if (artifact.uploadCondition === 'restaged') {
          assert.equal(
            upload.if,
            "steps.observation_restage.outputs.available == 'true'",
            `${artifact.name} must upload only after a successful optional restage`,
          );
        } else {
          assert.fail(`${artifact.name} has unknown upload condition ${artifact.uploadCondition}`);
        }
      }
    });

    for (const finalizerContract of workflowPath.finalizers ?? []) {
      test(`${contract.profileId} ${workflowPath.name} finalizes ${finalizerContract.name} after producers, even on failure`, () => {
        const finalizer = stepNamed(steps, finalizerContract.name);
        assert.ok(finalizer, `${finalizerContract.name} step not found`);
        assert.ok(isAlways(finalizer.if), `${finalizerContract.name} must run with if: always()`);
        assert.equal(
          finalizer['continue-on-error'],
          true,
          `${finalizerContract.name} must not become a release prerequisite`,
        );

        const finalizerIndex = steps.indexOf(finalizer);
        for (const producerName of finalizerContract.after) {
          const producer = stepNamed(steps, producerName);
          assert.ok(producer, `${producerName} step not found`);
          assert.ok(steps.indexOf(producer) < finalizerIndex, `${finalizerContract.name} runs before ${producerName}`);
        }

        const text = JSON.stringify(finalizer);
        const actualOutcomeIds = [
          ...String(finalizer.run ?? '').matchAll(/steps\.([A-Za-z_][A-Za-z0-9_-]*)\.outcome/g),
        ].map((match) => match[1]);
        assert.deepEqual(
          actualOutcomeIds.sort(),
          finalizerContract.gateOutcomes.map((gateOutcome) => gateOutcome.stepId).sort(),
          `${finalizerContract.name} references an unexpected gate outcome`,
        );
        for (const gateOutcome of finalizerContract.gateOutcomes) {
          const gateStep = stepNamed(steps, gateOutcome.stepName);
          assert.ok(gateStep, `${gateOutcome.stepName} step not found`);
          assert.equal(gateStep.id, gateOutcome.stepId, `${gateOutcome.stepName} must expose id ${gateOutcome.stepId}`);
          assert.ok(
            steps.indexOf(gateStep) < finalizerIndex,
            `${finalizerContract.name} runs before ${gateOutcome.stepName}`,
          );
        }
        for (const requiredInput of finalizerContract.requiredInputs) {
          assert.ok(text.includes(requiredInput), `${finalizerContract.name} does not include ${requiredInput}`);
        }
        assert.ok(
          String(finalizer.run ?? '').includes('if [ ! -s "$source" ]'),
          `${finalizerContract.name} does not tolerate unavailable native reports`,
        );
        for (const converterKind of finalizerContract.converterKinds) {
          assert.ok(
            String(finalizer.run ?? '').includes(`if ! npx --yes ${QUALITY_TOOLS_INTERFACE} ${converterKind}`),
            `${finalizerContract.name} does not tolerate rejected ${converterKind} input`,
          );
        }
        assert.ok(
          String(finalizer.run ?? '').includes(`if ! npx --yes ${QUALITY_TOOLS_INTERFACE} record`),
          `${finalizerContract.name} does not tolerate a rejected gate record`,
        );
        assert.deepEqual(
          gateOutcomeStatuses(finalizer.run),
          GATE_OUTCOME_STATUSES,
          `${finalizerContract.name} does not map every gate outcome to its canonical status`,
        );
        assert.ok(
          String(finalizer.run ?? '').includes('if [ ${#manifests[@]} -eq 0 ]'),
          `${finalizerContract.name} does not short-circuit when every shard was rejected`,
        );
        assert.ok(text.includes(QUALITY_TOOLS_INTERFACE));
        assert.ok(text.includes('observations validate'));
        assert.equal(text.includes('@shiplightai/quality-tools@^'), false);
      });
    }

    if (workflowPath.optionalTransferStep !== undefined) {
      test(`${contract.profileId} ${workflowPath.name} keeps observation transfer optional`, () => {
        const transfer = stepNamed(steps, workflowPath.optionalTransferStep);
        assert.ok(transfer, `${workflowPath.optionalTransferStep} step not found`);
        assert.equal(
          transfer['continue-on-error'],
          true,
          'missing or invalid observation artifacts must not block promotion',
        );
        assert.ok(JSON.stringify(transfer).includes(QUALITY_TOOLS_INTERFACE));
      });
    }

    test(`${contract.profileId} ${workflowPath.name} uses only exact quality-tools 0.3.2`, () => {
      const text = JSON.stringify(steps);
      assert.ok(text.includes(QUALITY_TOOLS_INTERFACE));
      assert.equal(
        text.includes('@shiplightai/quality-tools@^'),
        false,
        'release workflows must not execute a floating quality-tools range',
      );
    });
  }
}
