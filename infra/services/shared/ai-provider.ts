/**
 * Shared AI provider abstraction.
 *
 * TradeWizard's AI workflow runs on Amazon Bedrock by default. Setting
 * AI_PROVIDER=nebius routes every model call through Nebius Token Factory's
 * OpenAI-compatible API instead. Prompts, tools, and workflow stages are
 * unchanged because both providers are exposed to Strands as a `Model`.
 *
 * Scope: this only covers model inference. Trade execution (Polymarket CLOB
 * orders, risk enforcement) remains deterministic application code.
 *
 * Environment variables:
 * - AI_PROVIDER: "bedrock" (default) or "nebius"
 * - NEBIUS_API_KEY_SECRET_ARN: Secrets Manager ARN containing {"apiKey": "..."}
 * - NEBIUS_API_KEY: local-development fallback key
 * - NEBIUS_BASE_URL: OpenAI-compatible base URL
 * - NEBIUS_MAX_TOKENS: default max tokens for Nebius models
 * - NEBIUS_MODEL_<CAPABILITY>: model ID per capability
 * - NEBIUS_MODEL_<CAPABILITY>_MAX_TOKENS: optional per-capability override
 */

import { BedrockModel, type Model } from '@strands-agents/sdk';
import { OpenAIModel } from '@strands-agents/sdk/models/openai';
import {
  SecretsManagerClient,
  GetSecretValueCommand,
} from '@aws-sdk/client-secrets-manager';

export type AiProvider = 'bedrock' | 'nebius';

/**
 * Capability buckets rather than provider-specific names. This keeps the
 * agent→model assignments stable when the provider changes.
 */
export type ModelCapability =
  | 'fast'
  | 'analytical'
  | 'agentic'
  | 'reasoning'
  | 'deep_reasoning'
  | 'non_tool'
  | 'default';

export interface ProviderModelSpec {
  provider: AiProvider;
  modelId: string;
  maxTokens: number;
  /** Bedrock region. Ignored for Nebius. */
  region?: string;
}

const DEFAULT_NEBIUS_BASE_URL = 'https://api.tokenfactory.nebius.com/v1/';
const NEBIUS_KEY_CACHE_MS = 5 * 60 * 1000;

/** Capability → env var holding the Nebius model ID. */
export const NEBIUS_MODEL_ENV: Record<ModelCapability, string> = {
  fast: 'NEBIUS_MODEL_FAST',
  analytical: 'NEBIUS_MODEL_ANALYTICAL',
  agentic: 'NEBIUS_MODEL_AGENTIC',
  reasoning: 'NEBIUS_MODEL_REASONING',
  deep_reasoning: 'NEBIUS_MODEL_DEEP_REASONING',
  non_tool: 'NEBIUS_MODEL_NON_TOOL',
  default: 'NEBIUS_MODEL_DEFAULT',
};

/**
 * Logical registry keys used by the analysis pipeline → capability bucket.
 * `non_tool` is reserved for stages that don't need function calling.
 */
export const LOGICAL_KEY_CAPABILITY: Record<string, ModelCapability> = {
  nova_micro: 'fast',
  nova_lite: 'analytical',
  nemotron: 'agentic',
  gpt_oss: 'reasoning',
  kimi_k2: 'deep_reasoning',
  llama_3_3: 'non_tool',
  nova_2_lite: 'reasoning',
};

const secretsClient = new SecretsManagerClient({});

let cachedNebiusKey: string | null = null;
let cachedNebiusKeyFor: string | null = null;
let cachedNebiusKeyAt = 0;

// ─── Provider Selection ─────────────────────────────────────────────────────────

/** Resolve the active AI provider. Defaults to Bedrock. */
export function resolveAiProvider(): AiProvider {
  const raw = (process.env.AI_PROVIDER || 'bedrock').trim().toLowerCase();

  if (raw === 'bedrock' || raw === 'nebius') {
    return raw;
  }

  throw new Error(
    `Unsupported AI_PROVIDER "${raw}". Expected "bedrock" or "nebius".`
  );
}

// ─── Capability Mapping ─────────────────────────────────────────────────────────

export function capabilityForLogicalKey(logicalKey: string): ModelCapability {
  const capability = LOGICAL_KEY_CAPABILITY[logicalKey];
  if (!capability) {
    throw new Error(
      `Unknown model logical key "${logicalKey}". Valid keys: ${Object.keys(LOGICAL_KEY_CAPABILITY).join(', ')}`
    );
  }
  return capability;
}

/** Whether a capability is guaranteed to need function/tool calling. */
export function capabilitySupportsTools(capability: ModelCapability): boolean {
  return capability !== 'non_tool';
}

export function getNebiusBaseUrl(): string {
  return process.env.NEBIUS_BASE_URL || DEFAULT_NEBIUS_BASE_URL;
}

export function getNebiusModelId(capability: ModelCapability): string {
  const envName = NEBIUS_MODEL_ENV[capability];
  const modelId = (process.env[envName] || '').trim();

  if (!modelId) {
    throw new Error(
      `Nebius model for capability "${capability}" is not configured. Set ${envName}.`
    );
  }

  return modelId;
}

