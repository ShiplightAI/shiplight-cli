/**
 * LLM Provider utilities
 *
 * Shared utilities for getting LLM model instances across mobile-sdk.
 * Following the same pattern as web-sdk's llmProvider.ts.
 */

import { createGoogleGenerativeAI } from '@ai-sdk/google';
import { createVertex } from '@ai-sdk/google-vertex';
import type { LanguageModel } from 'ai';
import { getMobileSdkConfig } from '../../config';

/**
 * Get Google AI model with support for:
 * 1. Vertex AI (via GOOGLE_GENAI_USE_VERTEXAI flag or GOOGLE_CLOUD_PROJECT)
 * 2. API key from SDK config
 * 3. Default Google AI SDK
 *
 * Environment variables (checked in SDK config first, then process.env):
 * - GOOGLE_GENAI_USE_VERTEXAI: Set to "True" or "true" to force Vertex AI
 * - GOOGLE_CLOUD_PROJECT: GCP project ID for Vertex AI
 * - GOOGLE_CLOUD_LOCATION: GCP region (default: global)
 * - GOOGLE_APPLICATION_CREDENTIALS: Path to service account JSON (read by google-auth-library)
 */
export function getGoogleModel(modelName: string): LanguageModel {
  const config = getMobileSdkConfig();
  const env = config.env || {};

  // Check for Vertex AI flag or project (SDK config takes precedence, then process.env)
  const useVertexAIFlag = env.GOOGLE_GENAI_USE_VERTEXAI || process.env.GOOGLE_GENAI_USE_VERTEXAI;
  const useVertexAI = useVertexAIFlag === 'True' || useVertexAIFlag === 'true';
  const vertexProject = env.GOOGLE_CLOUD_PROJECT || process.env.GOOGLE_CLOUD_PROJECT;
  // gemini-3-flash-preview is only in global location
  const vertexLocation =
    modelName === 'gemini-3-flash-preview'
      ? 'global'
      : env.GOOGLE_CLOUD_LOCATION || process.env.GOOGLE_CLOUD_LOCATION || 'global';

  if (useVertexAI || vertexProject) {
    if (!vertexProject) {
      throw new Error('GOOGLE_CLOUD_PROJECT is required when using Vertex AI');
    }
    console.log(`[LLM] Using Vertex AI provider: model=${modelName}, location=${vertexLocation}`);
    const vertexProvider = createVertex({
      project: vertexProject,
      location: vertexLocation,
    });
    return vertexProvider(modelName);
  }

  // Check for API key in config or process.env
  const apiKey = env.GOOGLE_API_KEY || process.env.GOOGLE_API_KEY;

  if (!apiKey) {
    throw new Error('Google API key is missing. Set GOOGLE_API_KEY in SDK config or environment.');
  }

  console.log(`[LLM] Using Google AI provider (API key): model=${modelName}`);
  const googleProvider = createGoogleGenerativeAI({ apiKey });
  return googleProvider(modelName);
}

/**
 * Get provider options for Gemini models
 * Note: Using MEDIUM resolution to support multiple images in conversation history
 * (Vertex AI only supports HIGH resolution for single images)
 */
export function getGoogleProviderOptions(modelName: string): { google: any } {
  if (modelName === 'gemini-3-flash-preview') {
    return {
      google: {
        thinkingLevel: 'MINIMAL',
        includeThoughts: true,
        mediaResolution: 'MEDIA_RESOLUTION_MEDIUM',
      },
    };
  }

  return {
    google: {
      thinkingConfig: {
        thinkingBudget: 512,
        includeThoughts: true,
      },
      mediaResolution: 'MEDIA_RESOLUTION_MEDIUM',
    },
  };
}
