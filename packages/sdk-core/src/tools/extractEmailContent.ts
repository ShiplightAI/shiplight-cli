/**
 * extract_email_content action - Extract content from emails via Mailgun
 */

import { z } from 'zod';
import { Page } from 'playwright';
import type { AgentServices } from '../agent/agentServices';
import type { ToolExecutionContext } from '../llm_tools/types';
import type { ActionEntity, IAction } from '../actions/types';
import type { ToolRegistrationConfig, ToolResult } from '../llm_tools/types';
import { ToolRegistry } from '../llm_tools/registry';
import logger from '../utils/logger';
import { getSdkConfig } from '../config';
import { extractEmailContent, type MailgunConfig, type ExtractionType } from '../providers/mailgun';
import { resolveApiBase } from '../utils/resolveApiBase';

const VARIABLE_FILTER_FIELDS = [
  'filter_from_email',
  'filter_to_email',
  'filter_subject',
  'filter_body_contains',
] as const;

/** Resolve runtime variables in user-authored email filter fields. */
export function resolveExtractEmailContentVariables<T extends Record<string, unknown>>(
  args: T,
  replaceVariables: (input: string) => string
): T {
  const resolved: Record<string, unknown> = { ...args };

  for (const field of VARIABLE_FILTER_FIELDS) {
    const value = resolved[field];
    if (typeof value === 'string') {
      resolved[field] = replaceVariables(value);
    }
  }

  return resolved as T;
}

// ============================================================================
// Action Implementation
// ============================================================================

/**
 * Get default variable name based on extraction type
 */
function getVariableName(extractionType: string): string {
  switch (extractionType) {
    case 'verification_code':
      return 'email_otp_code';
    case 'activation_link':
      return 'email_magic_link';
    case 'custom':
      return 'email_extracted_content';
    default:
      return 'email_content';
  }
}

export class ExtractEmailContentAction implements IAction {
  /**
   * Get Mailgun configuration from SDK config at execution time
   */
  private getMailgunConfig(): MailgunConfig | undefined {
    const config = getSdkConfig();
    const env = config.env || {};

    if (env.MAILGUN_API_KEY) {
      return {
        apiKey: env.MAILGUN_API_KEY,
        domain: env.MAILGUN_DOMAIN || '',
      };
    }

    const shiplightToken = env.SHIPLIGHT_API_TOKEN;
    const shiplightBase = shiplightToken
      ? resolveApiBase(shiplightToken, env.SHIPLIGHT_API_URL)
      : null;
    if (shiplightToken && shiplightBase) {
      const baseURL = `${shiplightBase}/mailgun`;
      logger.debug(`[extract_email_content] Using Shiplight proxy for Mailgun: ${baseURL}`);
      return {
        apiKey: shiplightToken,
        domain: env.MAILGUN_DOMAIN || '',
        baseURL,
        authHeader: `Bearer ${shiplightToken}`,
      };
    }

    return undefined;
  }

  async execute(
    _page: Page,
    actionEntity: ActionEntity,
    agentServices: AgentServices
  ): Promise<void> {
    const actionData = actionEntity.action_data;
    if (!actionData) {
      throw new Error('Action data not found');
    }

    // Get Mailgun config at execution time from SDK config
    const mailgunConfig = this.getMailgunConfig();
    if (!mailgunConfig) {
      throw new Error('Mailgun configuration not provided. Please configure MAILGUN_API_KEY and MAILGUN_DOMAIN, or set SHIPLIGHT_API_TOKEN to route through the Shiplight proxy.');
    }

    const args = resolveExtractEmailContentVariables(
      actionData.kwargs,
      (input) => agentServices.replaceVariables(input)
    );

    // Get the model from agentServices if available
    const model = agentServices.getModel?.() || 'gemini-2.5-pro';

    const result = await extractEmailContent(mailgunConfig, {
      model,
      forward_email: args.forward_email,
      extraction_type: args.extraction_type as ExtractionType,
      prompt: args.prompt,
      filters: {
        from_email: args.filter_from_email,
        to_email: args.filter_to_email,
        subject: args.filter_subject,
        body_contains: args.filter_body_contains,
      },
      timeout: args.timeout,
    });

    if (result.status === 'success' && result.data) {
      // Store the extracted value in the variable store
      const variableName = result.result_variable?.replace(/^\$/, '') || getVariableName(args.extraction_type);
      agentServices.variableStore.set(variableName, result.data);
      logger.info(`[extract_email_content] Extracted and saved to ${variableName}`);
    } else {
      throw new Error(result.message || 'Failed to extract email content');
    }
  }

