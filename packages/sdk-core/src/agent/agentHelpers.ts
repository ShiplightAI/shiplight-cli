/**
 * Local Web Agent - TypeScript implementation of webagent API calls
 *
 * This module provides local implementations of:
 * - executeStep: Single-step action generation and execution
 * - assertStatement: Assertion evaluation without execution
 * - runStep: Multi-step agent execution with streaming events
 *
 * These replace the need for remote webagent API calls.
 */

import { Page } from 'playwright';
import type { ActionHandler } from '../actions/handler';
import { ActionEntity } from '../actions/types';
import { DomService } from '../dom';
import { toolRegistry } from '../llm_tools/registry';
import { AgentServices } from './agentServices';
import { evaluate, generateAction } from './core/agentCore';
import {
	AgentEvent,
	AgentOptions,
	AssertionResult,
	StepResult,
	TaskExecutionContext,
} from './core/types';
import { TaskExecutionOptions } from './task/types';

export async function executeAction(
	actionEntity: ActionEntity,
	context: TaskExecutionContext,
): Promise<{ success: boolean; error?: string }> {
	try {
		if (!actionEntity.action_data) {
			return {
				success: false,
				error: 'Action entity missing action_data',
			};
		}
		
		const { action_name, kwargs } = actionEntity.action_data;
		if (toolRegistry.has(action_name)) {
			const result = await toolRegistry.execute(action_name, kwargs, context);
			const success = (result as any)?.success !== false;
			const error = (result as any)?.error || (result as any)?.message;
			return {
				success,
				error: success ? undefined : error,
			};
		} else {
			const { page, agentServices } = context;
			const handler = await getActionHandler();
			await handler.execute(page, actionEntity, agentServices);
	
			return {
				success: true,
				error: undefined,
			}
		}
	} catch (error) {
		return {
			success: false,
			error: (error as Error).message,
		};
	}
}

/**
 * Lazy-load ActionHandler for vision-based (coordinates) automation.
 *
 * Uses dynamic import to defer loading until needed, avoiding circular dependencies.
 * This function is only called when usePureVision=true, so most code paths won't
 * load the ActionHandler at all.
 *
 * Pattern: Cache the instance after first creation for reuse.
 */
let cachedActionHandler: ActionHandler | null = null;
async function getActionHandler(): Promise<ActionHandler> {
	if (cachedActionHandler) {
		return cachedActionHandler;
	}

	const handlerModule: typeof import('../actions/handler') = await import('../actions/handler');
	cachedActionHandler = new handlerModule.default();
	return cachedActionHandler;
}

/**
 * Generate a single action without executing it
 *
 * This is the core function for action generation only:
 * 1. Call LLM with current browser state
 * 2. LLM picks ONE action from available tools
 * 3. Return the generated action WITHOUT executing it
 * 4. Return result with action entity and goal completion flag
 *
 * @param statement - User's goal/instruction in natural language
 * @param page - Playwright Page instance
 * @param agent - Agent instance for helper methods
 * @param options - Agent options (model, temperature, etc.)
 * @returns StepResult with action entity and completion flag (NOT executed)
 */
export async function generateActionStep(
	statement: string,
	page: Page,
	agentServices: AgentServices,
	options: AgentOptions = {},
	existingContext?: TaskExecutionContext
): Promise<StepResult> {
	// Use existing context if provided, otherwise create new
	const context: TaskExecutionContext = existingContext || {
		page,
		agentServices,
		domService: new DomService(agentServices.getDomServiceOptions()),
		executionHistory: options.executionHistory,
		variables: options.variables,
		sensitiveKeys: options.sensitiveKeys,
	};

	// Replace $variable placeholders with actual values before calling LLM
	const resolvedStatement = agentServices.replaceVariables(statement);

	// Generate action from LLM (always returns, never throws)
	const generatedAction = await generateAction(resolvedStatement, context, options);

	// If generation failed, return error with explanation
	if (generatedAction.status === 'error') {
		return {
			status: 'error',
			completed: generatedAction.goalAccomplished || false,
			actionEntities: [],
			explanation: generatedAction.reasoning,
			error: generatedAction.error,
			debugInfo: generatedAction.debugInfo,
		};
	}

	// Return the generated action WITHOUT executing it
	return {
		status: 'success',
		completed: generatedAction.goalAccomplished || false,
		actionEntities: generatedAction.actionEntity ? [generatedAction.actionEntity] : [],
		explanation: generatedAction.reasoning,
		debugInfo: generatedAction.debugInfo,
	};
}

/**
 * Execute a single step - takes a statement, LLM picks ONE action, executes it
 *
 * This is the core function for single-step execution:
 * 1. Call LLM with current browser state
 * 2. LLM picks ONE action from available tools
 * 3. Execute that action
 * 4. Return result with status and completion flag
 *
 * @param statement - User's goal/instruction in natural language
 * @param page - Playwright Page instance
 * @param agent - Agent instance for helper methods
 * @param options - Agent options (model, temperature, etc.)
 * @returns StepResult with status, completion flag, and action entity
 */
