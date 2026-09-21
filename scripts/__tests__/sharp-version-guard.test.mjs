import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { parse } from 'yaml';
import { validateSharpPackageMetadata } from '../verify-sharp-install.mjs';

const repoRoot = process.cwd();
// GHSA-rgj7-g3m4-5g8c: sharp <0.35.4 ships vulnerable libheif.
const minimumSafeVersion = [0, 35, 4];
const dependencyFields =['dependencies', 'optionalDependencies', 'peerDependencies', 'devDependencies'];
const lockfile = parse(readFileSync(path.join(repoRoot, 'pnpm-lock.yaml'), 'utf8'));

function workspacePackageJsonPaths() {
  const workspaceConfig = parse(readFileSync(path.join(repoRoot, 'pnpm-workspace.yaml'), 'utf8'));
  const patterns = workspaceConfig?.packages;
  assert.ok(
    Array.isArray(patterns) && patterns.length > 0,
    'pnpm-workspace.yaml must declare at least one package pattern',
  );

  const manifests = patterns.flatMap((pattern) => {
    assert.equal(typeof pattern, 'string', 'workspace package patterns must be strings');
    if (!pattern.endsWith('/*')) {
      const manifestPath = path.join(repoRoot, pattern, 'package.json');
      return existsSync(manifestPath) ? [manifestPath] : [];
    }

    const parentPath = path.join(repoRoot, pattern.slice(0, -2));
    return readdirSync(parentPath, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => path.join(parentPath, entry.name, 'package.json'))
      .filter(existsSync);
  });

  assert.ok(manifests.length > 0, 'workspace package discovery must find package.json files');
  return manifests;
}

function minimumVersion(range) {
  const match = /^(?:\^|~)?(\d+)\.(\d+)\.(\d+)$/.exec(range);
  assert.notEqual(match, null, `unsupported sharp version range: ${range}`);
  return match.slice(1).map(Number);
}

function compareVersions(left, right) {
  for (let index = 0; index < left.length; index += 1) {
    if (left[index] !== right[index]) {
      return left[index] - right[index];
    }
  }
  return 0;
}

function minimumNodeVersion(range) {
  const match = /^>=(\d+)(?:\.(\d+))?(?:\.(\d+))?$/.exec(range);
  assert.notEqual(match, null, `unsupported Node.js engine range: ${range}`);
  return match.slice(1).map((part) => Number(part ?? 0));
}

test('all supported workspace sharp dependencies exclude versions affected by GHSA-rgj7-g3m4-5g8c', () => {
  const declarations = [];

  for (const manifestPath of workspacePackageJsonPaths()) {
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
    const relativePath = path.relative(repoRoot, manifestPath);

    for (const field of dependencyFields) {
      const range = manifest[field]?.sharp;
      if (range === undefined) {
        continue;
      }

      declarations.push({ field, relativePath });
      assert.equal(typeof range, 'string', `${relativePath} ${field}.sharp must be a string`);
      assert.ok(
        compareVersions(minimumVersion(range), minimumSafeVersion) >= 0,
        `${relativePath} ${field}.sharp allows vulnerable versions via ${range}`,
      );
    }
  }

  assert.ok(
    declarations.some(
      ({ field, relativePath }) => relativePath === 'apps/cli/package.json' && field === 'dependencies',
    ),
    'workspace discovery must inspect the published shiplightai Sharp dependency',
  );
});

test('supported publishable Sharp consumers require Node.js 22 or newer', () => {
  const consumers = [];

  for (const manifestPath of workspacePackageJsonPaths()) {
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
    const relativePath = path.relative(repoRoot, manifestPath);
    if (manifest.private === true) {
      continue;
    }

    const declaresSharp = dependencyFields.some((field) => manifest[field]?.sharp !== undefined);
    if (!declaresSharp) {
      continue;
    }

    consumers.push(relativePath);
    const nodeRange = manifest.engines?.node;
    assert.equal(typeof nodeRange, 'string', `${relativePath} must declare its supported Node.js runtime`);
    assert.ok(
      compareVersions(minimumNodeVersion(nodeRange), [22, 0, 0]) >= 0,
      `${relativePath} must require Node.js 22 or newer, received ${nodeRange}`,
    );
  }

  assert.ok(
    consumers.includes('packages/mobile-sdk/package.json'),
    'the publishable mobile SDK must be covered by the Node.js engine guard',
  );
});

test('the mobile Sharp regression runs in the unit-test CI lane', () => {
  const manifest = JSON.parse(readFileSync(path.join(repoRoot, 'packages/mobile-sdk/package.json'), 'utf8'));
  const unitTestWorkflow = readFileSync(path.join(repoRoot, '.github/workflows/unit-tests.yml'), 'utf8');

  assert.equal(
    manifest.scripts?.['test:unit'],
    'node --test "src/**/*.test.mjs"',
    'mobile-sdk test:unit must run its Node.js regression tests with a portable glob',
  );
  assert.match(
    unitTestWorkflow,
    /pnpm turbo run test:unit test:logic --affected/,
    'unit-test CI must keep invoking affected test:unit scripts',
  );
});

