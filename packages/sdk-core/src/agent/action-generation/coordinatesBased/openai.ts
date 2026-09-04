/**
 * OpenAI Computer Use API provider for coordinates-based action generation.
 *
 * Targets the GA `computer` tool with `gpt-5.4`. The legacy `computer-use-preview`
 * / `computer_use_preview` tool is deprecated and no longer supported here.
 */

import OpenAI from "openai";
import { ElementHandle, Page } from "playwright";
import { ActionDataEntity } from "../../../actions/types";
import { getSdkConfig } from "../../../config";
import { agentLogger } from "../../../utils/agentLogger";
import { GeneratedAction } from "../../core/types";
import {
  buildActionEntity,
  convertToElementAnchoredCoordinates,
  CuaContext,
  getElementLocatorInfo,
  MappedAction,
  prepareScreenshot,
} from "./shared";
import { normalizeOpenAIAction } from "./openaiActionShape";

// ---------------------------------------------------------------------------
// Minimal local types for the GA computer tool shape.
//
// The installed `openai` SDK version (6.25.0) still models the preview shape
// (singular `action` field, no batched `actions[]`). We talk to the GA API
// directly through a typed cast on `responses.create`, so we define the fields
// we actually read here instead of pulling in the SDK types.
// ---------------------------------------------------------------------------

interface OpenAIComputerAction {
  type?: string;
  x?: number;
  y?: number;
  button?: string;
  path?: unknown;
}

interface OpenAIComputerCallItem {
  type: 'computer_call';
  call_id: string;
  actions?: OpenAIComputerAction[];
}

interface OpenAIOutputItem {
  type: string;
}

interface OpenAIResponse {
  id: string;
  output: OpenAIOutputItem[];
  output_text?: string;
}

// ---------------------------------------------------------------------------
// Action mapper
// ---------------------------------------------------------------------------

async function mapOpenAIAction(
  page: Page,
  rawAction: unknown,
): Promise<MappedAction> {
  const action = normalizeOpenAIAction(rawAction);
  let action_data: ActionDataEntity | null = null;
  let element: ElementHandle | null = null;

  switch (action.type) {
    case "click": {
      if (action.x === undefined || action.y === undefined) break;
      const action_name = action.button === "right" ? "right_click_by_coordinates" : "click_by_coordinates";
      const coords = await convertToElementAnchoredCoordinates(page, action.x, action.y);
      action_data = { action_name, kwargs: { relative_x: coords.relative_x, relative_y: coords.relative_y } };
      element = coords.element;
      break;
    }

    case "double_click": {
      if (action.x === undefined || action.y === undefined) break;
      const coords = await convertToElementAnchoredCoordinates(page, action.x, action.y);
      action_data = { action_name: "double_click_by_coordinates", kwargs: { relative_x: coords.relative_x, relative_y: coords.relative_y } };
      element = coords.element;
      break;
    }

    case "drag": {
      if (!action.path || action.path.length < 2) break;
      // TODO: honor interior waypoints. GA often returns multi-point paths
      // tracing a curve; we currently flatten to a straight line because the
      // drag_drop action entity schema (shared with YAML replay) only
      // supports element-anchored start + delta. Supporting full paths
      // requires extending drag_drop's kwargs.
      const start = action.path[0];
      const end = action.path[action.path.length - 1];
      const coords = await convertToElementAnchoredCoordinates(page, start.x, start.y);
      action_data = {
        action_name: "drag_drop",
        kwargs: {
          relative_x: coords.relative_x,
          relative_y: coords.relative_y,
          delta_x: end.x - start.x,
          delta_y: end.y - start.y,
        },
      };
      element = coords.element;
      break;
    }
  }

  return { action_data, locatorInfo: await getElementLocatorInfo(page, element) };
}

// ---------------------------------------------------------------------------
// Provider
// ---------------------------------------------------------------------------

const DEFAULT_OPENAI_MODEL = "gpt-5.4";
const OPENAI_TOOL = { type: "computer" } as const;
/**
 * Maximum number of screenshot-followup turns after the initial request.
 * Total API calls per generateAction = 1 initial + up to this many followups.
 * Each followup happens when the model returns a `screenshot` action asking
 * to see the current page before committing to a real action.
 */
const MAX_SCREENSHOT_FOLLOWUPS = 4;

type ResponsesCreate = (req: Record<string, unknown>) => Promise<OpenAIResponse>;

