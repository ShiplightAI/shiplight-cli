/**
 * YAML TestFlow Parser
 *
 * Converts between JSON TestFlow and clean YAML format for local file storage.
 * - testFlowToYaml: JSON → clean YAML (strips runtime noise)
 * - yamlToTestFlow: YAML string → full JSON TestFlow (generates UIDs, validates)
 */

import { stringify as yamlStringify, parse as yamlParse, parseAllDocuments, parseDocument, Document, isMap, isSeq, type YAMLSeq, type YAMLMap, type Node as YamlNode } from 'yaml';
import { v4 as uuidv4 } from 'uuid';
import { TestFlowSchema } from './testFlowSchema.js';
import type { TestFlow, Statement, Action, Draft, Step, IfElse, WhileLoop, Condition, TestGroup, TestGroupEntry } from './testFlow.js';
import type { ActionEntity } from './actionEntity.js';
import { StatementType, ConditionType } from './testFlow.js';
import { TestGroupSchema } from './testFlowSchema.js';

// ============================================================================
// Types for YAML representation
// ============================================================================

/** Metadata fields that live in YAML but NOT in the TestFlow interface */
export interface YamlFlowMetadata {
  test_case_id?: number;
  template_id?: number;
  name?: string;
  timeout?: number;
  settings?: Record<string, unknown>;
  use?: Record<string, unknown>;
  tags?: string[];
  skip?: boolean | string;
  fail?: boolean | string;
  only?: boolean;
  slow?: boolean;
  beforeEach?: unknown[];
  afterEach?: unknown[];
  parameters?: unknown[];
}

/** A YAML statement is a structured object (ACTION, VERIFY, URL, CODE, STEP, IF, WHILE, or intent-only DRAFT) */
type YamlStatement = string | YamlStatementObject;

interface YamlStatementObject {
  // For flat ACTION syntax (action: click, locator: ..., etc.)
  action?: string;

  // For ACTION / DRAFT (intent is canonical; desc accepted for backward compat)
  intent?: string;
  desc?: string;
  locator?: string;
  xpath?: string;
  use_pure_vision?: boolean;

  // For STEP
  STEP?: string;
  statements?: YamlStatement[];

  // For IF_ELSE
  IF?: string;
  THEN?: YamlStatement[];
  ELSE?: YamlStatement[];

  // For WHILE_LOOP
  WHILE?: string;
  DO?: YamlStatement[];
  timeout_ms?: number;

  // Shorthands
  VERIFY?: string;
  js?: string;         // JS code for VERIFY cache, or the description+js escape hatch
  description?: string; // Label for the description+js escape hatch (informational)
  URL?: string;
  new_tab?: boolean;
  timeout_seconds?: number;
  CODE?: string;       // Deprecated alias for description+js (still parsed)

  // For STEP with reference_id (cloud) or template (local)
  reference_id?: number;
  // Used by stepToYaml for serialization; raw `template:` in user YAML
  // is consumed by expandTemplates before reaching parseStep.
  template?: string;
  params?: Record<string, string>;
}


export interface YamlTestFlow {
  test_case_id?: number;
  name?: string;
  tags?: string[];
  skip?: boolean | string;
  fail?: boolean | string;
  only?: boolean;
  slow?: boolean;
  goal: string;
  url?: string;       // auto-navigates (backward compat)
  base_url?: string;  // Playwright baseURL, no auto-navigate
  timeout?: number;   // test-level timeout in ms
  settings?: Record<string, unknown>;
  use?: Record<string, unknown>;
  beforeEach?: unknown[];
  afterEach?: unknown[];
  parameters?: unknown[];
  final_feedback?: string;
  statements: YamlStatement[];
  teardown?: YamlStatement[];
}

// ============================================================================
// JSON → YAML (testFlowToYaml)
// ============================================================================

/**
 * Convert a JSON TestFlow to clean YAML string.
 * Strips: uid, version, completed, success, action_entity.url, action_entity.feedback,
 *         action_entity.artifacts, action_entity.action_description
 * Keeps: goal, url, final_feedback, statements structure, description, action_entity.action_data,
 *        action_entity.locator/xpath
 * Applies shorthand: DRAFT → `intent:` only, verify → `VERIFY:`, etc.
 */
/** Build the plain YAML object for a TestFlow without stringifying. */
export function testFlowToYamlObject(testFlow: TestFlow, metadata?: YamlFlowMetadata): YamlTestFlow {
  const yamlObj: YamlTestFlow = {
    ...(metadata?.test_case_id !== undefined ? { test_case_id: metadata.test_case_id } : {}),
    ...(metadata?.name ? { name: metadata.name } : {}),
    ...(metadata?.tags && metadata.tags.length > 0 ? { tags: metadata.tags } : {}),
    ...(metadata?.skip !== undefined ? { skip: metadata.skip } : {}),
    ...(metadata?.fail !== undefined ? { fail: metadata.fail } : {}),
    ...(metadata?.only ? { only: metadata.only } : {}),
    ...(metadata?.slow ? { slow: metadata.slow } : {}),
    goal: testFlow.goal ?? '',
    url: testFlow.url,
    base_url: testFlow.baseURL,
    ...(metadata?.timeout !== undefined ? { timeout: metadata.timeout } : {}),
    ...(metadata?.settings && Object.keys(metadata.settings).length > 0 ? { settings: metadata.settings } : {}),
    ...(metadata?.use && Object.keys(metadata.use).length > 0 ? { use: metadata.use } : {}),
    ...(metadata?.beforeEach && metadata.beforeEach.length > 0 ? { beforeEach: metadata.beforeEach } : {}),
    ...(metadata?.afterEach && metadata.afterEach.length > 0 ? { afterEach: metadata.afterEach } : {}),
    ...(metadata?.parameters && metadata.parameters.length > 0 ? { parameters: metadata.parameters } : {}),
    statements: (testFlow.statements ?? []).map(statementToYaml),
  };

  if (testFlow.final_feedback) {
    yamlObj.final_feedback = testFlow.final_feedback;
  }

  if (testFlow.teardown && testFlow.teardown.length > 0) {
    yamlObj.teardown = testFlow.teardown.map(statementToYaml);
  }

  return yamlObj;
}

const YAML_STRINGIFY_OPTIONS = {
  lineWidth: 120,
  defaultKeyType: 'PLAIN',
  defaultStringType: 'PLAIN',
} as const;

/** Convert a TestFlow to a YAML string (single document). Delegates to suiteToYaml for test groups. */
export function testFlowToYaml(testFlow: TestFlow, metadata?: YamlFlowMetadata): string {
  if (testFlow.testGroup) {
    return suiteToYaml(testFlow, metadata);
  }
  const yamlObj = testFlowToYamlObject(testFlow, metadata);
  const doc = new Document(yamlObj);

  // tags should serialize as flow sequence: tags: [smoke, regression]
  const tagsNode = (doc.contents as YAMLMap)?.get('tags', true);
  if (isSeq(tagsNode)) (tagsNode as YAMLSeq).flow = true;

  // Attach top-of-file comment
  if (testFlow.comment) {
    doc.commentBefore = testFlow.comment;
  }

  // Attach statement comments
  attachCommentsToYamlDoc(doc, testFlow.statements ?? []);

  // Attach teardown comments
  if (testFlow.teardown) {
    attachCommentsToYamlDoc(doc, testFlow.teardown, 'teardown');
  }

  return doc.toString(YAML_STRINGIFY_OPTIONS);
}

