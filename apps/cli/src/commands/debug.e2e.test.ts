/**
 * E2E: `shiplight debug` boots a live debugger server (002 exp-debug-server).
 *
 * Spawns the built CLI, waits for the "Debugger running at" URL, hits the
 * session API (GET /api/debugger/sessions → 200 []), then tears the server down.
 * No browser is launched (a session is never created), so this is keyless and
 * browser-less. Skips if dist not built.
 */

import { describe, it, before } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import http from 'node:http';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CLI_ROOT = path.resolve(__dirname, '../..');
const CLI_DIST = path.join(CLI_ROOT, 'dist', 'cli.js');

function get(url: string): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const req = http.get(url, (res) => {
      let body = '';
      res.on('data', (c) => (body += c));
      res.on('end', () => resolve({ status: res.statusCode ?? 0, body }));
    });
    req.on('error', reject);
    req.setTimeout(5000, () => req.destroy(new Error('timeout')));
  });
}

describe('shiplight debug (end-to-end server smoke)', () => {
  before(() => {
    if (!fs.existsSync(CLI_DIST)) {
      throw new Error(`Built CLI not found at ${CLI_DIST}. Run \`pnpm build\` in apps/cli first.`);
    }
  });

  it('serves the session API and tears down cleanly', async () => {
    const root = path.join(CLI_ROOT, '.e2e-scratch');
    fs.mkdirSync(root, { recursive: true });
    const dir = fs.mkdtempSync(path.join(root, 'debug-'));
    fs.writeFileSync(
      path.join(dir, 'playwright.config.ts'),
      `import { defineConfig, shiplightConfig } from 'shiplightai';\nexport default defineConfig({ ...shiplightConfig(), testDir: '.' });\n`,
    );
    fs.writeFileSync(
      path.join(dir, 'foo.test.yaml'),
      'goal: Smoke\nbase_url: https://example.com\nstatements:\n  - intent: Do something\n',
    );

    const port = 6300 + Math.floor((Date.now() % 1000) / 4); // spread across runs; debug bumps if taken
    const child = spawn(process.execPath, [CLI_DIST, 'debug', 'foo.test.yaml', '--port', String(port)], {
      cwd: dir,
      detached: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    const urlReady = new Promise<string>((resolve, reject) => {
      let out = '';
      const onData = (c: Buffer) => {
        out += c.toString();
        // The printed URL carries a ?open= query; take just the origin.
        const m = out.match(/running at:?\s*(http:\/\/\S+)/i);
        if (m) {
          try {
            resolve(new URL(m[1]).origin);
          } catch {
            /* keep waiting for a parseable URL */
          }
        }
      };
      child.stdout!.on('data', onData);
      child.stderr!.on('data', onData);
      child.on('exit', (code) => reject(new Error(`debug exited early (${code}):\n${out}`)));
      setTimeout(() => reject(new Error(`debugger did not start in time:\n${out}`)), 45_000);
    });

    try {
      const baseUrl = await urlReady;
      const res = await get(`${baseUrl}/api/debugger/sessions`);
      assert.equal(res.status, 200, 'session API responds 200');
      const parsed = JSON.parse(res.body);
      // Accept either a bare array or an envelope containing one.
      const sessions = Array.isArray(parsed) ? parsed : parsed.sessions;
      assert.ok(Array.isArray(sessions), 'returns a sessions array');
      assert.equal(sessions.length, 0, 'no sessions open at startup');
    } finally {
      try {
        if (child.pid != null) {
          process.kill(-child.pid, 'SIGKILL'); // kill the process group (inner proc too)
        } else {
          child.kill('SIGKILL');
        }
      } catch {
        child.kill('SIGKILL');
      }
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
