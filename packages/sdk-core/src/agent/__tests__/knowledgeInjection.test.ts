import { describe, it, mock } from 'node:test';
import assert from 'node:assert/strict';
import type { PageContext } from '../action-generation/actionPrompts.js';
import type { KnowledgeItem } from '../../services/knowledgeService.js';

/**
 * exp-knowledge-injection (001) — retrieved knowledge reaches the LLM prompt.
 *
 * Knowledge parsing/retrieval is already proven at the knowledgeService layer.
 * This closes the documented proof gap: that the selected knowledge text is
 * actually injected into the constructed action-generation prompt (not just
 * retrieved and dropped). Tests the real prompt-construction seam directly —
 * more direct than mocking a model call.
 */

// getActionGenerationUserPrompt -> webAgent import graph isn't pulled here, but
// actionPrompts has no `?raw` chain; still, mock dom defensively to match the
// sibling tests in this directory and keep imports lightweight.
mock.module('../../dom', {
  namedExports: { DomService: class {}, HistoryTreeProcessor: class {} },
});

const { getActionGenerationUserPrompt } = await import('../action-generation/actionPrompts.js');

const PAGE_CONTEXT: PageContext = {
  elementsText: '[0]<button>Login</button>',
  currentUrl: 'https://example.test/login',
  currentTitle: 'Login',
  currentTabText: 'Tab 0: Login',
  tabsText: '[0] Login',
};

function promptText(content: ReturnType<typeof getActionGenerationUserPrompt>): string {
  return (content as Array<{ type: string; text?: string }>)
    .filter((block) => block.type === 'text')
    .map((block) => block.text ?? '')
    .join('\n');
}

function buildPrompt(knowledges?: KnowledgeItem[]): string {
  return promptText(
    getActionGenerationUserPrompt(PAGE_CONTEXT, 'log in', undefined, undefined, knowledges),
  );
}

describe('knowledge injection — retrieved knowledge reaches the constructed prompt', () => {
  it('injects a knowledge item\'s text into the prompt under <retrieved_knowledge>', () => {
    const text = buildPrompt([{ content: 'KNOWLEDGE_ALPHA_42: click the blue Submit button' }]);
    assert.match(text, /<retrieved_knowledge>/);
    assert.ok(
      text.includes('KNOWLEDGE_ALPHA_42: click the blue Submit button'),
      'retrieved knowledge content must appear in the LLM prompt',
    );
  });

  it('injects every provided knowledge item', () => {
    const text = buildPrompt([
      { content: 'FIRST_KNOWLEDGE_ITEM' },
      { content: 'SECOND_KNOWLEDGE_ITEM' },
    ]);
    assert.ok(text.includes('FIRST_KNOWLEDGE_ITEM'));
    assert.ok(text.includes('SECOND_KNOWLEDGE_ITEM'));
  });

  it('emits no <retrieved_knowledge> block when there is no knowledge', () => {
    assert.equal(buildPrompt(undefined).includes('<retrieved_knowledge>'), false);
    assert.equal(buildPrompt([]).includes('<retrieved_knowledge>'), false);
  });

  it('preserves knowledge ordering in the prompt', () => {
    const text = buildPrompt([{ content: 'AAA_FIRST' }, { content: 'ZZZ_SECOND' }]);
    assert.ok(text.indexOf('AAA_FIRST') < text.indexOf('ZZZ_SECOND'));
  });
});
