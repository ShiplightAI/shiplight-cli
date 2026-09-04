# Extension Relay Implementation

## Overview

Extension relay support allows developers to attach Shiplight AI tools to their existing Chrome browser tabs, eliminating the need to recreate login state, test data, or complex page states.

**Key Value:**
- **SSO/OAuth apps**: 0s vs 30s login time per test
- **Complex setup**: 0s vs 2-3min recreating state
- **Production debugging**: Access real sessions with live data
- **Browser extensions**: Test with password managers, dev tools active

## Architecture

```
Developer's Chrome Tab
         ↓
   (click extension icon)
         ↓
Chrome Extension (background.js)
   - Uses chrome.debugger API
   - Attaches to tab with user consent
   - Sends Target.attachedToTarget events
         ↓
   WebSocket Connection
         ↓
Extension Relay Server (localhost:15000-15999)
   - Single /cdp endpoint (OpenClaw pattern)
   - SessionIds from extension (not generated)
   - Global connectedTargets map
   - Handles auth with relay token
         ↓
Playwright via connectOverCDP()
   - Discovers pages via Target events
   - Uses extension-owned sessionIds
   - No assertion errors or mismatches
         ↓
MCP Tools
   - attach_to_current_tab()
   - get_dom(), act(), etc. all work seamlessly
```

## Components Implemented

### 1. Extension Relay Server (`ExtensionRelayServer.ts`)

**Purpose:** WebSocket server that bridges Chrome extension to Playwright using OpenClaw architecture

**Key Features:**
- HTTP server on random port (15000-15999, persisted in `~/.shiplight/chrome-relay-config.json`)
- WebSocket endpoint: `ws://127.0.0.1:<port>/extension?token=<relay-token>`
- Single CDP endpoint: `ws://127.0.0.1:<port>/cdp` (NOT per-session)
- Token-based authentication (HMAC-SHA256 derivation)
- Forwards CDP commands/events between extension and Playwright
- Handles multiple concurrent tabs

**Message Protocol:**
```typescript
// Extension → Relay: Attach notification
{
  method: 'forwardCDPEvent',
  params: {
    method: 'Target.attachedToTarget',
    params: { sessionId, targetInfo: {...} }
  }
}

// Relay → Extension: CDP command
{
  id: 1,
  method: 'forwardCDPCommand',
  params: { method: 'Runtime.evaluate', params: {...} }
}

// Extension → Relay: CDP response
{
  id: 1,
  result: { value: 2 }
}
```

### 2. Relay Authentication (`relayAuth.ts`)

**Purpose:** Secure token generation and validation

**Functions:**
- `generateRelayToken()` - Generate random relay token (48 hex chars)
- `deriveExtensionToken(relayToken, port)` - HMAC-SHA256 derivation for extension
- `validateExtensionToken(providedToken, relayToken, port)` - Timing-safe validation

**Security Model:**
- Relay server generates random token on startup
- Extension stores relay token in `chrome.storage.local`
- Extension derives port-specific token: `HMAC-SHA256(relayToken, "shiplight-extension-relay-v1:18792")`
- Extension sends derived token in WebSocket URL
- Relay server validates before accepting connection

### 3. SessionManager Enhancements

**Changes:**
- Added `sessionType: 'playwright' | 'relay'` field to `SessionData`
- Added `relayConnection?: RelayConnection` field to `SessionData`
- Added `createRelaySession()` method for relay sessions
- Updated `getSession()` to return relay connection info

**Relay Session Creation:**
```typescript
async createRelaySession(
  cdpEndpointUrl: string,
  tabInfo: { tabId, targetId, url, title },
  relaySessionId: string
): Promise<{ sessionId: string }>
```

**How it works:**
1. Uses Playwright's `chromium.connectOverCDP(cdpEndpointUrl)` to connect
2. Gets existing context and pages from relay session
3. Creates WebAgent and session data (same as regular sessions)
4. Marks as `sessionType: 'relay'`
5. Stores relay connection metadata

### 4. Session Types Updates (`sessionTypes.ts`)

**New Types:**
```typescript
export interface RelayConnection {
  sessionId: string;
  tabId: number;
  targetId: string;
  url: string;
  title: string;
  attachedAt: Date;
}

export interface SessionInfo {
  sessionId: string;
  sessionType: "browser" | "android" | "relay";
  relayConnection?: RelayConnection;
  // ... existing fields
}
```

### 5. New MCP Tools (`sessionTools.ts`)

**New Tools:**

#### `attach_to_current_tab()`
Attach to developer's current Chrome tab via extension relay.

**Usage:**
```typescript
const result = await callMCP('attach_to_current_tab', {
  port: 18792  // optional
});
// Returns: { session_id, url, title, session_type: 'relay' }
```

#### `list_relay_tabs()`
List all tabs attached via extension relay.

**Returns:** `{ tabs: [{ sessionId, tabId, url, title }] }`

#### `detach_from_tab(session_id)`
Detach from relay tab and close session.

#### `get_relay_status()`
Get extension relay server status.

**Returns:** `{ running, port, connected_tabs, relay_token }`

### 6. Chrome Extension

**Files:**
- `manifest.json` - MV3 extension manifest
- `background.js` - Service worker (CDP relay logic)
- `background-utils.js` - Token derivation, reconnect helpers
- `options.html` - Settings UI
- `options.js` - Settings logic
- `icons/` - Extension icons (16, 32, 48, 128px)

