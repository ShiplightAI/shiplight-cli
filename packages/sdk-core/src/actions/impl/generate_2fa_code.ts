/**
 * generate_2fa_code action - Generate a 2FA code from a secret key
 */

import { z } from 'zod';
import { Page } from 'playwright';
import type { AgentServices } from '../../agent/agentServices';
import { IAction, ActionEntity } from '../types';
import { ToolRegistry } from '../../llm_tools/registry';

// ============================================================================
// Action Implementation
// ============================================================================

export class Generate2faCodeAction implements IAction {
  async execute(
    page: Page,
    actionEntity: ActionEntity,
    agentServices: AgentServices
  ): Promise<void> {
    const actionData = actionEntity.action_data;
    if (!actionData) {
      throw new Error('Action data not found');
    }

    const secretKey = actionData.kwargs.otp_secret_key;
    if (!secretKey) {
      throw new Error('Missing otp_secret_key for generate_2fa_code');
    }

    // Replace sensitive data in secret key before using it
    const cleanSecretKey = agentServices.replaceVariables(String(secretKey));

    // Generate 2FA code using agent
    const otp_code = await agentServices.generate2faCode(cleanSecretKey);
    agentServices.saveVariable('otp_code', otp_code);
  }

  transpile(actionEntity: ActionEntity): string[] {
    const secretKey = actionEntity.action_data?.kwargs?.otp_secret_key || '';
    return [
      `await agent.execAction("generate_2fa_code", page, {`,
      `  action_data: { kwargs: { otp_secret_key: ${JSON.stringify(secretKey)} } },`,
      `});`
    ];
  }
}

// ============================================================================
// LLM Tool Schema & Registration
// ============================================================================

export const Generate2faCodeToolSchema = z.object({
  otp_secret_key: z.string().describe('The OTP secret key to generate the 2FA code from'),
});

export function registerGenerate2faCodeTool(registry: ToolRegistry, action: IAction) {
  registry.register({
    name: 'generate_2fa_code',
    description: 'Generate a 2FA code from an OTP secret key. The code is saved to the "otp_code" variable. To use the otp_code, you must use `$otp_code` to access it.',
    schema: Generate2faCodeToolSchema,

    async execute(args, ctx) {
      const { otp_secret_key } = args;
      const { page, agentServices } = ctx;

      try {
        const actionEntity: ActionEntity = {
          action_description: `Generate 2FA code`,
          action_data: {
            action_name: 'generate_2fa_code',
            kwargs: { otp_secret_key },
          },
        };

        await action.execute(page, actionEntity, agentServices);

        return {
          success: true,
          actionEntity,
          message: `Generated 2FA code and saved to variable "otp_code"`,
        };
      } catch (error) {
        return {
          success: false,
          error: (error as Error).message,
          actionEntity: {
            action_description: `Generate 2FA code (failed)`,
            action_data: {
              action_name: 'generate_2fa_code',
              kwargs: { otp_secret_key },
            },
            feedback: (error as Error).message,
          },
        };
      }
    },
  });
}
