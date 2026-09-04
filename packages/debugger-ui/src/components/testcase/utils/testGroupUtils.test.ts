/**
 * TestGroup ↔ flat TestFlow round trip (002 T028, US3).
 *
 * The suite debugger renders a suite as one sequential list, which means
 * `beforeEach`/`afterEach` are duplicated per test to mirror runtime. The
 * duplicates carry fresh UIDs so the editor can step through them
 * independently, and `cloneUidMap` is what maps them back on save. That
 * mapping is the whole correctness story: get it wrong and editing one copy of
 * a shared hook either fails to save or silently overwrites a different test's
 * statements.
 *
 * The module had no test despite owning that mapping.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { Statement, TestGroup } from 'shiplight-types';
import { flattenTestGroupToTestFlow, unflattenTestFlowToTestGroup } from './testGroupUtils';

function stmt(uid: string, intent: string): Statement {
  return { uid, type: 'DRAFT', intent } as unknown as Statement;
}

function group(): TestGroup {
  return {
    tests: [
      { name: 'login', statements: [stmt('t1s1', 'log in')] },
      { name: 'logout', statements: [stmt('t2s1', 'log out')], teardown: [stmt('t2td', 'clean up')] },
    ],
    beforeAll: [stmt('ba1', 'start server')],
    afterAll: [stmt('aa1', 'stop server')],
    beforeEach: [stmt('be1', 'open app')],
    afterEach: [stmt('ae1', 'close app')],
  } as unknown as TestGroup;
}

describe('flattenTestGroupToTestFlow', () => {
  it('lays sections out in runtime order, duplicating the each-hooks per test', () => {
    const { testFlow } = flattenTestGroupToTestFlow(group());
    const intents = (testFlow.statements ?? []).map((s) => (s as { intent: string }).intent);

    assert.deepEqual(intents, [
      'start server',
      'open app', // beforeEach, test 1
      'log in',
      'close app', // afterEach, test 1
      'open app', // beforeEach, test 2
      'log out',
      'clean up', // teardown belongs to the test, before afterEach
      'close app', // afterEach, test 2
      'stop server',
    ]);
  });

  it('gives every duplicated hook statement a distinct uid', () => {
    const { testFlow } = flattenTestGroupToTestFlow(group());
    const uids = (testFlow.statements ?? []).map((s) => s.uid);

    // Duplicate uids would make the editor step the same row twice and make
    // per-statement debug state ambiguous.
    assert.equal(new Set(uids).size, uids.length);
  });

  it('emits a divider keyed to the first statement of each section', () => {
    const { testFlow, dividerMap } = flattenTestGroupToTestFlow(group());
    const first = (testFlow.statements ?? [])[0];

    assert.deepEqual(dividerMap.get(`before:${first.uid}`), {
      type: 'beforeAll',
      label: 'beforeAll',
    });
    const labels = [...dividerMap.values()].map((d) => d.label);
    assert.ok(labels.includes('Test: login'));
    assert.ok(labels.includes('Teardown: logout'));
  });

  it('omits a section entirely when it has no statements', () => {
    const bare = {
      tests: [{ name: 'only', statements: [stmt('s1', 'do it')] }],
    } as unknown as TestGroup;

    const { testFlow, dividerMap } = flattenTestGroupToTestFlow(bare);

    assert.equal(testFlow.statements?.length, 1);
    assert.deepEqual([...dividerMap.values()].map((d) => d.type), ['test']);
  });

  it('marks a skipped test on its divider', () => {
    const g = {
      tests: [{ name: 'wip', statements: [stmt('s1', 'x')], skip: true }],
    } as unknown as TestGroup;

    const { dividerMap } = flattenTestGroupToTestFlow(g);

    assert.equal([...dividerMap.values()][0].skip, true);
  });
});

describe('unflattenTestFlowToTestGroup', () => {
  it('round-trips an unedited flow back to the original shape', () => {
    const original = group();
    const { testFlow, cloneUidMap } = flattenTestGroupToTestFlow(original);

    const back = unflattenTestFlowToTestGroup(testFlow, original, cloneUidMap);

    assert.deepEqual(back.tests.map((t) => t.name), ['login', 'logout']);
    assert.deepEqual(
      back.tests.map((t) => (t.statements[0] as unknown as { intent: string }).intent),
      ['log in', 'log out'],
    );
    assert.equal((back.beforeEach?.[0] as unknown as { intent: string }).intent, 'open app');
  });

  it('carries an edit to a test statement back to that test', () => {
    const original = group();
    const { testFlow, cloneUidMap } = flattenTestGroupToTestFlow(original);
    const edited = {
      ...testFlow,
      statements: (testFlow.statements ?? []).map((s) =>
        (s as unknown as { intent: string }).intent === 'log in'
          ? ({ ...s, intent: 'log in as admin' } as Statement)
          : s,
      ),
    };

    const back = unflattenTestFlowToTestGroup(edited, original, cloneUidMap);

    assert.equal(
      (back.tests[0].statements[0] as unknown as { intent: string }).intent,
      'log in as admin',
    );
  });

  it('syncs an edit to one copy of a shared hook across every test', () => {
    // The duplicates are one statement shown twice, not two statements. The
    // first matching clone wins, so editing either copy must update the single
    // underlying beforeEach.
    const original = group();
    const { testFlow, cloneUidMap } = flattenTestGroupToTestFlow(original);
    const statements = testFlow.statements ?? [];
    const secondCopyIndex = statements.findLastIndex(
      (s) => (s as unknown as { intent: string }).intent === 'open app',
    );
    const edited = {
      ...testFlow,
      statements: statements.map((s, i) =>
        i === secondCopyIndex ? ({ ...s, intent: 'open app (v2)' } as Statement) : s,
      ),
    };

    const back = unflattenTestFlowToTestGroup(edited, original, cloneUidMap);

    // Only one beforeEach exists in the group, so it takes the edited content.
    assert.equal(back.beforeEach?.length, 1);
    assert.equal((back.beforeEach?.[0] as unknown as { intent: string }).intent, 'open app (v2)');
  });

  it('drops statements the editor added, rather than inventing a section for them', () => {
    // Adding or removing whole sections is out of scope for the suite debugger;
    // an added row has no home in the group and is deliberately not saved.
    const original = group();
    const { testFlow, cloneUidMap } = flattenTestGroupToTestFlow(original);
    const edited = {
      ...testFlow,
      statements: [...(testFlow.statements ?? []), stmt('brand-new', 'added in the editor')],
    };

    const back = unflattenTestFlowToTestGroup(edited, original, cloneUidMap);

    const allIntents = [
      ...(back.beforeAll ?? []),
      ...(back.beforeEach ?? []),
      ...back.tests.flatMap((t) => [...t.statements, ...(t.teardown ?? [])]),
      ...(back.afterEach ?? []),
      ...(back.afterAll ?? []),
    ].map((s) => (s as unknown as { intent: string }).intent);

    assert.ok(!allIntents.includes('added in the editor'));
  });
});
