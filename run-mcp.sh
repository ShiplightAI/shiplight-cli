#!/bin/bash
# Wrapper for local MCP server development.
# Captures stderr (all logs + crash traces) to a log file.

LOG=/tmp/shiplight-mcp.log
DIR="$(cd "$(dirname "$0")" && pwd)"

echo "--- MCP server started at $(date) ---" >> "$LOG"
exec node "$DIR/apps/mcp-server/dist/index.js" "$@" 2>>"$LOG"
