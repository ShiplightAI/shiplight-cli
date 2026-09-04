import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  confirmParameterSetName,
  loadCachedYaml,
  resolveYamlEnrichment,
  splitParameterizedTitle,
} from './reportYamlEnrichment.js';
import type { ParsedYamlTestFile } from '../yaml-transpiler';
import type { TestFlow } from 'shiplight-types';

function flow(goal?: string): TestFlow {
  return { goal, statements: [] } as unknown as TestFlow;
}

describe('splitParameterizedTitle', () => {
  it('splits the transpiler\'s parameter-set title shape', () => {
    assert.deepEqual(splitParameterizedTitle('checkout works [admin]'), {
      baseTitle: 'checkout works',
      titleParameterSetName: 'admin',
    });
  });

  it('leaves a plain title whole', () => {
    assert.deepEqual(splitParameterizedTitle('checkout works'), {
      baseTitle: 'checkout works',
    });
  });

  it('splits on the trailing bracket group only', () => {
    assert.deepEqual(splitParameterizedTitle('checkout [beta] flow [admin]'), {
      baseTitle: 'checkout [beta] flow',
      titleParameterSetName: 'admin',
    });
  });
});

describe('confirmParameterSetName', () => {
  const parameters = [{ name: 'admin', values: { role: 'admin' } }];

  it('accepts a name the YAML declares', () => {
    assert.equal(confirmParameterSetName('admin', parameters), 'admin');
  });

  it('rejects a bracketed title the YAML never declared', () => {
    // A YAML test literally named `checkout [beta]` matches the title regex
    // without being parameterized. Reporting `beta` would make the cloud group
    // it under a parameter set that does not exist.
    assert.equal(confirmParameterSetName('beta', parameters), undefined);
    assert.equal(confirmParameterSetName('beta', undefined), undefined);
    assert.equal(confirmParameterSetName('beta', []), undefined);
  });

  it('reports nothing for a test with no bracket suffix at all', () => {
    assert.equal(confirmParameterSetName(undefined, parameters), undefined);
  });
});

describe('resolveYamlEnrichment — single-test file', () => {
  function singleTestFile(overrides: Partial<ParsedYamlTestFile> = {}): ParsedYamlTestFile {
    return {
      testFlow: flow('log in and check out'),
      name: 'checkout works',
      referencedTemplatePaths: [],
      ...overrides,
    };
  }

  it('recovers the YAML name as the base title', () => {
    const result = resolveYamlEnrichment(singleTestFile(), 'checkout works');
    assert.equal(result.baseTitle, 'checkout works');
  });

  it('falls back to the flow goal when the file has no name', () => {
    const result = resolveYamlEnrichment(
      singleTestFile({ name: undefined }),
      'log in and check out',
    );
    assert.equal(result.baseTitle, 'log in and check out');
  });

  it('recovers the base URL', () => {
    const result = resolveYamlEnrichment(
      singleTestFile({ use: { baseURL: 'https://example.test' } }),
      'checkout works',
    );
    assert.equal(result.baseUrl, 'https://example.test');
  });

  it('ignores a non-string baseURL rather than reporting an object', () => {
    const result = resolveYamlEnrichment(
      singleTestFile({ use: { baseURL: { nested: true } as unknown as string } }),
      'checkout works',
    );
    assert.equal(result.baseUrl, undefined);
  });

  it('confirms a parameter set the file declares', () => {
    const result = resolveYamlEnrichment(
      singleTestFile({ parameters: [{ name: 'admin', values: { role: 'admin' } }] }),
      'checkout works [admin]',
    );
    assert.equal(result.parameterSetName, 'admin');
  });

  it('does not invent a parameter set from a bracketed YAML name', () => {
    const result = resolveYamlEnrichment(singleTestFile(), 'checkout works [beta]');
    assert.equal(result.parameterSetName, undefined);
  });

  it('reports no tags — those come from Playwright, not the YAML', () => {
    const withTags = singleTestFile({ tags: ['smoke'] }) as ParsedYamlTestFile;
    const result = resolveYamlEnrichment(withTags, 'checkout works');
    assert.equal('tags' in result, false);
  });
});

