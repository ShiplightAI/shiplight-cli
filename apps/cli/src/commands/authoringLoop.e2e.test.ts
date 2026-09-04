/**
 * E2E: the offline authoring loop (002 SC-007, US6).
 *
 * SC-007 claims an agent can author a test with no MCP server present:
 * scaffold → read the YAML spec → write a `.test.yaml` → validate it strict,
 * offline after install. Each half was covered somewhere (create in
 * `create.e2e.test.ts`, strict in `transpile.test.ts`) but nothing chained the
 * four steps, so the claim rested on the parts rather than the loop.
 *
 * Everything here runs against the built `dist/cli.js` with no MCP server, no
 * API key and no network — that is the point. `shiplight spec yaml` must serve
 * the spec from inside the package (FR-014) and `transpile --strict` must reach
 * its verdict without contacting anything (FR-013).
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync, type SpawnSyncReturns } from 'node:child_process';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CLI_ROOT = path.resolve(__dirname, '../..');
const CLI_DIST = path.join(CLI_ROOT, 'dist', 'cli.js');

let scratch: string;

/**
 * Run the built CLI with an environment scrubbed of every credential and of
 * any MCP hint, so a step that quietly depended on one fails here.
 */
function runCli(args: string[], cwd: string): SpawnSyncReturns<string> {
  const env = { ...process.env };
  for (const key of Object.keys(env)) {
    if (
      /API_KEY$/.test(key) ||
      key.startsWith('SHIPLIGHT_API') ||
      key.startsWith('ANTHROPIC_') ||
      key.startsWith('OPENAI_') ||
      key.startsWith('GOOGLE_') ||
      key.startsWith('MCP_')
    ) {
      delete env[key];
    }
  }
  env.SHIPLIGHT_OFFLINE = '1';
  return spawnSync(process.execPath, [CLI_DIST, ...args], {
    cwd,
    encoding: 'utf-8',
    timeout: 120_000,
    env,
  });
}

describe('offline authoring loop: scaffold → spec → YAML → strict (SC-007)', () => {
  before(() => {
    if (!fs.existsSync(CLI_DIST)) {
      throw new Error(`Built CLI not found at ${CLI_DIST}. Run \`pnpm build\` in apps/cli first.`);
    }
    const root = path.join(CLI_ROOT, '.e2e-scratch');
    fs.mkdirSync(root, { recursive: true });
    scratch = fs.mkdtempSync(path.join(root, 'authoring-'));
  });

  after(() => {
    if (scratch) fs.rmSync(scratch, { recursive: true, force: true });
  });

  it('completes all four steps with no MCP server and no credentials', () => {
    const project = path.join(scratch, 'proj');

    // 1. Scaffold.
    const created = runCli(['create', project], scratch);
    assert.equal(created.status, 0, `create failed:\n${created.stdout}\n${created.stderr}`);

    // 2. Read the normative YAML spec from inside the package. An agent with no
    //    MCP server has no other way to learn the language (FR-014).
    const spec = runCli(['spec', 'yaml'], project);
    assert.equal(spec.status, 0, `spec yaml failed:\n${spec.stderr}`);
    assert.ok(spec.stdout.length > 500, 'spec yaml produced no meaningful output');
    assert.doesNotMatch(
      spec.stdout,
      /shiplight:\/\//,
      'the shipped spec must not point at MCP resource URIs — nothing can resolve them here (FR-016)',
    );

    // 3. Write a `.test.yaml` using the enriched ACTION form the spec teaches.
    const testsDir = path.join(project, 'tests');
    fs.mkdirSync(testsDir, { recursive: true });
    fs.writeFileSync(
      path.join(testsDir, 'authored.test.yaml'),
      [
        'goal: authored offline',
        'statements:',
        '  - URL: https://example.com',
        '  - intent: Click the more information link',
        '    action: click',
        '    locator: "getByRole(\'link\', { name: \'More information\' })"',
        '  - VERIFY: the page URL is example.com',
        '    js: "await expect(page).toHaveURL(/example\\\\.com/)"',
        '',
      ].join('\n'),
    );

    // 4. Validate strict. The gate must reach a verdict with no network.
    const strict = runCli(['transpile', 'tests/authored.test.yaml', '--strict'], project);
    assert.equal(
      strict.status,
      0,
      `strict validation of an enriched file should pass:\n${strict.stdout}\n${strict.stderr}`,
    );
    assert.ok(
      fs.existsSync(path.join(testsDir, 'authored.yaml.spec.ts')),
      'strict success must leave the generated spec on disk',
    );
  });

  it('strict still fails an under-enriched file offline — the gate is real, not skipped', () => {
    // A gate that passes because it could not check anything is worse than no
    // gate. Offline must change nothing about the verdict.
    const project = path.join(scratch, 'proj-drafty');
    assert.equal(runCli(['create', project], scratch).status, 0);

    const testsDir = path.join(project, 'tests');
    fs.mkdirSync(testsDir, { recursive: true });
    fs.writeFileSync(
      path.join(testsDir, 'drafty.test.yaml'),
      [
        'goal: drafty',
        'statements:',
        '  - URL: https://example.com',
        '  - intent: Click the thing',
        '  - intent: Click the other thing',
        '',
      ].join('\n'),
    );

    const strict = runCli(['transpile', 'tests/drafty.test.yaml', '--strict'], project);
    assert.equal(strict.status, 1, 'strict must fail on insufficient action coverage');
    assert.match(strict.stdout + strict.stderr, /coverage/i);
  });
});
