/**
 * Unit tests for runAiAnalysis (the core of agent.ai).
 *
 * Strategy: mock the LLM boundary (`generateText` from 'ai') and the model
 * factory ('../llm'), then exercise the REAL attachment validation and
 * content-part construction with temp files on disk. No browser, no API key.
 */

import assert from 'node:assert';
import { describe, it, mock, beforeEach, after } from 'node:test';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

// Shape of the content parts and call arguments we capture from the mocked LLM boundary.
interface CapturedContentPart {
  type: string;
  text?: string;
  filename?: string;
  mediaType?: string;
  data?: unknown;
  image?: unknown;
}
interface CapturedGenerateTextArgs {
  model: unknown;
  temperature?: number;
  messages: Array<{ role: string; content: CapturedContentPart[] }>;
}

// Captured arguments of the most recent generateText() call.
let lastGenerateTextArgs: CapturedGenerateTextArgs | null = null;
// Canned response for the next generateText() call.
let nextText = 'mock response';
let nextUsage: unknown = { inputTokens: 100, outputTokens: 20, totalTokens: 120 };
let generateTextCallCount = 0;

function capturedArgs(): CapturedGenerateTextArgs {
  assert.ok(lastGenerateTextArgs, 'generateText was not called');
  return lastGenerateTextArgs;
}

mock.module('ai', {
  namedExports: {
    generateText: async (args: CapturedGenerateTextArgs) => {
      lastGenerateTextArgs = args;
      generateTextCallCount++;
      return { text: nextText, usage: nextUsage };
    },
  },
});

const actualLlm = await import('../llm');
mock.module('../llm', {
  namedExports: {
    getModel: (modelString: string) => ({ mockModel: modelString }),
    getProviderOptions: () => ({}),
    // Real resolveTemperature: aiAnalysis omits temperature for sampling-free
    // Claude models and sends the determinism default (0) elsewhere.
    resolveTemperature: actualLlm.resolveTemperature,
  },
});

const { runAiAnalysis, MAX_ATTACHMENT_BYTES } = await import('../aiAnalysis');

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-analysis-test-'));
after(() => fs.rmSync(tmpDir, { recursive: true, force: true }));

function writeTmp(name: string, content: string | Buffer): string {
  const filePath = path.join(tmpDir, name);
  fs.writeFileSync(filePath, content);
  return filePath;
}

describe('runAiAnalysis', () => {
  beforeEach(() => {
    lastGenerateTextArgs = null;
    nextText = 'mock response';
    nextUsage = { inputTokens: 100, outputTokens: 20, totalTokens: 120 };
    generateTextCallCount = 0;
  });

  it('runs a prompt with no files as a single text part', async () => {
    const result = await runAiAnalysis('What is 2+2?', [], 'gemini-test');

    assert.strictEqual(result.text, 'mock response');
    const content = capturedArgs().messages[0].content;
    assert.deepStrictEqual(content, [{ type: 'text', text: 'What is 2+2?' }]);
    assert.deepStrictEqual(capturedArgs().model, { mockModel: 'gemini-test' });
  });

  it('converts usage to TokenUsage with the model string', async () => {
    const result = await runAiAnalysis('hi', [], 'gemini-test');
    assert.deepStrictEqual(result.tokenUsage, {
      prompt_tokens: 100,
      completion_tokens: 20,
      total_tokens: 120,
      model: 'gemini-test',
    });
  });

  it('sends the determinism default (0) for a non-Claude model', async () => {
    await runAiAnalysis('hi', [], 'gemini-test');
    assert.strictEqual(capturedArgs().temperature, 0);
  });

  it('omits temperature for a sampling-free Claude model (Sonnet 5)', async () => {
    // Anthropic 400s on a non-default temperature for these models; the field
    // must be absent from the request entirely, not sent as 0.
    await runAiAnalysis('hi', [], 'anthropic:claude-sonnet-5');
    assert.strictEqual(capturedArgs().temperature, undefined);
    assert.ok(!('temperature' in capturedArgs()), 'temperature key must be omitted');
  });

  it('attaches a PDF as a file part with mediaType and filename, before the prompt', async () => {
    const pdfPath = writeTmp('report.pdf', '%PDF-1.4 fake');

    await runAiAnalysis('Extract the title', [pdfPath], 'gemini-test');

    const content = capturedArgs().messages[0].content;
    assert.strictEqual(content.length, 2);
    assert.strictEqual(content[0].type, 'file');
    assert.strictEqual(content[0].mediaType, 'application/pdf');
    assert.strictEqual(content[0].filename, 'report.pdf');
    assert.ok(Buffer.isBuffer(content[0].data));
    assert.deepStrictEqual(content[1], { type: 'text', text: 'Extract the title' });
  });

  it('attaches an image as a file part with its image media type', async () => {
    const pngPath = writeTmp('shot.png', Buffer.from([0x89, 0x50, 0x4e, 0x47]));

    await runAiAnalysis('Describe this image', [pngPath], 'gemini-test');

    const content = capturedArgs().messages[0].content;
    assert.strictEqual(content[0].type, 'file');
    assert.ok(Buffer.isBuffer(content[0].data));
    assert.strictEqual(content[0].mediaType, 'image/png');
  });

  it('inlines text files as labeled text blocks', async () => {
    const csvPath = writeTmp('data.csv', 'id,name\n1,Alice');

    await runAiAnalysis('Are these rows plausible?', [csvPath], 'gemini-test');

    const content = capturedArgs().messages[0].content;
    assert.strictEqual(content[0].type, 'text');
    assert.ok(content[0].text.includes('File: data.csv'));
    assert.ok(content[0].text.includes('id,name\n1,Alice'));
  });

  it('keeps multiple attachments in order', async () => {
    const a = writeTmp('a.pdf', '%PDF a');
    const b = writeTmp('b.pdf', '%PDF b');

    await runAiAnalysis('Compare these documents', [a, b], 'gemini-test');

    const content = capturedArgs().messages[0].content;
    assert.deepStrictEqual(
      content.map((p) => p.filename ?? p.type),
      ['a.pdf', 'b.pdf', 'text'],
    );
  });

  it('rejects a missing file before calling the model, naming the path', async () => {
    const missing = path.join(tmpDir, 'nope.pdf');
    await assert.rejects(
      () => runAiAnalysis('x', [missing], 'gemini-test'),
      (err: Error) => err.message.includes('not found') && err.message.includes(missing),
    );
    assert.strictEqual(generateTextCallCount, 0);
  });

  it('rejects an unsupported file type with guidance', async () => {
    const xlsxPath = writeTmp('book.xlsx', 'binary');
    await assert.rejects(
      () => runAiAnalysis('x', [xlsxPath], 'gemini-test'),
      (err: Error) => err.message.includes('unsupported attachment type ".xlsx"') && err.message.includes('parse the file in code'),
    );
    assert.strictEqual(generateTextCallCount, 0);
  });

  it('rejects an over-limit file, naming the file and the limit', async () => {
    const bigPath = writeTmp('big.pdf', Buffer.alloc(MAX_ATTACHMENT_BYTES + 1));
    await assert.rejects(
      () => runAiAnalysis('x', [bigPath], 'gemini-test'),
      (err: Error) => err.message.includes('attachment limit') && err.message.includes('big.pdf'),
    );
    assert.strictEqual(generateTextCallCount, 0);
  });

  it('rejects a directory path', async () => {
    await assert.rejects(
      () => runAiAnalysis('x', [tmpDir], 'gemini-test'),
      (err: Error) => err.message.includes('not a file'),
    );
    assert.strictEqual(generateTextCallCount, 0);
  });
});
