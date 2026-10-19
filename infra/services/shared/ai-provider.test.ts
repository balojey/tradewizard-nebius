import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { bedrockCtor, openaiCtor, secretsSendMock } = vi.hoisted(() => ({
  bedrockCtor: vi.fn((config: unknown) => ({ kind: 'bedrock', config })),
  openaiCtor: vi.fn((config: unknown) => ({ kind: 'openai', config })),
  secretsSendMock: vi.fn(),
}));

vi.mock('@strands-agents/sdk', () => ({
  BedrockModel: bedrockCtor,
}));

vi.mock('@strands-agents/sdk/models/openai', () => ({
  OpenAIModel: openaiCtor,
}));

vi.mock('@aws-sdk/client-secrets-manager', () => ({
  SecretsManagerClient: vi.fn(() => ({ send: secretsSendMock })),
  GetSecretValueCommand: vi.fn((input: unknown) => ({ input })),
}));

import {
  capabilityForLogicalKey,
  capabilitySupportsTools,
  createProviderModel,
  getDefaultPortfolioModelSpec,
  getNebiusApiKey,
  getNebiusMaxTokens,
  getNebiusModelId,
  resetAiProviderCachesForTests,
  resolveAiProvider,
  validateAiProviderConfiguration,
} from './ai-provider';

const ORIGINAL_ENV = { ...process.env };

function resetEnv(): void {
  delete process.env.AI_PROVIDER;
  delete process.env.NEBIUS_API_KEY;
  delete process.env.NEBIUS_API_KEY_SECRET_ARN;
  delete process.env.NEBIUS_BASE_URL;
  delete process.env.NEBIUS_MAX_TOKENS;
  delete process.env.NEBIUS_MODEL_FAST;
  delete process.env.NEBIUS_MODEL_ANALYTICAL;
  delete process.env.NEBIUS_MODEL_AGENTIC;
  delete process.env.NEBIUS_MODEL_REASONING;
  delete process.env.NEBIUS_MODEL_DEEP_REASONING;
  delete process.env.NEBIUS_MODEL_NON_TOOL;
  delete process.env.NEBIUS_MODEL_DEFAULT;
  delete process.env.NEBIUS_MODEL_AGENTIC_MAX_TOKENS;
  delete process.env.BEDROCK_MODEL_ID;
  delete process.env.BEDROCK_MAX_TOKENS;
  delete process.env.AWS_REGION;
}

beforeEach(() => {
  process.env = { ...ORIGINAL_ENV };
  resetEnv();
  bedrockCtor.mockClear();
  openaiCtor.mockClear();
  secretsSendMock.mockReset();
  resetAiProviderCachesForTests();
});

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
});

describe('resolveAiProvider', () => {
  it('defaults to bedrock', () => {
    expect(resolveAiProvider()).toBe('bedrock');
  });

  it('accepts explicit nebius (case-insensitive)', () => {
    process.env.AI_PROVIDER = 'NEBIUS';
    expect(resolveAiProvider()).toBe('nebius');
  });

  it('throws on an unsupported provider', () => {
    process.env.AI_PROVIDER = 'openai';
    expect(() => resolveAiProvider()).toThrow(/Unsupported AI_PROVIDER/);
  });
});

describe('capability mapping', () => {
  it('maps logical keys to capability buckets', () => {
    expect(capabilityForLogicalKey('nova_micro')).toBe('fast');
    expect(capabilityForLogicalKey('nemotron')).toBe('agentic');
    expect(capabilityForLogicalKey('llama_3_3')).toBe('non_tool');
  });

  it('marks only non_tool as tool-incapable', () => {
    expect(capabilitySupportsTools('fast')).toBe(true);
    expect(capabilitySupportsTools('agentic')).toBe(true);
    expect(capabilitySupportsTools('default')).toBe(true);
    expect(capabilitySupportsTools('non_tool')).toBe(false);
  });
});

