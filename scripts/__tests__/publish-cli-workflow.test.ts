import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { parse } from 'yaml';

interface WorkflowStep {
  name?: string;
  id?: string;
  run?: string;
}

interface PublishCliWorkflow {
  jobs: {
    publish: {
      steps: WorkflowStep[];
    };
  };
}

const repoRoot = process.cwd();
const workflowPath = '.github/workflows/publish-cli.yml';
const workflow = parse(
  readFileSync(path.join(repoRoot, workflowPath), 'utf8'),
) as PublishCliWorkflow;
const steps = workflow.jobs.publish.steps;

const stepWithId = (id: string): WorkflowStep => {
  const step = steps.find((candidate) => candidate.id === id);
  assert.ok(step, `publish job must have a step with id "${id}"`);
  return step;
};

// The gate's own name promises "all must pass". A --grep/--grep-invert filter on
// the showcase run silently narrows it, so the name stops being true and a test
// can rot indefinitely behind a carve-out nobody re-reads. 18-multi-step-self-heal
// was excluded that way for six weeks after the SDK dropped multi-step
// self-healing; the test was deleted from ShiplightAI/examples instead. If a
// showcase test cannot pass, remove it from the examples repo rather than
// filtering it out here.
test('public examples gate runs the whole showcase project with no title filter', () => {
  const gate = stepWithId('public_examples_gate');

  assert.equal(gate.name, 'E2E — public examples suite (hard gate, all must pass)');
  assert.ok(gate.run, 'public examples gate must have a run body');
  assert.match(gate.run, /npx shiplight test --project=showcase\b/);
  assert.doesNotMatch(gate.run, /--grep-invert\b/);
  assert.doesNotMatch(gate.run, /--grep\b/);
});

// The demo project runs immediately after auth setup so short-lived saucedemo
// session cookies don't expire behind the slower showcase run.
test('public examples gate runs the demo project before the showcase project', () => {
  const gate = stepWithId('public_examples_gate');

  assert.ok(gate.run);
  const demoIndex = gate.run.indexOf('--project=demo');
  const showcaseIndex = gate.run.indexOf('--project=showcase');
  assert.ok(demoIndex >= 0, 'gate must run the demo project');
  assert.ok(showcaseIndex >= 0, 'gate must run the showcase project');
  assert.ok(demoIndex < showcaseIndex, 'demo must run before showcase');
});