/** Attach statement comments to the YAML document AST before stringifying. */
function attachCommentsToYamlDoc(doc: Document, statements: Statement[], seqKey = 'statements'): void {
  const root = doc.contents;
  if (!root || !isMap(root)) return;

  const seq = (root as YAMLMap).get(seqKey, true);
  if (!isSeq(seq)) return;

  attachCommentsToSeq(seq, statements);
}

/** Recursively attach comments and blank-line spacing to a YAML sequence from statements. */
function attachCommentsToSeq(seq: YAMLSeq, statements: Statement[]): void {
  for (let i = 0; i < Math.min(seq.items.length, statements.length); i++) {
    const stmt = statements[i];
    const node = seq.items[i] as YamlNode;

    // Add blank line between statements (conventional YAML formatting)
    if (i > 0) {
      node.spaceBefore = true;
    }

    if (stmt.comment) {
      if (i === 0) {
        // First item's comment goes on the sequence node itself
        seq.commentBefore = stmt.comment;
      } else {
        node.commentBefore = stmt.comment;
      }
    }

    // Recurse into nested statements
    if (isMap(node)) {
      const nodeMap = node as YAMLMap;
      if (stmt.type === StatementType.STEP) {
        const innerSeq = nodeMap.get('statements', true);
        if (isSeq(innerSeq)) {
          attachCommentsToSeq(innerSeq, (stmt as Step).statements);
        }
      } else if (stmt.type === StatementType.IF_ELSE) {
        const thenSeq = nodeMap.get('THEN', true);
        if (isSeq(thenSeq)) {
          attachCommentsToSeq(thenSeq, (stmt as IfElse).then);
        }
        const elseSeq = nodeMap.get('ELSE', true);
        if (isSeq(elseSeq) && (stmt as IfElse).else) {
          attachCommentsToSeq(elseSeq, (stmt as IfElse).else!);
        }
      } else if (stmt.type === StatementType.WHILE_LOOP) {
        const bodySeq = nodeMap.get('DO', true);
        if (isSeq(bodySeq)) {
          attachCommentsToSeq(bodySeq, (stmt as WhileLoop).body);
        }
      }
    }
  }
}

/** Section types for suite debugger display */
export type SectionType = 'beforeAll' | 'beforeEach' | 'test' | 'afterEach' | 'afterAll' | 'teardown';

/** @deprecated Use TestGroup from testFlow.ts instead */
export type DebuggerSuite = TestGroup & { base_url?: string };

/** Suite-level metadata for YAML serialization */
export interface SuiteYamlMetadata extends YamlFlowMetadata {
  tags?: string[];
  use?: Record<string, unknown>;
}

/**
 * Normalize a raw YAML `tags` value into a list of tag strings.
 *
 * Deliberately permissive, and it must stay in step with `normalizeTags` in the
 * transpiler (apps/cli/src/yaml-transpiler/transpile.ts). When
 * the two disagree, the transpiler honors a tag that a debugger save then
 * deletes — the user's `--grep` CI job silently selects nothing, with no error
 * anywhere. Accepts a bare scalar (`tags: smoke`) as a one-element list,
 * stringifies scalar entries (`tags: [2026]` parses as a number), and drops
 * blanks plus maps/sequences, which can only stringify into junk like
 * `[object Object]`.
 */
function toTagList(raw: unknown): string[] {
  const entries = Array.isArray(raw) ? raw : raw === null || raw === undefined ? [] : [raw];
  return entries
    .filter((t: unknown) => t === null || t === undefined || typeof t !== 'object')
    .map((t: unknown) => String(t ?? '').trim())
    .filter((t: string) => t.length > 0);
}

/** Convert a TestFlow with testGroup to a YAML string (YAML uses `suite:` key). */
export function suiteToYaml(testFlow: TestFlow, metadata?: SuiteYamlMetadata): string {
  const group = testFlow.testGroup;
  if (!group) {
    throw new Error('suiteToYaml requires a TestFlow with testGroup');
  }

  const doc: Record<string, unknown> = {};

  if (metadata?.test_case_id !== undefined) doc.test_case_id = metadata.test_case_id;
  if (metadata?.name) doc.name = metadata.name;
  // Top level, matching testFlowToYamlObject and the documented spec key.
  // This used to be written nested under `suite:`, which meant a debugger save
  // relocated a hand-written top-level `base_url` into the undocumented
  // spelling. Both spellings still parse — see yamlSuiteToTestFlow.
  if (testFlow.baseURL) doc.base_url = testFlow.baseURL;
  if (metadata?.tags && metadata.tags.length > 0) doc.tags = metadata.tags;
  if (metadata?.use && Object.keys(metadata.use).length > 0) doc.use = metadata.use;
  if (metadata?.settings && Object.keys(metadata.settings).length > 0) doc.settings = metadata.settings;

  const suiteObj: Record<string, unknown> = {};

  if (group.beforeAll && group.beforeAll.length > 0) {
    suiteObj.beforeAll = group.beforeAll.map(statementToYaml);
  }
  if (group.beforeEach && group.beforeEach.length > 0) {
    suiteObj.beforeEach = group.beforeEach.map(statementToYaml);
  }
  if (group.afterEach && group.afterEach.length > 0) {
    suiteObj.afterEach = group.afterEach.map(statementToYaml);
  }
  if (group.afterAll && group.afterAll.length > 0) {
    suiteObj.afterAll = group.afterAll.map(statementToYaml);
  }

  suiteObj.tests = group.tests.map((test) => {
    const testObj: Record<string, unknown> = { name: test.name };
    if (test.tags && test.tags.length > 0) testObj.tags = test.tags;
    if (test.skip !== undefined) testObj.skip = test.skip;
    if (test.timeout !== undefined) testObj.timeout = test.timeout;
    if (test.fail !== undefined) testObj.fail = test.fail;
    if (test.only !== undefined) testObj.only = test.only;
    if (test.slow !== undefined) testObj.slow = test.slow;

    testObj.statements = test.statements.map(statementToYaml);

    if (test.teardown && test.teardown.length > 0) {
      testObj.teardown = test.teardown.map(statementToYaml);
    }

    return testObj;
  });

  doc.suite = suiteObj;
  const yamlDoc = new Document(doc);
  const tagsNode = (yamlDoc.contents as YAMLMap)?.get('tags', true);
  if (isSeq(tagsNode)) (tagsNode as YAMLSeq).flow = true;
  // Per-test tags too, so a save does not reformat one level and not the other.
  const suiteNode = (yamlDoc.contents as YAMLMap)?.get('suite', true);
  const testsNode = isMap(suiteNode) ? (suiteNode as YAMLMap).get('tests', true) : undefined;
  if (isSeq(testsNode)) {
    for (const testNode of (testsNode as YAMLSeq).items) {
      if (!isMap(testNode)) continue;
      const testTags = (testNode as YAMLMap).get('tags', true);
      if (isSeq(testTags)) (testTags as YAMLSeq).flow = true;
    }
  }
  return yamlDoc.toString(YAML_STRINGIFY_OPTIONS);
}

