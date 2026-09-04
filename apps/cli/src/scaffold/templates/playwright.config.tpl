import { defineConfig, shiplightConfig } from 'shiplightai';

// testDir '.' scans the whole project; shiplightConfig() defaults its YAML scan
// to the same project root, so nothing extra is needed here. If you narrow
// testDir to a subfolder, pass the same path as scanDir so the two stay in sync:
//   const testDir = './e2e';
//   export default defineConfig({ ...shiplightConfig({ scanDir: testDir }), testDir, ... });
export default defineConfig({
  ...shiplightConfig(),
  testDir: '.',
  testMatch: ['**/*.test.ts', '**/*.yaml.spec.ts'],
  timeout: 120_000,
  expect: { timeout: 10_000 },
  retries: process.env.CI ? 1 : 0,
  use: {
    headless: true,
    viewport: { width: 1280, height: 720 },
    actionTimeout: 15_000,
    video: 'on',
    screenshot: 'on',
    trace: 'on',
  },
});
