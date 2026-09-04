#!/usr/bin/env bash
# Run the MCP server with stderr logged to a temp file for debugging.
# Usage:
#   ./run-debug.sh                  # plain stdio mode
#   ./run-debug.sh --inspector      # launch MCP Inspector UI
#
# Logs are written to /tmp/shiplight-mcp-debug.log (tail -f to watch).

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ENTRY="$SCRIPT_DIR/dist/index.js"
LOG_FILE="/tmp/shiplight-mcp-debug.log"

: > "$LOG_FILE"  # truncate
echo "Logs → $LOG_FILE"
echo "  tail -f $LOG_FILE   (in another terminal)"

if [[ "${1:-}" == "--inspector" ]]; then
  echo "Starting MCP Inspector…"
  npx @modelcontextprotocol/inspector node "$ENTRY" 2> >(tee -a "$LOG_FILE" >&2)
else
  echo "Starting MCP server (stdio)…"
  node "$ENTRY" 2>"$LOG_FILE"
fi
