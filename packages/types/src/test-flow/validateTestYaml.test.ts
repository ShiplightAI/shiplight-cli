import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  validateTestYaml,
  countIntentStatements,
  isBelowCoverageThreshold,
} from './validateTestYaml.js';
import { yamlToTestFlow } from './yamlFlowParser.js';
import { getAllStatementsInOrder } from './statementTreeWalker.js';

describe('validateTestYaml', () => {
  describe('JS syntax validation', () => {
    it('should reject VERIFY js: with regex backslash eaten by YAML double quotes', () => {
      // In YAML double-quoted strings, \/ is an escape for /, so the backslash is silently eaten.
      // This turns /\/member/ into //member/ which is a JS line comment, not a regex.
      const yaml = [
        'name: test',
        'goal: Verify membership page',
        'statements:',
        '  - VERIFY: Membership center page is displayed',
        '    js: "await expect(page).toHaveURL(/\\/member/, { timeout: 5000 })"',
      ].join('\n');

      const result = validateTestYaml(yaml, { coverageThreshold: 0 });
      assert.equal(result.valid, false);
      assert.equal(result.errors.length, 1);
      assert.ok(result.errors[0].includes('Invalid JS'));
    });

    it('should accept VERIFY js: with regex using block scalar', () => {
      // Block scalars (>-) preserve backslashes literally.
      const yaml = [
        'name: test',
        'goal: Verify membership page',
        'statements:',
        '  - VERIFY: Membership center page is displayed',
        '    js: >-',
        '      await expect(page).toHaveURL(/\\/member/, { timeout: 5000 })',
      ].join('\n');

      const result = validateTestYaml(yaml, { coverageThreshold: 0 });
      assert.deepEqual(result.errors, []);
      assert.equal(result.valid, true);
    });

    it('should accept VERIFY js: with properly escaped regex in double quotes', () => {
      // Double backslash in YAML double-quoted string: \\/ → \/
      const yaml = [
        'name: test',
        'goal: Verify membership page',
        'statements:',
        '  - VERIFY: Membership center page is displayed',
        '    js: "await expect(page).toHaveURL(/\\\\/member/, { timeout: 5000 })"',
      ].join('\n');

      const result = validateTestYaml(yaml, { coverageThreshold: 0 });
      assert.deepEqual(result.errors, []);
      assert.equal(result.valid, true);
    });

    it('should reject CODE: block with invalid syntax', () => {
      const yaml = [
        'name: test',
        'goal: test',
        'statements:',
        '  - CODE: "const re = /\\/bad/"',
      ].join('\n');

      const result = validateTestYaml(yaml, { coverageThreshold: 0 });
      assert.equal(result.valid, false);
      assert.ok(result.errors.some(e => e.includes('Invalid JS')));
    });

    it('should accept CODE: block with valid syntax', () => {
      const yaml = [
        'name: test',
        'goal: test',
        'statements:',
        '  - CODE: "console.log(1 + 2)"',
      ].join('\n');

      const result = validateTestYaml(yaml, { coverageThreshold: 0 });
      assert.deepEqual(result.errors, []);
    });

    it('should reject a WAIT_UNTIL sibling js: with invalid syntax', () => {
      const yaml = [
        'name: test',
        'goal: test',
        'statements:',
        '  - WAIT_UNTIL: The dashboard has loaded',
        '    js: "document.querySelector(("',
      ].join('\n');

      const result = validateTestYaml(yaml, { coverageThreshold: 0 });
      assert.equal(result.valid, false);
      assert.ok(result.errors.some(e => e.includes('Invalid JS in WAIT_UNTIL condition')));
    });

    it('should accept a valid WAIT_UNTIL sibling js: and not JS-validate the intent', () => {
      const yaml = [
        'name: test',
        'goal: test',
        'statements:',
        // The intent has unbalanced parens — it must be treated as a label, not JS.
        '  - WAIT_UNTIL: The dashboard (main view has loaded',
        '    js: "(await page.locator(\'.spinner\').count()) === 0"',
      ].join('\n');

      const result = validateTestYaml(yaml, { coverageThreshold: 0 });
      assert.deepEqual(result.errors, []);
      assert.equal(result.valid, true);
    });

    it('should reject a WAIT_UNTIL js: condition with invalid syntax', () => {
      const yaml = [
        'name: test',
        'goal: test',
        'statements:',
        '  - WAIT_UNTIL: "js:document.querySelector(("',
      ].join('\n');

      const result = validateTestYaml(yaml, { coverageThreshold: 0 });
      assert.equal(result.valid, false);
      assert.ok(result.errors.some(e => e.includes('Invalid JS in WAIT_UNTIL condition')));
    });

    it('should accept a valid WAIT_UNTIL js: condition', () => {
      const yaml = [
        'name: test',
        'goal: test',
        'statements:',
        "  - WAIT_UNTIL: \"js:!document.querySelector('.spinner')\"",
      ].join('\n');

      const result = validateTestYaml(yaml, { coverageThreshold: 0 });
      assert.deepEqual(result.errors, []);
      assert.equal(result.valid, true);
    });

    it('should not JS-validate a natural-language WAIT_UNTIL (gated on condition_type)', () => {
      // Unbalanced parens would fail JS syntax validation, but an AI_MODE
      // condition must never be treated as JS.
      const yaml = [
        'name: test',
        'goal: test',
        'statements:',
        '  - WAIT_UNTIL: a modal ((( is visible',
      ].join('\n');

      const result = validateTestYaml(yaml, { coverageThreshold: 0 });
      assert.deepEqual(result.errors, []);
      assert.equal(result.valid, true);
    });
  });

  describe('JS cache complexity cap', () => {
    it('accepts a one-line VERIFY js: cache', () => {
      const yaml = [
        'goal: simple verify',
        'statements:',
        '  - VERIFY: button is visible',
        '    js: "await expect(page.getByRole(\'button\')).toBeVisible()"',
      ].join('\n');

      const result = validateTestYaml(yaml, { coverageThreshold: 0 });
      assert.deepEqual(result.errors, []);
      assert.equal(result.valid, true);
    });

    it('accepts VERIFY js: at exactly the 5-line / 3-await limit', () => {
      const yaml = [
        'goal: at the limit',
        'statements:',
        '  - VERIFY: page state is correct',
        '    js: |',
        '      const url = page.url();',
        '      await expect(page).toHaveURL(/dashboard/);',
        '      await expect(page.getByRole("heading")).toBeVisible();',
        '      const text = await page.locator(".title").innerText();',
        '      console.log(url, text);',
      ].join('\n');

      const result = validateTestYaml(yaml, { coverageThreshold: 0 });
      assert.deepEqual(result.errors, []);
      assert.equal(result.valid, true);
    });

    it('rejects VERIFY js: with 6 meaningful lines', () => {
      const yaml = [
        'goal: too many lines',
        'statements:',
        '  - VERIFY: dashboard fully loaded',
        '    js: |',
        '      const url = page.url();',
        '      console.log(url);',
        '      const heading = page.getByRole("heading");',
        '      const sidebar = page.getByRole("navigation");',
        '      const footer = page.getByRole("contentinfo");',
        '      console.log(heading, sidebar, footer);',
      ].join('\n');

      const result = validateTestYaml(yaml, { coverageThreshold: 0 });
      assert.equal(result.valid, false);
      const tooComplex = result.errors.find(e => e.includes('too complex'));
      assert.ok(tooComplex, `expected complexity error, got: ${JSON.stringify(result.errors)}`);
      assert.ok(tooComplex.includes('6 non-blank line'), tooComplex);
      assert.ok(tooComplex.includes('Break this into multiple'), tooComplex);
    });

    it('rejects VERIFY js: with too many awaits even on one line (anti-collapse)', () => {
      // Single line, but 4 awaits — should be split despite being short.
      const yaml = [
        'goal: too many awaits',
        'statements:',
        '  - VERIFY: full page check',
        '    js: "await page.waitForLoadState(); await expect(page).toHaveURL(/dash/); await expect(page.getByRole(\'heading\')).toBeVisible(); await expect(page.getByRole(\'navigation\')).toBeVisible()"',
      ].join('\n');

      const result = validateTestYaml(yaml, { coverageThreshold: 0 });
      assert.equal(result.valid, false);
      const tooComplex = result.errors.find(e => e.includes('too complex'));
      assert.ok(tooComplex);
      assert.ok(tooComplex.includes('4 await'), tooComplex);
    });

    it('ignores blank lines and // comments when counting cache lines', () => {
      // 5 meaningful lines + 2 blanks + 1 comment = at the 5-line cap, 3 awaits = at the await cap.
      const yaml = [
        'goal: with whitespace',
        'statements:',
        '  - VERIFY: things look right',
        '    js: |',
        '      // sanity check before assertions',
        '      const url = page.url();',
        '',
        '      await expect(page).toHaveURL(/dashboard/);',
        '      await expect(page.getByRole("heading")).toBeVisible();',
        '',
        '      const txt = await page.locator(".title").innerText();',
        '      console.log(url, txt);',
      ].join('\n');

      const result = validateTestYaml(yaml, { coverageThreshold: 0 });
      assert.deepEqual(result.errors, []);
    });

    it('does not count `await` keywords inside // commented lines', () => {
      // Regression for bot-reported inconsistency: the line counter strips
      // single-line // comments, so the await counter must too — otherwise a
      // commented-out `await` increments the count for a line that was already
      // excluded. Here: 3 meaningful lines, 3 awaits after filtering (the
      // fourth `await` is in a // comment). Should pass.
      const yaml = [
        'goal: commented-out await',
        'statements:',
        '  - VERIFY: things look right',
        '    js: |',
        '      // await page.waitForLoadState();',
        '      await expect(page).toHaveURL(/dash/);',
        '      const x = await page.locator(".a").innerText();',
        '      await expect(page.getByRole("heading")).toBeVisible();',
      ].join('\n');

      const result = validateTestYaml(yaml, { coverageThreshold: 0 });
      assert.deepEqual(result.errors, []);
    });

    it('rejects intent: + js: (raw js no longer self-heals)', () => {
      const yaml = [
        'goal: rejected intent+js',
        'statements:',
        '  - intent: Log in as test user',
        '    js: "await page.click(\'button[type=submit]\')"',
      ].join('\n');

      const result = validateTestYaml(yaml, { coverageThreshold: 0 });
      assert.equal(result.valid, false);
      const parseErr = result.errors.find(e => e.includes('Invalid YAML'));
      assert.ok(parseErr, `expected parse error, got: ${JSON.stringify(result.errors)}`);
      assert.match(parseErr, /description:.*does not self-heal/i);
    });

    it('does NOT cap description: + js: blocks (freeform escape hatch)', () => {
      // 10 lines, 6 awaits — well over the verify limit, but allowed for the js_code escape hatch.
      const yaml = [
        'goal: long code block',
        'statements:',
        '  - description: Long setup block',
        '    js: |',
        '      await page.goto("https://example.com");',
        '      await page.click("#a");',
        '      await page.click("#b");',
        '      await page.click("#c");',
        '      await page.click("#d");',
        '      await page.fill("#e", "x");',
        '      const v = page.locator(".v");',
        '      const w = page.locator(".w");',
        '      const x = page.locator(".x");',
        '      console.log(v, w, x);',
      ].join('\n');

      const result = validateTestYaml(yaml, { coverageThreshold: 0 });
      assert.deepEqual(result.errors, []);
      assert.equal(result.valid, true);
    });

    it('does NOT cap flat action: verify when invoked without a js cache', () => {
      // Pure AI-evaluated verify (no kwargs.code) — nothing to cap.
      const yaml = [
        'goal: AI verify',
        'statements:',
        '  - VERIFY: dashboard looks healthy',
      ].join('\n');

      const result = validateTestYaml(yaml, { coverageThreshold: 0 });
      assert.deepEqual(result.errors, []);
    });

    it('rejects the real-world listing-detail PDP verify (10 lines, 5 awaits)', () => {
      // From an actual coding-agent output: a single VERIFY: js: block that
      // hides "check href pattern + navigate + dismiss popup + assert" — exactly
      // the multi-step complexity the cap is meant to catch. The short
      // description+js cookies-dismiss above it (escape hatch, exempt) and the
      // simple first VERIFY should still pass, so we get exactly one complexity error.
      const yaml = [
        'name: Listing card opens a valid PDP',
        "goal: From a populated search results page, the first listing card links to a /rooms/<id> URL that loads a valid PDP (Save-to-wishlist button visible).",
        'tags: [airbnb, listing, pdp, p0]',
        '',
        'statements:',
        '  - URL: /s/Miami--FL--United-States/homes',
        '',
        '  - description: Dismiss the cookies banner if it is present',
        '    js: |',
        "      const accept = page.getByRole('button', { name: 'Accept all' });",
        '      if (await accept.isVisible({ timeout: 3000 }).catch(() => false)) {',
        '        await accept.click().catch(() => {});',
        '      }',
        '',
        '  - VERIFY: At least one listing card is visible on the results page',
        '    js: "await expect(page.getByTestId(\'card-container\').first()).toBeVisible({ timeout: 15000 })"',
        '',
        "  - VERIFY: The first listing card's link points to a /rooms/<id> URL and that URL loads a valid PDP with the Save-to-wishlist button visible",
        '    js: |',
        "      const firstCardLink = page.getByTestId('card-container').first().locator('a').first();",
        "      const href = await firstCardLink.getAttribute('href');",
        "      if (!href) throw new Error('First listing card has no href attribute');",
        '      expect(href).toMatch(/\\/rooms\\/[0-9]+/i);',
        '      await page.goto(href);',
        "      const translateClose = page.getByTestId('translation-announce-modal').getByRole('button', { name: 'Close' });",
        '      if (await translateClose.isVisible({ timeout: 3000 }).catch(() => false)) {',
        '        await translateClose.click().catch(() => {});',
        '      }',
        "      await expect(page.getByTestId('pdp-save-button-unsaved')).toBeVisible({ timeout: 15000 });",
      ].join('\n');

      const result = validateTestYaml(yaml, { coverageThreshold: 0 });
      assert.equal(result.valid, false);

      const complexityErrors = result.errors.filter(e => e.includes('too complex'));
      assert.equal(
        complexityErrors.length, 1,
        `expected exactly one complexity error, got: ${JSON.stringify(result.errors)}`
      );
      const err = complexityErrors[0];
      // Description should identify which VERIFY failed
      assert.ok(err.includes("first listing card's link"), err);
      // Both line and await metrics should be reported
      assert.ok(err.match(/\b10 non-blank line/), err);
      assert.ok(err.match(/\b5 await/), err);
    });

    it('reports both syntax and complexity errors independently', () => {
      // Bad regex escape — syntax error fires; complexity check should be skipped
      // (we don't want to pile a complexity warning on top of broken JS).
      const yaml = [
        'name: t',
        'goal: t',
        'statements:',
        '  - VERIFY: huge cache, also broken',
        '    js: "await expect(page).toHaveURL(/\\/x/); await a(); await b(); await c(); await d(); await e()"',
      ].join('\n');

      const result = validateTestYaml(yaml, { coverageThreshold: 0 });
      assert.equal(result.valid, false);
      assert.ok(result.errors.some(e => e.includes('Invalid JS')));
      assert.equal(result.errors.filter(e => e.includes('too complex')).length, 0);
    });
  });

  describe('cloud template reference rejection', () => {
    it('should reject STEP with reference_id (unresolved cloud template)', () => {
      const yaml = [
        'name: test',
        'goal: test',
        'statements:',
        '  - STEP: Login flow',
        '    reference_id: 42',
        '    statements:',
        '      - intent: Click login',
        '        action: click',
        '        locator: "getByRole(\'button\', { name: \'Login\' })"',
      ].join('\n');

      const result = validateTestYaml(yaml, { coverageThreshold: 0 });
      assert.equal(result.valid, false);
      assert.ok(
        result.errors.some(e => e.includes('reference_id') && e.includes('42')),
        `expected reference_id error, got: ${JSON.stringify(result.errors)}`
      );
    });
  });

  describe('action coverage stats', () => {
    it('should count only intent-based actions and drafts, not shorthands', () => {
      // Modeled after airbnb/search.test.yaml: URL, WAIT_UNTIL, VERIFY are shorthands,
      // intent+action are interaction ACTIONs
      const yaml = [
        'goal: Search for listings',
        'statements:',
        '  - URL: https://www.airbnb.com',
        '    timeout_seconds: 20',
        '  - WAIT_UNTIL: Search results are visible',
        '    timeout_seconds: 15',
        '  - intent: Click the destination search input',
        '    action: click',
        '    locator: "getByTestId(\'search-input\')"',
        '  - intent: Type San Francisco',
        '    action: input_text',
        '    locator: "getByTestId(\'search-input\')"',
        '    text: San Francisco',
        '  - VERIFY: Results appear',
        '    js: "await expect(page.locator(\'.results\')).toBeVisible()"',
      ].join('\n');

      const result = validateTestYaml(yaml, { coverageThreshold: 0 });
      assert.equal(result.stats.total, 2);
      assert.equal(result.stats.action, 2);
      assert.equal(result.stats.draft, 0);
      assert.equal(result.stats.coverage, 100);
    });

    it('should count bare intent as draft', () => {
      const yaml = [
        'goal: Test with drafts',
        'statements:',
        '  - intent: Click the login button',
        '  - intent: Fill in the email field',
        '  - intent: Submit the form',
        '    action: click',
        '    locator: "getByRole(\'button\', { name: \'Submit\' })"',
      ].join('\n');

      const result = validateTestYaml(yaml, { coverageThreshold: 0 });
      assert.equal(result.stats.total, 3);
      assert.equal(result.stats.action, 1);
      assert.equal(result.stats.draft, 2);
      assert.equal(result.stats.coverage, 33);
    });

    it('should exclude CODE, WAIT, and other non-intent shorthands', () => {
      // Modeled after airbnb/filters.test.yaml structure
      const yaml = [
        'goal: Filter results',
        'statements:',
        '  - CODE: "await page.goto(\'https://example.com\')"',
        '  - WAIT_UNTIL: Page is loaded',
        '    timeout_seconds: 30',
        '  - WAIT: Wait for animation',
        '    seconds: 3',
        '  - intent: Click the filter button',
        '    action: click',
        '    locator: "getByTestId(\'filter-btn\')"',
        '  - intent: Set the max price',
        '    action: input_text',
        '    locator: "locator(\'#price_max\')"',
        '    text: "300"',
        '  - VERIFY: Filter count updates',
        '    js: "await expect(page.locator(\'.count\')).toBeVisible()"',
      ].join('\n');

      const result = validateTestYaml(yaml, { coverageThreshold: 0 });
      assert.equal(result.stats.total, 2);
      assert.equal(result.stats.action, 2);
      assert.equal(result.stats.draft, 0);
      assert.equal(result.stats.coverage, 100);
    });

    it('should exclude description+js (js_code) from coverage, like CODE', () => {
      const yaml = [
        'goal: Test js escape hatch',
        'statements:',
        '  - description: Mock the API',
        '    js: "await page.route(\'**/api\', r => r.abort())"',
        '  - intent: Click the button',
        '    action: click',
        '    locator: "getByRole(\'button\')"',
        '  - intent: Fill the form manually',
      ].join('\n');

      const result = validateTestYaml(yaml, { coverageThreshold: 0 });
      // description+js (js_code) is a non-intent shorthand → excluded from counts
      assert.equal(result.stats.total, 2);
      assert.equal(result.stats.action, 1);
      assert.equal(result.stats.draft, 1);
      assert.equal(result.stats.coverage, 50);
    });

    it('should warn when coverage is below threshold', () => {
      const yaml = [
        'goal: Mostly drafts',
        'statements:',
        '  - intent: Click login',
        '  - intent: Enter email',
        '  - intent: Enter password',
        '  - intent: Submit form',
        '    action: click',
        '    locator: "getByRole(\'button\')"',
      ].join('\n');

      const result = validateTestYaml(yaml);
      assert.equal(result.stats.total, 4);
      assert.equal(result.stats.action, 1);
      assert.equal(result.stats.draft, 3);
      assert.equal(result.stats.coverage, 25);
      assert.ok(result.warnings.length > 0);
      assert.ok(result.warnings[0].includes('Low action coverage'));
    });

    it('should not warn when all intents are enriched', () => {
      const yaml = [
        'goal: All enriched',
        'statements:',
        '  - URL: https://example.com',
        '  - intent: Click button',
        '    action: click',
        '    locator: "getByRole(\'button\')"',
        '  - intent: Type text',
        '    action: input_text',
        '    locator: "getByLabel(\'Email\')"',
        '    text: test@test.com',
        '  - VERIFY: Page loaded',
        '    js: "await expect(page).toHaveURL(/dashboard/)"',
      ].join('\n');

      const result = validateTestYaml(yaml);
      assert.equal(result.stats.total, 2);
      assert.equal(result.stats.action, 2);
      assert.equal(result.stats.draft, 0);
      assert.equal(result.stats.coverage, 100);
      assert.equal(result.warnings.length, 0);
    });
  });

  describe('countIntentStatements (shared with computeFlowStats)', () => {
    // These tests verify countIntentStatements via yamlToTestFlow + getAllStatementsInOrder,
    // the same code path that TestCaseTools.computeFlowStats uses. Results are compared
    // against validateTestYaml to ensure both paths produce identical counts.

    function countFromYaml(yaml: string) {
      const flow = yamlToTestFlow(yaml);
      const allStatements = [
        ...getAllStatementsInOrder(flow.statements ?? []),
        ...(flow.teardown ? getAllStatementsInOrder(flow.teardown) : []),
      ];
      return countIntentStatements(allStatements);
    }

    it('search flow: all intent+action, no drafts (airbnb/search pattern)', () => {
      const yaml = [
        'goal: Search for listings',
        'statements:',
        '  - URL: https://www.airbnb.com',
        '    timeout_seconds: 20',
        '  - IF: A modal dialog popup is visible',
        '    THEN:',
        '      - intent: Click Got it to dismiss modal',
        '        action: click',
        "        locator: \"getByRole('button', { name: 'Got it' })\"",
        '  - intent: Click the destination search input',
        '    action: click',
        "    locator: \"getByTestId('structured-search-input-field-query')\"",
        '  - intent: Type San Francisco into the destination field',
        '    action: input_text',
        "    locator: \"getByTestId('structured-search-input-field-query')\"",
        '    text: San Francisco, CA',
        '  - WAIT_UNTIL: Autocomplete suggestions appear',
        '    timeout_seconds: 15',
        '  - intent: Select the first autocomplete suggestion',
        '    action: click',
        "    locator: \"getByTestId('option-0')\"",
        '  - WAIT_UNTIL: Date picker calendar is open',
        '    timeout_seconds: 15',
        '  - intent: Select April 3 as check-in date',
        '    action: click',
        "    locator: \"getByRole('button', { name: '3, Friday, April 2026.' })\"",
        '  - intent: Select April 6 as check-out date',
        '    action: click',
        "    locator: \"getByRole('button', { name: '6, Monday, April 2026.' })\"",
        '  - intent: Click the Search button',
        '    action: click',
        "    locator: \"getByTestId('structured-search-input-search-button')\"",
        '  - WAIT_UNTIL: Search results loaded',
        '    timeout_seconds: 30',
        '  - VERIFY: At least one listing card is visible',
        '    js: "await expect(page.locator(\'[data-testid=card-container]\').first()).toBeVisible()"',
      ].join('\n');

      const counts = countFromYaml(yaml);
      assert.equal(counts.action, 7);
      assert.equal(counts.draft, 0);

      // Verify consistency with validateTestYaml
      const validation = validateTestYaml(yaml, { coverageThreshold: 0 });
      assert.equal(validation.stats.action, counts.action);
      assert.equal(validation.stats.draft, counts.draft);
    });

    it('filters flow: CODE, WAIT, VERIFY excluded (airbnb/filters pattern)', () => {
      const yaml = [
        'goal: Filter search results by max price',
        'statements:',
        '  - CODE: "await page.goto(\'https://www.airbnb.com/s/San-Francisco\')"',
        '  - WAIT_UNTIL: Search results listing cards are visible',
        '    timeout_seconds: 30',
        '  - IF: A modal dialog popup is visible',
        '    THEN:',
        '      - intent: Click Got it to dismiss modal',
        '        action: click',
        "        locator: \"getByRole('button', { name: 'Got it' })\"",
        '  - intent: Click the Filters button',
        '    action: click',
        "    locator: \"getByTestId('category-bar-filter-button')\"",
        '  - WAIT: Wait for the filters modal',
        '    seconds: 3',
        '  - intent: Scroll down inside the filter panel',
        '    action: scroll_on_element',
        "    locator: \"getByTestId('modal-container')\"",
        '    delta_y: 500',
        '  - intent: Click the maximum price container',
        '    action: click',
        "    locator: \"locator('#price_filter_max').locator('..')\"",
        '  - intent: Set the maximum price to $300',
        '    action: input_text',
        "    locator: \"locator('#price_filter_max')\"",
        '    text: "300"',
        '  - intent: Press Tab to confirm price',
        '    action: press',
        '    keys: Tab',
        '  - WAIT: Wait for filter count to update',
        '    seconds: 4',
        '  - VERIFY: Filter panel shows Show X places',
        '    js: "await expect(page.locator(\'a\').first()).toBeVisible()"',
        '  - intent: Click the Show places link',
        '    action: click',
        "    locator: \"locator('a').filter({ hasText: 'Show' }).first()\"",
        '  - VERIFY: Listing cards are visible',
        '    js: "await expect(page.locator(\'[data-testid=card-container]\').first()).toBeVisible()"',
      ].join('\n');

      const counts = countFromYaml(yaml);
      // 7 intent+action: dismiss modal, Filters btn, scroll, price container, input price, Tab, Show places
      assert.equal(counts.action, 7);
      assert.equal(counts.draft, 0);

      const validation = validateTestYaml(yaml, { coverageThreshold: 0 });
      assert.equal(validation.stats.action, counts.action);
      assert.equal(validation.stats.draft, counts.draft);
    });

    it('listing detail flow: mixed with drafts (airbnb/listing-detail pattern)', () => {
      const yaml = [
        'goal: View listing detail page',
        'statements:',
        '  - CODE: "await page.goto(\'https://www.airbnb.com/s/San-Francisco\')"',
        '  - WAIT_UNTIL: Search results are visible',
        '    timeout_seconds: 30',
        '  - intent: Click the Save to wishlist button',
        '    action: click',
        "    locator: \"getByTestId('pdp-save-button-unsaved')\"",
        '  - intent: Press Escape to close login modal',
        '    action: press',
        '    keys: Escape',
        '  - intent: Click the Share button',
        '    action: click',
        "    locator: \"getByRole('button', { name: 'Share' })\"",
        '  - intent: Press Escape to close share dialog',
        '    action: press',
        '    keys: Escape',
        '  - intent: Open the photo gallery',
        '  - intent: Close the photo gallery',
        '  - intent: Scroll down to reveal sticky nav',
        '    action: scroll_on_element',
        "    locator: \"locator('body')\"",
        '    delta_y: 3000',
        '  - VERIFY: Booking widget is visible',
        '    js: "await expect(page.getByTestId(\'book-it-default\')).toBeVisible()"',
      ].join('\n');

      const counts = countFromYaml(yaml);
      assert.equal(counts.action, 5);
      assert.equal(counts.draft, 2);

      const validation = validateTestYaml(yaml, { coverageThreshold: 0 });
      assert.equal(validation.stats.action, counts.action);
      assert.equal(validation.stats.draft, counts.draft);
      assert.equal(validation.stats.total, 7);
      assert.equal(validation.stats.coverage, 71);
    });
  });
});

