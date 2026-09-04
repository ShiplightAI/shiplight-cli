/**
 * upload_file action - Upload files to a file input element
 */

import { Page } from 'playwright';
import { z } from 'zod';
import type { AgentServices } from '../../agent/agentServices';
import { uploadWithLocator } from '../../agent/agentFile';
import { ToolRegistry } from '../../llm_tools/registry';
import { getActionEntityLocatorInfo, getDomElementByIndex } from '../../llm_tools/utils';
import { ActionEntity, IAction } from '../types';
import { getActionTimeoutMs, getLocator } from '../utils';

// ============================================================================
// Action Implementation
// ============================================================================

export class UploadFileAction implements IAction {
  async execute(
    page: Page,
    actionEntity: ActionEntity,
    agentServices: AgentServices
  ): Promise<void> {
    const actionData = actionEntity.action_data;
    if (!actionData) {
      throw new Error('Action data not found');
    }

    // Support both kwargs.path and kwargs.paths, each can be either a string or an array
    let filePaths: string[] = [];

    if (actionData.kwargs.paths) {
      filePaths = Array.isArray(actionData.kwargs.paths)
        ? actionData.kwargs.paths
        : [actionData.kwargs.paths];
    } else if (actionData.kwargs.path) {
      filePaths = Array.isArray(actionData.kwargs.path)
        ? actionData.kwargs.path
        : [actionData.kwargs.path];
    }

    if (filePaths.length === 0) {
      throw new Error('No file paths provided for upload_file action');
    }

    // Download test data files on demand before using them
    await agentServices.downloadTestDataFiles(filePaths);

    // Convert to absolute paths using agent
    const absolutePaths = filePaths.map(p => agentServices.getTestDataFilePath(p));

    const locator = getLocator(page, actionEntity);
    if (!locator) {
      throw new Error('Missing locator for upload_file action');
    }

    const useFileInput = actionData.kwargs.use_file_input || false;
    const mockShowOpenFilePicker = agentServices.getActionSettings().mock_show_open_file_picker ?? false;

    // Use shared upload implementation from agentFile
    await uploadWithLocator(page, locator, absolutePaths, {
      useFileInput,
      timeout: getActionTimeoutMs(agentServices, actionEntity.action_data?.kwargs?.timeout_ms),
      mockShowOpenFilePicker,
    });
  }

  transpile(actionEntity: ActionEntity): string[] {
    const kwargs = actionEntity.action_data?.kwargs || {};
    const parts: string[] = [];

    // Build kwargs with paths and use_file_input
    const kwargsObj: Record<string, any> = {};
    if (kwargs.paths) kwargsObj.paths = kwargs.paths;
    else if (kwargs.path) kwargsObj.path = kwargs.path;
    if (kwargs.use_file_input) kwargsObj.use_file_input = true;

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
      `await agent.execAction("upload_file", page, {`,
      ...parts.map(p => `  ${p},`),
      `});`
    ];
  }
}

// ============================================================================
// Helper Functions
// ============================================================================

async function createUploadFileActionEntity(
  domElement: any,
  page: Page,
  kwargs: any = {},
  description?: string
): Promise<ActionEntity> {
  const locatorInfo = await getActionEntityLocatorInfo(page, domElement);

  return {
    ...locatorInfo,
    action_description: description || `Upload file to element`,
    action_data: {
      action_name: 'upload_file',
      kwargs: { ...kwargs },
    },
  };
}

function createErrorActionEntity(
  description: string,
  kwargs: any
): ActionEntity {
  return {
    action_description: `${description} (failed - element not found)`,
    action_data: {
      action_name: 'upload_file',
      kwargs,
    },
    feedback: 'Element not found in DOM',
  };
}

// ============================================================================
// LLM Tool Schema & Registration
// ============================================================================

export const UploadFileToolSchema = z.object({
  element_index: z.number().int().describe('Index of the target element to trigger the file upload dialog'),
  paths: z
    .union([z.string(), z.array(z.string())])
    .describe('Path to a file, relative to the test project root (e.g. "fixtures/data.csv"), or an array of such paths.'),
  timeout_ms: z.number().optional().describe('Per-action timeout in ms. Overrides the default 5s action timeout. Set this only when the instruction states a timeout; otherwise leave it unset so the configured default applies.'),
});

export function registerUploadFileTool(registry: ToolRegistry, action: IAction) {
  registry.register({
    name: 'upload_file',
    description: 'Click on target element (usually contains hints like "Upload file" or "Choose file" etc.) to trigger the file upload dialog, and choose the files to upload',
    schema: UploadFileToolSchema,
    usesElementIndex: true,

    async execute(args, ctx) {
      const { element_index, paths } = args;
      const { page, agentServices, actionDescription } = ctx as any;

      try {
        const domElement = await getDomElementByIndex(ctx, element_index);

        if (!domElement) {
          return {
            success: false,
            error: `File input element with index ${element_index} not found`,
            actionEntity: createErrorActionEntity(
              actionDescription || `Upload file to element ${element_index}`,
              { index: element_index, paths }
            ),
          };
        }

        const actionEntity = await createUploadFileActionEntity(
          domElement,
          page,
          { paths },
          actionDescription
        );

        await action.execute(page, actionEntity, agentServices);

        return {
          success: true,
          actionEntity,
          message: `Uploaded file to element ${element_index}`,
        };
      } catch (error) {
        return {
          success: false,
          error: (error as Error).message,
          actionEntity: createErrorActionEntity(
            actionDescription || `Upload file to element ${element_index}`,
            { index: element_index, paths }
          ),
        };
      }
    },
  });
}

export const UploadFileToFileInputToolSchema = z.object({
  element_index: z.number().int().describe('Index of the file input element'),
  paths: z
    .union([z.string(), z.array(z.string())])
    .describe('Path to a file, relative to the test project root (e.g. "fixtures/data.csv"), or an array of such paths.'),
  timeout_ms: z.number().optional().describe('Per-action timeout in ms. Overrides the default 5s action timeout. Set this only when the instruction states a timeout; otherwise leave it unset so the configured default applies.'),
});

export function registerUploadFileToFileInputTool(registry: ToolRegistry, action: IAction) {
  registry.register({
    name: 'upload_file_to_file_input',
    description: 'Upload a file to a file input element. The file path is relative to the test project root.',
    schema: UploadFileToFileInputToolSchema,
    usesElementIndex: true,

    async execute(args, ctx) {
      const { element_index, paths } = args;
      const { page, agentServices, actionDescription } = ctx as any;

      try {
        const domElement = await getDomElementByIndex(ctx, element_index);

        if (!domElement) {
          return {
            success: false,
            error: `File input element with index ${element_index} not found`,
            actionEntity: createErrorActionEntity(
              actionDescription || `Upload file to element ${element_index}`,
              { index: element_index, paths }
            ),
          };
        }

        const actionEntity = await createUploadFileActionEntity(
          domElement,
          page,
          { paths, use_file_input: true },
          actionDescription
        );

        await action.execute(page, actionEntity, agentServices);

        return {
          success: true,
          actionEntity,
          message: `Uploaded file to element ${element_index}`,
        };
      } catch (error) {
        return {
          success: false,
          error: (error as Error).message,
          actionEntity: createErrorActionEntity(
            actionDescription || `Upload file to element ${element_index}`,
            { index: element_index, paths }
          ),
        };
      }
    },
  });
}
