# Design Document: Amazon Nova Integration

## Overview

This design document specifies the technical implementation for integrating Amazon Nova models into TradeWizard's multi-agent AI system. The integration extends the existing LLM factory pattern to support AWS Bedrock as a model provider, enabling TradeWizard operators to leverage Amazon's Nova Micro, Nova Lite, and Nova Pro models alongside existing OpenAI, Anthropic, and Google providers.

The design maintains backward compatibility with existing configurations while introducing flexible Nova-specific settings. It follows TradeWizard's established patterns for multi-provider support, cost tracking, and observability.

## Architecture

### High-Level Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    TradeWizard Backend                       │
│                                                              │
│  ┌────────────────────────────────────────────────────┐    │
│  │           LangGraph Multi-Agent Workflow            │    │
│  │                                                      │    │
│  │  ┌──────┐  ┌──────┐  ┌──────┐  ┌──────┐  ┌──────┐ │    │
│  │  │News  │  │Poll  │  │Market│  │Senti │  │Risk  │ │    │
│  │  │Agent │  │Agent │  │Agent │  │Agent │  │Agent │ │    │
│  │  └───┬──┘  └───┬──┘  └───┬──┘  └───┬──┘  └───┬──┘ │    │
│  │      │         │         │         │         │     │    │
│  └──────┼─────────┼─────────┼─────────┼─────────┼─────┘    │
│         │         │         │         │         │          │
│         └─────────┴─────────┴─────────┴─────────┘          │
│                           │                                 │
│                    ┌──────▼──────┐                         │
│                    │ LLM Factory │                         │
│                    └──────┬──────┘                         │
│                           │                                 │
│         ┌─────────────────┼─────────────────┐              │
│         │                 │                 │              │
│    ┌────▼────┐      ┌────▼────┐      ┌────▼────┐         │
│    │ OpenAI  │      │Anthropic│      │ Google  │         │
│    │ Client  │      │ Client  │      │ Client  │         │
│    └─────────┘      └─────────┘      └─────────┘         │
│                                                             │
│                     ┌────────────┐                         │
│                     │   Bedrock  │  ◄── NEW                │
│                     │   Client   │                         │
│                     └──────┬─────┘                         │
│                            │                                │
└────────────────────────────┼────────────────────────────────┘
                             │
                    ┌────────▼─────────┐
                    │   AWS Bedrock    │
                    │                  │
                    │  ┌────────────┐  │
                    │  │Nova Micro  │  │
                    │  ├────────────┤  │
                    │  │Nova Lite   │  │
                    │  ├────────────┤  │
                    │  │Nova Pro    │  │
                    │  └────────────┘  │
                    └──────────────────┘
```

### Component Interaction Flow

1. **Agent Node** requests LLM instance from LLM Factory
2. **LLM Factory** reads configuration and determines provider (Nova, OpenAI, etc.)
3. **Bedrock Client** (if Nova) authenticates with AWS and creates model instance
4. **Agent Node** invokes model with prompt
5. **Cost Tracker** records token usage and calculates costs
6. **Opik Integration** logs traces for observability

## Components and Interfaces

### 1. Bedrock Client Module

**Location**: `src/utils/bedrock-client.ts`

**Purpose**: Manages AWS Bedrock authentication and model instantiation for Nova models.

**Interface**:

```typescript
import { BedrockRuntimeClient } from "@aws-sdk/client-bedrock-runtime";
import { BaseChatModel } from "@langchain/core/language_models/chat_models";

export interface NovaModelConfig {
  modelId: string;           // e.g., "amazon.nova-micro-v1:0"
  region: string;            // AWS region
  temperature?: number;      // 0.0 - 1.0
  maxTokens?: number;        // Max output tokens
  topP?: number;            // Nucleus sampling parameter
  credentials?: {
    accessKeyId: string;
    secretAccessKey: string;
  };
}

export interface NovaModelVariant {
  id: string;
  name: string;
  modelId: string;
  inputCostPer1kTokens: number;
  outputCostPer1kTokens: number;
  maxTokens: number;
}

export class BedrockClient {
  private client: BedrockRuntimeClient;
  private config: NovaModelConfig;

  constructor(config: NovaModelConfig);
  
