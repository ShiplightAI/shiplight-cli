/**
 * Action Generation Prompts
 *
 * This module provides stub implementations of prompt generation functions.
 * TODO: A colleague will provide the real prompt templates to replace these stubs.
 *
 * Structure mirrors Python implementation in webagent/agent_backend/api/actions/action_prompts.py
 */

import { UserContent } from 'ai';
import { KnowledgeItem, createKnowledgeParts } from '../../services/knowledgeService';

/**
 * Get current time formatted for prompts using America/Los_Angeles timezone.
 * Matches Python implementation: datetime.now(ZoneInfo("America/Los_Angeles"))
 *
 * @returns Formatted time string like "2025-12-01 21:25:30.123 PST"
 */
function getCurrentTimeForPrompt(): string {
  const now = new Date();

  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Los_Angeles',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
    timeZoneName: 'short',
  });

  const parts = formatter.formatToParts(now);
  const year = parts.find(p => p.type === 'year')!.value;
  const month = parts.find(p => p.type === 'month')!.value;
  const day = parts.find(p => p.type === 'day')!.value;
  const hour = parts.find(p => p.type === 'hour')!.value;
  const minute = parts.find(p => p.type === 'minute')!.value;
  const second = parts.find(p => p.type === 'second')!.value;
  const timeZoneName = parts.find(p => p.type === 'timeZoneName')!.value;
  const milliseconds = String(now.getMilliseconds()).padStart(3, '0');

  return `${year}-${month}-${day} ${hour}:${minute}:${second}.${milliseconds} ${timeZoneName}`;
}

/**
 * Page context information for prompt generation
 */
export interface PageContext {
  /** Formatted DOM elements text */
  elementsText: string;
  /** Current page URL */
  currentUrl: string;
  /** Current page title */
  currentTitle: string;
  /** Current tab information text */
  currentTabText: string;
  /** All available tabs text */
  tabsText: string;
  /** Screenshot base64 (for future use) */
  screenshotBase64?: string;
  /** Sliced screenshots base64 array (for future use) */
  slicedScreenshotsBase64?: string[];
}

// KnowledgeItem is now imported from knowledgeService.ts (removed duplicate definition)

/**
 * Generate system prompt for action generation
 *
 * Python equivalent: get_action_generation_system_prompt() in action_prompts.py
 *
 * @param actionDescription - Description of available actions (from controller registry)
 * @returns System prompt string
 */