describe('Nebius model configuration', () => {
  it('throws when a capability model ID is missing', () => {
    expect(() => getNebiusModelId('agentic')).toThrow(/NEBIUS_MODEL_AGENTIC/);
  });

  it('reads model IDs from env', () => {
    process.env.NEBIUS_MODEL_AGENTIC = 'vendor/agentic-model';
    expect(getNebiusModelId('agentic')).toBe('vendor/agentic-model');
  });

  it('prefers per-capability max tokens over the shared value', () => {
    process.env.NEBIUS_MAX_TOKENS = '10000';
    process.env.NEBIUS_MODEL_AGENTIC_MAX_TOKENS = '20000';
    expect(getNebiusMaxTokens('agentic', 5000)).toBe(20000);
    expect(getNebiusMaxTokens('fast', 5000)).toBe(10000);
  });

  it('validates required model IDs only for the active provider', () => {
    process.env.AI_PROVIDER = 'bedrock';
    expect(() => validateAiProviderConfiguration(['fast'])).not.toThrow();

    process.env.AI_PROVIDER = 'nebius';
    expect(() => validateAiProviderConfiguration(['fast'])).toThrow(
      /NEBIUS_MODEL_FAST/
    );
  });
});

describe('model construction', () => {
  it('constructs a Bedrock model by default', () => {
    process.env.BEDROCK_MODEL_ID = 'bedrock-model';
    process.env.AWS_REGION = 'us-east-1';
    process.env.BEDROCK_MAX_TOKENS = '4096';

    const spec = getDefaultPortfolioModelSpec();
    expect(spec).toMatchObject({
      provider: 'bedrock',
      modelId: 'bedrock-model',
      region: 'us-east-1',
      maxTokens: 4096,
    });

    createProviderModel(spec);
    expect(bedrockCtor).toHaveBeenCalledWith({
      modelId: 'bedrock-model',
      region: 'us-east-1',
      maxTokens: 4096,
    });
    expect(openaiCtor).not.toHaveBeenCalled();
  });

  it('constructs an OpenAI-compatible Nebius model when selected', async () => {
    process.env.AI_PROVIDER = 'nebius';
    process.env.NEBIUS_MODEL_DEFAULT = 'vendor/default-model';
    process.env.NEBIUS_MAX_TOKENS = '8192';
    process.env.NEBIUS_BASE_URL = 'https://nebius.example/v1/';
    process.env.NEBIUS_API_KEY = 'test-nebius-key';

    const spec = getDefaultPortfolioModelSpec();
    expect(spec).toMatchObject({
      provider: 'nebius',
      modelId: 'vendor/default-model',
      maxTokens: 8192,
    });

    createProviderModel(spec);
    expect(openaiCtor).toHaveBeenCalledTimes(1);

    const config = openaiCtor.mock.calls[0][0] as {
      api: string;
      modelId: string;
      maxTokens: number;
      apiKey: () => Promise<string>;
      clientConfig: { baseURL: string };
    };
    expect(config.api).toBe('chat');
    expect(config.modelId).toBe('vendor/default-model');
    expect(config.maxTokens).toBe(8192);
    expect(config.clientConfig.baseURL).toBe('https://nebius.example/v1/');
    await expect(config.apiKey()).resolves.toBe('test-nebius-key');
    expect(bedrockCtor).not.toHaveBeenCalled();
  });
});

describe('Nebius API key loading', () => {
  it('reads a JSON apiKey from Secrets Manager', async () => {
    process.env.NEBIUS_API_KEY_SECRET_ARN = 'arn:aws:secretsmanager:test';
    secretsSendMock.mockResolvedValue({
      SecretString: JSON.stringify({ apiKey: 'secret-key' }),
    });

    await expect(getNebiusApiKey()).resolves.toBe('secret-key');
  });

  it('ignores the random CDK placeholder and falls back to env', async () => {
    process.env.NEBIUS_API_KEY_SECRET_ARN = 'arn:aws:secretsmanager:test';
    process.env.NEBIUS_API_KEY = 'env-key';
    secretsSendMock.mockResolvedValue({ SecretString: 'random-placeholder' });

    await expect(getNebiusApiKey()).resolves.toBe('env-key');
  });

  it('throws when neither the secret nor env key is available', async () => {
    process.env.NEBIUS_API_KEY_SECRET_ARN = 'arn:aws:secretsmanager:test';
    secretsSendMock.mockResolvedValue({ SecretString: 'random-placeholder' });

    await expect(getNebiusApiKey()).rejects.toThrow(
      /Nebius API key is not configured/
    );
  });
});
