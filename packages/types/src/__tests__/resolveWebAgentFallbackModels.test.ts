/**
 * Unit tests for resolveWebAgentFallbackModelsFromEnv — the web-agent fallback
 * chain (WEB_AGENT_FALLBACK_MODELS). Unset → the default chain; explicit empty
 * string → [] (opt out); a comma-separated list → that list.
 */

import assert from 'node:assert';
import { describe, it } from 'node:test';
import {
  resolveWebAgentFallbackModelsFromEnv,
  DEFAULT_WEBAGENT_FALLBACK_MODELS,
  DEFAULT_WEBAGENT_MODEL,
} from '../organization';
import { BAKED_TIER_MODEL_MAP } from '../llmTiers';

describe('DEFAULT_WEBAGENT_FALLBACK_MODELS — bound to the Standard tier', () => {
  // The BYOK / non-tier default chain is deliberately kept identical to the
  // Standard tier's chain, because the BYOK default primary IS the Standard
  // primary (gemini-3.5-flash). This locks that binding: if the baked Standard
  // chain changes, this must change with it — one source of truth for "what does
  // a gemini-3.5-flash run fall back to". See organization.ts.
  it('holds the Standard tier fallback chain — literal pin, catches a broken derivation', () => {
    // Comparing DEFAULT to `standard.webagent.fallbacks` would be tautological — it
    // is DERIVED from exactly that array. Pin the concrete values instead: this
    // fails if the derivation is ever replaced by a wrong hardcoded literal, and —
    // together with the baked-map exact-value pin (llmTiers.test.ts) that fixes
    // `standard.fallbacks` to these same values — transitively locks
    // "BYOK default chain == Standard tier chain".
    assert.deepStrictEqual(
      [...DEFAULT_WEBAGENT_FALLBACK_MODELS],
      ['anthropic:claude-sonnet-5', 'openai:gpt-5.6-terra'],
    );
    // And the derivation is still wired to the Standard tier (not a stale copy).
    assert.deepStrictEqual(
      [...DEFAULT_WEBAGENT_FALLBACK_MODELS],
      [...BAKED_TIER_MODEL_MAP.tiers.standard.webagent.fallbacks],
    );
  });

  it('shares its primary with the Standard tier, which is why they are bound', () => {
    assert.strictEqual(DEFAULT_WEBAGENT_MODEL, 'gemini-3.5-flash');
    assert.strictEqual(BAKED_TIER_MODEL_MAP.tiers.standard.webagent.primary, 'google:gemini-3.5-flash');
  });
});

describe('resolveWebAgentFallbackModelsFromEnv', () => {
  it('returns the default chain when the env is undefined', () => {
    assert.deepStrictEqual(
      resolveWebAgentFallbackModelsFromEnv(undefined),
      DEFAULT_WEBAGENT_FALLBACK_MODELS,
    );
  });

  it('returns the default chain when WEB_AGENT_FALLBACK_MODELS is unset', () => {
    assert.deepStrictEqual(
      resolveWebAgentFallbackModelsFromEnv({ WEB_AGENT_MODEL: 'x' }),
      DEFAULT_WEBAGENT_FALLBACK_MODELS,
    );
  });

  it('returns a fresh array (not the shared default) so callers cannot mutate the default', () => {
    const result = resolveWebAgentFallbackModelsFromEnv(undefined);
    assert.notStrictEqual(result, DEFAULT_WEBAGENT_FALLBACK_MODELS);
  });

  it('returns [] when WEB_AGENT_FALLBACK_MODELS is an explicit empty string (opt out)', () => {
    assert.deepStrictEqual(
      resolveWebAgentFallbackModelsFromEnv({ WEB_AGENT_FALLBACK_MODELS: '' }),
      [],
    );
  });

  it('parses a single fallback model', () => {
    assert.deepStrictEqual(
      resolveWebAgentFallbackModelsFromEnv({
        WEB_AGENT_FALLBACK_MODELS: 'anthropic:claude-opus-4-7',
      }),
      ['anthropic:claude-opus-4-7'],
    );
  });

  it('parses an ordered, comma-separated chain and trims whitespace', () => {
    assert.deepStrictEqual(
      resolveWebAgentFallbackModelsFromEnv({
        WEB_AGENT_FALLBACK_MODELS: 'google:gemini-3.5-flash , anthropic:claude-opus-4-7 ,openai:gpt-5.5',
      }),
      ['google:gemini-3.5-flash', 'anthropic:claude-opus-4-7', 'openai:gpt-5.5'],
    );
  });

  it('drops empty entries from stray commas', () => {
    assert.deepStrictEqual(
      resolveWebAgentFallbackModelsFromEnv({
        WEB_AGENT_FALLBACK_MODELS: 'anthropic:claude-opus-4-7,,',
      }),
      ['anthropic:claude-opus-4-7'],
    );
  });
});
