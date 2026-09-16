import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { SDK_ENV_ALLOWLIST, buildSdkEnv } from './fixture.js';

/**
 * Regression tests for the Shiplight → sdk-core env var allowlist.
 *
 * The allowlist in `fixture.ts` is the single point where user-visible
 * `process.env` state crosses into sdk-core's internal `SdkConfig.env`.
 * sdk-core is strict — it reads env vars only from `SdkConfig.env`, never
 * from `process.env` directly — so the contents of this allowlist determine
 * exactly which env vars the agent can see at runtime.
 *
 * These tests exist to lock in the following invariants:
 *
 * 1. The allowlist contains exactly the expected set of keys. Neither
 *    silently dropping a key (which would break users who rely on it) nor
 *    silently adding a key (which would expand the security surface) is
 *    allowed without a deliberate edit here.
 *
 * 2. The allowlist never contains generic/sensitive shell variables like
 *    PATH, HOME, USER, HOSTNAME, PWD, SSH_AUTH_SOCK, etc. Leaking any of
 *    these through SdkConfig.env would defeat the whole point of the
 *    allowlist.
 *
 * 3. `buildSdkEnv()` copies exactly the allowlisted keys from a given
 *    source record, with empty-string fallbacks for missing keys, and
 *    never includes any non-allowlisted key even if the source contains
 *    extra fields.
 */

// Keep EXPECTED_KEYS in lockstep with SDK_ENV_ALLOWLIST. When you add a
// real new env var, update BOTH in the same commit — the test existing
// purely to catch the case where a reviewer only updates one side.
const EXPECTED_KEYS = [
  'GOOGLE_API_KEY',
  'ANTHROPIC_API_KEY',
  'OPENAI_API_KEY',
  'OPENROUTER_API_KEY',
  'OPENAI_BASE_URL',
  'ANTHROPIC_MODELS_USE_VERTEXAI',
  'GOOGLE_GENAI_USE_VERTEXAI',
  'GOOGLE_CLOUD_PROJECT',
  'GOOGLE_CLOUD_LOCATION',
  'MAILGUN_API_KEY',
  'MAILGUN_DOMAIN',
  'SHIPLIGHT_API_TOKEN',
  'SHIPLIGHT_API_URL',
  'WEB_AGENT_LLM_TIMEOUT_MS',
  'SDK_LOG_LEVEL',
  'USE_DOM_TREE_TS',
  'OMNITERM_BROWSER_REGISTRY_URL',
] as const;

const FORBIDDEN_SHELL_VARS = [
  'PATH',
  'HOME',
  'USER',
  'USERNAME',
  'HOSTNAME',
  'PWD',
  'SHELL',
  'SSH_AUTH_SOCK',
  'SSH_AGENT_PID',
  'TERM',
  'LANG',
  'LC_ALL',
  'NODE_PATH',
  'NODE_OPTIONS',
  'NPM_TOKEN',
  'CI',
  'GITHUB_TOKEN',
  'AWS_ACCESS_KEY_ID',
  'AWS_SECRET_ACCESS_KEY',
];

describe('SDK_ENV_ALLOWLIST', () => {
  it('contains exactly the expected set of keys', () => {
    const actual = [...SDK_ENV_ALLOWLIST].sort();
    const expected = [...EXPECTED_KEYS].sort();
    assert.deepEqual(
      actual,
      expected,
      'SDK_ENV_ALLOWLIST drifted from EXPECTED_KEYS. Update both lists in the same commit and add release notes.'
    );
  });

  it('has no duplicate keys', () => {
    const unique = new Set(SDK_ENV_ALLOWLIST);
    assert.equal(
      unique.size,
      SDK_ENV_ALLOWLIST.length,
      'SDK_ENV_ALLOWLIST contains duplicate entries'
    );
  });

  it('never forwards generic shell or credential env vars', () => {
    for (const forbidden of FORBIDDEN_SHELL_VARS) {
      assert.equal(
        (SDK_ENV_ALLOWLIST as readonly string[]).includes(forbidden),
        false,
        `SDK_ENV_ALLOWLIST must never include "${forbidden}" — it would leak shell state into the SDK`
      );
    }
  });

  it('only contains uppercase environment-style names', () => {
    for (const key of SDK_ENV_ALLOWLIST) {
      assert.match(
        key,
        /^[A-Z][A-Z0-9_]*$/,
        `Allowlist entry "${key}" is not a valid env var name`
      );
    }
  });
});