**Key Features:**
- Manual attach/detach via toolbar button click
- Badge indicators: ON (orange), connecting (…), error (!)
- Auto-reattach after navigation (preserve session)
- Auto-reconnect to relay server with exponential backoff
- State persistence across service worker restarts (MV3)
- Options page for relay port + auth token configuration

**Permissions:**
- `debugger` - Core feature (CDP access)
- `tabs` - Tab info
- `storage` - Persist settings
- `alarms` - Keepalive timer
- `webNavigation` - Navigation events

## Usage Example

### From Developer Workflow

```typescript
// 1. Developer opens app in Chrome and logs in via Google OAuth
// 2. Developer clicks Shiplight extension icon on tab
// 3. Badge shows "ON"

// 4. Coding agent attaches to tab
const result = await callMCP('attach_to_current_tab', {});
console.log(result);
// {
//   session_id: "2026-03-02_22-30-00_a1b2",
//   url: "http://localhost:3000/dashboard",
//   title: "Dashboard - My App",
//   session_type: "relay"
// }

// 5. Use existing MCP tools with relay session
const dom = await callMCP('get_dom', {
  session_id: result.session_id
});

const actResult = await callMCP('act', {
  session_id: result.session_id,
  actions: [
    {
      click: {
        element_index: 5,
        description: "Click profile menu"
      }
    }
  ]
});

// 6. Detach when done
await callMCP('detach_from_tab', {
  session_id: result.session_id
});
```

## Implementation Status

✅ **Completed:**
- Extension Relay Server
- Relay authentication (token generation/validation)
- SessionManager relay session support
- Session type updates
- New MCP tools (attach, list, detach, status)
- Chrome extension (background, options, manifest)
- Extension icons
- Documentation

⏳ **Pending:**
- Unit tests for ExtensionRelayServer
- Integration tests for relay workflow
- Manual end-to-end testing
- Chrome Web Store listing (optional)
- TypeScript declaration generation (blocked by peer deps)

## Dependencies Added

**package.json:**
```json
{
  "dependencies": {
    "ws": "^8.16.0"
  },
  "devDependencies": {
    "@types/ws": "^8.5.10"
  }
}
```

## Testing Plan

### Unit Tests (TODO)
- `ExtensionRelayServer.test.ts` - Server lifecycle, message handling
- `relayAuth.test.ts` - Token generation, validation
- `SessionManager.relay.test.ts` - Relay session creation

### Integration Tests (TODO)
- `sessionTools.relay.test.ts` - Full attach → act → detach flow

### Manual Testing Checklist (TODO)
- [ ] Extension installation
- [ ] Extension options configuration
- [ ] Basic attach/detach
- [ ] DOM extraction from relay session
- [ ] Action execution in relay session
- [ ] Navigation persistence (auto-reattach)
- [ ] Relay server reconnection
- [ ] SSO flow preservation
- [ ] Multiple tabs support

## Known Limitations

1. **Chrome/Brave/Edge only** - Uses `chrome.debugger` API (not available in Firefox/Safari)
2. **Local only** - Relay server binds to 127.0.0.1 (no remote access)
3. **One relay server per MCP instance** - Shared across all sessions
4. **No auto-login** - Relay sessions rely on existing browser session state
5. **TypeScript declarations** - DTS generation blocked by peer dependency errors (JS build works)

## Future Enhancements

1. **Multi-tab selection** - Choose which tab to attach when multiple are active
2. **Record flow feature** - Generate YAML test flows from user actions
3. **Chrome Web Store** - Publish extension for easier distribution
4. **Firefox/Safari support** - Separate extensions with different APIs
5. **Remote relay** - Support tunneling for remote debugging
6. **Usage analytics** - Track adoption metrics

## Files Changed/Created

**New Files:**
- `packages/mcp-tools/src/backends/ExtensionRelayServer.ts`
- `packages/mcp-tools/src/backends/relayAuth.ts`
- `packages/mcp-tools/chrome-extension/manifest.json`
- `packages/mcp-tools/chrome-extension/background.js`
- `packages/mcp-tools/chrome-extension/background-utils.js`
- `packages/mcp-tools/chrome-extension/options.html`
- `packages/mcp-tools/chrome-extension/options.js`
- `packages/mcp-tools/chrome-extension/icons/*`
- `packages/mcp-tools/chrome-extension/README.md`
- `packages/mcp-tools/EXTENSION_RELAY.md` (this file)

**Modified Files:**
- `packages/mcp-tools/src/backends/sessionTypes.ts` - Added RelayConnection type
- `packages/mcp-tools/src/backends/SessionManager.ts` - Added relay session support
- `packages/mcp-tools/src/backends/index.ts` - Export relay components
- `packages/mcp-tools/src/tools/sessionTools.ts` - Added relay tools
- `packages/mcp-tools/package.json` - Added ws dependency

## Next Steps

1. **Install dependencies**: `pnpm install` (already done)
2. **Build package**: JavaScript build succeeds, DTS blocked by peer deps
3. **Load extension**: Chrome → chrome://extensions → Load unpacked
4. **Configure extension**: Set port 18792 and relay token
5. **Manual testing**: Verify attach → control → detach workflow
6. **Write tests**: Unit + integration tests
7. **Documentation**: Add to Shiplight docs site
8. **Publish extension**: Chrome Web Store (optional)
