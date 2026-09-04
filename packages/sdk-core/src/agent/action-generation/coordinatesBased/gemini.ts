/**
 * Gemini Computer Use API provider for coordinates-based action generation.
 *
 * Defaults to `gemini-3-flash-preview` but honors `ctx.modelId` so that a
 * caller who sets `COMPUTER_USE_MODEL=gemini-*` (or passes an explicit
 * computer_use_model via org settings) gets the model they asked for.
 */

import { GoogleGenAI, Environment } from "@google/genai";
import { ElementHandle, Page } from "playwright";
import { ActionDataEntity } from "../../../actions/types";
import { getSdkConfig } from "../../../config";
import { agentLogger } from "../../../utils/agentLogger";
import { GeneratedAction } from "../../core/types";
import { isUsingVertexAI } from "../../llm";
import { getGoogleGenAIProxyBaseURL } from "../../llm/proxy";
import {
  buildActionEntity,
  convertToElementAnchoredCoordinates,
  CuaContext,
  getElementLocatorInfo,
  MappedAction,
} from "./shared";
import logger from "../../../utils/logger";

// ---------------------------------------------------------------------------
// Coordinate denormalization
// Gemini uses a 0-1000 normalized coordinate space.
// ---------------------------------------------------------------------------

function denormalize(value: number, dimension: number): number {
  return Math.round((value / 1000) * dimension);
}

// ---------------------------------------------------------------------------
// Custom function declarations
// right_click_at and double_click_at are not predefined by Gemini CUA, so we
// declare them as custom functions and include them alongside the computerUse tool.
// ---------------------------------------------------------------------------

const COORD_PARAM = {
  type: "object",
  properties: {
    x: { type: "integer", description: "X coordinate in the 0-1000 normalized space." },
    y: { type: "integer", description: "Y coordinate in the 0-1000 normalized space." },
  },
  required: ["x", "y"],
} as const;

const CUSTOM_FUNCTION_DECLARATIONS = [
  {
    name: "right_click_at",
    description: "Right-click at the given normalized coordinate.",
    parameters: COORD_PARAM,
  },
  {
    name: "double_click_at",
    description: "Double-click at the given normalized coordinate.",
    parameters: COORD_PARAM,
  },
];

// The CLI already owns the browser lifecycle, and the mapper below only
// implements click/drag actions. Do not let Gemini select predefined actions
// that this provider cannot execute.
const EXCLUDED_PREDEFINED_FUNCTIONS = [
  "open_web_browser",
  "wait_5_seconds",
  "search",
  "type_text_at",
  "scroll_document",
  "navigate",
  "go_back",
  "go_forward",
  "key_combination",
  "hover_at",
  "scroll_at",
];

// ---------------------------------------------------------------------------
// Action mapper
// ---------------------------------------------------------------------------

async function mapGeminiAction(
  page: Page,
  functionName: string,
  args: Record<string, any>,
  viewportWidth: number,
  viewportHeight: number,
): Promise<MappedAction> {
  let action_data: ActionDataEntity | null = null;
  let element: ElementHandle | null = null;
  try {
    switch (functionName) {
      case "click_at": {
        const x = denormalize(args["x"], viewportWidth);
        const y = denormalize(args["y"], viewportHeight);
        const coords = await convertToElementAnchoredCoordinates(page, x, y);
        action_data = { action_name: "click_by_coordinates", kwargs: { relative_x: coords.relative_x, relative_y: coords.relative_y } };
        element = coords.element;
        break;
      }

      case "right_click_at": {
        const x = denormalize(args["x"], viewportWidth);
        const y = denormalize(args["y"], viewportHeight);
        const coords = await convertToElementAnchoredCoordinates(page, x, y);
        action_data = { action_name: "right_click_by_coordinates", kwargs: { relative_x: coords.relative_x, relative_y: coords.relative_y } };
        element = coords.element;
        break;
      }

      case "double_click_at": {
        const x = denormalize(args["x"], viewportWidth);
        const y = denormalize(args["y"], viewportHeight);
        const coords = await convertToElementAnchoredCoordinates(page, x, y);
        action_data = { action_name: "double_click_by_coordinates", kwargs: { relative_x: coords.relative_x, relative_y: coords.relative_y } };
        element = coords.element;
        break;
      }

      case "drag_and_drop": {
        const x = denormalize(args["x"], viewportWidth);
        const y = denormalize(args["y"], viewportHeight);
        const destX = denormalize(args["destination_x"], viewportWidth);
        const destY = denormalize(args["destination_y"], viewportHeight);
        const coords = await convertToElementAnchoredCoordinates(page, x, y);
        action_data = {
          action_name: "drag_drop",
          kwargs: { relative_x: coords.relative_x, relative_y: coords.relative_y, delta_x: destX - x, delta_y: destY - y },
        };
        element = coords.element;
        break;
      }

      default:
        agentLogger.log(`Unsupported Gemini function: ${functionName}`);
    }
  } catch (err: any) {
    agentLogger.error(`Error mapping Gemini action "${functionName}"`, err);
  }

  return { action_data, locatorInfo: await getElementLocatorInfo(page, element) };
}

