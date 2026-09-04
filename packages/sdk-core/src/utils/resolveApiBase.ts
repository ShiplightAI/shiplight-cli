/**
 * Resolve the Shiplight API base URL from a token and optional override.
 *
 * Token routing:
 *   shp_*  → api.shiplight.ai  (v2: shp_pat_*, shp_ctx_*, future shapes)
 *   else   → unsupported (null)
 *
 * The v1 UUID cloud path was removed in August 2026 when that cloud was
 * decommissioned; routing to it produced calls to a dead host rather than an
 * actionable failure. `resolveApiBase` returns `null` for an unsupported
 * token so each caller applies its own policy — the action cache no-ops, the
 * org-settings fetch degrades to baked defaults, and report upload is skipped
 * with a message — instead of a throw unwinding a whole run at report time.
 *
 * SHIPLIGHT_API_URL still wins when set, so a self-hosted or staging host
 * remains reachable with any token shape.
 */

const SHP_PREFIX = 'shp_';
const SHIPLIGHT_API_BASE = 'https://api.shiplight.ai';

/**
 * True for a v2 token — anything carrying the shared `shp_` prefix
 * (shp_pat_* PATs, shp_org_* org tokens, shp_ctx_* scoped runtime credentials,
 * and any future shp_<context>_* shape). These route to the Shiplight API.
 * Legacy v1 UUID cloud tokens return false and are no longer supported.
 *
 * This is the single source of truth for which tokens the cloud accepts —
 * consumers that bundle (cli, mcp-server) import it via the
 * `sdk-core/cloud-routing` subpath so they don't drag in the sdk-core barrel.
 */
export function isV2Token(token: string): boolean {
	return token.startsWith(SHP_PREFIX);
}

export function resolveApiBase(token: string, override?: string): string | null {
	const trimmedOverride = override?.trim();
	if (trimmedOverride) return stripTrailingSlash(trimmedOverride);
	if (isV2Token(token)) return SHIPLIGHT_API_BASE;
	return null;
}

/**
 * Message for a token the cloud no longer accepts. Kept here so every surface
 * tells the user the same thing.
 */
export const UNSUPPORTED_TOKEN_MESSAGE =
	'SHIPLIGHT_API_TOKEN is a legacy v1 cloud token, which is no longer supported. ' +
	'Create a new token (shp_pat_...) in your Shiplight account, or set SHIPLIGHT_API_URL ' +
	'to point at a self-hosted or staging host.';

function stripTrailingSlash(s: string): string {
	return s.endsWith('/') ? s.slice(0, -1) : s;
}
