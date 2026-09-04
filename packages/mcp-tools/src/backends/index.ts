/**
 * Backend Implementations
 *
 * - SessionManager: Unified browser session management for the MCP server
 * - ExtensionRelayServer: WebSocket relay server for Chrome extension integration
 * - RelayElectionCoordinator: Leases the single relay role across server instances
 *
 * Note: SessionManager requires optional peer dependencies:
 *   - sdk-core
 *   - playwright
 */

export { SessionManager, type SessionManagerOptions, type SessionData } from "./SessionManager.js";
export { ExtensionRelayServer } from "./ExtensionRelayServer.js";
export { connectBrowser, forceDisconnect, getCacheStatus } from "./relayBrowserCache.js";
export { RelayElectionCoordinator, type RelayLease, type RelayRole } from "./RelayElectionCoordinator.js";
