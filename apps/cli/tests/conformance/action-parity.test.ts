/**
 * Conformance tests: verify that playwright action transpilers produce
 * the same output as sdk-core's IAction.transpile() methods.
 *
 * This catches unintentional drift between the two copies.
 * Only plain values are used (no {{VAR}} patterns) since variable
 * interpolation is an intentional enhancement in the playwright version.
 */

import { test, expect } from '@playwright/test';
import type { ActionEntity } from 'shiplight-types';
import { getActionTranspiler } from '../../src/yaml-transpiler/actions';

// sdk-core's ActionHandler gives us access to the original transpile() methods
import { ActionHandler } from 'sdk-core';

const handler = new ActionHandler();

/**
 * The playwright transpiler intentionally uses a shorter default action
 * timeout (5s) than sdk-core (10s) — see commit b5c351fb2 ("reduce default
 * action timeout to 5s"). That divergence is by design, so we normalize
 * timeout values before comparing. Any *other* drift (locator strategy,
 * method name, argument shape, ordering) still fails the comparison.
 */
function normalizeTimeouts(lines: string[]): string[] {
  return lines.map((line) => line.replace(/timeout: \d+/g, 'timeout: <N>'));
}

/**
 * Compare the transpile output from both implementations, tolerating only the
 * intentional default-timeout divergence.
 * sdk-core: action.transpile(entity, stepId)
 * playwright: getActionTranspiler(name)(entity, stepId)
 */
function compareTranspile(
  actionName: string,
  entity: ActionEntity,
  stepId: string = 'test.0',
) {
  const sdkAction = handler.getAction(actionName);
  const pwTranspiler = getActionTranspiler(actionName);

  if (!sdkAction) {
    throw new Error(`sdk-core has no action registered for "${actionName}"`);
  }
  if (!pwTranspiler) {
    throw new Error(`playwright has no transpiler registered for "${actionName}"`);
  }

  const sdkOutput = normalizeTimeouts(sdkAction.transpile(entity, stepId));
  const pwOutput = normalizeTimeouts(pwTranspiler(entity, stepId));

  return { sdkOutput, pwOutput };
}

function makeEntity(
  actionName: string,
  kwargs: Record<string, any> = {},
  overrides: Partial<ActionEntity> = {},
): ActionEntity {
  return {
    action_description: `Test ${actionName}`,
    action_data: { action_name: actionName, kwargs },
    ...overrides,
  };
}

