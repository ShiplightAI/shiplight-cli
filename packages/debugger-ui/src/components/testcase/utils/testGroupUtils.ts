/**
 * Utilities for flattening/unflattening TestGroup ↔ flat TestFlow.
 *
 * Used by both the local debugger and cloud editor to render suite
 * test cases (TestFlow v1.3.0 with testGroup) in the step editor.
 */

import type { Statement, TestFlow, TestGroup } from 'shiplight-types';
import type { SectionType } from '../editor/SuiteSectionDivider';

export interface SuiteDivider {
  type: SectionType;
  label: string;
  skip?: boolean;
}

/** Clone statements with fresh UIDs, returning a map from new UID → original UID */
function cloneStatements(stmts: Statement[]): { cloned: Statement[]; uidMap: Map<string, string> } {
  const cloned: Statement[] = [];
  const uidMap = new Map<string, string>();
  for (const s of stmts) {
    const newUid = crypto.randomUUID();
    uidMap.set(newUid, s.uid);
    cloned.push({ ...s, uid: newUid });
  }
  return { cloned, uidMap };
}

/**
 * Flatten a test group into a single TestFlow for debugging/editing.
 * beforeEach/afterEach are cloned per test with unique UIDs so the editor steps sequentially.
 * Returns a dividerMap and a cloneUidMap (newUid → originalUid) for unflatten.
 */
export function flattenTestGroupToTestFlow(group: TestGroup): {
  testFlow: TestFlow;
  dividerMap: Map<string, SuiteDivider>;
  cloneUidMap: Map<string, string>;
} {
  const statements: Statement[] = [];
  const dividerMap = new Map<string, SuiteDivider>();
  const cloneUidMap = new Map<string, string>();

  const pushSection = (stmts: Statement[], divider: SuiteDivider) => {
    if (stmts.length > 0) {
      dividerMap.set(`before:${stmts[0].uid}`, divider);
      statements.push(...stmts);
    }
  };

  const pushClonedSection = (stmts: Statement[], divider: SuiteDivider) => {
    if (stmts.length > 0) {
      const { cloned, uidMap } = cloneStatements(stmts);
      for (const [newUid, origUid] of uidMap) cloneUidMap.set(newUid, origUid);
      dividerMap.set(`before:${cloned[0].uid}`, divider);
      statements.push(...cloned);
    }
  };

  pushSection(group.beforeAll ?? [], { type: 'beforeAll', label: 'beforeAll' });

  for (const test of group.tests) {
    const isSkipped = !!test.skip;
    pushClonedSection(group.beforeEach ?? [], { type: 'beforeEach', label: 'beforeEach' });
    pushSection(test.statements, { type: 'test', label: `Test: ${test.name}`, skip: isSkipped });
    if (test.teardown && test.teardown.length > 0) {
      pushSection(test.teardown, { type: 'teardown', label: `Teardown: ${test.name}` });
    }
    pushClonedSection(group.afterEach ?? [], { type: 'afterEach', label: 'afterEach' });
  }

  pushSection(group.afterAll ?? [], { type: 'afterAll', label: 'afterAll' });

  return { testFlow: { goal: '_suite', statements }, dividerMap, cloneUidMap };
}

/**
 * Unflatten a modified TestFlow back into test group structure.
 *
 * Uses UIDs to map statements back. `beforeEach`/`afterEach` appear once per
 * test in the flat view but are a single statement in the group, so their
 * clones are mapped back through `cloneUidMap`.
 *
 * When clones disagree, the EDITED one wins. This previously took the first
 * clone unconditionally, which silently discarded the user's work whenever they
 * edited any copy but the first: the editor does not sync copies as they are
 * typed, so the first clone still held the original text at save time.
 */
