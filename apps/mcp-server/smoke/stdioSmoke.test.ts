/**
 * End-to-end smoke test for the MCP server's stdio API surface.
 *
 * Complements two existing layers rather than duplicating them:
 * - `src/stdioGuards.test.ts` unit-tests the stdio *helpers* in isolation.
 * - `packages/mcp-tools/browser-tests` exercises browser tool *behaviour* by
 *   calling mcp-tools functions directly — it never crosses the wire.
 *
 * Nothing covered the protocol itself: the JSON-RPC framing, tool registration,
 * advertised schemas, resources, prompts, and the error path. That surface is
 * what every editor client actually consumes, and it is what silently regressed
 * when the chrome-extension bundle vanished in 0.1.62.
 *
 * These tests run against the built `dist/index.js` — the shipped artifact —
 * and are fully hermetic: no browser, no network, no LLM, no API token. That is
 * what makes them usable as a release gate.
 */
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test, { after, before, describe } from 'node:test';

import { McpStdioClient } from './mcpStdioClient.ts';

const packageRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const serverPath = join(packageRoot, 'dist', 'index.js');

/**
 * The complete tool surface. This server is browser-only — the v1 cloud tools
 * and the API-token gate were removed — so there is exactly one surface, and it
 * must not vary with the environment.
 *
 * Asserted exactly, not as a subset: a tool silently disappearing from the
 * bundle is precisely the regression class this file exists to catch, and a
 * subset assertion would not see it.
 */
const LOCAL_TOOLS = [
  'act',
  'attach_to_browser',
  'close_session',
  'generate_html_report',
  'get_browser_console_logs',
  'get_browser_network_logs',
  'get_locators',
  'get_page_info',
  'inspect_page',
  'navigate',
  'new_session',
  'save_storage_state',
].sort();

const ACTION_ENTITY_URI = 'shiplight://schemas/action-entity';

/** Resources the server advertises via resources/list. Asserted exactly. */
const LISTED_RESOURCES = [ACTION_ENTITY_URI];

/**
 * Removed with the v1 cloud surface. Kept here as an explicit negative: these
 * must not come back, and the TestFlow JSON schema in particular described a
 * cloud format this server no longer speaks.
 */
const REMOVED_CLOUD_TOOLS = [
  'get_function',
  'get_template',
  'get_test_case',
  'save_function',
  'save_template',
  'save_test_account',
  'save_test_case',
  'upload_html_report',
];

const REMOVED_RESOURCES = [
  'shiplight://schemas/testflow-json',
  'shiplight://schemas/testflow-json-v1.2.0',
  'shiplight://schemas/testflow-json-v1.3.0',
];

// A missing build must fail loudly. Skipping here would make the release gate
// silently vacuous — the exact fail-open shape this suite is meant to prevent.
if (!existsSync(serverPath)) {
  throw new Error(
    `MCP smoke tests require a build: ${serverPath} not found. Run "pnpm --filter @shiplightai/mcp build" first.`,
  );
}

function toolNames(result: Record<string, unknown>): string[] {
  return (result.tools as Array<{ name: string }>).map((t) => t.name).sort();
}

