/**
 * Unit tests for LLM tier selection — the payload validator, the baked defaults,
 * and the pure resolution of tier → models.
 *
 * Design: docs/design/llm-tier-selection.md
 */

import assert from 'node:assert';
import { describe, it } from 'node:test';
import {
  BAKED_TIER_MODEL_MAP,
  LLM_TIERS,
  TIER_ENV_VAR,
  TIER_MODEL_MAP_ENV_VAR,
  TIER_MODEL_MAP_VERSION,
  hasDirectProviderCredentials,
  isLlmTier,
  isTierSelectionActive,
  parseTierModelMap,
  parseTierModelMapJson,
  resolveTierSelection,
  type TierModelMap,
} from '../llmTiers';

/** A well-formed server map, distinguishable from the baked one at a glance. */
const SERVER_MAP: TierModelMap = {
  version: 1,
  defaultTier: 'standard',
  tiers: {
    lite: { webagent: { primary: 'google:server-lite', fallbacks: [] } },
    standard: { webagent: { primary: 'google:server-standard', fallbacks: ['anthropic:server-alt'] } },
    pro: { webagent: { primary: 'anthropic:server-pro', fallbacks: [] } },
  },
  computerUse: { primary: 'google:server-cua', fallbacks: ['openai:server-cua-alt'] },
};

const serverEnv = (extra: Record<string, string | undefined> = {}) => ({
  SHIPLIGHT_API_TOKEN: 'shp_pat_xxx',
  [TIER_MODEL_MAP_ENV_VAR]: JSON.stringify(SERVER_MAP),
  ...extra,
});

describe('isLlmTier', () => {
  it('accepts the three tiers', () => {
    for (const tier of LLM_TIERS) assert.strictEqual(isLlmTier(tier), true);
  });

  it('rejects anything else', () => {
    for (const value of ['premium', 'economy', 'Lite', '', undefined, 1, null, {}]) {
      assert.strictEqual(isLlmTier(value), false);
    }
  });
});

describe('BAKED_TIER_MODEL_MAP', () => {
  it('passes its own validator — the baked and fetched paths share one shape', () => {
    assert.deepStrictEqual(parseTierModelMap(BAKED_TIER_MODEL_MAP), BAKED_TIER_MODEL_MAP);
  });

  it('survives a JSON round trip, so it can ship over the same transport', () => {
    const roundTripped = parseTierModelMapJson(JSON.stringify(BAKED_TIER_MODEL_MAP));
    assert.deepStrictEqual(roundTripped, BAKED_TIER_MODEL_MAP);
  });

  it('declares the version this SDK understands', () => {
    assert.strictEqual(BAKED_TIER_MODEL_MAP.version, TIER_MODEL_MAP_VERSION);
  });

  it('names every model as provider:model, in every slot', () => {
    const identifiers = [
      ...LLM_TIERS.flatMap((tier) => {
        const slot = BAKED_TIER_MODEL_MAP.tiers[tier].webagent;
        return [slot.primary, ...slot.fallbacks];
      }),
      BAKED_TIER_MODEL_MAP.computerUse.primary,
      ...BAKED_TIER_MODEL_MAP.computerUse.fallbacks,
    ];
    for (const identifier of identifiers) {
      assert.match(
        identifier,
        /^(google|anthropic|openai):.+$/,
        `${identifier} is not normalised to provider:model`,
      );
    }
  });

  it('is deeply frozen, so a caller cannot corrupt later resolutions', () => {
    assert.throws(() => {
      (BAKED_TIER_MODEL_MAP.tiers.lite.webagent.fallbacks as string[]).push('nope');
    });
  });

  // Pins the exact curated membership. This is a contract with
  // docs/design/llm-tier-baked-map.md, not incidental data — update BOTH
  // together. A silent edit to a primary or chain (e.g. a bad merge) fails here
  // rather than shipping a wrong offline default. Ordering rule: Gemini primary +
  // cross-provider (Anthropic, OpenAI) fallbacks; Pro has no Gemini member so it
  // is Anthropic-primary with an OpenAI fallback.
  it('matches the curated baked membership exactly', () => {
    assert.deepStrictEqual(BAKED_TIER_MODEL_MAP, {
      version: 1,
      defaultTier: 'lite',
      tiers: {
        lite: {
          webagent: {
            primary: 'google:gemini-3-flash-preview',
            fallbacks: ['anthropic:claude-haiku-4-5', 'openai:gpt-5.6-luna'],
          },
        },
        standard: {
          webagent: {
            primary: 'google:gemini-3.5-flash',
            fallbacks: ['anthropic:claude-sonnet-5', 'openai:gpt-5.6-terra'],
          },
        },
        pro: {
          webagent: {
            primary: 'anthropic:claude-opus-4-8',
            fallbacks: ['openai:gpt-5.6-sol', 'anthropic:claude-opus-4-7'],
          },
        },
      },
      computerUse: { primary: 'google:gemini-3-flash-preview', fallbacks: [] },
    });
  });
});

