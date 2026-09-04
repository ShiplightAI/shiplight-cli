import { afterEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium, type BrowserContext } from '@playwright/test';
import { openActionPopup } from './extension-action-popup.js';
import { buildExtensionArgs, buildPersistentChromiumArgs } from './extension-helpers.js';

describe('extension action popup browser integration', () => {
  const dirsToClean: string[] = [];
  let context: BrowserContext | undefined;

  afterEach(async () => {
    await context?.close().catch(() => {});
    context = undefined;
    for (const dir of dirsToClean.splice(0)) {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('exposes the real toolbar popup as a standard Playwright Page', async () => {
    const extensionDir = mkdtempSync(join(tmpdir(), 'shiplight-popup-extension-'));
    const profileDir = mkdtempSync(join(tmpdir(), 'shiplight-popup-profile-'));
    dirsToClean.push(extensionDir, profileDir);

    writeFileSync(
      join(extensionDir, 'manifest.json'),
      JSON.stringify({
        manifest_version: 3,
        name: 'Shiplight popup fixture',
        version: '1.0.0',
        background: { service_worker: 'background.js' },
        action: { default_popup: 'popup.html' },
      }),
    );
    writeFileSync(join(extensionDir, 'background.js'), 'globalThis.popupFixtureLoaded = true;');
    writeFileSync(
      join(extensionDir, 'popup.html'),
      '<!doctype html><html><body><h1>Real action popup</h1></body></html>',
    );

    context = await chromium.launchPersistentContext(profileDir, {
      headless: false,
      args: buildPersistentChromiumArgs(buildExtensionArgs(extensionDir)),
    });

    const popup = await openActionPopup(context, profileDir);

    assert.equal(await popup.getByRole('heading').textContent(), 'Real action popup');
    assert.equal(
      context.pages().some((page) => page === popup),
      false,
    );
  });
});
