/**
 * Agent - Main entry point for browser automation with custom actions
 */

import type { Page } from 'playwright';
import { VariableStore, replaceVariables } from 'shiplight-types';
import {
  Agent as WebAgent,
  createAgentContext,
  toolRegistry,
  type AgentStepResult,
} from 'sdk-core';
import { resolveActionArgs } from './variableResolution';
import { redactSensitiveValues } from './sensitiveRedaction';
import type {
  ICustomAction,
  ActionExecutionContext,
  CreateAgentOptions,
  LoginOptions,
  StepOptions,
  RunOptions,
} from './types';

/**
 * Browser automation agent with custom action support.
 *
 * @example
 * ```typescript
 * import { createAgent, configureSdk, z } from '@shiplightai/sdk';
 *
 * // Configure SDK with API key (call once at startup)
 * configureSdk({
 *   env: { GOOGLE_API_KEY: process.env.GOOGLE_API_KEY },
 * });
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
 *   description: 'Extract verification code from email inbox',
 *   schema: z.object({
 *     email_address: z.string(),
 *   }),
 *   async execute(args, ctx) {
 *     const code = await getEmailCode(args.email_address);
 *     ctx.variableStore.set('code', code);
 *     return { success: true };
 *   },
 * });
 *
 * // Use the agent
 * await agent.act(page, 'Fill email with $username');
 * await agent.act(page, 'Click submit');
 * await agent.act(page, 'Get the verification code from email');
 * await agent.act(page, 'Enter $code in the verification field');
 * await agent.assert(page, 'Dashboard is visible');
 * ```
 */
export class Agent {
  private webAgent: WebAgent;
  private variableStore: VariableStore;
  private customActions: Map<string, ICustomAction> = new Map();

  constructor(options: CreateAgentOptions) {
    // Create variable store
    this.variableStore = new VariableStore();
    const sensitiveSet = new Set(options.sensitiveKeys || []);

    // Set initial variables
    if (options.variables) {
      for (const [key, value] of Object.entries(options.variables)) {
        this.variableStore.set(key, value, sensitiveSet.has(key));
      }
    }

    // Create internal agent context
    const context = createAgentContext({
      model: options.model,
      computer_use_model: options.computer_use_model,
      variableStore: this.variableStore,
      testDataDir: options.testDataDir,
      downloadDir: options.downloadDir,
    });

    // Create internal web agent
    this.webAgent = new WebAgent(context);
  }

