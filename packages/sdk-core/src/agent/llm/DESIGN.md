# LLM Provider Configuration Design

## Overview

Shiplight supports multiple LLM providers for AI-powered test execution (DRAFT statements, VERIFY assertions, IF/ELSE conditions). This document describes the model resolution and provider routing design.

**Scope:** This configuration applies to YAML test execution (`shiplight test`, `shiplight debug`) and the public SDK (`@shiplightai/sdk`). The MCP server does not use LLM — all browser actions are deterministic.

## Model Resolution

Model resolution follows a priority chain:

```
1. WEB_AGENT_MODEL env var (explicit)
2. Auto-detect from available API keys
3. Error: no model available
```

### Provider prefix convention (LiteLLM-style)

The model string supports an optional `provider:model` prefix to explicitly route to a provider:

```
[provider:]model_id
```

Examples:

```bash
# No prefix — auto-detect provider from model name
WEB_AGENT_MODEL=claude-sonnet-4-6         # → anthropic
WEB_AGENT_MODEL=gemini-2.5-pro            # → google
WEB_AGENT_MODEL=gpt-4o                    # → openai
WEB_AGENT_MODEL=openrouter:openai/gpt-4o  # → OpenRouter
WEB_AGENT_MODEL=o3-mini                   # → openai

# Explicit provider prefix — override auto-detection
WEB_AGENT_MODEL=vertex:claude-sonnet-4-6  # → Vertex AI (Anthropic model)
WEB_AGENT_MODEL=vertex:gemini-2.5-pro     # → Vertex AI (Google model)
WEB_AGENT_MODEL=azure:gpt-4o             # → Azure OpenAI
WEB_AGENT_MODEL=bedrock:anthropic.claude-sonnet-4-6-v1  # → AWS Bedrock
WEB_AGENT_MODEL=openai:ft:gpt-4o:my-org  # → explicit OpenAI (fine-tuned)
```

### Auto-detection from model name prefix

When no `provider:` prefix is given, the provider is inferred from the model name:

| Model prefix | Provider |
|-------------|----------|
| `claude-*` | Anthropic |
| `gemini-*` | Google AI |
| `gpt-*`, `o1*`, `o3*`, `o4*`, `chatgpt-*` | OpenAI |

### Auto-detection from API keys

When `WEB_AGENT_MODEL` is not set, the first available API key determines the model:

| API key | Default model |
|---------|--------------|
| `ANTHROPIC_API_KEY` | `claude-haiku-4-5` |
| `GOOGLE_API_KEY` | `gemini-3.5-flash` |
| `OPENAI_API_KEY` | `gpt-5.4-mini` |

Priority follows the order above. If multiple keys are set, the first match wins.

OpenRouter is not auto-selected from its key because its catalog spans providers;
set an explicit `openrouter:<provider>/<model>` model.

## Providers

### Anthropic (default)

```bash
ANTHROPIC_API_KEY=sk-ant-...
WEB_AGENT_MODEL=claude-sonnet-4-6   # optional, defaults to claude-haiku-4-5
```

### Google AI (default)

```bash
GOOGLE_API_KEY=AIza...
WEB_AGENT_MODEL=gemini-2.5-pro      # optional, defaults to gemini-3.5-flash
```

### OpenAI

```bash
OPENAI_API_KEY=sk-...
WEB_AGENT_MODEL=gpt-4o              # optional, defaults to gpt-5.4-mini
```

#### OpenAI-compatible APIs

For local models (Ollama, vLLM) or proxies that expose an OpenAI-compatible API:

```bash
OPENAI_API_KEY=sk-...               # or any string for local servers
OPENAI_BASE_URL=http://localhost:11434/v1
WEB_AGENT_MODEL=openai:llama3       # prefix required for non-standard model names
```

### OpenRouter

```bash
OPENROUTER_API_KEY=sk-or-v1-...
WEB_AGENT_MODEL=openrouter:openai/gpt-4o
```

Coordinate-based computer use is not supported through OpenRouter; use it for
the element-based web agent.

### Google Vertex AI

Route Anthropic or Google models through Vertex AI:

```bash
GOOGLE_CLOUD_PROJECT=my-project
GOOGLE_CLOUD_LOCATION=us-central1
WEB_AGENT_MODEL=vertex:claude-sonnet-4-6    # Anthropic via Vertex
WEB_AGENT_MODEL=vertex:gemini-2.5-pro       # Google via Vertex
```

Authentication uses Application Default Credentials (ADC) or `GOOGLE_APPLICATION_CREDENTIALS`.

### Azure OpenAI

```bash
AZURE_OPENAI_API_KEY=...
AZURE_OPENAI_ENDPOINT=https://myorg.openai.azure.com
WEB_AGENT_MODEL=azure:gpt-4o
```

