/**
 * Unit tests for normalizeOpenAIAction — shape normalization for the GA
 * `computer` tool (gpt-5.4) action objects.
 */

import assert from 'node:assert';
import { describe, it } from 'node:test';
import { normalizeOpenAIAction } from '../openaiActionShape';

describe('normalizeOpenAIAction', () => {
  describe('click actions', () => {
    it('normalizes a left click with coordinates', () => {
      const result = normalizeOpenAIAction({ type: 'click', x: 100, y: 200, button: 'left' });
      assert.deepStrictEqual(result, {
        type: 'click',
        x: 100,
        y: 200,
        button: 'left',
        path: undefined,
      });
    });

    it('normalizes a right click', () => {
      const result = normalizeOpenAIAction({ type: 'click', x: 50, y: 60, button: 'right' });
      assert.strictEqual(result.button, 'right');
      assert.strictEqual(result.type, 'click');
    });

    it('preserves double_click type', () => {
      const result = normalizeOpenAIAction({ type: 'double_click', x: 1, y: 2 });
      assert.strictEqual(result.type, 'double_click');
      assert.strictEqual(result.x, 1);
      assert.strictEqual(result.y, 2);
    });
  });

  describe('drag paths', () => {
    it('normalizes tuple-array path (GA format)', () => {
      const result = normalizeOpenAIAction({
        type: 'drag',
        path: [[482, 478], [520, 540], [590, 620], [960, 765]],
      });
      assert.strictEqual(result.type, 'drag');
      assert.deepStrictEqual(result.path, [
        { x: 482, y: 478 },
        { x: 520, y: 540 },
        { x: 590, y: 620 },
        { x: 960, y: 765 },
      ]);
    });

    it('normalizes object-array path (also documented by GA)', () => {
      const result = normalizeOpenAIAction({
        type: 'drag',
        path: [{ x: 10, y: 20 }, { x: 30, y: 40 }],
      });
      assert.deepStrictEqual(result.path, [
        { x: 10, y: 20 },
        { x: 30, y: 40 },
      ]);
    });

    it('handles single-point path (mapper will reject it, but shape must survive)', () => {
      const result = normalizeOpenAIAction({ type: 'drag', path: [[100, 200]] });
      assert.deepStrictEqual(result.path, [{ x: 100, y: 200 }]);
    });

    it('handles empty path as empty array, not undefined', () => {
      const result = normalizeOpenAIAction({ type: 'drag', path: [] });
      assert.deepStrictEqual(result.path, []);
    });

    it('filters out points with non-numeric coordinates', () => {
      // A point with a null/string coordinate used to silently become
      // {x: 0, y: 200}, producing a mis-aimed drag at the top-left corner.
      // Now such points are dropped entirely.
      const result = normalizeOpenAIAction({
        type: 'drag',
        path: [
          [100, 200],
          [null, 300],
          ['bad', 400],
          [500, 600],
        ],
      });
      assert.deepStrictEqual(result.path, [
        { x: 100, y: 200 },
        { x: 500, y: 600 },
      ]);
    });

    it('filters out points containing NaN or Infinity', () => {
      // typeof NaN === 'number' is true, so without Number.isFinite guarding,
      // a NaN point would pass through and produce a drag at (0, 0).
      const result = normalizeOpenAIAction({
        type: 'drag',
        path: [
          [100, 200],
          [NaN, 250],
          [300, Infinity],
          [-Infinity, 400],
          [500, 600],
        ],
      });
      assert.deepStrictEqual(result.path, [
        { x: 100, y: 200 },
        { x: 500, y: 600 },
      ]);
    });

    it('filters out object-shape points missing a coordinate', () => {
      const result = normalizeOpenAIAction({
        type: 'drag',
        path: [
          { x: 10, y: 20 },
          { x: 30 },
          { y: 40 },
          { x: 50, y: 60 },
        ],
      });
      assert.deepStrictEqual(result.path, [
        { x: 10, y: 20 },
        { x: 50, y: 60 },
      ]);
    });

    it('leaves path undefined when not provided', () => {
      const result = normalizeOpenAIAction({ type: 'click', x: 1, y: 2 });
      assert.strictEqual(result.path, undefined);
    });
  });

  describe('passthrough', () => {
    it('preserves unknown action types', () => {
      const result = normalizeOpenAIAction({ type: 'screenshot' });
      assert.strictEqual(result.type, 'screenshot');
      assert.strictEqual(result.x, undefined);
      assert.strictEqual(result.path, undefined);
    });

    it('preserves scroll coordinates', () => {
      const result = normalizeOpenAIAction({ type: 'scroll', x: 100, y: 200 });
      assert.strictEqual(result.type, 'scroll');
      assert.strictEqual(result.x, 100);
      assert.strictEqual(result.y, 200);
    });
  });

  describe('defensive edge cases', () => {
    it('handles undefined input without throwing', () => {
      const result = normalizeOpenAIAction(undefined);
      assert.strictEqual(result.type, undefined);
      assert.strictEqual(result.path, undefined);
    });

    it('handles null input without throwing', () => {
      const result = normalizeOpenAIAction(null);
      assert.strictEqual(result.type, undefined);
    });

    it('handles an empty object', () => {
      const result = normalizeOpenAIAction({});
      assert.deepStrictEqual(result, {
        type: undefined,
        x: undefined,
        y: undefined,
        button: undefined,
        path: undefined,
      });
    });

    it('treats non-array path as undefined', () => {
      const result = normalizeOpenAIAction({ type: 'drag', path: 'not-an-array' });
      assert.strictEqual(result.path, undefined);
    });
  });
});