  /**
   * Creates a LangChain-compatible chat model instance for Nova
   */
  createChatModel(): BaseChatModel;
  
  /**
   * Validates AWS credentials and Bedrock access
   */
  async validateConnection(): Promise<boolean>;
  
  /**
   * Returns available Nova model variants with pricing
   */
  static getAvailableModels(): NovaModelVariant[];
  
  /**
   * Validates model ID format and availability
   */
  static validateModelId(modelId: string): boolean;
}
```

**Key Responsibilities**:
- AWS credential management and authentication
- Bedrock client initialization with proper region configuration
- LangChain model wrapper creation for Nova models
- Connection validation and health checks
- Model variant metadata and pricing information

### 2. LLM Factory Extension

**Location**: `src/utils/llm-factory.ts` (existing file, to be extended)

**Purpose**: Factory pattern for creating LLM instances across all providers.

**Extended Interface**:

```typescript
export type LLMProvider = "openai" | "anthropic" | "google" | "nova";

export interface LLMConfig {
  provider: LLMProvider;
  modelName: string;
  temperature?: number;
  maxTokens?: number;
  // Nova-specific fields
  awsRegion?: string;
  awsAccessKeyId?: string;
  awsSecretAccessKey?: string;
}

export interface AgentLLMConfig {
  newsAgent?: LLMConfig;
  pollingAgent?: LLMConfig;
  marketAgent?: LLMConfig;
  sentimentAgent?: LLMConfig;
  riskAgent?: LLMConfig;
  thesisAgent?: LLMConfig;
  crossExamAgent?: LLMConfig;
  consensusAgent?: LLMConfig;
  recommendationAgent?: LLMConfig;
  default?: LLMConfig;
}

export class LLMFactory {
  /**
   * Creates an LLM instance based on configuration
   */
  static createLLM(config: LLMConfig): BaseChatModel;
  
  /**
   * Creates LLM instances for all agents based on multi-provider config
   */
  static createAgentLLMs(config: AgentLLMConfig): Map<string, BaseChatModel>;
  
  /**
   * Validates LLM configuration before instantiation
   */
  static validateConfig(config: LLMConfig): ValidationResult;
  
  /**
   * Returns default configuration for a provider
   */
  static getDefaultConfig(provider: LLMProvider): Partial<LLMConfig>;
}
```

**Implementation Strategy**:
- Add "nova" case to provider switch statement
- Delegate Nova instantiation to BedrockClient
- Validate Nova-specific configuration parameters
- Maintain existing provider logic unchanged
- Support mixed-provider configurations

### 3. Configuration Manager

**Location**: `src/config/llm-config.ts` (new file)

**Purpose**: Centralized configuration loading and validation for all LLM providers.

**Interface**:

```typescript
export interface EnvironmentConfig {
  // Nova configuration
  NOVA_MODEL_NAME?: string;
  AWS_REGION?: string;
  AWS_ACCESS_KEY_ID?: string;
  AWS_SECRET_ACCESS_KEY?: string;
  
  // Existing provider configs
  OPENAI_API_KEY?: string;
  ANTHROPIC_API_KEY?: string;
  GOOGLE_API_KEY?: string;
  
  // Multi-provider mode
  USE_MULTI_PROVIDER?: string;
  PRIMARY_PROVIDER?: LLMProvider;
}

export class LLMConfigManager {
  /**
   * Loads configuration from environment variables
   */
  static loadFromEnvironment(): AgentLLMConfig;
  
  /**
   * Validates complete configuration
   */
  static validate(config: AgentLLMConfig): ValidationResult;
  
  /**
   * Returns configuration for specific agent
   */
  static getAgentConfig(agentName: string, config: AgentLLMConfig): LLMConfig;
  
  /**
   * Checks if Nova is configured
   */
  static isNovaConfigured(): boolean;
  
  /**
   * Returns missing required environment variables
   */
  static getMissingVariables(): string[];
}
```

**Configuration Precedence**:
1. Agent-specific environment variables (e.g., `NEWS_AGENT_PROVIDER=nova`)
2. Primary provider setting (`PRIMARY_PROVIDER=nova`)
3. Default provider fallback

### 4. Cost Tracking Extension

**Location**: `src/utils/cost-tracker.ts` (existing file, to be extended)

**Purpose**: Track token usage and costs for all LLM providers including Nova.

**Extended Interface**:

```typescript
export interface TokenUsage {
  provider: LLMProvider;
  modelName: string;
  inputTokens: number;
  outputTokens: number;
  totalCost: number;
  timestamp: Date;
  agentName?: string;
}