describe('parseTierModelMap', () => {
  it('accepts a complete current-version map', () => {
    assert.deepStrictEqual(parseTierModelMap(SERVER_MAP), SERVER_MAP);
  });

  it('treats a missing fallbacks field as an empty chain', () => {
    const raw = JSON.parse(JSON.stringify(SERVER_MAP));
    delete raw.tiers.lite.webagent.fallbacks;
    assert.deepStrictEqual(parseTierModelMap(raw)?.tiers.lite.webagent.fallbacks, []);
  });

  it('rejects an unknown version rather than misreading it', () => {
    assert.strictEqual(parseTierModelMap({ ...SERVER_MAP, version: 2 }), undefined);
    assert.strictEqual(parseTierModelMap({ ...SERVER_MAP, version: '1' }), undefined);
  });

  it('rejects a map missing a tier — all-or-nothing, never half server-resolved', () => {
    const raw = JSON.parse(JSON.stringify(SERVER_MAP));
    delete raw.tiers.pro;
    assert.strictEqual(parseTierModelMap(raw), undefined);
  });

  it('rejects an unknown defaultTier', () => {
    assert.strictEqual(parseTierModelMap({ ...SERVER_MAP, defaultTier: 'premium' }), undefined);
  });

  it('rejects a missing computerUse slot', () => {
    const raw = JSON.parse(JSON.stringify(SERVER_MAP));
    delete raw.computerUse;
    assert.strictEqual(parseTierModelMap(raw), undefined);
  });

  it('rejects an empty or non-string primary', () => {
    for (const primary of ['', '   ', 42, null]) {
      const raw = JSON.parse(JSON.stringify(SERVER_MAP));
      raw.tiers.standard.webagent.primary = primary;
      assert.strictEqual(parseTierModelMap(raw), undefined, `primary=${String(primary)}`);
    }
  });

  it('rejects a whitespace-padded primary (same strictness as fallbacks)', () => {
    // A padded primary would pass a bare non-empty check yet break parseModel's
    // provider-prefix match downstream (` google` is not a known provider).
    for (const primary of ['google:gemini-3.5-flash ', ' google:gemini-3.5-flash', ' x ']) {
      const raw = JSON.parse(JSON.stringify(SERVER_MAP));
      raw.tiers.standard.webagent.primary = primary;
      assert.strictEqual(parseTierModelMap(raw), undefined, JSON.stringify(primary));
    }
  });

  it('rejects a malformed fallbacks chain instead of silently emptying it', () => {
    for (const fallbacks of ['anthropic:x', [''], [1], [' padded:x']]) {
      const raw = JSON.parse(JSON.stringify(SERVER_MAP));
      raw.tiers.standard.webagent.fallbacks = fallbacks;
      assert.strictEqual(parseTierModelMap(raw), undefined, JSON.stringify(fallbacks));
    }
  });

  it('rejects non-objects', () => {
    for (const raw of [undefined, null, 'x', 3, [SERVER_MAP]]) {
      assert.strictEqual(parseTierModelMap(raw), undefined);
    }
  });
});

