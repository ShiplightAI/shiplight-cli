/**
 * Engine behavior against a local fixture site (CI browser lane for 001).
 *
 * Closes/raises quality-evidence checks for 001-web-agent-engine that previously
 * had no CI-gated browser proof:
 *  - exp-dom-extraction: DOM tree completeness (keyless, always runs in CI).
 *  - exp-self-healing-locators: locator/xpath computation that actually resolves
 *    (keyless) + live generation (keyed, self-skips without a provider key).
 *  - exp-nl-to-action-loop: live agent.execute end-to-end (keyed, self-skips).
 *
 * Self-contained: a local http server (no example.com), so the keyless parts are
 * deterministic and run in CI with just Chromium. The keyed parts run locally
 * (or in a keyed CI job) and skip when no provider key is present.
 */

import { test, expect } from '@playwright/test';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import {
  WebAgent,
  createAgentContext,
  configureSdk,
  DomService,
  getActionEntityLocatorInfo,
} from 'sdk-core';
import { VariableStore, resolveWebAgentModelFromEnv } from 'shiplight-types';

const MODEL = resolveWebAgentModelFromEnv(process.env as Record<string, string | undefined>);
const LIVE = !!MODEL;

let server: http.Server;
let baseUrl: string;

test.beforeAll(async () => {
  server = http.createServer((req, res) => {
    res.setHeader('content-type', 'text/html');
    if (req.url === '/next') {
      res.end('<!doctype html><html><head><title>Next</title></head><body><h1>Welcome aboard</h1></body></html>');
    } else {
      res.end(
        '<!doctype html><html><head><title>Login</title></head><body>' +
          '<h1>Sign in</h1>' +
          '<input id="user" aria-label="Username" />' +
          '<a id="login" href="/next" role="button">Login</a>' +
          '</body></html>',
      );
    }
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

test.afterAll(async () => {
  await new Promise<void>((r) => server.close(() => r()));
});

test.describe('engine DOM + locator extraction (keyless, CI-gated)', () => {
  test('extracts a complete DOM tree of interactive elements', async ({ page }) => {
    await page.goto(`${baseUrl}/`);
    const dom = new DomService();
    const state = await dom.getClickableElements(page, {});

    expect(state.elementTree, 'element tree exists').toBeTruthy();
    let interactive = 0;
    for (const [, el] of state.selectorMap) if (el.isInteractive) interactive++;
    // The link and the input are both interactive.
    expect(interactive).toBeGreaterThanOrEqual(2);

    const text = state.elementTree.clickableElementsToString();
    expect(text).toContain('Login');
  });

  test('computes a self-healing locator + xpath that actually resolve', async ({ page }) => {
    await page.goto(`${baseUrl}/`);
    const dom = new DomService();
    const state = await dom.getClickableElements(page, {});

    // Find the "Login" element in the selector map.
    let loginEl: (typeof state.selectorMap extends Map<number, infer V> ? V : never) | undefined;
    for (const [, el] of state.selectorMap) {
      if (el.getAllTextTillNextClickableElement().includes('Login')) {
        loginEl = el;
        break;
      }
    }
    expect(loginEl, 'found the Login element').toBeTruthy();

    const info = await getActionEntityLocatorInfo(page, loginEl!);
    expect(info.xpath || info.locator, 'produced a locator or xpath').toBeTruthy();
    if (info.xpath) {
      const xp = info.xpath.startsWith('xpath=') ? info.xpath : `xpath=${info.xpath}`;
      expect(await page.locator(xp).count(), 'xpath resolves to the element').toBeGreaterThan(0);
    }
  });
});

test.describe('engine live agent (keyed — self-skips without a provider key)', () => {
  test.skip(!LIVE, 'no provider key / model in env');

  function makeAgent(): WebAgent {
    configureSdk({ env: process.env as Record<string, string | undefined> });
    return new WebAgent(createAgentContext({ model: MODEL, variableStore: new VariableStore(), testDataDir: '/tmp' }));
  }

  test('generates a click action with a resolving self-healing locator', async ({ page }) => {
    await page.goto(`${baseUrl}/`);
    const result = await makeAgent().generate(page, 'click the Login button');

    expect(result.success).toBe(true);
    const action = result.actions![0];
    expect(action.action_data!.action_name).toBe('click');
    // A self-healing locator was generated (semantic locator and/or xpath fallback).
    expect(action.xpath || action.locator, 'generated a usable locator').toBeTruthy();
    if (action.xpath) {
      expect(await page.locator(`xpath=${action.xpath}`).count(), 'xpath resolves').toBeGreaterThan(0);
    }
  });

  test('executes a natural-language step end-to-end (navigates)', async ({ page }) => {
    const agent = makeAgent();
    agent.agentServices.setupPageTracking(page.context());
    await page.goto(`${baseUrl}/`);

    await agent.execute(page, 'click the Login button');

    await expect(page).toHaveURL(/\/next$/);
  });
});
