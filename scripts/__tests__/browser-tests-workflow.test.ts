import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { parse } from 'yaml';

interface WorkflowStep {
  name?: string;
  run?: string;
}

interface BrowserTestsWorkflow {
  jobs: {
    'run-browser-tests': {
      steps: WorkflowStep[];
    };
  };
}

interface PublishCliWorkflow {
  jobs: {
    publish: {
      steps: WorkflowStep[];
    };
  };
}

interface TurboConfig {
  globalPassThroughEnv?: string[];
}

const workflowPath = '.github/workflows/browser-tests.yml';
const workflow = parse(
  readFileSync(path.join(process.cwd(), workflowPath), 'utf8'),
) as BrowserTestsWorkflow;
const publishWorkflow = parse(
  readFileSync(path.join(process.cwd(), '.github/workflows/publish-cli.yml'), 'utf8'),
) as PublishCliWorkflow;
const turboConfig = JSON.parse(
  readFileSync(path.join(process.cwd(), 'turbo.json'), 'utf8'),
) as TurboConfig;

test('browser test workflow provides a virtual display for headed Chromium tests', () => {
  const browserStep = workflow.jobs['run-browser-tests'].steps.find(
    (step) => step.name === 'Run browser tests for affected packages',
  );

  assert.ok(browserStep?.run, 'browser test step must exist');
  assert.match(
    browserStep.run,
    /^xvfb-run -a pnpm turbo run test:browser --affected --concurrency=1$/,
  );
});

test('Turborepo passes the xvfb display environment to browser test tasks', () => {
  assert.ok(turboConfig.globalPassThroughEnv?.includes('DISPLAY'));
  assert.ok(turboConfig.globalPassThroughEnv?.includes('XAUTHORITY'));
});

test('CLI publish browser hard gate provides a virtual display for headed tests', () => {
  const publishJob = publishWorkflow.jobs.publish;
  assert.ok(publishJob, 'CLI publish workflow must have a publish job');

  const browserStep = publishJob.steps.find(
    (step) => step.name === 'Browser e2e — keyless lane (hard gate)',
  );

  assert.ok(browserStep, 'CLI publish browser hard gate step not found');
  assert.ok(browserStep.run, 'CLI publish browser hard gate must have a run script');
  assert.match(
    browserStep.run,
    /xvfb-run -a pnpm exec tsx --test .* \$files/,
  );
});
