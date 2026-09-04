/**
 * Unit tests for the pre-test org-settings fetch and the model-selection report.
 *
 * The failure policy is the substance here: which conditions degrade quietly,
 * which warn, and the single condition that must abort the run before browsers
 * start. Every branch is reachable from a stubbed fetch, so none of it needs a
 * network or a live token.
 *
 * Design: docs/design/llm-tier-selection.md §2
 */

import assert from 'node:assert';
import { describe, it } from 'node:test';
import {
  BAKED_TIER_MODEL_MAP,
  TIER_ENV_VAR,
  TIER_MODEL_MAP_ENV_VAR,
  type TierModelMap,
} from 'shiplight-types';
import {
  buildModelTierProvenance,
  describeTierSelection,
  fetchOrgSettings,
  isOfflineEnv,
  resolveTierEnvForDebugger,
  resolveTierPreflight,
  tierMapEnvEntry,
} from './orgSettings.js';

const TOKEN = 'shp_pat_xxx';

const SERVER_MAP: TierModelMap = {
  version: 1,
  defaultTier: 'standard',
  tiers: {
    lite: { webagent: { primary: 'google:server-lite', fallbacks: [] } },
    standard: { webagent: { primary: 'google:server-standard', fallbacks: ['anthropic:alt'] } },
    pro: { webagent: { primary: 'anthropic:server-pro', fallbacks: [] } },
  },
  computerUse: { primary: 'google:server-cua', fallbacks: [] },
};

/**
 * A fetch stub that records the request it was given. It rejects on abort, as
 * the platform `fetch` does — without that a stub which never settles would hang
 * the test run rather than exercising the timeout path.
 */
function stubFetch(respond: () => Response | Promise<Response>) {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const impl = ((url: unknown, init?: RequestInit) => {
    calls.push({ url: String(url), init });
    const signal = init?.signal;
    if (!signal) return Promise.resolve().then(respond);
    return Promise.race([
      Promise.resolve().then(respond),
      new Promise<never>((_, reject) => {
        const abort = () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' }));
        if (signal.aborted) abort();
        else signal.addEventListener('abort', abort, { once: true });
      }),
    ]);
  }) as unknown as typeof fetch;
  return { impl, calls };
}

const jsonResponse = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

const failFetch = () => {
  const { impl, calls } = stubFetch(() => {
    throw new Error('fetch should not have been called');
  });
  return { impl, calls };
};

describe('fetchOrgSettings — when it calls out at all', () => {
  it('skips silently with no token: nothing is billed to us, nothing to authenticate', async () => {
    const { impl, calls } = failFetch();
    const result = await fetchOrgSettings({}, { fetchImpl: impl });
    assert.deepStrictEqual(result, { warnings: [] });
    assert.strictEqual(calls.length, 0);
  });

  it('skips silently under --offline', async () => {
    const { impl, calls } = failFetch();
    const result = await fetchOrgSettings({ SHIPLIGHT_API_TOKEN: TOKEN }, {
      offline: true,
      fetchImpl: impl,
    });
    assert.deepStrictEqual(result, { warnings: [] });
    assert.strictEqual(calls.length, 0);
  });

  it('skips silently under SHIPLIGHT_OFFLINE', async () => {
    const { impl, calls } = failFetch();
    await fetchOrgSettings(
      { SHIPLIGHT_API_TOKEN: TOKEN, SHIPLIGHT_OFFLINE: 'true' },
      { fetchImpl: impl },
    );
    assert.strictEqual(calls.length, 0);
  });

  it('still fetches for a BYOK run — the endpoint is org-scoped, not LLM-scoped', async () => {
    const { impl, calls } = stubFetch(() => jsonResponse(SERVER_MAP));
    await fetchOrgSettings(
      { SHIPLIGHT_API_TOKEN: TOKEN, GOOGLE_API_KEY: 'AIza' },
      { fetchImpl: impl },
    );
    assert.strictEqual(calls.length, 1);
  });

  it('authenticates with a bearer token against the token-appropriate API base', async () => {
    const { impl, calls } = stubFetch(() => jsonResponse(SERVER_MAP));
    await fetchOrgSettings({ SHIPLIGHT_API_TOKEN: TOKEN }, { fetchImpl: impl });
    assert.match(calls[0].url, /\/org-settings$/);
    assert.strictEqual(
      (calls[0].init?.headers as Record<string, string>).Authorization,
      `Bearer ${TOKEN}`,
    );
  });

  it('honours a SHIPLIGHT_API_URL override', async () => {
    const { impl, calls } = stubFetch(() => jsonResponse(SERVER_MAP));
    await fetchOrgSettings(
      { SHIPLIGHT_API_TOKEN: TOKEN, SHIPLIGHT_API_URL: 'http://localhost:8080' },
      { fetchImpl: impl },
    );
    assert.strictEqual(calls[0].url, 'http://localhost:8080/org-settings');
  });
});

