/**
 * drag_drop action - Drag an element to another location
 */

import { Page } from 'playwright';
import { AgentServices } from '../../agent/agentServices';
import { ActionEntity, IAction } from '../types';
import { getActionTimeoutMs, getLocator } from '../utils';

// ============================================================================
// Action Implementation
// ============================================================================

export class DragDropAction implements IAction {
  async execute(page: Page, actionEntity: ActionEntity, agentServices: AgentServices): Promise<void> {
    const dragMoveSteps = agentServices.getActionSettings().drag_drop_steps ?? 10;
    const actionData = actionEntity.action_data;
    if (!actionData) {
      throw new Error('Action data not found');
    }

    const kwargs = actionData.kwargs;
    const sourceCoords = [kwargs.coord_source_x, kwargs.coord_source_y];
    const targetCoords = [kwargs.coord_target_x, kwargs.coord_target_y];

    // Support element-anchored coordinates with delta
    if (typeof kwargs.relative_x === 'number' && typeof kwargs.relative_y === 'number' &&
        typeof kwargs.delta_x === 'number' && typeof kwargs.delta_y === 'number') {
      const targetLocator = getLocator(page, actionEntity);
      if (!targetLocator) {
        throw new Error('No locator found for drag_drop action with element-anchored coordinates');
      }

      await targetLocator.waitFor({ state: 'attached', timeout: getActionTimeoutMs(agentServices, actionEntity.action_data?.kwargs?.timeout_ms) });
      const element = await targetLocator;
      const boundingBox = await element.boundingBox();
      if (!boundingBox) {
        throw new Error('Could not get bounding box for drag_drop element');
      }

      const startX = boundingBox.x + kwargs.relative_x + boundingBox.width / 2;
      const startY = boundingBox.y + kwargs.relative_y + boundingBox.height / 2;
      const endX = startX + kwargs.delta_x;
      const endY = startY + kwargs.delta_y;

      await page.mouse.move(startX, startY);
      await page.mouse.down();
      if (dragMoveSteps > 0) {
        await page.mouse.move(endX, endY, { steps: dragMoveSteps });
      } else {
        await page.mouse.move(endX, endY);
      }
      await page.mouse.up();
    }
    // Backward compatibility: support old absolute coordinates
    else if (sourceCoords.every(c => typeof c === 'number') && targetCoords.every(c => typeof c === 'number')) {
      const [sx, sy] = sourceCoords;
      const [tx, ty] = targetCoords;
      await page.mouse.move(sx, sy);
      await page.mouse.down();
      if (dragMoveSteps > 0) {
        await page.mouse.move(tx, ty, { steps: dragMoveSteps });
      } else {
        await page.mouse.move(tx, ty);
      }
      await page.mouse.up();
    } else {
      throw new Error('Missing coordinates for drag_drop action: requires either element-anchored coordinates with delta, or full absolute coordinates');
    }

    await page.waitForTimeout(500);
  }

  transpile(actionEntity: ActionEntity): string[] {
    const kwargs = actionEntity.action_data?.kwargs || {};
    const parts: string[] = [];

    // Build kwargs with only the coordinate fields needed
    const kwargsObj: Record<string, number> = {};
    if (typeof kwargs.relative_x === 'number') kwargsObj.relative_x = kwargs.relative_x;
    if (typeof kwargs.relative_y === 'number') kwargsObj.relative_y = kwargs.relative_y;
    if (typeof kwargs.delta_x === 'number') kwargsObj.delta_x = kwargs.delta_x;
    if (typeof kwargs.delta_y === 'number') kwargsObj.delta_y = kwargs.delta_y;
    if (typeof kwargs.coord_source_x === 'number') kwargsObj.coord_source_x = kwargs.coord_source_x;
    if (typeof kwargs.coord_source_y === 'number') kwargsObj.coord_source_y = kwargs.coord_source_y;
    if (typeof kwargs.coord_target_x === 'number') kwargsObj.coord_target_x = kwargs.coord_target_x;
    if (typeof kwargs.coord_target_y === 'number') kwargsObj.coord_target_y = kwargs.coord_target_y;

    parts.push(`action_data: { kwargs: ${JSON.stringify(kwargsObj)} }`);

    if (actionEntity.locator) {
      parts.push(`locator: ${JSON.stringify(actionEntity.locator)}`);
    } else if (actionEntity.xpath) {
      parts.push(`xpath: ${JSON.stringify(actionEntity.xpath)}`);
    }
    if (actionEntity.frame_path && actionEntity.frame_path.length > 0) {
      parts.push(`frame_path: ${JSON.stringify(actionEntity.frame_path)}`);
    }

    return [
      `await agent.execAction("drag_drop", page, {`,
      ...parts.map(p => `  ${p},`),
      `});`
    ];
  }
}

// ============================================================================
// LLM Tool Schema & Registration
// ============================================================================

// Note: Don't register drag drop tool as it can only be generated in pure vision mode. The agent should use `perform_accurate_operation` tool to generate drag drop action instead.
