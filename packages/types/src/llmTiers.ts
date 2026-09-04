/**
 * LLM tier selection — payload shape, baked defaults, and pure resolution.
 *
 * Design: `docs/design/llm-tier-selection.md` (this repo) and
 * the cloud service's `docs/llm-tier-selection-service.md` (service half).
 *
 * Governing principle: **whoever bears the cost picks the model.** A customer
 * supplying a direct provider key (BYOK) pays the provider and keeps full model
 * choice — nothing here applies to them. A customer running on nothing but
 * `SHIPLIGHT_API_TOKEN` is billed through the Shiplight LLM proxy, so Shiplight
 * picks the model and the customer picks a **tier**.
 *
 * This module is deliberately pure: it parses, validates and resolves, and never
 * fetches or logs. The org-settings fetch lives in the CLI (`apps/cli`), which
 * serialises the fetched map into `SHIPLIGHT_TIER_MAP` for the spawned Playwright
 * process — the resolvers run in that child, not in the process that fetched.
 */

type Env = Record<string, string | undefined>;

/** Selection tiers. User-facing and internal names are the same. */
export type LlmTier = 'lite' | 'standard' | 'pro';

export const LLM_TIERS = Object.freeze(['lite', 'standard', 'pro'] as const);

export function isLlmTier(value: unknown): value is LlmTier {
  return typeof value === 'string' && (LLM_TIERS as readonly string[]).includes(value);
}

/**
 * A primary model plus an ordered fallback chain. Fallbacks exist for provider
 * outages, not for quality escalation, and may cross tiers — the service always
 * bills for the model that actually ran.
 *
 * Identifiers are normalised to `provider:model` throughout (sdk-core's
 * `parseModel` strips the prefix before the upstream call, so the wire request
 * still carries a bare model id).
 */
export interface TierModelSlot {
  primary: string;
  fallbacks: string[];
}

/**
 * The org-settings payload. The API response and the baked defaults use the
 * **same shape**, so one validator and one resolver cover both and the degraded
 * path is exercised by the same tests as the normal path.
 *
 * `computerUse` sits outside `tiers` because it has no tier concept — the
 * customer has no choice of it. It carries `fallbacks` anyway: outages hit it too.
 */
export interface TierModelMap {
  version: number;
  defaultTier: LlmTier;
  tiers: Record<LlmTier, { webagent: TierModelSlot }>;
  computerUse: TierModelSlot;
}

/**
 * Payload version this SDK understands. A map declaring any other version is
 * rejected wholesale and the caller falls back to the baked map, rather than
 * misreading a renamed field.
 */
export const TIER_MODEL_MAP_VERSION = 1;

/**
 * Env var carrying the serialised org-settings map from the CLI parent process
 * into the spawned Playwright process. Internal transport, not a user knob:
 * `apps/cli/src/commands/test.ts` writes it at spawn time alongside
 * `SHIPLIGHT_PROJECT_ROOT`.
 */
export const TIER_MODEL_MAP_ENV_VAR = 'SHIPLIGHT_TIER_MAP';

/** Env var by which a customer selects a tier (one tier per process). */
export const TIER_ENV_VAR = 'WEB_AGENT_TIER';

/**
 * Env vars that a proxy-billed run ignores, because the customer does not pick
 * the model on that path. Named in the warning the CLI emits so the behaviour
 * change is visible rather than mysterious.
 */
export const TIER_IGNORED_ENV_VARS = Object.freeze([
  'WEB_AGENT_MODEL',
  'WEB_AGENT_FALLBACK_MODELS',
  'COMPUTER_USE_MODEL',
] as const);

/**
 * Offline fallback used when the org-settings fetch fails or was never made.
 *
 * Values are the curated membership captured in `docs/design/llm-tier-baked-map.md`
 * (the cloud service's `llm_models` snapshot, 2026-07-22). The **API is authoritative at
 * runtime** — this is only the offline default — and once the endpoint exists
 * this map should be **generated from a real API response at build time** rather
 * than hand-maintained, so it cannot drift structurally, only in values and only
 * until the next release. Until then, the source doc is the seed.
 *
 * Ordering rule (from the source doc): within a tier the Gemini model is primary
 * and the Anthropic + OpenAI members are the cross-provider fallbacks, so a single
 * provider outage cannot take out the whole chain. All fallbacks stay in-tier —
 * billing charges for the model that ran, so an in-tier fallback keeps the
 * customer at their selected tier's price. **Pro is the exception**: it has no
 * Gemini member, so it uses Anthropic as primary with an OpenAI fallback.
 *
 * A baked map is necessarily the *platform* default and cannot carry per-org
 * overrides, which is why `TierSelection` reports `mapSource`: "resolved from
 * baked defaults" and "matches this org's configuration" are different claims.
 */