export class CostTracker {
  /**
   * Records token usage for an LLM call
   */
  recordUsage(usage: TokenUsage): void;
  
  /**
   * Calculates cost based on provider pricing
   */
  calculateCost(
    provider: LLMProvider,
    modelName: string,
    inputTokens: number,
    outputTokens: number
  ): number;
  
  /**
   * Returns total costs grouped by provider
   */
  getCostsByProvider(): Map<LLMProvider, number>;
  
  /**
   * Returns Nova-specific pricing information
   */
  static getNovaPricing(modelVariant: string): {
    inputCostPer1kTokens: number;
    outputCostPer1kTokens: number;
  };
}
```

**Nova Pricing** (as of design time):
- Nova Micro: $0.000035/1K input tokens, $0.00014/1K output tokens
- Nova Lite: $0.00006/1K input tokens, $0.00024/1K output tokens  
- Nova Pro: $0.0008/1K input tokens, $0.0032/1K output tokens

### 5. Error Handling Module

**Location**: `src/utils/bedrock-errors.ts` (new file)

**Purpose**: Standardized error handling for Bedrock/Nova-specific failures.

**Interface**:

```typescript
export enum BedrockErrorCode {
  AUTHENTICATION_FAILED = "AUTHENTICATION_FAILED",
  RATE_LIMIT_EXCEEDED = "RATE_LIMIT_EXCEEDED",
  MODEL_NOT_FOUND = "MODEL_NOT_FOUND",
  INVALID_REQUEST = "INVALID_REQUEST",
  SERVICE_UNAVAILABLE = "SERVICE_UNAVAILABLE",
  REGION_NOT_SUPPORTED = "REGION_NOT_SUPPORTED",
}

export class BedrockError extends Error {
  code: BedrockErrorCode;
  retryable: boolean;
  details?: any;
  
  constructor(code: BedrockErrorCode, message: string, details?: any);
  
  /**
   * Returns user-friendly error message with troubleshooting steps
   */
  getUserMessage(): string;
  
  /**
   * Determines if error should trigger retry logic
   */
  shouldRetry(): boolean;
}

export class BedrockErrorHandler {
  /**
   * Wraps Bedrock API calls with error handling
   */
  static async withErrorHandling<T>(
    operation: () => Promise<T>,
    context: string
  ): Promise<T>;
  
  /**
   * Implements exponential backoff retry logic
   */
  static async retryWithBackoff<T>(
    operation: () => Promise<T>,
    maxRetries: number
  ): Promise<T>;
  
  /**
   * Converts AWS SDK errors to BedrockError
   */
  static fromAWSError(error: any): BedrockError;
}
```

## Data Models

### Nova Model Configuration Schema

```typescript
import { z } from "zod";

export const NovaModelVariantSchema = z.enum([
  "amazon.nova-micro-v1:0",
  "amazon.nova-lite-v1:0",
  "amazon.nova-pro-v1:0",
]);

export const NovaConfigSchema = z.object({
  provider: z.literal("nova"),
  modelName: NovaModelVariantSchema,
  temperature: z.number().min(0).max(1).optional().default(0.7),
  maxTokens: z.number().positive().optional(),
  awsRegion: z.string().min(1),
  awsAccessKeyId: z.string().min(1).optional(),
  awsSecretAccessKey: z.string().min(1).optional(),
});

export type NovaConfig = z.infer<typeof NovaConfigSchema>;
```

### Extended LLM Configuration Schema

```typescript
export const LLMConfigSchema = z.discriminatedUnion("provider", [
  // Existing providers
  OpenAIConfigSchema,
  AnthropicConfigSchema,
  GoogleConfigSchema,
  // New Nova provider
  NovaConfigSchema,
]);