describe('fetchOrgSettings — success', () => {
  it('returns the validated map with no warnings', async () => {
    const { impl } = stubFetch(() => jsonResponse(SERVER_MAP));
    const result = await fetchOrgSettings({ SHIPLIGHT_API_TOKEN: TOKEN }, { fetchImpl: impl });
    assert.deepStrictEqual(result.tierMap, SERVER_MAP);
    assert.deepStrictEqual(result.warnings, []);
    assert.strictEqual(result.fatal, undefined);
  });

  it('unwraps a one-level envelope so sibling org settings can be added server-side', async () => {
    for (const body of [{ models: SERVER_MAP }, { data: SERVER_MAP }]) {
      const { impl } = stubFetch(() => jsonResponse(body));
      const result = await fetchOrgSettings({ SHIPLIGHT_API_TOKEN: TOKEN }, { fetchImpl: impl });
      assert.deepStrictEqual(result.tierMap, SERVER_MAP, JSON.stringify(Object.keys(body)));
    }
  });

  it('prefers a top-level map over an envelope key, so `version` is never ambiguous', async () => {
    const { impl } = stubFetch(() => jsonResponse({ ...SERVER_MAP, data: { version: 1 } }));
    const result = await fetchOrgSettings({ SHIPLIGHT_API_TOKEN: TOKEN }, { fetchImpl: impl });
    assert.strictEqual(result.tierMap?.tiers.lite.webagent.primary, 'google:server-lite');
  });
});

describe('fetchOrgSettings — degraded paths warn and continue', () => {
  const degrades = async (respond: () => Response | Promise<Response>) => {
    const { impl } = stubFetch(respond);
    return fetchOrgSettings({ SHIPLIGHT_API_TOKEN: TOKEN }, { fetchImpl: impl });
  };

  it('warns on a network error', async () => {
    const result = await degrades(() => {
      throw new Error('ECONNREFUSED');
    });
    assert.strictEqual(result.tierMap, undefined);
    assert.strictEqual(result.fatal, undefined);
    assert.match(result.warnings[0], /ECONNREFUSED/);
    assert.match(result.warnings[0], /built-in model defaults/);
  });

  it('warns on a timeout, naming it as such rather than leaking AbortError', async () => {
    const { impl } = stubFetch(() => new Promise<Response>(() => {}));
    const result = await fetchOrgSettings({ SHIPLIGHT_API_TOKEN: TOKEN }, {
      fetchImpl: impl,
      timeoutMs: 5,
    });
    assert.match(result.warnings[0], /timed out/);
  });

  it('warns on a 5xx', async () => {
    const result = await degrades(() => new Response('nope', { status: 503 }));
    assert.match(result.warnings[0], /HTTP 503/);
  });

  it('warns on an unreadable body', async () => {
    const result = await degrades(() => new Response('{not json', { status: 200 }));
    assert.strictEqual(result.warnings.length, 1);
    assert.match(result.warnings[0], /built-in model defaults/);
  });

  it('warns on a payload version this build does not understand', async () => {
    const result = await degrades(() => jsonResponse({ ...SERVER_MAP, version: 99 }));
    assert.strictEqual(result.tierMap, undefined);
    assert.match(result.warnings[0], /does not understand/);
  });

  it('is silent on a 404 — the endpoint is not deployed everywhere yet', async () => {
    const result = await degrades(() => new Response('', { status: 404 }));
    assert.deepStrictEqual(result, { warnings: [] });
  });

  it('never returns both a map and a fatal', async () => {
    const result = await degrades(() => jsonResponse(SERVER_MAP));
    assert.ok(result.tierMap && !result.fatal);
  });
});

