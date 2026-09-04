import { describe, it } from 'node:test';
import assert from 'node:assert';
import { existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const distExists = existsSync(resolve(__dirname, '../../../dist/index.js'));

describe('extract_email_content tool registration', { skip: !distExists && 'requires built dist (run pnpm build first)' }, () => {
  it('should be registered in the global toolRegistry', async () => {
    // Import from built dist to avoid ?raw import issues with tsx
    const sdkCore = await import('../../../dist/index.js');
    const { toolRegistry, ensureToolsRegistered } = sdkCore;
    await ensureToolsRegistered();
    assert.ok(
      toolRegistry.has('extract_email_content'),
      'extract_email_content should be in toolRegistry',
    );
  });
});
