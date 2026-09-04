import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { configureSdk, getSdkConfig } from 'sdk-core';
import { SDK_ENV_ALLOWLIST, buildSdkEnv } from './fixture.js';
import { loadShiplightEnv, __setShiplightEnvForTest } from './dotenvSource.js';

/**
 * RUNTIME no-leak proof for the SDK env allowlist — the proof_upgrade for
 * quality-evidence check exp-env-allowlist (002-shiplightai-cli).
 *
 * The sibling guards are deliberately weaker:
 *   - fixture.allowlist.test.ts feeds buildSdkEnv() a *synthetic* source object.
 *   - fixture.allowlist.wiring.test.ts is STATIC — it regex-matches fixture.ts
 *     source to confirm the agent fixture calls configureSdk({ env: buildSdkEnv() }).
 * Neither executes the real data flow, because the agent fixture needs a live
 * browser (the e2e lane).
 *
 * This test executes the ACTUAL startup chain with a polluted real environment,
 * and reads back what sdk-core ends up storing:
 *
 *   process.env (with GITHUB_TOKEN / NPM_TOKEN / AWS_*)
 *     -> loadShiplightEnv()   (seeds the Shiplight stash from the FULL process.env)
 *       -> buildSdkEnv()      (the allowlist filter — the only barrier)
 *         -> configureSdk()   (the exact call the agent fixture makes)
 *           -> getSdkConfig().env   (what the SDK / AI agent can actually read)
 *
 * loadShiplightEnv() genuinely copies every key of process.env into the source
 * buildSdkEnv() reads from, so the secrets ARE present one step before the
 * filter. If the allowlist ever regressed, these secrets would reach the SDK.
 */

const SECRETS: Record<string, string> = {
  GITHUB_TOKEN: 'ghp_LEAKED_github_token',
  NPM_TOKEN: 'npm_LEAKED_registry_token',
  AWS_ACCESS_KEY_ID: 'AKIA_LEAKED_KEY_ID',
  AWS_SECRET_ACCESS_KEY: 'aws_LEAKED_secret_access_key',
  SSH_AUTH_SOCK: '/tmp/leaked-ssh-agent.sock',
};
const ALLOWED: Record<string, string> = {
  GOOGLE_API_KEY: 'g-allowed-runtime-value',
};

describe('SDK env allowlist — runtime no-leak through the real startup chain', () => {
  const touched = [...Object.keys(SECRETS), ...Object.keys(ALLOWED)];
  let saved: Record<string, string | undefined> = {};
  let isolatedStart: string | undefined;

  afterEach(() => {
    // Reset the Shiplight env stash (back to the unloaded state) and restore
    // every process.env key this test touched, so neighbouring tests are unaffected.
    __setShiplightEnvForTest(undefined);
    for (const k of touched) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
    saved = {};
    // Clear the env we pushed into sdk-core's singleton config.
    configureSdk({ env: {} });
    // Remove the temp dir created for the .env walk start.
    if (isolatedStart) {
      rmSync(isolatedStart, { recursive: true, force: true });
      isolatedStart = undefined;
    }
  });

  it('secrets in process.env never reach getSdkConfig().env; allowlisted keys do', () => {
    for (const k of touched) saved[k] = process.env[k];
    Object.assign(process.env, SECRETS, ALLOWED);

    // Real startup loader. Start the .env walk from a fresh temp dir so no
    // project .env overlays the seed — the stash becomes a copy of process.env,
    // exactly as it is in CI where secrets arrive purely via the environment.
    isolatedStart = mkdtempSync(path.join(os.tmpdir(), 'shiplight-allowlist-'));
    loadShiplightEnv(isolatedStart);

    // The exact call the agent fixture makes (fixture.ts:791).
    configureSdk({ env: buildSdkEnv() });

    // What the SDK / AI agent can actually read at runtime.
    const sdkEnv = getSdkConfig().env ?? {};

    // 1. The SDK env is exactly the allowlist — no more (no secret added) and no
    //    less (the SDK did not strip a key). The security guarantee proper is in
    //    assertions 3 and 4; this pins the surface shape.
    assert.deepEqual(
      Object.keys(sdkEnv).sort(),
      [...SDK_ENV_ALLOWLIST].sort(),
      'getSdkConfig().env must contain exactly the allowlist — no more, no less.',
    );

    // 2. The allowlisted key flowed through from the real environment (proves the
    //    chain is live, not short-circuited — a stray .env override would fail here).
    assert.equal(sdkEnv.GOOGLE_API_KEY, 'g-allowed-runtime-value');

    // 3. No secret KEY leaked into the SDK env.
    for (const k of Object.keys(SECRETS)) {
      assert.equal(k in sdkEnv, false, `secret key ${k} leaked into getSdkConfig().env`);
    }

    // 4. No secret VALUE leaked under ANY key (guards a future allowlist alias
    //    that might map a benign key to a secret-bearing source field).
    const values = Object.values(sdkEnv);
    for (const [k, v] of Object.entries(SECRETS)) {
      assert.equal(values.includes(v), false, `secret value of ${k} leaked into getSdkConfig().env`);
    }
  });
});
