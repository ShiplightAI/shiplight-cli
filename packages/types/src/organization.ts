/**
 * Organization settings - stored as JSON in organization.settings
 *
 * This is the canonical type definition for organization settings.
 * All packages should import from shiplight-types.
 */
import {
  BAKED_TIER_MODEL_MAP,
  isGoogleVertexEnv,
  isTierSelectionActive,
  resolveTierSelection,
} from './llmTiers';

export interface OrganizationSettings {
  organization_id?: string;

  // Timeout configuration
  timeouts?: {
    max_step_run_in_minutes?: number;
    max_test_run_in_minutes?: number;
  };

  // Proxy configuration
  proxy?: {
    enabled?: boolean;
    server?: string;
    token?: string;
  };

  // Agent max steps - top-level setting (matches Python get_agent_max_steps())
  agent_max_steps?: number;

  // Agent settings (used by web-sdk, agent-worker, etc.)
  agent_settings?: {
    max_steps?: number;
    interactive_class_names?: string[];
    /** Domains whose inaccessible iframes should be processed via Playwright frame fallback */
    iframe_fallback_domains?: string[];
    enable_knowledge_images?: boolean;
    use_sliced_screenshots?: boolean;
    resize_sliced_screenshots?: boolean;
    /** Use Chrome Accessibility Tree for element detection (experimental) */
    use_accessibility_tree?: boolean;
    /** Filter DOM elements based on action intent (click/input/scroll) */
    use_action_intent_filtering?: boolean;
    /** Use TypeScript DOM tree implementation with two-phase rendering */
    use_dom_tree_ts?: boolean;
  };

  // Code conversion settings
  action_code_conversion_settings?: {
    /** Default timeout per action execution in ms. Default: 10000 */
    action_timeout_ms?: number;
    /** Intermediate mouse steps during drag-drop. Default: 10. Use ≤0 for direct jump. */
    drag_drop_steps?: number;
    /** Delay between keystrokes when typing in ms. Default: none */
    type_delay?: number;
    /** Mock the browser's showOpenFilePicker API for file upload actions */
    mock_show_open_file_picker?: boolean;
  };

  // Security settings
  disable_security?: boolean;

  // Failure analysis settings (for auto-fixing failed tests)
  failure_analysis?: {
    enabled?: boolean;              // Default: false
    default_run?: boolean;          // Default: false - auto-run analysis on all failures when enabled
    async_mode?: boolean;           // Default: true - dispatch to worker via SQS instead of running inline
    timeout_ms?: number;            // Default: 300000 (5 min)
    max_fix_attempts?: number;      // Default: 5 - max iterations to find working fix
    model_provider?: 'google' | 'google-vertex' | 'anthropic' | 'openai';
    model_id?: string;
  };

  // State transitions logging settings (for debugging test execution)
  state_transitions?: {
    enabled?: boolean;              // Default: true - disable explicitly with false
    capture_dom?: boolean;          // Default: true - capture DOM snapshots
    capture_variables?: boolean;    // Default: true - capture test variables
    capture_redirects?: boolean;    // Default: true - capture redirect events
  };

  // Model configuration
  models?: {
    /** Copilot orchestrator model (default: claude-sonnet-4-6) */
    copilot?: string;
    /** WebAgent browser action model (default: gemini-3.5-flash) */
    webagent?: string;
    /** Computer use model (default: gpt-5.4) */
    computer_use?: string;
  };

  // Per-org feature flags (checked by useExperimentalFeature)
  features?: Record<string, boolean>;

  // Allow additional settings for extensibility
  [key: string]: unknown;
}

/** Default models auto-detected from API keys for end-user (CLI/SDK) execution. */
export const DEFAULT_ANTHROPIC_MODEL = 'claude-haiku-4-5';
export const DEFAULT_GOOGLE_MODEL = 'gemini-3.5-flash';
export const DEFAULT_OPENAI_MODEL = 'gpt-5.4-mini';
export const DEFAULT_GEMINI_COMPUTER_USE_MODEL = 'gemini-3-flash-preview';
export const DEFAULT_OPENAI_COMPUTER_USE_MODEL = 'gpt-5.4';

