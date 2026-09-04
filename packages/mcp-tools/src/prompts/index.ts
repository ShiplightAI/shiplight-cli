/**
 * MCP Prompts
 *
 * Shared prompt templates for Shiplight AI MCP servers.
 * Quick-reference prompts for tool usage patterns.
 */

export interface PromptDefinition {
  name: string;
  description: string;
  content: string;
}

export const PROMPTS: Record<string, PromptDefinition> = {
  "browser-session-basics": {
    name: "browser-session-basics",
    description: "Basic browser session management for UI verification",
    content: `# Browser Session Basics

1. Create: new_session(starting_url) - Launch browser session
2. Inspect: inspect_page(session_id) - Get DOM tree + screenshot (read DOM first, only view screenshot when needed)
3. Act: act(session_id, actions) - Execute actions using element indices from DOM
4. Close: close_session(session_id) - Close the browser session

Workflow: inspect_page → act → inspect_page → act → ... until done

act returns: { success, actions: [{ action_entity, success, error? }] }

**Action parameters:** See resource \`shiplight://schemas/action-entity\`
`,
  },
};

/**
 * Get prompt content by name
 */
export function getPrompt(name: string): string | undefined {
  const prompt = PROMPTS[name];
  return prompt?.content;
}

/**
 * List all available prompts
 */
export function listPrompts(): Array<{ name: string; description: string }> {
  return Object.values(PROMPTS).map((p) => ({
    name: p.name,
    description: p.description,
  }));
}
