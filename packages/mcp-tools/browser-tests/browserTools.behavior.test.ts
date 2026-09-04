/**
 * Behavioral browser-tools test for the MCP server (runs a REAL headless browser).
 *
 * Closes quality-evidence gap exp-browser-tools-behavior (+ much of
 * exp-session-lifecycle) for 003-shiplightai-mcp-server: previously the product's
 * core tools (navigate/inspect/get_locators/get_page_info/act) were only
 * validated at the input-schema level — no test ever drove a SessionManager-backed
 * page.
 *
 * This lives outside src/**\/__tests__ so the no-browser `test:unit` lane never
 * picks it up. It runs in the dedicated `test:browser` lane (see package.json),
 * which installs Chromium in CI.
 *
 * Everything here is deterministic and needs no API key: new_session ->
 * get_page_info -> inspect_page -> get_locators -> act(click navigates) ->
 * close. Proves the tools actually drive a real page and that a session is
 * created and torn down.
 *
 * There is deliberately no live-LLM case. This server is browser-only and wires
 * no model, so the AI-driven actions are not part of its surface — act refuses
 * them, and that refusal is asserted below.
 */

import assert from 'node:assert';
import { describe, it, before, after } from 'node:test';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { readFileSync, existsSync, rmSync } from 'node:fs';

import { SessionManager } from '../src/backends/SessionManager.js';
import { SessionTools } from '../src/tools/sessionTools.js';
import { BrowserTools } from '../src/tools/browserTools.js';
import { resolveWebAgentModelFromEnv } from 'shiplight-types';
import { configureSdk } from 'sdk-core';

// Wired into SessionTools so the session is configured exactly as a real client
// would have it. Nothing here calls an LLM — the AI-driven actions are refused
// by act — but passing it keeps the constructor call honest and would surface a
// signature drift like the one that silently dropped this argument before.
const MODEL = resolveWebAgentModelFromEnv(process.env as Record<string, string | undefined>);

// --- Fixture site: two pages so a click can be observed as a navigation ---

function startFixtureServer(): Promise<{ baseUrl: string; close: () => Promise<void> }> {
  const server = http.createServer((req, res) => {
    res.setHeader('content-type', 'text/html');
    if (req.url === '/next') {
      res.end('<!doctype html><html><head><title>Fixture Next</title></head><body><h1>Next Page</h1><p>Welcome aboard</p><script>console.log("fixture-console-marker")</script></body></html>');
    } else {
      res.end('<!doctype html><html><head><title>Fixture Home</title></head><body><h1>Home</h1><a id="go" href="/next">Go to next page</a><script>console.log("fixture-console-marker")</script></body></html>');
    }
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address() as AddressInfo;
      resolve({
        baseUrl: `http://127.0.0.1:${port}`,
        close: () => new Promise((r) => server.close(() => r())),
      });
    });
  });
}

function parseFirstElementIndexContaining(domText: string, needle: string): number {
  for (const line of domText.split('\n')) {
    if (line.toLowerCase().includes(needle.toLowerCase())) {
      const m = line.match(/\[(\d+)\]/);
      if (m) return Number(m[1]);
    }
  }
  throw new Error(`No element index found for "${needle}" in DOM text:\n${domText.slice(0, 2000)}`);
}

