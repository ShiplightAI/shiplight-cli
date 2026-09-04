/**
 * double_click_by_coordinates action - Double-click at specific coordinates
 */

import { Page } from 'playwright';
import type { AgentServices } from '../../agent/agentServices';
import { IAction, ActionEntity } from '../types';
import { getActionTimeoutMs, getLocator } from '../utils';

// ============================================================================
// Action Implementation
// ============================================================================

export class DoubleClickByCoordinatesAction implements IAction {
  async execute(page: Page, actionEntity: ActionEntity, agentServices: AgentServices): Promise<void> {
    const actionData = actionEntity.action_data;
    if (!actionData) {
      throw new Error('Action data not found');
    }

    if (typeof actionData.kwargs.relative_x === 'number' && typeof actionData.kwargs.relative_y === 'number') {
      const locator = getLocator(page, actionEntity);
      if (locator) {
        await locator.waitFor({ state: 'attached', timeout: getActionTimeoutMs(agentServices, actionEntity.action_data?.kwargs?.timeout_ms) });
        const box = await locator.boundingBox();
        if (box) {
          const x = box.x + actionData.kwargs.relative_x + box.width / 2;
          const y = box.y + actionData.kwargs.relative_y + box.height / 2;
          await page.mouse.dblclick(x, y, { delay: 50 });
          await page.waitForTimeout(200);
        }
      } else {
        throw new Error('Element-anchored coordinates provided but no locator found');
      }
    }
    else if (typeof actionData.kwargs.x === 'number' && typeof actionData.kwargs.y === 'number') {
      await page.mouse.dblclick(actionData.kwargs.x, actionData.kwargs.y);
      await page.waitForTimeout(200);
    } else {
      throw new Error('Missing or invalid coordinates');
    }
  }

  transpile(actionEntity: ActionEntity): string[] {
    const kwargs = actionEntity.action_data?.kwargs || {};
    const parts: string[] = [];

    if (typeof kwargs.relative_x === 'number' && typeof kwargs.relative_y === 'number') {
      parts.push(`action_data: { kwargs: { relative_x: ${kwargs.relative_x}, relative_y: ${kwargs.relative_y} } }`);
      if (actionEntity.locator) {
        parts.push(`locator: ${JSON.stringify(actionEntity.locator)}`);
      } else if (actionEntity.xpath) {
        parts.push(`xpath: ${JSON.stringify(actionEntity.xpath)}`);
      }
      if (actionEntity.frame_path && actionEntity.frame_path.length > 0) {
        parts.push(`frame_path: ${JSON.stringify(actionEntity.frame_path)}`);
      }
    } else if (typeof kwargs.x === 'number' && typeof kwargs.y === 'number') {
      parts.push(`action_data: { kwargs: { x: ${kwargs.x}, y: ${kwargs.y} } }`);
    }

    return [
      `await agent.execAction("double_click_by_coordinates", page, {`,
      ...parts.map(p => `  ${p},`),
      `});`
    ];
  }
}

// No LLM tool registration - coordinate-based actions are only used during test playback
