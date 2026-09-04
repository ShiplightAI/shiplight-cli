import { test, expect } from '@playwright/test';
import { escapeString, sanitizeForComment, getPageLocatorExpression, isAiAction, canSelfHeal } from '../../src/yaml-transpiler';
import type { ActionEntity } from 'shiplight-types';

test.describe('escapeString', () => {
  test('escapes single quotes', () => {
    expect(escapeString("it's")).toBe("it\\'s");
  });

  test('escapes backslashes', () => {
    expect(escapeString('path\\to')).toBe('path\\\\to');
  });

  test('escapes newlines and tabs', () => {
    expect(escapeString('line1\nline2\ttab')).toBe('line1\\nline2\\ttab');
  });
});

test.describe('sanitizeForComment', () => {
  test('replaces newlines with spaces', () => {
    expect(sanitizeForComment('line1\nline2\r\nline3')).toBe('line1 line2 line3');
  });

  test('trims whitespace', () => {
    expect(sanitizeForComment('  hello  ')).toBe('hello');
  });
});

test.describe('getPageLocatorExpression', () => {
  test('uses locator field when present', () => {
    const entity: ActionEntity = {
      action_description: 'Click button',
      locator: "getByRole('button', { name: 'Submit' })",
      action_data: { action_name: 'click', kwargs: {} },
    };
    expect(getPageLocatorExpression(entity)).toBe(
      "page.getByRole('button', { name: 'Submit' }).first()",
    );
  });

  test('does not double-add .first()', () => {
    const entity: ActionEntity = {
      action_description: 'Click',
      locator: "getByText('OK').first()",
      action_data: { action_name: 'click', kwargs: {} },
    };
    expect(getPageLocatorExpression(entity)).toBe("page.getByText('OK').first()");
  });

  test('falls back to xpath', () => {
    const entity: ActionEntity = {
      action_description: 'Click',
      xpath: '//button[@id="submit"]',
      action_data: { action_name: 'click', kwargs: {} },
    };
    const result = getPageLocatorExpression(entity);
    expect(result).toContain('locator');
    expect(result).toContain('xpath=//button[@id');
  });

  test('returns null when no locator or xpath', () => {
    const entity: ActionEntity = {
      action_description: 'Click',
      action_data: { action_name: 'click', kwargs: {} },
    };
    expect(getPageLocatorExpression(entity)).toBeNull();
  });

  test('handles frame_path', () => {
    const entity: ActionEntity = {
      action_description: 'Click',
      locator: "getByText('OK')",
      frame_path: ['iframe#main'],
      action_data: { action_name: 'click', kwargs: {} },
    };
    const result = getPageLocatorExpression(entity);
    expect(result).toContain("page.frameLocator('iframe#main')");
  });
});

test.describe('isAiAction', () => {
  test('returns true for AI actions', () => {
    for (const name of ['verify', 'ai_action', 'ai_step', 'ai_assert', 'ai_extract', 'ai_wait_until']) {
      expect(isAiAction({ action_description: '', action_data: { action_name: name, kwargs: {} } })).toBe(true);
    }
  });

  test('returns false for verify with code (JS mode)', () => {
    expect(isAiAction({
      action_description: '',
      action_data: { action_name: 'verify', kwargs: { code: 'expect(true)' } },
    })).toBe(false);
  });

  test('returns false for non-AI actions', () => {
    expect(isAiAction({ action_description: '', action_data: { action_name: 'click', kwargs: {} } })).toBe(false);
  });
});

test.describe('canSelfHeal', () => {
  test('returns false for non-healable actions', () => {
    for (const name of ['js_code', 'function', 'wait']) {
      expect(canSelfHeal({ action_description: '', action_data: { action_name: name, kwargs: {} } })).toBe(false);
    }
  });

  test('returns true for healable actions', () => {
    expect(canSelfHeal({ action_description: '', action_data: { action_name: 'click', kwargs: {} } })).toBe(true);
    expect(canSelfHeal({ action_description: '', action_data: { action_name: 'input_text', kwargs: {} } })).toBe(true);
  });
});
