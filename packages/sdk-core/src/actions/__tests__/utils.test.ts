/**
 * Unit tests for action utility functions
 */

import assert from 'node:assert';
import { describe, it } from 'node:test';
import { ActionEntity } from '../types';
import { getLocator, getMinimalActionEntity, getPageLocatorExpression } from '../utils';

describe('Locator Utility Functions', () => {
  describe('getPageLocatorExpression', () => {
    it('should use locator field with .first() appended', () => {
      const entity: ActionEntity = {
        action_description: 'Test',
        locator: "getByRole('button', { name: 'Submit' })",
        xpath: '//button[@type="submit"]',
        action_data: { action_name: 'click', kwargs: {} },
      };

      const expr = getPageLocatorExpression(entity);
      assert.strictEqual(expr, "page.getByRole('button', { name: 'Submit' }).first()");
    });

    it('should not double-append .first() if already present', () => {
      const entity: ActionEntity = {
        action_description: 'Test',
        locator: "getByRole('button').first()",
        action_data: { action_name: 'click', kwargs: {} },
      };

      const expr = getPageLocatorExpression(entity);
      assert.strictEqual(expr, "page.getByRole('button').first()");
    });

    it('should fall back to xpath when locator is absent', () => {
      const entity: ActionEntity = {
        action_description: 'Test',
        xpath: '//button[@type="submit"]',
        action_data: { action_name: 'click', kwargs: {} },
      };

      const expr = getPageLocatorExpression(entity);
      assert.strictEqual(expr, 'page.locator("xpath=//button[@type=\\"submit\\"]").first()');
    });

    it('should return null when no locator or xpath', () => {
      const entity: ActionEntity = {
        action_description: 'Test',
        action_data: { action_name: 'click', kwargs: {} },
      };

      const expr = getPageLocatorExpression(entity);
      assert.strictEqual(expr, null);
    });
  });

  describe('getLocator with frame_path', () => {
    it('should include frameLocator in expression', () => {
      const entity: ActionEntity = {
        action_description: 'Test',
        frame_path: ['iframe#myframe'],
        locator: "getByRole('button', { name: 'Submit' })",
        action_data: { action_name: 'click', kwargs: {} },
      };

      const expr = getPageLocatorExpression(entity);
      assert.strictEqual(expr, "page.frameLocator('iframe#myframe').getByRole('button', { name: 'Submit' }).first()");
    });

    it('should use xpath in frame when locator not present', () => {
      const entity: ActionEntity = {
        action_description: 'Test',
        frame_path: ['iframe#myframe'],
        xpath: '//button',
        action_data: { action_name: 'click', kwargs: {} },
      };

      const expr = getPageLocatorExpression(entity);
      assert.strictEqual(expr, 'page.frameLocator(\'iframe#myframe\').locator("xpath=//button").first()');
    });
  });

  describe('getLocator dynamic execution', () => {
    it('should execute locator expression against page', () => {
      const entity: ActionEntity = {
        action_description: 'Test',
        locator: "locator('#submit')",
        action_data: { action_name: 'click', kwargs: {} },
      };

      // Create mock that matches what the expression will call
      const mockLocator = { first: () => mockLocator };
      const mockPage = {
        locator: (selector: string) => mockLocator,
      };

      const result = getLocator(mockPage, entity);
      assert(result !== null, 'should return a locator');
    });

    it('should return null when no locator fields', () => {
      const entity: ActionEntity = {
        action_description: 'Test',
        action_data: { action_name: 'click', kwargs: {} },
      };

      const result = getLocator({}, entity);
      assert.strictEqual(result, null);
    });
  });

  describe('getMinimalActionEntity', () => {
    it('should always include action_data with action_name (required for dispatch)', () => {
      const entity: ActionEntity = {
        action_description: 'Click button',
        feedback: '',
        locator: 'button.submit',
        action_data: {
          action_name: 'click',
          kwargs: {},
        },
      };

      const minimal = getMinimalActionEntity(entity);

      // CRITICAL: action_data must always be present for actionHandler.execute() to dispatch
      assert(minimal.action_data, 'action_data must be present');
      assert.strictEqual(minimal.action_data?.action_name, 'click', 'action_name must be present for dispatch');
    });

    it('should include only action_data and locator fields', () => {
      const fullEntity: ActionEntity = {
        action_description: 'Click submit button',
        feedback: 'some feedback',
        locator: 'button.submit',
        xpath: '//button[@type="submit"]',
        action_data: {
          action_name: 'click',
          kwargs: { foo: 'bar' },
        },
      };

      const minimal = getMinimalActionEntity(fullEntity);

      // Should include action_data and locator fields
      assert(minimal.action_data);
      assert.strictEqual(minimal.action_data?.action_name, 'click');
      assert.strictEqual(minimal.locator, 'button.submit');
      assert.strictEqual(minimal.xpath, '//button[@type="submit"]');

      // Should NOT include metadata fields
      assert.strictEqual(minimal.action_description, undefined);
      assert.strictEqual(minimal.feedback, undefined);
    });

    it('should include frame_path when present', () => {
      const entityWithFrame: ActionEntity = {
        action_description: 'Test',
        feedback: '',
        frame_path: ['iframe#myframe'],
        action_data: {
          action_name: 'click',
          kwargs: {},
        },
      };

      const minimal = getMinimalActionEntity(entityWithFrame);

      assert(minimal.frame_path);
      assert.strictEqual(minimal.frame_path![0], 'iframe#myframe');
    });

    it('should handle entity with only action_data', () => {
      const minimalEntity: ActionEntity = {
        action_description: 'Test',
        feedback: '',
        action_data: {
          action_name: 'wait',
          kwargs: { timeout: 1000 },
        },
      };

      const minimal = getMinimalActionEntity(minimalEntity);

      // Should have action_data
      assert(minimal.action_data);
      assert.strictEqual(minimal.action_data?.action_name, 'wait');

      // Should not have locator fields
      assert.strictEqual(minimal.locator, undefined);
      assert.strictEqual(minimal.xpath, undefined);
      assert.strictEqual(minimal.frame_path, undefined);
    });
  });
});