test('the lockfile resolves every non-bundled Sharp package to a patched version', () => {
  const sharpEntries = Object.keys(lockfile?.packages ?? {}).filter((entry) => entry.startsWith('sharp@'));

  assert.ok(sharpEntries.length > 0, 'pnpm-lock.yaml must contain a resolved Sharp package');
  for (const entry of sharpEntries) {
    const version = /^sharp@(\d+\.\d+\.\d+)(?:$|\()/.exec(entry)?.[1];
    assert.notEqual(version, undefined, `cannot parse resolved Sharp version from ${entry}`);
    assert.ok(
      compareVersions(minimumVersion(version), minimumSafeVersion) >= 0,
      `pnpm-lock.yaml resolves the vulnerable package ${entry}`,
    );
  }
});

test('patched Sharp snapshots keep matching native packages and patched libvips binaries', () => {
  const sharpSnapshots = Object.entries(lockfile?.snapshots ?? {}).filter(([entry]) => entry.startsWith('sharp@'));

  assert.ok(sharpSnapshots.length > 0, 'pnpm-lock.yaml must contain a Sharp snapshot');
  for (const [entry, snapshot] of sharpSnapshots) {
    const sharpVersion = /^sharp@(\d+\.\d+\.\d+)(?:$|\()/.exec(entry)?.[1];
    assert.notEqual(sharpVersion, undefined, `cannot parse resolved Sharp version from ${entry}`);

    validateSharpPackageMetadata({
      version: sharpVersion,
      optionalDependencies: snapshot.optionalDependencies,
    });
  }
});

test('shiplightai excludes the unused legacy Agent SDK image bundle', () => {
  const manifest = JSON.parse(readFileSync(path.join(repoRoot, 'apps/cli/package.json'), 'utf8'));

  assert.equal(manifest.dependencies?.sharp, '0.35.4', 'shiplightai must pin the verified Sharp release exactly');
  assert.equal(
    manifest.dependencies?.['@anthropic-ai/claude-agent-sdk'],
    undefined,
    'shiplightai must not ship the unused Agent SDK bundle with its legacy native image stack',
  );
});

test('the CLI publish smoke keeps the candidate audit and native verifier fail closed', () => {
  const workflow = readFileSync(path.join(repoRoot, '.github/workflows/publish-cli.yml'), 'utf8');
  const candidateInstall = workflow.indexOf('      - name: Candidate install (./tarball in temp project)');
  const smokeStart = workflow.indexOf('      - name: Functional smoke');
  const smokeEnd = workflow.indexOf('\n      - name:', smokeStart + 1);

  assert.ok(candidateInstall >= 0, 'publish workflow must install the candidate tarball');
  assert.ok(smokeStart > candidateInstall, 'functional smoke must run after candidate installation');
  assert.ok(smokeEnd > smokeStart, 'functional smoke step must have a following step boundary');

  const smokeStep = workflow.slice(smokeStart, smokeEnd);
  const commands = smokeStep.split('\n').map((line) => line.trim());
  const auditCommand = 'npm audit --omit=dev';
  const verifierCommand = 'node "${{ github.workspace }}/scripts/verify-sharp-install.mjs"';

  assert.equal(
    commands.filter((command) => command === 'set -euo pipefail').length,
    1,
    'functional smoke must remain fail closed',
  );
  assert.doesNotMatch(
    smokeStep,
    /continue-on-error:\s*true|set \+e|\|\|\s*(?:true|:)/,
    'functional smoke must not contain a fail-open modifier',
  );
  assert.equal(
    commands.filter((command) => command === auditCommand).length,
    1,
    'functional smoke must run the exact all-severity production audit',
  );
  assert.equal(
    commands.filter((command) => command === verifierCommand).length,
    1,
    'functional smoke must run the exact native Sharp verifier',
  );

  const audit = commands.indexOf(auditCommand);
  const verifier = commands.indexOf(verifierCommand);
  assert.ok(verifier > audit, 'native Sharp verification must run after the production audit');
});

test('the root override pins Sharp without globally replacing native packages', () => {
  const manifest = JSON.parse(readFileSync(path.join(repoRoot, 'package.json'), 'utf8'));
  const overrides = manifest.pnpm?.overrides ?? {};
  const sharpVersion = overrides.sharp;

  assert.equal(typeof sharpVersion, 'string', 'pnpm.overrides.sharp must be an exact version');
  assert.match(sharpVersion, /^\d+\.\d+\.\d+$/, 'pnpm.overrides.sharp must be exact');
  assert.ok(
    compareVersions(minimumVersion(sharpVersion), minimumSafeVersion) >= 0,
    `pnpm.overrides.sharp resolves the vulnerable version ${sharpVersion}`,
  );
  assert.equal(
    Object.keys(overrides).some((dependency) => dependency.startsWith('@img/sharp-')),
    false,
    'native Sharp packages must keep the version selected by their owning Sharp package',
  );
});
