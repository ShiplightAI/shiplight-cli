import { defineConfig, type Options } from "tsup";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import RawPlugin from 'esbuild-plugin-raw'

const pkg = JSON.parse(readFileSync(fileURLToPath(new URL("./package.json", import.meta.url)), "utf-8"));

const entryPoints = [
  "src/**/*.ts",
  "!src/**/*.d.ts",
  "!src/**/*.test.ts",
  "!src/**/*.spec.ts",
  "!src/dom/dom-tree/behavioral-test.ts",
  "!src/dom/dom-tree/build.ts",
];

const isDev = process.env.NODE_ENV === 'development';

// Externalize all declared npm dependencies. Only workspace packages are inlined.
const npmExternals = [
  ...Object.keys(pkg.dependencies || {}),
  ...Object.keys(pkg.peerDependencies || {}),
  // Transitive deps of @ai-sdk/google-vertex — must be listed explicitly because
  // they are not direct deps of sdk-core. Without these, esbuild inlines them
  // (~400KB of google-auth-library) into sdk-core chunks, bloating all consumers.
  "google-auth-library",
  "gaxios",
  "gtoken",
  "gcp-metadata",
  "json-bigint",
  // Imported by shiplight-types, which is inlined via noExternal below. It is
  // declared by that package, not this one, so it does not appear in
  // pkg.dependencies — but esbuild still has to leave it alone. Bundling it
  // breaks at load: yaml is CJS and calls require("process"), which the ESM
  // output cannot satisfy. Both bundling consumers (apps/cli, apps/mcp-server)
  // declare yaml themselves, so it always resolves at runtime.
  "yaml",
  // Catch deep sub-path imports
  /^@ai-sdk\//,
  /^@babel\//,
  /^@google\//,
];

export default defineConfig((options: Options) => {
  const baseConfig = {
    entryPoints,
    sourcemap: true,
    minify: !isDev,
    esbuildPlugins: [RawPlugin()],
    ...options,
  } satisfies Options;

  return [
    {
      ...baseConfig,
      clean: !options.watch,
      dts: true,
      splitting: true, // Only ESM supports splitting
      format: ["esm"],
      outDir: "dist",
      external: npmExternals,
      noExternal: ["shiplight-types"], // Bundle internal packages
      esbuildOptions(esbuildOptions) {
        esbuildOptions.outExtension = { ".js": ".js" };
        esbuildOptions.platform = "node";
        esbuildOptions.format = "esm";
        esbuildOptions.outbase = "src";
      },
    },
  ];
});