export const AgentLLMConfigSchema = z.object({
  newsAgent: LLMConfigSchema.optional(),
  pollingAgent: LLMConfigSchema.optional(),
  marketAgent: LLMConfigSchema.optional(),
  sentimentAgent: LLMConfigSchema.optional(),
  riskAgent: LLMConfigSchema.optional(),
  thesisAgent: LLMConfigSchema.optional(),
  crossExamAgent: LLMConfigSchema.optional(),
  consensusAgent: LLMConfigSchema.optional(),
  recommendationAgent: LLMConfigSchema.optional(),
  default: LLMConfigSchema.optional(),
});
```

### Cost Tracking Data Model

```typescript
export interface NovaUsageRecord {
  id: string;
  timestamp: Date;
  modelVariant: "micro" | "lite" | "pro";
  agentName: string;
  inputTokens: number;
  outputTokens: number;
  inputCost: number;
  outputCost: number;
  totalCost: number;
  latencyMs: number;
  success: boolean;
  errorCode?: string;
}
```

## Integration Points

### 1. LangChain Integration

Nova models will be integrated via LangChain's Bedrock integration:

```typescript
import { BedrockChat } from "@langchain/community/chat_models/bedrock";

export function createNovaModel(config: NovaConfig): BedrockChat {
  return new BedrockChat({
    model: config.modelName,
    region: config.awsRegion,
    credentials: config.awsAccessKeyId ? {
      accessKeyId: config.awsAccessKeyId,
      secretAccessKey: config.awsSecretAccessKey!,
    } : undefined, // Use default AWS credential chain if not provided
    temperature: config.temperature,
    maxTokens: config.maxTokens,
  });
}
```

### 2. Opik Integration

Extend existing Opik tracing to include Nova metadata:

```typescript
export function trackNovaInvocation(
  agentName: string,
  modelVariant: string,
  inputTokens: number,
  outputTokens: number,
  latencyMs: number
): void {
  opik.track({
    name: `${agentName}_nova_invocation`,
    tags: {
      provider: "nova",
      model: modelVariant,
      agent: agentName,
    },
    metadata: {
      inputTokens,
      outputTokens,
      latencyMs,
      cost: calculateNovaCost(modelVariant, inputTokens, outputTokens),
    },
  });
}
```

### 3. Environment Variable Schema

```bash
# Nova Configuration
NOVA_MODEL_NAME=amazon.nova-lite-v1:0
AWS_REGION=us-east-1
AWS_ACCESS_KEY_ID=AKIA...
AWS_SECRET_ACCESS_KEY=...

# Multi-provider mode with Nova
USE_MULTI_PROVIDER=true
PRIMARY_PROVIDER=nova