/** Convert an array of YAML flow objects to a multi-document YAML string (separated by ---). */
export function yamlObjectsToString(objects: YamlTestFlow[]): string {
  return objects.map(obj => yamlStringify(obj, YAML_STRINGIFY_OPTIONS)).join('---\n');
}

function statementToYaml(stmt: Statement): YamlStatement {
  switch (stmt.type) {
    case StatementType.DRAFT:
      return draftToYaml(stmt);
    case StatementType.ACTION:
      return actionToYaml(stmt);
    case StatementType.STEP:
      return stepToYaml(stmt);
    case StatementType.IF_ELSE:
      return ifElseToYaml(stmt);
    case StatementType.WHILE_LOOP:
      return whileLoopToYaml(stmt);
  }
}

function draftToYaml(draft: Draft): YamlStatement {
  return { intent: draft.description };
}

function actionToYaml(action: Action): YamlStatement {
  const actionName = action.action_entity?.action_data?.action_name
    ?? action.action_entity?.action?.action_name;
  const kwargs = action.action_entity?.action_data?.kwargs
    ?? action.action_entity?.action?.kwargs;

  // Check for verify shorthand
  if (actionName === 'verify') {
    const statement = kwargs?.statement;
    if (typeof statement === 'string' && !action.action_entity?.locator && !action.action_entity?.xpath) {
      const code = kwargs?.code;
      if (typeof code === 'string' && code.trim()) {
        return { VERIFY: statement, js: code };
      }
      return { VERIFY: statement };
    }
  }

  // Check for URL shorthand
  if (actionName === 'go_to_url') {
    const url = kwargs?.url;
    if (typeof url === 'string' && !action.action_entity?.locator && !action.action_entity?.xpath) {
      const result: Record<string, unknown> = { URL: url };
      if (kwargs?.new_tab === true) result.new_tab = true;
      if (typeof kwargs?.timeout_seconds === 'number') result.timeout_seconds = kwargs.timeout_seconds;
      return result;
    }
  }

  // Legacy js_action entities serialize to the current non-healing `description: + js:` form.
  if (actionName === 'js_action') {
    const code = kwargs?.code;
    if (typeof code === 'string' && code.trim() && action.description) {
      return { description: action.description, js: code };
    }
  }

  // Check for WAIT_UNTIL shorthand
  if (actionName === 'ai_wait_until') {
    const condition = kwargs?.condition;
    if (typeof condition === 'string') {
      const js = typeof kwargs?.js === 'string' && kwargs.js.trim() ? kwargs.js : undefined;
      const result: Record<string, unknown> = {};
      if (js) {
        // Intent + sibling `js:` form: WAIT_UNTIL keeps the human-readable intent.
        result.WAIT_UNTIL = condition;
        result.js = js;
      } else {
        // Re-add the `js:` prefix for JS_CODE conditions so round-trips are lossless.
        const conditionType =
          kwargs?.condition_type === ConditionType.JS_CODE
            ? ConditionType.JS_CODE
            : ConditionType.AI_MODE;
        result.WAIT_UNTIL = formatCondition({ type: conditionType, expression: condition });
      }
      if (typeof kwargs?.timeout_seconds === 'number' && kwargs.timeout_seconds !== 60) {
        result.timeout_seconds = kwargs.timeout_seconds;
      }
      return result;
    }
  }

  // Check for WAIT shorthand
  if (actionName === 'wait') {
    const seconds = kwargs?.seconds;
    const desc = action.description || `Wait ${seconds}s`;
    const result: Record<string, unknown> = { WAIT: desc };
    if (typeof seconds === 'number') result.seconds = seconds;
    return result;
  }

  // Raw code escape hatch → `description: + js:`
  if (actionName === 'js_code') {
    const code = kwargs?.code;
    if (typeof code === 'string' && !action.action_entity?.locator && !action.action_entity?.xpath) {
      return { description: action.description || 'Code block', js: code };
    }
  }

  // ACTION without action_entity → intent-only (like a DRAFT)
  if (!action.action_entity) {
    return { intent: action.description };
  }

  // ACTION with action_entity → flat syntax
  const actionData = action.action_entity.action_data ?? action.action_entity.action;
  if (!actionData) {
    // No action_data — fall back to intent-only
    return { intent: action.description };
  }

  // Preserve the current function-call shorthand. Positional `args` belongs in
  // kwargs after parsing, while legacy function actions use
  // parameterNames/parameterValues (or action_data.args) and continue through
  // the generic `action: function` serializer below.
  if (
    actionData.action_name === 'function'
    && typeof actionData.kwargs?.functionName === 'string'
    && actionData.kwargs.functionName.includes('#')
    && !Array.isArray(actionData.kwargs.parameterNames)
    && !Array.isArray(actionData.kwargs.parameterValues)
    && (!Array.isArray(actionData.args) || actionData.args.length === 0)
  ) {
    const result: Record<string, unknown> = {
      intent: action.description,
      call: actionData.kwargs.functionName,
    };
    if (Array.isArray(actionData.kwargs.args) && actionData.kwargs.args.length > 0) {
      result.args = actionData.kwargs.args;
    }
    return result as YamlStatementObject;
  }

  const result: Record<string, unknown> = {
    intent: action.description,
    action: actionData.action_name,
  };

  // Locator: prefer ACTION-level override, then entity-level
  const locator = action.locator ?? action.action_entity.locator;
  if (locator) result.locator = locator;

  const xpath = action.action_entity.xpath;
  if (xpath) result.xpath = xpath;

  if (action.use_pure_vision) result.use_pure_vision = true;

  // Hoist kwargs as top-level keys (skip runtime-only fields that don't belong in YAML)
  if (actionData.kwargs && Object.keys(actionData.kwargs).length > 0) {
    for (const [key, value] of Object.entries(actionData.kwargs)) {
      if (key === 'uid') continue;
      // `statement` is redundant for ai_action/ai_step — it duplicates `intent`
      if (key === 'statement' && (actionName === 'ai_action' || actionName === 'ai_step')) continue;
      result[key] = value;
    }
  }

  // args is rare but preserve it if present
  if (actionData.args && actionData.args.length > 0) {
    result.args = actionData.args;
  }

  return result as YamlStatementObject;
}

// ============================================================================
// ActionEntity ↔ YAML display format converters
// ============================================================================

/**
 * YAML keys that map to ActionEntity/Action fields, not kwargs.
 * `js` is reserved because it doubles as the code-escape-hatch shorthand; without it,
 * a stray `js:` on a structured action would leak into the action's kwargs.
 */
const RESERVED_YAML_KEYS = new Set(['intent', 'description', 'action', 'locator', 'xpath', 'frame_path', 'args', 'js']);

/**
 * Convert an ActionEntity to a flat YAML display string.
 * Reuses the same format as actionToYaml but works with standalone ActionEntity.
 */
