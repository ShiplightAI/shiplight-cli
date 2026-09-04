/**
 * Vite config for building the embedded debugger SPA.
 *
 * Produces a static bundle at ../../apps/cli/dist/static-embedded/
 * served by the local debug server (express) under /debugger/static/* and
 * mounted as the per-session iframe target at /debugger/:sessionId/.
 *
 * The CLI's outer root (`/`) is served by a separate shell bundle built via
 * vite.debugger-shell.config.ts — see specs/_archive/007-cli-multi-session-shell/plan.md.
 *
 * Usage: cd apps/frontend && npx vite build --config vite.debugger.config.ts
 */

import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import * as path from "path";

const srcDir = path.resolve(__dirname, "src");
const shiplightTypesEntry = path.resolve(__dirname, "../../packages/types/src/index.ts");
const stubsDir = path.resolve(
  __dirname,
  "src/components/local-debugger/stubs",
);

// Set DEBUGGER_BUILD_MODE=production for release builds (minified, no sourcemaps)
const isProd = process.env.DEBUGGER_BUILD_MODE === "production";

export default defineConfig({
  root: path.resolve(__dirname, "src/components/local-debugger"),

  plugins: [
    // Note: Chrome DevTools UI files used by /devtools/inspector.html are no longer
    // copied into dist/static. They live in @shiplightai/devtools-assets and are
    // served from there by apps/cli's debug server (see apps/cli/src/debugger/index.ts).
    // Splitting the assets into a separate npm package lets users skip re-downloading
    // ~250 MB of unchanged Chrome DevTools bytes on every shiplightai upgrade.

    // Swap ActionEntityEditor → YamlActionEntityEditor in local debugger
    {
      name: "swap-action-entity-editor",
      enforce: "pre" as const,
      resolveId(source, importer) {
        if (
          importer &&
          (source.endsWith("actions/ActionEntityEditor") ||
            (source.endsWith("/ActionEntityEditor") && importer.includes("/actions/")))
        ) {
          return path.resolve(stubsDir, "ActionEntityEditor.tsx");
        }
      },
    },
    // Swap FileUploadModal → LocalFileUploadModal (uses local file picker instead of cloud API)
    {
      name: "swap-file-upload-modal",
      enforce: "pre" as const,
      resolveId(source, importer) {
        if (
          source.endsWith("FileUploadModal") &&
          importer &&
          !importer.includes("stubs/FileUploadModal")
        ) {
          return path.resolve(stubsDir, "FileUploadModal.tsx");
        }
      },
    },
    // Swap ExtractEmailContentModal → LocalExtractEmailContentModal (no cloud config dependency)
    {
      name: "swap-extract-email-content-modal",
      enforce: "pre" as const,
      resolveId(source, importer) {
        if (
          source.endsWith("ExtractEmailContentModal") &&
          importer &&
          !importer.includes("stubs/ExtractEmailContentModal")
        ) {
          return path.resolve(stubsDir, "ExtractEmailContentModal.tsx");
        }
      },
    },
    react(),
  ],

  resolve: {
    // Array format: more-specific aliases MUST come before the catch-all "@"
    alias: [
      // ── Stubs for modules with Next.js / Electron dependencies ───
      { find: "next/router", replacement: path.resolve(stubsDir, "nextRouter.ts") },
      { find: "next/dynamic", replacement: path.resolve(stubsDir, "nextDynamic.ts") },
      { find: "next/link", replacement: path.resolve(stubsDir, "nextLink.tsx") },

      // Specific @/ overrides (must precede the catch-all "@" alias)
      { find: "@/contexts/AuthContext", replacement: path.resolve(stubsDir, "authContext.tsx") },
      { find: "@/hooks/useExperimentalFeature", replacement: path.resolve(stubsDir, "useExperimentalFeature.ts") },
      { find: "@/hooks/useIntRunner", replacement: path.resolve(stubsDir, "useIntRunner.ts") },

      // Resolve workspace package sources directly so the debugger bundle does
      // not depend on sibling package dist/ outputs being prebuilt.
      { find: /^shiplight-types$/, replacement: shiplightTypesEntry },

      // Catch-all: @ → src/
      { find: "@", replacement: srcDir },
    ],
  },

  define: {
    // Next.js env vars that components may reference
    "process.env.NEXT_PUBLIC_DISABLE_INT_RUNNER_IDEMPOTENCY": JSON.stringify(
      "false",
    ),
    "process.env.NEXT_PUBLIC_API_URL": JSON.stringify(""),
    "process.env.NODE_ENV": JSON.stringify("production"),
  },

  build: {
    outDir: path.resolve(__dirname, "../../apps/cli/dist/static-embedded"),
    emptyOutDir: true,
    sourcemap: !isProd,
    minify: isProd,
    rollupOptions: {
      input: path.resolve(
        __dirname,
        "src/components/local-debugger/index.html",
      ),
    },
  },

  // Development server (for testing the SPA standalone)
  server: {
    port: 6175,
    proxy: {
      "/api": "http://localhost:6174",
    },
  },
});