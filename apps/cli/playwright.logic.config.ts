import { defineConfig } from '@playwright/test';

// Browser-free logic tests: transpiler, YAML parsing, config, fixtures, and
// transpiler<->sdk-core conformance. These use @playwright/test purely as a
// test harness (describe/it/expect) — no test requests the page/browser/context
// fixture — so no browser binary is needed.
//
// Deliberately does NOT spread shiplightConfig(): we don't want its side
// effects here (YAML transpilation of tests/examples, the shiplight reporter,
// or dotenv walk-up). This keeps the logic suite fast, deterministic, and
// runnable in CI without `playwright install`.
export default defineConfig({
  testDir: './tests',
  testMatch: [
    'unit/**/*.test.ts',
    'integration/**/*.test.ts',
    'conformance/**/*.test.ts',
  ],
  reporter: 'list',
});
