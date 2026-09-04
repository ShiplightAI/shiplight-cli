# Shiplight AI Extension

Chrome extension for attaching Shiplight to your existing Chrome tabs via CDP relay.

## Installation

### Development (Load Unpacked)

1. Open Chrome and navigate to `chrome://extensions`
2. Enable "Developer mode" (toggle in top right)
3. Click "Load unpacked"
4. Select the `chrome-extension` directory: `packages/mcp-tools/chrome-extension`
5. Extension appears with Shiplight icon

### Configuration

1. Click extension Options (right-click icon → Options, or go to chrome://extensions and click "Details" → "Extension options")
2. Set **Relay Server Port**: `18792` (default)
3. Set **Gateway Token**: Get from MCP server startup logs or call `get_relay_status` tool
4. Click "Save Settings"

## Usage

### From Developer Workflow

1. **Start MCP server** (relay server starts automatically when needed)
2. **Open your app** in Chrome (e.g., `http://localhost:3000`)
3. **Click extension icon** on the tab you want to control
4. **Badge shows "ON"** - tab is attached
5. **From coding agent**: Call `attach_to_current_tab()` MCP tool
6. **Control the tab** using `get_dom()`, `act()`, etc.
7. **Detach when done**: Click icon again or call `detach_from_tab()`

### Badge Indicators

- **No badge**: Extension not active on this tab
- **ON** (orange): Tab attached and connected to relay
- **…** (yellow): Relay reconnecting
- **!** (red): Error - check extension options

### Extension Options

- **Relay Server Port**: Default 18792 (must match MCP server)
- **Gateway Token**: Token for authentication with relay server

## How It Works

```
Chrome Tab (Your App)
         ↓
   chrome.debugger API (CDP)
         ↓
Extension (background.js)
         ↓
   WebSocket to Relay Server (localhost:18792)
         ↓
SessionManager (creates Playwright session)
         ↓
MCP Tools (get_dom, act, etc.)
```

## Features

- **Zero setup time**: Control existing tabs without recreating state
- **SSO/OAuth support**: Test authenticated apps without manual login
- **Auto-reconnect**: Survives relay server restarts
- **Auto-reattach**: Persists across page navigations
- **MV3 compatible**: Service worker with session state persistence

## Troubleshooting

### "Relay server not reachable"
- Check MCP server is running
- Verify port matches (default 18792)
- Check firewall/antivirus not blocking localhost

### "Missing gatewayToken"
- Go to extension Options
- Get token from MCP server logs or `get_relay_status` tool
- Save settings and try again

### Badge shows "!" error
- Right-click extension icon → "Inspect popup"
- Check console for error messages
- Verify relay server is running

## Development

### Files

- `manifest.json` - Extension manifest (MV3)
- `background.js` - Service worker (main logic)
- `background-utils.js` - Token derivation, reconnect helpers
- `options.html` - Settings UI
- `options.js` - Settings logic
- `icons/` - Extension icons

### Testing

1. Make changes to extension files
2. Go to `chrome://extensions`
3. Click "Reload" button for Shiplight AI
4. Test changes
