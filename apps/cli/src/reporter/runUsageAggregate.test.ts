import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import type { RunUsageByOperation, RunUsageSummary } from 'shiplight-types';
// Type-only — erased at build time (see the barrel-import guard below).
import type { AIActionDetail } from 'sdk-core';
import {
  aggregateRunUsageSummary,
  detectUsageRouting,
  groupStepLlmUsage,
  mergeUsageSummaries,
  resolveRoutingProvider,
} from './runUsageAggregate.js';
import { __setShiplightEnvForTest } from '../dotenvSource.js';

function op(over: Partial<RunUsageByOperation> & Pick<RunUsageByOperation, 'operation'>): RunUsageByOperation {
  return {
    provider: 'anthropic',
    model: 'claude-sonnet-5',
    routing: 'proxy',
    calls: 1,
    input_tokens: 10,
    output_tokens: 1,
    thinking_tokens: 0,
    cache_read_tokens: 0,
    ...over,
  };
}

describe('mergeUsageSummaries', () => {
  it('sums buckets with the same (operation, provider, model, routing)', () => {
    const a: RunUsageSummary = { by_operation: [op({ operation: 'evaluate_wait_until', calls: 3, input_tokens: 300, output_tokens: 30 })] };
    const b: RunUsageSummary = { by_operation: [op({ operation: 'evaluate_wait_until', calls: 2, input_tokens: 200, output_tokens: 20 })] };
    const merged = mergeUsageSummaries([a, b]);
    assert.strictEqual(merged?.by_operation.length, 1);
    const bucket = merged!.by_operation[0]!;
    assert.strictEqual(bucket.calls, 5);
    assert.strictEqual(bucket.input_tokens, 500);
    assert.strictEqual(bucket.output_tokens, 50);
  });

  it('keeps distinct buckets separate and does not mutate inputs', () => {
    const a: RunUsageSummary = { by_operation: [op({ operation: 'evaluate_if', calls: 1 })] };
    const b: RunUsageSummary = { by_operation: [op({ operation: 'action', model: 'gpt-5', provider: 'openai', calls: 4 })] };
    const merged = mergeUsageSummaries([a, b]);
    assert.strictEqual(merged?.by_operation.length, 2);
    // inputs untouched
    assert.strictEqual(a.by_operation[0]!.calls, 1);
    assert.strictEqual(b.by_operation[0]!.calls, 4);
    // stable sort: action before evaluate_if
    assert.deepStrictEqual(merged!.by_operation.map((x) => x.operation), ['action', 'evaluate_if']);
  });

  it('keeps buckets differing only in routing separate, in deterministic order', () => {
    // e.g. a CI matrix where only one lane holds a direct key: same
    // (operation, provider, model) bucket, different routing per shard.
    const a: RunUsageSummary = { by_operation: [op({ operation: 'action', routing: 'proxy', calls: 2 })] };
    const b: RunUsageSummary = { by_operation: [op({ operation: 'action', routing: 'byok', calls: 3 })] };
    for (const order of [[a, b], [b, a]]) {
      const merged = mergeUsageSummaries(order);
      assert.deepStrictEqual(
        merged!.by_operation.map((x) => [x.routing, x.calls]),
        [['byok', 3], ['proxy', 2]],
      );
    }
  });

  it('returns undefined when no shard carried a summary', () => {
    assert.strictEqual(mergeUsageSummaries([undefined, undefined]), undefined);
    assert.strictEqual(mergeUsageSummaries([]), undefined);
    assert.strictEqual(mergeUsageSummaries([{ by_operation: [] }]), undefined);
  });
});