export function actionEntityToYaml(
  actionEntity: ActionEntity,
  description?: string,
  locator?: string,
): string {
  // Build a fake Action to reuse actionToYaml logic
  const fakeAction: Action = {
    uid: '',
    type: StatementType.ACTION,
    description: description || actionEntity.action_description || '',
    action_entity: actionEntity,
    locator: locator,
  };
  const yamlObj = actionToYaml(fakeAction);
  // Strip keys redundant with the statement description shown in the UI.
  // `description` is dropped because the editor shows it separately; if this flat
  // YAML is pasted into a .test.yaml file, the label defaults to "Code block" on re-parse.
  if (typeof yamlObj === 'object' && yamlObj !== null) {
    const stripped: Record<string, unknown> = { ...yamlObj };
    delete stripped.intent;
    delete stripped.description;
    delete stripped.VERIFY;
    delete stripped.WAIT_UNTIL;
    delete stripped.WAIT;
    delete stripped.statement;
    // If anything remains after stripping, use it; otherwise return empty
    if (Object.keys(stripped).length > 0) {
      return yamlStringify(stripped, YAML_STRINGIFY_OPTIONS).trim();
    }
    return '';
  }
  return yamlStringify(yamlObj, YAML_STRINGIFY_OPTIONS).trim();
}

/**
 * Parse a flat YAML display string back to ActionEntity + description + locator.
 * Inverse of actionEntityToYaml.
 */
export function yamlToActionEntity(yamlString: string): {
  actionEntity: ActionEntity;
  description?: string;
  locator?: string;
} {
  const parsed = yamlParse(yamlString) as Record<string, unknown>;
  if (!parsed || typeof parsed !== 'object') {
    throw new Error('Invalid YAML: expected an object');
  }

  // Handle shorthand forms
  if ('VERIFY' in parsed) {
    const statement = String(parsed.VERIFY);
    const code = typeof parsed.js === 'string' ? parsed.js : undefined;
    return {
      description: statement,
      actionEntity: {
        action_description: statement,
        action_data: {
          action_name: 'verify',
          kwargs: {
            statement,
            ...(code ? { code } : {}),
          },
        },
      },
    };
  }

  if ('URL' in parsed) {
    const url = String(parsed.URL);
    const kwargs: Record<string, unknown> = { url };
    if (parsed.new_tab === true) kwargs.new_tab = true;
    if (typeof parsed.timeout_seconds === 'number') kwargs.timeout_seconds = parsed.timeout_seconds;
    return {
      description: `Navigate to ${url}`,
      actionEntity: {
        action_description: `Navigate to ${url}`,
        action_data: { action_name: 'go_to_url', kwargs },
      },
    };
  }

  if ('CODE' in parsed) {
    const code = String(parsed.CODE);
    return {
      description: code,
      actionEntity: {
        action_description: code,
        action_data: { action_name: 'js_code', kwargs: { code } },
      },
    };
  }

  // Raw code escape hatch: `description: + js:` → js_code (no self-healing).
  // DELIBERATE DIVERGENCE: parseStatement (the file parser) throws on `intent: + js:`,
  // but this UI-editor path is intentionally lenient and accepts `intent:` as a
  // description fallback for legacy display strings. Re-serialization always emits
  // `description:`, so the stored file form is the canonical one. Do not narrow this
  // leniency without checking the editor callers.
  if ('js' in parsed && typeof parsed.js === 'string' && !('VERIFY' in parsed) && !('WAIT_UNTIL' in parsed) && !('action' in parsed)) {
    const desc = typeof parsed.description === 'string'
      ? parsed.description
      : typeof parsed.intent === 'string' ? parsed.intent : '';
    return {
      description: desc,
      actionEntity: {
        action_description: desc,
        action_data: { action_name: 'js_code', kwargs: { code: parsed.js } },
      },
    };
  }

  if ('WAIT_UNTIL' in parsed) {
    const raw = String(parsed.WAIT_UNTIL);
    const cond = parseCondition(raw);
    // Intent + sibling `js:` form (same rules as parseStatement; this editor
    // path stays lenient elsewhere but the prefix+sibling combination is
    // ambiguous in any context).
    const hasSiblingJs = typeof parsed.js === 'string';
    if (hasSiblingJs && cond.type === ConditionType.JS_CODE) {
      throw new Error(
        'WAIT_UNTIL cannot combine a "js:"-prefixed condition with a sibling "js:" key — '
        + 'put the intent in WAIT_UNTIL and the expression in js:'
      );
    }
    const kwargs: Record<string, unknown> = hasSiblingJs
      ? { condition: raw, condition_type: ConditionType.JS_CODE, js: parsed.js }
      : { condition: cond.expression, condition_type: cond.type };
    if (typeof parsed.timeout_seconds === 'number') kwargs.timeout_seconds = parsed.timeout_seconds;
    // Sibling form matches parseStatement's label exactly so the editor and the
    // file parser show the same step label for the same statement. The legacy
    // colon-less label below is pre-existing editor behavior — left unchanged.
    const desc = hasSiblingJs ? `Wait until: ${raw}` : `Wait until ${cond.expression}`;
    return {
      description: desc,
      actionEntity: {
        action_description: desc,
        action_data: { action_name: 'ai_wait_until', kwargs },
      },
    };
  }

  if ('WAIT' in parsed) {
    const desc = String(parsed.WAIT);
    const kwargs: Record<string, unknown> = {};
    if (typeof parsed.seconds === 'number') kwargs.seconds = parsed.seconds;
    return {
      description: desc,
      actionEntity: {
        action_description: desc,
        action_data: { action_name: 'wait', kwargs },
      },
    };
  }

  // Standard flat format: { intent, action, locator, ...kwargs }
  const description = typeof parsed.intent === 'string' ? parsed.intent : undefined;
  const actionName = typeof parsed.action === 'string' ? parsed.action : undefined;
  const yamlLocator = typeof parsed.locator === 'string' ? parsed.locator : undefined;
  const xpath = typeof parsed.xpath === 'string' ? parsed.xpath : undefined;
  const framePath = Array.isArray(parsed.frame_path) ? parsed.frame_path as string[] : undefined;
  const args = Array.isArray(parsed.args) ? parsed.args : undefined;

  // Collect remaining keys as kwargs
  const kwargs: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(parsed)) {
    if (!RESERVED_YAML_KEYS.has(key)) {
      kwargs[key] = value;
    }
  }

  // Intent-only, no action
  if (!actionName) {
    return {
      description,
      actionEntity: {
        action_description: description || '',
      } as ActionEntity,
    };
  }

  const actionEntity: ActionEntity = {
    action_description: description || '',
    action_data: {
      action_name: actionName,
      kwargs,
      ...(args && args.length > 0 ? { args } : {}),
    },
    ...(yamlLocator ? { locator: yamlLocator } : {}),
    ...(xpath ? { xpath } : {}),
    ...(framePath ? { frame_path: framePath } : {}),
  };

  return {
    actionEntity,
    description,
    locator: yamlLocator,
  };
}

