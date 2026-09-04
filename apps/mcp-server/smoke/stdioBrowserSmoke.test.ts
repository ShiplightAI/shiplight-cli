/**
 * End-to-end smoke test for the MCP server's *browser* tools, driven over stdio.
 *
 * `stdioSmoke.test.ts` covers the protocol surface hermetically but never calls
 * a browser tool. `packages/mcp-tools/browser-tests` calls the browser tools
 * directly, in-process, never crossing the wire. So no test has ever driven a
 * real browser through the shipped binary's JSON-RPC transport — the exact path
 * an editor client uses.
 *
 * This closes that gap without needing an LLM: every action asserted here is in
 * ACT_SUPPORTED_ACTIONS, which is the deterministic DOM/navigation subset. The
 * page is a local file fixture, so there is no network dependency either.
 *
 * Requires Chromium. Missing browser fails loudly rather than skipping — a
 * silently-skipped release gate is worse than no gate.
 */
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import test, { after, before, describe } from 'node:test';

import { McpStdioClient } from './mcpStdioClient.ts';

const smokeDir = dirname(fileURLToPath(import.meta.url));
const packageRoot = dirname(smokeDir);
const serverPath = join(packageRoot, 'dist', 'index.js');
const fixtureUrl = pathToFileURL(join(smokeDir, 'fixtures', 'page.html')).href;

if (!existsSync(serverPath)) {
  throw new Error(
    `MCP browser smoke requires a build: ${serverPath} not found. Run "pnpm --filter @shiplightai/mcp build" first.`,
  );
}

/** Unwraps the text payload of a tools/call result. */
function callText(result: Record<string, unknown>): string {
  const content = result.content as Array<{ type: string; text?: string }> | undefined;
  assert.ok(Array.isArray(content) && content.length > 0, 'tools/call returned no content');
  return content.map((c) => c.text ?? '').join('\n');
}

/**
 * inspect_page does not inline the DOM — it returns a JSON envelope pointing at
 * a dom_file_path on disk. Reading through that pointer is part of the contract
 * a client has to implement, so the smoke test exercises it too.
 */
function readInspectedDom(result: Record<string, unknown>): string {
  const envelope = JSON.parse(callText(result)) as { dom_file_path?: string };
  assert.ok(envelope.dom_file_path, 'inspect_page must return a dom_file_path');
  assert.ok(existsSync(envelope.dom_file_path), `dom_file_path does not exist: ${envelope.dom_file_path}`);
  return readFileSync(envelope.dom_file_path, 'utf8');
}

