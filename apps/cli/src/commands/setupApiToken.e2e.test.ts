import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

const cliRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const cliDist = join(cliRoot, 'dist', 'cli.js');
const skipNoBuild = existsSync(cliDist) ? false : ('dist/cli.js not found — run pnpm build first' as const);

describe('API-token command dispatch', { skip: skipNoBuild }, () => {
  it('rejects the removed login command without starting API-token setup', () => {
    const result = spawnSync(process.execPath, [cliDist, 'login'], {
      cwd: cliRoot,
      encoding: 'utf8',
      env: {
        ...process.env,
        SHIPLIGHT_NO_BROWSER: '1',
        SHIPLIGHT_WEB_URL: 'http://127.0.0.1:1',
      },
      timeout: 10_000,
    });
    const output = `${result.stdout}${result.stderr}`;

    assert.equal(result.status, 1, output);
    assert.match(output, /Unknown command: login/);
    assert.doesNotMatch(output, /Requesting Shiplight API-token setup/);
  });
});