export async function executeStep(
	statement: string,
	page: Page,
	agentServices: AgentServices,
	options: AgentOptions = {},
	existingContext?: TaskExecutionContext
): Promise<StepResult> {
	// Use existing context if provided (for session log folder), otherwise create new
	const context: TaskExecutionContext = existingContext || {
		page,
		agentServices,
		domService: new DomService(agentServices.getDomServiceOptions()),
		executionHistory: options.executionHistory,
		variables: options.variables,
		sensitiveKeys: options.sensitiveKeys,
	};

	// Replace $variable placeholders with actual values before calling LLM
	const resolvedStatement = agentServices.replaceVariables(statement);

	// Generate action from LLM (always returns, never throws)
	const generatedAction = await generateAction(resolvedStatement, context, options);

	// If generation failed, return error with explanation
	if (generatedAction.status === 'error' || !generatedAction.actionEntity) {
		return {
			status: 'error',
			completed: generatedAction.goalAccomplished || false,
			actionEntities: [],
			explanation: generatedAction.reasoning,
			error: generatedAction.error || 'No action generated',
			debugInfo: generatedAction.debugInfo,
		};
	}

	const { actionEntity, reasoning, goalAccomplished, debugInfo } = generatedAction;

	// Execute the action by calling the tool directly
	const executionResult = await executeAction(actionEntity, context);

	// If execution failed, return error result
	if (!executionResult.success) {
		return {
			status: 'error',
			completed: false,
			actionEntities: [actionEntity],
			error: executionResult.error || 'Action execution failed',
			debugInfo,
		};
	}

	// Set agentNote with the explanation so it propagates back to the caller
	if (reasoning) {
		agentServices.addNote(reasoning);
	}

	// Use the goal completion analysis from the LLM (already determined during action generation)
	return {
		status: 'success',
		completed: goalAccomplished || false,
		actionEntities: [actionEntity],
		explanation: reasoning,
		debugInfo,
	};
}

/**
 * Evaluate a statement - evaluation only, no execution
 *
 * This evaluates whether a condition is true without performing any actions.
 * Renamed from assertStatement to match the IAgent.evaluate() naming convention.
 *
 * @param statement - Evaluation statement (e.g., "The login button is visible")
 * @param page - Playwright Page instance
 * @param agent - Agent instance
 * @param options - Agent options
 * @returns AssertionResult with success flag and explanation
 */
export async function evaluateStatement(
	statement: string,
	page: Page,
	agentServices: AgentServices,
	options: AgentOptions = {}
): Promise<AssertionResult> {
	// Build context for the core evaluate function
	const context: TaskExecutionContext = {
		page,
		agentServices,
		domService: new DomService(agentServices.getDomServiceOptions()),
		executionHistory: options.executionHistory,
		variables: options.variables,
		sensitiveKeys: options.sensitiveKeys,
	};

	// Replace $variable placeholders (e.g., $username, $password) with actual values
	const resolvedStatement = agentServices.replaceVariables(statement);
	// Allow callers to explicitly force clean screenshots; otherwise default to org setting.
	options.useCleanScreenshotForAssertion ??= agentServices.isUseCleanScreenshotForAssertion();
	// Call core LLM function
	return evaluate(resolvedStatement, context, options);
}

/**
 * Run a complete task - executes multiple steps until goal is accomplished
 *
 * This is the main agent loop with intelligent task execution:
 * 1. Thinking and reasoning at each step
 * 2. Evaluation of previous actions
 * 3. Memory tracking across steps
 * 4. Goal decomposition
 * 5. Error recovery with retry logic
 *
 * @param task - User's goal/instruction (complete task description)
 * @param page - Playwright Page instance
 * @param agent - Agent instance
 * @param onEvent - Callback for streaming events
 * @param options - Agent options (maxSteps, model, chatHistory, etc.)
 * @returns Final StepResult with chatSummary for conversation history
 */
export async function runTask(
	task: string,
	page: Page,
	agentServices: AgentServices,
	onEvent?: (event: AgentEvent) => void,
	options: AgentOptions = {}
): Promise<StepResult> {
	// Use the task executor
	const { runTaskLoop } = await import('./task');

	// Convert AgentEvent to ITaskAgentEvent
	const taskAgentOnEvent = onEvent
		? (event: any) => {
				// Map ITaskAgentEvent to AgentEvent
				onEvent(event as AgentEvent);
		  }
		: undefined;

	// Execute with runTaskLoop
	const result = await runTaskLoop(
		task,
		{
			page,
			agentServices,
			domService: undefined as any, // Will be created internally
			executionHistory: options.executionHistory,
			variables: options.variables,
			sensitiveKeys: options.sensitiveKeys,
		} as TaskExecutionContext,
		{
			maxSteps: options.maxSteps,
			onEvent: taskAgentOnEvent,
			abortSignal: options.abortSignal,
		} as TaskExecutionOptions
	);

	// Map TaskExecutionResult to StepResult
	return {
		status: result.success ? 'success' : 'error',
		completed: result.completed,
		actionEntities: result.trajectory.actions,
		explanation: result.summary,
		error: result.error,
		tokenUsages: result.metadata.tokenUsages,
	};
}
