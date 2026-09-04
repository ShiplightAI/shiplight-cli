/**
 * go_to_url action - Navigate to a specific URL
 */

import { Page } from 'playwright';
import { z } from 'zod';
import type { AgentServices } from '../../agent/agentServices';
import { ToolRegistry } from '../../llm_tools/registry';
import { ActionEntity, IAction } from '../types';
import { GOTO_TIMEOUT } from '../utils';

// ============================================================================
// Action Implementation
// ============================================================================

export class GoToUrlAction implements IAction {
  async execute(page: Page, actionEntity: ActionEntity, agentServices: AgentServices): Promise<void> {
    const actionData = actionEntity.action_data;
    if (!actionData) {
      throw new Error('Action data not found');
    }

    const url = actionData.kwargs.url;
    if (!url) {
      throw new Error('Missing URL for go_to_url action');
    }

    const newTab = actionData.kwargs.new_tab === true;
    let cleanUrl = agentServices.replaceVariables(String(url));

    // Resolve relative paths (e.g. "/", "/login") against the current page's origin
    if (cleanUrl.startsWith('/')) {
      const currentUrl = page.url();
      let origin: string | null = null;
      try {
        const parsed = new URL(currentUrl);
        if (parsed.origin && parsed.origin !== 'null') {
          origin = parsed.origin;
        }
      } catch {
        // current page has no valid URL (e.g. about:blank)
      }
      if (origin) {
        cleanUrl = origin + cleanUrl;
      }
      // Otherwise leave as relative — Playwright resolves against baseURL
    }

    const timeoutMs = actionData.kwargs.timeout_seconds
      ? actionData.kwargs.timeout_seconds * 1000
      : GOTO_TIMEOUT;

    let targetPage = page;

    if (newTab) {
      // Open a new tab in the same browser context
      // PageManager will automatically track this via context.on("page") event
      const context = page.context();
      targetPage = await context.newPage();
      // Update the page reference via agentServices
      agentServices.setPage(targetPage);
    }

    await targetPage.goto(cleanUrl, { timeout: timeoutMs });
  }

  transpile(actionEntity: ActionEntity): string[] {
    const url = actionEntity.action_data?.kwargs?.url || '';
    const newTab = actionEntity.action_data?.kwargs?.new_tab === true;
    const timeoutSeconds = actionEntity.action_data?.kwargs?.timeout_seconds;

    const kwargsEntries: string[] = [`url: ${JSON.stringify(url)}`];
    if (newTab) kwargsEntries.push(`new_tab: true`);
    if (timeoutSeconds) kwargsEntries.push(`timeout_seconds: ${timeoutSeconds}`);

    return [
      `await agent.execAction("go_to_url", page, {`,
      `  action_data: { kwargs: { ${kwargsEntries.join(', ')} } },`,
      `});`
    ];
  }
}

// ============================================================================
// LLM Tool Schema & Registration
// ============================================================================

export const GoToUrlToolSchema = z.object({
  url: z.string().describe('URL to navigate to (HTTP/HTTPS URL, or a path like "/home")'),
  new_tab: z.boolean().optional().describe('If true, open the URL in a new tab instead of the current page. Default is false.'),
  timeout_seconds: z.number().positive().optional()
    .describe('Navigation timeout in seconds. Set this only when the instruction states a timeout; otherwise leave it unset so the 20s default applies.'),
});

export function registerGoToUrlTool(registry: ToolRegistry, action: IAction) {
  registry.register({
    name: 'go_to_url',
    description: 'Navigate to a specific URL. Use this to visit web pages. Set new_tab=true to open in a new tab.',
    schema: GoToUrlToolSchema,

    async execute(args, ctx) {
      const { url, new_tab, timeout_seconds } = args;
      const { page, agentServices, actionDescription } = ctx as any;

      const kwargs: Record<string, unknown> = { url, new_tab: new_tab ?? false };
      if (timeout_seconds !== undefined) kwargs.timeout_seconds = timeout_seconds;

      const timeoutSuffix = timeout_seconds ? ` (timeout: ${timeout_seconds}s)` : '';

      try {
        const defaultDescription = new_tab ? `Open ${url} in new tab` : `Navigate to ${url}`;
        const actionEntity: ActionEntity = {
          action_description: actionDescription || defaultDescription,
          action_data: {
            action_name: 'go_to_url',
            kwargs,
          },
        };

        await action.execute(page, actionEntity, agentServices);

        return {
          success: true,
          actionEntity,
          message: (new_tab ? `Opened ${url} in new tab` : `Navigated to ${url}`) + timeoutSuffix,
        };
      } catch (error) {
        const defaultDescription = new_tab ? `Open ${url} in new tab` : `Navigate to ${url}`;
        return {
          success: false,
          error: (error as Error).message,
          actionEntity: {
            action_description: (actionDescription || defaultDescription) + ' (failed)',
            action_data: {
              action_name: 'go_to_url',
              kwargs,
            },
            feedback: (error as Error).message,
          },
        };
      }
    },
  });
}
