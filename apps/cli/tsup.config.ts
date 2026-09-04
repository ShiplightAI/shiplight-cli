import { defineConfig, type Options } from "tsup";
import { readFileSync } from "fs";

const pkg = JSON.parse(readFileSync("./package.json", "utf-8"));

// Externalize all declared dependencies + peer dependencies.
// Workspace packages (sdk-core, shiplight-types, etc.) are in devDependencies
// and listed in noExternal — they get inlined since they're not published.
const npmExternals = [
  ...Object.keys(pkg.dependencies || {}),
  ...Object.keys(pkg.peerDependencies || {}),
  "playwright",
  // Catch deep imports like @ai-sdk/openai/internal, @babel/parser/lib, etc.
  /^@ai-sdk\//,
  /^@babel\//,
  /^@anthropic-ai\//,
  /^@modelcontextprotocol\//,
];

export default defineConfig((options: Options) => {
  const shared = {
    entry: ["src/index.ts", "src/fixture.ts", "src/debugger-pw.ts", "src/debugger-manager.ts", "src/debugger-server.ts", "src/reporter.ts"],
    dts: false,
    sourcemap: false,
    minify: true,
    external: npmExternals,
    noExternal: ["shiplight-types", "shiplight-telemetry", "sdk-core"],
    // Scaffold templates are real files (editable, lintable) inlined as text
    // at build time. Without this the .tpl imports in src/scaffold fail to
    // resolve. The matching runtime hook for tests is ./tpl-loader.mjs.
    loader: { ".tpl": "text" },
    esbuildOptions(esbuildOptions: any) {
      esbuildOptions.platform = "node";
      esbuildOptions.target = "es2022";
      esbuildOptions.define = {
        ...esbuildOptions.define,
        __SHIPLIGHTAI_VERSION__: JSON.stringify(pkg.version),
      };
    },
    ...options,
  };

  return [
    // ESM build — splitting disabled to avoid npx chunk caching issues
    {
      ...shared,
      clean: !options.watch,
      splitting: false,
      dts: { resolve: ['sdk-core', 'shiplight-types'] },
      format: ["esm"],
      outDir: "dist",
      // No createRequire banner on the library subpath builds: none of
      // debugger-manager / debugger-pw / index / fixture / reporter actually
      // call require(), so the banner was dead code AND it broke downstream
      // bundlers (e.g. apps/testbox) that re-inline these files — the
      // `const require = …` declaration duplicated with the consumer's own
      // banner and crashed at module load. The CLI entry build below keeps
      // the banner because cli.js dynamically requires babel presets at runtime.
      // Rebuild the debugger frontend static assets after tsup's clean wipes dist/.
      // Without this, running `pnpm tsup` directly leaves dist/static/ empty and
      // the debug server falls back to the placeholder HTML.
      //
      // Two bundles are built:
      //   - dist/static-embedded/ : per-session SPA (mounted at /debugger/:id/)
      //   - dist/static/          : multi-tab shell (mounted at root `/`)
      // See specs/_archive/007-cli-multi-session-shell/plan.md.
      // Also renders the `shiplight spec` assets into dist/spec/. They are
      // built rather than bundled so the engine action registry — every
      // action's zod schema and description — stays out of cli.js; see
      // scripts/render-spec-assets.mts. This runs in the same hook as the
      // debugger assets because both are wiped by tsup's clean.
      onSuccess: options.watch
        ? undefined
        : "pnpm exec tsx scripts/render-spec-assets.mts && pnpm exec tsx scripts/build-debugger-ui.mts",
    },
    // CJS build — Playwright loads config via require()
    {
      ...shared,
      splitting: false,
      format: ["cjs"],
      outDir: "dist/cjs",
    },
    // CLI build — standalone ESM entry with bundled workspace dependencies
    {
      entry: ["src/cli.ts"],
      format: ["esm"],
      dts: false,
      sourcemap: false,
      minify: true,
      outDir: "dist",
      splitting: false,
      loader: { ".tpl": "text" },
      noExternal: [
        "shiplight-types",
        "shiplight-telemetry",
        "sdk-core",
      ],
      external: npmExternals,
      esbuildOptions(esbuildOptions: any) {
        esbuildOptions.platform = "node";
        esbuildOptions.target = "es2022";
        esbuildOptions.logOverride = { "equals-negative-zero": "silent" };
        esbuildOptions.define = {
          ...esbuildOptions.define,
          __SHIPLIGHTAI_VERSION__: JSON.stringify(pkg.version),
        };
      },
      banner: {
        js: `#!/usr/bin/env node\nimport { createRequire as __cli_createRequire } from "module";\nconst require = __cli_createRequire(import.meta.url);`,
      },
      ...options,
    },
  ];
});