export const DEFAULT_COPILOT_MODEL = 'claude-sonnet-4-6';
export const DEFAULT_WEBAGENT_MODEL = DEFAULT_GOOGLE_MODEL;
export const DEFAULT_COMPUTER_USE_MODEL = DEFAULT_GEMINI_COMPUTER_USE_MODEL;

type Env = Record<string, string | undefined>;

const defaultEnv = (): Env => (typeof process !== 'undefined' ? process.env : {});

/**
 * Resolve the full model set for internal callers (sandbox, runner,
 * agent-worker, test-fixtures, web-session). Each slot always returns a
 * string; callers should assume a valid model and surface a runtime error if
 * the matching API key is missing.
 *
 * Per-slot precedence:
 *   1. organization settings (`org.models.{copilot|webagent|computer_use}`)
 *   2. environment variable (`COPILOT_MODEL`, `WEB_AGENT_MODEL`, `COMPUTER_USE_MODEL`)
 *   3. hardcoded default constant
 */
export function resolveModels(
  orgSettings?: OrganizationSettings | null,
  env: Env = defaultEnv(),
): {
  copilot: string;
  webagent: string;
  computer_use: string;
} {
  return {
    copilot: orgSettings?.models?.copilot || env.COPILOT_MODEL || DEFAULT_COPILOT_MODEL,
    webagent: orgSettings?.models?.webagent || env.WEB_AGENT_MODEL || DEFAULT_WEBAGENT_MODEL,
    computer_use:
      orgSettings?.models?.computer_use || env.COMPUTER_USE_MODEL || DEFAULT_COMPUTER_USE_MODEL,
  };
}

/**
 * Resolve the web agent model for end-user (CLI/SDK/YAML) execution — no
 * organization settings, no hardcoded fallback.
 *
 * Priority:
 *   0. Tier-selected — Shiplight bears the cost and the run carries tier
 *      information (see `isTierSelectionActive`). The tier's primary wins and
 *      `WEB_AGENT_MODEL` is ignored: the proxy rejects non-permitted models
 *      regardless, so honouring it locally would only move the failure later.
 *   1. `WEB_AGENT_MODEL` env var
 *   2. Auto-detect from direct provider API key: GOOGLE → ANTHROPIC → OPENAI
 *   3. Google Vertex AI via ADC (no API key): `GOOGLE_GENAI_USE_VERTEXAI` +
 *      `GOOGLE_CLOUD_PROJECT` → DEFAULT_GOOGLE_MODEL (google.ts routes it through
 *      createVertex() with ambient Application Default Credentials)
 *   4. `SHIPLIGHT_API_TOKEN` set → DEFAULT_WEBAGENT_MODEL
 *      — sdk-core routes the call through the Shiplight LLM proxy
 *   5. `undefined`
 *
 * Steps 1–5 are untouched. Because step 0's guard requires the absence of every
 * direct provider credential, a BYOK run — the customer pays the provider, so
 * the customer picks the model — never reaches it.
 */
export function resolveWebAgentModelFromEnv(env?: Env): string | undefined {
  if (!env) return undefined;
  // The only new branch. `isTierSelectionActive` already excludes every BYOK
  // env, so the chain below is reached — and behaves — exactly as before.
  if (isTierSelectionActive(env)) return resolveTierSelection(env).webagent.primary;
  if (env.WEB_AGENT_MODEL) return env.WEB_AGENT_MODEL;
  if (env.GOOGLE_API_KEY) return DEFAULT_GOOGLE_MODEL;
  if (isGoogleVertexEnv(env)) return DEFAULT_GOOGLE_MODEL;
  if (env.ANTHROPIC_API_KEY) return DEFAULT_ANTHROPIC_MODEL;
  if (env.OPENAI_API_KEY) return DEFAULT_OPENAI_MODEL;
  if (env.SHIPLIGHT_API_TOKEN) return DEFAULT_WEBAGENT_MODEL;
  return undefined;
}