  /**
   * Register a custom action.
   *
   * Custom actions extend the agent's capabilities. The agent will automatically
   * call your action when the task requires it, based on the name and description.
   *
   * String arguments are variable-resolved before your `execute` function receives them
   * and before the schema validates them, including nested objects and arrays. The model
   * is instructed to emit `{{ placeholder }}` rather than the real value of a variable,
   * so an argument the model wrote as `{{ testEmail }}` arrives as `user@example.com`.
   * Unknown placeholders are passed through unchanged.
   *
   * Declare fields that carry a variable as plain `z.string()`. Refinements such as
   * `.email()` or `.regex()` are also checked against the model's literal output when
   * `act()` generates the action, and a placeholder does not satisfy them — so the action
   * is discarded before it ever runs. `run()` is not affected.
   *
   * The recorded trajectory keeps the placeholder, so a resolved value never reaches
   * stored runs, reports or generated code. Values of variables listed in
   * `sensitiveKeys` are additionally masked in the message your action returns and in any
   * error it produces, since that text is shown to the model.
   *
   * @param action - Custom action definition
   * @throws {Error} If action is missing required fields or name is already registered
   *
   * @example
   * ```typescript
   * agent.registerAction({
   *   name: 'send_sms',
   *   description: 'Send an SMS message to a phone number',
   *   schema: z.object({
   *     phone: z.string().describe('Phone number with country code'),
   *     message: z.string().describe('Message content'),
   *   }),
   *   async execute(args, ctx) {
   *     await twilioClient.send(args.phone, args.message);
   *     return { success: true, message: 'SMS sent' };
   *   },
   * });
   * ```
   */
  registerAction(action: ICustomAction): void {
    // Validate action
    if (!action.name) {
      throw new Error('CustomAction requires a name');
    }
    if (!action.description) {
      throw new Error('CustomAction requires a description');
    }
    if (!action.schema) {
      throw new Error('CustomAction requires a schema');
    }
    if (!action.execute) {
      throw new Error('CustomAction requires an execute function');
    }

    // Check for duplicate
    if (this.customActions.has(action.name)) {
      throw new Error(`CustomAction '${action.name}' is already registered`);
    }

    // Store action
    this.customActions.set(action.name, action);

    const variableStore = this.variableStore;

    // Sensitive values become visible once arguments are resolved, so mask them in every
    // string that leaves the action: the handler's message, its error, and the validation
    // error the registry builds from the resolved arguments. All three reach the
    // trajectory, and the failure text is shown to the model on the next step.
    const redact = (text: string | undefined) =>
      redactSensitiveValues(text, variableStore.getAll(), variableStore.getAllSensitiveKeys());

    // Register with the tool registry so the agent can call it
    toolRegistry.register({
      name: action.name,
      description: action.description,
      schema: action.schema,
      usesElementIndex: false,
      availability: {
        openai: true,
        mcp: true,
      },
      // The prompt tells the model to write {{ placeholder }} instead of the real value,
      // so resolve before the registry validates: a constrained field would otherwise
      // reject the placeholder at schema.parse and the handler would never run. (An
      // `act()` call also validates the model's literal output against this schema during
      // generation, which is why the docstring asks for plain z.string() on such fields.)
      resolveArgs: (args) => resolveActionArgs(args, variableStore.getAll()),
      redactErrorText: (text) => redact(text) ?? text,
      execute: async (args, toolContext) => {
        // Create the execution context for the custom action
        const ctx: ActionExecutionContext = {
          page: toolContext.page,
          variableStore: variableStore,
          replaceVariables: (text: string) => replaceVariables(text, variableStore.getAll()),
        };

        // The registry resolved `args`; `rawArgs` still holds what the model wrote. Record
        // the raw form so a resolved secret never reaches trajectories or generated code.
        // When rawArgs is absent no resolution ran, so `args` is already the raw form.
        const rawArgs = toolContext.rawArgs ?? args;

        try {
          // Execute the custom action
          const result = await action.execute(args, ctx);
          const message = redact(result.message);

          // Return tool result with action entity for trajectory
          return {
            success: result.success,
            message,
            actionEntity: {
              action_description: message || `Executed ${action.name}`,
              action_data: {
                action_name: action.name,
                kwargs: rawArgs,
              },
            },
          };
        } catch (error: any) {
          const message = redact(error.message);
          return {
            success: false,
            error: message,
            actionEntity: {
              action_description: `Failed to execute ${action.name}`,
              action_data: {
                action_name: action.name,
                kwargs: rawArgs,
              },
              feedback: message,
            },
          };
        }
      },
    });
  }

  /**
   * Perform a single action on the page.
   *
   * Use this for discrete actions like clicking a button, filling a field,
   * or selecting an option. The agent executes exactly one action.
   *
   * @param page - Playwright page instance
   * @param instruction - Natural language instruction for a single action
   * @returns Result with success status and details
   *
   * @example
   * ```typescript
   * await agent.act(page, 'Click the login button');
   * await agent.act(page, 'Fill the email field with $username');
   * await agent.act(page, 'Select "Express" from the shipping dropdown');
   * ```
   */
  async act(page: Page, instruction: string): Promise<AgentStepResult> {
    return this.webAgent.performAction(page, instruction);
  }

  /**
   * Run a multi-step instruction until the goal is achieved.
   *
   * Use this for complex tasks that require multiple actions, like
   * "Complete the checkout process" or "Fill out the registration form".
   * The agent will take multiple steps until the goal is reached.
   *
   * @param page - Playwright page instance
   * @param instruction - Natural language instruction describing the goal
   * @param options - Optional configuration
   * @returns Result with success status and details
   *
   * @example
   * ```typescript
   * // Multi-step tasks
   * await agent.run(page, 'Complete the checkout process');
   * await agent.run(page, 'Fill out the entire registration form');
   *
   * // Limit steps to prevent runaway execution
   * await agent.run(page, 'Add 3 items to cart', { maxSteps: 10 });
   * ```
   */
  async run(page: Page, instruction: string, options?: RunOptions): Promise<AgentStepResult> {
    return this.webAgent.run(page, instruction, undefined, {
      maxSteps: options?.maxSteps,
    });
  }