describe('isBelowCoverageThreshold', () => {
  const stats = (action: number, draft: number) => ({
    total: action + draft,
    action,
    draft,
    coverage:
      action + draft > 0 ? Math.round((action / (action + draft)) * 100) : 0,
  });

  it('agrees with the warning validateTestYaml emits, so a verdict cannot contradict the message', () => {
    // The whole point of FR-013: strict callers must not be able to reach a
    // different conclusion than the warning text the same run produced.
    const yaml = [
      'name: test',
      'goal: Log in',
      'statements:',
      '  - intent: Click login',
      '  - intent: Type the email',
      '  - intent: Submit',
      '    action: click',
      "    locator: \"getByRole('button')\"",
    ].join('\n');

    const result = validateTestYaml(yaml);
    const warned = result.warnings.some((w) => w.startsWith('Low action coverage'));

    assert.equal(warned, true, 'expected the validator to warn on 1/3 coverage');
    assert.equal(isBelowCoverageThreshold(result.stats), warned);
  });

  it('returns false at exactly the threshold — 50% passes, it is a floor not a target', () => {
    assert.equal(isBelowCoverageThreshold(stats(1, 1)), false);
  });

  it('returns true just below the threshold', () => {
    assert.equal(isBelowCoverageThreshold(stats(2, 3)), true);
  });

  it('returns false for an empty flow rather than dividing by zero', () => {
    // A file with no intent statements is not "0% covered" — there is nothing
    // to cover. Reporting a shortfall here would fail suites made entirely of
    // shorthands (VERIFY/URL), which carry no drafts by construction.
    assert.equal(isBelowCoverageThreshold(stats(0, 0)), false);
  });

  it('returns false when stats are absent (validation bailed before counting)', () => {
    assert.equal(isBelowCoverageThreshold(undefined), false);
  });

  it('honours an explicit threshold', () => {
    assert.equal(isBelowCoverageThreshold(stats(9, 1), 0.95), true);
    assert.equal(isBelowCoverageThreshold(stats(9, 1), 0.9), false);
  });
});
