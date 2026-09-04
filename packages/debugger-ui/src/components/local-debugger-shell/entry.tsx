/**
 * Entry point for the CLI debugger multi-tab shell.
 *
 * Built by vite.debugger-shell.config.ts to apps/cli/dist/static/.
 * Served by the CLI debug server at the root URL (`/`); each open debugger
 * session is mounted as an iframe at `/debugger/:sessionId/?embedded=1`.
 *
 * See specs/_archive/007-cli-multi-session-shell/plan.md.
 *
 * NOTE on conventions: this is a standalone Vite bundle shipped by the CLI
 * (`shiplightai` npm package), NOT the Next.js frontend. The root CLAUDE.md
 * rules about `next-intl` localization and Tailwind theme variables are
 * scoped to the Next.js app and do not apply here — hardcoded strings and
 * inline hex colors in this directory are intentional to keep the shell
 * bundle small and dependency-free. Do not propagate this pattern to the
 * main app at apps/frontend/src/components/ outside this directory.
 */

import React from "react";
import { createRoot } from "react-dom/client";
import { DebuggerShellApp } from "./DebuggerShellApp";

const container = document.getElementById("root");
if (container) {
  createRoot(container).render(<DebuggerShellApp />);
}
