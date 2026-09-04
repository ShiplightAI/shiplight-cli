/**
 * Unit tests for action timeout – getActionTimeoutMs helper and org settings support
 */

import assert from 'node:assert';
import { describe, it, mock } from 'node:test';
import { z } from 'zod';
import { ActionEntity } from '../types';
import { ACTION_TIMEOUT, getActionTimeoutMs } from '../utils';
import { ClickAction, ClickToolSchema } from '../impl/click';
import { DoubleClickAction, DoubleClickToolSchema } from '../impl/double_click';
import { RightClickAction, RightClickToolSchema } from '../impl/right_click';
import { HoverToolSchema } from '../impl/hover';
import { InputTextToolSchema } from '../impl/input_text';
import { ClearInputToolSchema } from '../impl/clear_input';
import { SelectDropdownOptionToolSchema } from '../impl/select_dropdown_option';
import { ScrollOnElementToolSchema } from '../impl/scroll_on_element';
import { UploadFileToolSchema, UploadFileToFileInputToolSchema } from '../impl/upload_file';
import { SetDateToolSchema } from '../impl/set_date_for_native_date_picker';

// ---------------------------------------------------------------------------
// getActionTimeoutMs
// ---------------------------------------------------------------------------

describe('getActionTimeoutMs', () => {
  it('should return ACTION_TIMEOUT when no agentServices provided', () => {
    assert.strictEqual(getActionTimeoutMs(), ACTION_TIMEOUT);
  });

  it('should return ACTION_TIMEOUT when agentServices has no action_timeout_ms setting', () => {
    const agentServices = { getActionSettings: () => ({}) };
    assert.strictEqual(getActionTimeoutMs(agentServices), ACTION_TIMEOUT);
  });

  it('should return org setting action_timeout_ms when provided', () => {
    const agentServices = { getActionSettings: () => ({ action_timeout_ms: 30000 }) };
    assert.strictEqual(getActionTimeoutMs(agentServices), 30000);
  });

  it('should return ACTION_TIMEOUT when agentServices is undefined', () => {
    assert.strictEqual(getActionTimeoutMs(undefined), ACTION_TIMEOUT);
  });

  it('should use org setting action_timeout_ms=0 (nullish coalescing)', () => {
    // 0 is falsy but not nullish, so ?? will NOT fall back
    const agentServices = { getActionSettings: () => ({ action_timeout_ms: 0 }) };
    assert.strictEqual(getActionTimeoutMs(agentServices), 0);
  });

  it('should fall back when action_timeout_ms is undefined in org settings', () => {
    const agentServices = { getActionSettings: () => ({ action_timeout_ms: undefined }) };
    assert.strictEqual(getActionTimeoutMs(agentServices), ACTION_TIMEOUT);
  });

  it('should fall back when action_timeout_ms is null in org settings', () => {
    const agentServices = { getActionSettings: () => ({ action_timeout_ms: null }) };
    assert.strictEqual(getActionTimeoutMs(agentServices), ACTION_TIMEOUT);
  });

  it('should use per-statement timeout_ms when provided', () => {
    const agentServices = { getActionSettings: () => ({ action_timeout_ms: 30000 }) };
    assert.strictEqual(getActionTimeoutMs(agentServices, 3000), 3000);
  });

  it('should fall back to org setting when per-statement timeout_ms is undefined', () => {
    const agentServices = { getActionSettings: () => ({ action_timeout_ms: 30000 }) };
    assert.strictEqual(getActionTimeoutMs(agentServices, undefined), 30000);
  });
});

// ---------------------------------------------------------------------------
// ACTION_TIMEOUT constant
// ---------------------------------------------------------------------------

describe('ACTION_TIMEOUT constant', () => {
  it('should be a positive number', () => {
    assert.strictEqual(typeof ACTION_TIMEOUT, 'number');
    assert.ok(ACTION_TIMEOUT > 0);
  });
});

// ---------------------------------------------------------------------------
// ClickAction.execute – uses org setting timeout
// ---------------------------------------------------------------------------

describe('ClickAction.execute – timeout', () => {
  const action = new ClickAction();

  function makeMockPage(recordedTimeouts: number[]) {
    const mockLocator = {
      click: mock.fn(async (opts: any) => { recordedTimeouts.push(opts.timeout); }),
    };
    const page: any = {
      getByRole: () => ({ first: () => mockLocator }),
      waitForTimeout: mock.fn(async () => {}),
    };
    return page;
  }

  function makeMockAgentServices(actionTimeoutMs?: number) {
    return {
      getActionSettings: () => actionTimeoutMs !== undefined ? { action_timeout_ms: actionTimeoutMs } : {},
    } as any;
  }

  it('should use default ACTION_TIMEOUT when no org setting', async () => {
    const timeouts: number[] = [];
    const page = makeMockPage(timeouts);
    const entity: ActionEntity = {
      action_description: 'Click button',
      locator: "getByRole('button', { name: 'Submit' })",
      action_data: { action_name: 'click', kwargs: {} },
    };

    await action.execute(page, entity, makeMockAgentServices());
    assert.strictEqual(timeouts[0], ACTION_TIMEOUT);
  });

  it('should use org setting action_timeout_ms', async () => {
    const timeouts: number[] = [];
    const page = makeMockPage(timeouts);
    const entity: ActionEntity = {
      action_description: 'Click button',
      locator: "getByRole('button', { name: 'Submit' })",
      action_data: { action_name: 'click', kwargs: {} },
    };

    await action.execute(page, entity, makeMockAgentServices(30000));
    assert.strictEqual(timeouts[0], 30000);
  });
});

// ---------------------------------------------------------------------------
// ClickAction.transpile – includes timeout in generated code
// ---------------------------------------------------------------------------

