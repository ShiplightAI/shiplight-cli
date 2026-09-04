// Token usage information from LLM calls
// Matches the Python TokenUsage model from agent_backend/agent_utils/token_utils.py
export interface TokenUsage {
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
  estimated_cost_usd?: number;
  model?: string;
}