The model ID is the Azure deployment name.

### AWS Bedrock

```bash
AWS_REGION=us-east-1
AWS_ACCESS_KEY_ID=...
AWS_SECRET_ACCESS_KEY=...
WEB_AGENT_MODEL=bedrock:anthropic.claude-sonnet-4-6-v1
```

Authentication uses standard AWS credential chain (env vars, ~/.aws/credentials, IAM role).

Bedrock model IDs follow the `vendor.model-id` format (e.g., `anthropic.claude-sonnet-4-6-v1`, `meta.llama3-70b-instruct-v1`).

## Implementation

### parseModel()

```typescript
interface ParsedModel {
  provider: string | undefined;  // explicit provider, or undefined for auto-detect
  modelId: string;               // model ID to pass to the provider SDK
}

function parseModel(modelString: string): ParsedModel {
  const colonIndex = modelString.indexOf(':');
  if (colonIndex > 0) {
    return {
      provider: modelString.slice(0, colonIndex),
      modelId: modelString.slice(colonIndex + 1),
    };
  }
  return { provider: undefined, modelId: modelString };
}
```

### Provider registry

```typescript
// provider name → factory function
const PROVIDERS: Record<string, (modelId: string) => LanguageModelV3> = {
  anthropic: getAnthropicModel,
  google: getGoogleModel,
  openai: getOpenAIModel,
  vertex: getVertexModel,     // routes to Vertex Anthropic or Vertex Google
  azure: getAzureOpenAIModel,
  bedrock: getBedrockModel,
};

// model prefix → provider name (for auto-detection)
const MODEL_PREFIX_MAP: [string, string][] = [
  ['claude-', 'anthropic'],
  ['gemini-', 'google'],
  ['gpt-', 'openai'],
  ['o1', 'openai'],
  ['o3', 'openai'],
  ['o4', 'openai'],
  ['chatgpt-', 'openai'],
];
```

### File structure

```
packages/sdk-core/src/agent/llm/
├── DESIGN.md           # this document
├── index.ts            # getModel(), getProviderOptions(), parseModel()
├── anthropic.ts        # Anthropic direct API
├── google.ts           # Google AI direct API
├── openai.ts           # OpenAI direct API
├── openrouter.ts       # OpenRouter direct API
├── vertex.ts           # Vertex AI (Anthropic + Google models)
├── azure.ts            # Azure OpenAI
└── bedrock.ts          # AWS Bedrock
```

## Backward compatibility

The following legacy env vars are supported but deprecated:

| Legacy env var | Replacement |
|---------------|-------------|
| `ANTHROPIC_MODELS_USE_VERTEXAI=true` | `WEB_AGENT_MODEL=vertex:claude-*` |
| `GOOGLE_GENAI_USE_VERTEXAI=true` | `WEB_AGENT_MODEL=vertex:gemini-*` |

The legacy flags are checked as fallback when no `provider:` prefix is present on `claude-*` or `gemini-*` models.

## Environment variable summary

| Variable | Required | Description |
|----------|----------|-------------|
| `WEB_AGENT_MODEL` | No | Model override with optional `provider:` prefix |
| `WEB_AGENT_FALLBACK_MODELS` | No | Comma-separated `provider:model` chain tried on primary availability failure; defaults to a built-in chain, an explicit empty string disables fallback |
| `ANTHROPIC_API_KEY` | For Anthropic | Anthropic API key |
| `GOOGLE_API_KEY` | For Google AI | Google AI API key |
| `OPENAI_API_KEY` | For OpenAI | OpenAI API key |
| `OPENAI_BASE_URL` | No | Custom endpoint for OpenAI-compatible APIs |
| `OPENROUTER_API_KEY` | For OpenRouter | OpenRouter API key; requires `WEB_AGENT_MODEL=openrouter:<provider>/<model>` |
| `AZURE_OPENAI_API_KEY` | For Azure | Azure OpenAI API key |
| `AZURE_OPENAI_ENDPOINT` | For Azure | Azure OpenAI endpoint URL |
| `AWS_REGION` | For Bedrock | AWS region |
| `AWS_ACCESS_KEY_ID` | For Bedrock | AWS access key (or use IAM/credential chain) |
| `AWS_SECRET_ACCESS_KEY` | For Bedrock | AWS secret key (or use IAM/credential chain) |
| `GOOGLE_CLOUD_PROJECT` | For Vertex | GCP project ID |
| `GOOGLE_CLOUD_LOCATION` | For Vertex | GCP region |
| `GOOGLE_APPLICATION_CREDENTIALS` | For Vertex | Path to service account JSON (optional) |
