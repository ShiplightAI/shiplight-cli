/**
 * ExtensionRelayServer integration tests
 *
 * Tests the CDP protocol between Playwright (connectOverCDP) and the relay server,
 * with a fake extension WebSocket client simulating Chrome tab registration.
 */

import { describe, it, before, after, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import WebSocket from 'ws';
import { chromium, type Browser, type BrowserContext } from 'playwright';
import { ExtensionRelayServer } from '../ExtensionRelayServer.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Simulates the Chrome extension WebSocket client */
class FakeExtension {
  private ws: WebSocket | null = null;
  private pending = new Map<number, { resolve: (v: any) => void; reject: (e: Error) => void }>();
  private sessionUrls = new Map<string, string>();
  private nextId = 1;
  private nextContextId = 1;

  async connect(port: number): Promise<void> {
    const url = `ws://127.0.0.1:${port}/extension`;

    this.ws = new WebSocket(url);

    // Set up message handler before waiting for open
    this.ws.on('message', (data) => {
      const msg = JSON.parse(data.toString());

      // Handle responses to our commands
      if (typeof msg.id === 'number') {
        const p = this.pending.get(msg.id);
        if (p) {
          this.pending.delete(msg.id);
          p.resolve(msg);
          return;
        }
        // Fall through — relay commands (forwardCDPCommand) also have an id field
      }

      // Handle relay commands (forwardCDPCommand, ping, getActiveTab)
      if (msg.method === 'ping') {
        this.ws!.send(JSON.stringify({ method: 'pong' }));
        return;
      }

      if (msg.method === 'forwardCDPCommand') {
        const cdpMethod = msg.params?.method;
        const sessionId = msg.params?.sessionId;
        const frameId = sessionId || 'main-frame';
        let result: any = {};

        // Playwright needs specific CDP responses for page initialization
        if (cdpMethod === 'Page.getFrameTree') {
          const url = this.sessionUrls.get(sessionId) || 'https://fake.test';
          result = {
            frameTree: {
              frame: { id: frameId, loaderId: 'loader-1', url, securityOrigin: url, mimeType: 'text/html' },
            },
          };
        } else if (cdpMethod === 'Page.addScriptToEvaluateOnNewDocument') {
          result = { identifier: '1' };
        } else if (cdpMethod === 'Runtime.enable') {
          // Must send executionContextCreated with frameId matching Page.getFrameTree
          this.ws!.send(JSON.stringify({
            method: 'forwardCDPEvent',
            params: {
              sessionId,
              method: 'Runtime.executionContextCreated',
              params: {
                context: {
                  id: this.nextContextId++,
                  origin: '',
                  name: '',
                  uniqueId: `ctx-${this.nextContextId}`,
                  auxData: { isDefault: true, type: 'default', frameId },
                },
              },
            },
          }));
        } else if (cdpMethod === 'Page.setLifecycleEventsEnabled') {
          // Send lifecycle events so Playwright considers page initialized
          for (const name of ['DOMContentLoaded', 'load']) {
            this.ws!.send(JSON.stringify({
              method: 'forwardCDPEvent',
              params: {
                sessionId,
                method: 'Page.lifecycleEvent',
                params: { frameId, loaderId: 'loader-1', name, timestamp: Date.now() / 1000 },
              },
            }));
          }
        }

        this.ws!.send(JSON.stringify({ id: msg.id, result }));
        return;
      }

      if (msg.method === 'getActiveTab') {
        this.ws!.send(JSON.stringify({ id: msg.id, result: { sessionId: null, tabId: null } }));
        return;
      }
    });

    await new Promise<void>((resolve, reject) => {
      this.ws!.on('open', resolve);
      this.ws!.on('error', reject);
    });
  }

  /** Register a tab (simulates extension attaching debugger and notifying relay) */
  registerTab(sessionId: string, targetId: string, tabId: number, url: string, title: string): void {
    this.sessionUrls.set(sessionId, url);
    this.send({
      method: 'forwardCDPEvent',
      params: {
        method: 'Target.attachedToTarget',
        params: {
          sessionId,
          targetInfo: { targetId, type: 'page', url, title, tabId, attached: true },
          waitingForDebugger: false,
        },
      },
    });
  }

  /** Unregister a tab (simulates extension detaching debugger) */
  unregisterTab(sessionId: string): void {
    this.send({
      method: 'forwardCDPEvent',
      params: {
        method: 'Target.detachedFromTarget',
        params: { sessionId },
      },
    });
  }

  private send(payload: any): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      throw new Error('Extension not connected');
    }
    this.ws.send(JSON.stringify(payload));
  }

  async close(): Promise<void> {
    if (this.ws) {
      this.ws.close();
      await new Promise<void>((resolve) => {
        this.ws!.on('close', resolve);
        // In case it's already closed
        if (this.ws!.readyState === WebSocket.CLOSED) resolve();
      });
      this.ws = null;
    }
  }
}