describe('MCP browser tools drive a real page (headless)', () => {
  let fixture: { baseUrl: string; close: () => Promise<void> };
  let sm: SessionManager;
  let sessionTools: SessionTools;
  let browserTools: BrowserTools;
  let sessionId: string;
  // Captured by inspect_page, consumed by the get_locators / act(click) steps below.
  let linkIndex = -1;

  before(async () => {
    // Mirror the MCP server startup so sdk-core can see provider keys (it reads
    // from SdkConfig.env, never process.env directly). Only matters for live act(verify).
    configureSdk({ env: process.env as Record<string, string | undefined> });
    fixture = await startFixtureServer();
    sm = new SessionManager();
    sessionTools = new SessionTools(sm, MODEL);
    browserTools = new BrowserTools(sm);
  });

  after(async () => {
    await sm?.closeAllSessions().catch(() => {});
    await fixture?.close();
  });

  it('new_session opens a real browser at the starting URL', async () => {
    const res = JSON.parse(
      await sessionTools.newSession({
        starting_url: fixture.baseUrl + '/',
        browser_options: { headless: true },
      }),
    );
    sessionId = res.session_id;
    assert.ok(sessionId, 'should return a session_id');
    assert.match(res.current_url, /127\.0\.0\.1/);
    assert.strictEqual(sm.getSessionCount(), 1, 'one live session');
  });

  it('get_page_info reports the real URL and title', async () => {
    const info = JSON.parse(await browserTools.getPageInfo({ session_id: sessionId }));
    assert.match(info.url, /\/$|127\.0\.0\.1/);
    assert.strictEqual(info.title, 'Fixture Home');
  });

  it('inspect_page extracts the DOM with element indices', async () => {
    const res = JSON.parse(await browserTools.inspectPage({ session_id: sessionId }));
    assert.ok(res.dom_file_path, 'should return a DOM file path');
    const dom = readFileSync(res.dom_file_path, 'utf8');
    assert.match(dom, /next page/i, 'DOM should include the link text');
    // index used by the next steps
    linkIndex = parseFirstElementIndexContaining(dom, 'next page');
  });

  it('get_locators returns a locator + xpath for the link element', async () => {
    const res = JSON.parse(await browserTools.getLocators({ session_id: sessionId, element_indices: [linkIndex] }));
    assert.strictEqual(res.results.length, 1);
    const r = res.results[0];
    assert.ok(!r.error, `locator extraction errored: ${r.error}`);
    assert.ok(r.locator || r.xpath, 'should return a locator or xpath');
  });

  it('get_locators returns replay-ready payload: frame_path plus an xpath that resolves', async () => {
    // The product promise behind this server: what a located action returns is what
    // an agent embeds into .test.yaml so the step replays deterministically. Shape
    // alone is not enough — a returned xpath that does not resolve is not
    // replay-ready, so this drives it back against the live page.
    const res = JSON.parse(await browserTools.getLocators({ session_id: sessionId, element_indices: [linkIndex] }));
    const r = res.results[0];

    assert.ok(Array.isArray(r.frame_path), 'entity must carry a frame_path array (empty at top level)');
    assert.strictEqual(r.frame_path.length, 0, 'the fixture link is top-level, so frame_path should be empty');
    assert.strictEqual(r.element_index, linkIndex, 'entity should echo the element index it was located from');
    assert.ok(typeof r.tag_name === 'string' && r.tag_name.length > 0, 'entity should carry the tag name');

    assert.ok(r.xpath, 'entity must carry an xpath fallback');
    const resolved = sm.getPage(sessionId).locator(`xpath=${r.xpath}`);
    assert.strictEqual(await resolved.count(), 1, `xpath must resolve to exactly one element: ${r.xpath}`);
    assert.match(
      (await resolved.textContent()) ?? '',
      /next page/i,
      'the xpath must resolve to the element it was located from, not just any element',
    );
  });

  it('act(click) navigates the real page to the linked URL', async () => {
    const res = JSON.parse(
      await browserTools.act({
        session_id: sessionId,
        actions: [{ click: { element_index: linkIndex, description: 'click the "Go to next page" link' } }],
      }),
    );
    assert.strictEqual(res.success, true, `act failed: ${JSON.stringify(res)}`);

    // act must hand back the replay payload too, not just perform the click —
    // this is the data an agent writes into a .test.yaml statement.
    const entity = res.actions?.[0]?.action_entity;
    assert.ok(entity, 'act should return an action_entity for the executed action');
    assert.ok(
      entity.locator || entity.xpath,
      `action_entity must carry a locator or xpath: ${JSON.stringify(entity)}`,
    );

    const info = JSON.parse(await browserTools.getPageInfo({ session_id: sessionId }));
    assert.match(info.url, /\/next$/, 'click should have navigated to /next');
    assert.strictEqual(info.title, 'Fixture Next');
  });

  it('act refuses AI-driven actions over the real tool surface', async () => {
    // This server is browser-only and wires no LLM model, so verify and the
    // other AI-driven actions are not part of its surface. They used to be
    // callable anyway — dispatched into sdk-core and failing with "No LLM model
    // configured", which pointed users at an API key that would not have helped.
    // Driven here through the same BrowserTools instance the tool surface uses.
    await assert.rejects(
      () =>
        browserTools.act({
          session_id: sessionId,
          actions: [{ verify: { description: 'verify welcome text', statement: 'anything' } }],
        }),
      (err: Error) => {
        assert.match(err.message, /Unsupported act action\(s\): verify/);
        assert.doesNotMatch(
          err.message,
          /No LLM model configured/,
          'the refusal must not read as a missing-API-key problem',
        );
        return true;
      },
    );
  });

  it('captures console and network logs during the session', () => {
    const consoleLogs = sm.getConsoleLogs(sessionId);
    const networkLogs = sm.getNetworkLogs(sessionId);
    assert.ok(
      consoleLogs.some((l) => l.text.includes('fixture-console-marker')),
      'page console.log should be captured',
    );
    assert.ok(networkLogs.length > 0, 'page navigations should produce captured network entries');
  });

  it('close_session tears down the browser and frees the session', async () => {
    await sm.closeSession(sessionId);
    assert.strictEqual(sm.getSessionCount(), 0, 'session should be gone after close');
    assert.strictEqual(sm.getSession(sessionId), null, 'getSession should return null after close');
  });

  it('new_session browser options actually configure the context, not just pass schema validation', async () => {
    // The schema test proves these options are ACCEPTED. This proves they take
    // effect: a schema that validates an option the context ignores would pass
    // there and still ship a broken feature.
    const res = JSON.parse(
      await sessionTools.newSession({
        starting_url: fixture.baseUrl + '/',
        browser_options: {
          headless: true,
          viewport: { width: 900, height: 640 },
          locale: 'ja-JP',
          color_scheme: 'dark',
        },
      }),
    );
    const page = sm.getPage(res.session_id);

    const applied = await page.evaluate(() => ({
      width: window.innerWidth,
      height: window.innerHeight,
      language: navigator.language,
      dark: window.matchMedia('(prefers-color-scheme: dark)').matches,
    }));

    assert.strictEqual(applied.width, 900, 'configured viewport width should reach the page');
    assert.strictEqual(applied.height, 640, 'configured viewport height should reach the page');
    assert.strictEqual(applied.language, 'ja-JP', 'configured locale should reach navigator.language');
    assert.strictEqual(applied.dark, true, 'configured color_scheme should drive the CSS media query');

    await sm.closeSession(res.session_id);
  });
});

