/**
 * Tests for KnowledgeService
 */

import { describe, it } from 'node:test';
import assert from 'node:assert';
import { KnowledgeService } from '../knowledgeService.js';

describe('KnowledgeService', () => {
  describe('retrieve', () => {
    it('should return empty array when no preloaded knowledges', async () => {
      const service = new KnowledgeService();

      const knowledge = await service.retrieve('click submit button');

      assert(Array.isArray(knowledge), 'should return an array');
      assert.strictEqual(knowledge.length, 0, 'should be empty array');
    });

    it('should return empty array for any statement without preloaded knowledges', async () => {
      const service = new KnowledgeService();

      const statements = [
        'click button',
        'type username',
        'select option',
        'navigate to page',
      ];

      for (const statement of statements) {
        const knowledge = await service.retrieve(statement);
        assert.strictEqual(knowledge.length, 0, `should be empty for "${statement}"`);
      }
    });

    it('should return preloaded knowledges when provided', async () => {
      const service = new KnowledgeService();

      const preloadedKnowledges = [
        {
          id: 1,
          content: 'Always click the blue button',
          type: 'manual' as const,
          platform: 'all' as const,
          isAlwaysInclude: true,
        },
        {
          id: 2,
          content: 'Wait for loading spinner',
          type: 'system' as const,
          platform: 'desktop' as const,
          isAlwaysInclude: false,
        },
      ];

      const knowledge = await service.retrieve('test statement', preloadedKnowledges);

      assert.strictEqual(knowledge.length, 2);
      assert.strictEqual(knowledge[0].content, 'Always click the blue button');
      assert.strictEqual(knowledge[0].source, 'manual');
      assert.strictEqual(knowledge[0].relevance, 1.0);
      assert.strictEqual(knowledge[1].content, 'Wait for loading spinner');
      assert.strictEqual(knowledge[1].source, 'system');
      assert.strictEqual(knowledge[1].relevance, 0.5);
    });

    it('should set relevance based on isAlwaysInclude flag', async () => {
      const service = new KnowledgeService();

      const preloadedKnowledges = [
        {
          id: 1,
          content: 'Always included',
          type: 'manual' as const,
          platform: 'all' as const,
          isAlwaysInclude: true,
        },
        {
          id: 2,
          content: 'Sometimes included',
          type: 'manual' as const,
          platform: 'all' as const,
          isAlwaysInclude: false,
        },
      ];

      const knowledge = await service.retrieve('test', preloadedKnowledges);

      assert.strictEqual(knowledge[0].relevance, 1.0);
      assert.strictEqual(knowledge[1].relevance, 0.5);
    });
  });
});