export function getNebiusMaxTokens(
  capability: ModelCapability,
  fallback: number
): number {
  const specific = process.env[`NEBIUS_MODEL_${capability.toUpperCase()}_MAX_TOKENS`];
  const shared = process.env.NEBIUS_MAX_TOKENS;
  const parsed = parseInt(specific || shared || String(fallback), 10);

  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

/**
 * Fail fast when AI_PROVIDER=nebius but required model IDs are missing.
 * Callers pass the capabilities their Lambda actually needs.
 */
export function validateAiProviderConfiguration(
  requiredCapabilities: ModelCapability[]
): void {
  if (resolveAiProvider() !== 'nebius') return;

  const missing = requiredCapabilities.filter(
    (capability) => !(process.env[NEBIUS_MODEL_ENV[capability]] || '').trim()
  );

  if (missing.length > 0) {
    const envNames = missing.map((capability) => NEBIUS_MODEL_ENV[capability]);
    throw new Error(
      `AI_PROVIDER=nebius is missing required model configuration: ${envNames.join(', ')}`
    );
  }
}

// ─── Nebius API Key ─────────────────────────────────────────────────────────────

/**
 * Resolve the Nebius API key from Secrets Manager (preferred) or env fallback.
 * Only the JSON `apiKey` field is accepted from the secret, so the random
 * placeholder CDK generates for an unpopulated secret is ignored.
 */
export async function getNebiusApiKey(): Promise<string> {
  const secretArn = process.env.NEBIUS_API_KEY_SECRET_ARN;
  const cacheKey = secretArn || '__env__';
  const now = Date.now();

  if (
    cachedNebiusKey &&
    cachedNebiusKeyFor === cacheKey &&
    now - cachedNebiusKeyAt < NEBIUS_KEY_CACHE_MS
  ) {
    return cachedNebiusKey;
  }

  let apiKey = '';

  if (secretArn) {
    try {
      const response = await secretsClient.send(
        new GetSecretValueCommand({ SecretId: secretArn })
      );
      apiKey = extractNebiusApiKey(response.SecretString);
    } catch (error) {
      console.warn(
        `Failed to read Nebius API key from ${secretArn}; falling back to NEBIUS_API_KEY.`,
        error
      );
    }
  }

  if (!apiKey) {
    apiKey = (process.env.NEBIUS_API_KEY || '').trim();
  }

  if (!apiKey) {
    throw new Error(
      'Nebius API key is not configured. Populate the Nebius secret or set NEBIUS_API_KEY.'
    );
  }

  cachedNebiusKey = apiKey;
  cachedNebiusKeyFor = cacheKey;
  cachedNebiusKeyAt = now;

  return apiKey;
}

/**
 * Fail fast if the selected provider's credentials are unavailable.
 * No-op for Bedrock (credentials come from the Lambda execution role).
 */
export async function assertAiProviderCredentials(): Promise<void> {
  if (resolveAiProvider() === 'nebius') {
    await getNebiusApiKey();
  }
}

function extractNebiusApiKey(secretString?: string): string {
  const trimmed = (secretString || '').trim();
  if (!trimmed || !trimmed.startsWith('{')) return '';

  try {
    const parsed = JSON.parse(trimmed) as {
      apiKey?: string;
      api_key?: string;
    };
    return (parsed.apiKey || parsed.api_key || '').trim();
  } catch {
    return '';
  }
}

// ─── Model Construction ─────────────────────────────────────────────────────────

/**
 * Construct a Strands model for the active provider.
 *
 * Nebius uses the Chat Completions API (`api: 'chat'`) because that is the
 * OpenAI-compatible surface Token Factory exposes; the Strands default is the
 * Responses API.
 */
export function createProviderModel(spec: ProviderModelSpec): Model {
  if (spec.provider === 'bedrock') {
    return new BedrockModel({
      modelId: spec.modelId,
      region: spec.region || process.env.AWS_REGION || 'us-east-1',
      maxTokens: spec.maxTokens,
    });
  }

  return new OpenAIModel({
    api: 'chat',
    modelId: spec.modelId,
    maxTokens: spec.maxTokens,
    apiKey: async () => getNebiusApiKey(),
    clientConfig: {
      baseURL: getNebiusBaseUrl(),
    },
  });
}

/** Model spec used by the portfolio Lambda (single dependency model). */
export function getDefaultPortfolioModelSpec(): ProviderModelSpec {
  const provider = resolveAiProvider();
  const bedrockMaxTokens = parseInt(process.env.BEDROCK_MAX_TOKENS || '5120', 10);

  if (provider === 'nebius') {
    return {
      provider,
      modelId: getNebiusModelId('default'),
      maxTokens: getNebiusMaxTokens('default', bedrockMaxTokens),
    };
  }

  return {
    provider,
    modelId: process.env.BEDROCK_MODEL_ID || 'global.amazon.nova-2-lite-v1:0',
    region: process.env.AWS_REGION || 'us-east-1',
    maxTokens: bedrockMaxTokens,
  };
}

/** Test helper: clears the per-container Nebius key cache. */
export function resetAiProviderCachesForTests(): void {
  cachedNebiusKey = null;
  cachedNebiusKeyFor = null;
  cachedNebiusKeyAt = 0;
}