describe('parseTierModelMapJson', () => {
  it('returns undefined for absent or unparseable JSON', () => {
    assert.strictEqual(parseTierModelMapJson(undefined), undefined);
    assert.strictEqual(parseTierModelMapJson(''), undefined);
    assert.strictEqual(parseTierModelMapJson('{not json'), undefined);
  });
});

describe('hasDirectProviderCredentials', () => {
  it('is true for each direct provider credential', () => {
    assert.strictEqual(hasDirectProviderCredentials({ GOOGLE_API_KEY: 'AIza' }), true);
    assert.strictEqual(hasDirectProviderCredentials({ ANTHROPIC_API_KEY: 'sk-ant' }), true);
    assert.strictEqual(hasDirectProviderCredentials({ OPENAI_API_KEY: 'sk' }), true);
    assert.strictEqual(hasDirectProviderCredentials({ OPENROUTER_API_KEY: 'sk-or-v1' }), true);
    assert.strictEqual(
      hasDirectProviderCredentials({
        GOOGLE_GENAI_USE_VERTEXAI: 'true',
        GOOGLE_CLOUD_PROJECT: 'proj',
      }),
      true,
    );
  });

  it('needs both halves of the Vertex ADC pair', () => {
    assert.strictEqual(hasDirectProviderCredentials({ GOOGLE_GENAI_USE_VERTEXAI: 'true' }), false);
    assert.strictEqual(hasDirectProviderCredentials({ GOOGLE_CLOUD_PROJECT: 'proj' }), false);
  });

  it('is false for a bare OPENAI_BASE_URL — openai.ts honours it only with a key', () => {
    assert.strictEqual(
      hasDirectProviderCredentials({ OPENAI_BASE_URL: 'http://localhost:11434/v1' }),
      false,
    );
  });

  it('is false for a Shiplight token alone', () => {
    assert.strictEqual(hasDirectProviderCredentials({ SHIPLIGHT_API_TOKEN: 'shp_pat_x' }), false);
  });
});

describe('isTierSelectionActive', () => {
  it('is true for a token plus tier information', () => {
    assert.strictEqual(isTierSelectionActive(serverEnv()), true);
    assert.strictEqual(
      isTierSelectionActive({ SHIPLIGHT_API_TOKEN: 'shp_pat_x', [TIER_ENV_VAR]: 'pro' }),
      true,
    );
  });

  it('is false without a Shiplight token — nobody is billing us', () => {
    assert.strictEqual(isTierSelectionActive({ [TIER_ENV_VAR]: 'pro' }), false);
  });

  it('is false when a direct provider key is present — BYOK opts out entirely', () => {
    for (const byok of [
      { GOOGLE_API_KEY: 'AIza' },
      { ANTHROPIC_API_KEY: 'sk-ant' },
      { OPENAI_API_KEY: 'sk' },
      { GOOGLE_GENAI_USE_VERTEXAI: 'true', GOOGLE_CLOUD_PROJECT: 'proj' },
    ]) {
      assert.strictEqual(isTierSelectionActive(serverEnv(byok)), false, JSON.stringify(byok));
    }
  });

  it('is false for a token with no tier information — staged rollout', () => {
    assert.strictEqual(isTierSelectionActive({ SHIPLIGHT_API_TOKEN: 'shp_pat_x' }), false);
  });
});