describe('MCP stdio API surface', () => {
  let client: McpStdioClient;

  before(async () => {
    client = await McpStdioClient.start({ serverPath });
  });

  after(async () => {
    await client?.close();
  });

  test('completes the initialize handshake and reports its identity', async () => {
    // A fresh client so the handshake result itself can be inspected.
    const fresh = await McpStdioClient.start({ serverPath });
    try {
      const result = await fresh.request('tools/list');
      assert.ok(Array.isArray(result.tools), 'tools/list must return an array after initialize');
    } finally {
      await fresh.close();
    }
  });

  test('advertises exactly the browser tool set', async () => {
    const names = toolNames(await client.request('tools/list'));
    assert.deepEqual(
      names,
      LOCAL_TOOLS,
      'the tool surface changed; update LOCAL_TOOLS deliberately if this was intended',
    );
  });

  test('the removed v1 cloud tools do not come back, with or without a token', async () => {
    // The token gate is gone, so setting one must not change anything. Asserting
    // both ways pins that: an accidental re-introduction of token-conditional
    // registration would show up here rather than in a user's client.
    for (const env of [undefined, { SHIPLIGHT_API_TOKEN: 'smoke-test-token-not-a-real-credential' }]) {
      const probe = await McpStdioClient.start({ serverPath, env });
      try {
        const names = toolNames(await probe.request('tools/list'));
        assert.deepEqual(
          names,
          LOCAL_TOOLS,
          `tool surface must be identical ${env ? 'with' : 'without'} a token`,
        );
        for (const removed of REMOVED_CLOUD_TOOLS) {
          assert.ok(!names.includes(removed), `${removed} was removed with the v1 cloud surface`);
        }
      } finally {
        await probe.close();
      }
    }
  });

  test('every advertised tool carries a usable schema', async () => {
    const tools = (await client.request('tools/list')).tools as Array<{
      name: string;
      description?: string;
      inputSchema?: {
        type?: string;
        properties?: Record<string, Record<string, unknown>>;
        required?: string[];
      };
    }>;

    for (const tool of tools) {
      assert.ok(tool.description && tool.description.trim().length > 0, `${tool.name} needs a description`);
      assert.equal(tool.inputSchema?.type, 'object', `${tool.name} inputSchema must be an object schema`);

      // An empty {} satisfies "properties is defined" but is useless to a
      // client, so assert the bag actually has entries.
      const properties = tool.inputSchema?.properties ?? {};
      const names = Object.keys(properties);
      assert.ok(names.length > 0, `${tool.name} inputSchema has no properties`);

      // A required key absent from properties is an unsatisfiable schema: the
      // client is told to send a field it has no definition for.
      for (const required of tool.inputSchema?.required ?? []) {
        assert.ok(names.includes(required), `${tool.name} requires "${required}" but does not define it`);
      }

      for (const name of names) {
        const property = properties[name];
        const typed =
          property.type !== undefined ||
          property.anyOf !== undefined ||
          property.oneOf !== undefined ||
          property.enum !== undefined ||
          property.$ref !== undefined;
        assert.ok(typed, `${tool.name}.${name} has no type, anyOf, oneOf, enum or $ref`);
        assert.ok(
          typeof property.description === 'string' && property.description.trim().length > 0,
          `${tool.name}.${name} has no description — clients surface these to the model`,
        );
      }
    }
  });

  test('advertises exactly the expected resources', async () => {
    const uris = ((await client.request('resources/list')).resources as Array<{ uri: string }>)
      .map((r) => r.uri)
      .sort();
    assert.deepEqual(
      uris,
      LISTED_RESOURCES,
      'the advertised resource set changed; update LISTED_RESOURCES deliberately if intended',
    );
  });

  test('every advertised resource returns substantive content', async () => {
    for (const uri of LISTED_RESOURCES) {
      const contents = (await client.request('resources/read', { uri })).contents as Array<{ text?: string }>;
      assert.ok(Array.isArray(contents) && contents.length > 0, `${uri} returned no contents`);
      const body = contents.map((c) => c.text ?? '').join('');
      // A placeholder or an error string would satisfy "non-empty", so require
      // enough substance that a gutted resource is caught.
      assert.ok(body.length > 1_000, `${uri} returned only ${body.length} bytes, likely a stub`);
    }
  });

  test('the action-entity resource documents exactly the actions act accepts', async () => {
    // The strongest available invariant on this resource: it is generated from
    // the action registry, and `act` builds its union schema from the same
    // registry. If the two ever disagree, either an action shipped undocumented
    // or the docs advertise something the tool will reject.
    const act = ((await client.request('tools/list')).tools as Array<{ name: string; inputSchema: any }>)
      .find((t) => t.name === 'act');
    assert.ok(act, 'act tool must be advertised');

    const variants = (act.inputSchema?.properties?.actions?.items?.anyOf ?? []) as Array<{
      properties?: Record<string, unknown>;
    }>;
    const acceptedActions = variants.map((v) => Object.keys(v.properties ?? {})[0]).filter(Boolean).sort();
    assert.ok(acceptedActions.length > 0, 'act schema must enumerate its action variants');

    const body = ((await client.request('resources/read', { uri: ACTION_ENTITY_URI }))
      .contents as Array<{ text?: string }>).map((c) => c.text ?? '').join('');
    const documentedActions = [...body.matchAll(/^#### (\S+)$/gm)].map((m) => m[1]).sort();

    assert.deepEqual(
      documentedActions,
      acceptedActions,
      'action-entity resource and the act tool schema have drifted apart',
    );
  });

  test('every documented action carries a JSON schema block', async () => {
    const body = ((await client.request('resources/read', { uri: ACTION_ENTITY_URI }))
      .contents as Array<{ text?: string }>).map((c) => c.text ?? '').join('');

    // Split on the action headings so each action's own section can be checked;
    // a global count of ``` fences would pass even if one action lost its schema.
    const sections = body.split(/^#### /gm).slice(1);
    assert.ok(sections.length > 0, 'no action sections found in action-entity resource');

    for (const section of sections) {
      const name = section.split('\n', 1)[0];
      const fence = section.match(/```json\n([\s\S]*?)```/);
      assert.ok(fence, `action "${name}" has no json schema block`);
      // Must be parseable JSON, not prose in a json fence.
      const parsed = JSON.parse(fence[1]) as Record<string, unknown>;
      assert.ok(Object.keys(parsed).length > 0, `action "${name}" has an empty schema`);
    }
  });

  test('the removed TestFlow JSON schema resources are gone, not merely unlisted', async () => {
    // They were previously resolvable while absent from resources/list, so a
    // listing assertion alone would not prove removal — read each one directly.
    for (const uri of REMOVED_RESOURCES) {
      const error = await client.requestExpectingError('resources/read', { uri });
      assert.match(error.message, /unknown resource/i, `${uri} must no longer resolve`);
    }
  });

  test('lists and renders every advertised prompt', async () => {
    const prompts = (await client.request('prompts/list')).prompts as Array<{
      name: string;
      arguments?: Array<{ name: string; required?: boolean }>;
    }>;
    assert.ok(prompts.length > 0, 'server must advertise at least one prompt');

    for (const prompt of prompts) {
      // Supply a placeholder for required args so the render path is exercised.
      const args = Object.fromEntries(
        (prompt.arguments ?? []).filter((a) => a.required).map((a) => [a.name, 'smoke']),
      );
      const rendered = await client.request('prompts/get', { name: prompt.name, arguments: args });
      const messages = rendered.messages as Array<unknown>;
      assert.ok(Array.isArray(messages) && messages.length > 0, `${prompt.name} rendered no messages`);
    }
  });

  test('rejects an unknown tool with a JSON-RPC error rather than crashing', async () => {
    const error = await client.requestExpectingError('tools/call', {
      name: 'no_such_tool_exists',
      arguments: {},
    });
    assert.ok(error.message.length > 0, 'error must carry a message');

    // The connection must survive a bad call.
    const names = toolNames(await client.request('tools/list'));
    assert.deepEqual(names, LOCAL_TOOLS, 'server must still serve requests after a failed tool call');
  });

  test('rejects an unknown resource with a JSON-RPC error', async () => {
    const error = await client.requestExpectingError('resources/read', {
      uri: 'shiplight://schemas/does-not-exist',
    });
    assert.match(error.message, /unknown resource/i);
  });

  test('keeps stdout free of non-protocol output', async () => {
    // stdio transport uses stdout as the wire. One stray console.log breaks
    // every client, and the failure is opaque from the editor side.
    await client.request('tools/list');
    await client.request('resources/list');
    assert.deepEqual(
      client.protocolViolations,
      [],
      `non-JSON-RPC output on stdout would corrupt the transport: ${client.protocolViolations.join(' | ')}`,
    );
  });
});