# Agent-specific overrides
NEWS_AGENT_PROVIDER=nova
NEWS_AGENT_MODEL=amazon.nova-pro-v1:0
POLLING_AGENT_PROVIDER=openai
POLLING_AGENT_MODEL=gpt-4
```


## Correctness Properties

*A property is a characteristic or behavior that should hold true across all valid executions of a system-essentially, a formal statement about what the system should do. Properties serve as the bridge between human-readable specifications and machine-verifiable correctness guarantees.*

### Property Reflection

After analyzing all acceptance criteria, I identified the following redundancies:
- Requirements 2.1-2.3 are subsumed by 1.4 (all three model variants)
- Requirement 5.2 is duplicate of 3.4 (mixed-provider support)
- Requirement 10.3 is duplicate of 3.4 (mixed configurations)

The following properties represent unique, non-redundant correctness guarantees:

### Property 1: AWS Authentication Success

*For any* valid AWS credentials (access key ID, secret access key, and region), initializing the Bedrock client should successfully authenticate without errors.

**Validates: Requirements 1.1**

### Property 2: Invalid Credentials Rejection

*For any* invalid or malformed AWS credentials, the Bedrock client should return a descriptive error message indicating which credential is invalid and should not proceed with initialization.

**Validates: Requirements 1.2**

### Property 3: Request Format Compliance

*For any* valid Nova model configuration and prompt, the generated Bedrock API request should conform to the AWS Bedrock API schema for Nova models.

**Validates: Requirements 1.5**

### Property 4: Factory Model Mapping

*For any* valid Nova configuration specifying a model variant (Micro, Lite, or Pro), the LLM factory should instantiate a model instance with the correct model ID matching the specified variant.

**Validates: Requirements 2.4**

### Property 5: Invalid Model Name Rejection

*For any* string that is not a valid Nova model identifier, the configuration validation should reject it and return an error message listing the valid Nova model options.

**Validates: Requirements 2.5**

### Property 6: LangChain Interface Compliance

*For any* Nova configuration, the model instance created by the LLM factory should implement the BaseChatModel interface and be compatible with LangChain's chat model API.

**Validates: Requirements 3.1**

### Property 7: Parameter Application

*For any* valid Nova configuration with specified parameters (temperature, maxTokens, topP), the created model instance should have those exact parameter values applied.

**Validates: Requirements 3.2**

### Property 8: Backward Compatibility Preservation

*For any* existing provider configuration (OpenAI, Anthropic, Google) that worked before Nova integration, the LLM factory should continue to create working model instances with identical behavior.

**Validates: Requirements 3.3**

### Property 9: Mixed Provider Support

*For any* agent configuration where different agents specify different providers (including Nova), each agent should receive a model instance from its specified provider, not from other agents' providers.

**Validates: Requirements 3.4, 5.2, 10.3**

### Property 10: Configuration Validation Before Instantiation

*For any* Nova configuration with invalid parameters (e.g., temperature > 1.0, negative maxTokens), the validation should fail before attempting to create a model instance.

**Validates: Requirements 3.5**

### Property 11: Default Parameter Application

*For any* Nova configuration that omits optional parameters (temperature, maxTokens), the system should apply documented default values and create a working model instance.

**Validates: Requirements 4.4**

### Property 12: Missing Required Configuration Detection

*For any* Nova configuration missing required fields (model name, AWS region), the system should fail immediately with an error message listing all missing required variables.

**Validates: Requirements 4.5**

### Property 13: Provider Interface Consistency

*For any* prompt and model configuration, invoking a Nova model should accept the same input format and return the same output format as other providers (OpenAI, Anthropic, Google).

**Validates: Requirements 5.3**

### Property 14: State Consistency Across Providers

*For any* multi-agent workflow where different agents use different providers, the workflow state should remain consistent and accessible to all agents regardless of which provider they use.

**Validates: Requirements 5.5**

### Property 15: Token Usage Recording

*For any* Nova model invocation, the cost tracker should record both input token count and output token count with non-negative values.

**Validates: Requirements 6.1**

### Property 16: Cost Calculation Accuracy

*For any* Nova model variant (Micro, Lite, Pro) and any token counts, the calculated cost should equal (inputTokens / 1000 * inputRate) + (outputTokens / 1000 * outputRate) where rates match the official Nova pricing for that variant.

**Validates: Requirements 6.2**

### Property 17: Observability Metadata Completeness

*For any* Nova model invocation that is logged, the log entry should contain the model name, variant (Micro/Lite/Pro), agent name, and timestamp.

**Validates: Requirements 6.4**

### Property 18: Exponential Backoff Implementation

*For any* sequence of rate limit errors from Nova API, the retry delays should follow exponential backoff pattern where each delay is approximately double the previous delay (within a tolerance).

**Validates: Requirements 7.1**

### Property 19: Structured Error Response

*For any* Nova model call that fails after all retries are exhausted, the returned error should be a structured object containing error code, message, and retry count.

**Validates: Requirements 7.3**

### Property 20: Error Classification Correctness

*For any* error returned by Nova API, the system should classify it as either transient (triggering retry) or permanent (failing immediately), and transient errors should include rate limits and service unavailable errors.

**Validates: Requirements 7.4**

### Property 21: Authentication Error Actionability

*For any* authentication failure with Nova, the error message should contain at least one specific troubleshooting step (e.g., "verify AWS_ACCESS_KEY_ID is set", "check IAM permissions").

**Validates: Requirements 7.5**

### Property 22: CLI Interface Consistency

*For any* CLI command that works with existing providers, the same command with Nova configured should accept the same arguments and produce output in the same format.

**Validates: Requirements 10.5**

## Error Handling

### Error Categories

1. **Configuration Errors** (Fail Fast)
   - Missing required environment variables
   - Invalid model names
   - Malformed AWS credentials
   - Invalid parameter values (temperature, maxTokens)

2. **Authentication Errors** (Fail Fast)
   - Invalid AWS credentials
   - Insufficient IAM permissions
   - Region not supported for Bedrock

3. **Runtime Errors** (Retry with Backoff)
   - Rate limit exceeded (429)
   - Service temporarily unavailable (503)
   - Network timeouts
   - Throttling errors

4. **Request Errors** (Fail Fast)
   - Invalid request format
   - Model not found
   - Request too large
   - Invalid parameters

### Retry Strategy

```typescript
interface RetryConfig {
  maxRetries: number;        // Default: 3
  initialDelayMs: number;    // Default: 1000
  maxDelayMs: number;        // Default: 30000
  backoffMultiplier: number; // Default: 2
}

