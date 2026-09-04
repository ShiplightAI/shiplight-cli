import { defineConfig, type Options } from "tsup";

export default defineConfig((options: Options) => ({
  entryPoints: [
    "src/index.ts",
    "src/interfaces/index.ts",
    "src/tools/index.ts",
    "src/registry/index.ts",
    "src/types/index.ts",
    "src/backends/index.ts",
    "src/prompts/index.ts",
    "src/resources/index.ts",
  ],
  clean: true,
  dts: true,
  format: ["esm"],
  external: ["yaml", "typescript"],
  ...options,
}));