describe('buildSdkEnv', () => {
  it('copies exactly the allowlisted keys from the source', () => {
    const source = {
      GOOGLE_API_KEY: 'g-1',
      ANTHROPIC_API_KEY: 'a-1',
      OPENAI_API_KEY: 'o-1',
      OPENROUTER_API_KEY: 'or-1',
      OPENAI_BASE_URL: 'https://example.test/v1',
      ANTHROPIC_MODELS_USE_VERTEXAI: 'true',
      GOOGLE_GENAI_USE_VERTEXAI: 'true',
      GOOGLE_CLOUD_PROJECT: 'proj',
      GOOGLE_CLOUD_LOCATION: 'us-central1',
      MAILGUN_API_KEY: 'mg',
      MAILGUN_DOMAIN: 'mg.example.com',
      SHIPLIGHT_API_TOKEN: 'shp_pat_test',
      SHIPLIGHT_API_URL: 'http://localhost:3001',
      WEB_AGENT_LLM_TIMEOUT_MS: '120000',
      SDK_LOG_LEVEL: 'debug',
      USE_DOM_TREE_TS: 'true',
      OMNITERM_BROWSER_REGISTRY_URL: 'http://localhost:9999/t/abc/registry',
    };
    const result = buildSdkEnv(source);
    assert.deepEqual(
      Object.keys(result).sort(),
      [...SDK_ENV_ALLOWLIST].sort(),
      'buildSdkEnv should return exactly the allowlisted keys'
    );
    for (const key of SDK_ENV_ALLOWLIST) {
      assert.equal(result[key], source[key as keyof typeof source]);
    }
  });

  it('fills missing keys with empty strings', () => {
    const result = buildSdkEnv({});
    for (const key of SDK_ENV_ALLOWLIST) {
      assert.equal(result[key], '', `${key} should default to empty string`);
    }
  });

  it('ignores non-allowlisted keys in the source', () => {
    const source = {
      GOOGLE_API_KEY: 'g',
      PATH: '/usr/local/bin:/usr/bin',
      HOME: '/Users/test',
      GITHUB_TOKEN: 'ghp_secret',
      EVIL_VAR: 'nope',
    };
    const result = buildSdkEnv(source);
    const resultKeys = Object.keys(result);

    // Only allowlisted keys appear
    for (const key of resultKeys) {
      assert.ok(
        (SDK_ENV_ALLOWLIST as readonly string[]).includes(key),
        `buildSdkEnv returned non-allowlisted key: ${key}`
      );
    }

    // Specific forbidden keys absent
    assert.equal(resultKeys.includes('PATH'), false);
    assert.equal(resultKeys.includes('HOME'), false);
    assert.equal(resultKeys.includes('GITHUB_TOKEN'), false);
    assert.equal(resultKeys.includes('EVIL_VAR'), false);

    // The one allowlisted key in the source is still copied through
    assert.equal(result.GOOGLE_API_KEY, 'g');
  });

  it('defaults to the Shiplight .env stash when no source is provided', () => {
    // Just call it and ensure it returns an object with all keys — we
    // don't assert on actual values because they come from the real env.
    const result = buildSdkEnv();
    assert.deepEqual(
      Object.keys(result).sort(),
      [...SDK_ENV_ALLOWLIST].sort()
    );
    // All values must be strings (never undefined) because of the ?? ''
    for (const key of SDK_ENV_ALLOWLIST) {
      assert.equal(typeof result[key], 'string');
    }
  });
});
