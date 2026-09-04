/**
 * Shiplight cloud API routing for the CLI.
 *
 * Re-exports the single source of truth from sdk-core via the `./cloud-routing`
 * subpath export — a leaf module (no imports) — so bundling pulls in only this
 * function, NOT the sdk-core barrel (which has no `sideEffects: false`, so tsup
 * with noExternal can't tree-shake it; a barrel import would drag the entire
 * agent / LLM / DOM graph into cli.js). The subpath is the sanctioned escape
 * hatch — see sdk-core/package.json "exports"."./cloud-routing".
 *
 *   - isV2Token(token)      → true for shp_* tokens, false otherwise
 *   - resolveApiBase(token) → shp_* → api.shiplight.ai, else null (v1 removed)
 *     (SHIPLIGHT_API_URL override wins over both)
 */

export { resolveApiBase, isV2Token, UNSUPPORTED_TOKEN_MESSAGE } from 'sdk-core/cloud-routing';