export function getActionGenerationSystemPrompt(
  actionDescription: string,
): string {
  return `# Your Role
You are part of a end-to-end testing system that is designed to automate the testing of a website. Given an instruction in natural language, your job is to translate it into an action in the predefined actions. The instruction might not match any action in the predefined actions or might require to interact with an element that is not on the page. It's your job to detect these cases and return an empty action.

# Rules
## Action Selection Rules
- First determine whether the instruction requests an explicit operation, a desired end state, or a conditional operation.
- If the instruction explicitly asks to perform an operation, select that operation even when the current page appears to already be in the resulting state. Do not replace an explicitly requested operation with \`wait\`.
- If the instruction asks to ensure or establish a desired end state, and the current page clearly already satisfies that state, select the \`wait\` action for 1 second and set \`completes_instruction\` to true.
- For conditional instructions, if the condition for performing the action is false because the desired state is already satisfied, select the \`wait\` action for 1 second and set \`completes_instruction\` to true.
- If the instruction requires a specific action, you must select that action. If no action matches the specific action, you must return an empty action so that testing system can aware of the situation.
- If asked to do nothing or ignore the instruction or something similar, you must select \`wait\` action of 1 second.
- If asked to verify something, you must select \`verify\` action.
- If asked to do accurate interaction, like selecting a specific chunk of text or drawing a bounding box, you must select \`perform_accurate_operation\` action.
- If asked to scroll, you decide if you need to \`scroll\` the page or \`scroll_on_element\`. also you need to calculate how much to scroll.

## Element Selection Rules
- If the instruction requires to interact with a specific element, you must select that element.
- If no element matches the specific element, you must return an empty action so that testing system can aware of the situation. NEVER click on alternative elements as a workaround. NEVER try to navigate to find the element (e.g. by scrolling, closing modals, clicking other buttons, or refreshing the page).
- Fail fast: If the exact target element is not visible on the current page, return an empty action immediately. The testing system will handle recovery.
- The type of the selected element doesn't have to match the target, for example, if the instruction requires to interact with an image but no image element matches, you can select a div that contains the image.

## Instruction Completion Analysis Rules
- Reasoning about the instruction completion is critical. You must analyze the instruction and your action to determine if your action will complete the instruction.

## Response Format Rules
- Respond using valid JSON format, which can be parsed by python json.loads():
{
    "thought": "...", // step by step reasoning of your decision making process
    "description": "...", // detailed description of the action to be performed. (e.g. click on the 'Submit' button to submit the form)
    "action": {"one_action_name": {// action-specific parameter}},
    "completes_instruction": true/false // boolean indicating whether the selected action fully performs what was asked. Set to true if the action directly executes the instruction, even if the instruction describes a purpose or goal (e.g. "scroll to find X", "click to navigate to Y"). Set to false only when the instruction explicitly requires multiple distinct actions and this action only covers part of them, or when no matching action exists (empty action).
}

Follow the rules above strictly.

# Action Space
${actionDescription}

# Examples
Example of an explicit operation whose result already appears satisfied:
instruction: "Navigate to /"
current webpage state: The current path is already "/".
{
    "thought": "The instruction explicitly requests navigation, so I will perform it even though the current path is already '/'.",
    "description": "Navigate to /.",
    "action": {"go_to_url": {"url": "/"}},
    "completes_instruction": true
}

Example of a desired end state that is already satisfied:
instruction: "Ensure the current path is /"
current webpage state: The current path is already "/".
{
    "thought": "The requested end state is already satisfied, so no navigation is needed.",
    "description": "The current path is already /; wait without changing it.",
    "action": {"wait": {"seconds": 1}},
    "completes_instruction": true
}

Example of a conditional operation whose condition is false:
instruction: "If the username is empty, enter the username"
current webpage state: The username field is not empty and already contains the requested username.
{
    "thought": "The username field is not empty and already contains the requested username, so the condition for entering it is false. I will not enter it again.",
    "description": "The username is already entered; wait without changing it.",
    "action": {"wait": {"seconds": 1}},
    "completes_instruction": true
}

Example of \`verify\` action:
instruction: "Verify that the page title is 'Home'"
{
    "thought": "I understand the instruction is to verify that the page title is 'Home'. I will use the \`verify\` action to verify the page title.", // Do not verify it yourself, just translate the instruction to the \`verify\` action
    "description": "Verify that the page title is 'Home'",
    "action": {"verify": {"statement": "the page title is 'Home'"}}, // the statement should be the same wording as the instruction, don't rephrase it
    "completes_instruction": true // this action fully completes the instruction
}

Example of \`save_variable\` action:
instruction: "Extract and save the page title as page_title"
{
    "thought": "I understand the instruction is to save the page title as page_title. The current page title is 'Home'. I will use the \`save_variable\` action to save the page title.",
    "description": "Save the page title as variable page_title",
    "action": {"save_variable": {"name": "page_title", "value": "Home"}}, // the value should be the same wording as the instruction, don't rephrase it
    "completes_instruction": true // this action fully completes the instruction
}

Example of empty action when the target element is not on the page, or the instruction cannot be completed for any reason:
{
    "thought": "The user wants me to click the 'Create Entry' button. However, the current page is a sign-in page and the only interactive element is the 'Sign In' button. The 'Create Entry' button is not present on the page. The previous attempt to click this button also failed. Therefore, I cannot complete the instruction and will return an empty action.",
    "description": "Click the 'Create Entry' button.",
    "action": {}, // empty action object to indicate the instruction cannot be completed
    "completes_instruction": false
}
`;
}

/**
 * Format execution history for prompt
 *
 * Python equivalent: format_execution_history() in action_prompts.py
 *
 * @param executionHistory - Array of [description, feedback] tuples
 * @returns Formatted execution history string (or empty string if none)
 */
function formatExecutionHistory(
  executionHistory?: Array<[string, string]>
): string {
  if (!executionHistory || executionHistory.length === 0) {
    return '';
  }

  let historyText = '';
  executionHistory.forEach(([description, feedback], index) => {
    historyText += `(${index + 1}) Description: ${description}\n    Feedback: ${feedback}\n`;
  });

  return `## Additional context
You just executed following steps in order:
${historyText}`;
}