  /**
   * Assert a condition on the page.
   *
   * The agent will analyze the page and determine if the assertion is true.
   * Throws an error if the assertion fails.
   *
   * @param page - Playwright page instance
   * @param statement - Assertion statement (e.g., "Login button is visible")
   * @returns true if assertion passes
   * @throws {Error} If assertion fails
   *
   * @example
   * ```typescript
   * await agent.assert(page, 'The dashboard shows welcome message');
   * await agent.assert(page, 'Shopping cart has 3 items');
   * await agent.assert(page, 'Error message is not displayed');
   * ```
   */
  async assert(page: Page, statement: string): Promise<boolean> {
    return this.webAgent.assert(page, statement);
  }

  /**
   * Evaluate a condition on the page (returns boolean, doesn't throw).
   *
   * Similar to assert() but returns false instead of throwing on failure.
   * Use this for conditional logic in tests.
   *
   * @param page - Playwright page instance
   * @param statement - Condition to evaluate (e.g., "User is logged in")
   * @returns true if condition is met, false otherwise
   *
   * @example
   * ```typescript
   * const isLoggedIn = await agent.evaluate(page, 'User is logged in');
   * if (!isLoggedIn) {
   *   await agent.act(page, 'Click the login button');
   * }
   * ```
   */
  async evaluate(page: Page, statement: string): Promise<boolean> {
    return this.webAgent.evaluate(page, statement);
  }

  /**
   * Extract data from an element and store in a variable.
   *
   * @param page - Playwright page instance
   * @param elementDescription - Description of element to extract from
   * @param variableName - Name of variable to store the value
   *
   * @example
   * ```typescript
   * await agent.extract(page, 'the order total', 'orderTotal');
   * // Later use: await agent.run(page, 'Verify $orderTotal matches invoice');
   * ```
   */
  async extract(
    page: Page,
    elementDescription: string,
    variableName: string
  ): Promise<void> {
    return this.webAgent.extract(page, elementDescription, variableName);
  }

  /**
   * Perform automated login.
   *
   * The agent will navigate to the login URL, find login fields, enter credentials,
   * handle 2FA if configured, and verify successful login.
   *
   * @param page - Playwright page instance
   * @param options - Login URL, credentials, and options
   * @returns true if login was successful
   *
   * @example
   * ```typescript
   * await agent.login(page, {
   *   url: 'https://example.com/login',
   *   username: 'user@example.com',
   *   password: 'secret123',
   * });
   * await agent.assert(page, 'Dashboard is visible');
   * ```
   *
   * @example
   * ```typescript
   * // With 2FA
   * await agent.login(page, {
   *   url: 'https://example.com/login',
   *   username: 'user@example.com',
   *   password: 'secret123',
   *   totpSecret: 'JBSWY3DPEHPK3PXP',
   * });
   * ```
   */
  async login(page: Page, options: LoginOptions): Promise<boolean> {
    // Delegates to the sdk-core WebAgent.login wrapper — single source of truth
    // for building the LoginConfig (username/password + optional TOTP).
    return this.webAgent.login(page, options);
  }

  /**
   * Get a variable value from the variable store.
   *
   * Use this to access values that were set via extract() or setVariable().
   *
   * @param name - Variable name
   * @returns Variable value, or undefined if not set
   *
   * @example
   * ```typescript
   * await agent.extract(page, 'the order total', 'orderTotal');
   * const total = agent.getVariable('orderTotal');
   * console.log('Order total:', total);
   * ```
   */
  getVariable(name: string): string | undefined {
    return this.variableStore.get(name);
  }

  /**
   * Set a variable value in the variable store.
   *
   * Variables can be referenced in instructions using $variableName syntax.
   *
   * @param name - Variable name
   * @param value - Variable value
   * @param sensitive - If true, value will be masked in logs (default: false)
   *
   * @example
   * ```typescript
   * agent.setVariable('couponCode', 'SAVE20');
   * await agent.run(page, 'Enter $couponCode in the promo field');
   *
   * // Sensitive values are masked in logs
   * agent.setVariable('apiKey', 'secret123', true);
   * ```
   */
  setVariable(name: string, value: string, sensitive: boolean = false): void {
    this.variableStore.set(name, value, sensitive);
  }

  /**
   * Wait until a condition becomes true.
   *
   * Polls the page state and evaluates whether the condition is met.
   * Useful for waiting on dynamic content, animations, or async operations.
   *
   * @param page - Playwright page instance
   * @param condition - Natural language condition to wait for
   * @param timeoutSeconds - Maximum wait time in seconds (default: 60)
   * @returns true if condition was met, false if timeout
   *
   * @example
   * ```typescript
   * // Wait for loading to complete
   * await agent.waitUntil(page, 'Loading spinner is no longer visible');
   *
   * // Wait for data to appear
   * const appeared = await agent.waitUntil(page, 'Table shows at least 5 rows', 30);
   * if (!appeared) {
   *   throw new Error('Data did not load in time');
   * }
   *
   * // Wait for modal to close
   * await agent.waitUntil(page, 'Confirmation modal is closed');
   * ```
   */
  async waitUntil(
    page: Page,
    condition: string,
    timeoutSeconds: number = 60
  ): Promise<boolean> {
    const stepId = `waitUntil_${Date.now()}`;
    return this.webAgent.waitUntilCondition(page, condition, timeoutSeconds, stepId);
  }

