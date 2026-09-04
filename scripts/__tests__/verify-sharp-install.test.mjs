import assert from 'node:assert/strict';
import test from 'node:test';
import {
  installedPackageSelector,
  validateInstalledDependencyTree,
  validateInstalledPackages,
  validateSharpPackageMetadata,
  verifySharpInstall,
} from '../verify-sharp-install.mjs';

const alignedOptionalDependencies = {
  '@img/sharp-darwin-arm64': '0.35.3',
  '@img/sharp-darwin-x64': '0.35.3',
  '@img/sharp-libvips-darwin-arm64': '1.3.2',
  '@img/sharp-libvips-darwin-x64': '1.3.2',
  '@img/sharp-libvips-linux-arm64': '1.3.2',
  '@img/sharp-libvips-linux-x64': '1.3.2',
  '@img/sharp-libvips-linuxmusl-arm64': '1.3.2',
  '@img/sharp-libvips-linuxmusl-x64': '1.3.2',
  '@img/sharp-linux-arm64': '0.35.3',
  '@img/sharp-linux-x64': '0.35.3',
  '@img/sharp-linuxmusl-arm64': '0.35.3',
  '@img/sharp-linuxmusl-x64': '0.35.3',
  '@img/sharp-win32-arm64': '0.35.3',
  '@img/sharp-win32-x64': '0.35.3',
};

test('candidate metadata accepts aligned native packages for every supported platform', () => {
  assert.doesNotThrow(() =>
    validateSharpPackageMetadata({
      version: '0.35.3',
      optionalDependencies: alignedOptionalDependencies,
    }),
  );
});

test('candidate metadata rejects an off-platform native mismatch', () => {
  assert.throws(
    () =>
      validateSharpPackageMetadata({
        version: '0.35.3',
        optionalDependencies: {
          ...alignedOptionalDependencies,
          '@img/sharp-win32-x64': '0.35.4',
        },
      }),
    /mismatched native package @img\/sharp-win32-x64@0\.35\.4/,
  );
});

test('candidate metadata rejects vulnerable off-platform libvips', () => {
  assert.throws(
    () =>
      validateSharpPackageMetadata({
        version: '0.35.3',
        optionalDependencies: {
          ...alignedOptionalDependencies,
          '@img/sharp-libvips-darwin-arm64': '1.2.4',
        },
      }),
    /vulnerable native package @img\/sharp-libvips-darwin-arm64@1\.2\.4/,
  );
});

test('candidate metadata rejects a missing required platform package', () => {
  const optionalDependencies = { ...alignedOptionalDependencies };
  delete optionalDependencies['@img/sharp-darwin-x64'];

  assert.throws(
    () =>
      validateSharpPackageMetadata({
        version: '0.35.3',
        optionalDependencies,
      }),
    /missing required native package @img\/sharp-darwin-x64/,
  );
});

test('installed tree rejects the unused legacy Agent SDK bundle', () => {
  assert.throws(
    () =>
      validateInstalledDependencyTree(
        {
          '@anthropic-ai/claude-agent-sdk': {
            version: '0.1.77',
          },
        },
        '0.35.3',
      ),
    /unused legacy Agent SDK image bundle/,
  );
});

test('installed package query accepts npm optional dependency orphans', () => {
  assert.deepEqual(
    validateInstalledPackages(
      [
        { name: '@img/sharp-darwin-arm64', version: '0.35.3' },
        { name: '@img/sharp-libvips-darwin-arm64', version: '1.3.2' },
        { name: '@img/sharp-wasm32', version: '0.35.3', extraneous: true },
        { name: '@emnapi/runtime', version: '1.11.3', extraneous: true },
      ],
      '0.35.3',
    ),
    {
      installedNativePackages: 2,
      installedLibvipsPackages: 1,
    },
  );
});

test('installed package query rejects vulnerable libvips', () => {
  assert.throws(
    () =>
      validateInstalledPackages(
        [
          { name: '@img/sharp-darwin-arm64', version: '0.35.3' },
          { name: '@img/sharp-libvips-darwin-arm64', version: '1.2.4' },
        ],
        '0.35.3',
      ),
    /1\.2\.4 is older than 1\.3\.2/,
  );
});