/**
 * Generate user prompt for action generation (multimodal message array)
 *
 * Python equivalent: get_action_generation_user_prompt() in action_prompts.py
 *
 * @param pageContext - Current page context information
 * @param goal - The instruction/goal to accomplish
 * @param placeholderData - Placeholder data for variable substitution
 * @param executionHistory - Previous action execution history
 * @param knowledges - Retrieved knowledge items with optional images
 * @param screenshotBase64 - Screenshot base64 (for future use)
 * @param useSlicedScreenshots - Whether to use sliced screenshots
 * @param currentTime - Current time string for prompt
 * @param enableKnowledgeImages - Whether to include knowledge images
 * @param sensitiveKeys - Set of keys that are sensitive (values will be masked)
 * @returns Multimodal message content array
 */
export function getActionGenerationUserPrompt(
  pageContext: PageContext,
  goal: string,
  placeholderData?: Record<string, any>,
  executionHistory?: Array<[string, string]>,
  knowledges?: KnowledgeItem[],
  screenshotBase64?: string,
  useSlicedScreenshots: boolean = false,
  currentTime: string = getCurrentTimeForPrompt(),
  enableKnowledgeImages: boolean = false,
  sensitiveKeys?: Set<string>
): UserContent {

  const messages: UserContent = [];

  // Part 1: Task and DOM state
  const firstPart = `
# Instruction
"${goal}"

# Current webpage state
## Tab information:
${pageContext.currentTabText}Available tabs:
${pageContext.tabsText}

## Element interaction guidelines:
   - Only use indexes that exist in the provided element list
   - Each element has a unique index number (e.g., "[33]<button>")
   - The bounding box and index of each element is marked on the screenshot.
   - Elements marked with "[]Non-interactive text" are non-interactive (for context only)
   - Elements are indented to show the structure of the element tree, with indentation level indicating depth
   - When considering an element, also consider its children elements
   - If an element is scrollable, it will be marked with "(SCROLLABLE)" (e.g., "[33](SCROLLABLE)<ul>"), use the \`scroll_on_element\` action to scroll on the element.

## Interactive elements from current page:
${pageContext.elementsText}
    `;

  messages.push({
    type: 'text',
    text: firstPart,
  });

  // Part 2: Screenshot
  if (useSlicedScreenshots && pageContext.slicedScreenshotsBase64) {
    for (const screenshot of pageContext.slicedScreenshotsBase64) {
      messages.push({
        type: "text",
        text: "The following images provided are sliced screenshots of the current webpage, with interactive elements highlighted. The element index label locate at the top right corner of the bounding box.",
      });
      messages.push({
        type: 'file',
        mediaType: 'image/png',
        data: screenshot,
      });
    }
  } else if (screenshotBase64) {
    messages.push({
      type: "text",
      text: "The following image provided is a screenshot of the current webpage, with interactive elements highlighted. The element index label locate at the top right corner of the bounding box.",
    });
    messages.push({
      type: 'file',
      mediaType: 'image/png',
      data: screenshotBase64
    });
  }

  // Part 3: Retrieved Knowledge (if provided)
  // Use the ported knowledge parsing functions
  if (knowledges && knowledges.length > 0) {
    const knowledgeParts = createKnowledgeParts(knowledges, enableKnowledgeImages);
    messages.push(...knowledgeParts);
  }

  // Part 4: Current time, sensitive data, execution history, ending instruction
  let endingText = '';

  endingText += `\nCurrent local time is ${currentTime}.\n`;

  // Part 5: Placeholder data
  if (placeholderData && Object.keys(placeholderData).length > 0) {
    const placeholderList: string[] = [];
    for (const key of Object.keys(placeholderData)) {
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

    endingText += `
## Available Data Placeholders
The following placeholders are available for use in your actions:
${placeholderList.join('\n')}

To use them, write Jinja-like template syntax: {{ placeholder_name }}
- Use the EXACT placeholder name as shown above
- Do NOT use the actual value directly
- The values shown are for context only to help you understand what data is available
- In action descriptions, describe what the placeholder represents in natural language (e.g., "Type the first user name" instead of "Type {{ firstUserName }}")
`;
  }

  // Part 6: Execution history
  if (executionHistory && executionHistory.length > 0) {
    const executionHistoryText = formatExecutionHistory(executionHistory);
    endingText += '\n' + executionHistoryText;
  }

  // Part 7: Ending instruction
  endingText += '\nBased on the above information, please determine the right action to accomplish the task.\n';

  messages.push({
    type: 'text',
    text: endingText,
  });

  return messages;
}