function stepToYaml(step: Step): YamlStatement {
  // Local template reference — emit `template:` syntax instead of inlining.
  // Child statements are intentionally discarded: the template file is the
  // source of truth and will be re-expanded on next load.
  if (step.template_path) {
    const result: YamlStatementObject = {
      template: step.template_path,
    };
    if (step.template_params && Object.keys(step.template_params).length > 0) {
      result.params = step.template_params;
    }
    return result;
  }

  const result: YamlStatementObject = {
    STEP: step.description,
    statements: step.statements.map(statementToYaml),
  };

  if (step.reference_id !== undefined) {
    result.reference_id = step.reference_id;
  }

  return result;
}

function ifElseToYaml(ifElse: IfElse): YamlStatement {
  const result: YamlStatementObject = {
    IF: formatCondition(ifElse.condition),
    THEN: ifElse.then.map(statementToYaml),
  };

  if (ifElse.else && ifElse.else.length > 0) {
    result.ELSE = ifElse.else.map(statementToYaml);
  }

  return result;
}

function whileLoopToYaml(whileLoop: WhileLoop): YamlStatement {
  const result: YamlStatementObject = {
    WHILE: formatCondition(whileLoop.condition),
    DO: whileLoop.body.map(statementToYaml),
  };

  if (whileLoop.timeout_ms !== undefined) {
    result.timeout_ms = whileLoop.timeout_ms;
  }

  return result;
}

function formatCondition(condition: Condition): string {
  if (condition.type === ConditionType.JS_CODE) {
    return `js:${condition.expression}`;
  }
  return condition.expression;
}

// ============================================================================
// YAML array parsing (import)
// ============================================================================

export interface ParsedYamlItem {
  name?: string;
  goal: string;
  testFlow?: TestFlow;
}

/**
 * Parse a YAML string into individual items. Supports two formats:
 * 1. Multi-document YAML (separated by ---), as produced by yamlObjectsToString
 * 2. Legacy YAML array format (each item starts with "- ")
 *
 * Each item must have at minimum a `goal` field.
 * If an item also has `url` and `statements`, a full TestFlow is parsed and included.
 * Returns an array where each entry is either a ParsedYamlItem or `{ error: string }`.
 */
export function parseYamlArrayItems(yamlString: string): Array<ParsedYamlItem | { error: string }> {
  // Try multi-document format first
  const docs = parseAllDocuments(yamlString);

  let items: unknown[];

  if (docs.length > 1 || (docs.length === 1 && !Array.isArray(docs[0]?.toJSON()))) {
    // Multi-document format: each --- block is a separate test case
    items = docs.map((doc, index) => {
      if (doc.errors.length > 0) {
        return { __parseError: `Document ${index + 1}: ${doc.errors[0].message}` };
      }
      return doc.toJSON();
    });
  } else {
    // Legacy array format
    let parsed: unknown;
    try {
      parsed = yamlParse(yamlString);
    } catch (e) {
      throw new Error(`Invalid YAML: ${e instanceof Error ? e.message : String(e)}`);
    }
    if (!Array.isArray(parsed)) {
      throw new Error('Expected a YAML array or multi-document YAML (separated by ---)');
    }
    items = parsed;
  }

  return items.map((item, index) => {
    try {
      if (item && typeof item === 'object' && '__parseError' in item) {
        return { error: (item as Record<string, unknown>).__parseError as string };
      }

      if (!item || typeof item !== 'object') {
        return { error: `Item ${index + 1}: expected an object` };
      }

      const obj = item as Record<string, unknown>;
      const name = typeof obj.name === 'string' ? obj.name.trim() || undefined : undefined;
      const goal = typeof obj.goal === 'string' ? obj.goal.trim() : '';

      if (!goal) {
        return { error: `Item ${index + 1}: missing "goal" field` };
      }

      // Try to parse as full TestFlow if it has statements
      if (Array.isArray(obj.statements)) {
        try {
          const itemYaml = yamlStringify(obj, YAML_STRINGIFY_OPTIONS);
          const testFlow = yamlToTestFlow(itemYaml);
          return { name, goal: testFlow.goal ?? goal, testFlow };
        } catch {
          // Fall through to simple name/goal
        }
      }

      return { name, goal };
    } catch (e) {
      return { error: `Item ${index + 1}: ${e instanceof Error ? e.message : String(e)}` };
    }
  });
}

// ============================================================================
// YAML metadata extraction
// ============================================================================

/**
 * Lightweight parse that pulls only metadata fields from a YAML string.
 * Returns `{}` if the field is missing or invalid. Does not validate the full flow.
 */
export function extractYamlMetadata(yamlString: string): YamlFlowMetadata {
  try {
    const parsed = yamlParse(yamlString);
    if (!parsed || typeof parsed !== 'object') return {};
    const result: YamlFlowMetadata = {};
    if (typeof parsed.test_case_id === 'number' && Number.isFinite(parsed.test_case_id)) {
      result.test_case_id = parsed.test_case_id;
    }
    if (typeof parsed.template_id === 'number' && Number.isFinite(parsed.template_id)) {
      result.template_id = parsed.template_id;
    }
    if (typeof parsed.name === 'string' && parsed.name.trim()) {
      result.name = parsed.name.trim();
    }
    if (typeof parsed.timeout === 'number' && Number.isFinite(parsed.timeout)) {
      result.timeout = parsed.timeout;
    }
    if (parsed.settings && typeof parsed.settings === 'object' && !Array.isArray(parsed.settings)) {
      result.settings = parsed.settings as Record<string, unknown>;
    }
    if (parsed.use && typeof parsed.use === 'object' && !Array.isArray(parsed.use)) {
      result.use = parsed.use as Record<string, unknown>;
    }
    const tags = toTagList(parsed.tags);
    if (tags.length > 0) result.tags = tags;
    if (typeof parsed.skip === 'boolean' || typeof parsed.skip === 'string') {
      result.skip = parsed.skip;
    }
    if (typeof parsed.fail === 'boolean' || typeof parsed.fail === 'string') {
      result.fail = parsed.fail;
    }
    if (parsed.only === true) {
      result.only = true;
    }
    if (parsed.slow === true) {
      result.slow = true;
    }
    if (Array.isArray(parsed.beforeEach) && parsed.beforeEach.length > 0) {
      result.beforeEach = parsed.beforeEach as unknown[];
    }
    if (Array.isArray(parsed.afterEach) && parsed.afterEach.length > 0) {
      result.afterEach = parsed.afterEach as unknown[];
    }
    if (Array.isArray(parsed.parameters) && parsed.parameters.length > 0) {
      result.parameters = parsed.parameters as unknown[];
    }
    return result;
  } catch {
    return {};
  }
}

// ============================================================================
// YAML → JSON (yamlToTestFlow)
// ============================================================================

/**
 * Recursively restore mis-parsed {{VAR}} variable references.
 *
 * YAML interprets unquoted `{{VAR}}` as a flow mapping, producing
 * `{ "{ VAR }": null }` instead of the string `"{{VAR}}"`.
 * This walks the parsed tree and converts those objects back to strings.
 */
