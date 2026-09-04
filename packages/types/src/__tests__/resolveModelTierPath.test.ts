/**
 * Unit tests for the tier-selected branch of the end-user model resolvers.
 *
 * The claim under test is narrow and load-bearing: adding tier selection changes
 * behaviour ONLY for a run that Shiplight bills and that carries tier
 * information. Every other env — BYOK, token-without-tier, no credentials —
 * must resolve exactly as it did before. Regressions here are silent: the run
 * still passes, on a model nobody chose.
 *
 * Design: docs/design/llm-tier-selection.md
 */

import assert from 'node:assert';
import { describe, it } from 'node:test';
import {
  DEFAULT_ANTHROPIC_MODEL,
  DEFAULT_GEMINI_COMPUTER_USE_MODEL,
  DEFAULT_GOOGLE_MODEL,
  DEFAULT_OPENAI_COMPUTER_USE_MODEL,
  DEFAULT_OPENAI_MODEL,
  DEFAULT_WEBAGENT_FALLBACK_MODELS,
  DEFAULT_WEBAGENT_MODEL,
  resolveComputerUseModelFromEnv,
  resolveWebAgentFallbackModelsFromEnv,
  resolveWebAgentModelFromEnv,
} from '../organization';
import { BAKED_TIER_MODEL_MAP, TIER_ENV_VAR, TIER_MODEL_MAP_ENV_VAR } from '../llmTiers';

const TOKEN = 'shp_pat_xxx';
const LITE = BAKED_TIER_MODEL_MAP.tiers.lite.webagent;
const PRO = BAKED_TIER_MODEL_MAP.tiers.pro.webagent;

describe('tier-selected path (Shiplight bears the cost)', () => {
  it('resolves the tier primary from the baked map', () => {
    const env = { SHIPLIGHT_API_TOKEN: TOKEN, [TIER_ENV_VAR]: 'pro' };
    assert.strictEqual(resolveWebAgentModelFromEnv(env), PRO.primary);
  });

  it('resolves the tier fallback chain, not the default chain', () => {
    const env = { SHIPLIGHT_API_TOKEN: TOKEN, [TIER_ENV_VAR]: 'pro' };
    assert.deepStrictEqual(resolveWebAgentFallbackModelsFromEnv(env), [...PRO.fallbacks]);
  });

  it('resolves computer-use from the tier-independent slot', () => {
    const env = { SHIPLIGHT_API_TOKEN: TOKEN, [TIER_ENV_VAR]: 'pro' };
    assert.strictEqual(
      resolveComputerUseModelFromEnv(env),
      BAKED_TIER_MODEL_MAP.computerUse.primary,
    );
  });

  it('ignores WEB_AGENT_MODEL — the proxy would reject a non-permitted model anyway', () => {
    const env = {
      SHIPLIGHT_API_TOKEN: TOKEN,
      [TIER_ENV_VAR]: 'lite',
      WEB_AGENT_MODEL: 'anthropic:claude-opus-4-7',
    };
    assert.strictEqual(resolveWebAgentModelFromEnv(env), LITE.primary);
  });

  it('ignores WEB_AGENT_FALLBACK_MODELS, including an explicit empty opt-out', () => {
    const base = { SHIPLIGHT_API_TOKEN: TOKEN, [TIER_ENV_VAR]: 'lite' };
    assert.deepStrictEqual(
      resolveWebAgentFallbackModelsFromEnv({ ...base, WEB_AGENT_FALLBACK_MODELS: 'openai:gpt-5.4' }),
      [...LITE.fallbacks],
    );
    assert.deepStrictEqual(
      resolveWebAgentFallbackModelsFromEnv({ ...base, WEB_AGENT_FALLBACK_MODELS: '' }),
      [...LITE.fallbacks],
    );
  });

  it('ignores COMPUTER_USE_MODEL', () => {
    const env = {
      SHIPLIGHT_API_TOKEN: TOKEN,
      [TIER_ENV_VAR]: 'lite',
      COMPUTER_USE_MODEL: 'openai:gpt-5.4',
    };
    assert.strictEqual(
      resolveComputerUseModelFromEnv(env),
      BAKED_TIER_MODEL_MAP.computerUse.primary,
    );
  });

  it('prefers an injected server map over the baked one', () => {
    const env = {
      SHIPLIGHT_API_TOKEN: TOKEN,
      [TIER_ENV_VAR]: 'lite',
      [TIER_MODEL_MAP_ENV_VAR]: JSON.stringify({
        version: 1,
        defaultTier: 'lite',
        tiers: {
          lite: { webagent: { primary: 'google:from-server', fallbacks: ['anthropic:alt'] } },
          standard: { webagent: { primary: 'google:s', fallbacks: [] } },
          pro: { webagent: { primary: 'google:p', fallbacks: [] } },
        },
        computerUse: { primary: 'google:cua-from-server', fallbacks: [] },
      }),
    };
    assert.strictEqual(resolveWebAgentModelFromEnv(env), 'google:from-server');
    assert.deepStrictEqual(resolveWebAgentFallbackModelsFromEnv(env), ['anthropic:alt']);
    assert.strictEqual(resolveComputerUseModelFromEnv(env), 'google:cua-from-server');
  });

  it('activates on an injected map alone, with no WEB_AGENT_TIER set', () => {
    const env = {
      SHIPLIGHT_API_TOKEN: TOKEN,
      [TIER_MODEL_MAP_ENV_VAR]: JSON.stringify(BAKED_TIER_MODEL_MAP),
    };
    assert.strictEqual(resolveWebAgentModelFromEnv(env), LITE.primary);
  });
});