export const BAKED_TIER_MODEL_MAP: TierModelMap = deepFreeze({
  version: TIER_MODEL_MAP_VERSION,
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
        // No Gemini member in this tier — Anthropic primary, OpenAI fallback.
        primary: 'anthropic:claude-opus-4-8',
        fallbacks: ['openai:gpt-5.6-sol', 'anthropic:claude-opus-4-7'],
      },
    },
  },
  computerUse: {
    primary: 'google:gemini-3-flash-preview',
    fallbacks: [],
  },
});

/** Freeze a literal and everything under it, preserving its inferred type. */
function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === 'object') {
    for (const nested of Object.values(value)) deepFreeze(nested);
    Object.freeze(value);
  }
  return value;
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Parse one `{ primary, fallbacks }` slot. `fallbacks` is optional (absent → no
 * chain), but a present-and-malformed `fallbacks` rejects the whole map rather
 * than being silently coerced — a mangled chain is a bug we want visible, not a
 * quietly emptied one.
 */
function parseSlot(raw: unknown): TierModelSlot | undefined {
  if (!isRecord(raw)) return undefined;
  const { primary, fallbacks } = raw;
  // Reject a padded/empty primary with the SAME strictness as fallbacks below —
  // ` google:x ` would otherwise pass here yet fail parseModel's prefix match
  // downstream (the padded ` google` is not a known provider), delivering a
  // malformed model id.
  if (typeof primary !== 'string' || primary.trim() !== primary || primary === '') return undefined;
  if (fallbacks === undefined) return { primary, fallbacks: [] };
  if (!Array.isArray(fallbacks)) return undefined;
  if (!fallbacks.every((entry) => typeof entry === 'string' && entry.trim() === entry && entry !== '')) {
    return undefined;
  }
  return { primary, fallbacks: [...(fallbacks as string[])] };
}

/**
 * Validate an untrusted org-settings payload (an API response, or a
 * `SHIPLIGHT_TIER_MAP` value) into a `TierModelMap`.
 *
 * Returns `undefined` — meaning "fall back to the baked map" — for anything
 * that is not a complete, current-version map: a different `version`, a missing
 * tier, an unknown `defaultTier`, a malformed slot. All-or-nothing is
 * deliberate: a half-understood map would resolve some tiers from the server
 * and others from baked values, which is the one outcome no provenance field
 * can honestly describe.
 */
export function parseTierModelMap(raw: unknown): TierModelMap | undefined {
  if (!isRecord(raw)) return undefined;
  if (raw.version !== TIER_MODEL_MAP_VERSION) return undefined;
  if (!isLlmTier(raw.defaultTier)) return undefined;
  if (!isRecord(raw.tiers)) return undefined;

  const tiers = {} as TierModelMap['tiers'];
  for (const tier of LLM_TIERS) {
    const entry = raw.tiers[tier];
    if (!isRecord(entry)) return undefined;
    const webagent = parseSlot(entry.webagent);
    if (!webagent) return undefined;
    tiers[tier] = { webagent };
  }

  const computerUse = parseSlot(raw.computerUse);
  if (!computerUse) return undefined;

  return { version: TIER_MODEL_MAP_VERSION, defaultTier: raw.defaultTier, tiers, computerUse };
}

/** Parse a JSON-encoded map (the `SHIPLIGHT_TIER_MAP` transport). */
export function parseTierModelMapJson(json: string | undefined): TierModelMap | undefined {
  if (!json) return undefined;
  try {
    return parseTierModelMap(JSON.parse(json));
  } catch {
    return undefined;
  }
}

// ---------------------------------------------------------------------------
// Resolution
// ---------------------------------------------------------------------------

/** Where the tier itself came from. Env must win: per-tier CI jobs set it per job. */
export type TierSource = 'env' | 'org-default' | 'baked-default';

/** Whether the mapping came from the server or from the SDK's baked defaults. */
export type TierMapSource = 'server' | 'baked';

function copySlot(slot: TierModelSlot): TierModelSlot {
  return { primary: slot.primary, fallbacks: [...slot.fallbacks] };
}

/** Everything a run needs to record about how its models were chosen. */
export interface TierSelection {
  tier: LlmTier;
  tierSource: TierSource;
  mapSource: TierMapSource;
  webagent: TierModelSlot;
  computerUse: TierModelSlot;
  /** Model-selection env vars present but ignored, for the CLI's warning. */
  ignoredEnvVars: string[];
  /** A `WEB_AGENT_TIER` value that names no known tier; ignored, but reportable. */
  invalidTier?: string;
}

