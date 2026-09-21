import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

test('CLI installs the OpenRouter provider required by sdk-core', () => {
  const cli = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as {
    dependencies: Record<string, string>;
  };
  const core = JSON.parse(readFileSync(new URL('../../../packages/sdk-core/package.json', import.meta.url), 'utf8')) as {
    dependencies: Record<string, string>;
  };
  const provider = '@openrouter/ai-sdk-provider';
  assert.ok(cli.dependencies[provider], `${provider} must be a CLI runtime dependency`);
  assert.equal(cli.dependencies[provider], core.dependencies[provider]);
});