test('installed package query rejects a native package from another Sharp version', () => {
  assert.throws(
    () =>
      validateInstalledPackages(
        [
          { name: '@img/sharp-darwin-arm64', version: '0.35.4' },
          { name: '@img/sharp-libvips-darwin-arm64', version: '1.3.2' },
        ],
        '0.35.3',
      ),
    /installed native package @img\/sharp-darwin-arm64@0\.35\.4 does not match Sharp 0\.35\.3/,
  );
});

test('installed package query rejects an install without a Sharp native package', () => {
  assert.throws(
    () => validateInstalledPackages([{ name: '@img/sharp-libvips-darwin-arm64', version: '1.3.2' }], '0.35.3'),
    /candidate has no installed Sharp native package/,
  );
});

test('installed package query rejects an install without a libvips package', () => {
  assert.throws(
    () => validateInstalledPackages([{ name: '@img/sharp-darwin-arm64', version: '0.35.3' }], '0.35.3'),
    /candidate has no installed libvips package/,
  );
});

test('installed package query is bounded to Sharp and the forbidden Agent SDK', () => {
  assert.equal(installedPackageSelector, '[name^="@img/sharp-"], [name="@anthropic-ai/claude-agent-sdk"]');
});

function verificationDependencies({
  manifest = {
    version: '0.35.3',
    optionalDependencies: alignedOptionalDependencies,
  },
  runtime = {
    sharp: '0.35.3',
    vips: '8.18.3',
    outputInfo: { width: 1, height: 1 },
  },
  onQuery = () => {},
} = {}) {
  return {
    readSharpManifest: () => manifest,
    queryInstalledPackages: (candidateRoot, selector) => {
      onQuery(candidateRoot, selector);
      return [
        { name: '@img/sharp-darwin-arm64', version: '0.35.3' },
        { name: '@img/sharp-libvips-darwin-arm64', version: '1.3.2' },
      ];
    },
    probeSharpRuntime: async () => runtime,
  };
}

test('candidate verification queries the bounded package set from the candidate root', async () => {
  const queries = [];

  const result = await verifySharpInstall(
    '/candidate',
    verificationDependencies({
      onQuery: (candidateRoot, selector) => queries.push({ candidateRoot, selector }),
    }),
  );

  assert.deepEqual(queries, [
    {
      candidateRoot: '/candidate',
      selector: installedPackageSelector,
    },
  ]);
  assert.deepEqual(result, {
    sharp: '0.35.3',
    vips: '8.18.3',
    installedNativePackages: 1,
    installedLibvipsPackages: 1,
  });
});

test('candidate verification invokes package metadata validation', async () => {
  await assert.rejects(
    verifySharpInstall(
      '/candidate',
      verificationDependencies({
        manifest: {
          version: '0.35.3',
          optionalDependencies: {},
        },
      }),
    ),
    /missing required native package @img\/sharp-darwin-arm64/,
  );
});

test('candidate verification rejects a loaded Sharp version that differs from its manifest', async () => {
  await assert.rejects(
    verifySharpInstall(
      '/candidate',
      verificationDependencies({
        runtime: {
          sharp: '0.35.4',
          vips: '8.18.3',
          outputInfo: { width: 1, height: 1 },
        },
      }),
    ),
    /loaded Sharp 0\.35\.4 does not match package manifest 0\.35\.3/,
  );
});

test('candidate verification rejects a vulnerable loaded libvips runtime', async () => {
  await assert.rejects(
    verifySharpInstall(
      '/candidate',
      verificationDependencies({
        runtime: {
          sharp: '0.35.3',
          vips: '8.18.2',
          outputInfo: { width: 1, height: 1 },
        },
      }),
    ),
    /loaded libvips 8\.18\.2 is older than 8\.18\.3/,
  );
});

test('candidate verification rejects an invalid image-smoke result', async () => {
  await assert.rejects(
    verifySharpInstall(
      '/candidate',
      verificationDependencies({
        runtime: {
          sharp: '0.35.3',
          vips: '8.18.3',
          outputInfo: { width: 2, height: 1 },
        },
      }),
    ),
    /image smoke must produce a 1x1 image/,
  );
});
