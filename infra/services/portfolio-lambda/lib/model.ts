/**
 * Shared model factory for Portfolio_Lambda.
 *
 * Provider-aware: Bedrock by default, or Nebius Token Factory when
 * AI_PROVIDER=nebius. The portfolio agent, prompts, and tools are unchanged.
 *
 * Requirements: 3.5, 3.6, 3.8
 */

import type { Model } from '@strands-agents/sdk';
import {
  createProviderModel,
  getDefaultPortfolioModelSpec,
  resetAiProviderCachesForTests,
} from '../../shared/ai-provider';

let cachedModel: Model | null = null;

/**
 * Create or return the cached portfolio decision model.
 *
 * Bedrock reads BEDROCK_MODEL_ID / AWS_REGION / BEDROCK_MAX_TOKENS.
 * Nebius reads NEBIUS_MODEL_DEFAULT / NEBIUS_MAX_TOKENS / NEBIUS_BASE_URL.
 */
export function createModel(): Model {
  if (cachedModel) return cachedModel;

  cachedModel = createProviderModel(getDefaultPortfolioModelSpec());
  return cachedModel;
}

/** Test helper: clears the cached model and provider credentials. */
export function resetPortfolioModelCacheForTests(): void {
  cachedModel = null;
  resetAiProviderCachesForTests();
}