function restoreBraceVariables(value: unknown): unknown {
  if (value === null || value === undefined || typeof value !== 'object') {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map(restoreBraceVariables);
  }
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj);
  // Detect: single key "{ VARNAME }" with null value → "{{VARNAME}}"
  if (keys.length === 1) {
    const key = keys[0];
    if (key.startsWith('{ ') && key.endsWith(' }') && obj[key] === null) {
      const varName = key.slice(2, -2);
      return `{{${varName}}}`;
    }
  }
  // Recurse into object values
  const result: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    result[k] = restoreBraceVariables(v);
  }
  return result;
}

/**
 * Convert a YAML TestFlow string to a full JSON TestFlow object.
 * Parses YAML, applies type inference rules, generates UIDs, sets version,
 * fills default fields, and validates against TestFlowSchema.
 */
const MAX_YAML_SIZE = 1024 * 1024; // 1MB

export function yamlToTestFlow(yamlString: string): TestFlow {
  if (yamlString.length > MAX_YAML_SIZE) {
    throw new Error(`YAML input too large (${yamlString.length} bytes, max ${MAX_YAML_SIZE})`);
  }

  const parsed = restoreBraceVariables(yamlParse(yamlString)) as any;

  if (!parsed || typeof parsed !== 'object') {
    throw new Error('Invalid YAML: expected an object at root level');
  }

  // Suite YAML → TestFlow with testGroup
  if (parsed.suite) {
    return yamlSuiteToTestFlow(parsed);
  }

  const testFlow: TestFlow = {
    version: '1.3.0',
    goal: parsed.goal,
    url: parsed.url,           // auto-navigates at runtime (backward compat)
    baseURL: parsed.base_url,  // Playwright test.use({ baseURL }), no auto-navigate
    statements: parseStatements(parsed.statements ?? []),
  };

  if (parsed.final_feedback) {
    testFlow.final_feedback = parsed.final_feedback;
  }

  if (parsed.teardown && Array.isArray(parsed.teardown)) {
    testFlow.teardown = parseStatements(parsed.teardown);
  }

  // Validate against schema
  const result = TestFlowSchema.safeParse(testFlow);
  if (!result.success) {
    throw new Error(`Invalid TestFlow after YAML conversion: ${JSON.stringify(result.error.errors)}`);
  }

  // Extract comments from AST and attach to statements
  const validatedFlow = result.data as TestFlow;
  extractAndAttachComments(yamlString, validatedFlow);
  return validatedFlow;
}

/** Parse suite YAML into a TestFlow with testGroup. */
function yamlSuiteToTestFlow(parsed: Record<string, unknown>): TestFlow {
  const suiteRaw = parsed.suite as Record<string, unknown>;
  if (!suiteRaw || typeof suiteRaw !== 'object') {
    throw new Error('Invalid suite: expected an object');
  }

  const testsRaw = suiteRaw.tests;
  if (!Array.isArray(testsRaw) || testsRaw.length === 0) {
    throw new Error('Suite must have a non-empty "tests" array');
  }

  const tests: TestGroupEntry[] = testsRaw.map((t: any) => {
    if (!t.name) throw new Error('Each test in a suite must have a "name" field');
    if (!Array.isArray(t.statements) || t.statements.length === 0) {
      throw new Error(`Suite test "${t.name}" must have a non-empty "statements" array`);
    }
    const entry: TestGroupEntry = {
      name: t.name,
      statements: parseStatements(t.statements),
    };
    const entryTags = toTagList(t.tags);
    if (entryTags.length > 0) entry.tags = entryTags;
    if (Array.isArray(t.teardown) && t.teardown.length > 0) {
      entry.teardown = parseStatements(t.teardown);
    }
    if (t.skip !== undefined) entry.skip = t.skip;
    if (typeof t.timeout === 'number') entry.timeout = t.timeout;
    if (t.fail !== undefined) entry.fail = t.fail;
    if (t.only === true) entry.only = true;
    if (t.slow === true) entry.slow = true;
    return entry;
  });

  const group: TestGroup = { tests };
  if (Array.isArray(suiteRaw.beforeAll) && suiteRaw.beforeAll.length > 0) {
    group.beforeAll = parseStatements(suiteRaw.beforeAll as unknown[]);
  }
  if (Array.isArray(suiteRaw.afterAll) && suiteRaw.afterAll.length > 0) {
    group.afterAll = parseStatements(suiteRaw.afterAll as unknown[]);
  }
  if (Array.isArray(suiteRaw.beforeEach) && suiteRaw.beforeEach.length > 0) {
    group.beforeEach = parseStatements(suiteRaw.beforeEach as unknown[]);
  }
  if (Array.isArray(suiteRaw.afterEach) && suiteRaw.afterEach.length > 0) {
    group.afterEach = parseStatements(suiteRaw.afterEach as unknown[]);
  }

  // Validate group
  const groupResult = TestGroupSchema.safeParse(group);
  if (!groupResult.success) {
    throw new Error(`Invalid TestGroup: ${JSON.stringify(groupResult.error.errors)}`);
  }

  const testFlow: TestFlow = {
    version: '1.3.0',
    // `base_url` is documented as a top-level key (YAML spec §3) and is also
    // accepted nested under `suite:` — the form suiteToYaml round-trips. The
    // nested key wins as the more specific one. See issue #2209.
    baseURL: ((suiteRaw.base_url ?? parsed.base_url) as string) || undefined,
    testGroup: groupResult.data as TestGroup,
  };

  return testFlow;
}

function parseStatements(items: unknown[]): Statement[] {
  if (!Array.isArray(items)) {
    throw new Error('Expected an array of statements');
  }
  return items.map(parseStatement);
}