describe('detectUsageRouting', () => {
  const proxyOnly = { SHIPLIGHT_API_TOKEN: 'shp_ctx_test' };

  it('defaults to proxy and honors a valid override from the env stash', () => {
    assert.strictEqual(detectUsageRouting('anthropic', proxyOnly), 'proxy');
    assert.strictEqual(
      detectUsageRouting('anthropic', { ...proxyOnly, SHIPLIGHT_USAGE_ROUTING: 'byok' }),
      'byok',
    );
    assert.strictEqual(
      detectUsageRouting('anthropic', { ...proxyOnly, SHIPLIGHT_USAGE_ROUTING: 'custom_endpoint' }),
      'custom_endpoint',
    );
    assert.strictEqual(
      detectUsageRouting('anthropic', { ...proxyOnly, SHIPLIGHT_USAGE_ROUTING: 'nonsense' }),
      'proxy',
    );
  });

  it('override wins over direct signals in both directions', () => {
    assert.strictEqual(
      detectUsageRouting('anthropic', {
        ANTHROPIC_API_KEY: 'sk-ant-x',
        SHIPLIGHT_USAGE_ROUTING: 'proxy',
      }),
      'proxy',
    );
    assert.strictEqual(
      detectUsageRouting('anthropic', { ...proxyOnly, SHIPLIGHT_USAGE_ROUTING: 'byok' }),
      'byok',
    );
  });

  it('labels a direct provider key as byok, mirroring sdk-core selection order', () => {
    assert.strictEqual(
      detectUsageRouting('anthropic', { ...proxyOnly, ANTHROPIC_API_KEY: 'sk-ant-x' }),
      'byok',
    );
    assert.strictEqual(
      detectUsageRouting('gemini', { ...proxyOnly, GOOGLE_API_KEY: 'AIza-x' }),
      'byok',
    );
    assert.strictEqual(
      detectUsageRouting('openai', { ...proxyOnly, OPENAI_API_KEY: 'sk-x' }),
      'byok',
    );
    // A key for one provider does not relabel another provider's buckets.
    assert.strictEqual(
      detectUsageRouting('gemini', { ...proxyOnly, ANTHROPIC_API_KEY: 'sk-ant-x' }),
      'proxy',
    );
  });

  it('recognizes OpenRouter vendor-qualified model usage as byok', () => {
    const env = { ...proxyOnly, OPENROUTER_API_KEY: 'sk-or-v1-x' };
    assert.strictEqual(detectUsageRouting('openai', env, 'openai/gpt-4o'), 'byok');
    assert.strictEqual(
      detectUsageRouting('anthropic', env, 'anthropic/claude-sonnet-4.6'),
      'byok',
    );
    assert.strictEqual(detectUsageRouting('gemini', env, 'gemini-3.5-flash'), 'proxy');
  });

  it("applies each provider's exact sdk-core truthiness to its Vertex flag", () => {
    // anthropic.ts isTruthy: 1/true/yes/on, trimmed, case-insensitive.
    for (const value of ['true', 'True', '1', 'yes', 'on', ' TRUE ']) {
      assert.strictEqual(
        detectUsageRouting('anthropic', { ...proxyOnly, ANTHROPIC_MODELS_USE_VERTEXAI: value }),
        'byok',
        `anthropic flag ${JSON.stringify(value)}`,
      );
    }
    for (const value of ['false', '0', 'off', 'no']) {
      assert.strictEqual(
        detectUsageRouting('anthropic', { ...proxyOnly, ANTHROPIC_MODELS_USE_VERTEXAI: value }),
        'proxy',
        `anthropic flag ${JSON.stringify(value)}`,
      );
    }
    // google.ts isUsingVertexAI accepts ONLY the literal strings 'True'/'true' —
    // '1'/'yes'/'TRUE' do NOT enable Vertex there, so those runs used the
    // proxy and must stay labeled proxy.
    for (const value of ['True', 'true']) {
      assert.strictEqual(
        detectUsageRouting('gemini', { ...proxyOnly, GOOGLE_GENAI_USE_VERTEXAI: value }),
        'byok',
        `gemini flag ${JSON.stringify(value)}`,
      );
    }
    for (const value of ['1', 'yes', 'on', 'TRUE', 'false']) {
      assert.strictEqual(
        detectUsageRouting('gemini', { ...proxyOnly, GOOGLE_GENAI_USE_VERTEXAI: value }),
        'proxy',
        `gemini flag ${JSON.stringify(value)}`,
      );
    }
  });

  it('labels an OpenAI key + custom base URL as custom_endpoint; a base URL alone stays proxy', () => {
    assert.strictEqual(
      detectUsageRouting('openai', { OPENAI_API_KEY: 'sk-x', OPENAI_BASE_URL: 'http://localhost:11434/v1' }),
      'custom_endpoint',
    );
    assert.strictEqual(detectUsageRouting('openai', { OPENAI_API_KEY: 'sk-x' }), 'byok');
    // Base URL without a key is ignored by getOpenAIModel — still proxy.
    assert.strictEqual(
      detectUsageRouting('openai', { ...proxyOnly, OPENAI_BASE_URL: 'http://localhost:11434/v1' }),
      'proxy',
    );
  });

  it('treats empty-string env values as unset, matching buildSdkEnv falsiness', () => {
    assert.strictEqual(
      detectUsageRouting('anthropic', { ANTHROPIC_API_KEY: '', ANTHROPIC_MODELS_USE_VERTEXAI: '' }),
      'proxy',
    );
  });

  it('labels an unknown provider conservatively: proxy only with a pure proxy config', () => {
    assert.strictEqual(detectUsageRouting('unknown', proxyOnly), 'proxy');
    // With any direct config present the call may have been customer-paid —
    // counts-only, never claimed as billable.
    assert.strictEqual(
      detectUsageRouting('unknown', { ...proxyOnly, ANTHROPIC_API_KEY: 'sk-ant-x' }),
      'byok',
    );
    // A custom-endpoint config also collapses to byok for unknown providers —
    // both are counts-only, and byok is the conservative label.
    assert.strictEqual(
      detectUsageRouting('unknown', {
        ...proxyOnly,
        OPENAI_API_KEY: 'sk-x',
        OPENAI_BASE_URL: 'http://localhost:11434/v1',
      }),
      'byok',
    );
  });
});

