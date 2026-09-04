/**
 * Org-settings fetch — pre-test, once per run.
 *
 * Design: `docs/design/llm-tier-selection.md` §2. When Shiplight bears the cost
 * of a run's LLM calls, Shiplight picks the model and the customer picks a tier;
 * the mapping from tier to model lives server-side and is fetched here, in the
 * CLI parent, before the transpiler and before Playwright is spawned.
 *
 * Resolved once and pinned for the whole run — not for cost, for determinism: a
 * 40-minute suite must not straddle a server-side mapping change and execute two
 * different models. There is no cross-run cache; every run resolves fresh.
 *
 * Unlike the action-entity cache (CI-only), this runs in every environment. A
 * local run and a CI run resolving to different models would be exactly the
 * class of surprise tier selection exists to remove.
 */

import {
  hasDirectProviderCredentials,
  isTierSelectionActive,
  parseTierModelMap,
  resolveTierSelection,
  TIER_ENV_VAR,
  TIER_MODEL_MAP_ENV_VAR,
  type LlmTier,
  type TierMapSource,
  type TierModelMap,
  type TierSource,
} from 'shiplight-types';
import { resolveApiBase } from './cloudApiBase.js';

type Env = Record<string, string | undefined>;

/**
 * Read timeout, per attempt. More generous than the action cache's 2s lookup:
 * degrading there costs cache warmth, degrading here changes which model runs.
 */
const FETCH_TIMEOUT_MS = 3000;

/**
 * Transport failures (timeout, connection reset) get one retry with a fresh
 * per-attempt budget before degrading to baked defaults. The endpoint is
 * serverless: a first-run-after-idle cold start can exceed a single 3s budget
 * while the warm endpoint answers in ~150ms, so the immediate retry almost
 * always lands on the now-warm instance. Retries only the transport catch —
 * never an HTTP status, which is an authoritative answer that a retry cannot
 * improve and (for 5xx) could double-bill. Worst case before degrading is
 * MAX_FETCH_ATTEMPTS × FETCH_TIMEOUT_MS, which is the price of not silently
 * running the baked model map when the server would have answered.
 */
const MAX_FETCH_ATTEMPTS = 2;

/**
 * Org-scoped settings endpoint. Not tier-specific by design — feature flags and
 * other org-scoped settings are expected to land on the same route (service-side
 * open item: whether it stays standalone or folds into the pre-test
 * action-entity-cache request; the client is indifferent either way).
 */
const ORG_SETTINGS_PATH = '/org-settings';

export interface OrgSettingsResult {
  /** The validated server map, absent when the fetch was skipped or degraded. */
  tierMap?: TierModelMap;
  /** Lines to print as warnings. Empty on the happy path and on a clean skip. */
  warnings: string[];
  /**
   * Set when the run must abort before spawning Playwright: the service
   * authoritatively rejected the token and the run depends on the proxy.
   */
  fatal?: string;
}