// ---------------------------------------------------------------------------
// Provider
// ---------------------------------------------------------------------------

const DEFAULT_GEMINI_MODEL = "gemini-3-flash-preview";

export async function runGeminiCua(ctx: CuaContext): Promise<GeneratedAction> {
  const { statement, page, screenshotB64, viewportWidth, viewportHeight, modelId } = ctx;
  const model = modelId || DEFAULT_GEMINI_MODEL;

  const sdkConfig = getSdkConfig();

  let clientOptions: Record<string, any>;
  if (isUsingVertexAI()) {
    const project = sdkConfig.env?.GOOGLE_CLOUD_PROJECT;
    if (!project) {
      return { status: "error", error: "GOOGLE_CLOUD_PROJECT is required when using Vertex AI." };
    }
    const location = sdkConfig.env?.GOOGLE_CLOUD_LOCATION ?? "global";
    clientOptions = { vertexai: true, project, location };
  } else {
    const apiKey = sdkConfig.env?.GOOGLE_API_KEY;
    if (apiKey) {
      logger.debug(`Using Google AI provider (API key): model=${model}`);
      clientOptions = { apiKey };
    } else {
      const shiplightToken = sdkConfig.env?.SHIPLIGHT_API_TOKEN;
      if (shiplightToken) {
        // @google/genai appends /v1beta internally, so the base URL must stop at /llm.
        // (getGoogleProxyBaseURL already includes /v1beta and is only correct for
        // the Vercel AI SDK's createGoogleGenerativeAI, which does NOT append it.)
        const baseUrl = getGoogleGenAIProxyBaseURL(shiplightToken, sdkConfig.env?.SHIPLIGHT_API_URL);
        logger.debug(`Using Shiplight LLM proxy (Google CUA): model=${model}, baseUrl=${baseUrl}`);
        clientOptions = { apiKey: shiplightToken, httpOptions: { baseUrl } };
      } else {
        return { status: "error", error: "Google API key is missing. Set GOOGLE_API_KEY in SDK config or environment." };
      }
    }
  }

  const client = new GoogleGenAI(clientOptions);

  agentLogger.log(`Sending request to Gemini CUA (model=${model})...`);

  // NOTE: computerUse config is not yet in the official @google/genai TS types
  const response = await client.models.generateContent({
    model,
    contents: [
      {
        role: "user",
        parts: [
          { text: `Execute this action: ${statement}` },
          { inlineData: { mimeType: "image/png", data: screenshotB64 } },
        ],
      },
    ],
    config: {
      tools: [
        {
          computerUse: {
            environment: Environment.ENVIRONMENT_BROWSER,
            excludedPredefinedFunctions: EXCLUDED_PREDEFINED_FUNCTIONS,
          },
        },
        { functionDeclarations: CUSTOM_FUNCTION_DECLARATIONS },
      ],
      temperature: 0.1,
    },
  } as any);

  agentLogger.log("Received response from Gemini CUA");

  const candidate = response.candidates?.[0];
  if (!candidate) {
    return { status: "error", error: "No candidates in Gemini response" };
  }

  const functionCallPart = candidate.content?.parts?.find((p: any) => p.functionCall);
  if (!functionCallPart) {
    const text = candidate.content?.parts?.filter((p: any) => p.text).map((p: any) => p.text).join(" ");
    return { status: "error", reasoning: text || "No action generated", error: "No function call in Gemini response" };
  }

  const { name: functionName, args: functionArgs } = functionCallPart.functionCall as { name: string; args: Record<string, any> };
  agentLogger.log(`Generated function call: ${functionName} with args ${JSON.stringify(functionArgs)}`);
  logger.debug(`Generated function call: ${functionName} with args ${JSON.stringify(functionArgs)}`);

  const { action_data, locatorInfo } = await mapGeminiAction(page, functionName, functionArgs, viewportWidth, viewportHeight);
  if (!action_data) {
    return { status: "error", error: `Unsupported or invalid Gemini action: ${functionName}` };
  }

  return {
    status: "success",
    actionEntity: buildActionEntity(statement, action_data, locatorInfo),
    reasoning: "Action generated successfully using Gemini computer use",
    goalAccomplished: true,
  };
}