test.describe('action transpiler parity with sdk-core', () => {

  // ===== Click actions =====

  test('click - with locator', () => {
    const entity = makeEntity('click', {}, {
      locator: "getByRole('button', { name: 'Submit' })",
    });
    const { sdkOutput, pwOutput } = compareTranspile('click', entity);
    expect(pwOutput).toEqual(sdkOutput);
  });

  test('click - without locator', () => {
    const entity = makeEntity('click');
    const { sdkOutput, pwOutput } = compareTranspile('click', entity);
    expect(pwOutput).toEqual(sdkOutput);
  });

  test('click - with xpath', () => {
    const entity = makeEntity('click', {}, {
      xpath: '//button[@id="submit"]',
    });
    const { sdkOutput, pwOutput } = compareTranspile('click', entity);
    expect(pwOutput).toEqual(sdkOutput);
  });

  test('click - with frame_path', () => {
    const entity = makeEntity('click', {}, {
      locator: "getByText('OK')",
      frame_path: ['iframe#main'],
    });
    const { sdkOutput, pwOutput } = compareTranspile('click', entity);
    expect(pwOutput).toEqual(sdkOutput);
  });

  // ===== Double click =====

  test('double_click', () => {
    const entity = makeEntity('double_click', {}, {
      locator: "getByText('Item')",
    });
    const { sdkOutput, pwOutput } = compareTranspile('double_click', entity);
    expect(pwOutput).toEqual(sdkOutput);
  });

  // ===== Right click =====

  test('right_click', () => {
    const entity = makeEntity('right_click', {}, {
      locator: "getByText('File')",
    });
    const { sdkOutput, pwOutput } = compareTranspile('right_click', entity);
    expect(pwOutput).toEqual(sdkOutput);
  });

  // ===== Hover =====

  test('hover', () => {
    const entity = makeEntity('hover', {}, {
      locator: "getByText('Menu')",
    });
    const { sdkOutput, pwOutput } = compareTranspile('hover', entity);
    expect(pwOutput).toEqual(sdkOutput);
  });

  // ===== Input text =====

  test('input_text - with locator', () => {
    const entity = makeEntity('input_text', { text: 'hello world' }, {
      locator: "getByLabel('Email')",
    });
    const { sdkOutput, pwOutput } = compareTranspile('input_text', entity);
    expect(pwOutput).toEqual(sdkOutput);
  });

  test('input_text - with xpath', () => {
    const entity = makeEntity('input_text', { text: 'test' }, {
      xpath: '//input[@id="email"]',
    });
    const { sdkOutput, pwOutput } = compareTranspile('input_text', entity);
    expect(pwOutput).toEqual(sdkOutput);
  });

  test('input_text - with frame_path', () => {
    const entity = makeEntity('input_text', { text: 'framed' }, {
      locator: "getByLabel('Name')",
      frame_path: ['iframe#form'],
    });
    const { sdkOutput, pwOutput } = compareTranspile('input_text', entity);
    expect(pwOutput).toEqual(sdkOutput);
  });

  // ===== Clear input =====

  test('clear_input', () => {
    const entity = makeEntity('clear_input', {}, {
      locator: "getByLabel('Email')",
    });
    const { sdkOutput, pwOutput } = compareTranspile('clear_input', entity);
    expect(pwOutput).toEqual(sdkOutput);
  });

  // ===== Press =====

  test('press', () => {
    const entity = makeEntity('press', { keys: 'Enter' });
    const { sdkOutput, pwOutput } = compareTranspile('press', entity);
    expect(pwOutput).toEqual(sdkOutput);
  });

  test('press - key combination', () => {
    const entity = makeEntity('press', { keys: 'Control+a' });
    const { sdkOutput, pwOutput } = compareTranspile('press', entity);
    expect(pwOutput).toEqual(sdkOutput);
  });

  // ===== Send keys on element =====

  test('send_keys_on_element - with locator', () => {
    const entity = makeEntity('send_keys_on_element', { keys: 'Tab' }, {
      locator: "getByLabel('Name')",
    });
    const { sdkOutput, pwOutput } = compareTranspile('send_keys_on_element', entity);
    expect(pwOutput).toEqual(sdkOutput);
  });

  test('send_keys_on_element - without locator', () => {
    const entity = makeEntity('send_keys_on_element', { keys: 'Escape' });
    const { sdkOutput, pwOutput } = compareTranspile('send_keys_on_element', entity);
    expect(pwOutput).toEqual(sdkOutput);
  });

  // ===== Select dropdown =====

  test('select_dropdown_option', () => {
    const entity = makeEntity('select_dropdown_option', { text: 'Option A' }, {
      locator: "getByRole('combobox')",
    });
    const { sdkOutput, pwOutput } = compareTranspile('select_dropdown_option', entity);
    expect(pwOutput).toEqual(sdkOutput);
  });

  // ===== Scroll actions =====

  test('scroll - down', () => {
    const entity = makeEntity('scroll', { down: true, num_pages: 2 });
    const { sdkOutput, pwOutput } = compareTranspile('scroll', entity);
    expect(pwOutput).toEqual(sdkOutput);
  });

  test('scroll - up', () => {
    const entity = makeEntity('scroll', { down: false, num_pages: 1 });
    const { sdkOutput, pwOutput } = compareTranspile('scroll', entity);
    expect(pwOutput).toEqual(sdkOutput);
  });

  test('scroll_to_text', () => {
    const entity = makeEntity('scroll_to_text', { text: 'Footer' });
    const { sdkOutput, pwOutput } = compareTranspile('scroll_to_text', entity);
    expect(pwOutput).toEqual(sdkOutput);
  });

  // ===== Navigation =====

  test('go_to_url', () => {
    const entity = makeEntity('go_to_url', { url: 'https://example.com' });
    const { sdkOutput, pwOutput } = compareTranspile('go_to_url', entity);
    expect(pwOutput).toEqual(sdkOutput);
  });

  test('go_to_url - new tab', () => {
    const entity = makeEntity('go_to_url', { url: 'https://example.com', new_tab: true });
    const { sdkOutput, pwOutput } = compareTranspile('go_to_url', entity);
    expect(pwOutput).toEqual(sdkOutput);
  });

  test('go_back', () => {
    const entity = makeEntity('go_back');
    const { sdkOutput, pwOutput } = compareTranspile('go_back', entity);
    expect(pwOutput).toEqual(sdkOutput);
  });

  test('reload_page', () => {
    const entity = makeEntity('reload_page');
    const { sdkOutput, pwOutput } = compareTranspile('reload_page', entity);
    expect(pwOutput).toEqual(sdkOutput);
  });

  // ===== Wait actions =====

  test('wait', () => {
    const entity = makeEntity('wait', { seconds: 3 });
    const { sdkOutput, pwOutput } = compareTranspile('wait', entity);
    expect(pwOutput).toEqual(sdkOutput);
  });

  test('wait_for_page_ready', () => {
    const entity = makeEntity('wait_for_page_ready');
    const { sdkOutput, pwOutput } = compareTranspile('wait_for_page_ready', entity);
    expect(pwOutput).toEqual(sdkOutput);
  });

  // ===== AI actions =====

  test('verify - AI mode', () => {
    const entity = makeEntity('verify', { statement: 'User is logged in' });
    const { sdkOutput, pwOutput } = compareTranspile('verify', entity, 'main.3');
    expect(pwOutput).toEqual(sdkOutput);
    expect(pwOutput.join('\n')).not.toContain('replaceStepScreenshot');
  });

  test('verify - JS mode', () => {
    const entity = makeEntity('verify', { code: 'expect(true).toBe(true);' });
    const { sdkOutput, pwOutput } = compareTranspile('verify', entity);
    expect(pwOutput).toEqual(sdkOutput);
    expect(pwOutput.join('\n')).toContain('await agent.replaceStepScreenshot(page, "test.0");');
    expect(pwOutput.join('\n')).toContain('finally {');
  });

  test('verify - JS-only mode replaces the screenshot without adding an AI fallback', () => {
    const entity = makeEntity(
      'verify',
      { code: 'expect(true).toBe(true);' },
      { action_description: '' },
    );
    const { sdkOutput, pwOutput } = compareTranspile('verify', entity, 'main.4');
    const output = pwOutput.join('\n');

    expect(pwOutput).toEqual(sdkOutput);
    expect(output).toContain('await agent.replaceStepScreenshot(page, "main.4");');
    expect(output).toContain('finally {');
    expect(output).not.toContain('agent.assert');
  });

  test('verify - both code and statement (try/catch fallback)', () => {
    const entity = makeEntity('verify', {
      statement: 'Button is visible',
      code: "await expect(page.getByRole('button')).toBeVisible()",
    });
    const { sdkOutput, pwOutput } = compareTranspile('verify', entity, 'main.2');
    expect(pwOutput).toEqual(sdkOutput);
    // Verify the try/catch structure:
    // Outer `{ const _t = Date.now(); try { ... } catch { ... agent.assert ... } }`
    // The `} }` closes the catch block and the outer VERIFY timing/logging wrapper.
    expect(pwOutput[0]).toContain('try {');
    expect(pwOutput[pwOutput.length - 2]).toContain('agent.assert');
    expect(pwOutput[pwOutput.length - 1]).toBe('} }');
    expect(pwOutput.join('\n')).toContain('await agent.replaceStepScreenshot(page, "main.2");');
    expect(pwOutput.findIndex((line) => line.includes('replaceStepScreenshot')))
      .toBeLessThan(pwOutput.findIndex((line) => line.includes('agent.assert')));
  });

  test('ai_action', () => {
    const entity = makeEntity('ai_action', { statement: 'Click the blue button' });
    const { sdkOutput, pwOutput } = compareTranspile('ai_action', entity, 'main.1');
    expect(pwOutput).toEqual(sdkOutput);
  });

  test('ai_step', () => {
    const entity = makeEntity('ai_step', { statement: 'Fill the login form' });
    const { sdkOutput, pwOutput } = compareTranspile('ai_step', entity, 'main.2');
    expect(pwOutput).toEqual(sdkOutput);
  });

  test('ai_extract', () => {
    const entity = makeEntity('ai_extract', {
      element_description: 'The total price',
      variable_name: 'total',
    });
    const { sdkOutput, pwOutput } = compareTranspile('ai_extract', entity, 'main.4');
    expect(pwOutput).toEqual(sdkOutput);
  });

  test('ai_wait_until', () => {
    const entity = makeEntity('ai_wait_until', {
      condition: 'Loading spinner disappears',
      timeout_seconds: 30,
    });
    const { sdkOutput, pwOutput } = compareTranspile('ai_wait_until', entity, 'main.5');
    expect(pwOutput).toEqual(sdkOutput);
  });

  // ===== Utility actions =====

  test('save_variable', () => {
    const entity = makeEntity('save_variable', { name: 'token', value: 'abc123' });
    const { sdkOutput, pwOutput } = compareTranspile('save_variable', entity);
    expect(pwOutput).toEqual(sdkOutput);
  });

  test('js_code', () => {
    const entity = makeEntity('js_code', { code: 'console.log("hello");\nconsole.log("world");' });
    const { sdkOutput, pwOutput } = compareTranspile('js_code', entity);
    expect(pwOutput).toEqual(sdkOutput);
  });

  test('function - simple call', () => {
    const entity = makeEntity('function', {
      functionName: 'myHelper',
      args: ['page'],
    });
    const { sdkOutput, pwOutput } = compareTranspile('function', entity);
    expect(pwOutput).toEqual(sdkOutput);
  });

  test('function - with string params', () => {
    const entity = makeEntity('function', {
      functionName: 'createUser',
      args: ['page', 'user@test.com'],
    });
    const { sdkOutput, pwOutput } = compareTranspile('function', entity);
    expect(pwOutput).toEqual(sdkOutput);
  });

  test('function - no params', () => {
    const entity = makeEntity('function', { functionName: 'cleanup' });
    const { sdkOutput, pwOutput } = compareTranspile('function', entity);
    expect(pwOutput).toEqual(sdkOutput);
  });

  test('function - missing name', () => {
    const entity = makeEntity('function', {});
    const { sdkOutput, pwOutput } = compareTranspile('function', entity);
    expect(pwOutput).toEqual(sdkOutput);
  });

  // ===== Tab actions =====

  test('switch_tab', () => {
    const entity = makeEntity('switch_tab', { tab_index: 1 });
    const { sdkOutput, pwOutput } = compareTranspile('switch_tab', entity);
    expect(pwOutput).toEqual(sdkOutput);
  });

  test('close_tab', () => {
    const entity = makeEntity('close_tab');
    const { sdkOutput, pwOutput } = compareTranspile('close_tab', entity);
    expect(pwOutput).toEqual(sdkOutput);
  });

  // ===== File actions =====

  test('upload_file', () => {
    const entity = makeEntity('upload_file', { file_path: '/tmp/test.pdf' }, {
      locator: "getByLabel('Upload')",
    });
    const { sdkOutput, pwOutput } = compareTranspile('upload_file', entity);
    expect(pwOutput).toEqual(sdkOutput);
  });

  test('wait_for_download_complete', () => {
    const entity = makeEntity('wait_for_download_complete');
    const { sdkOutput, pwOutput } = compareTranspile('wait_for_download_complete', entity);
    expect(pwOutput).toEqual(sdkOutput);
  });

  // ===== Other actions =====

  test('done', () => {
    const entity = makeEntity('done');
    const { sdkOutput, pwOutput } = compareTranspile('done', entity);
    expect(pwOutput).toEqual(sdkOutput);
  });

  test('generate_2fa_code', () => {
    const entity = makeEntity('generate_2fa_code', { secret: 'JBSWY3DPEHPK3PXP' });
    const { sdkOutput, pwOutput } = compareTranspile('generate_2fa_code', entity);
    expect(pwOutput).toEqual(sdkOutput);
  });

  test('set_date_for_native_date_picker', () => {
    const entity = makeEntity('set_date_for_native_date_picker', { date: '2026-01-15' }, {
      locator: "getByLabel('Date')",
    });
    const { sdkOutput, pwOutput } = compareTranspile('set_date_for_native_date_picker', entity);
    expect(pwOutput).toEqual(sdkOutput);
  });

  test('click_by_coordinates - absolute', () => {
    const entity = makeEntity('click_by_coordinates', { x: 100, y: 200 });
    const { sdkOutput, pwOutput } = compareTranspile('click_by_coordinates', entity);
    expect(pwOutput).toEqual(sdkOutput);
  });

  test('click_by_coordinates - relative with locator', () => {
    const entity = makeEntity('click_by_coordinates', { relative_x: 10, relative_y: -5 }, {
      locator: "getByRole('button')",
    });
    const { sdkOutput, pwOutput } = compareTranspile('click_by_coordinates', entity);
    expect(pwOutput).toEqual(sdkOutput);
  });

  test('right_click_by_coordinates', () => {
    const entity = makeEntity('right_click_by_coordinates', { x: 50, y: 75 });
    const { sdkOutput, pwOutput } = compareTranspile('right_click_by_coordinates', entity);
    expect(pwOutput).toEqual(sdkOutput);
  });

  test('double_click_by_coordinates', () => {
    const entity = makeEntity('double_click_by_coordinates', { x: 50, y: 75 });
    const { sdkOutput, pwOutput } = compareTranspile('double_click_by_coordinates', entity);
    expect(pwOutput).toEqual(sdkOutput);
  });

  test('drag_drop - with coords', () => {
    const entity = makeEntity('drag_drop', { coord_source_x: 10, coord_source_y: 20, coord_target_x: 100, coord_target_y: 200 });
    const { sdkOutput, pwOutput } = compareTranspile('drag_drop', entity);
    expect(pwOutput).toEqual(sdkOutput);
  });

  test('drag_drop - relative with locator', () => {
    const entity = makeEntity('drag_drop', { relative_x: 5, relative_y: 5, delta_x: 50, delta_y: 0 }, {
      locator: "getByRole('listitem')",
    });
    const { sdkOutput, pwOutput } = compareTranspile('drag_drop', entity);
    expect(pwOutput).toEqual(sdkOutput);
  });

  test('get_dropdown_options - with xpath', () => {
    const entity = makeEntity('get_dropdown_options', {}, { xpath: '//select' });
    const { sdkOutput, pwOutput } = compareTranspile('get_dropdown_options', entity);
    expect(pwOutput).toEqual(sdkOutput);
  });

  test('get_dropdown_options - no locator', () => {
    const entity = makeEntity('get_dropdown_options', {});
    const { sdkOutput, pwOutput } = compareTranspile('get_dropdown_options', entity);
    expect(pwOutput).toEqual(sdkOutput);
  });

  // ===== Legacy aliases =====

  test('click_element (legacy alias)', () => {
    const entity = makeEntity('click', {}, {
      locator: "getByText('Link')",
    });
    const { sdkOutput, pwOutput } = compareTranspile('click_element', entity);
    expect(pwOutput).toEqual(sdkOutput);
  });

  test('send_keys (legacy alias for press)', () => {
    const entity = makeEntity('press', { keys: 'Escape' });
    const { sdkOutput, pwOutput } = compareTranspile('send_keys', entity);
    expect(pwOutput).toEqual(sdkOutput);
  });

  test('fill (legacy alias for input_text)', () => {
    const entity = makeEntity('input_text', { text: 'hello' }, {
      locator: "getByLabel('Name')",
    });
    const { sdkOutput, pwOutput } = compareTranspile('fill', entity);
    expect(pwOutput).toEqual(sdkOutput);
  });

  test('ai_assert (legacy alias for verify)', () => {
    const entity = makeEntity('verify', { statement: 'Page loaded' });
    const { sdkOutput, pwOutput } = compareTranspile('ai_assert', entity, 'main.0');
    expect(pwOutput).toEqual(sdkOutput);
  });

  // ===== Coverage check =====

  test('playwright covers all sdk-core actions', () => {
    const sdkActions = new Set(handler.getActionNames());

    const missing: string[] = [];
    for (const actionName of sdkActions) {
      if (!getActionTranspiler(actionName)) {
        missing.push(actionName);
      }
    }

    expect(missing).toEqual([]);
  });
});