export interface FetchOrgSettingsOptions {
  /** Skip the network entirely (`--offline`, or SHIPLIGHT_OFFLINE). */
  offline?: boolean;
  /** Injectable for tests. */
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

/**
 * Fetch the org-settings payload, applying the failure policy.
 *
 * | Condition                                  | Behaviour                        |
 * |--------------------------------------------|----------------------------------|
 * | No token / `--offline`                      | Skip silently                    |
 * | Network error or timeout (after 1 retry)    | Warn, continue on baked defaults |
 * | `5xx`                                        | Warn, continue on baked defaults |
 * | `404` — endpoint not deployed               | Skip silently (see below)        |
 * | `401`/`403`, run depends on the proxy       | **Fatal**                        |
 * | `401`/`403`, BYOK provider key present      | Warn only                        |
 * | `200` with a shape we do not understand     | Warn, continue on baked defaults |
 *
 * Failing fast on a rejected token is a deliberate change from today, where an
 * invalid token surfaces as a mid-test proxy 401 after browsers have started and
 * CI minutes have been billed. Graceful degradation is right for a *cache*; it is
 * wrong for *authentication*. With a direct provider key present the token
 * affects reporting and cache but not the LLM path, so it is only a warning.
 *
 * `404` is silent rather than a warning because the endpoint does not exist on
 * every deployment yet: warning would fire on every run for every user until it
 * ships. The cost of that choice is that a mistyped `SHIPLIGHT_API_URL` pointing
 * at a real server with no such route degrades quietly.
 */
export async function fetchOrgSettings(
  env: Env,
  options: FetchOrgSettingsOptions = {},
): Promise<OrgSettingsResult> {
  const token = env.SHIPLIGHT_API_TOKEN;
  if (!token) return { warnings: [] };
  if (options.offline || isOfflineEnv(env)) return { warnings: [] };

  const doFetch = options.fetchImpl ?? fetch;
  const timeoutMs = options.timeoutMs ?? FETCH_TIMEOUT_MS;
  const base = resolveApiBase(token, env.SHIPLIGHT_API_URL);
  // A legacy v1 token has no host to ask since that cloud was decommissioned.
  // Degrade to baked per-tier defaults, matching the network-failure policy,
  // rather than failing the run before browsers start.
  if (!base) {
    return {
      warnings: [
        'Tier selection skipped: SHIPLIGHT_API_TOKEN is a legacy v1 cloud token, ' +
          'which is no longer supported. Using built-in per-tier defaults. ' +
          'Create a new token (shp_pat_...) to restore server-side tier selection.',
      ],
    };
  }

  let response: Response | undefined;
  let lastError: unknown;
  // Retry only the transport failure (timeout / network); an HTTP response —
  // even 5xx — breaks out and is handled by the status checks below.
  for (let attempt = 1; attempt <= MAX_FETCH_ATTEMPTS; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      response = await doFetch(`${base}${ORG_SETTINGS_PATH}`, {
        method: 'GET',
        headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
        signal: controller.signal,
      });
      break;
    } catch (err) {
      lastError = err;
    } finally {
      clearTimeout(timer);
    }
  }
  if (response === undefined) {
    return {
      warnings: [
        `Could not reach Shiplight org settings (${describeError(lastError)}); using built-in model defaults.`,
      ],
    };
  }

  if (response.status === 401 || response.status === 403) {
    if (hasDirectProviderCredentials(env)) {
      return {
        warnings: [
          `Shiplight API rejected SHIPLIGHT_API_TOKEN (HTTP ${response.status}). ` +
            `A provider API key is set, so tests will still run — but cloud reporting and the action cache will not work.`,
        ],
      };
    }
    return {
      warnings: [],
      fatal:
        `Shiplight API rejected SHIPLIGHT_API_TOKEN (HTTP ${response.status}). ` +
        `This run has no provider API key, so every AI call would go through the Shiplight proxy and fail once the browsers are already running. ` +
        `Check SHIPLIGHT_API_TOKEN, or set a provider key (GOOGLE_API_KEY / ANTHROPIC_API_KEY / OPENAI_API_KEY) to run without Shiplight cloud.`,
    };
  }

  // Endpoint not deployed on this API — expected during rollout, so no warning.
  if (response.status === 404) return { warnings: [] };

  if (!response.ok) {
    return {
      warnings: [
        `Shiplight org settings returned HTTP ${response.status}; using built-in model defaults.`,
      ],
    };
  }

  let body: unknown;
  try {
    body = await response.json();
  } catch (err) {
    return {
      warnings: [
        `Shiplight org settings returned an unreadable response (${describeError(err)}); using built-in model defaults.`,
      ],
    };
  }

  const tierMap = parseTierModelMap(extractTierMap(body));
  if (!tierMap) {
    return {
      warnings: [
        `Shiplight org settings returned a model mapping this shiplightai build does not understand; using built-in model defaults. Upgrading shiplightai may resolve it.`,
      ],
    };
  }

  return { tierMap, warnings: [] };
}

/**
 * The payload is the map itself. Tolerate one level of envelope (`{ models: … }`
 * or `{ data: … }`) so a general org-settings route that grows sibling keys — the
 * stated intent — does not require a CLI release to keep working. Anything else
 * falls through to the validator, which rejects it.
 */
