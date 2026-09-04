/**
 * Task Agent Meta-Tools
 *
 * These tools allow the agent to manage its own execution state:
 * - Set current goal
 * - Evaluate previous step
 * - Update memory
 * - Mark task as complete
 *
 * These are used alongside browser action tools to create a complete task execution system.
 */

import { z } from 'zod';

/**
 * AI SDK tool definition type
 */
type AISdkTool = {
	description: string;
	inputSchema: z.ZodTypeAny;
};

/**
 * Set the current goal for this step
 */
export const setGoalTool: AISdkTool = {
	description: 'Set a specific, measurable goal for the current step. Make it concrete and verifiable, focused on the immediate next action.',
	inputSchema: z.object({
		goal: z.string().describe('The specific goal to accomplish in this step (e.g., "Click the login button")'),
	}).strict(),
};

/**
 * Evaluate the previous step's outcome
 */
export const evaluateStepTool: AISdkTool = {
	description: 'Evaluate whether the previous step succeeded, partially succeeded, or failed. Also indicate if the OVERALL TASK is now complete. Be honest in your assessment.',
	inputSchema: z.object({
		evaluation: z.enum(['success', 'partial', 'failure']).describe('Outcome of the previous step'),
		reason: z.string().describe('Brief explanation of why the step had this outcome'),
		task_complete: z.boolean().optional().describe('Set to true if the OVERALL TASK goal is now achieved (not just this step). For example: if task is "search for dining table" and search results are displayed, set task_complete=true. Only add more steps if explicitly asked.'),
	}).strict(),
};

/**
 * Update the agent's memory with important facts
 */
export const updateMemoryTool: AISdkTool = {
	description: 'Store an important fact to remember across steps. Only use when learning something new that will be relevant later.',
	inputSchema: z.object({
		fact: z.string().describe('Important fact to remember (keep it concise)'),
	}).strict(),
};

/**
 * Mark the task as complete
 */
export const markCompleteTool: AISdkTool = {
	description: 'Mark the task as complete or failed. Set completed=true when the task goal is achieved. Set completed=false when stuck, uncertain, or after repeated failures - fail fast to generate clean trajectories.',
	inputSchema: z.object({
		completed: z.boolean().describe('True if task goal is achieved, false if stuck/uncertain/failed'),
	}).strict(),
};

/**
 * Get all task agent meta-tools as a record
 */
export function getTaskAgentMetaTools(): Record<string, AISdkTool> {
	return {
		set_goal: setGoalTool,
		evaluate_step: evaluateStepTool,
		update_memory: updateMemoryTool,
		mark_complete: markCompleteTool,
	};
}

/**
 * Type for meta-tool call results
 */
export interface MetaToolResult {
	tool: 'set_goal' | 'evaluate_step' | 'update_memory' | 'mark_complete';
	args: any;
}
