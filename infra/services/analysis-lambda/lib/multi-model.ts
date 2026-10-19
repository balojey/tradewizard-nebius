/**
 * Multi-Model Configuration for Analysis_Lambda
 *
 * Distributes agent workload across multiple models to enable parallel
 * execution without hitting per-model RPM limits. Agent→logical-key
 * assignments are provider-agnostic; the active provider (Bedrock or Nebius)
 * supplies the concrete model ID for each logical key.
 *
 * Environment Variables (Bedrock - default):
 * - MODEL_NOVA_MICRO, MODEL_NOVA_LITE, MODEL_KIMI_K2, MODEL_NEMOTRON,
 *   MODEL_GPT_OSS, MODEL_NOVA_2_LITE, MODEL_LLAMA_3_3
 * - AWS_REGION, BEDROCK_MAX_TOKENS
 *
 * Environment Variables (Nebius - AI_PROVIDER=nebius):
 * - NEBIUS_MODEL_FAST, NEBIUS_MODEL_ANALYTICAL, NEBIUS_MODEL_AGENTIC,
 *   NEBIUS_MODEL_REASONING, NEBIUS_MODEL_DEEP_REASONING,
 *   NEBIUS_MODEL_NON_TOOL, NEBIUS_MODEL_DEFAULT
 * - NEBIUS_MAX_TOKENS, NEBIUS_BASE_URL
 *
 * Tool calling: every intelligence agent and the web-research stage use
 * function calling. They must map to a capability other than `non_tool`.
 * `non_tool` is only used by the non-tool reasoning stages.
 */

import type { Model } from '@strands-agents/sdk';
import type { AgentName } from '../stages/intelligence-agents';
import {
  LOGICAL_KEY_CAPABILITY,
  capabilityForLogicalKey,
  capabilitySupportsTools,
  createProviderModel,
  getNebiusModelId,
  getNebiusMaxTokens,
  resolveAiProvider,
  type AiProvider,
  type ModelCapability,
} from '../../shared/ai-provider';

// ============================================================================
// Model Registry (env-driven)
// ============================================================================

export interface ModelConfig {
  modelId: string;
  region: string;
  maxTokens: number;
  rpm: number;
  supportsToolUse: boolean;
  name: string;
  provider: AiProvider;
  capability: ModelCapability;
}

/**
 * Bedrock model registry (default provider). Values match the prior behavior.
 */
function buildBedrockRegistry(): Record<string, ModelConfig> {
  const region = process.env.AWS_REGION || 'us-east-1';
  const defaultMaxTokens = parseInt(process.env.BEDROCK_MAX_TOKENS || '5120', 10);

  return {
    nova_micro: {
      modelId: process.env.MODEL_NOVA_MICRO || 'mistral.devstral-2-123b',
      region,
      maxTokens: Math.min(parseInt(process.env.MODEL_NOVA_MICRO_MAX_TOKENS || '8192', 10), 10000),
      rpm: 100,
      supportsToolUse: true,
      name: 'Devstral 2 123B',
      provider: 'bedrock',
      capability: 'fast',
    },
    nova_lite: {
      modelId: process.env.MODEL_NOVA_LITE || 'qwen.qwen3-next-80b-a3b',
      region,
      maxTokens: Math.min(parseInt(process.env.MODEL_NOVA_LITE_MAX_TOKENS || '8192', 10), 10000),
      rpm: 100,
      supportsToolUse: true,
      name: 'Qwen3 Next 80B',
      provider: 'bedrock',
      capability: 'analytical',
    },
    kimi_k2: {
      modelId: process.env.MODEL_KIMI_K2 || 'mistral.mistral-large-3-675b-instruct',
      region,
      maxTokens: parseInt(process.env.MODEL_KIMI_K2_MAX_TOKENS || '8192', 10),
      rpm: 100,
      supportsToolUse: true,
      name: 'Mistral Large 3',
      provider: 'bedrock',
      capability: 'deep_reasoning',
    },
    nemotron: {
      modelId: process.env.MODEL_NEMOTRON || 'zai.glm-5',
      region,
      maxTokens: parseInt(process.env.MODEL_NEMOTRON_MAX_TOKENS || String(defaultMaxTokens), 10),
      rpm: 100,
      supportsToolUse: true,
      name: 'Z.ai GLM-5',
      provider: 'bedrock',
      capability: 'agentic',
    },
    gpt_oss: {
      modelId: process.env.MODEL_GPT_OSS || 'moonshotai.kimi-k2.5',
      region,
      maxTokens: parseInt(process.env.MODEL_GPT_OSS_MAX_TOKENS || String(defaultMaxTokens), 10),
      rpm: 100,
      supportsToolUse: true,
      name: 'Kimi K2.5',
      provider: 'bedrock',
      capability: 'reasoning',
    },
    nova_2_lite: {
      modelId: process.env.MODEL_NOVA_2_LITE || 'global.amazon.nova-2-lite-v1:0',
      region,
      maxTokens: parseInt(process.env.MODEL_NOVA_2_LITE_MAX_TOKENS || String(defaultMaxTokens), 10),
      rpm: 20,
      supportsToolUse: true,
      name: 'Nova 2 Lite',
      provider: 'bedrock',
      capability: 'reasoning',
    },
    llama_3_3: {
      modelId: process.env.MODEL_LLAMA_3_3 || 'us.meta.llama3-3-70b-instruct-v1:0',
      region,
      maxTokens: Math.min(parseInt(process.env.MODEL_LLAMA_3_3_MAX_TOKENS || '4096', 10), 4096),
      rpm: 8000,
      supportsToolUse: false,
      name: 'Llama 3.3 70B',
      provider: 'bedrock',
      capability: 'non_tool',
    },
  };
}