/**
 * Default web-agent fallback chain for the BYOK / non-tier path, tried in order
 * when the primary model fails with an availability error (rate limit / 5xx /
 * timeout). Applied when `WEB_AGENT_FALLBACK_MODELS` is unset.
 *
 * **Kept identical to the Standard tier's fallback chain** by deriving it from
 * the baked map, because the BYOK default primary (`DEFAULT_WEBAGENT_MODEL` =
 * `gemini-3.5-flash`) is exactly the Standard tier's primary — so the two paths
 * fail over to the same models rather than diverging. Both entries are
 * cross-provider (Anthropic, then OpenAI): a single-provider outage cannot take
 * out the whole chain. They require the matching credentials — an `ANTHROPIC_API_KEY`
 * / Vertex, or a Shiplight token whose proxy serves that provider; where none is
 * present `getAnthropicModel` / `getOpenAIModel` throws and the run advances to
 * the next entry. A Google-only BYOK setup therefore has no working failover
 * (both entries are non-Google); configure Anthropic/OpenAI creds, or override
 * `WEB_AGENT_FALLBACK_MODELS`, for dependable relief.
 *
 * If Standard's chain changes in the baked map, this changes with it — one
 * source of truth for "what does a gemini-3.5-flash run fall back to".
 */
export const DEFAULT_WEBAGENT_FALLBACK_MODELS: readonly string[] = Object.freeze([
  ...BAKED_TIER_MODEL_MAP.tiers.standard.webagent.fallbacks,
]);

/**
 * Resolve the ordered web-agent fallback models from env.
 *
 * `WEB_AGENT_FALLBACK_MODELS` is a comma-separated list of `provider:model`
 * entries (e.g. `google:gemini-3.5-flash,anthropic:claude-opus-4-7`). If the
 * primary web-agent model fails with an availability error (rate limit / 5xx /
 * timeout), the agent retries the request on each of these in order.
 *
 *   - Unset               → `DEFAULT_WEBAGENT_FALLBACK_MODELS`.
 *   - Explicit empty (``)  → `[]` — opt out of fallback entirely.
 *   - A comma-separated list → that list, in order (whitespace trimmed).
 *
 * On the tier-selected path (Shiplight bears the cost) the chain comes from the
 * tier instead and `WEB_AGENT_FALLBACK_MODELS` is ignored.
 */
export function resolveWebAgentFallbackModelsFromEnv(env?: Env): string[] {
  if (env && isTierSelectionActive(env)) return resolveTierSelection(env).webagent.fallbacks;
  const raw = env?.WEB_AGENT_FALLBACK_MODELS;
  // Distinguish "unset" (use the default chain) from an explicit empty string
  // (a deliberate opt-out → no fallback).
  if (raw === undefined) return [...DEFAULT_WEBAGENT_FALLBACK_MODELS];
  return raw
    .split(',')
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
}

/**
 * Resolve the computer-use (CUA) model for end-user execution. Anthropic has
 * no supported CUA model and is skipped.
 *
 * Priority:
 *   0. Tier-selected → the org-settings `computerUse` slot, which sits outside
 *      `tiers` because the customer has no choice of this model. Ignores
 *      `COMPUTER_USE_MODEL`.
 *   1. `COMPUTER_USE_MODEL` env var
 *   2. Auto-detect from API key: GOOGLE → OPENAI
 *   3. Google Vertex AI via ADC (no API key): `GOOGLE_GENAI_USE_VERTEXAI` +
 *      `GOOGLE_CLOUD_PROJECT` → the Gemini CUA model on Vertex
 *   4. `SHIPLIGHT_API_TOKEN` set → Gemini via Shiplight LLM proxy
 *   5. `undefined`
 *
 * Steps 1–5 are untouched. Note that step 4 still catches an Anthropic-only BYOK
 * run that also holds a token: Anthropic has no supported CUA model, so those
 * calls were already proxied and must keep resolving.
 */
export function resolveComputerUseModelFromEnv(env?: Env): string | undefined {
  if (!env) return undefined;
  if (isTierSelectionActive(env)) return resolveTierSelection(env).computerUse.primary;
  if (env.COMPUTER_USE_MODEL) return env.COMPUTER_USE_MODEL;
  if (env.GOOGLE_API_KEY) return DEFAULT_GEMINI_COMPUTER_USE_MODEL;
  if (isGoogleVertexEnv(env)) return DEFAULT_GEMINI_COMPUTER_USE_MODEL;
  if (env.OPENAI_API_KEY) return DEFAULT_OPENAI_COMPUTER_USE_MODEL;
  if (env.SHIPLIGHT_API_TOKEN) return DEFAULT_GEMINI_COMPUTER_USE_MODEL;
  return undefined;
}