async function retryWithBackoff<T>(
  operation: () => Promise<T>,
  config: RetryConfig
): Promise<T> {
  let lastError: Error;
  let delay = config.initialDelayMs;
  
  for (let attempt = 0; attempt <= config.maxRetries; attempt++) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;
      
      if (!isRetryable(error) || attempt === config.maxRetries) {
        throw error;
      }
      
      await sleep(delay);
      delay = Math.min(delay * config.backoffMultiplier, config.maxDelayMs);
    }
  }
  
  throw lastError!;
}
```

### Error Message Templates

```typescript
const ERROR_MESSAGES = {
  MISSING_CREDENTIALS: `
    AWS credentials not found. Please set the following environment variables:
    - AWS_ACCESS_KEY_ID
    - AWS_SECRET_ACCESS_KEY
    - AWS_REGION
    
    Or configure AWS credentials using the AWS CLI:
    $ aws configure
  `,
  
  INVALID_MODEL: (provided: string, valid: string[]) => `
    Invalid Nova model: "${provided}"
    
    Valid options:
    ${valid.map(m => `  - ${m}`).join('\n')}
  `,
  
  RATE_LIMIT: (retryAfter: number) => `
    Nova API rate limit exceeded.
    Retrying after ${retryAfter}ms...
  `,
  
  AUTHENTICATION_FAILED: `
    AWS authentication failed. Please verify:
    1. AWS credentials are correct
    2. IAM user has bedrock:InvokeModel permission
    3. Bedrock is available in your AWS region
    
    For more information, see:
    https://docs.aws.amazon.com/bedrock/latest/userguide/security-iam.html
  `,
};
```

### Graceful Degradation

When Nova is unavailable:
1. Log detailed error information
2. If fallback provider is configured, switch to fallback
3. If no fallback, return error to user with troubleshooting steps
4. Continue workflow with remaining agents if possible

## Testing Strategy

### Dual Testing Approach

The Amazon Nova integration requires both unit tests and property-based tests to ensure comprehensive coverage:

**Unit Tests** focus on:
- Specific examples of model instantiation (Micro, Lite, Pro)
- Edge cases like missing optional parameters
- Error conditions with specific error codes
- Integration points with AWS SDK
- Mock Bedrock responses to avoid API costs

**Property-Based Tests** focus on:
- Universal properties across all valid configurations
- Configuration validation across random inputs
- Cost calculation correctness for random token counts
- Parameter application across random valid values
- Error handling across various error scenarios

### Property-Based Testing Configuration

All property tests will use **fast-check** library with minimum 100 iterations per test. Each test will be tagged with a comment referencing the design property:

```typescript
// Feature: amazon-nova-integration, Property 4: Factory Model Mapping
test("LLM factory creates correct Nova model variant", () => {
  fc.assert(
    fc.property(
      fc.constantFrom("amazon.nova-micro-v1:0", "amazon.nova-lite-v1:0", "amazon.nova-pro-v1:0"),
      (modelId) => {
        const config = { provider: "nova", modelName: modelId, awsRegion: "us-east-1" };
        const model = LLMFactory.createLLM(config);
        return model.modelId === modelId;
      }
    ),
    { numRuns: 100 }
  );
});
```

### Test Organization

```
src/
├── utils/
│   ├── bedrock-client.test.ts              # Unit tests for Bedrock client
│   ├── bedrock-client.property.test.ts     # Property tests for Bedrock client
│   ├── llm-factory.test.ts                 # Unit tests for factory (existing + Nova)
│   ├── llm-factory.property.test.ts        # Property tests for factory
│   ├── cost-tracker.test.ts                # Unit tests for cost tracking
│   ├── cost-tracker.property.test.ts       # Property tests for cost calculation
│   └── bedrock-errors.test.ts              # Unit tests for error handling
├── config/
│   ├── llm-config.test.ts                  # Unit tests for configuration
│   └── llm-config.property.test.ts         # Property tests for config validation
└── integration/
    ├── nova-workflow.integration.test.ts   # End-to-end workflow tests
    └── nova-mock-responses.ts              # Mock Bedrock responses