function extractTierMap(body: unknown): unknown {
  if (body !== null && typeof body === 'object' && !Array.isArray(body)) {
    const record = body as Record<string, unknown>;
    if (record.version === undefined) {
      if (record.models !== undefined) return record.models;
      if (record.data !== undefined) return record.data;
    }
  }
  return body;
}

function describeError(err: unknown): string {
  if (err instanceof Error) {
    return err.name === 'AbortError' || err.name === 'TimeoutError' ? 'timed out' : err.message;
  }
  return String(err);
}

/** `--offline`'s env-var twin, for users who would rather not have local runs phone home. */
export function isOfflineEnv(env: Env): boolean {
  const raw = env.SHIPLIGHT_OFFLINE?.trim().toLowerCase();
  return raw === '1' || raw === 'true' || raw === 'yes' || raw === 'on';
}

/**
 * The lines a run should print about its model selection, given the env the
 * spawned Playwright process will see (i.e. after any fetched map has been
 * injected as `SHIPLIGHT_TIER_MAP`).
 *
 * Returns nothing when tier selection does not govern the run, which today is
 * every run that neither received a server map nor set `WEB_AGENT_TIER` — so
 * existing users see no new output at all.
 *
 * The ignore-warning names the variable *and* the model actually used: the whole
 * point is that a user who set `WEB_AGENT_MODEL` and gets a different model can
 * see why in one line, rather than discovering it in a bill or a diff in
 * behaviour.
 */
export function describeTierSelection(env: Env): { info: string[]; warnings: string[] } {
  if (!isTierSelectionActive(env)) return { info: [], warnings: [] };

  const selection = resolveTierSelection(env);
  const origin =
    selection.tierSource === 'env'
      ? `from ${TIER_ENV_VAR}`
      : selection.tierSource === 'org-default'
        ? 'org default'
        : 'built-in default';
  const mapping = selection.mapSource === 'server' ? 'org settings' : 'built-in defaults';

  const info = [
    `Tier: ${selection.tier} (${origin}) → ${selection.webagent.primary} [${mapping}]`,
  ];
  const warnings: string[] = [];

  if (selection.invalidTier !== undefined) {
    warnings.push(
      `Unknown ${TIER_ENV_VAR}="${selection.invalidTier}" — expected lite, standard or pro. Using ${selection.tier}.`,
    );
  }

  if (selection.ignoredEnvVars.length > 0) {
    warnings.push(
      `Ignoring ${selection.ignoredEnvVars.join(', ')}: on the Shiplight LLM proxy the tier selects the model, and this run is using ${selection.webagent.primary}. ` +
        `Set a provider API key (GOOGLE_API_KEY / ANTHROPIC_API_KEY / OPENAI_API_KEY) to choose models yourself.`,
    );
  }

  return { info, warnings };
}

/**
 * Run-report provenance for how this run's models were chosen (design §4).
 * Recorded so two recurring support questions are answerable in one look: "why
 * did this run behave differently than yesterday?" (`mapSource: 'baked'` → fell
 * back to built-in defaults during an outage) and "why is this bill higher?" (a
 * failover ran a higher-tier model — visible in the per-call usage breakdown,
 * which this contextualises). The model that served *each* call, including
 * fallbacks, lives in the run's usage summary; this is the run-level tier context
 * that usage alone cannot express.
 */
export interface ModelTierProvenance {
  /** The tier this run resolved to. */
  tier: LlmTier;
  /** Where the tier came from: env var, org default, or the baked default. */
  tierSource: TierSource;
  /** Whether the tier→model mapping came from the server or baked defaults. */
  mapSource: TierMapSource;
  /** The web-agent primary the tier resolved to (`provider:model`). */
  webagentPrimary: string;
  /** The tier-independent computer-use primary (`provider:model`). */
  computerUsePrimary: string;
  /** A `WEB_AGENT_TIER` value that named no known tier and was ignored. */
  invalidTier?: string;
}