describe('MCP sessions are isolated and independently torn down', () => {
  let fixture: { baseUrl: string; close: () => Promise<void> };
  let sm: SessionManager;
  let sessionTools: SessionTools;
  let browserTools: BrowserTools;

  before(async () => {
    fixture = await startFixtureServer();
    sm = new SessionManager();
    sessionTools = new SessionTools(sm);
    browserTools = new BrowserTools(sm);
  });

  after(async () => {
    await sm?.closeAllSessions().catch(() => {});
    await fixture?.close();
  });

  it('runs two concurrent sessions without cross-contamination, closing each independently', async () => {
    const a = JSON.parse(await sessionTools.newSession({ starting_url: fixture.baseUrl + '/', browser_options: { headless: true } }));
    const b = JSON.parse(await sessionTools.newSession({ starting_url: fixture.baseUrl + '/next', browser_options: { headless: true } }));

    assert.notStrictEqual(a.session_id, b.session_id, 'sessions must have distinct ids');
    assert.strictEqual(sm.getSessionCount(), 2, 'two live sessions');

    // Isolation: each session sees its own page simultaneously.
    const infoA = JSON.parse(await browserTools.getPageInfo({ session_id: a.session_id }));
    const infoB = JSON.parse(await browserTools.getPageInfo({ session_id: b.session_id }));
    assert.strictEqual(infoA.title, 'Fixture Home');
    assert.strictEqual(infoB.title, 'Fixture Next');

    // Closing A must not affect B.
    await sm.closeSession(a.session_id);
    assert.strictEqual(sm.getSessionCount(), 1, 'one session remains after closing A');
    assert.strictEqual(sm.getSession(a.session_id), null, 'A is gone');
    await assert.rejects(
      () => browserTools.getPageInfo({ session_id: a.session_id }),
      /not found/i,
      'operations on a closed session must fail',
    );
    const infoBAfter = JSON.parse(await browserTools.getPageInfo({ session_id: b.session_id }));
    assert.strictEqual(infoBAfter.title, 'Fixture Next', 'B still works after A is closed');

    await sm.closeSession(b.session_id);
    assert.strictEqual(sm.getSessionCount(), 0, 'all sessions torn down');
  });
});