describe('fetchOrgSettings — one retry on a transport failure (cold-start hardening)', () => {
  /** A stub whose per-call behaviour is driven by the responders array, one per attempt. */
  const perAttempt = (responders: Array<() => Response | Promise<Response>>) => {
    let i = 0;
    return stubFetch(() => responders[Math.min(i++, responders.length - 1)]());
  };

  it('recovers when a cold-start timeout is followed by a warm success', async () => {
    // Attempt 1 never settles (aborts at the timeout); attempt 2 answers.
    const { impl, calls } = perAttempt([
      () => new Promise<Response>(() => {}),
      () => jsonResponse(SERVER_MAP),
    ]);
    const result = await fetchOrgSettings(
      { SHIPLIGHT_API_TOKEN: TOKEN },
      { fetchImpl: impl, timeoutMs: 5 },
    );
    assert.strictEqual(calls.length, 2);
    assert.deepStrictEqual(result.tierMap, SERVER_MAP);
    assert.deepStrictEqual(result.warnings, []);
  });

  it('recovers when a network error is followed by a success', async () => {
    const { impl, calls } = perAttempt([
      () => {
        throw new Error('ECONNRESET');
      },
      () => jsonResponse(SERVER_MAP),
    ]);
    const result = await fetchOrgSettings({ SHIPLIGHT_API_TOKEN: TOKEN }, { fetchImpl: impl });
    assert.strictEqual(calls.length, 2);
    assert.deepStrictEqual(result.tierMap, SERVER_MAP);
  });

  it('degrades after exhausting the retry when both attempts fail', async () => {
    const { impl, calls } = perAttempt([
      () => {
        throw new Error('ECONNREFUSED');
      },
      () => {
        throw new Error('ECONNREFUSED');
      },
    ]);
    const result = await fetchOrgSettings({ SHIPLIGHT_API_TOKEN: TOKEN }, { fetchImpl: impl });
    assert.strictEqual(calls.length, 2);
    assert.strictEqual(result.tierMap, undefined);
    assert.match(result.warnings[0], /built-in model defaults/);
  });

  it('does NOT retry an HTTP status — a 5xx is an authoritative answer, fetched once', async () => {
    const { impl, calls } = perAttempt([
      () => new Response('nope', { status: 503 }),
      () => jsonResponse(SERVER_MAP),
    ]);
    const result = await fetchOrgSettings({ SHIPLIGHT_API_TOKEN: TOKEN }, { fetchImpl: impl });
    assert.strictEqual(calls.length, 1);
    assert.match(result.warnings[0], /HTTP 503/);
  });
});

describe('fetchOrgSettings — authentication is not a degradable condition', () => {
  const rejectWith = async (status: number, env: Record<string, string> = {}) => {
    const { impl } = stubFetch(() => new Response('', { status }));
    return fetchOrgSettings({ SHIPLIGHT_API_TOKEN: TOKEN, ...env }, { fetchImpl: impl });
  };

  for (const status of [401, 403]) {
    it(`fails fast on ${status} when the run depends on the proxy`, async () => {
      const result = await rejectWith(status);
      assert.ok(result.fatal, `expected a fatal for ${status}`);
      assert.match(result.fatal, new RegExp(`HTTP ${status}`));
      assert.match(result.fatal, /SHIPLIGHT_API_TOKEN/);
      assert.deepStrictEqual(result.warnings, []);
    });

    it(`only warns on ${status} when a provider key covers the LLM path`, async () => {
      const byokEnvs: Record<string, string>[] = [
        { GOOGLE_API_KEY: 'AIza' },
        { ANTHROPIC_API_KEY: 'sk-ant' },
        { OPENAI_API_KEY: 'sk' },
        { GOOGLE_GENAI_USE_VERTEXAI: 'true', GOOGLE_CLOUD_PROJECT: 'proj' },
      ];
      for (const byok of byokEnvs) {
        const result = await rejectWith(status, byok);
        assert.strictEqual(result.fatal, undefined, JSON.stringify(byok));
        assert.match(result.warnings[0], /rejected SHIPLIGHT_API_TOKEN/);
      }
    });
  }
});

describe('isOfflineEnv', () => {
  it('accepts the usual truthy spellings', () => {
    for (const raw of ['1', 'true', 'TRUE', 'yes', 'on', ' true ']) {
      assert.strictEqual(isOfflineEnv({ SHIPLIGHT_OFFLINE: raw }), true, raw);
    }
  });

  it('rejects everything else, including "0" and "false"', () => {
    for (const raw of ['0', 'false', 'no', '', undefined]) {
      assert.strictEqual(isOfflineEnv({ SHIPLIGHT_OFFLINE: raw }), false, String(raw));
    }
  });
});

describe('tierMapEnvEntry', () => {
  it('injects a fetched map for the spawned Playwright process', () => {
    const entry = tierMapEnvEntry(SERVER_MAP);
    assert.deepStrictEqual(JSON.parse(entry[TIER_MODEL_MAP_ENV_VAR]), SERVER_MAP);
  });

  it('injects nothing when no map was fetched — this is the rollout gate', () => {
    assert.deepStrictEqual(tierMapEnvEntry(undefined), {});
  });
});

