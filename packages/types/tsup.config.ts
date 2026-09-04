import { defineConfig, type Options } from "tsup";

export default defineConfig((options: Options) => ({
  entryPoints: [
    "src/**/*.ts",
    "!src/**/*.test.ts",
    "!src/**/*.spec.ts"
  ],
  clean: true,
  dts: true,
  format: ["esm"],
  external: ["yaml", "uuid"],
  ...options,
}));
