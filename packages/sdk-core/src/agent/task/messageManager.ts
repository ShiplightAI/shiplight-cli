/**
 * Simple message manager for task agent conversation history
 * Manages the conversation with the LLM, keeping track of context and history
 */

import { AssistantModelMessage, FilePart, TextPart, UserModelMessage } from 'ai';
import { agentLogger } from '../../utils/agentLogger';
import { formatTaskContext } from './prompts';
import { TaskExecutionState } from './types';
export class TaskMessageManager {
	private systemPrompt: string;
	private messages: Array<UserModelMessage | AssistantModelMessage> = [];

	constructor(systemPrompt: string) {
		this.systemPrompt = systemPrompt;
	}

	/**
	 * Get all messages for LLM call (system prompt + conversation)
	 */
	getMessages(): {
		system: string;
		messages: Array<UserModelMessage | AssistantModelMessage>;
	} {
		return {
			system: this.systemPrompt,
			messages: [...this.messages],
		};
	}

	/**
	 * Add a user message with task context and current state
	 */
	addStateMessage(
		task: string,
		currentUrl: string,
		domTree: string,
		screenshotBase64: string,
		state: TaskExecutionState,
		options: {
			executionHistory?: Array<[string, string]>;
			placeholderData?: Record<string, string>;
			sensitiveKeys?: Set<string>;
			isFinalStep?: boolean;
			finalStepWarning?: string;
		} = {}
	): void {
		const { executionHistory, placeholderData, sensitiveKeys, isFinalStep, finalStepWarning } = options;

		const contentParts: Array<TextPart | FilePart> = [];

		// Add task context
		const taskContext = formatTaskContext(state, task, currentUrl);
		contentParts.push({
			type: 'text',
			text: taskContext,
		});

		// Add DOM state
		contentParts.push({
			type: 'text',
			text: `## CURRENT PAGE STATE\n\n**Interactive Elements**:\n${domTree}`,
		});

		// Add execution history if provided (from Playwright tests)
		if (executionHistory && Array.isArray(executionHistory) && executionHistory.length > 0) {
			const historyLines = executionHistory.map(
				([action, result], i) => `${i + 1}. ${action} → ${result}`
			);
			contentParts.push({
				type: 'text',
				text: `## EXECUTION HISTORY (from test)\n\n${historyLines.join('\n')}`,
			});
		}

		// Add placeholder data description if provided
		if (placeholderData && Object.keys(placeholderData).length > 0) {
			agentLogger.log('Adding placeholder data description');
			const placeholderDataDescription = this.getPlaceholderDataDescription(placeholderData, sensitiveKeys);
			agentLogger.log(`Placeholder data description: ${placeholderDataDescription}`);
			if (placeholderDataDescription) {
				contentParts.push({
					type: 'text',
					text: placeholderDataDescription,
				});
			}
		}

		// Add final step warning if this is the last step
		if (isFinalStep && finalStepWarning) {
			contentParts.push({
				type: 'text',
				text: finalStepWarning,
			});
		}

		// Add screenshot
		contentParts.push({
			type: 'file',
			mediaType: 'image/png',
			data: screenshotBase64,
		});

		agentLogger.log(`Adding state message: ${contentParts.length} parts`);
		this.messages.push({
			role: 'user',
			content: contentParts,
		});
	}

	/**
	 * Add assistant response (for tracking conversation)
	 */
	addAssistantMessage(response: string): void {
		this.messages.push({
			role: 'assistant',
			content: response,
		});
	}

	/**
	 * Add a simple text message (for clarifications, errors, etc.)
	 */
	addTextMessage(role: 'user' | 'assistant', text: string): void {
		this.messages.push({
			role,
			content: text,
		});
	}

	/**
	 * Get the current message count
	 */
	getMessageCount(): number {
		return this.messages.length;
	}

	/**
	 * Clear all messages (keep system prompt)
	 */
	clear(): void {
		this.messages = [];
	}

	/**
	 * Get the last N messages
	 */
	getRecentMessages(count: number): Array<UserModelMessage | AssistantModelMessage> {
		return this.messages.slice(-count);
	}

	/**
	 * Update system prompt (for dynamic changes)
	 */
	updateSystemPrompt(newPrompt: string): void {
		this.systemPrompt = newPrompt;
	}

	/**
	 * Add assistant message with tool calls (for tool calling mode)
	 */
	addAssistantMessageWithToolCalls(toolCalls: any[]): void {
		this.messages.push({
			role: 'assistant',
			content: toolCalls.map(tc => ({
				type: 'tool-call',
				toolCallId: tc.toolCallId,
				toolName: tc.toolName,
				input: tc.input, // AI SDK uses 'input' property
			})),
		} as any);
	}

	/**
	 * Add tool response message (for tool calling mode)
	 */
	addToolResponseMessage(result: string, toolCallId: string, toolName: string): void {
		this.messages.push({
			role: 'tool',
			content: [{
				type: 'tool-result',
				toolCallId,
				toolName,
				output: typeof result === 'string'
					? { type: 'text', value: result }
					: { type: 'json', value: result }, // AI SDK expects 'output' not 'result'
			}],
		} as any);
	}

	/**
	 * Generate a description of available placeholder data.
	 * Includes actual values for non-sensitive variables to provide context to the agent.
	 * Sensitive variables show only their names for security.
	 *
	 * The agent will output actions with {{ placeholder_name }} syntax,
	 * which are replaced with actual values at execution time.
	 */
	private getPlaceholderDataDescription(placeholderData: Record<string, string>, sensitiveKeys?: Set<string>): string {
		const placeholderList: string[] = [];

		for (const key of Object.keys(placeholderData)) {
			// Only add placeholders that have non-empty values
			if (placeholderData[key]) {
				const isSensitive = sensitiveKeys?.has(key);
				if (isSensitive) {
					// For sensitive variables, only show the name
					placeholderList.push(`  - ${key}: [SENSITIVE - value hidden]`);
				} else {
					// For non-sensitive variables, show both name and value
					const value = placeholderData[key];
					const valueStr = typeof value === 'string' ? value : JSON.stringify(value);
					placeholderList.push(`  - ${key}: "${valueStr}"`);
				}
			}
		}

		if (placeholderList.length === 0) {
			return '';
		}

		let info = `## DATA PLACEHOLDERS\n\n`;
		info += `The following placeholders are available for use in your actions:\n`;
		info += `${placeholderList.join('\n')}\n\n`;
		info += `IMPORTANT: When generating actions, you MUST use the placeholder name in template syntax: {{ placeholder_name }}\n`;
		info += `- Use the EXACT placeholder name as shown above\n`;
		info += `- Do NOT use the actual value directly in the action\n`;
		info += `- The values shown are for context only to help you understand what data is available\n`;
		info += `- In action descriptions, describe what the placeholder represents in natural language (e.g., "Type the first user name" instead of "Type {{ firstUserName }}")`;

		return info;
	}
}