/**
 * Nebius Token Factory registry. Each logical key maps to a capability bucket,
 * which resolves to a configured model ID. `non_tool` models are only used by
 * the non-tool stages.
 */
function buildNebiusRegistry(): Record<string, ModelConfig> {
  const fallbackMaxTokens = parseInt(
    process.env.NEBIUS_MAX_TOKENS || process.env.BEDROCK_MAX_TOKENS || '30000',
    10
  );

  const registry: Record<string, ModelConfig> = {};

  for (const logicalKey of Object.keys(LOGICAL_KEY_CAPABILITY)) {
    const capability = capabilityForLogicalKey(logicalKey);
    const modelId = getNebiusModelId(capability);

    registry[logicalKey] = {
      modelId,
      region: '',
      maxTokens: getNebiusMaxTokens(capability, fallbackMaxTokens),
      // Nebius rate limits are dynamic and account-level; this is a nominal
      // value used only for logging.
      rpm: 60,
      supportsToolUse: capabilitySupportsTools(capability),
      name: modelId,
      provider: 'nebius',
      capability,
    };
  }

  // Guard against misconfiguring a tool-using agent onto a non-tool model.
  for (const [agent, logicalKey] of Object.entries(AGENT_MODEL_ASSIGNMENT)) {
    if (!capabilitySupportsTools(capabilityForLogicalKey(logicalKey))) {
      throw new Error(
        `Nebius misconfiguration: agent "${agent}" maps to non-tool capability for "${logicalKey}".`
      );
    }
  }
  if (!capabilitySupportsTools(capabilityForLogicalKey(STAGE_MODEL_ASSIGNMENT.web_research))) {
    throw new Error(
      'Nebius misconfiguration: web_research requires a tool-capable model.'
    );
  }

  return registry;
}

/**
 * Build the model registry from environment variables for the active provider.
 * Called once on cold start and cached.
 */
function buildModelRegistry(): Record<string, ModelConfig> {
  return resolveAiProvider() === 'nebius'
    ? buildNebiusRegistry()
    : buildBedrockRegistry();
}

// Cold-start cache
let _registry: Record<string, ModelConfig> | null = null;

/** Get or build the model registry (cached per container). */
export function getModelRegistry(): Record<string, ModelConfig> {
  if (!_registry) {
    _registry = buildModelRegistry();
  }
  return _registry;
}

// ============================================================================
// Agent → Model Assignment
// ============================================================================