function parseStatement(item: unknown): Statement {
  // Plain strings are no longer supported — use `intent:` instead
  if (typeof item === 'string') {
    throw new Error(
      `Plain string statements are not supported. Use an object with a "desc" key instead. `
      + `Example: { "desc": "${item}" }`
    );
  }

  if (typeof item !== 'object' || item === null) {
    throw new Error(`Invalid statement: expected object, got ${typeof item}`);
  }

  const obj = item as Record<string, unknown>;

  // IF_ELSE: has IF key
  if ('IF' in obj) {
    return parseIfElse(obj);
  }

  // WHILE_LOOP: has WHILE key
  if ('WHILE' in obj) {
    return parseWhileLoop(obj);
  }

  // STEP: has STEP key
  if ('STEP' in obj) {
    return parseStep(obj);
  }

  // VERIFY shorthand: has VERIFY key
  if ('VERIFY' in obj) {
    const statement = obj.VERIFY;
    const kwargs: Record<string, unknown> = { statement: typeof statement === 'string' ? statement : String(statement) };
    if (typeof obj.js === 'string') {
      kwargs.code = obj.js;
    }
    return {
      uid: uuidv4(),
      type: StatementType.ACTION,
      description: String(statement),
      action_entity: {
        action_description: String(statement),
        action_data: {
          action_name: 'verify',
          kwargs,
        },
      },
    } as Action;
  }

  // URL shorthand: has URL key
  if ('URL' in obj) {
    const url = obj.URL;
    const newTab = obj.new_tab === true ? true : undefined;
    const timeoutSeconds = typeof obj.timeout_seconds === 'number' ? obj.timeout_seconds : undefined;
    const kwargs: Record<string, unknown> = { url: typeof url === 'string' ? url : String(url) };
    if (newTab) kwargs.new_tab = true;
    if (timeoutSeconds !== undefined) kwargs.timeout_seconds = timeoutSeconds;
    return {
      uid: uuidv4(),
      type: StatementType.ACTION,
      description: `Navigate to ${url}`,
      action_entity: {
        action_description: `Navigate to ${url}`,
        action_data: {
          action_name: 'go_to_url',
          kwargs,
        },
      },
    } as Action;
  }

  // WAIT_UNTIL shorthand: condition wait — natural language (AI_MODE), a bare
  // `js:`-prefixed expression (JS_CODE), or the preferred intent + sibling `js:`
  // form where WAIT_UNTIL keeps the human-readable intent and the sibling `js:`
  // holds the polled expression (JS_CODE, no AI fallback).
  if ('WAIT_UNTIL' in obj) {
    const raw = typeof obj.WAIT_UNTIL === 'string' ? obj.WAIT_UNTIL : String(obj.WAIT_UNTIL);
    const parsed = parseCondition(raw);
    const timeoutSeconds = typeof obj.timeout_seconds === 'number' ? obj.timeout_seconds : 60;
    if (typeof obj.js === 'string') {
      if (parsed.type === ConditionType.JS_CODE) {
        throw new Error(
          'WAIT_UNTIL cannot combine a "js:"-prefixed condition with a sibling "js:" key — '
          + 'put the intent in WAIT_UNTIL and the expression in js:'
        );
      }
      return {
        uid: uuidv4(),
        type: StatementType.ACTION,
        description: `Wait until: ${raw}`,
        action_entity: {
          action_description: `Wait until: ${raw}`,
          action_data: {
            action_name: 'ai_wait_until',
            kwargs: {
              condition: raw,
              condition_type: ConditionType.JS_CODE,
              js: obj.js,
              timeout_seconds: timeoutSeconds,
            },
          },
        },
      } as Action;
    }
    return {
      uid: uuidv4(),
      type: StatementType.ACTION,
      description: `Wait until: ${parsed.expression}`,
      action_entity: {
        action_description: `Wait until: ${parsed.expression}`,
        action_data: {
          action_name: 'ai_wait_until',
          kwargs: {
            condition: parsed.expression,
            condition_type: parsed.type,
            timeout_seconds: timeoutSeconds,
          },
        },
      },
    } as Action;
  }

  // WAIT shorthand: fixed duration wait
  if ('WAIT' in obj) {
    const intent = obj.WAIT;
    const seconds = typeof obj.seconds === 'number' ? obj.seconds : 3;
    return {
      uid: uuidv4(),
      type: StatementType.ACTION,
      description: typeof intent === 'string' ? intent : `Wait ${seconds}s`,
      action_entity: {
        action_description: typeof intent === 'string' ? intent : `Wait ${seconds}s`,
        action_data: {
          action_name: 'wait',
          kwargs: { seconds },
        },
      },
    } as Action;
  }

  // CODE shorthand: undocumented back-compat alias for `description: + js:`. Same js_code target.
  if ('CODE' in obj) {
    const code = obj.CODE;
    if (code === null || code === undefined) {
      throw new Error('CODE statement has no code. Use "CODE: |" followed by indented code on the next line.');
    }
    const description = typeof obj.description === 'string' ? obj.description : 'Code block';
    return {
      uid: uuidv4(),
      type: StatementType.ACTION,
      description,
      action_entity: {
        action_description: description,
        action_data: {
          action_name: 'js_code',
          kwargs: { code: typeof code === 'string' ? code : String(code) },
        },
      },
    } as Action;
  }

  // Raw code escape hatch: { description: "...", js: "await page..." } → js_code (no self-healing).
  // VERIFY+js and action: verify are handled above / by parseFlatAction; structured actions own `js` too.
  if ('js' in obj && !('VERIFY' in obj) && !('action' in obj)) {
    // `intent` implies self-healing, which raw JS no longer does. Reject it loudly.
    if ('intent' in obj || 'desc' in obj) {
      throw new Error(
        'A `js:` statement uses `description:`, not `intent:`. Raw JS does not self-heal — '
        + 'use `description: + js:` for code, or express it as a structured action '
        + '(`intent:` + `action:`/`locator:`) to keep self-healing.'
      );
    }
    // description is optional (defaults to a generic label, matching the CODE: alias)
    const description = typeof obj.description === 'string' && obj.description.trim() !== ''
      ? obj.description
      : 'Code block';
    const code = obj.js;
    return {
      uid: uuidv4(),
      type: StatementType.ACTION,
      description,
      action_entity: {
        action_description: description,
        action_data: {
          action_name: 'js_code',
          kwargs: { code: typeof code === 'string' ? code : String(code) },
        },
      },
    } as Action;
  }

  // Function call shorthand: { intent: "...", call: "file#export", args: [...] }
  // → normalizes to action: function with functionName in kwargs
  if ('call' in obj && typeof obj.call === 'string') {
    const { call: callValue, ...rest } = obj;
    return parseFlatAction({ ...rest, action: 'function', functionName: callValue });
  }

  // ACTION: { intent: ..., action: "click", locator: ... }
  if ('action' in obj) {
    return parseFlatAction(obj);
  }

  // Object with only intent (or legacy desc) → DRAFT
  if (('intent' in obj && typeof obj.intent === 'string') || ('desc' in obj && typeof obj.desc === 'string')) {
    return {
      uid: uuidv4(),
      type: StatementType.DRAFT,
      description: (typeof obj.intent === 'string' ? obj.intent : obj.desc) as string,
    };
  }

  throw new Error(`Cannot infer statement type from object: ${JSON.stringify(obj)}`);
}

function parseCondition(conditionStr: unknown): { type: ConditionType; expression: string } {
  if (typeof conditionStr !== 'string') {
    throw new Error(`Condition must be a string, got ${typeof conditionStr}`);
  }

  // js: prefix means JS_CODE
  if (conditionStr.startsWith('js:')) {
    return {
      type: ConditionType.JS_CODE,
      expression: conditionStr.slice(3),
    };
  }

  // Default: AI_MODE
  return {
    type: ConditionType.AI_MODE,
    expression: conditionStr,
  };
}

function parseIfElse(obj: Record<string, unknown>): IfElse {
  const condition = parseCondition(obj.IF);

  const thenStatements = obj.THEN;
  if (!Array.isArray(thenStatements)) {
    throw new Error('IF_ELSE requires a THEN array');
  }

  const result: IfElse = {
    uid: uuidv4(),
    type: StatementType.IF_ELSE,
    condition,
    then: parseStatements(thenStatements),
  };

  if ('ELSE' in obj && Array.isArray(obj.ELSE)) {
    result.else = parseStatements(obj.ELSE);
  }

  return result;
}