export async function runOpenAICua(ctx: CuaContext): Promise<GeneratedAction> {
  const { statement, page, viewportWidth, viewportHeight, modelId } = ctx;
  // Honor ctx.modelId so COMPUTER_USE_MODEL=<explicit-gpt-model> overrides
  // the default; mirror gemini.ts which does the same.
  const model = modelId || DEFAULT_OPENAI_MODEL;
  // Re-capture the initial screenshot locally so the multi-turn followup
  // loop always uses a fresh snapshot from the current page state. The
  // caller passes `ctx.screenshotB64` too, but that value can be slightly
  // stale by the time the model asks for it on a followup turn.
  let screenshotB64 = await prepareScreenshot(page, viewportWidth, viewportHeight);

  const sdkConfig = getSdkConfig();
  const apiKey = sdkConfig.env?.OPENAI_API_KEY;
  if (!apiKey) {
    return {
      status: "error",
      error: "OPENAI_API_KEY not found in SDK env config.",
    };
  }

  // Honor OPENAI_BASE_URL for self-hosted / proxy endpoints, matching the
  // behaviour of the regular LLM provider at agent/llm/openai.ts.
  const baseURL = sdkConfig.env?.OPENAI_BASE_URL;
  const client = new OpenAI({ apiKey, ...(baseURL && { baseURL }) });
  // Bind explicitly — extracting `client.responses.create` loses its `this`
  // binding and the underlying OpenAI SDK method reaches into `this._client`.
  // Cast through unknown afterwards to avoid the SDK's preview-era types
  // leaking into the GA request/response shape we actually use.
  const responsesCreate = client.responses.create.bind(client.responses) as unknown as ResponsesCreate;

  agentLogger.log(`Sending request to OpenAI CUA (model=${model})...`);

  const baseInput: unknown[] = [{
    role: "user",
    content: [
      { type: "input_text", text: statement },
      { type: "input_image", detail: "original", image_url: `data:image/png;base64,${screenshotB64}` },
    ],
  }];

  async function sendRequest(
    input: unknown[],
    previousResponseId: string | undefined,
  ): Promise<OpenAIResponse> {
    const req: Record<string, unknown> = {
      model,
      tools: [OPENAI_TOOL],
      input,
      temperature: 0.1,
    };
    if (previousResponseId) req.previous_response_id = previousResponseId;
    return responsesCreate(req);
  }

  // GA often returns a screenshot-request first; we reply with the current
  // screenshot as computer_call_output and continue until the model returns
  // an actionable computer_call, or we hit the safety cap.
  let response = await sendRequest(baseInput, undefined);
  let firstAction: OpenAIComputerAction | undefined;

  for (let turn = 0; turn < MAX_SCREENSHOT_FOLLOWUPS; turn++) {
    agentLogger.log(`Received response from OpenAI CUA (turn ${turn + 1})`);
    const computerCall = response.output.find(
      (item): item is OpenAIOutputItem & { type: 'computer_call' } =>
        item.type === 'computer_call',
    ) as OpenAIComputerCallItem | undefined;
    if (!computerCall) {
      return {
        status: "error",
        reasoning: response.output_text || "Invalid action generation response",
        error: "No computer_call in OpenAI response",
      };
    }

    // GA returns batched `actions[]`. We take the first actionable one per
    // turn because `GeneratedAction` represents one action per call.
    // TODO: support full batch execution so the model's intended gesture
    // sequence (e.g. move → down → drag → up) runs atomically. In the worst
    // case (mousedown without a matching mouseup) we'd leave the page in a
    // stuck drag state.
    const actions = computerCall.actions ?? [];
    if (actions.length > 1) {
      agentLogger.log(
        `[openai CUA] dropping ${actions.length - 1} batched action(s); only the first is executed`,
      );
    }
    firstAction = actions[0];
    if (!firstAction) {
      return {
        status: "error",
        error: "OpenAI CUA returned a computer_call with no actions",
      };
    }
    if (firstAction.type !== "screenshot") break;

    // Screenshot request: re-capture the page and send it back as
    // computer_call_output. output.type MUST be "computer_screenshot" for
    // the model to accept it as the tool's screenshot reply and continue
    // the loop.
    screenshotB64 = await prepareScreenshot(page, viewportWidth, viewportHeight);
    const followupInput: unknown[] = [{
      type: "computer_call_output",
      call_id: computerCall.call_id,
      output: {
        type: "computer_screenshot",
        image_url: `data:image/png;base64,${screenshotB64}`,
        detail: "original",
      },
    }];
    response = await sendRequest(followupInput, response.id);
  }

  if (!firstAction) {
    // Unreachable — the empty-actions guard inside the loop returns early.
    // Belt-and-suspenders for type narrowing.
    return { status: "error", error: "OpenAI CUA loop ended without an action" };
  }
  if (firstAction.type === "screenshot") {
    return {
      status: "error",
      error: `OpenAI CUA kept requesting screenshots after ${MAX_SCREENSHOT_FOLLOWUPS} turns`,
    };
  }
  agentLogger.log(`Generated action: ${JSON.stringify(firstAction)}`);

  const { action_data, locatorInfo } = await mapOpenAIAction(page, firstAction);
  if (!action_data) {
    return {
      status: "error",
      error: `Failed to map OpenAI action: ${JSON.stringify(firstAction)}`,
    };
  }

  return {
    status: "success",
    actionEntity: buildActionEntity(statement, action_data, locatorInfo),
    reasoning: "Action generated successfully using OpenAI computer use",
    goalAccomplished: true,
  };
}
