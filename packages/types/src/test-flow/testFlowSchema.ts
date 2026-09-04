/**
 * Test Flow Zod Validation Schemas (v1.3.0)
 *
 * Provides runtime validation for TestFlow types using Zod.
 * These schemas validate the structure of test flows, statements, actions, and test groups.
 */

import { z } from "zod";

// Condition schemas
export const ConditionTypeSchema = z.enum(["JS_CODE", "AI_MODE"]);

export const ConditionSchema = z.object({
  type: ConditionTypeSchema,
  expression: z.string(),
});

// Statement schemas
export const StatementTypeSchema = z.enum(["DRAFT", "STEP", "ACTION", "IF_ELSE", "WHILE_LOOP"]);

export const BaseStatementSchema = z.object({
  uid: z.string(),
  type: StatementTypeSchema,
  comment: z.string().optional(),
});

// Action entity schema
export const ActionEntitySchema = z
  .object({
    action_data: z.object({
      action_name: z.string(),
      kwargs: z.record(z.any()).optional(),
      args: z.array(z.any()).optional(),
    }),
    action_description: z.string().optional(),
    url: z.string().optional(),
    xpath: z.string().nullable().optional(),
    locator: z.string().nullable().optional(),
    css_selector: z.string().nullable().optional(),
    unique_selector: z.string().nullable().optional(),
    element_index: z.number().nullable().optional(),
    frame_path: z.array(z.any()).optional(),
    artifacts: z.record(z.any()).optional(),
    feedback: z.string().optional(),
    original_browser_use_action: z.any().optional(),
  })
  .passthrough();

// Draft schema - transient statement that converts to ACTION or STEP after execution
export const DraftSchema = BaseStatementSchema.extend({
  type: z.literal("DRAFT"),
  description: z.string(),
});

// Action schema
export const ActionSchema = BaseStatementSchema.extend({
  type: z.literal("ACTION"),
  description: z.string(),
  action_entity: ActionEntitySchema.optional(),
  locator: z.string().optional(),
  use_pure_vision: z.boolean().optional(),
});

// Statement type for recursive validation
type Statement =
  | z.infer<typeof DraftSchema>
  | z.infer<typeof ActionSchema>
  | {
      uid: string;
      type: "STEP";
      description?: string;
      statements: Statement[];
      reference_id?: number;
      template_path?: string;
      template_params?: Record<string, string>;
    }
  | {
      uid: string;
      type: "IF_ELSE";
      description?: string;
      condition: z.infer<typeof ConditionSchema>;
      then: Statement[];
      else?: Statement[];
    }
  | {
      uid: string;
      type: "WHILE_LOOP";
      description?: string;
      condition: z.infer<typeof ConditionSchema>;
      body: Statement[];
      timeout_ms?: number;
    };

// Recursive statement schema
export const StatementSchema: z.ZodType<Statement> = z.lazy(() =>
  z.union([
    DraftSchema,
    ActionSchema,
    BaseStatementSchema.extend({
      type: z.literal("STEP"),
      description: z.string().optional().default(""),
      statements: z.array(StatementSchema),
      reference_id: z.number().optional(),
      template_path: z.string().optional(),
      template_params: z.record(z.string()).optional(),
    }),
    BaseStatementSchema.extend({
      type: z.literal("IF_ELSE"),
      description: z.string().optional(),
      condition: ConditionSchema,
      then: z.array(StatementSchema),
      else: z.array(StatementSchema).optional(),
    }),
    BaseStatementSchema.extend({
      type: z.literal("WHILE_LOOP"),
      description: z.string().optional(),
      condition: ConditionSchema,
      body: z.array(StatementSchema),
      timeout_ms: z.number().optional(),
    }),
  ])
);

// TestGroupEntry schema
export const TestGroupEntrySchema = z.object({
  name: z.string(),
  statements: z.array(StatementSchema),
  tags: z.array(z.string()).optional(),
  teardown: z.array(StatementSchema).optional(),
  skip: z.union([z.boolean(), z.string()]).optional(),
  timeout: z.number().optional(),
  fail: z.union([z.boolean(), z.string()]).optional(),
  only: z.boolean().optional(),
  slow: z.boolean().optional(),
});

// TestGroup schema
export const TestGroupSchema = z.object({
  tests: z.array(TestGroupEntrySchema).min(1),
  beforeAll: z.array(StatementSchema).optional(),
  afterAll: z.array(StatementSchema).optional(),
  beforeEach: z.array(StatementSchema).optional(),
  afterEach: z.array(StatementSchema).optional(),
});

// TestFlow schema — goal/statements for single-test, testGroup for suite (mutually exclusive)
export const TestFlowSchema = z.object({
  comment: z.string().optional(),
  version: z.string().optional(),
  goal: z.string().optional(),
  url: z.string().optional(),
  baseURL: z.string().optional(),
  final_feedback: z.string().optional(),
  completed: z.boolean().optional(),
  success: z.boolean().optional(),
  statements: z.array(StatementSchema).optional(),
  teardown: z.array(StatementSchema).optional(),
  last_modified_at: z.string().optional(),
  testGroup: TestGroupSchema.optional(),
}).refine(
  (data) => {
    const hasGroup = data.testGroup !== undefined;
    if (hasGroup) {
      // Suite mode: goal/statements must be absent
      return data.goal === undefined && (data.statements === undefined || data.statements.length === 0);
    }
    // Single-test mode: goal is required
    return data.goal !== undefined;
  },
  { message: "TestFlow must have either goal/statements (single test) or testGroup (suite), not both" },
);

// Export inferred types
export type TestFlowSchemaType = z.infer<typeof TestFlowSchema>;
export type StatementSchemaType = z.infer<typeof StatementSchema>;
export type ActionEntitySchemaType = z.infer<typeof ActionEntitySchema>;
