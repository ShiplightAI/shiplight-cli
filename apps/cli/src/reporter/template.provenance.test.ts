/**
 * Unit tests for the model-tier provenance line the HTML report footer renders
 * (design §4). The provenance object is produced elsewhere (buildModelTierProvenance,
 * covered in orgSettings.test.ts); this locks how it is SURFACED — the footer text
 * and the tierSourceLabel mapping — so a rename or a dropped case is caught.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { generateHtml, type ReportData } from './template.js';
import type { ModelTierProvenance } from '../orgSettings.js';

function footerOf(data: ReportData): string {
  const html = generateHtml(data);
  const after = html.split('<div class="footer">')[1];
  assert.ok(after, 'report has no footer');
  return after.split('</div>')[0].trim();
}

function baseReport(provenance?: ModelTierProvenance): ReportData {
  return {
    tests: [],
    totalDuration: 0,
    timestamp: '2026-01-01T00:00:00Z',
    shiplightVersion: '0.1.94',
    ...(provenance && { modelTierProvenance: provenance }),
  };
}

describe('report footer — model tier provenance', () => {
  it('renders nothing tier-related for a run without provenance (BYOK / non-tier)', () => {
    const footer = footerOf(baseReport());
    assert.match(footer, /shiplightai v0\.1\.94/);
    assert.doesNotMatch(footer, /tier:/);
  });

  it('renders tier, source label, primary and map source for a server-mapped env tier', () => {
    const footer = footerOf(
      baseReport({
        tier: 'pro',
        tierSource: 'env',
        mapSource: 'server',
        webagentPrimary: 'anthropic:claude-opus-4-8',
        computerUsePrimary: 'google:gemini-3-flash-preview',
      }),
    );
    assert.match(footer, /tier: pro \(from WEB_AGENT_TIER\) → anthropic:claude-opus-4-8 \[org settings\]/);
  });

  it('labels an org-default tier and a server map', () => {
    const footer = footerOf(
      baseReport({
        tier: 'standard',
        tierSource: 'org-default',
        mapSource: 'server',
        webagentPrimary: 'google:gemini-3.5-flash',
        computerUsePrimary: 'google:gemini-3-flash-preview',
      }),
    );
    assert.match(footer, /tier: standard \(org default\) → google:gemini-3\.5-flash \[org settings\]/);
  });

  it('labels a baked-default tier and a baked map as built-in', () => {
    const footer = footerOf(
      baseReport({
        tier: 'lite',
        tierSource: 'baked-default',
        mapSource: 'baked',
        webagentPrimary: 'google:gemini-3-flash-preview',
        computerUsePrimary: 'google:gemini-3-flash-preview',
      }),
    );
    assert.match(footer, /tier: lite \(built-in default\) → google:gemini-3-flash-preview \[built-in defaults\]/);
  });

  it('HTML-escapes provenance values rather than injecting them raw', () => {
    const footer = footerOf(
      baseReport({
        tier: 'pro',
        tierSource: 'env',
        mapSource: 'server',
        // A pathological model id — must not break out of the footer text.
        webagentPrimary: 'anthropic:<script>x</script>',
        computerUsePrimary: 'google:gemini-3-flash-preview',
      }),
    );
    assert.doesNotMatch(footer, /<script>/);
    assert.match(footer, /&lt;script&gt;/);
  });
});