  /**
   * Execute Playwright code with self-healing.
   *
   * Wraps Playwright code with automatic recovery. If the code throws
   * an exception, the agent will analyze the page and attempt to accomplish
   * the goal described in `description`.
   *
   * The `description` parameter is crucial - it tells the agent what you're trying
   * to achieve, so it can find alternative ways to accomplish the goal when
   * the original code fails (e.g., due to changed selectors or page structure).
   *
   * Self-healing behavior is controlled by `maxSteps`:
   * - 1: single retry with AI
   * - >1: multi-step recovery with AI (default: 5)
   *
   * @param page - Playwright page instance
   * @param action - Async function containing Playwright code to execute
   * @param description - Intent description - what the agent should accomplish if action fails
   * @param options - Optional configuration for this call
   * @returns Result with success status and action details
   *
   * @example
   * ```typescript
   * // Single action with self-healing
   * await agent.step(
   *   page,
   *   async () => await page.click('#submit-btn'),
   *   'Click the submit button'
   * );
   *
   * // Code block with multiple actions
   * await agent.step(
   *   page,
   *   async () => {
   *     await page.fill('#email', 'user@example.com');
   *     await page.fill('#password', 'secret');
   *     await page.click('#login');
   *   },
   *   'Fill login form and submit'
   * );
   *
   * // With maxSteps for multi-step recovery
   * await agent.step(
   *   page,
   *   async () => await page.click('.dynamic-button'),
   *   'Click the dynamic button that appears after loading',
   *   { maxSteps: 5 }
   * );
   * ```
   */
  async step(
    page: Page,
    action: () => Promise<void>,
    description: string,
    options?: StepOptions
  ): Promise<AgentStepResult> {
    // Generate a unique step ID
    const stepId = `step_${Date.now()}`;

    try {
      // Use the internal step function which handles self-healing
      const result = await this.webAgent.step(
        page,
        action,
        description,
        stepId,
        undefined, // stmtUid - not needed for public API
        true, // canSelfHeal
        options?.maxSteps ?? 5
      );

      // Normalize return value - internal step may return undefined on direct success
      // or AgentStepResult on self-healing success
      if (result && typeof result === 'object' && 'success' in result) {
        return result as AgentStepResult;
      }
      return { success: true };
    } catch (error: any) {
      // Return failure result instead of throwing
      return {
        success: false,
        details: error.message,
      };
    }
  }
}

/**
 * Create a browser automation agent.
 *
 * This is the main entry point for the SDK. Creates an agent that can
 * execute natural language instructions and supports custom actions.
 *
 * @param options - Agent configuration options
 * @returns Configured Agent instance
 *
 * @example
 * ```typescript
 * import { createAgent, configureSdk, z } from '@shiplightai/sdk';
 *
 * // Configure SDK with API key (call once at startup)
 * configureSdk({
 *   env: { GOOGLE_API_KEY: process.env.GOOGLE_API_KEY },
 * });
 *
 * const agent = createAgent({
 *   model: 'gemini-2.5-pro',
 *   variables: {
 *     username: 'test@example.com',
 *     password: 'secret123',
 *   },
 *   sensitiveKeys: ['password'],
 * });
 *
 * // Register custom actions
 * agent.registerAction({
 *   name: 'get_otp',
 *   description: 'Get OTP code from authenticator',
 *   schema: z.object({}),
 *   async execute(args, ctx) {
 *     const code = await generateOTP();
 *     ctx.variableStore.set('otp', code);
 *     return { success: true };
 *   },
 * });
 *
 * // Run automation
 * await agent.act(page, 'Fill username with $username');
 * await agent.act(page, 'Fill password with $password');
 * await agent.act(page, 'Click login');
 * await agent.act(page, 'Enter the OTP code');
 * await agent.assert(page, 'Dashboard is visible');
 * ```
 */
export function createAgent(options: CreateAgentOptions): Agent {
  return new Agent(options);
}
