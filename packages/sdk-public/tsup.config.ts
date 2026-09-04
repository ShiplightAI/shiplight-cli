import { defineConfig, type Options } from "tsup";

const isDev = process.env.NODE_ENV === 'development';

export default defineConfig((options: Options) => {
  return [
    {
      entry: ["src/index.ts"],
      clean: !options.watch,
      // Declarations are emitted by the `build:dts` script (tsc +
      // api-extractor), which inlines the private workspace packages. tsup's
      // own dts modes cannot do that: `dts: true` emits bare `from 'sdk-core'`
      // imports, `experimentalDts` only relocates them into a chunk file, and
      // `dts: { resolve: [...] }` emits dangling relative paths.
      dts: false,
      splitting: true,
      format: ["esm"],
      outDir: "dist",
      sourcemap: false,
      external: ["playwright", "sharp"], // Native addons must stay external (use __dirname)
      noExternal: ["sdk-core", "shiplight-types"], // Bundle both internal packages
      minify: !isDev,
      banner: {
        // Shim require() for CJS dependencies bundled into ESM
        js: `import { createRequire as __createRequire } from "module";\nconst require = __createRequire(import.meta.url);`,
      },
      esbuildOptions(esbuildOptions) {
        esbuildOptions.platform = "node";
        esbuildOptions.format = "esm";
      },
      ...options,
    },
  ];
});
