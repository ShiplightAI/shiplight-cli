import { readFile } from 'node:fs/promises';
import * as path from 'node:path';
import { chromium, type Browser, type BrowserContext, type Page, type Worker } from '@playwright/test';

type ConnectOverCdp = (endpoint: string) => Promise<Browser>;

interface ActionChromeApi {
  action?: {
    getPopup(details: Record<string, never>): Promise<string>;
    openPopup(options: { windowId: number }): Promise<void>;
  };
  runtime: { getURL(path: string): string };
  windows: {
    getLastFocused(options: { windowTypes: ['normal'] }): Promise<{ id?: number }>;
    update(windowId: number, options: { focused: true }): Promise<unknown>;
  };
}

/** Open the configured action popup in its real Chrome toolbar surface. */
export async function actionPopupUrl(worker: Worker): Promise<string> {
  return worker.evaluate(async () => {
    const extensionChrome = (globalThis as unknown as { chrome: ActionChromeApi }).chrome;
    if (!extensionChrome.action?.openPopup) {
      throw new Error('chrome.action.openPopup() requires Chrome 127 or newer');
    }
    const configuredPopup = await extensionChrome.action.getPopup({});
    if (!configuredPopup) {
      throw new Error('The extension action has no popup configured for the active tab');
    }
    // Playwright Inspector is its own focused DevTools window. In PWDEBUG=1 it
    // can therefore leave chrome.action.openPopup() with no active *browser*
    // window even though the persistent context has a normal Chrome window.
    // Resolve that window explicitly, focus it, and name it in openPopup so
    // toolbar-popup tests remain debuggable through the Inspector.
    const browserWindow = await extensionChrome.windows.getLastFocused({
      windowTypes: ['normal'],
    });
    if (browserWindow.id === undefined) {
      throw new Error('Could not find a normal Chrome window for the extension action popup');
    }
    let focusError: unknown;
    for (let attempt = 0; attempt < 20; attempt += 1) {
      await extensionChrome.windows.update(browserWindow.id, { focused: true });
      // windows.update() can resolve before macOS has activated the native
      // browser window. Give retries time to observe that transition.
      if (attempt > 0) await new Promise((resolve) => setTimeout(resolve, 100));
      try {
        await extensionChrome.action.openPopup({ windowId: browserWindow.id });
        focusError = undefined;
        break;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (!/inactive window|active browser window/i.test(message)) throw error;
        focusError = error;
      }
    }
    if (focusError !== undefined) throw focusError;
    if (/^[a-z][a-z\d+.-]*:/i.test(configuredPopup)) return configuredPopup;
    return extensionChrome.runtime.getURL(configuredPopup.replace(/^\/+/, ''));
  });
}

/** Find the popup Page attached by a secondary Playwright CDP connection. */
export async function findPageByUrl(browser: Browser, expectedUrl: string, timeoutMs = 10_000): Promise<Page> {
  const deadline = Date.now() + timeoutMs;
  do {
    const page = browser
      .contexts()
      .flatMap((context) => context.pages())
      .find((candidate) => candidate.url() === expectedUrl);
    if (page) return page;
    await new Promise((resolve) => setTimeout(resolve, 50));
  } while (Date.now() < deadline);

  throw new Error(`[fixture] Timed out waiting for extension action popup ${expectedUrl} to appear over CDP.`);
}

async function readCdpEndpoint(profileDir: string, timeoutMs = 10_000): Promise<string> {
  const portFile = path.join(profileDir, 'DevToolsActivePort');
  const deadline = Date.now() + timeoutMs;
  let lastError: unknown;

  do {
    try {
      const [port] = (await readFile(portFile, 'utf8')).trim().split('\n');
      if (port && /^\d+$/.test(port)) return `http://127.0.0.1:${port}`;
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  } while (Date.now() < deadline);

  throw new Error(`[fixture] Could not discover Chromium's CDP endpoint from ${portFile}.`, { cause: lastError });
}

/**
 * Open and attach the extension's real toolbar popup as a standard Playwright
 * Page. A second CDP connection is necessary because Playwright's primary
 * persistent context does not surface action-popup targets in `pages()`.
 */
export async function openActionPopup(
  context: BrowserContext,
  profileDir: string,
  connectOverCdp: ConnectOverCdp = (endpoint) => chromium.connectOverCDP(endpoint),
): Promise<Page> {
  // Make the test's browser window the OS-level activation candidate before
  // the extension worker asks Chrome to open its native toolbar surface.
  await context.pages()[0]?.bringToFront();
  const worker = context.serviceWorkers()[0] ?? (await context.waitForEvent('serviceworker', { timeout: 10_000 }));
  const expectedUrl = await actionPopupUrl(worker);
  const endpoint = await readCdpEndpoint(profileDir);
  const popupBrowser = await connectOverCdp(endpoint);
  return findPageByUrl(popupBrowser, expectedUrl);
}
