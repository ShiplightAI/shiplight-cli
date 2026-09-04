/**
 * Pins the PWDEBUG=console dependency that `@shiplightai/mcp`'s README states
 * (003 FR-011), which had stood as a `[NEEDS CLARIFICATION]` with no test
 * fixing either answer.
 *
 * The dependency is real but it is not fatal: `playwright.generateLocator` is
 * injected into the page only when `PWDEBUG=console` is set, so without it
 * `pickBestLocator` returns null and the entity carries an XPath instead of a
 * semantic locator. The action still replays — it is the *durability* of the
 * locator that degrades (FR-002). That is exactly what the README claims:
 * "Without this, only XPath locators are available."
 *
 * The two shapes are mutually exclusive by construction, which is what makes a
 * captured entity unambiguous on replay.
 */
import { describe, it, mock } from 'node:test';
import assert from 'node:assert/strict';
import type { Page } from 'playwright';

describe('getActionEntityLocatorInfo — semantic locator vs XPath fallback (FR-011)', () => {
  const domElement = {
    xpath: '//button[@id="submit"]',
    shadowHostXPaths: [],
    attributes: {},
    tagName: 'button',
    // Terminates the ancestor walk in getFramePath: no iframe parents, so the
    // frame path is empty and the assertions isolate the locator/xpath choice.
    parent: null,
  };

  // Stand in for the whole locator module so this stays in the deterministic
  // unit lane; `locator.test.ts` covers the module's own decision logic.
  // Mocked once — node:test refuses to mock the same specifier twice — with the
  // return value swapped per case through this closure.
  let generatedLocator: string | null = null;
  mock.module('../dom/utils/locator', {
    namedExports: {
      pickBestLocator: async () => generatedLocator,
      pickBestLocatorForElement: async () => generatedLocator,
      pickBestLocators: async () => new Map(),
    },
  });

  async function locatorInfoWith(generated: string | null) {
    generatedLocator = generated;
    const { getActionEntityLocatorInfo } = await import('./utils.js');
    return getActionEntityLocatorInfo(
      {} as unknown as Page,
      domElement as unknown as Parameters<typeof getActionEntityLocatorInfo>[1],
    );
  }

  it('with PWDEBUG=console: carries the semantic locator and omits the xpath', async () => {
    const info = await locatorInfoWith("getByRole('button', { name: 'Submit' })");

    assert.equal(info.locator, "getByRole('button', { name: 'Submit' })");
    assert.equal(info.xpath, undefined, 'xpath must be omitted when a semantic locator exists');
  });

  it('without PWDEBUG=console: falls back to the xpath and omits the locator', async () => {
    const info = await locatorInfoWith(null);

    assert.equal(info.locator, undefined);
    assert.equal(
      info.xpath,
      '//button[@id="submit"]',
      'the entity must still be replayable when generateLocator is unavailable',
    );
  });

  it('never emits both, so a captured entity is unambiguous on replay', async () => {
    for (const generated of ["getByTestId('go')", null]) {
      const info = await locatorInfoWith(generated);
      assert.equal(
        Boolean(info.locator) && Boolean(info.xpath),
        false,
        'locator and xpath are mutually exclusive',
      );
      assert.ok(info.locator || info.xpath, 'one of the two must always be present');
    }
  });
});
