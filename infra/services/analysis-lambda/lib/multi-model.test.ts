import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  AGENT_MODEL_ASSIGNMENT,
  getModelConfigForAgent,
  getModelRegistry,
  resetModelCachesForTests,
} from './multi-model';

const ORIGINAL_ENV = { ...process.env };

const NEBIUS_MODELS: Record<string, string> = {
  NEBIUS_MODEL_FAST: 'vendor/fast',
  NEBIUS_MODEL_ANALYTICAL: 'vendor/analytical',
  NEBIUS_MODEL_AGENTIC: 'vendor/agentic',
  NEBIUS_MODEL_REASONING: 'vendor/reasoning',
  NEBIUS_MODEL_DEEP_REASONING: 'vendor/deep-reasoning',
  NEBIUS_MODEL_NON_TOOL: 'vendor/non-tool',
};

beforeEach(() => {
  process.env = { ...ORIGINAL_ENV };
  process.env.AI_PROVIDER = 'nebius';
  for (const [key, value] of Object.entries(NEBIUS_MODELS)) {
    process.env[key] = value;
  }
  resetModelCachesForTests();
});

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
  resetModelCachesForTests();
});

describe('Nebius analysis registry', () => {
  it('maps every intelligence agent to a tool-capable model', () => {
    for (const agent of Object.keys(AGENT_MODEL_ASSIGNMENT)) {
      const config = getModelConfigForAgent(agent as keyof typeof AGENT_MODEL_ASSIGNMENT);
      expect(config.provider).toBe('nebius');
      expect(config.supportsToolUse).toBe(true);
      expect(config.modelId).toMatch(/^vendor\//);
    }
  });

  it('maps the non-tool stage key to a non-tool model', () => {
    const registry = getModelRegistry();
    expect(registry.llama_3_3.capability).toBe('non_tool');
    expect(registry.llama_3_3.supportsToolUse).toBe(false);
  });

  it('maps web research to a tool-capable model', () => {
    const registry = getModelRegistry();
    expect(registry.nemotron.capability).toBe('agentic');
    expect(registry.nemotron.supportsToolUse).toBe(true);
  });
});
