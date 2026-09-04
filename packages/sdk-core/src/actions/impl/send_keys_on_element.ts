/**
 * press action - Press a keyboard key
 */

import { Page } from "playwright";
import type { AgentServices } from "../../agent/agentServices";
import { ActionEntity, IAction } from "../types";
import { getActionTimeoutMs, getLocator, getPageLocatorExpression } from "../utils";

// ============================================================================
// Action Implementation
// ============================================================================

export class SendKeysOnElementAction implements IAction {
  async execute(page: Page, actionEntity: ActionEntity, agentServices: AgentServices): Promise<void> {
    const actionData = actionEntity.action_data;
    if (!actionData) {
      throw new Error("Action data not found");
    }

    const keys = actionData.kwargs.keys;
    if (!keys || typeof keys !== "string") {
      throw new Error("Missing or invalid keys for send keys on element action");
    }

    const locator = getLocator(page, actionEntity);
    const timeout = getActionTimeoutMs(agentServices, actionEntity.action_data?.kwargs?.timeout_ms);
    if (locator) {
      await locator.press(keys, { timeout });
      await page.waitForTimeout(500);
    } else {
      throw new Error("No locator found for send keys on element action");
    }
  }

  transpile(actionEntity: ActionEntity): string[] {
    const locatorExpr = getPageLocatorExpression(actionEntity);
    if (!locatorExpr) {
      const keys = actionEntity.action_data?.kwargs?.keys || '';
      return [
        `await agent.execAction("send_keys_on_element", page, {`,
        `  action_data: { kwargs: { keys: ${JSON.stringify(keys)} } },`,
        `});`
      ];
    }
    const keys = actionEntity.action_data?.kwargs?.keys || '';
    const timeout = getActionTimeoutMs();
    return [`await ${locatorExpr}.press(${JSON.stringify(keys)}, { timeout: ${timeout} });`];
  }
}
