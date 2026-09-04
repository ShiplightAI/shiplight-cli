// ============================================================================
// Debug Info Types
// ============================================================================

import { PreloadedKnowledge } from "./knowledge";

/**
 * Token usage information from LLM calls
 * Matches the Python TokenUsage model from agent_backend/agent_utils/token_utils.py
 */
export interface TokenUsage {
	prompt_tokens: number;
	completion_tokens: number;
	total_tokens: number;
	estimated_cost_usd?: number;
	model?: string;
}

/**
 * Multimodal message part for logging
 * Images are stored as data URLs (base64) or regular URLs
 */
export interface MessagePartForLogging {
	type: 'text' | 'image';
	/** Text content (for type: 'text') */
	text?: string;
	/** Image data URL (base64) or regular URL (for type: 'image') */
	file?: string;
}

/**
 * Message structure for logging LLM interactions
 */
export interface MessageForLogging {
	role: 'user' | 'assistant' | 'system';
	content: string | MessagePartForLogging[];
}

/**
 * Debug info captured during action generation
 * Used for debugging and logging LLM interactions
 */
export interface ActionGenerationDebugInfo {
	/** The system prompt sent to the LLM */
	systemPrompt?: string;
	/**
	 * The user prompt sent to the LLM
	 * Can be a string (text-only) or structured MessageForLogging[] (multimodal with text/image parts)
	 */
	userPrompt?: string | MessageForLogging[];
	/** The raw response from the LLM */
	rawLlmResponse?: string;
	/** Reasoning/thinking content from the LLM (if native thinking enabled) */
	reasoningContent?: string;
	/** Screenshot with SOM (Set-of-Marks) annotations as base64 */
	screenshotWithSom?: string;
	/** Retrieved knowledges used for the action */
	retrievedKnowledges?: PreloadedKnowledge[];
	/** Token usage from the LLM call */
	tokenUsages?: TokenUsage[];
	/** Element tree string for hard case capture */
	elementTree?: string;
	/** Debug info for Computer Use Agent (CUA) actions */
	cuaDebugInfo?: {
		cuaInput: any;
		cuaRawResponse: any;
	};
}