```

### Key Test Scenarios

**Unit Test Examples**:
- Instantiate Nova Micro with default parameters
- Instantiate Nova Pro with custom temperature
- Handle missing AWS_REGION environment variable
- Calculate cost for 1000 input tokens on Nova Lite
- Retry after rate limit error

**Property Test Examples**:
- For all valid Nova configs, factory creates working model
- For all invalid model names, validation rejects with error
- For all token counts, cost calculation matches formula
- For all valid parameters, model instance has correct values
- For all transient errors, retry logic is triggered

### Mock Strategy

To avoid AWS API costs during testing:

```typescript
// Mock Bedrock client for tests
export class MockBedrockClient {
  private responses: Map<string, any> = new Map();
  
  mockResponse(modelId: string, response: any): void {
    this.responses.set(modelId, response);
  }
  
  async invoke(request: any): Promise<any> {
    const response = this.responses.get(request.modelId);
    if (!response) {
      throw new Error(`No mock response for ${request.modelId}`);
    }
    return response;
  }
}
```

### Continuous Testing

- Run unit tests on every commit
- Run property tests in CI/CD pipeline
- Run integration tests nightly with real AWS credentials (in test account)
- Monitor test execution time and flakiness
- Track property test failure rates to identify edge cases

## Implementation Notes

### AWS SDK Dependencies

```json
{
  "dependencies": {
    "@aws-sdk/client-bedrock-runtime": "^3.x.x",
    "@aws-sdk/credential-providers": "^3.x.x",
    "@langchain/community": "^0.x.x"
  }
}
```

### LangChain Bedrock Integration

LangChain provides `BedrockChat` class for Nova models:

```typescript
import { BedrockChat } from "@langchain/community/chat_models/bedrock";

const model = new BedrockChat({
  model: "amazon.nova-lite-v1:0",
  region: "us-east-1",
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  },
  temperature: 0.7,
  maxTokens: 2048,
});
```

### Performance Considerations

- **Cold Start**: First Bedrock call may take 2-3 seconds for credential validation
- **Connection Pooling**: Reuse Bedrock client instances across invocations
- **Timeout Configuration**: Set appropriate timeouts for Nova API calls (default: 30s)
- **Rate Limits**: Nova has per-model rate limits; implement token bucket for request throttling

### Security Considerations

- **Credential Storage**: Never log or store AWS credentials in plain text
- **IAM Permissions**: Use least-privilege IAM policies (bedrock:InvokeModel only)
- **Region Restrictions**: Validate AWS region supports Bedrock before initialization
- **Audit Logging**: Log all Nova invocations for security audit trail

### Migration Path

For existing TradeWizard deployments:

1. **Phase 1**: Add Nova support without changing defaults
   - Deploy code with Nova integration
   - Existing configs continue using current providers
   - No user action required

2. **Phase 2**: Enable Nova for specific agents
   - Set agent-specific environment variables
   - Test with low-stakes agents first (e.g., sentiment analysis)
   - Monitor costs and performance

3. **Phase 3**: Full Nova adoption (optional)
   - Set PRIMARY_PROVIDER=nova
   - Migrate all agents to Nova
   - Decommission other provider API keys if desired

### Documentation Updates Required

1. **README.md**: Add Nova to supported providers list
2. **DEPLOYMENT.md**: Add AWS Bedrock setup instructions
3. **docs/LLM_PROVIDERS.md**: New file documenting all providers including Nova
4. **.env.example**: Add Nova environment variables with comments
5. **docs/COST_OPTIMIZATION.md**: Add Nova pricing comparison and recommendations