describe('resolveRoutingProvider', () => {
  it('re-maps ids the dispatcher sends to OpenAI but inferProvider buckets as unknown', () => {
    assert.strictEqual(resolveRoutingProvider('unknown', 'chatgpt-4o-latest'), 'openai');
    assert.strictEqual(resolveRoutingProvider('unknown', 'o5-mini'), 'openai');
    assert.strictEqual(resolveRoutingProvider('unknown', 'mystery-model'), 'unknown');
    // Known providers pass through untouched.
    assert.strictEqual(resolveRoutingProvider('gemini', 'gemini-3-flash-preview'), 'gemini');
  });
});

describe('aggregateRunUsageSummary', () => {
  let tmp: string;
  before(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'runusage-'));
    const stepDir = path.join(tmp, 'test-results', 'some-test');
    fs.mkdirSync(stepDir, { recursive: true });
    // Two ai-actions.json (as if two tests ran) with evaluate wait_until + if.
    fs.writeFileSync(
      path.join(stepDir, 'ai-actions.json'),
      JSON.stringify([
        { stepId: 'm.1', actionType: 'evaluate', conditionKind: 'wait_until', count: 1, tokenUsages: [{ prompt_tokens: 100, completion_tokens: 10, total_tokens: 110, model: 'claude-sonnet-5' }] },
        { stepId: 'm.2', actionType: 'evaluate', conditionKind: 'if', count: 1, tokenUsages: [{ prompt_tokens: 50, completion_tokens: 5, total_tokens: 55, model: 'claude-sonnet-5' }] },
      ]),
    );
  });
  after(() => fs.rmSync(tmp, { recursive: true, force: true }));

  it('aggregates ai-actions.json under <cwd>/test-results into a per-operation summary', () => {
    const summary = aggregateRunUsageSummary(tmp);
    assert.ok(summary);
    const ops = summary!.by_operation.map((b) => b.operation).sort();
    assert.deepStrictEqual(ops, ['evaluate_if', 'evaluate_wait_until']);
    const wait = summary!.by_operation.find((b) => b.operation === 'evaluate_wait_until')!;
    assert.strictEqual(wait.input_tokens, 100);
  });

  it('returns undefined when there is no test-results dir', () => {
    const empty = fs.mkdtempSync(path.join(os.tmpdir(), 'runusage-empty-'));
    assert.strictEqual(aggregateRunUsageSummary(empty), undefined);
    fs.rmSync(empty, { recursive: true, force: true });
  });

  it('counts only the directories it was given, not sibling runs', () => {
    // outputDir is `test-results/<runId>` with a fresh id per invocation and
    // nothing prunes the parent, so scanning `<cwd>/test-results` would read
    // every earlier run too and report a run total that no combination of the
    // run's own tests can explain.
    const multi = fs.mkdtempSync(path.join(os.tmpdir(), 'runusage-multi-'));
    const writeRun = (runId: string, tokens: number) => {
      const dir = path.join(multi, 'test-results', runId, 'a-test');
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(
        path.join(dir, 'ai-actions.json'),
        JSON.stringify([
          { stepId: 'm.1', actionType: 'evaluate', conditionKind: 'if', count: 1, tokenUsages: [{ prompt_tokens: tokens, completion_tokens: 0, total_tokens: tokens, model: 'claude-sonnet-5' }] },
        ]),
      );
      return path.join(multi, 'test-results', runId);
    };
    writeRun('run-old', 700);
    const currentDir = writeRun('run-current', 3);

    const scoped = aggregateRunUsageSummary(multi, [currentDir])!;
    assert.strictEqual(scoped.by_operation.reduce((n, b) => n + b.input_tokens, 0), 3);

    // The unscoped fallback is what over-counted: it sees both runs.
    const unscoped = aggregateRunUsageSummary(multi)!;
    assert.strictEqual(unscoped.by_operation.reduce((n, b) => n + b.input_tokens, 0), 703);

    fs.rmSync(multi, { recursive: true, force: true });
  });

  it('sums across several output directories and tolerates missing ones', () => {
    const multi = fs.mkdtempSync(path.join(os.tmpdir(), 'runusage-projects-'));
    const dirs = ['p1', 'p2'].map((name) => {
      const dir = path.join(multi, name);
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(
        path.join(dir, 'ai-actions.json'),
        JSON.stringify([
          { stepId: 'm.1', actionType: 'evaluate', conditionKind: 'if', count: 1, tokenUsages: [{ prompt_tokens: 10, completion_tokens: 0, total_tokens: 10, model: 'claude-sonnet-5' }] },
        ]),
      );
      return dir;
    });

    const summary = aggregateRunUsageSummary(multi, [...dirs, path.join(multi, 'never-created')])!;
    assert.strictEqual(summary.by_operation.reduce((n, b) => n + b.input_tokens, 0), 20);

    fs.rmSync(multi, { recursive: true, force: true });
  });

  it('labels routing per bucket provider on a run mixing BYOK and proxy', () => {
    const mixed = fs.mkdtempSync(path.join(os.tmpdir(), 'runusage-mixed-'));
    const stepDir = path.join(mixed, 'test-results', 'mixed-test');
    fs.mkdirSync(stepDir, { recursive: true });
    fs.writeFileSync(
      path.join(stepDir, 'ai-actions.json'),
      JSON.stringify([
        { stepId: 'm.1', actionType: 'execute', count: 1, tokenUsages: [{ prompt_tokens: 100, completion_tokens: 10, total_tokens: 110, model: 'claude-sonnet-5' }] },
        { stepId: 'm.2', actionType: 'assert', count: 1, tokenUsages: [{ prompt_tokens: 50, completion_tokens: 5, total_tokens: 55, model: 'gemini-3.5-flash' }] },
        // Buckets as provider 'unknown' (inferProvider misses chatgpt-*) but
        // dispatches to OpenAI; must be re-mapped through resolveRoutingProvider
        // to publish as openai/proxy — without the re-map it would surface as
        // unknown/byok (the conservative fallback, since a direct key exists).
        { stepId: 'm.3', actionType: 'execute', count: 1, tokenUsages: [{ prompt_tokens: 20, completion_tokens: 2, total_tokens: 22, model: 'chatgpt-4o-latest' }] },
      ]),
    );
    // Direct Anthropic key + Shiplight token: sdk-core sends Claude calls
    // direct (byok) and Gemini/OpenAI calls through the proxy.
    __setShiplightEnvForTest({ ANTHROPIC_API_KEY: 'sk-ant-x', SHIPLIGHT_API_TOKEN: 'shp_ctx_t' });
    try {
      const summary = aggregateRunUsageSummary(mixed);
      const routingByProvider = Object.fromEntries(
        summary!.by_operation.map((b) => [b.provider, b.routing]),
      );
      assert.deepStrictEqual(routingByProvider, {
        anthropic: 'byok',
        gemini: 'proxy',
        openai: 'proxy',
      });
    } finally {
      __setShiplightEnvForTest(undefined);
      fs.rmSync(mixed, { recursive: true, force: true });
    }
  });

  it('publishes custom_endpoint through the aggregate path for a re-mapped OpenAI id', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'runusage-endpoint-'));
    const stepDir = path.join(dir, 'test-results', 'endpoint-test');
    fs.mkdirSync(stepDir, { recursive: true });
    fs.writeFileSync(
      path.join(stepDir, 'ai-actions.json'),
      JSON.stringify([
        { stepId: 'e.1', actionType: 'execute', count: 1, tokenUsages: [{ prompt_tokens: 10, completion_tokens: 1, total_tokens: 11, model: 'chatgpt-4o-latest' }] },
      ]),
    );
    __setShiplightEnvForTest({
      OPENAI_API_KEY: 'sk-x',
      OPENAI_BASE_URL: 'http://localhost:11434/v1',
    });
    try {
      const summary = aggregateRunUsageSummary(dir);
      assert.strictEqual(summary!.by_operation.length, 1);
      const bucket = summary!.by_operation[0]!;
      assert.strictEqual(bucket.provider, 'openai');
      assert.strictEqual(bucket.routing, 'custom_endpoint');
    } finally {
      __setShiplightEnvForTest(undefined);
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('groupStepLlmUsage', () => {
  const details: Array<Pick<AIActionDetail, 'stepId' | 'actionType' | 'conditionKind' | 'count' | 'tokenUsages'>> = [
    {
      stepId: 'm.1',
      actionType: 'execute',
      count: 1,
      tokenUsages: [
        { prompt_tokens: 100, completion_tokens: 10, total_tokens: 110, model: 'claude-sonnet-5', estimated_cost_usd: 0.01 },
      ],
    },
    {
      // wait_until polling: same stepId, multiple calls accumulated in one entry
      stepId: 'm.2',
      actionType: 'evaluate',
      conditionKind: 'wait_until',
      count: 2,
      tokenUsages: [
        { prompt_tokens: 50, completion_tokens: 5, total_tokens: 55, model: 'claude-sonnet-5' },
        { prompt_tokens: 60, completion_tokens: 6, total_tokens: 66, model: 'claude-sonnet-5' },
      ],
    },
    {
      // no tokenUsages recorded (e.g. verify_js) — must be skipped, not zero-filled
      stepId: 'm.3',
      actionType: 'assert',
      count: 1,
      tokenUsages: [],
    },
  ];

  it('groups raw per-call token usage records by stepId, without aggregating', () => {
    const usage = groupStepLlmUsage(details);
    const m1 = usage.get('m.1')!;
    assert.strictEqual(m1.length, 1);
    assert.deepStrictEqual(m1[0], { model: 'claude-sonnet-5', promptTokens: 100, completionTokens: 10, totalTokens: 110 });

    // wait_until polling: two raw calls stay as two separate records, not summed
    const m2 = usage.get('m.2')!;
    assert.strictEqual(m2.length, 2);
    assert.deepStrictEqual(m2[0], { model: 'claude-sonnet-5', promptTokens: 50, completionTokens: 5, totalTokens: 55 });
    assert.deepStrictEqual(m2[1], { model: 'claude-sonnet-5', promptTokens: 60, completionTokens: 6, totalTokens: 66 });
  });

  it('skips steps with no recorded token usage', () => {
    const usage = groupStepLlmUsage(details);
    assert.strictEqual(usage.has('m.3'), false);
  });

  it('returns an empty map for empty input', () => {
    assert.strictEqual(groupStepLlmUsage([]).size, 0);
  });
});

// Regression guard for the tarball-size blowup: this module is reached by the
// standalone reporter.ts tsup entry (splitting:false, sdk-core in noExternal), so
// a VALUE import of buildRunUsageSummary from the 'sdk-core' barrel inlines the
// whole ~360 KB sdk-core bundle a second time into dist/reporter.js (+11.9% on
// the shiplightai tarball -> trips the +1% release gate). It must come from the
// pure sdk-core/run-usage-summary subpath instead. Fails if the barrel import
// is reintroduced. (The publish-cli.yml tarball-size gate is the integration
// backstop; this catches it at unit speed before a 30-min release run.)
describe('runUsageAggregate barrel-import guard', () => {
  const src = fs.readFileSync(new URL('./runUsageAggregate.ts', import.meta.url), 'utf-8');

  it('imports buildRunUsageSummary from the sdk-core/run-usage-summary subpath', () => {
    assert.match(src, /import\s*\{\s*buildRunUsageSummary\s*\}\s*from\s*'sdk-core\/run-usage-summary'/);
  });

  it('does not value-import buildRunUsageSummary from the sdk-core barrel', () => {
    // A bare `import { buildRunUsageSummary ... } from 'sdk-core'` (no /subpath)
    // is the regression. `import type { AIActionDetail } from 'sdk-core'` is fine
    // (erased at build time), so only flag a buildRunUsageSummary value import.
    assert.doesNotMatch(src, /import\s*\{[^}]*\bbuildRunUsageSummary\b[^}]*\}\s*from\s*'sdk-core'/);
  });
});
