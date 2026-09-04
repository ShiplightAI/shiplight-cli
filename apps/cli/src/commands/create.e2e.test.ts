/**
 * E2E: `shiplight create` scaffolds a runnable project (002 exp-create-scaffold).
 *
 * Spawns the built dist/cli.js (skips if not built). Keyless, no browser.
 * Complements the unit scaffold coverage in src/scaffold/index.test.ts by
 * exercising the actual CLI command path end to end.
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CLI_ROOT = path.resolve(__dirname, '../..');
const CLI_DIST = path.join(CLI_ROOT, 'dist', 'cli.js');

let scratch: string;

describe('shiplight create (end-to-end)', () => {
  before(() => {
    if (!fs.existsSync(CLI_DIST)) {
      throw new Error(`Built CLI not found at ${CLI_DIST}. Run \`pnpm build\` in apps/cli first.`);
    }
    const root = path.join(CLI_ROOT, '.e2e-scratch');
    fs.mkdirSync(root, { recursive: true });
    scratch = fs.mkdtempSync(path.join(root, 'create-'));
  });

  after(() => {
    if (scratch) fs.rmSync(scratch, { recursive: true, force: true });
  });

  it('scaffolds the expected files into a fresh target', () => {
    const target = path.join(scratch, 'proj');
    const res = spawnSync(process.execPath, [CLI_DIST, 'create', target], {
      cwd: scratch,
      encoding: 'utf-8',
      timeout: 60_000,
    });
    assert.equal(res.status, 0, `create exited non-zero:\n${res.stdout}\n${res.stderr}`);

    for (const f of ['package.json', 'playwright.config.ts', '.env.example', '.gitignore']) {
      assert.ok(fs.existsSync(path.join(target, f)), `missing ${f}`);
    }
    // A runnable example test exists somewhere under the project.
    const hasExample = fs.existsSync(path.join(target, 'tests')) || fs.existsSync(path.join(target, 'example.test.yaml'));
    assert.ok(hasExample, 'missing example test / tests dir');
    const example = fs.readFileSync(path.join(target, 'tests', 'example.test.yaml'), 'utf-8');
    assert.match(example, /^base_url: https:\/\/static\.shiplight\.ai\/$/m);
    assert.match(example, /^  - URL: \/testing\/forms\/basic-form\.html$/m);
    assert.match(example, /^  - VERIFY: A success message is displayed$/m);
    assert.equal(
      fs.existsSync(path.join(target, 'environments')),
      false,
      'redundant example environments directory should not be scaffolded',
    );

    const pkg = JSON.parse(fs.readFileSync(path.join(target, 'package.json'), 'utf-8'));
    assert.ok(pkg.name, 'package.json has a name');
    assert.equal(pkg.type, 'module', 'scaffolded project is ESM');

    const config = fs.readFileSync(path.join(target, 'playwright.config.ts'), 'utf-8');
    assert.match(config, /shiplightConfig/, 'playwright.config wires shiplightConfig()');
  });
});
