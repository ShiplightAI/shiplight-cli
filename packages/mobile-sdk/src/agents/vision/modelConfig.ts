/**
 * AI Model Configuration
 * Supports multiple AI providers for mobile automation
 */

import type { AIModelConfig } from './types';

export function getDefaultModelConfig(): AIModelConfig {
  // Allow provider selection via AI_PROVIDER env var (default: gemini)
  const provider = (process.env.AI_PROVIDER || 'gemini') as 'openai' | 'gemini' | 'anthropic';

  switch (provider) {
    case 'openai': {
      const apiKey = process.env.OPENAI_API_KEY || '';
      if (!apiKey) {
        throw new Error(
          'Missing OpenAI API key. Please set OPENAI_API_KEY environment variable.'
        );
      }
      return {
        provider: 'openai',
        model: process.env.OPENAI_MODEL || 'computer-use-preview',
        apiKey,
        temperature: parseFloat(process.env.AI_TEMPERATURE || '0.1'),
      };
    }

    case 'gemini': {
      const apiKey = process.env.GOOGLE_API_KEY || '';
      if (!apiKey) {
        throw new Error(
          'Missing Google API key. Please set GOOGLE_API_KEY environment variable.'
        );
      }
      return {
        provider: 'gemini',
        model: process.env.GEMINI_MODEL || 'gemini-2.5-computer-use-preview-10-2025',
        apiKey,
        temperature: parseFloat(process.env.AI_TEMPERATURE || '0.1'),
      };
    }

    case 'anthropic': {
      const apiKey = process.env.ANTHROPIC_API_KEY || '';
      if (!apiKey) {
        throw new Error(
          'Missing Anthropic API key. Please set ANTHROPIC_API_KEY environment variable.'
        );
      }
      return {
        provider: 'anthropic',
        model: process.env.ANTHROPIC_MODEL || 'claude-3-5-sonnet-20241022',
        apiKey,
        temperature: parseFloat(process.env.AI_TEMPERATURE || '0.1'),
      };
    }

    default:
      throw new Error(
        `Unsupported AI provider: ${provider}. Supported providers: openai, gemini, anthropic`
      );
  }
}