// --- Storage-state fixture: /set writes localStorage; /show renders it back ---
//
// Proves the save_storage_state -> new_session(storage_state_path) round-trip
// (003 exp-storage-state): the auth-cache promise that you can log in once,
// persist cookies/localStorage to a file, and restore them in a fresh session.
function startStorageFixture(): Promise<{ baseUrl: string; close: () => Promise<void> }> {
  const server = http.createServer((req, res) => {
    res.setHeader('content-type', 'text/html');
    if (req.url?.startsWith('/show')) {
      // Render all three persisted stores into the DOM so inspect_page can observe
      // them. IndexedDB is async, so #idb starts as "pending" and the readiness
      // flag (#ready) only flips once every read has landed.
      res.end(
        '<!doctype html><html><head><title>Show</title></head><body>' +
          '<h1 id="out">pending</h1><h2 id="cookie">pending</h2><h3 id="idb">pending</h3><p id="ready">no</p>' +
          '<script>' +
          'document.getElementById("out").textContent = localStorage.getItem("ss_probe") || "MISSING";' +
          'document.getElementById("cookie").textContent = /ss_cookie=([^;]+)/.exec(document.cookie)?.[1] || "MISSING";' +
          'const rq = indexedDB.open("ss_db", 1);' +
          'rq.onupgradeneeded = () => rq.result.createObjectStore("kv");' +
          'rq.onsuccess = () => {' +
          '  const get = rq.result.transaction("kv", "readonly").objectStore("kv").get("ss_key");' +
          '  get.onsuccess = () => {' +
          '    document.getElementById("idb").textContent = get.result || "MISSING";' +
          '    document.getElementById("ready").textContent = "yes";' +
          '  };' +
          '  get.onerror = () => { document.getElementById("ready").textContent = "yes"; };' +
          '};' +
          'rq.onerror = () => { document.getElementById("ready").textContent = "yes"; };' +
          '</script></body></html>',
      );
    } else {
      // /set: write a known value into each of the three stores the tool advertises
      // (localStorage, cookies, IndexedDB) for this origin. #ready flips only after
      // the IndexedDB transaction commits, so the test never captures a half-written
      // state.
      res.end(
        '<!doctype html><html><head><title>Set</title></head><body><h1>Set</h1><p id="ready">no</p>' +
          '<script>' +
          'localStorage.setItem("ss_probe", "persisted-value-42");' +
          'document.cookie = "ss_cookie=cookie-value-7; path=/";' +
          'const rq = indexedDB.open("ss_db", 1);' +
          'rq.onupgradeneeded = () => rq.result.createObjectStore("kv");' +
          'rq.onsuccess = () => {' +
          '  const tx = rq.result.transaction("kv", "readwrite");' +
          '  tx.objectStore("kv").put("idb-value-9", "ss_key");' +
          '  tx.oncomplete = () => { document.getElementById("ready").textContent = "yes"; };' +
          '};' +
          '</script></body></html>',
      );
    }
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address() as AddressInfo;
      resolve({
        baseUrl: `http://127.0.0.1:${port}`,
        close: () => new Promise((r) => server.close(() => r())),
      });
    });
  });
}