describe('resolveTierSelection', () => {
  it('falls back to the baked map when none was injected', () => {
    const selection = resolveTierSelection({ SHIPLIGHT_API_TOKEN: 'shp_pat_x' });
    assert.strictEqual(selection.mapSource, 'baked');
    assert.strictEqual(selection.tier, BAKED_TIER_MODEL_MAP.defaultTier);
    assert.strictEqual(selection.tierSource, 'baked-default');
    assert.strictEqual(
      selection.webagent.primary,
      BAKED_TIER_MODEL_MAP.tiers[BAKED_TIER_MODEL_MAP.defaultTier].webagent.primary,
    );
  });

  it('falls back to the baked map when the injected one is malformed', () => {
    const selection = resolveTierSelection({ [TIER_MODEL_MAP_ENV_VAR]: '{"version":99}' });
    assert.strictEqual(selection.mapSource, 'baked');
  });

  it('uses the server map and its defaultTier when no tier is set', () => {
    const selection = resolveTierSelection(serverEnv());
    assert.strictEqual(selection.mapSource, 'server');
    assert.strictEqual(selection.tier, 'standard');
    assert.strictEqual(selection.tierSource, 'org-default');
    assert.strictEqual(selection.webagent.primary, 'google:server-standard');
    assert.deepStrictEqual(selection.webagent.fallbacks, ['anthropic:server-alt']);
    assert.strictEqual(selection.computerUse.primary, 'google:server-cua');
  });

  it('lets WEB_AGENT_TIER win over the org default — CI sets it per job', () => {
    const selection = resolveTierSelection(serverEnv({ [TIER_ENV_VAR]: 'pro' }));
    assert.strictEqual(selection.tier, 'pro');
    assert.strictEqual(selection.tierSource, 'env');
    assert.strictEqual(selection.webagent.primary, 'anthropic:server-pro');
  });

  it('resolves every tier against the baked map', () => {
    for (const tier of LLM_TIERS) {
      const selection = resolveTierSelection({ [TIER_ENV_VAR]: tier });
      assert.strictEqual(selection.tier, tier);
      assert.strictEqual(
        selection.webagent.primary,
        BAKED_TIER_MODEL_MAP.tiers[tier].webagent.primary,
      );
    }
  });

  it('ignores an unknown WEB_AGENT_TIER but reports it', () => {
    const selection = resolveTierSelection(serverEnv({ [TIER_ENV_VAR]: 'turbo' }));
    assert.strictEqual(selection.tier, 'standard');
    assert.strictEqual(selection.tierSource, 'org-default');
    assert.strictEqual(selection.invalidTier, 'turbo');
  });

  it('treats an empty WEB_AGENT_TIER as unset — no invalidTier, uses the default', () => {
    // Must agree with isTierSelectionActive, which uses Boolean("") = false: an
    // empty value is "no tier requested", not an invalid tier to warn about.
    const selection = resolveTierSelection(serverEnv({ [TIER_ENV_VAR]: '' }));
    assert.strictEqual(selection.tier, 'standard');
    assert.strictEqual(selection.tierSource, 'org-default');
    assert.strictEqual(selection.invalidTier, undefined);
  });

  it('names the model-selection env vars it is ignoring, and only those present', () => {
    const selection = resolveTierSelection(
      serverEnv({ WEB_AGENT_MODEL: 'gpt-5.4', COMPUTER_USE_MODEL: 'gemini-3-flash-preview' }),
    );
    assert.deepStrictEqual(selection.ignoredEnvVars, ['WEB_AGENT_MODEL', 'COMPUTER_USE_MODEL']);
  });

  it('reports nothing ignored when no model env vars are set', () => {
    assert.deepStrictEqual(resolveTierSelection(serverEnv()).ignoredEnvVars, []);
  });

  it('returns copies, so a caller mutating the chain cannot poison later runs', () => {
    const env = { [TIER_ENV_VAR]: 'standard' as const };
    resolveTierSelection(env).webagent.fallbacks.push('anthropic:injected');
    assert.deepStrictEqual(
      resolveTierSelection(env).webagent.fallbacks,
      [...BAKED_TIER_MODEL_MAP.tiers.standard.webagent.fallbacks],
    );
  });
});
