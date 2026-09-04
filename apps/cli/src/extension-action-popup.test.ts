import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { Browser, BrowserContext, Page, Worker } from '@playwright/test';
import { actionPopupUrl, findPageByUrl, openActionPopup } from './extension-action-popup.js';

describe('actionPopupUrl', () => {
  it('opens the real action popup from the extension worker and returns its URL', async () => {
    const calls: string[] = [];
    const worker = {
      evaluate: async (fn: () => Promise<string>) => {
        const scope = globalThis as unknown as { chrome?: unknown };
        const previousChrome = scope.chrome;
        scope.chrome = {
          action: {
            getPopup: async () => 'popup.html',
            openPopup: async (options: { windowId: number }) => {
              calls.push(`open:${options.windowId}`);
            },
          },
          windows: {
            getLastFocused: async () => ({ id: 42 }),
            update: async (windowId: number, options: { focused: boolean }) => {
              calls.push(`focus:${windowId}:${options.focused}`);
            },
          },
          runtime: {
            getURL: (path: string) => `chrome-extension://fixture-id/${path}`,
          },
        };
        try {
          return await fn();
        } finally {
          scope.chrome = previousChrome;
        }
      },
    } as unknown as Worker;

    assert.equal(await actionPopupUrl(worker), 'chrome-extension://fixture-id/popup.html');
    assert.deepEqual(calls, ['focus:42:true', 'open:42']);
  });

  it('fails clearly when Chrome has no normal browser window to focus', async () => {
    const worker = {
      evaluate: async (fn: () => Promise<string>) => {
        const scope = globalThis as unknown as { chrome?: unknown };
        const previousChrome = scope.chrome;
        scope.chrome = {
          action: {
            getPopup: async () => 'popup.html',
            openPopup: async () => {
              throw new Error('must not open');
            },
          },
          windows: {
            getLastFocused: async () => ({}),
            update: async () => {
              throw new Error('must not focus');
            },
          },
          runtime: { getURL: (path: string) => `chrome-extension://fixture-id/${path}` },
        };
        try {
          return await fn();
        } finally {
          scope.chrome = previousChrome;
        }
      },
    } as unknown as Worker;

    await assert.rejects(actionPopupUrl(worker), /Could not find a normal Chrome window/);
  });

  it('refocuses and retries when Chrome reports the browser window is still inactive', async () => {
    const calls: string[] = [];
    let openAttempts = 0;
    const worker = {
      evaluate: async (fn: () => Promise<string>) => {
        const scope = globalThis as unknown as { chrome?: unknown };
        const previousChrome = scope.chrome;
        scope.chrome = {
          action: {
            getPopup: async () => 'popup.html',
            openPopup: async ({ windowId }: { windowId: number }) => {
              calls.push(`open:${windowId}`);
              openAttempts += 1;
              if (openAttempts === 1) {
                throw new Error(
                  'Cannot show popup for an inactive window. To show the popup for this window, first call chrome.windows.update with focused set to true.',
                );
              }
            },
          },
          windows: {
            getLastFocused: async () => ({ id: 42 }),
            update: async (windowId: number) => {
              calls.push(`focus:${windowId}`);
            },
          },
          runtime: { getURL: (path: string) => `chrome-extension://fixture-id/${path}` },
        };
        try {
          return await fn();
        } finally {
          scope.chrome = previousChrome;
        }
      },
    } as unknown as Worker;

    assert.equal(await actionPopupUrl(worker), 'chrome-extension://fixture-id/popup.html');
    assert.deepEqual(calls, ['focus:42', 'open:42', 'focus:42', 'open:42']);
  });
});

describe('findPageByUrl', () => {
  it('finds a popup that was attached by a secondary CDP connection', async () => {
    const popup = { url: () => 'chrome-extension://fixture-id/popup.html' } as Page;
    const browser = {
      contexts: () => [{ pages: () => [{ url: () => 'about:blank' }, popup] }],
    } as unknown as Browser;

    assert.equal(await findPageByUrl(browser, 'chrome-extension://fixture-id/popup.html', 20), popup);
  });

  it('times out with the expected URL in the diagnostic', async () => {
    const browser = {
      contexts: () => [{ pages: () => [{ url: () => 'about:blank' }] }],
    } as unknown as Browser;

    await assert.rejects(
      findPageByUrl(browser, 'chrome-extension://fixture-id/popup.html', 1),
      /chrome-extension:\/\/fixture-id\/popup\.html/,
    );
  });
});

describe('openActionPopup', () => {
  it('requires an extension service worker', async () => {
    let broughtToFront = false;
    const context = {
      pages: () => [{ bringToFront: async () => { broughtToFront = true; } }],
      serviceWorkers: () => [],
      waitForEvent: async () => {
        throw new Error('worker timeout');
      },
    } as unknown as BrowserContext;

    await assert.rejects(
      openActionPopup(context, '/tmp/profile', async () => {
        throw new Error('must not connect');
      }),
      /worker timeout/,
    );
    assert.equal(broughtToFront, true);
  });
});
