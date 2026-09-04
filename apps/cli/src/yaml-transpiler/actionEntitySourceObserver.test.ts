/**
 * `onActionEntitySource` — the transpiler's report of where each action's entity
 * came from.
 *
 * This is the ONLY point in the pipeline that can tell a cached entity from an
 * inline one: by the time the generated spec runs, both are just a locator in
 * the emitted code. The CLI feeds this into the run's cache summary, so a wrong
 * label here becomes a wrong cache hit rate on the customer's usage view.
 */

import { describe, it, after } from 'node:test';
import * as assert from 'node:assert/strict';
import { writeFileSync, readFileSync, mkdirSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import type { ActionEntityStore } from 'shiplight-types';
import { transpileYamlContent } from './pipeline';
import { parseYamlTestFile } from './yamlParser';

const tmpDir = join(tmpdir(), 'entity-source-observer-' + Date.now());

const YAML = `goal: Login test
statements:
  - URL: /login
  - intent: Enter username
    action: input_text
    locator: "getByRole('textbox', { name: 'Username' })"
    text: admin
  - intent: Click login
    action: click
    locator: "getByRole('button', { name: 'Login' })"
`;

interface Seen {
  uid: string;
  description: string;
  source: 'original' | 'cache_hit';
}

/**
 * One parse, reusable across transpiles.
 *
 * UIDs are `sha256(filePath : statementPath : description)`, so they are stable
 * across parses of the same file — but they change with the FILE PATH. Each call
 * here writes a uniquely-named temp file, so a store keyed off one call's UIDs
 * would silently miss on the next and report every action as `original`. Reusing
 * one parse keeps the path (and therefore the keys) fixed.
 */
function freshParse() {
  const filePath = join(tmpDir, `t-${Math.random().toString(36).slice(2)}.test.yaml`);
  writeFileSync(filePath, YAML);
  return { filePath, parsed: parseYamlTestFile(YAML, filePath) };
}

/** Transpile once, capturing every reported action source. */
function transpileAndObserve(
  ctx: ReturnType<typeof freshParse>,
  store?: ActionEntityStore,
): Seen[] {
  const seen: Seen[] = [];
  const result = transpileYamlContent(YAML, ctx.filePath, {
    parsed: ctx.parsed,
    actionEntityStore: store,
    onActionEntitySource: (info) =>
      seen.push({ uid: info.uid, description: info.description, source: info.source }),
  });
  assert.equal(result.valid, true, 'transpile should succeed');
  return seen;
}

describe('onActionEntitySource', () => {
  mkdirSync(tmpDir, { recursive: true });
  after(() => rmSync(tmpDir, { recursive: true, force: true }));

  it('labels every action original when no cache is supplied', () => {
    const seen = transpileAndObserve(freshParse());

    assert.ok(seen.length >= 2, 'should observe the actions');
    assert.equal(seen.every((s) => s.source === 'original'), true);
    assert.ok(seen.some((s) => s.description === 'Click login'));
  });

  it('labels only the cached statement as a hit', () => {
    // Build a store the same way the orchestrator does: entries keyed by
    // statement UID, carrying the entity the cache resolved.
    const ctx = freshParse();
    const probe = transpileAndObserve(ctx);
    const clickUid = probe.find((s) => s.description === 'Click login')!.uid;
    const store: ActionEntityStore = {
      entries: {
        [clickUid]: {
          action_entity: {
            action_description: 'Click login',
            action_data: { action_name: 'click', kwargs: {} },
            locator: "getByTestId('healed-login-btn')",
          },
        },
      },
    } as unknown as ActionEntityStore;

    // Same `ctx` — the store is keyed on UIDs from THAT parse.
    const seen = transpileAndObserve(ctx, store);

    const click = seen.find((s) => s.description === 'Click login');
    const other = seen.filter((s) => s.description !== 'Click login');
    assert.equal(click?.source, 'cache_hit');
    // Everything the cache did not serve must stay `original`; labelling the
    // whole file a hit because one entry matched would inflate the rate.
    assert.equal(other.every((s) => s.source === 'original'), true);
  });

  it('does not report actions that resolved to no entity at all', () => {
    // A description-only statement falls back to agent.execute() — it was never
    // a cache candidate, so counting it would deflate the hit rate with
    // statements the cache can never serve.
    const yaml = `goal: Freeform
statements:
  - intent: Do something the model figures out
`;
    const filePath = join(tmpDir, `freeform-${Math.random().toString(36).slice(2)}.test.yaml`);
    writeFileSync(filePath, yaml);
    const seen: Seen[] = [];
    transpileYamlContent(yaml, filePath, {
      parsed: parseYamlTestFile(yaml, filePath),
      onActionEntitySource: (info) =>
        seen.push({ uid: info.uid, description: info.description, source: info.source }),
    });

    assert.equal(seen.length, 0);
  });

  it('gives hook statements UIDs that survive a re-transpile', () => {
    // Hooks are parsed separately from the main flow, through yamlToTestFlow,
    // which stamps a fresh uuidv4() on every statement. Without deterministic
    // re-keying the store lookup can never match, so every hook action reports
    // `original` forever — and a heal inside a hook is written back to the
    // cache under a UUID that will never be generated again.
    const yaml = `goal: Hooked
beforeEach:
  - intent: Log in
    action: click
    locator: "getByRole('button', { name: 'Login' })"
statements:
  - intent: Do the thing
    action: click
    locator: "getByRole('button', { name: 'Go' })"
`;
    const filePath = join(tmpDir, 'hooked.test.yaml');
    writeFileSync(filePath, yaml);

    const observe = () => {
      const seen: Seen[] = [];
      transpileYamlContent(yaml, filePath, {
        parsed: parseYamlTestFile(yaml, filePath),
        onActionEntitySource: (info) =>
          seen.push({ uid: info.uid, description: info.description, source: info.source }),
      });
      return seen;
    };

    const first = observe();
    const second = observe();
    const uidFor = (seen: Seen[], desc: string) => seen.find((s) => s.description === desc)?.uid;

    assert.ok(uidFor(first, 'Log in'), 'hook action should be observed');
    assert.equal(uidFor(first, 'Log in'), uidFor(second, 'Log in'));
    // And distinct from the main-flow statement, so the two never collide.
    assert.notEqual(uidFor(first, 'Log in'), uidFor(first, 'Do the thing'));
  });

  it('serves a cached entity to a hook action', () => {
    const yaml = `goal: Hooked
beforeEach:
  - intent: Log in
    action: click
    locator: "getByRole('button', { name: 'Login' })"
statements:
  - intent: Do the thing
    action: click
    locator: "getByRole('button', { name: 'Go' })"
`;
    const filePath = join(tmpDir, 'hooked-cache.test.yaml');
    writeFileSync(filePath, yaml);

    const run = (store?: ActionEntityStore) => {
      const seen: Seen[] = [];
      transpileYamlContent(yaml, filePath, {
        parsed: parseYamlTestFile(yaml, filePath),
        actionEntityStore: store,
        onActionEntitySource: (info) =>
          seen.push({ uid: info.uid, description: info.description, source: info.source }),
      });
      return seen;
    };

    const hookUid = run().find((s) => s.description === 'Log in')!.uid;
    const store = {
      entries: {
        [hookUid]: {
          action_entity: {
            action_description: 'Log in',
            action_data: { action_name: 'click', kwargs: {} },
            locator: "getByTestId('healed-login')",
          },
        },
      },
    } as unknown as ActionEntityStore;

    const seen = run(store);
    assert.equal(seen.find((s) => s.description === 'Log in')?.source, 'cache_hit');
    assert.equal(seen.find((s) => s.description === 'Do the thing')?.source, 'original');
  });

  it('does not report AI actions that a worker-scoped hook skips', () => {
    // beforeAll/afterAll transpile with noAgent, where an AI action is emitted
    // as a comment and never runs. Counting it would inflate the run's total
    // with code that cannot execute.
    const yaml = `suite:
  beforeAll:
    - intent: Check the banner is visible
      action: verify
    - intent: Go to the login page
      action: goto
      url: /login
  tests:
    - name: t1
      statements:
        - intent: Do the thing
          action: click
          locator: "getByRole('button', { name: 'Go' })"
`;
    const filePath = join(tmpDir, 'suite-hooks.test.yaml');
    writeFileSync(filePath, yaml);
    const seen: Seen[] = [];
    const result = transpileYamlContent(yaml, filePath, {
      parsed: parseYamlTestFile(yaml, filePath),
      onActionEntitySource: (info) =>
        seen.push({ uid: info.uid, description: info.description, source: info.source }),
    });

    assert.equal(result.valid, true);
    assert.equal(seen.some((s) => s.description === 'Check the banner is visible'), false);
    // The non-AI hook action DOES run in noAgent mode, so it still counts.
    assert.equal(seen.some((s) => s.description === 'Go to the login page'), true);
    assert.equal(seen.some((s) => s.description === 'Do the thing'), true);
  });

  it('gives suite test statements UIDs that survive a re-transpile', () => {
    // Playwright re-imports playwright.config.ts in EVERY worker process, so
    // transpilation runs again per worker. If a suite's UIDs were regenerated
    // each time, the worker would execute a spec whose UIDs no longer match the
    // ones the main process recorded, and every heal inside a suite test would
    // be dropped from the cache summary AND from the cache write-back (which
    // matches healed UIDs against the on-disk spec text).
    const yaml = `suite:
  tests:
    - name: t1
      statements:
        - intent: Click one
          action: click
          locator: "getByRole('button', { name: 'One' })"
    - name: t2
      statements:
        - intent: Click two
          action: click
          locator: "getByRole('button', { name: 'Two' })"
`;
    const filePath = join(tmpDir, 'suite-uids.test.yaml');
    writeFileSync(filePath, yaml);

    const observe = () => {
      const seen: Seen[] = [];
      transpileYamlContent(yaml, filePath, {
        parsed: parseYamlTestFile(yaml, filePath),
        onActionEntitySource: (info) =>
          seen.push({ uid: info.uid, description: info.description, source: info.source }),
      });
      return seen;
    };

    const first = observe();
    const second = observe();
    const uidFor = (seen: Seen[], desc: string) => seen.find((s) => s.description === desc)?.uid;

    assert.ok(uidFor(first, 'Click one'), 'suite statement should be observed');
    assert.equal(uidFor(first, 'Click one'), uidFor(second, 'Click one'));
    assert.equal(uidFor(first, 'Click two'), uidFor(second, 'Click two'));
    // Two tests in one suite must not collide on the same statement index.
    assert.notEqual(uidFor(first, 'Click one'), uidFor(first, 'Click two'));
  });

  it('emits a byte-identical suite spec on re-transpile', () => {
    // The property the worker re-transpile depends on: rewriting the spec must
    // be a no-op. Asserted on the emitted file, not just the UIDs, so any other
    // source of nondeterminism in suite codegen is caught here too.
    const yaml = `suite:
  tests:
    - name: t1
      statements:
        - intent: Click one
          action: click
          locator: "getByRole('button', { name: 'One' })"
`;
    const filePath = join(tmpDir, 'suite-stable.test.yaml');
    const specPath = filePath.replace(/\.test\.yaml$/, '.yaml.spec.ts');
    writeFileSync(filePath, yaml);

    const emit = () => {
      transpileYamlContent(yaml, filePath, { parsed: parseYamlTestFile(yaml, filePath) });
      return readFileSync(specPath, 'utf-8');
    };

    assert.equal(emit(), emit());
  });

  it('serves a cached entity to a suite test statement', () => {
    const yaml = `suite:
  tests:
    - name: t1
      statements:
        - intent: Click one
          action: click
          locator: "getByRole('button', { name: 'One' })"
`;
    const filePath = join(tmpDir, 'suite-cache.test.yaml');
    writeFileSync(filePath, yaml);

    const run = (store?: ActionEntityStore) => {
      const seen: Seen[] = [];
      transpileYamlContent(yaml, filePath, {
        parsed: parseYamlTestFile(yaml, filePath),
        actionEntityStore: store,
        onActionEntitySource: (info) =>
          seen.push({ uid: info.uid, description: info.description, source: info.source }),
      });
      return seen;
    };

    const uid = run().find((s) => s.description === 'Click one')!.uid;
    const store = {
      entries: {
        [uid]: {
          action_entity: {
            action_description: 'Click one',
            action_data: { action_name: 'click', kwargs: {} },
            locator: "getByTestId('healed-one')",
          },
        },
      },
    } as unknown as ActionEntityStore;

    assert.equal(run(store).find((s) => s.description === 'Click one')?.source, 'cache_hit');
  });

  it('is optional — transpiling without it behaves identically', () => {
    const filePath = join(tmpDir, `nocb-${Math.random().toString(36).slice(2)}.test.yaml`);
    writeFileSync(filePath, YAML);
    const parsed = parseYamlTestFile(YAML, filePath);

    const withCb = transpileYamlContent(YAML, filePath, { parsed, onActionEntitySource: () => {} });
    const withoutCb = transpileYamlContent(YAML, filePath, { parsed });

    // Purely observational: the emitted spec must not depend on whether anyone
    // is listening.
    assert.equal(withCb.valid, withoutCb.valid);
  });
});