describe('BYOK is untouched — the customer pays the provider, so the customer picks', () => {
  const BYOK_ENVS: Array<[string, Record<string, string>]> = [
    ['google key', { GOOGLE_API_KEY: 'AIza' }],
    ['anthropic key', { ANTHROPIC_API_KEY: 'sk-ant' }],
    ['openai key', { OPENAI_API_KEY: 'sk' }],
    ['vertex ADC', { GOOGLE_GENAI_USE_VERTEXAI: 'true', GOOGLE_CLOUD_PROJECT: 'proj' }],
  ];

  for (const [label, byok] of BYOK_ENVS) {
    it(`honours WEB_AGENT_MODEL with a ${label}, even alongside a token and a tier`, () => {
      const env = {
        ...byok,
        SHIPLIGHT_API_TOKEN: TOKEN,
        [TIER_ENV_VAR]: 'pro',
        WEB_AGENT_MODEL: 'anthropic:claude-opus-4-7',
      };
      assert.strictEqual(resolveWebAgentModelFromEnv(env), 'anthropic:claude-opus-4-7');
    });

    it(`keeps the default fallback chain with a ${label} and a tier set`, () => {
      const env = { ...byok, SHIPLIGHT_API_TOKEN: TOKEN, [TIER_ENV_VAR]: 'pro' };
      assert.deepStrictEqual(
        resolveWebAgentFallbackModelsFromEnv(env),
        [...DEFAULT_WEBAGENT_FALLBACK_MODELS],
      );
    });
  }

  it('auto-detects per key, unaffected by a tier', () => {
    const tier = { SHIPLIGHT_API_TOKEN: TOKEN, [TIER_ENV_VAR]: 'pro' };
    assert.strictEqual(
      resolveWebAgentModelFromEnv({ ...tier, GOOGLE_API_KEY: 'AIza' }),
      DEFAULT_GOOGLE_MODEL,
    );
    assert.strictEqual(
      resolveWebAgentModelFromEnv({ ...tier, ANTHROPIC_API_KEY: 'sk-ant' }),
      DEFAULT_ANTHROPIC_MODEL,
    );
    assert.strictEqual(
      resolveWebAgentModelFromEnv({ ...tier, OPENAI_API_KEY: 'sk' }),
      DEFAULT_OPENAI_MODEL,
    );
  });

  it('keeps computer-use auto-detection per key', () => {
    const tier = { SHIPLIGHT_API_TOKEN: TOKEN, [TIER_ENV_VAR]: 'pro' };
    assert.strictEqual(
      resolveComputerUseModelFromEnv({ ...tier, GOOGLE_API_KEY: 'AIza' }),
      DEFAULT_GEMINI_COMPUTER_USE_MODEL,
    );
    assert.strictEqual(
      resolveComputerUseModelFromEnv({ ...tier, OPENAI_API_KEY: 'sk' }),
      DEFAULT_OPENAI_COMPUTER_USE_MODEL,
    );
  });

  it('still proxies computer-use for an Anthropic-only run — Anthropic has no CUA model', () => {
    assert.strictEqual(
      resolveComputerUseModelFromEnv({
        ANTHROPIC_API_KEY: 'sk-ant',
        SHIPLIGHT_API_TOKEN: TOKEN,
        [TIER_ENV_VAR]: 'pro',
      }),
      DEFAULT_GEMINI_COMPUTER_USE_MODEL,
    );
  });
});

describe('staged rollout: a proxy run with no tier information is unchanged', () => {
  it('keeps DEFAULT_WEBAGENT_MODEL for a bare token', () => {
    assert.strictEqual(
      resolveWebAgentModelFromEnv({ SHIPLIGHT_API_TOKEN: TOKEN }),
      DEFAULT_WEBAGENT_MODEL,
    );
  });

  it('keeps honouring WEB_AGENT_MODEL for a bare token', () => {
    assert.strictEqual(
      resolveWebAgentModelFromEnv({ SHIPLIGHT_API_TOKEN: TOKEN, WEB_AGENT_MODEL: 'gpt-5.4-mini' }),
      'gpt-5.4-mini',
    );
  });

  it('keeps the default fallback chain for a bare token', () => {
    assert.deepStrictEqual(
      resolveWebAgentFallbackModelsFromEnv({ SHIPLIGHT_API_TOKEN: TOKEN }),
      [...DEFAULT_WEBAGENT_FALLBACK_MODELS],
    );
  });

  it('keeps the proxied computer-use model for a bare token', () => {
    assert.strictEqual(
      resolveComputerUseModelFromEnv({ SHIPLIGHT_API_TOKEN: TOKEN }),
      DEFAULT_GEMINI_COMPUTER_USE_MODEL,
    );
  });

  it('does not tier-resolve a tier set without a token', () => {
    assert.strictEqual(resolveWebAgentModelFromEnv({ [TIER_ENV_VAR]: 'pro' }), undefined);
  });
});
