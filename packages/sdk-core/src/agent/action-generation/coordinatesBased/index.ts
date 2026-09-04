/**
 * Coordinates-based (pure vision) action generation.
 *
 * Routes to the appropriate Computer Use API provider based on the active model:
 *   - gemini-*  → Google Gemini Computer Use
 *   - (default) → OpenAI Computer Use
 *
 * Adding a new provider:
 *   1. Create a new file (e.g. `anthropic.ts`) exporting `runAnthropicCua(ctx: CuaContext)`
 *   2. Import it here and add an entry to `PROVIDERS`.
 */

import { getSdkConfig } from "../../../config";
import { agentLogger } from "../../../utils/agentLogger";
import { parseModel } from "../../llm";
import { runWithModelFallback } from "../../task/modelFallback";
import { AgentOptions, GeneratedAction, TaskExecutionContext } from "../../core/types";
import { runGeminiCua } from "./gemini";
import { runOpenAICua } from "./openai";
import { CuaContext, prepareScreenshot } from "./shared";

// ---------------------------------------------------------------------------
// Provider registry
// ---------------------------------------------------------------------------

type CuaProvider = (ctx: CuaContext) => Promise<GeneratedAction>;

const PROVIDERS: Record<string, CuaProvider> = {
  google: runGeminiCua,
  openai: runOpenAICua,
};

function detectProvider(modelId: string): string {
  if (modelId.startsWith("gemini-")) return "google";
  return "openai";
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export async function generateAction(
  statement: string,
  context: TaskExecutionContext,
  _options: AgentOptions = {},
): Promise<GeneratedAction> {
  const { page } = context;

  const viewport = page.viewportSize();
  if (!viewport) {
    return { status: "error", error: "Viewport size not available" };
  }

  const { width: viewportWidth, height: viewportHeight } = viewport;
  agentLogger.log(`Viewport: ${viewportWidth}x${viewportHeight}`);

  const screenshotB64 = await prepareScreenshot(page, viewportWidth, viewportHeight);

  const modelString = context.agentServices.getComputerUseModel();
  if (!modelString) {
    return { status: "error", error: "No computer use model configured" };
  }

  // Computer-use model chain: primary + configured CUA fallbacks (deduped), tried
  // in order on an availability failure (429/5xx/timeout). Each candidate re-detects
  // its provider, so a fallback can cross providers (e.g. gemini CUA → openai CUA).
  // Without this a primary-CUA 429 fails the whole action (mirrors the web-agent
  // action-gen/assert fix for the vision path).
  const modelChain = [
    modelString,
    ...context.agentServices.getComputerUseFallbackModels().filter((m) => m !== modelString),
  ];

  try {
    return await runWithModelFallback(
      modelChain,
      (candidateModel) => {
        const { modelId } = parseModel(candidateModel);
        const providerKey = detectProvider(modelId);
        const provider = PROVIDERS[providerKey];
        agentLogger.log(`Using CUA provider: ${providerKey} (model: ${modelId})`);
        const ctx: CuaContext = { statement, page, screenshotB64, viewportWidth, viewportHeight, modelId };
        return provider(ctx);
      },
      (failedModel, nextModel) =>
        agentLogger.log(`CUA model ${failedModel} unavailable; falling back to ${nextModel}`),
    );
  } catch (error: any) {
    agentLogger.error(`CUA provider threw an error`, error);
    return { status: "error", error: error.message ?? "CUA provider failed" };
  }
}
