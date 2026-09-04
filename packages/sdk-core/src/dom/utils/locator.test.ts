/**
 * Locator computation tests (001 FR-002, SC-003).
 *
 * These cover the self-healing-locator promise: an element-targeted action must
 * carry a semantic locator when Playwright can generate one, and must degrade to
 * a usable XPath locator when it cannot. Before this file the module had no test
 * and nothing in the repo imported it.
 *
 * The page-bound functions are exercised against hand-built stubs rather than a
 * real browser so they run in the deterministic `test:unit` lane. What they pin
 * is the module's own decision logic — frame resolution, the null paths, handle
 * disposal, and the PWDEBUG fallback — not Playwright's behaviour.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { ElementHandle, Page } from 'playwright';
import {
  pickBestLocator,
  pickBestLocators,
  isLocatorGeneratorAvailable,
  getFallbackLocator,
} from './locator';

/** Minimal element handle that records whether it was disposed. */
function stubHandle(): { handle: ElementHandle<Element>; disposed: () => boolean } {
  let disposed = false;
  const handle = {
    dispose: async () => {
      disposed = true;
    },
  } as unknown as ElementHandle<Element>;
  return { handle, disposed: () => disposed };
}

/**
 * A page whose `locator(...).elementHandle()` resolves to `handle`, and whose
 * `evaluate` returns `generated` — the value `playwright.generateLocator(el)`
 * would produce, or null when PWDEBUG=console is not set.
 */
function stubPage(opts: {
  handle: ElementHandle<Element> | null;
  generated: string | null;
  onEvaluate?: () => void;
}): Page {
  return {
    locator: () => ({
      elementHandle: async () => opts.handle,
      locator: () => ({ elementHandle: async () => opts.handle }),
    }),
    evaluate: async () => {
      opts.onEvaluate?.();
      return opts.generated;
    },
    frames: () => [],
  } as unknown as Page;
}

describe('getFallbackLocator', () => {
  it('wraps an xpath into an xpath= locator Playwright accepts', () => {
    assert.equal(getFallbackLocator('//button[@id="go"]'), 'xpath=//button[@id="go"]');
  });

  it('passes the xpath through verbatim — no escaping, no normalisation', () => {
    // The fallback is the durability net behind a semantic locator (FR-002).
    // Rewriting the xpath here would silently change which element replays.
    const gnarly = '(//div[@class="a b"]//span[contains(text(),"x")])[2]';
    assert.equal(getFallbackLocator(gnarly), `xpath=${gnarly}`);
  });
});

describe('pickBestLocator', () => {
  it('returns the generated semantic locator when Playwright can produce one', async () => {
    const { handle } = stubHandle();
    const page = stubPage({ handle, generated: "getByRole('button', { name: 'Submit' })" });

    const locator = await pickBestLocator(page, '//button[1]');

    assert.equal(locator, "getByRole('button', { name: 'Submit' })");
  });

  it('returns null — not a guess — when generateLocator is unavailable', async () => {
    // This is the PWDEBUG=console path (003 FR-011). Without it the injected
    // `playwright` global is absent, evaluate yields null, and the caller is
    // expected to fall back to the xpath rather than receive a fabricated
    // semantic locator.
    const { handle } = stubHandle();
    const page = stubPage({ handle, generated: null });

    assert.equal(await pickBestLocator(page, '//button[1]'), null);
  });

  it('returns null when the element cannot be found', async () => {
    const page = stubPage({ handle: null, generated: 'ignored' });

    assert.equal(await pickBestLocator(page, '//missing'), null);
  });

  it('disposes the element handle even on the fallback path', async () => {
    // A long-lived MCP server calls this per located action; a leaked handle
    // pins a DOM node in the browser process for the life of the session.
    const { handle, disposed } = stubHandle();
    const page = stubPage({ handle, generated: null });

    await pickBestLocator(page, '//button[1]');

    assert.equal(disposed(), true);
  });

  it('swallows an evaluate failure and returns null rather than throwing', async () => {
    const { handle } = stubHandle();
    const page = stubPage({
      handle,
      generated: null,
      onEvaluate: () => {
        throw new Error('execution context destroyed');
      },
    });

    assert.equal(await pickBestLocator(page, '//button[1]'), null);
  });
});

describe('pickBestLocators', () => {
  it('maps every requested xpath, including the ones that resolve to null', async () => {
    const { handle } = stubHandle();
    const page = stubPage({ handle, generated: null });

    const result = await pickBestLocators(page, ['//a[1]', '//a[2]']);

    // Callers index this map by xpath; a dropped key reads as "not requested"
    // rather than "no semantic locator available".
    assert.deepEqual([...result.keys()].sort(), ['//a[1]', '//a[2]']);
    assert.equal(result.get('//a[1]'), null);
  });

  it('returns an empty map for an empty input', async () => {
    const { handle } = stubHandle();
    const page = stubPage({ handle, generated: null });

    assert.equal((await pickBestLocators(page, [])).size, 0);
  });
});

describe('isLocatorGeneratorAvailable', () => {
  it('reports what the page evaluation says', async () => {
    const yes = { evaluate: async () => true } as unknown as Page;
    const no = { evaluate: async () => false } as unknown as Page;

    assert.equal(await isLocatorGeneratorAvailable(yes), true);
    assert.equal(await isLocatorGeneratorAvailable(no), false);
  });

  it('reports false when the page cannot be evaluated at all', async () => {
    const closed = {
      evaluate: async () => {
        throw new Error('Target page, context or browser has been closed');
      },
    } as unknown as Page;

    assert.equal(await isLocatorGeneratorAvailable(closed), false);
  });
});