describe('describeTierSelection', () => {
  const serverEnv = (extra: Record<string, string> = {}) => ({
    SHIPLIGHT_API_TOKEN: TOKEN,
    ...tierMapEnvEntry(SERVER_MAP),
    ...extra,
  });

  it('says nothing for a run tier selection does not govern', () => {
    assert.deepStrictEqual(describeTierSelection({ SHIPLIGHT_API_TOKEN: TOKEN }), {
      info: [],
      warnings: [],
    });
    assert.deepStrictEqual(describeTierSelection({}), { info: [], warnings: [] });
  });

  it('says nothing for a BYOK run, even one carrying a server map', () => {
    assert.deepStrictEqual(describeTierSelection(serverEnv({ GOOGLE_API_KEY: 'AIza' })), {
      info: [],
      warnings: [],
    });
  });

  it('reports tier, its origin, the model, and where the mapping came from', () => {
    const { info, warnings } = describeTierSelection(serverEnv());
    assert.deepStrictEqual(warnings, []);
    assert.strictEqual(info.length, 1);
    assert.match(info[0], /Tier: standard \(org default\) → google:server-standard \[org settings\]/);
  });

  it('attributes an env-selected tier to the env var', () => {
    const { info } = describeTierSelection(serverEnv({ [TIER_ENV_VAR]: 'pro' }));
    assert.match(info[0], new RegExp(`Tier: pro \\(from ${TIER_ENV_VAR}\\) → anthropic:server-pro`));
  });

  it('labels a degraded run as running on built-in defaults', () => {
    const { info } = describeTierSelection({
      SHIPLIGHT_API_TOKEN: TOKEN,
      [TIER_ENV_VAR]: 'lite',
    });
    assert.match(info[0], /\[built-in defaults\]/);
    assert.ok(info[0].includes(BAKED_TIER_MODEL_MAP.tiers.lite.webagent.primary));
  });

  it('names the ignored variables and the model actually used', () => {
    const { warnings } = describeTierSelection(
      serverEnv({ WEB_AGENT_MODEL: 'anthropic:claude-opus-4-7' }),
    );
    assert.strictEqual(warnings.length, 1);
    assert.match(warnings[0], /Ignoring WEB_AGENT_MODEL/);
    assert.match(warnings[0], /google:server-standard/);
    assert.match(warnings[0], /GOOGLE_API_KEY/); // tells the user how to opt out
  });

  it('warns about an unrecognised tier and names the one it used instead', () => {
    const { warnings } = describeTierSelection(serverEnv({ [TIER_ENV_VAR]: 'turbo' }));
    assert.match(warnings[0], /Unknown WEB_AGENT_TIER="turbo"/);
    assert.match(warnings[0], /Using standard/);
  });
});

describe('resolveTierPreflight — the shiplight test abort-vs-proceed decision', () => {
  it('turns a fatal into an abort with exit code 2 and injects no tier env', () => {
    const p = resolveTierPreflight({ warnings: [], fatal: 'token rejected (HTTP 401)' });
    assert.deepStrictEqual(p.abort, { message: 'token rejected (HTTP 401)', code: 2 });
    assert.deepStrictEqual(p.tierEnv, {});
  });

  it('proceeds (no abort) and injects the fetched map when there is no fatal', () => {
    const p = resolveTierPreflight({ warnings: [], tierMap: SERVER_MAP });
    assert.strictEqual(p.abort, null);
    assert.deepStrictEqual(JSON.parse(p.tierEnv[TIER_MODEL_MAP_ENV_VAR]), SERVER_MAP);
  });

  it('proceeds with an empty tier env when the fetch degraded (no map, no fatal)', () => {
    const p = resolveTierPreflight({ warnings: ['using built-in defaults'] });
    assert.strictEqual(p.abort, null);
    assert.deepStrictEqual(p.tierEnv, {});
    assert.deepStrictEqual(p.warnings, ['using built-in defaults']);
  });

  it('passes warnings straight through', () => {
    const p = resolveTierPreflight({ warnings: ['w1', 'w2'], tierMap: SERVER_MAP });
    assert.deepStrictEqual(p.warnings, ['w1', 'w2']);
  });

  it('sets abort iff the result carries a fatal (its only trigger)', () => {
    assert.strictEqual(resolveTierPreflight({ warnings: [] }).abort, null);
    assert.ok(resolveTierPreflight({ warnings: [], fatal: 'x' }).abort);
  });
});