/**
 * Resolve tier and models from env. Total — always returns a selection, using
 * the baked map when no server map was injected.
 *
 * Tier precedence: `WEB_AGENT_TIER` → the map's `defaultTier` → the baked
 * `defaultTier`. This says nothing about whether tier selection *applies* to the
 * run; that is `isTierSelectionActive`.
 */
export function resolveTierSelection(env: Env): TierSelection {
  const fetched = parseTierModelMapJson(env[TIER_MODEL_MAP_ENV_VAR]);
  const map = fetched ?? BAKED_TIER_MODEL_MAP;
  const mapSource: TierMapSource = fetched ? 'server' : 'baked';

  // Coalesce empty-string to unset, matching isTierSelectionActive's Boolean()
  // gate — otherwise `WEB_AGENT_TIER=""` would be reported as an invalid tier
  // (`Unknown WEB_AGENT_TIER=""`) even though the gate already treats it as "no
  // tier requested". The two paths must agree on what counts as set.
  const rawTier = env[TIER_ENV_VAR] || undefined;
  const envTier = isLlmTier(rawTier) ? rawTier : undefined;
  const invalidTier = rawTier !== undefined && envTier === undefined ? rawTier : undefined;

  const tier = envTier ?? map.defaultTier;
  const tierSource: TierSource = envTier
    ? 'env'
    : mapSource === 'server'
      ? 'org-default'
      : 'baked-default';

  const ignoredEnvVars = TIER_IGNORED_ENV_VARS.filter((name) => Boolean(env[name]));

  return {
    tier,
    tierSource,
    mapSource,
    // Copies, not references into the frozen baked map — a caller that appends
    // to `fallbacks` should not throw or, worse, mutate every later resolution.
    webagent: copySlot(map.tiers[tier].webagent),
    computerUse: copySlot(map.computerUse),
    ignoredEnvVars: [...ignoredEnvVars],
    ...(invalidTier !== undefined && { invalidTier }),
  };
}

/**
 * True when a direct provider credential is configured, i.e. the customer pays
 * the provider and keeps full model choice. One rule with no special cases —
 * the same order sdk-core's provider factories resolve in.
 *
 * `OPENAI_BASE_URL` is deliberately absent: `getOpenAIModel` honours it only
 * alongside `OPENAI_API_KEY`, so a bare base URL does not bypass the proxy.
 *
 * The CLI reuses this for the org-settings fetch's failure handling: an
 * authoritative 401/403 fails the run fast only when the run *depends* on the
 * proxy — with a direct key present, the token affects reporting and cache, not
 * the LLM path, so it is a warning.
 */
export function hasDirectProviderCredentials(env: Env): boolean {
  return Boolean(
    env.GOOGLE_API_KEY || isGoogleVertexEnv(env) || env.ANTHROPIC_API_KEY || env.OPENAI_API_KEY,
  );
}

/**
 * True when the env selects Google Vertex AI via ADC (Application Default
 * Credentials) rather than an API key: the `GOOGLE_GENAI_USE_VERTEXAI` flag is
 * on and a project is set. Flag parsing mirrors sdk-core's google.ts so model
 * auto-detection and provider routing agree.
 */
export function isGoogleVertexEnv(env: Env): boolean {
  const flag = env.GOOGLE_GENAI_USE_VERTEXAI;
  const enabled = flag === 'true' || flag === 'True';
  return enabled && Boolean(env.GOOGLE_CLOUD_PROJECT);
}

/**
 * Whether tier selection governs this run's model choice.
 *
 * Requires all three:
 *   1. `SHIPLIGHT_API_TOKEN` — Shiplight bears the cost;
 *   2. no direct provider credential — BYOK opts out entirely;
 *   3. tier information in the env — either a map injected by the CLI, or an
 *      explicit `WEB_AGENT_TIER`.
 *
 * Condition 3 is a staged-rollout gate, not part of the design. Without it,
 * merely landing this module would switch every existing proxy user onto the
 * baked primary — whose values are still uncurated (see `BAKED_TIER_MODEL_MAP`)
 * — and would change the model identifier recorded in usage reporting from
 * `gemini-3.5-flash` to `google:gemini-3.5-flash` for every row. Both are real
 * changes that belong to the CLI-wiring slice, where the fetch injects the map
 * unconditionally and the reporting question is answered. Until then a proxy
 * user who sets no tier keeps today's behaviour exactly.
 */
export function isTierSelectionActive(env: Env): boolean {
  if (!env.SHIPLIGHT_API_TOKEN) return false;
  if (hasDirectProviderCredentials(env)) return false;
  return Boolean(env[TIER_MODEL_MAP_ENV_VAR] || env[TIER_ENV_VAR]);
}