describe('resolveYamlEnrichment — suite file', () => {
  function suiteFile(): ParsedYamlTestFile {
    return {
      name: 'Checkout suite',
      referencedTemplatePaths: [],
      use: { baseURL: 'https://example.test' },
      suite: {
        tests: [
          {
            name: 'guest checkout',
            testFlow: flow('guest checks out'),
            skip: 'flaky on CI',
            slow: true,
            timeout: 60_000,
            parameters: [{ name: 'admin', values: { role: 'admin' } }],
          },
          { name: 'member checkout', testFlow: flow('member checks out') },
        ],
      },
    };
  }

  it('matches the suite test by base title and recovers its control keys', () => {
    const result = resolveYamlEnrichment(suiteFile(), 'guest checkout');

    assert.equal(result.baseTitle, 'guest checkout');
    assert.equal(result.skip, 'flaky on CI');
    assert.equal(result.slow, true);
    assert.equal(result.timeout, 60_000);
  });

  it('matches by base title so every parameter set finds its test', () => {
    const result = resolveYamlEnrichment(suiteFile(), 'guest checkout [admin]');

    assert.equal(result.baseTitle, 'guest checkout');
    assert.equal(result.parameterSetName, 'admin');
  });

  it('validates the parameter set against the matched test, not the file', () => {
    // `member checkout` declares no parameter sets, so `[admin]` on it is a
    // title that merely looks parameterized.
    const result = resolveYamlEnrichment(suiteFile(), 'member checkout [admin]');
    assert.equal(result.parameterSetName, undefined);
  });

  it('reports the suite name and base URL even when no test matches', () => {
    // A renamed YAML test still belongs to a known suite; losing the suite name
    // too would leave the report unable to say where the test came from.
    const result = resolveYamlEnrichment(suiteFile(), 'a test that no longer exists');

    assert.equal(result.suiteName, 'Checkout suite');
    assert.equal(result.baseUrl, 'https://example.test');
    assert.equal(result.baseTitle, undefined);
  });

  it('leaves the action step map empty when no test matches', () => {
    const result = resolveYamlEnrichment(suiteFile(), 'a test that no longer exists');
    assert.deepEqual(result.actionStepsMap, {});
  });
});

describe('resolveYamlEnrichment — neither suite nor single test', () => {
  it('returns an empty enrichment rather than throwing', () => {
    const result = resolveYamlEnrichment({ referencedTemplatePaths: [] }, 'anything');
    assert.deepEqual(result, { actionStepsMap: {} });
  });
});

describe('loadCachedYaml', () => {
  function parsedFile(name: string): ParsedYamlTestFile {
    return { testFlow: flow(name), name, referencedTemplatePaths: [] };
  }

  it('parses once and serves the same object on a repeat lookup', () => {
    // The reporter builds a report per attempt per test, so a suite file was
    // re-read and re-expanded 20+ times per run before this cache existed.
    const cache = new Map<string, ParsedYamlTestFile | null>();
    const calls: string[] = [];
    const parse = (p: string) => {
      calls.push(p);
      return parsedFile('checkout');
    };

    const first = loadCachedYaml('/tests/checkout.test.yaml', cache, parse);
    const second = loadCachedYaml('/tests/checkout.test.yaml', cache, parse);

    assert.deepEqual(calls, ['/tests/checkout.test.yaml']);
    assert.equal(second, first);
  });

  it('caches a null result so a missing or unparseable file is not retried', () => {
    // Distinct from a cache miss: `Map.get` returns undefined when absent, so
    // a stored null must not send us back through the filesystem every attempt.
    const cache = new Map<string, ParsedYamlTestFile | null>();
    let calls = 0;
    const parse = () => {
      calls += 1;
      return null;
    };

    assert.equal(loadCachedYaml('/tests/gone.test.yaml', cache, parse), null);
    assert.equal(loadCachedYaml('/tests/gone.test.yaml', cache, parse), null);

    assert.equal(calls, 1);
  });

  it('keys on the path, so two files do not share an entry', () => {
    const cache = new Map<string, ParsedYamlTestFile | null>();
    const parse = (p: string) => parsedFile(p);

    const a = loadCachedYaml('/tests/a.test.yaml', cache, parse);
    const b = loadCachedYaml('/tests/b.test.yaml', cache, parse);

    assert.equal(a?.name, '/tests/a.test.yaml');
    assert.equal(b?.name, '/tests/b.test.yaml');
    assert.equal(cache.size, 2);
  });

  it('does not swallow a throwing parse — the caller owns error handling', () => {
    // The reporter's callback catches and returns null itself; if this function
    // also caught, a genuine bug in the callback would vanish silently.
    const cache = new Map<string, ParsedYamlTestFile | null>();

    assert.throws(
      () => loadCachedYaml('/tests/x.test.yaml', cache, () => { throw new Error('boom'); }),
      /boom/,
    );
    assert.equal(cache.size, 0);
  });
});