/** Wait for a condition with timeout */
async function waitFor(fn: () => boolean, timeoutMs = 5000, intervalMs = 50): Promise<void> {
  const start = Date.now();
  while (!fn()) {
    if (Date.now() - start > timeoutMs) {
      throw new Error(`waitFor timed out after ${timeoutMs}ms`);
    }
    await new Promise((r) => setTimeout(r, intervalMs));
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('ExtensionRelayServer', () => {
  let server: ExtensionRelayServer;
  let port: number;
  let extension: FakeExtension;

  before(async () => {
    // Use a random port to avoid conflicts
    port = 15900 + Math.floor(Math.random() * 100);
    server = new ExtensionRelayServer();
    await server.start(port);
  });

  after(async () => {
    await server.stop();
  });

  beforeEach(async () => {
    extension = new FakeExtension();
    await extension.connect(port);
  });

  afterEach(async () => {
    await extension.close();
    // Wait a moment for the server to process the disconnect
    await new Promise((r) => setTimeout(r, 100));
  });

  describe('target management', () => {
    it('starts with zero connected tabs', () => {
      // Extension is connected but no tabs registered
      assert.strictEqual(server.getConnectedTabsCount(), 0);
      assert.deepStrictEqual(server.getTabMapping(), []);
    });

    it('tracks tab when extension registers one', async () => {
      extension.registerTab('sl-tab-1', 'target-1', 100, 'https://example.com', 'Example');
      await waitFor(() => server.getConnectedTabsCount() === 1);

      const mapping = server.getTabMapping();
      assert.strictEqual(mapping.length, 1);
      assert.strictEqual(mapping[0].sessionId, 'sl-tab-1');
      assert.strictEqual(mapping[0].targetId, 'target-1');
      assert.strictEqual(mapping[0].url, 'https://example.com');
    });

    it('tracks multiple tabs', async () => {
      extension.registerTab('sl-tab-1', 'target-1', 100, 'https://a.com', 'Page A');
      extension.registerTab('sl-tab-2', 'target-2', 101, 'https://b.com', 'Page B');
      await waitFor(() => server.getConnectedTabsCount() === 2);

      const mapping = server.getTabMapping();
      assert.strictEqual(mapping.length, 2);
    });

    it('removes tab when extension unregisters it', async () => {
      extension.registerTab('sl-tab-1', 'target-1', 100, 'https://example.com', 'Example');
      await waitFor(() => server.getConnectedTabsCount() === 1);

      extension.unregisterTab('sl-tab-1');
      await waitFor(() => server.getConnectedTabsCount() === 0);
    });

    it('clears all targets when extension disconnects', async () => {
      extension.registerTab('sl-tab-1', 'target-1', 100, 'https://a.com', 'A');
      extension.registerTab('sl-tab-2', 'target-2', 101, 'https://b.com', 'B');
      await waitFor(() => server.getConnectedTabsCount() === 2);

      await extension.close();
      await waitFor(() => server.getConnectedTabsCount() === 0);
    });

    it('recovers tab tracking after the extension disconnects and reconnects', async () => {
      // Reconnection resilience: a dropped extension must clear cleanly and a
      // fresh connection must register tabs again on the same server.
      extension.registerTab('sl-tab-1', 'target-1', 100, 'https://a.com', 'A');
      await waitFor(() => server.getConnectedTabsCount() === 1);

      await extension.close();
      await waitFor(() => server.getConnectedTabsCount() === 0);

      // Reconnect with a fresh client (afterEach will close this one).
      extension = new FakeExtension();
      await extension.connect(port);
      extension.registerTab('sl-tab-2', 'target-2', 101, 'https://b.com', 'B');
      await waitFor(() => server.getConnectedTabsCount() === 1);

      const mapping = server.getTabMapping();
      assert.strictEqual(mapping.length, 1);
      assert.strictEqual(mapping[0].sessionId, 'sl-tab-2', 'reconnected client tracks new tabs');
    });
  });

  describe('Playwright connectOverCDP', () => {
    let browser: Browser;

    afterEach(async () => {
      if (browser) {
        await browser.close().catch(() => {});
      }
    });

    it('connects with existing tabs and creates Pages', async () => {
      // Register tabs before Playwright connects
      extension.registerTab('sl-tab-1', 'target-1', 100, 'https://a.com', 'Page A');
      extension.registerTab('sl-tab-2', 'target-2', 101, 'https://b.com', 'Page B');
      await waitFor(() => server.getConnectedTabsCount() === 2);

      // Connect Playwright
      browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`, { timeout: 10000 });
      const context = browser.contexts()[0];
      assert.ok(context, 'should have a context');

      const pages = context.pages();
      assert.strictEqual(pages.length, 2, `expected 2 pages, got ${pages.length}`);
    });

    it('discovers new tab registered after connection', async () => {
      // Connect Playwright with no tabs
      browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`, { timeout: 10000 });
      const context = browser.contexts()[0];
      assert.ok(context, 'should have a context');
      assert.strictEqual(context.pages().length, 0, 'should start with 0 pages');

      // Listen for new page
      const pagePromise = new Promise<void>((resolve) => {
        context.on('page', () => resolve());
      });

      // Register a tab — relay should broadcast targetCreated + attachedToTarget
      extension.registerTab('sl-tab-1', 'target-1', 100, 'https://example.com', 'Example');

      // Wait for Playwright to create the Page
      await Promise.race([
        pagePromise,
        new Promise((_, reject) => setTimeout(() => reject(new Error(
          'Timed out waiting for context.on("page") — Playwright did not create a Page for the new target'
        )), 5000)),
      ]);

      assert.strictEqual(context.pages().length, 1, 'should have 1 page after tab registration');
    });

    it('removes Page when tab is unregistered', async () => {
      // Register tab, connect Playwright
      extension.registerTab('sl-tab-1', 'target-1', 100, 'https://example.com', 'Example');
      await waitFor(() => server.getConnectedTabsCount() === 1);

      browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`, { timeout: 10000 });
      const context = browser.contexts()[0];
      assert.strictEqual(context.pages().length, 1);

      // Listen for page close
      const closePromise = new Promise<void>((resolve) => {
        context.pages()[0].on('close', () => resolve());
      });

      // Unregister the tab
      extension.unregisterTab('sl-tab-1');

      await Promise.race([
        closePromise,
        new Promise((_, reject) => setTimeout(() => reject(new Error(
          'Timed out waiting for page close event after tab unregistration'
        )), 5000)),
      ]);

      const openPages = context.pages().filter(p => !p.isClosed());
      assert.strictEqual(openPages.length, 0, 'should have 0 open pages after unregister');
    });

    it('handles multiple tabs registered after connection', async () => {
      browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`, { timeout: 10000 });
      const context = browser.contexts()[0];

      let pageCount = 0;
      context.on('page', () => { pageCount++; });

      // Register two tabs sequentially
      extension.registerTab('sl-tab-1', 'target-1', 100, 'https://a.com', 'A');
      await waitFor(() => pageCount === 1, 5000);

      extension.registerTab('sl-tab-2', 'target-2', 101, 'https://b.com', 'B');
      await waitFor(() => pageCount === 2, 5000);

      assert.strictEqual(context.pages().length, 2);
    });

    it('Page disappears when extension disconnects', async () => {
      extension.registerTab('sl-tab-1', 'target-1', 100, 'https://example.com', 'Example');
      await waitFor(() => server.getConnectedTabsCount() === 1);

      browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`, { timeout: 10000 });
      const context = browser.contexts()[0];
      assert.strictEqual(context.pages().length, 1);

      const closePromise = new Promise<void>((resolve) => {
        context.pages()[0].on('close', () => resolve());
      });

      // Disconnect extension — server should clear targets and broadcast targetDestroyed
      await extension.close();

      await Promise.race([
        closePromise,
        new Promise((_, reject) => setTimeout(() => reject(new Error(
          'Timed out waiting for page close after extension disconnect'
        )), 5000)),
      ]);

      const openPages = context.pages().filter(p => !p.isClosed());
      assert.strictEqual(openPages.length, 0);
    });
  });
});
