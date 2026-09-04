import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { convertPlaywrightActionToEntity, extractLocatorFromCode } from "./playwrightUtils.js";

describe("extractLocatorFromCode", () => {
  it("preserves CSS selectors containing descendant combinators and dots", () => {
    const locator = extractLocatorFromCode(
      "await page.locator('.parent > .child').click()",
    );

    assert.equal(locator, "locator('.parent > .child')");
  });

  it("preserves chained Playwright locators before the terminal action", () => {
    const locator = extractLocatorFromCode(
      "await page.getByRole('button').filter({ hasText: 'Submit' }).click()",
    );

    assert.equal(locator, "getByRole('button').filter({ hasText: 'Submit' })");
  });
});

describe("convertPlaywrightActionToEntity", () => {
  it("does not treat a Playwright locator expression as unique_selector", () => {
    const actionEntity = convertPlaywrightActionToEntity(
      {
        name: "click",
      },
      "await page.getByRole('button', { name: 'Submit' }).click()",
    );

    assert.equal(actionEntity.locator, "getByRole('button', { name: 'Submit' })");
    assert.equal(actionEntity.unique_selector, "");
  });

  it("preserves a recorder-provided selector as unique_selector", () => {
    const actionEntity = convertPlaywrightActionToEntity(
      {
        name: "click",
        selector: "[data-testid='submit']",
      },
      "await page.locator(\"[data-testid='submit']\").click()",
    );

    assert.equal(actionEntity.unique_selector, "[data-testid='submit']");
  });

  it("maps recorder screenshots to a wait utility step", () => {
    const actionEntity = convertPlaywrightActionToEntity(
      {
        name: "screenshot",
      },
      "await page.screenshot()",
    );

    assert.equal(actionEntity.action_data?.action_name, "wait");
    assert.equal(actionEntity.action_description, "Take screenshot");
    assert.deepEqual(actionEntity.action_data?.kwargs, { seconds: 0.5 });
  });
});