export function unflattenTestFlowToTestGroup(
  testFlow: TestFlow,
  originalGroup: TestGroup,
  cloneUidMap: Map<string, string>,
): TestGroup {
  // Original content per uid, so a clone can be told apart from an untouched one.
  const originalByUid = new Map<string, Statement>();
  const indexOriginals = (stmts?: Statement[]) => stmts?.forEach((s) => originalByUid.set(s.uid, s));
  indexOriginals(originalGroup.beforeAll);
  indexOriginals(originalGroup.afterAll);
  indexOriginals(originalGroup.beforeEach);
  indexOriginals(originalGroup.afterEach);
  for (const test of originalGroup.tests) {
    indexOriginals(test.statements);
    indexOriginals(test.teardown);
  }

  /**
   * Compare ignoring uid, which differs by construction between clones.
   *
   * Property-order dependent, which is safe here because both sides descend
   * from the same object: clones are `{ ...original, uid }` and editor updates
   * are `{ ...statement, field }`, and spread preserves insertion order. If
   * statements ever start being rebuilt from scratch rather than spread, this
   * needs a deep order-independent comparison — note that the
   * `JSON.stringify(value, keyArray)` replacer form is NOT that, since it
   * recurses and would drop nested keys absent from the top-level list.
   */
  const sameContent = (a: Statement, b: Statement): boolean => {
    const { uid: _a, ...restA } = a as Statement & { uid: string };
    const { uid: _b, ...restB } = b as Statement & { uid: string };
    return JSON.stringify(restA) === JSON.stringify(restB);
  };

  const uidToStatement = new Map<string, Statement>();
  for (const stmt of (testFlow.statements ?? [])) {
    const origUid = cloneUidMap.get(stmt.uid) ?? stmt.uid;
    const candidate = { ...stmt, uid: origUid };
    const existing = uidToStatement.get(origUid);
    if (!existing) {
      uidToStatement.set(origUid, candidate);
      continue;
    }
    const original = originalByUid.get(origUid);
    if (!original) continue;
    // Keep whichever copy the user actually changed.
    if (sameContent(existing, original) && !sameContent(candidate, original)) {
      uidToStatement.set(origUid, candidate);
    } else if (!sameContent(existing, original) && !sameContent(candidate, original)
      && !sameContent(existing, candidate)) {
      console.warn(
        `[suite-debugger] two copies of a shared hook statement were edited differently; ` +
        `keeping the first. Edit one copy only — they are the same statement.`,
      );
    }
  }

  const mapStatements = (originals: Statement[]): Statement[] =>
    originals.map((s) => uidToStatement.get(s.uid) ?? s);

  const originalUids = new Set<string>();
  const collectUids = (stmts?: Statement[]) => stmts?.forEach((s) => originalUids.add(s.uid));
  collectUids(originalGroup.beforeAll);
  collectUids(originalGroup.afterAll);
  collectUids(originalGroup.beforeEach);
  collectUids(originalGroup.afterEach);
  for (const test of originalGroup.tests) {
    collectUids(test.statements);
    collectUids(test.teardown);
  }
  const droppedCount = [...uidToStatement.keys()].filter((uid) => !originalUids.has(uid)).length;
  if (droppedCount > 0) {
    console.warn(
      `[suite-debugger] ${droppedCount} newly added statement(s) were not saved. ` +
      `Adding statements is not supported in suite debugger mode.`,
    );
  }

  return {
    ...originalGroup,
    beforeAll: originalGroup.beforeAll ? mapStatements(originalGroup.beforeAll) : undefined,
    afterAll: originalGroup.afterAll ? mapStatements(originalGroup.afterAll) : undefined,
    beforeEach: originalGroup.beforeEach ? mapStatements(originalGroup.beforeEach) : undefined,
    afterEach: originalGroup.afterEach ? mapStatements(originalGroup.afterEach) : undefined,
    tests: originalGroup.tests.map((test) => ({
      ...test,
      statements: mapStatements(test.statements),
      teardown: test.teardown ? mapStatements(test.teardown) : undefined,
    })),
  };
}
