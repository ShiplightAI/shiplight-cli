/**
 * Tests for Knowledge Parser utilities
 *
 * These tests verify the TypeScript port of knowledge_parser.py functions
 */

import { describe, it } from 'node:test';
import assert from 'node:assert';
import {
  parseKnowledgeWithImages,
  createMultimodalContentParts,
  createKnowledgeParts,
  KnowledgeItem,
} from '../knowledgeService.js';

describe('Knowledge Parser', () => {
  describe('parseKnowledgeWithImages', () => {
    it('should parse content with single image in middle', () => {
      const content = 'Step 1: Click the ![Login Button](image:abc-123) to start';
      const images = [{ hash: 'abc-123', url: 'https://s3.amazonaws.com/presigned-url' }];

      const result = parseKnowledgeWithImages(content, images);

      assert.strictEqual(result.length, 3);
      assert.strictEqual(result[0].type, 'text');
      assert.strictEqual((result[0] as any).text, 'Step 1: Click the ');
      assert.strictEqual(result[1].type, 'file');
      assert.strictEqual(result[2].type, 'text');
      assert.strictEqual((result[2] as any).text, ' to start');
    });

    it('should parse content with multiple images', () => {
      const content = `Follow these steps:
1. Click ![Sign In](image:uuid-1) button
2. Enter credentials
3. Click ![Submit](image:uuid-2) to complete`;

      const images = [
        { uuid: 'uuid-1', url: 'https://s3.com/signin.png' },
        { uuid: 'uuid-2', url: 'https://s3.com/submit.png' },
      ];

      const result = parseKnowledgeWithImages(content, images);

      assert(result.length > 3);
      const imageParts = result.filter(part => part.type === 'file');
      assert.strictEqual(imageParts.length, 2);
    });

    it('should return plain text when no images are found', () => {
      const content = 'This is just plain text with no images';
      const images: Array<{ hash: string; url: string }> = [];

      const result = parseKnowledgeWithImages(content, images);

      assert.strictEqual(result.length, 1);
      assert.strictEqual(result[0].type, 'text');
      assert.strictEqual((result[0] as any).text, content);
    });

    it('should keep original markdown when image URL not found', () => {
      const content = 'Click ![Missing](image:unknown-uuid) here';
      const images: Array<{ hash: string; url: string }> = [];

      const result = parseKnowledgeWithImages(content, images);

      assert(result.length >= 1);
      // Should contain the original markdown since no URL was found
      const textContent = result
        .filter(part => part.type === 'text')
        .map(part => (part as any).text)
        .join('');
      assert(textContent.includes('![Missing](image:unknown-uuid)'));
    });

    it('should support SHA-256 hash format (64 hex chars)', () => {
      const hash = 'a'.repeat(64); // 64-char hex hash
      const content = `Click ![Button](image:${hash}) here`;
      const images = [{ hash, url: 'https://s3.com/image.png' }];

      const result = parseKnowledgeWithImages(content, images);

      const imageParts = result.filter(part => part.type === 'file');
      assert.strictEqual(imageParts.length, 1);
    });

    it('should support backward compatibility with UUID format', () => {
      const content = 'Click ![Button](image:abc-123-def) here';
      const images = [{ uuid: 'abc-123-def', url: 'https://s3.com/image.png' }];

      const result = parseKnowledgeWithImages(content, images);

      const imageParts = result.filter(part => part.type === 'file');
      assert.strictEqual(imageParts.length, 1);
    });

    it('should handle content with images at start and end', () => {
      const content = '![Start](image:img-1) middle text ![End](image:img-2)';
      const images = [
        { hash: 'img-1', url: 'https://s3.com/start.png' },
        { hash: 'img-2', url: 'https://s3.com/end.png' },
      ];

      const result = parseKnowledgeWithImages(content, images);

      assert.strictEqual(result[0].type, 'file'); // Starts with image
      assert.strictEqual(result[result.length - 1].type, 'file'); // Ends with image
    });

    it('should handle empty content', () => {
      const content = '';
      const images: Array<{ hash: string; url: string }> = [];

      const result = parseKnowledgeWithImages(content, images);

      assert.strictEqual(result.length, 1);
      assert.strictEqual(result[0].type, 'text');
      assert.strictEqual((result[0] as any).text, '');
    });

    it('should handle content with only images (no text)', () => {
      const content = '![Image1](image:img-1)![Image2](image:img-2)';
      const images = [
        { hash: 'img-1', url: 'https://s3.com/1.png' },
        { hash: 'img-2', url: 'https://s3.com/2.png' },
      ];

      const result = parseKnowledgeWithImages(content, images);

      // Should only contain images
      assert(result.every(part => part.type === 'file'));
      assert.strictEqual(result.length, 2);
    });
  });

  describe('createMultimodalContentParts', () => {
    it('should process multiple knowledge items', () => {
      const knowledgeItems: KnowledgeItem[] = [
        {
          content: 'First item with ![Image](image:img-1)',
          images: [{ hash: 'img-1', url: 'https://s3.com/1.png' }],
        },
        {
          content: 'Second item with text only',
          images: [],
        },
      ];

      const result = createMultimodalContentParts(knowledgeItems);

      assert(result.length > 0);
      // Should contain separator between items
      const textParts = result.filter(part => part.type === 'text');
      const separators = textParts.filter(part => (part as any).text === '\n\n');
      assert(separators.length > 0); // At least one separator
    });

    it('should handle empty knowledge items array', () => {
      const result = createMultimodalContentParts([]);

      assert.strictEqual(result.length, 0);
    });

    it('should flatten multiple images across items', () => {
      const knowledgeItems: KnowledgeItem[] = [
        {
          content: 'Item 1: ![A](image:a)',
          images: [{ hash: 'a', url: 'https://s3.com/a.png' }],
        },
        {
          content: 'Item 2: ![B](image:b)',
          images: [{ hash: 'b', url: 'https://s3.com/b.png' }],
        },
      ];

      const result = createMultimodalContentParts(knowledgeItems);

      const imageParts = result.filter(part => part.type === 'file');
      assert.strictEqual(imageParts.length, 2);
    });

    it('should not add separator for first item', () => {
      const knowledgeItems: KnowledgeItem[] = [
        { content: 'Only item', images: [] },
      ];

      const result = createMultimodalContentParts(knowledgeItems);

      // Should not start with separator
      assert(result.length > 0);
      assert.notStrictEqual((result[0] as any).text, '\n\n');
    });
  });

  describe('createKnowledgeParts', () => {
    it('should wrap knowledge with preamble and postamble', () => {
      const knowledgeItems: KnowledgeItem[] = [
        { content: 'Test knowledge', images: [] },
      ];

      const result = createKnowledgeParts(knowledgeItems);

      assert(result.length >= 3); // preamble + content + postamble

      // Check preamble
      assert.strictEqual(result[0].type, 'text');
      assert((result[0] as any).text.includes('<retrieved_knowledge>'));

      // Check postamble
      const lastItem = result[result.length - 1];
      assert.strictEqual(lastItem.type, 'text');
      assert((lastItem as any).text.includes('</retrieved_knowledge>'));
    });

    it('should convert text parts to TextPart format', () => {
      const knowledgeItems: KnowledgeItem[] = [
        { content: 'Plain text knowledge', images: [] },
      ];

      const result = createKnowledgeParts(knowledgeItems);

      const textMessages = result.filter(part => part.type === 'text');
      assert(textMessages.length > 0);
      assert(textMessages.every(part => 'text' in part));
    });

    it('should convert image parts to FilePart format', () => {
      const knowledgeItems: KnowledgeItem[] = [
        {
          content: 'Knowledge with ![Image](image:img-1)',
          images: [{ hash: 'img-1', url: 'https://s3.com/image.png' }],
        },
      ];

      const result = createKnowledgeParts(knowledgeItems, true);

      const imageMessages = result.filter(part => part.type === 'file');
      assert.strictEqual(imageMessages.length, 1);
      assert.strictEqual(imageMessages[0].type, 'file');
    });

    it('should handle empty knowledge items', () => {
      const result = createKnowledgeParts([]);

      // Empty knowledge returns empty array (no preamble/postamble for empty content)
      assert.strictEqual(result.length, 0);
    });

    it('should handle mixed text and images', () => {
      const knowledgeItems: KnowledgeItem[] = [
        {
          content: 'Step 1: Click ![Button](image:btn) then enter ![Input](image:inp)',
          images: [
            { hash: 'btn', url: 'https://s3.com/btn.png' },
            { hash: 'inp', url: 'https://s3.com/inp.png' },
          ],
        },
      ];

      const result = createKnowledgeParts(knowledgeItems, true);

      const textCount = result.filter(part => part.type === 'text').length;
      const imageCount = result.filter(part => part.type === 'file').length;

      assert(textCount > 2); // preamble + content parts + postamble
      assert.strictEqual(imageCount, 2); // Two images
    });

    it('should produce valid multimodal message structure', () => {
      const knowledgeItems: KnowledgeItem[] = [
        {
          content: 'Test ![Image](image:test)',
          images: [{ hash: 'test', url: 'https://s3.com/test.png' }],
        },
      ];

      const result = createKnowledgeParts(knowledgeItems, true);

      // Verify all messages have required fields
      for (const part of result) {
        assert('type' in part);
        if (part.type === 'text') {
          assert('text' in part);
          assert(typeof (part as any).text === 'string');
        } else if (part.type === 'file') {
          assert('data' in part);
          assert.equal((part as any).mediaType, 'image');
        }
      }
    });
  });
});