describe('ClickAction.transpile – timeout', () => {
  const action = new ClickAction();

  it('should use default ACTION_TIMEOUT in generated code', () => {
    const entity: ActionEntity = {
      action_description: 'Click button',
      locator: "getByRole('button', { name: 'Submit' })",
      action_data: { action_name: 'click', kwargs: {} },
    };

    const lines = action.transpile(entity);
    const code = lines.join('\n');
    assert(code.includes(`timeout: ${ACTION_TIMEOUT}`), `expected 'timeout: ${ACTION_TIMEOUT}' in: ${code}`);
  });
});

// ---------------------------------------------------------------------------
// ToolSchema regression – all element-based actions expose timeout_ms
// ---------------------------------------------------------------------------

describe('ToolSchema – timeout_ms field', () => {
  const schemasWithTimeoutMs: [string, z.ZodObject<any>][] = [
    ['ClickToolSchema', ClickToolSchema],
    ['DoubleClickToolSchema', DoubleClickToolSchema],
    ['RightClickToolSchema', RightClickToolSchema],
    ['HoverToolSchema', HoverToolSchema],
    ['InputTextToolSchema', InputTextToolSchema],
    ['ClearInputToolSchema', ClearInputToolSchema],
    ['SelectDropdownOptionToolSchema', SelectDropdownOptionToolSchema],
    ['ScrollOnElementToolSchema', ScrollOnElementToolSchema],
    ['UploadFileToolSchema', UploadFileToolSchema],
    ['UploadFileToFileInputToolSchema', UploadFileToFileInputToolSchema],
    ['SetDateToolSchema', SetDateToolSchema],
  ];

  for (const [name, schema] of schemasWithTimeoutMs) {
    it(`${name} should have an optional timeout_ms number field`, () => {
      const shape = schema.shape;
      assert(shape.timeout_ms, `${name} is missing timeout_ms field`);

      // Verify it accepts a number
      assert.strictEqual(schema.safeParse({ ...validMinimalArgs(name), timeout_ms: 15000 }).success, true,
        `${name} should accept timeout_ms as a number`);

      // Verify it's optional (omitting timeout_ms should still parse)
      assert.strictEqual(schema.safeParse(validMinimalArgs(name)).success, true,
        `${name} should parse without timeout_ms`);

      // Verify it rejects non-numbers
      assert.strictEqual(schema.safeParse({ ...validMinimalArgs(name), timeout_ms: 'fast' }).success, false,
        `${name} should reject non-number timeout_ms`);
    });
  }
});

/** Minimal valid args for each schema (just enough to pass required fields) */
function validMinimalArgs(schemaName: string): Record<string, any> {
  switch (schemaName) {
    case 'InputTextToolSchema':
      return { element_index: 0, text: 'hello' };
    case 'SelectDropdownOptionToolSchema':
      return { element_index: 0, option: 'opt1' };
    case 'UploadFileToolSchema':
    case 'UploadFileToFileInputToolSchema':
      return { element_index: 0, paths: '/tmp/file.txt' };
    case 'SetDateToolSchema':
      return { element_index: 0, date: '2026-01-15' };
    default:
      return { element_index: 0 };
  }
}

// ---------------------------------------------------------------------------
// Per-statement kwargs.timeout_ms – execute() integration
// ---------------------------------------------------------------------------

describe('Per-statement kwargs.timeout_ms – execute()', () => {
  function makeMockAgentServices(orgTimeout?: number) {
    return {
      getActionSettings: () => orgTimeout !== undefined ? { action_timeout_ms: orgTimeout } : {},
    } as any;
  }

  it('ClickAction should use kwargs.timeout_ms over org setting', async () => {
    const action = new ClickAction();
    const timeouts: number[] = [];
    const mockLocator = {
      click: mock.fn(async (opts: any) => { timeouts.push(opts.timeout); }),
    };
    const page: any = {
      getByRole: () => ({ first: () => mockLocator }),
      waitForTimeout: mock.fn(async () => {}),
    };
    const entity: ActionEntity = {
      action_description: 'Click button',
      locator: "getByRole('button', { name: 'Submit' })",
      action_data: { action_name: 'click', kwargs: { timeout_ms: 12000 } },
    };

    await action.execute(page, entity, makeMockAgentServices(30000));
    assert.strictEqual(timeouts[0], 12000);
  });

  it('DoubleClickAction should use kwargs.timeout_ms over org setting', async () => {
    const action = new DoubleClickAction();
    const timeouts: number[] = [];
    const mockLocator = {
      dblclick: mock.fn(async (opts: any) => { timeouts.push(opts.timeout); }),
    };
    const page: any = {
      getByRole: () => ({ first: () => mockLocator }),
    };
    const entity: ActionEntity = {
      action_description: 'Double-click button',
      locator: "getByRole('button', { name: 'Submit' })",
      action_data: { action_name: 'double_click', kwargs: { timeout_ms: 8000 } },
    };

    await action.execute(page, entity, makeMockAgentServices(30000));
    assert.strictEqual(timeouts[0], 8000);
  });

  it('RightClickAction should use kwargs.timeout_ms over org setting', async () => {
    const action = new RightClickAction();
    const timeouts: number[] = [];
    const mockLocator = {
      click: mock.fn(async (opts: any) => { timeouts.push(opts.timeout); }),
    };
    const page: any = {
      getByRole: () => ({ first: () => mockLocator }),
    };
    const entity: ActionEntity = {
      action_description: 'Right-click button',
      locator: "getByRole('button', { name: 'Submit' })",
      action_data: { action_name: 'right_click', kwargs: { timeout_ms: 2000 } },
    };

    await action.execute(page, entity, makeMockAgentServices(30000));
    assert.strictEqual(timeouts[0], 2000);
  });
});