describe('save_storage_state captures and restores session state across sessions', () => {
  let fixture: { baseUrl: string; close: () => Promise<void> };
  let sm: SessionManager;
  let sessionTools: SessionTools;
  let browserTools: BrowserTools;
  const statePath = path.join(os.tmpdir(), `mcp-ss-roundtrip-${process.pid}-${Date.now()}.json`);
  // Echoed response of the save_storage_state call, captured once in before().
  let savedResult: { path: string };

  before(async () => {
    fixture = await startStorageFixture();
    sm = new SessionManager();
    sessionTools = new SessionTools(sm);
    browserTools = new BrowserTools(sm);
    // Produce the saved state once so each test is independent (and runnable in
    // isolation under --test-name-pattern): a session sets localStorage, then
    // save_storage_state writes it to disk.
    const created = JSON.parse(
      await sessionTools.newSession({ starting_url: fixture.baseUrl + '/set', browser_options: { headless: true } }),
    );
    // The IndexedDB write is async: wait for the page's readiness flag before
    // capturing, or storageState races the transaction and the assertion below
    // would fail intermittently rather than prove anything.
    await sm.getPage(created.session_id).waitForFunction(
      () => document.getElementById('ready')?.textContent === 'yes',
      undefined,
      { timeout: 10_000 },
    );
    savedResult = JSON.parse(await sessionTools.saveStorageState({ session_id: created.session_id, path: statePath }));
    await sm.closeSession(created.session_id);
  });

  after(async () => {
    await sm?.closeAllSessions().catch(() => {});
    await fixture?.close();
    if (existsSync(statePath)) rmSync(statePath, { force: true });
  });

  it('save_storage_state writes a state file capturing the page localStorage', () => {
    assert.strictEqual(savedResult.path, statePath, 'tool should echo the saved path');
    assert.ok(existsSync(statePath), 'storage state file should exist on disk');

    const state = JSON.parse(readFileSync(statePath, 'utf8'));
    const origin = (state.origins ?? []).find((o: { origin: string }) => o.origin.includes('127.0.0.1'));
    assert.ok(origin, 'saved state should include the fixture origin');
    const probe = (origin.localStorage ?? []).find((e: { name: string }) => e.name === 'ss_probe');
    assert.ok(probe, 'saved state should capture the ss_probe localStorage key');
    assert.strictEqual(probe.value, 'persisted-value-42', 'captured value must match what the page set');
  });

  it('save_storage_state also captures the cookie and the IndexedDB record', () => {
    // The tool advertises "cookies, localStorage, IndexedDB". localStorage is
    // covered above; these are the other two, which storageState only captures
    // because the implementation passes indexedDB: true.
    const state = JSON.parse(readFileSync(statePath, 'utf8'));

    const cookie = (state.cookies ?? []).find((c: { name: string }) => c.name === 'ss_cookie');
    assert.ok(cookie, 'saved state should capture the ss_cookie cookie');
    assert.strictEqual(cookie.value, 'cookie-value-7', 'captured cookie value must match what the page set');

    const origin = (state.origins ?? []).find((o: { origin: string }) => o.origin.includes('127.0.0.1'));
    assert.ok(origin, 'saved state should include the fixture origin');
    assert.ok(origin.indexedDB, 'saved state should carry an indexedDB section for the origin');
    assert.match(
      JSON.stringify(origin.indexedDB),
      /idb-value-9/,
      'saved state should capture the ss_key IndexedDB record',
    );
  });

  it('new_session restores the cookie and the IndexedDB record into a fresh session', async () => {
    const restored = JSON.parse(
      await sessionTools.newSession({
        starting_url: fixture.baseUrl + '/show',
        storage_state_path: statePath,
        browser_options: { headless: true },
      }),
    );

    const page = sm.getPage(restored.session_id);
    await page.waitForFunction(
      () => document.getElementById('ready')?.textContent === 'yes',
      undefined,
      { timeout: 10_000 },
    );

    assert.strictEqual(
      await page.locator('#cookie').textContent(),
      'cookie-value-7',
      'restored session must send back the persisted cookie',
    );
    assert.strictEqual(
      await page.locator('#idb').textContent(),
      'idb-value-9',
      'restored session must read back the persisted IndexedDB record',
    );

    await sm.closeSession(restored.session_id);
  });

  it('new_session restores the saved storage state into a fresh session', async () => {
    const restored = JSON.parse(
      await sessionTools.newSession({
        starting_url: fixture.baseUrl + '/show',
        storage_state_path: statePath,
        browser_options: { headless: true },
      }),
    );
    assert.strictEqual(restored.storage_state_loaded, true, 'new_session should report the state was loaded');

    const inspect = JSON.parse(await browserTools.inspectPage({ session_id: restored.session_id }));
    const dom = readFileSync(inspect.dom_file_path, 'utf8');
    assert.match(dom, /persisted-value-42/, 'restored session must read back the persisted localStorage value');

    await sm.closeSession(restored.session_id);
  });
});