describe('buildModelTierProvenance', () => {
  const serverEnv = (extra: Record<string, string> = {}) => ({
    SHIPLIGHT_API_TOKEN: TOKEN,
    ...tierMapEnvEntry(SERVER_MAP),
    ...extra,
  });

  it('is undefined for a run tier selection does not govern', () => {
    assert.strictEqual(buildModelTierProvenance({ SHIPLIGHT_API_TOKEN: TOKEN }), undefined);
    assert.strictEqual(buildModelTierProvenance({}), undefined);
    // BYOK opts out even with a server map present.
    assert.strictEqual(buildModelTierProvenance(serverEnv({ GOOGLE_API_KEY: 'AIza' })), undefined);
  });

  it('records tier, both sources, and the resolved primaries from a server map', () => {
    assert.deepStrictEqual(buildModelTierProvenance(serverEnv()), {
      tier: 'standard',
      tierSource: 'org-default',
      mapSource: 'server',
      webagentPrimary: 'google:server-standard',
      computerUsePrimary: 'google:server-cua',
    });
  });

  it('attributes an env-selected tier and reads its primary', () => {
    const p = buildModelTierProvenance(serverEnv({ [TIER_ENV_VAR]: 'pro' }));
    assert.strictEqual(p?.tier, 'pro');
    assert.strictEqual(p?.tierSource, 'env');
    assert.strictEqual(p?.webagentPrimary, 'anthropic:server-pro');
  });

  it('marks a degraded run as baked so "why different than yesterday" is answerable', () => {
    const p = buildModelTierProvenance({ SHIPLIGHT_API_TOKEN: TOKEN, [TIER_ENV_VAR]: 'lite' });
    assert.strictEqual(p?.mapSource, 'baked');
    assert.strictEqual(p?.tierSource, 'env');
    assert.strictEqual(p?.webagentPrimary, BAKED_TIER_MODEL_MAP.tiers.lite.webagent.primary);
  });

  it('surfaces an invalid tier, without letting it become the recorded tier', () => {
    const p = buildModelTierProvenance(serverEnv({ [TIER_ENV_VAR]: 'turbo' }));
    assert.strictEqual(p?.tier, 'standard');
    assert.strictEqual(p?.invalidTier, 'turbo');
  });

  it('omits invalidTier on the happy path', () => {
    assert.strictEqual('invalidTier' in buildModelTierProvenance(serverEnv())!, false);
  });
});

describe('resolveTierEnvForDebugger', () => {
  it('injects a fetched map and reports the selection', async () => {
    const { impl } = stubFetch(() => jsonResponse(SERVER_MAP));
    const { envPatch, info, warnings } = await resolveTierEnvForDebugger(
      { SHIPLIGHT_API_TOKEN: TOKEN },
      { fetchImpl: impl },
    );
    assert.deepStrictEqual(JSON.parse(envPatch[TIER_MODEL_MAP_ENV_VAR]), SERVER_MAP);
    assert.match(info[0], /Tier: standard .* → google:server-standard \[org settings\]/);
    assert.deepStrictEqual(warnings, []);
  });

  it('folds an authoritative rejection into a warning and does NOT throw — the debugger keeps running', async () => {
    const { impl } = stubFetch(() => new Response('', { status: 401 }));
    const { envPatch, warnings } = await resolveTierEnvForDebugger(
      { SHIPLIGHT_API_TOKEN: TOKEN },
      { fetchImpl: impl },
    );
    // No map injected (fetch failed), but the run is not aborted; the rejection
    // is surfaced as a warning instead of the fatal `shiplight test` uses.
    assert.deepStrictEqual(envPatch, {});
    assert.ok(warnings.some((w) => /rejected SHIPLIGHT_API_TOKEN/.test(w)));
  });

  it('skips the fetch under offline and injects nothing', async () => {
    const { impl, calls } = failFetch();
    const { envPatch, info, warnings } = await resolveTierEnvForDebugger(
      { SHIPLIGHT_API_TOKEN: TOKEN },
      { offline: true, fetchImpl: impl },
    );
    assert.strictEqual(calls.length, 0);
    assert.deepStrictEqual(envPatch, {});
    // No token map + no tier env → tier selection inactive → nothing to report.
    assert.deepStrictEqual(info, []);
    assert.deepStrictEqual(warnings, []);
  });

  it('falls back to baked defaults on a degraded fetch when a tier was requested', async () => {
    const { impl } = stubFetch(() => {
      throw new Error('ECONNREFUSED');
    });
    const { envPatch, info, warnings } = await resolveTierEnvForDebugger(
      { SHIPLIGHT_API_TOKEN: TOKEN, [TIER_ENV_VAR]: 'pro' },
      { fetchImpl: impl },
    );
    assert.deepStrictEqual(envPatch, {}); // nothing fetched → resolver uses baked
    assert.match(info[0], /Tier: pro .* \[built-in defaults\]/);
    assert.ok(warnings.some((w) => /ECONNREFUSED/.test(w)));
  });
});
