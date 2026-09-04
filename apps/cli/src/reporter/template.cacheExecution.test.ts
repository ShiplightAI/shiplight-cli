/**
 * Unit tests for how the HTML report SURFACES the action-entity cache panel.
 *
 * The counts themselves are produced elsewhere (cacheExecutionSummary.ts, covered by
 * its own tests); this locks the rendering — above all that the execution-scoped
 * block and the transpile-time block stay labelled as the different populations they
 * are. Reading "6 cached" (whole corpus) and "6 served from cache" (statements that
 * ran) as one number is the specific mistake the labels exist to prevent.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { RunCacheExecutionSummary } from 'shiplight-types';
import { generateHtml, type ReportCacheSummary, type ReportData } from './template.js';

function cachePanelOf(data: ReportData): string | undefined {
  const html = generateHtml(data);
  const after = html.split('<div class="cache-stats"')[1];
  return after?.split('<div class="test-list">')[0];
}

function baseReport(over: Partial<ReportData> = {}): ReportData {
  return {
    tests: [],
    totalDuration: 0,
    timestamp: '2026-01-01T00:00:00Z',
    ...over,
  };
}

const execution: RunCacheExecutionSummary = {
  executed: 20,
  cache_served: 12,
  auto_healed: 3,
  auto_heal_failed: 1,
  healed_from_cache: 2,
};

const transpile: ReportCacheSummary = {
  total_statements: 40,
  original: 25,
  cache_hits: 12,
  healed: 3,
  failed: 0,
};

describe('report cache panel', () => {
  it('renders no panel at all when the run measured neither view', () => {
    assert.strictEqual(cachePanelOf(baseReport()), undefined);
  });

  it('renders the execution block on its own when there is no transpile-time summary', () => {
    // A run with no action-entity cache configured still auto-heals, and that count
    // is the baseline any future cache saving is measured against — so the panel must
    // appear without cacheSummary.
    const panel = cachePanelOf(baseReport({ cacheExecutionSummary: execution }))!;
    assert.match(panel, /Statements that executed/);
    assert.match(panel, /12 served from cache/);
    assert.doesNotMatch(panel, /Across all transpiled statements/);
  });

  it('labels the two populations distinctly when both are present', () => {
    const panel = cachePanelOf(
      baseReport({ cacheExecutionSummary: execution, cacheSummary: transpile }),
    )!;
    assert.match(panel, /Statements that executed/);
    assert.match(panel, /Across all transpiled statements/);
    // Same underlying 12, two different populations — both must be shown, each
    // under its own heading.
    assert.match(panel, /12 served from cache/);
    assert.match(panel, /12 cached/);
    assert.ok(
      panel.indexOf('Statements that executed') < panel.indexOf('Across all transpiled statements'),
      'the execution view is the headline and must come first',
    );
  });

  it('sums healed and failed heals into one auto-healed figure, calling out the failures', () => {
    // Both spent a model call; that total is what `cache_served` is compared against.
    const panel = cachePanelOf(baseReport({ cacheExecutionSummary: execution }))!;
    assert.match(panel, /4 auto-healed \(1 failed\)/);
  });

  it('omits the failure clause when every heal succeeded', () => {
    const panel = cachePanelOf(
      baseReport({ cacheExecutionSummary: { ...execution, auto_heal_failed: 0 } }),
    )!;
    assert.match(panel, /3 auto-healed/);
    assert.doesNotMatch(panel, /failed\)/);
  });

  it('shows the executed denominator alongside any cache-relevant outcome', () => {
    const panel = cachePanelOf(
      baseReport({
        cacheExecutionSummary: {
          executed: 20,
          cache_served: 0,
          auto_healed: 2,
          auto_heal_failed: 0,
          healed_from_cache: 0,
        },
      }),
    )!;
    assert.match(panel, /20 executed/);
    assert.doesNotMatch(panel, /served from cache/);
  });

  it('renders no panel for a run that executed statements but used no cache', () => {
    // The shape a project that never enabled the cache produces on every run. This
    // is the noise markRunCacheInPlay() exists to suppress for cacheSummary, and the
    // execution block must not reintroduce it. The console line is already silent
    // here, so rendering would also make HTML and console disagree.
    assert.strictEqual(
      cachePanelOf(
        baseReport({
          cacheExecutionSummary: {
            executed: 37,
            cache_served: 0,
            auto_healed: 0,
            auto_heal_failed: 0,
            healed_from_cache: 0,
          },
        }),
      ),
      undefined,
    );
  });
});
