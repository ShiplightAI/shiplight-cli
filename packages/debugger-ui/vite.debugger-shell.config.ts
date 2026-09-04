/**
 * Vite config for building the CLI debugger multi-tab shell.
 *
 * Produces a static bundle at ../../apps/cli/dist/static/
 * served by the local debug server at the root URL.
 *
 * The shell is a thin outer host that polls /api/debugger/sessions and mounts
 * one <iframe src="/debugger/:sessionId/?embedded=1"> per live session.
 * Per-session debugger UI is the embedded SPA built by vite.debugger.config.ts
 * (output: ../../apps/cli/dist/static-embedded/).
 *
 * See specs/_archive/007-cli-multi-session-shell/plan.md.
 *
 * Usage: cd apps/frontend && npx vite build --config vite.debugger-shell.config.ts
 */

import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import * as path from "path";

const isProd = process.env.DEBUGGER_BUILD_MODE === "production";

export default defineConfig({
  root: path.resolve(__dirname, "src/components/local-debugger-shell"),

  plugins: [react()],

  build: {
    outDir: path.resolve(__dirname, "../../apps/cli/dist/static"),
    emptyOutDir: true,
    sourcemap: !isProd,
    minify: isProd,
    rollupOptions: {
      input: path.resolve(
        __dirname,
        "src/components/local-debugger-shell/index.html",
      ),
    },
  },

  server: {
    port: 6176,
    proxy: {
      "/api": "http://localhost:6174",
      "/debugger": "http://localhost:6174",
    },
  },
});
