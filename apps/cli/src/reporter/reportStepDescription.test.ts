import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { resolveReportStepDescription } from './reportStepDescription.js';

describe('resolveReportStepDescription', () => {
  it('prefers the runtime-resolved description over the YAML placeholder text', () => {
    const description = resolveReportStepDescription(
      'main.0',
      { description: '已进入"{{activity_type}}"活动数据页' },
      '已进入"抽奖"活动数据页',
    );

    assert.equal(description, '已进入"抽奖"活动数据页');
  });
});
