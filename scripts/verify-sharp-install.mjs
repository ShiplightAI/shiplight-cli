import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const minimumSafeSharpVersion = [0, 35, 0];
const minimumSafeLibvipsPackageVersion = [1, 3, 2];
const minimumSafeLibvipsRuntimeVersion = [8, 18, 3];
export const installedPackageSelector = '[name^="@img/sharp-"], [name="@anthropic-ai/claude-agent-sdk"]';
const requiredNativePackages = [
  '@img/sharp-darwin-arm64',
  '@img/sharp-darwin-x64',
  '@img/sharp-libvips-darwin-arm64',
  '@img/sharp-libvips-darwin-x64',
  '@img/sharp-libvips-linux-arm64',
  '@img/sharp-libvips-linux-x64',
  '@img/sharp-libvips-linuxmusl-arm64',
  '@img/sharp-libvips-linuxmusl-x64',
  '@img/sharp-linux-arm64',
  '@img/sharp-linux-x64',
  '@img/sharp-linuxmusl-arm64',
  '@img/sharp-linuxmusl-x64',
  '@img/sharp-win32-arm64',
  '@img/sharp-win32-x64',
];

export function assertVersionAtLeast(actual, minimum, description = actual) {
  const match = /^(\d+)\.(\d+)\.(\d+)/.exec(actual);
  assert.notEqual(match, null, `expected a semantic version, received ${actual}`);
  const parts = match.slice(1).map(Number);

  for (let index = 0; index < minimum.length; index += 1) {
    if (parts[index] > minimum[index]) {
      return;
    }
    if (parts[index] < minimum[index]) {
      assert.fail(`${description} is older than ${minimum.join('.')}`);
    }
  }
}

export function validateSharpPackageMetadata(manifest) {
  assert.equal(typeof manifest.version, 'string', 'Sharp package version must be a string');
  assertVersionAtLeast(manifest.version, minimumSafeSharpVersion);

  const optionalDependencies = manifest.optionalDependencies ?? {};
  for (const dependency of requiredNativePackages) {
    assert.equal(typeof optionalDependencies[dependency], 'string', `missing required native package ${dependency}`);
  }

  for (const [dependency, version] of Object.entries(optionalDependencies)) {
    if (dependency.startsWith('@img/sharp-libvips-')) {
      assertVersionAtLeast(
        version,
        minimumSafeLibvipsPackageVersion,
        `vulnerable native package ${dependency}@${version}`,
      );
    } else if (dependency.startsWith('@img/sharp-')) {
      assert.equal(
        version,
        manifest.version,
        `mismatched native package ${dependency}@${version} for Sharp ${manifest.version}`,
      );
    }
  }
}

export function validateInstalledDependencyTree(dependencies, sharpVersion) {
  const installedPackages = [];

  const visit = (currentDependencies = {}) => {
    for (const [name, dependency] of Object.entries(currentDependencies)) {
      installedPackages.push({ name, version: dependency.version });
      visit(dependency.dependencies);
    }
  };

  visit(dependencies);
  return validateInstalledPackages(installedPackages, sharpVersion);
}

export function validateInstalledPackages(installedPackages, sharpVersion) {
  let installedNativePackages = 0;
  let installedLibvipsPackages = 0;

  for (const { name, version } of installedPackages) {
    assert.notEqual(
      name,
      '@anthropic-ai/claude-agent-sdk',
      'candidate includes the unused legacy Agent SDK image bundle',
    );

    if (name?.startsWith('@img/sharp-libvips-') && typeof version === 'string') {
      installedLibvipsPackages += 1;
      assertVersionAtLeast(version, minimumSafeLibvipsPackageVersion);
    } else if (name?.startsWith('@img/sharp-') && typeof version === 'string') {
      installedNativePackages += 1;
      assert.equal(
        version,
        sharpVersion,
        `installed native package ${name}@${version} does not match Sharp ${sharpVersion}`,
      );
    }
  }

  assert.ok(installedNativePackages > 0, 'candidate has no installed Sharp native package');
  assert.ok(installedLibvipsPackages > 0, 'candidate has no installed libvips package');

  return { installedNativePackages, installedLibvipsPackages };
}

function readSharpManifest(candidateRoot) {
  return JSON.parse(readFileSync(path.join(candidateRoot, 'node_modules/sharp/package.json'), 'utf8'));
}

function queryInstalledPackages(candidateRoot, selector) {
  return JSON.parse(
    execFileSync('npm', ['query', selector, '--json'], {
      cwd: candidateRoot,
      encoding: 'utf8',
    }),
  );
}

async function probeSharpRuntime(candidateRoot) {
  const candidateRequire = createRequire(path.join(candidateRoot, 'package.json'));
  const sharp = candidateRequire('sharp');
  const output = await sharp({
    create: {
      width: 2,
      height: 2,
      channels: 4,
      background: { r: 32, g: 96, b: 160, alpha: 1 },
    },
  })
    .resize(1, 1)
    .png()
    .toBuffer({ resolveWithObject: true });

  return {
    sharp: sharp.versions.sharp,
    vips: sharp.versions.vips,
    outputInfo: output.info,
  };
}

export function validateSharpRuntime(runtime, manifestVersion) {
  assert.equal(
    runtime.sharp,
    manifestVersion,
    `loaded Sharp ${runtime.sharp} does not match package manifest ${manifestVersion}`,
  );
  assertVersionAtLeast(runtime.vips, minimumSafeLibvipsRuntimeVersion, `loaded libvips ${runtime.vips}`);
  assert.deepEqual(
    [runtime.outputInfo?.width, runtime.outputInfo?.height],
    [1, 1],
    'image smoke must produce a 1x1 image',
  );
}

export async function verifySharpInstall(candidateRoot = process.cwd(), dependencies = {}) {
  const sharpManifest = (dependencies.readSharpManifest ?? readSharpManifest)(candidateRoot);
  validateSharpPackageMetadata(sharpManifest);

  const installedPackages = (dependencies.queryInstalledPackages ?? queryInstalledPackages)(
    candidateRoot,
    installedPackageSelector,
  );
  const installedSummary = validateInstalledPackages(installedPackages, sharpManifest.version);

  const runtime = await (dependencies.probeSharpRuntime ?? probeSharpRuntime)(candidateRoot);
  validateSharpRuntime(runtime, sharpManifest.version);

  return {
    sharp: runtime.sharp,
    vips: runtime.vips,
    ...installedSummary,
  };
}

const isMain = process.argv[1] !== undefined && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;
if (isMain) {
  console.log(JSON.stringify(await verifySharpInstall(), null, 2));
}