function parseWhileLoop(obj: Record<string, unknown>): WhileLoop {
  const condition = parseCondition(obj.WHILE);

  const body = obj.DO;
  if (!Array.isArray(body)) {
    throw new Error('WHILE_LOOP requires a DO array');
  }

  const result: WhileLoop = {
    uid: uuidv4(),
    type: StatementType.WHILE_LOOP,
    condition,
    body: parseStatements(body),
  };

  if (typeof obj.timeout_ms === 'number') {
    result.timeout_ms = obj.timeout_ms;
  }

  return result;
}

function parseStep(obj: Record<string, unknown>): Step {
  const description = typeof obj.STEP === 'string' ? obj.STEP : '';

  if (!Array.isArray(obj.statements)) {
    throw new Error('STEP requires a statements array');
  }

  const result: Step = {
    uid: uuidv4(),
    type: StatementType.STEP,
    description,
    statements: parseStatements(obj.statements),
  };

  if (typeof obj.reference_id === 'number') {
    result.reference_id = obj.reference_id;
  }

  if (typeof obj.template_path === 'string') {
    result.template_path = obj.template_path;
  }

  if (obj.template_params && typeof obj.template_params === 'object' && !Array.isArray(obj.template_params)) {
    const raw = obj.template_params as Record<string, unknown>;
    const params: Record<string, string> = {};
    for (const [k, v] of Object.entries(raw)) {
      params[k] = String(v);
    }
    result.template_params = params;
  }

  return result;
}

/** Structural fields that are NOT kwargs */
const FLAT_ACTION_STRUCTURAL_KEYS = new Set(['action', 'intent', 'desc', 'locator', 'xpath', 'use_pure_vision']);

function parseFlatAction(obj: Record<string, unknown>): Action {
  const actionName = typeof obj.action === 'string' ? obj.action : String(obj.action);
  const description = typeof obj.intent === 'string' ? obj.intent : (typeof obj.desc === 'string' ? obj.desc : '');
  const locator = typeof obj.locator === 'string' ? obj.locator : undefined;
  const xpath = typeof obj.xpath === 'string' ? obj.xpath : undefined;
  const usePureVision = typeof obj.use_pure_vision === 'boolean' ? obj.use_pure_vision : undefined;

  // Everything else is kwargs
  const kwargs: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj)) {
    if (!FLAT_ACTION_STRUCTURAL_KEYS.has(key)) {
      kwargs[key] = value;
    }
  }

  // Normalize js → code for verify actions, matching the VERIFY: shorthand behavior
  if (actionName === 'verify' && typeof kwargs.js === 'string') {
    kwargs.code = kwargs.js;
    delete kwargs.js;
  }

  // For ai_action/ai_step, `statement` is the action description — derive it from intent
  // when omitted from YAML so the transpiler can always read kwargs.statement
  if ((actionName === 'ai_action' || actionName === 'ai_step')) {
    if (kwargs.statement === undefined) {
      kwargs.statement = description;
    }

    // Forward use_pure_vision into kwargs so the transpiler and runtime can read it
    // (both ai_action.transpile() and ai_action.execute() read from action_data.kwargs)
    if (usePureVision) {
      kwargs.use_pure_vision = true;
    }
  }

  const actionEntity: ActionEntity = {
    action_description: description,
    action_data: {
      action_name: actionName,
      kwargs: Object.keys(kwargs).length > 0 ? kwargs : {},
    },
  };

  if (locator) actionEntity.locator = locator;
  if (xpath) actionEntity.xpath = xpath;

  const result: Action = {
    uid: uuidv4(),
    type: StatementType.ACTION,
    description,
    action_entity: actionEntity,
  };

  if (usePureVision) result.use_pure_vision = true;

  return result;
}

// ============================================================================
// YAML comment preservation
// ============================================================================

/**
 * Extract comments from the YAML AST and attach them to TestFlow statements.
 * Uses parseDocument to get AST nodes with commentBefore properties,
 * then walks the statements array in parallel to copy comments over.
 */
export function extractAndAttachComments(yamlString: string, testFlow: TestFlow): void {
  let doc: Document;
  try {
    doc = parseDocument(yamlString);
  } catch {
    return; // Can't parse AST — skip comment extraction
  }

  const root = doc.contents;
  if (!root || !isMap(root)) return;

  // Extract top-of-file comment
  // When there's a blank line after comments, yaml lib puts them on doc.commentBefore
  // When there's no blank line, they go on the first key's commentBefore
  if (doc.commentBefore) {
    testFlow.comment = doc.commentBefore;
  } else {
    const rootMap = root as YAMLMap;
    const firstPair = rootMap.items?.[0];
    if (firstPair?.key && (firstPair.key as YamlNode).commentBefore) {
      testFlow.comment = (firstPair.key as YamlNode).commentBefore!;
    }
  }

  // Extract statement comments
  const rootMap = root as YAMLMap;
  const statementsNode = rootMap.get('statements', true);
  if (isSeq(statementsNode) && testFlow.statements) {
    extractCommentsFromSeq(statementsNode, testFlow.statements);
  }

  // Extract teardown comments
  const teardownNode = rootMap.get('teardown', true);
  if (isSeq(teardownNode) && testFlow.teardown) {
    extractCommentsFromSeq(teardownNode, testFlow.teardown);
  }
}

/** Recursively extract comments from a YAML AST sequence into statements. */
function extractCommentsFromSeq(seq: YAMLSeq, statements: Statement[]): void {
  // The yaml library puts the comment before the first item on seq.commentBefore
  // (not on items[0].commentBefore). Both are never set simultaneously in practice,
  // but we guard against it by preferring seq.commentBefore for the first item.
  if (seq.commentBefore && statements.length > 0) {
    statements[0].comment = seq.commentBefore;
  }

  for (let i = 0; i < Math.min(seq.items.length, statements.length); i++) {
    const node = seq.items[i] as YamlNode;
    if (node.commentBefore && !(i === 0 && seq.commentBefore)) {
      statements[i].comment = node.commentBefore;
    }

    // Recurse into nested statements (STEP, IF_ELSE, WHILE_LOOP)
    const stmt = statements[i];
    if (stmt.type === StatementType.STEP && isMap(node)) {
      const innerSeq = (node as YAMLMap).get('statements', true);
      if (isSeq(innerSeq)) {
        extractCommentsFromSeq(innerSeq, (stmt as Step).statements);
      }
    } else if (stmt.type === StatementType.IF_ELSE && isMap(node)) {
      const thenSeq = (node as YAMLMap).get('THEN', true);
      if (isSeq(thenSeq)) {
        extractCommentsFromSeq(thenSeq, (stmt as IfElse).then);
      }
      const elseSeq = (node as YAMLMap).get('ELSE', true);
      if (isSeq(elseSeq) && (stmt as IfElse).else) {
        extractCommentsFromSeq(elseSeq, (stmt as IfElse).else!);
      }
    } else if (stmt.type === StatementType.WHILE_LOOP && isMap(node)) {
      const bodySeq = (node as YAMLMap).get('DO', true);
      if (isSeq(bodySeq)) {
        extractCommentsFromSeq(bodySeq, (stmt as WhileLoop).body);
      }
    }
  }
}
