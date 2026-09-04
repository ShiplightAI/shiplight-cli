import { defineConfig, type Options } from "tsup";
import { readFileSync } from "fs";

const pkg = JSON.parse(readFileSync("./package.json", "utf-8"));

// Externalize all declared dependencies — only workspace packages are inlined.
const npmExternals = [
  ...Object.keys(pkg.dependencies || {}),
  ...Object.keys(pkg.peerDependencies || {}),
  // Catch deep imports (e.g. @ai-sdk/openai/internal)
  /^@ai-sdk\//,
  /^@anthropic-ai\//,
  /^@appium\//,
  /^@babel\//,
  /^@devicefarmer\//,
  /^@google\//,
  /^@modelcontextprotocol\//,
  /^@wdio\//,
  /^@xmldom\//,
  /^@yume-chan\//,
];

export default defineConfig((options: Options) => ({
  entry: ["src/index.ts"],
  format: ["esm"],
  dts: false,
  sourcemap: false,
  minify: true,
  clean: !options.watch,
  splitting: false,
  outDir: "dist",
  noExternal: [
    "mcp-tools",
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
      __PACKAGE_VERSION__: JSON.stringify(pkg.version),
    };
  },
  banner: {
    js: `#!/usr/bin/env node\nimport { createRequire as __createRequire } from "module";\nconst require = __createRequire(import.meta.url);`,
  },
  ...options,
}));
