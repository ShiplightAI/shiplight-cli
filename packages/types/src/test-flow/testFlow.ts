/**
 * Test Flow Types (v1.3.0)
 * Types for representing test flows with steps, actions, control flow, and test groups
 */

import type { ActionEntity } from './actionEntity';

export enum StatementType {
  DRAFT = "DRAFT",      // Transient type - converts to ACTION or STEP after execution
  STEP = "STEP",
  ACTION = "ACTION",
  IF_ELSE = "IF_ELSE",
  WHILE_LOOP = "WHILE_LOOP"
}

export interface BaseStatement {
  uid: string;
  type: StatementType;
  /** YAML comment that precedes this statement (preserved during round-trip) */
  comment?: string;
}

/**
 * A draft is a transient statement that converts to ACTION or STEP after execution.
 * - If 1 action is produced → converts to ACTION
 * - If 2+ actions are produced → converts to STEP with child ACTIONs
 */
export interface Draft extends BaseStatement {
  type: StatementType.DRAFT;
  description: string;
}

/** A step is a list of statements that are executed in order */
export interface Step extends BaseStatement {
  type: StatementType.STEP;
  description: string;
  statements: Statement[];
  reference_id?: number;  // Optional reference to a cloud reusable step template
  template_path?: string;  // Optional reference to a local template file (relative path)
  template_params?: Record<string, string>;  // Parameters passed to the local template
}

/** An action is a single action that is executed, leaf node of the statement tree */
export interface Action extends BaseStatement {
  type: StatementType.ACTION;
  description: string;
  action_entity?: ActionEntity;  // Cached action entity
  locator?: string;  // User picked locator, overwrites the locator in the action entity
  use_pure_vision?: boolean; // Whether to use pure vision mode for this action
}

export enum ConditionType {
  JS_CODE = "JS_CODE",  // JavaScript code, evaluates to a boolean or unknown
  AI_MODE = "AI_MODE"   // AI mode, a natural language description of a condition
}

export interface Condition {
  type: ConditionType;
  expression: string;
}

export interface IfElse extends BaseStatement {
  type: StatementType.IF_ELSE;
  condition: Condition;
  then: Statement[];
  else?: Statement[];
}

export interface WhileLoop extends BaseStatement {
  type: StatementType.WHILE_LOOP;
  condition: Condition;
  body: Statement[];
  timeout_ms?: number; // Optional timeout in milliseconds (defaults to 180000 if not set)
}

/** Default timeout for while loops if not specified (3 minutes) */
export const DEFAULT_WHILE_LOOP_TIMEOUT_MS = 180000;

export type Statement = Draft | Step | Action | IfElse | WhileLoop;

export interface TestGroupEntry {
  name: string;
  statements: Statement[];
  /**
   * Playwright tags for this test alone. Round-tripped so a debugger save does
   * not drop them: they select tests via `--grep`, so losing one silently
   * changes which tests a CI job runs.
   */
  tags?: string[];
  teardown?: Statement[];
  skip?: boolean | string;
  timeout?: number;
  fail?: boolean | string;
  only?: boolean;
  slow?: boolean;
}

export interface TestGroup {
  tests: TestGroupEntry[];
  beforeAll?: Statement[];
  afterAll?: Statement[];
  beforeEach?: Statement[];
  afterEach?: Statement[];
}

export interface TestFlow {
  /** YAML comment at the top of the file (preserved during round-trip) */
  comment?: string;
  version?: string;
  goal?: string;
  /** Starting URL for the test (1.2.0). Auto-navigates at runtime. */
  url?: string;
  /** Base URL for relative paths (1.3.0). In YAML this is the `base_url` key. Maps to Playwright's test.use({ baseURL }). Does NOT auto-navigate. */
  baseURL?: string;
  final_feedback?: string;
  completed?: boolean;
  success?: boolean;
  statements?: Statement[];
  teardown?: Statement[];
  last_modified_at?: string;
  /** Test group (v1.3.0) — mutually exclusive with goal/statements. YAML key: `suite:` */
  testGroup?: TestGroup;
}