  transpile(actionEntity: ActionEntity): string[] {
    const kwargs = actionEntity.action_data?.kwargs || {};
    return [
      `await agent.execAction("extract_email_content", page, {`,
      `  action_data: { kwargs: ${JSON.stringify(kwargs)} },`,
      `});`
    ];
  }
}

// ============================================================================
// LLM Tool Schema & Registration
// ============================================================================

/**
 * Schema for extract_email_content tool
 */
export const ExtractEmailContentSchema = z.object({
  forward_email: z.string().describe('Email address where emails are forwarded to (Mailgun inbox)'),
  extraction_type: z.enum(['verification_code', 'activation_link', 'custom']).describe('Type of content to extract: verification_code for OTP codes, activation_link for magic links, custom for custom prompts'),
  prompt: z.string().optional().describe('Custom extraction prompt (required when extraction_type is custom)'),
  filter_from_email: z.string().optional().describe('Filter emails by sender address'),
  filter_to_email: z.string().optional().describe('Filter emails by recipient address'),
  filter_subject: z.string().optional().describe('Filter emails by subject (partial match)'),
  filter_body_contains: z.string().optional().describe('Filter emails by body content (partial match)'),
  timeout: z.number().optional().describe('Timeout in seconds for polling (default: 60)'),
});

export type ExtractEmailContentArgs = z.infer<typeof ExtractEmailContentSchema>;

export function registerExtractEmailContentTool(
  registry: ToolRegistry,
  action: IAction
) {
  registry.register({
    name: 'extract_email_content',
    description: 'Extract verification codes, magic links, or custom content from emails received via Mailgun. Polls the Mailgun inbox for matching emails and uses AI to extract the requested content.',
    schema: ExtractEmailContentSchema,

    async execute(args, ctx) {
      const {
        forward_email,
        extraction_type,
        prompt,
        filter_from_email,
        filter_to_email,
        filter_subject,
        filter_body_contains,
        timeout
      } = args;
      const { page, agentServices } = ctx;

      logger.info(`[extract_email_content] Extracting ${extraction_type} from ${forward_email}`);

      try {
        const actionEntity: ActionEntity = {
          action_description: `Extract ${extraction_type} from email`,
          action_data: {
            action_name: 'extract_email_content',
            kwargs: {
              forward_email,
              extraction_type,
              prompt,
              filter_from_email,
              filter_to_email,
              filter_subject,
              filter_body_contains,
              timeout,
            },
          },
        };

        await action.execute(page, actionEntity, agentServices);

        const variableName = getVariableName(extraction_type);
        return {
          success: true,
          actionEntity,
          message: `Extracted ${extraction_type} and saved to $${variableName}`,
        };
      } catch (error) {
        return {
          success: false,
          error: (error as Error).message,
          actionEntity: {
            action_description: `Extract ${extraction_type} from email (failed)`,
            action_data: {
              action_name: 'extract_email_content',
              kwargs: {
                forward_email,
                extraction_type,
                prompt,
                filter_from_email,
                filter_to_email,
                filter_subject,
                filter_body_contains,
                timeout,
              },
            },
            feedback: (error as Error).message,
          },
        };
      }
    },
  });
}

/**
 * Create the extract_email_content tool for registration with toolRegistry
 * Legacy function for backward compatibility
 */
export function createExtractEmailContentTool(): ToolRegistrationConfig<typeof ExtractEmailContentSchema> {
  const action = new ExtractEmailContentAction();

  return {
    name: 'extract_email_content',
    description: 'Extract verification codes, magic links, or custom content from emails received via Mailgun. Polls the Mailgun inbox for matching emails and uses AI to extract the requested content.',
    schema: ExtractEmailContentSchema,
    usesElementIndex: false,
    availability: {
      openai: true,
      mcp: true,
    },

    async execute(
      args: ExtractEmailContentArgs,
      ctx: ToolExecutionContext
    ): Promise<ToolResult> {
      logger.info(`[extract_email_content] Extracting ${args.extraction_type} from ${args.forward_email}`);

      try {
        const actionEntity: ActionEntity = {
          action_description: `Extract ${args.extraction_type} from email`,
          action_data: {
            action_name: 'extract_email_content',
            kwargs: args,
          },
        };

        await action.execute(ctx.page, actionEntity, ctx.agentServices);

        const variableName = getVariableName(args.extraction_type);
        return {
          success: true,
          message: `Extracted ${args.extraction_type} and saved to $${variableName}`,
          actionEntity,
        };
      } catch (error: any) {
        logger.error(`[extract_email_content] Failed: ${error.message}`);
        return {
          success: false,
          error: error.message,
          actionEntity: {
            action_description: `Failed to extract email content: ${error.message}`,
            action_data: {
              action_name: 'extract_email_content',
              kwargs: args,
            },
            feedback: error.message,
          },
        };
      }
    },
  };
}