/**
 * Build the run's tier provenance from the env the run resolved models under, or
 * `undefined` when tier selection did not govern the run (BYOK, or a proxy run
 * with no tier information) — the same gate as `describeTierSelection`, so the
 * field is present exactly when it is meaningful. Pure; call with the child's
 * env view (`.env` + injected `SHIPLIGHT_TIER_MAP`).
 */
export function buildModelTierProvenance(env: Env): ModelTierProvenance | undefined {
  if (!isTierSelectionActive(env)) return undefined;
  const s = resolveTierSelection(env);
  return {
    tier: s.tier,
    tierSource: s.tierSource,
    mapSource: s.mapSource,
    webagentPrimary: s.webagent.primary,
    computerUsePrimary: s.computerUse.primary,
    ...(s.invalidTier !== undefined && { invalidTier: s.invalidTier }),
  };
}

/**
 * Pre-flight tier resolution for the interactive debugger.
 *
 * Composes the fetch, the env injection, and the human report into one pure step
 * that does NOT touch `process.env` or exit — the caller applies `envPatch` and
 * prints the lines. This exists as its own function so the debugger's policy is
 * testable without starting a server.
 *
 * The debugger's policy deliberately differs from `shiplight test`: an
 * authoritative token rejection is folded into `warnings` rather than being
 * fatal. There are no CI minutes to waste, the user is present, and a genuine
 * failure surfaces on the first session's proxy call — so refusing to launch the
 * whole server would be worse than warning and continuing.
 */
export async function resolveTierEnvForDebugger(
  env: Env,
  options: FetchOrgSettingsOptions = {},
): Promise<{ envPatch: Record<string, string>; info: string[]; warnings: string[] }> {
  const result = await fetchOrgSettings(env, options);
  const warnings = [...result.warnings];
  if (result.fatal) warnings.push(result.fatal);

  const envPatch = tierMapEnvEntry(result.tierMap);
  // Report against the env the sessions will resolve under: the caller's view
  // plus the just-fetched map.
  const report = describeTierSelection({ ...env, ...envPatch });
  return {
    envPatch,
    info: report.info,
    warnings: [...warnings, ...report.warnings],
  };
}

/**
 * Serialise a fetched map for the spawned Playwright process. The resolvers run
 * in that child, not here, so the map has to cross the process boundary the same
 * way SHIPLIGHT_PROJECT_ROOT does.
 *
 * Only a *fetched* map is injected — never the baked one, which is reached
 * through the resolver's own fallback. That distinction is what makes the
 * rollout safe: a run that never opted into a tier and got no server answer has
 * no tier information in its env at all, so it resolves models exactly as it
 * does today. A run that DID opt in (via `WEB_AGENT_TIER`) still lands on the
 * baked map when the fetch degrades, which is the behaviour §2 asks for.
 */
export function tierMapEnvEntry(tierMap: TierModelMap | undefined): Record<string, string> {
  if (!tierMap) return {};
  return { [TIER_MODEL_MAP_ENV_VAR]: JSON.stringify(tierMap) };
}

/**
 * Pure pre-flight decision for `shiplight test` from an org-settings fetch
 * result: the warnings to print, whether to **abort before spawning Playwright**
 * (and with what message + exit code), and the tier env to inject when not
 * aborting. Extracted from `runTests` so the fatal-vs-proceed decision is
 * testable without `process.exit`/`spawn` — the caller does only the I/O.
 *
 * Abort is the `shiplight test` policy (fail fast on an authoritative token
 * rejection before browsers start and CI minutes are billed); the debugger's
 * warn-don't-abort policy is a separate function (`resolveTierEnvForDebugger`).
 */
export function resolveTierPreflight(orgSettings: OrgSettingsResult): {
  warnings: string[];
  abort: { message: string; code: number } | null;
  tierEnv: Record<string, string>;
} {
  return {
    warnings: orgSettings.warnings,
    abort: orgSettings.fatal ? { message: orgSettings.fatal, code: 2 } : null,
    tierEnv: tierMapEnvEntry(orgSettings.tierMap),
  };
}
