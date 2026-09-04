/**
 * @shiplightai/sdk - AI-powered browser automation with custom actions
 *
 * A clean, minimal SDK for building browser automation with pluggable custom actions.
 *
 * @example
 * ```typescript
 * import { createAgent, z } from '@shiplightai/sdk';
 *
 * const agent = createAgent({
 *   model: 'gemini-2.5-pro',
 *   variables: { username: 'test@example.com' },
 *   sensitiveKeys: ['password'],
 * });
 *
 * // Register a custom action
 * agent.registerAction({
 *   name: 'extract_email_code',
 *   description: 'Extract verification code from email',
 *   schema: z.object({
 *     email: z.string().describe('Email address to check'),
 *   }),
 *   async execute(args, ctx) {
 *     const code = await getEmailCode(args.email);
 *     ctx.variableStore.set('code', code);
 *     return { success: true };
 *   },
 * });
 *
 * // Use the agent
 * await agent.run(page, 'Login and get verification code');
 * await agent.assert(page, 'Dashboard is visible');
 * ```
 *
 * @packageDocumentation
 */

// Main entry points
export { createAgent, Agent } from './agent';

// Public types - re-export from sdk-core for consistency
export type {
  ICustomAction,
  ActionExecutionContext,
  CustomActionResult,
  AgentStepResult,
} from 'sdk-core';

// Local types specific to sdk-public
export type { CreateAgentOptions, LoginOptions, StepOptions, RunOptions } from './types';

// Re-export VariableStore for type annotations
export { VariableStore } from 'shiplight-types';

// VariableStore.toJSON()/fromJSON() are unusable without this type — a
// consumer would have to write ReturnType<VariableStore['toJSON']> to name
// what they already hold. Other types reachable from the public surface are
// deliberately left un-nameable; see the inlinedPrivateTypes baseline in
// src/__tests__/consumerDeclarations.test.ts for the reasoning and the guard
// that stops that set growing unnoticed.
export type { VariableStoreJSON } from 'shiplight-types';

// Re-export zod for schema definitions
export { z } from 'zod';

// SDK configuration
export { configureSdk, getSdkConfig, LogLevel } from 'sdk-core';
export type { SdkConfig } from 'sdk-core';