/**
 * Intelligence agent model assignments.
 *
 * Assignment rationale:
 * - Agents are distributed across models to never exceed any single model's RPM
 * - Heavier reasoning agents (catalyst, tail_risk) → stronger models
 * - Data-crunching agents (microstructure, momentum, mean_reversion) → fast models
 * - News/sentiment agents → agentic and reasoning models
 * - Each model handles at most 3 intelligence agents in parallel
 *
 * The logical keys are provider-agnostic; see `LOGICAL_KEY_CAPABILITY` in
 * `services/shared/ai-provider.ts` for the Bedrock/Nebius mapping.
 */
export const AGENT_MODEL_ASSIGNMENT: Record<AgentName, string> = {
  // Fast, price-aware data crunching (3 agents)
  market_microstructure: 'nova_micro',
  probability_baseline: 'nova_micro',
  momentum: 'nova_micro',

  // Analytical agents (3 agents)
  risk_assessment: 'nova_lite',
  polling_intelligence: 'nova_lite',
  mean_reversion: 'nova_lite',

  // Agentic-optimized, news+search heavy (3 agents)
  breaking_news: 'nemotron',
  event_impact: 'nemotron',
  historical_patterns: 'nemotron',

  // Strong reasoning, sentiment analysis (3 agents)
  media_sentiment: 'gpt_oss',
  social_sentiment: 'gpt_oss',
  narrative_velocity: 'gpt_oss',

  // Deep reasoning for complex scenario agents (2 agents)
  catalyst_identification: 'kimi_k2',
  tail_risk: 'kimi_k2',
};

/**
 * Model assignment for non-intelligence-agent stages.
 * `llama_3_3` maps to the non-tool capability and is only used where no tools
 * are required.
 */
export const STAGE_MODEL_ASSIGNMENT = {
  web_research: 'nemotron',    // Needs tools (news + search), runs alone before agents
  thesis: 'llama_3_3',         // No tools, strong reasoning needed
  cross_exam: 'llama_3_3',     // No tools, adversarial reasoning
  risk_aggressive: 'llama_3_3', // No tools, runs in parallel with other risk agents
  risk_conservative: 'llama_3_3', // No tools
  risk_neutral: 'llama_3_3',   // No tools
  recommendation: 'llama_3_3', // No tools, final synthesis
} as const;

// ============================================================================
// Model Instance Cache
// ============================================================================

const modelCache = new Map<string, Model>();

/**
 * Create or return a cached model instance for the given logical model key.
 * Each provider+key pair gets exactly one instance per Lambda container.
 */
export function getModel(modelKey: string): Model {
  const registry = getModelRegistry();
  const config = registry[modelKey];
  if (!config) {
    throw new Error(`Unknown model key: ${modelKey}. Valid keys: ${Object.keys(registry).join(', ')}`);
  }

  const cacheKey = `${config.provider}:${modelKey}`;
  const cached = modelCache.get(cacheKey);
  if (cached) {
    return cached;
  }

  const model = createProviderModel({
    provider: config.provider,
    modelId: config.modelId,
    region: config.region || undefined,
    maxTokens: config.maxTokens,
  });

  modelCache.set(cacheKey, model);
  return model;
}

/**
 * Get the model for a specific intelligence agent.
 */
export function getModelForAgent(agentName: AgentName): Model {
  const modelKey = AGENT_MODEL_ASSIGNMENT[agentName];
  return getModel(modelKey);
}

/**
 * Get the model for a specific pipeline stage.
 */
export function getModelForStage(stage: keyof typeof STAGE_MODEL_ASSIGNMENT): Model {
  const modelKey = STAGE_MODEL_ASSIGNMENT[stage];
  return getModel(modelKey);
}

/**
 * Get the config for a specific intelligence agent.
 */
export function getModelConfigForAgent(agentName: AgentName): ModelConfig {
  const registry = getModelRegistry();
  const modelKey = AGENT_MODEL_ASSIGNMENT[agentName];
  const config = registry[modelKey];
  if (!config) {
    throw new Error(`No model configured for agent "${agentName}" (key "${modelKey}").`);
  }
  return config;
}

/** Test helper: clears the registry and model instance caches. */
export function resetModelCachesForTests(): void {
  _registry = null;
  modelCache.clear();
}
