import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { resolveSigningKey, type SigningKeyInputs } from './signingKey.js';

const KEY_PATH = '/home/someone/.ssh/MCP_registry-key.pem';

/** No key anywhere — the situation on a CI dry run and on a fresh clone. */
function noKey(overrides: Partial<SigningKeyInputs> = {}): SigningKeyInputs {
  return { keyPath: KEY_PATH, keyFileExists: false, shouldPublish: false, ...overrides };
}

describe('resolveSigningKey', () => {
  it('lets a preflight run with no key at all', () => {
    // The regression: publish-mcp.yml's dry-run step runs the script without
    // --publish and without the secret, so requiring a key here failed the job
    // at preflight and never reached the `mcp-publisher validate` it exists to
    // run. Every check before login is unauthenticated.
    const verdict = resolveSigningKey(noKey());
    assert.equal(verdict.kind, 'not-needed');
    assert.match(verdict.detail, /not needed/);
  });

  it('blocks a publish that has no key', () => {
    const verdict = resolveSigningKey(noKey({ shouldPublish: true }));
    assert.equal(verdict.kind, 'blocked');
    assert.match(verdict.detail, /MCP_REGISTRY_PRIVATE_KEY/);
    assert.match(verdict.detail, new RegExp(KEY_PATH.replace(/\//g, '\\/')));
  });

  it('prefers the env hex, and does not look at the filesystem when it is set', () => {
    // CI supplies the hex so no PEM is ever written to the runner.
    const verdict = resolveSigningKey(
      noKey({ keyHex: 'a'.repeat(64), keyFileExists: false, shouldPublish: true }),
    );
    assert.equal(verdict.kind, 'env');
    assert.match(verdict.detail, /MCP_REGISTRY_PRIVATE_KEY/);
  });

  it('accepts a PEM that only its owner can read', () => {
    for (const mode of [0o600, 0o400, 0o700]) {
      const verdict = resolveSigningKey(
        noKey({ keyFileExists: true, keyFileMode: mode, shouldPublish: true }),
      );
      assert.equal(verdict.kind, 'file', `mode ${mode.toString(8)} should be accepted`);
      assert.match(verdict.detail, new RegExp(mode.toString(8)));
    }
  });

  it('blocks a PEM readable by group or others', () => {
    // This key signs registry ownership for the whole shiplight.ai domain.
    for (const mode of [0o644, 0o640, 0o604, 0o666, 0o777]) {
      const verdict = resolveSigningKey(
        noKey({ keyFileExists: true, keyFileMode: mode, shouldPublish: true }),
      );
      assert.equal(verdict.kind, 'blocked', `mode ${mode.toString(8)} should be rejected`);
      assert.match(verdict.detail, /chmod 600/);
    }
  });

  it('reports an exposed PEM even on a preflight that would not use it', () => {
    // The exposure is real whether or not this run signs anything, and the
    // preflight is where someone would want to hear about it.
    const verdict = resolveSigningKey(
      noKey({ keyFileExists: true, keyFileMode: 0o644, shouldPublish: false }),
    );
    assert.equal(verdict.kind, 'blocked');
  });

  it('treats a missing mode on an existing file as unreadable-by-others', () => {
    // Defensive: 0 has no group/other bits, so it must not be mistaken for 0o777.
    const verdict = resolveSigningKey(noKey({ keyFileExists: true, shouldPublish: true }));
    assert.equal(verdict.kind, 'file');
  });
});