describe('MCP browser tools over stdio', () => {
  let client: McpStdioClient;
  let sessionId: string;
  /** Element index of the fixture button, discovered via inspect_page. */
  let buttonIndex: number;
  /** Retained after teardown: generate_html_report only runs on a closed session. */
  let closedSessionId: string;

  before(async () => {
    // Browser launch dominates; give it more room than the protocol default.
    client = await McpStdioClient.start({ serverPath, timeoutMs: 120_000 });
  });

  after(async () => {
    if (sessionId) {
      // Best-effort teardown so a mid-suite failure cannot leak a browser.
      await client.request('tools/call', { name: 'close_session', arguments: { session_id: sessionId } })
        .catch(() => undefined);
    }
    await client?.close();
  });

  test('new_session launches a real browser at the fixture URL', async () => {
    const text = callText(
      await client.request('tools/call', {
        name: 'new_session',
        // Both flags belong under browser_options, NOT at the top level —
        // unknown top-level keys are silently ignored rather than rejected, so
        // a misplaced `headless` quietly launches a headed browser.
        //
        // record_evidence must be set up-front for generate_html_report to work
        // later: the report is assembled from video/trace captured during the
        // session, so it cannot be opted into after the fact.
        arguments: {
          starting_url: fixtureUrl,
          browser_options: { headless: true, record_evidence: true },
        },
      }),
    );
    const match = text.match(/[0-9]{4}-[0-9]{2}-[0-9]{2}-[0-9]{2}-[0-9]{2}-[0-9]{2}-[0-9a-f]{4}/);
    assert.ok(match, `could not find a session id in new_session output: ${text}`);
    sessionId = match[0];
  });

  test('get_page_info reports the fixture title through the wire', async () => {
    const text = callText(
      await client.request('tools/call', {
        name: 'get_page_info',
        arguments: { session_id: sessionId },
      }),
    );
    assert.match(text, /MCP Smoke Fixture/, 'page title must round-trip through the protocol');
  });

  test('navigate re-loads the fixture through the wire', async () => {
    // Also the point at which console capture becomes observable: the listener
    // attaches during session setup, so new_session's own initial load happens
    // before it is watching. A client that expects logs from the starting_url
    // load would see an empty list — worth pinning down.
    await client.request('tools/call', {
      name: 'navigate',
      arguments: { session_id: sessionId, url: fixtureUrl },
    });
    const text = callText(
      await client.request('tools/call', {
        name: 'get_page_info',
        arguments: { session_id: sessionId },
      }),
    );
    assert.match(text, /MCP Smoke Fixture/);
  });

  test('inspect_page returns DOM through a dom_file_path pointer', async () => {
    const dom = readInspectedDom(
      await client.request('tools/call', {
        name: 'inspect_page',
        arguments: { session_id: sessionId },
      }),
    );
    assert.match(dom, /Click me/, 'the fixture button must appear in the inspected DOM');
    assert.match(dom, /AWAITING_CLICK/, 'pre-click state must be visible so the act assertion is meaningful');

    // Indices are what a real client feeds back into act; derive rather than
    // hardcode so a numbering change surfaces here instead of silently
    // clicking the wrong element.
    const indexed = dom.match(/\[(\d+)\]<button[^>]*>\s*Click me/);
    assert.ok(indexed, `no indexed button in inspected DOM:\n${dom}`);
    buttonIndex = Number(indexed[1]);
  });

  test('act performs a deterministic click (no LLM involved)', async () => {
    // click is in ACT_SUPPORTED_ACTIONS — the deterministic subset — so this
    // exercises the act path without a model call. element_index is required;
    // an xpath alone is rejected by the action schema.
    const actResult = await client.request('tools/call', {
      name: 'act',
      arguments: {
        session_id: sessionId,
        actions: [{ click: { description: 'the Click me button', element_index: buttonIndex } }],
      },
    });

    // act reports per-action failure INSIDE a successful JSON-RPC response, so
    // the envelope must be inspected explicitly. Asserting only on the page
    // afterwards silently passes when the action never ran.
    const envelope = JSON.parse(callText(actResult)) as {
      success?: boolean;
      actions?: Array<{ success?: boolean; error?: string }>;
    };
    assert.equal(
      envelope.success,
      true,
      `act reported failure: ${envelope.actions?.map((a) => a.error).filter(Boolean).join('; ')}`,
    );

    const after = readInspectedDom(
      await client.request('tools/call', {
        name: 'inspect_page',
        arguments: { session_id: sessionId },
      }),
    );
    // Assert both directions: the new state appeared AND the old one is gone.
    // Matching only the post-state is not enough if the two strings overlap.
    assert.match(after, /CLICK_HANDLED/, 'the click must have mutated the page');
    assert.doesNotMatch(after, /AWAITING_CLICK/, 'the pre-click state must be gone after the click');
  });

  test('get_browser_console_logs surfaces the page console output', async () => {
    const text = callText(
      await client.request('tools/call', {
        name: 'get_browser_console_logs',
        arguments: { session_id: sessionId },
      }),
    );
    assert.match(text, /smoke-fixture-console-marker/, 'fixture console marker must be captured');
  });

  test('get_browser_network_logs responds without error', async () => {
    // A file:// page issues no requests, so assert the tool answers cleanly
    // rather than asserting on traffic that legitimately does not exist.
    const result = await client.request('tools/call', {
      name: 'get_browser_network_logs',
      arguments: { session_id: sessionId },
    });
    assert.ok(Array.isArray(result.content), 'get_browser_network_logs must return content');
  });

  test('get_locators returns a locator and xpath for an indexed element', async () => {
    const text = callText(
      await client.request('tools/call', {
        name: 'get_locators',
        arguments: { session_id: sessionId, element_indices: [buttonIndex] },
      }),
    );
    const payload = JSON.parse(text) as {
      results?: Array<{ element_index?: number; locator?: string | null; xpath?: string; tag_name?: string }>;
    };
    const hit = payload.results?.[0];
    assert.ok(hit, `get_locators returned no results: ${text}`);
    assert.equal(hit.element_index, buttonIndex, 'result must correspond to the requested index');
    assert.equal(hit.tag_name, 'button', 'resolved element must be the fixture button');
    // xpath is always produced; `locator` is a best-effort Playwright selector
    // and is legitimately null for an element with no distinguishing role or
    // accessible name, so only xpath can be asserted unconditionally.
    assert.ok((hit.xpath ?? '').length > 0, `expected an xpath, got: ${text}`);
  });

  test('save_storage_state writes a state file to the requested path', async () => {
    const statePath = join(mkdtempSync(join(tmpdir(), 'mcp-smoke-state-')), 'state.json');
    await client.request('tools/call', {
      name: 'save_storage_state',
      arguments: { session_id: sessionId, path: statePath },
    });
    assert.ok(existsSync(statePath), `save_storage_state did not create ${statePath}`);
    // Must be valid Playwright storage state, not an empty placeholder.
    const state = JSON.parse(readFileSync(statePath, 'utf8')) as Record<string, unknown>;
    assert.ok('cookies' in state && 'origins' in state, `unexpected storage state shape: ${Object.keys(state)}`);
  });

  test('attach_to_browser fails cleanly against an unreachable CDP endpoint', async () => {
    // Port 1 is never listening, so this deterministically exercises the
    // failure path offline. The point is that a bad endpoint surfaces as a
    // JSON-RPC error instead of killing the server or hanging the transport.
    const error = await client.requestExpectingError('tools/call', {
      name: 'attach_to_browser',
      arguments: { cdp_url: 'http://127.0.0.1:1' },
    });
    assert.ok(error.message.length > 0, 'attach_to_browser error must carry a message');

    // The existing session must be unaffected by the failed attach.
    const info = callText(
      await client.request('tools/call', { name: 'get_page_info', arguments: { session_id: sessionId } }),
    );
    assert.match(info, /MCP Smoke Fixture/, 'a failed attach must not disturb the live session');
  });

  test('close_session tears the session down', async () => {
    await client.request('tools/call', {
      name: 'close_session',
      arguments: { session_id: sessionId },
    });
    closedSessionId = sessionId;
    const closed = sessionId;
    sessionId = '';

    // Operating on a closed session must be a clean error, not a hang or crash.
    const error = await client.requestExpectingError('tools/call', {
      name: 'get_page_info',
      arguments: { session_id: closed },
    });
    assert.ok(error.message.length > 0, 'closed-session error must carry a message');
  });

  test('generate_html_report produces a readable report for the closed session', async () => {
    // Ordering is part of the contract, not a test convenience: the tool
    // rejects an open session with "Call close_session first", so a client has
    // to tear down before reporting.
    const outputPath = join(mkdtempSync(join(tmpdir(), 'mcp-smoke-report-')), 'report.html');
    await client.request('tools/call', {
      name: 'generate_html_report',
      arguments: { session_id: closedSessionId, title: 'MCP smoke report', output_path: outputPath },
    });
    assert.ok(existsSync(outputPath), `generate_html_report did not create ${outputPath}`);
    const html = readFileSync(outputPath, 'utf8');
    assert.match(html, /<html/i, 'report must be HTML');
    assert.match(html, /MCP smoke report/, 'report must carry the supplied title');
  });

  test('stdout stayed protocol-clean across the whole browser session', async () => {
    // Browser tools log heavily; any of it reaching stdout would corrupt the
    // transport for a real client mid-session.
    assert.deepEqual(
      client.protocolViolations,
      [],
      `non-JSON-RPC stdout during browser work: ${client.protocolViolations.join(' | ')}`,
    );
  });
});
