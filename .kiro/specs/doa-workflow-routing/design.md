# Design Document: DOA Workflow Routing

## Overview

This design introduces a workflow service abstraction layer that enables the TradeWizard backend to execute market analysis workflows via HTTP requests to a remote service URL. The system will transparently use either a local workflow execution or a remote workflow service based on configuration, without requiring changes to the CLI or Monitor Service logic.

The key insight is that the monitor and CLI don't need to know whether the workflow runs locally or remotely - they simply need a consistent interface for executing analysis. This design provides that abstraction through a unified `analyzeMarket` function that routes to the appropriate execution method based on configuration.

## Architecture

### High-Level Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                     CLI / Monitor Service                    │
│                                                              │
│  Calls: analyzeMarket(conditionId, config, ...)            │
└────────────────────────┬────────────────────────────────────┘
                         │
                         ▼
┌─────────────────────────────────────────────────────────────┐
│              Workflow Execution Router                       │
│                                                              │
│  if (config.workflowService.url) {                          │
│    return executeRemoteWorkflow(...)                        │
│  } else {                                                    │
│    return executeLocalWorkflow(...)                         │
│  }                                                           │
└────────┬────────────────────────────────────────────┬───────┘
         │                                            │
         ▼                                            ▼
┌──────────────────────┐                  ┌──────────────────────┐
│  Remote Workflow     │                  │  Local Workflow      │
│  (HTTP Client)       │                  │  (LangGraph)         │
│                      │                  │                      │
│  POST /analyze       │                  │  createWorkflow()    │
│  Bearer: {token}     │                  │  app.invoke()        │
│  Body: {conditionId} │                  │                      │
└──────────────────────┘                  └──────────────────────┘
```

### Component Responsibilities

1. **Workflow Execution Router**: Decides whether to use local or remote execution based on configuration
2. **Remote Workflow Client**: Handles HTTP communication with workflow service
3. **Local Workflow Executor**: Existing LangGraph workflow execution (unchanged)
4. **Configuration Manager**: Loads and validates workflow service configuration

## Components and Interfaces

### 1. Configuration Schema Extension

Add a new `workflowService` section to the existing `EngineConfig`:

```typescript
// In src/config/index.ts

const EngineConfigSchema = z.object({
  // ... existing fields ...
  
  workflowService: z.object({
    // Optional URL for remote workflow service
    url: z.string().url().optional(),
    
    // Timeout for HTTP requests in milliseconds
    timeoutMs: z.number().positive().default(120000), // 2 minutes
    
    // Optional custom headers for the workflow service
    headers: z.record(z.string(), z.string()).optional(),
  }).optional(),
  
  // ... rest of schema ...
});

export type EngineConfig = z.infer<typeof EngineConfigSchema>;
```

Environment variable mapping:
- `WORKFLOW_SERVICE_URL` → `workflowService.url`
- `WORKFLOW_SERVICE_TIMEOUT_MS` → `workflowService.timeoutMs`

### 2. Workflow Service Client

Create a new HTTP client for communicating with the workflow service:

```typescript
// In src/utils/workflow-service-client.ts

import { AnalysisResult } from '../workflow.js';

export interface WorkflowServiceConfig {
  url: string;
  timeoutMs: number;
  authToken?: string;
  headers?: Record<string, string>;
}

export interface WorkflowServiceRequest {
  conditionId: string;
}

export interface WorkflowServiceResponse {
  recommendation: TradeRecommendation | null;
  agentSignals: AgentSignal[];
  cost?: number;
}

/**
 * HTTP client for workflow service communication
 */
export class WorkflowServiceClient {
  private config: WorkflowServiceConfig;
  
  constructor(config: WorkflowServiceConfig) {
    this.config = config;
  }
  
  /**
   * Execute market analysis via remote workflow service
   * 
   * @param conditionId - Market condition ID to analyze
   * @returns Analysis result from workflow service
   * @throws Error if request fails or times out
   */
  async analyzeMarket(conditionId: string): Promise<AnalysisResult> {
    const startTime = Date.now();
    
    console.log(`[WorkflowService] Sending analysis request for ${conditionId}`);
    
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), this.config.timeoutMs);
      
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        ...this.config.headers,
      };
      
      // Add Bearer token if configured
      if (this.config.authToken) {
        headers['Authorization'] = `Bearer ${this.config.authToken}`;
      }
      
      const response = await fetch(this.config.url, {
        method: 'POST',
        headers,
        body: JSON.stringify({ conditionId }),
        signal: controller.signal,
      });
      
      clearTimeout(timeoutId);
      
      const duration = Date.now() - startTime;
      
      if (!response.ok) {
        const errorBody = await response.text();
        console.error(`[WorkflowService] Request failed with status ${response.status}`, {
          status: response.status,
          statusText: response.statusText,
          body: errorBody,
          duration,
        });
        
        if (response.status === 401 || response.status === 403) {
          throw new Error(`Authentication failed: ${response.statusText}. Check DIGITALOCEAN_API_TOKEN.`);
        }
        
        throw new Error(`Workflow service returned ${response.status}: ${errorBody}`);
      }
      
      const result: WorkflowServiceResponse = await response.json();
      
      console.log(`[WorkflowService] Analysis completed successfully in ${duration}ms`);
      
      // Validate response structure
      this.validateResponse(result);
      
      return {
        recommendation: result.recommendation,
        agentSignals: result.agentSignals,
        cost: result.cost,
      };
    } catch (error) {
      const duration = Date.now() - startTime;
      
      if (error instanceof Error && error.name === 'AbortError') {
        console.error(`[WorkflowService] Request timed out after ${this.config.timeoutMs}ms`);
        throw new Error(`Workflow service request timed out after ${this.config.timeoutMs}ms`);
      }
      
      console.error(`[WorkflowService] Request failed after ${duration}ms:`, error);
      throw error;
    }
  }
  
  /**
   * Validate workflow service response structure
   */
  private validateResponse(response: WorkflowServiceResponse): void {
    if (response.recommendation !== null && typeof response.recommendation !== 'object') {
      throw new Error('Invalid response: recommendation must be an object or null');
    }
    
    if (!Array.isArray(response.agentSignals)) {
      throw new Error('Invalid response: agentSignals must be an array');
    }
    
    if (response.cost !== undefined && typeof response.cost !== 'number') {
      throw new Error('Invalid response: cost must be a number');
    }
  }
}

/**
 * Create workflow service client from configuration
 */
export function createWorkflowServiceClient(
  config: EngineConfig
): WorkflowServiceClient | null {
  if (!config.workflowService?.url) {
    return null;
  }
  
  const authToken = process.env.DIGITALOCEAN_API_TOKEN;
  
  if (!authToken) {
    console.warn('[WorkflowService] DIGITALOCEAN_API_TOKEN not set, requests may fail');
  }
  
  return new WorkflowServiceClient({
    url: config.workflowService.url,
    timeoutMs: config.workflowService.timeoutMs,
    authToken,
    headers: config.workflowService.headers,
  });
}
```

### 3. Workflow Execution Router

Modify the existing `analyzeMarket` function to route based on configuration:

```typescript
// In src/workflow.ts

/**
 * Analyze a prediction market
 *
 * This function routes to either local workflow execution or remote workflow service
 * based on configuration. The caller doesn't need to know which execution method is used.
 *
 * @param conditionId - Polymarket condition ID to analyze
 * @param config - Engine configuration
 * @param polymarketClient - Polymarket API client (only used for local execution)
 * @param supabaseManager - Optional Supabase client manager (only used for local execution)
 * @param existingOpikHandler - Optional Opik handler (only used for local execution)
 * @returns Analysis result with recommendation and agent signals
 */
export async function analyzeMarket(
  conditionId: string,
  config: EngineConfig,
  polymarketClient: PolymarketClient,
  supabaseManager?: SupabaseClientManager,
  existingOpikHandler?: any
): Promise<AnalysisResult> {
  // Check if workflow service URL is configured
  if (config.workflowService?.url) {
    console.log(`[Workflow] Using workflow service at ${config.workflowService.url}`);
    return executeRemoteWorkflow(conditionId, config);
  }
  
  console.log('[Workflow] Using local workflow execution');
  return executeLocalWorkflow(
    conditionId,
    config,
    polymarketClient,
    supabaseManager,
    existingOpikHandler
  );
}

/**
 * Execute workflow via remote service
 */
async function executeRemoteWorkflow(
  conditionId: string,
  config: EngineConfig
): Promise<AnalysisResult> {
  const client = createWorkflowServiceClient(config);
  
  if (!client) {
    throw new Error('Workflow service client could not be created');
  }
  
  return client.analyzeMarket(conditionId);
}

/**
 * Execute workflow locally (existing implementation)
 */
async function executeLocalWorkflow(
  conditionId: string,
  config: EngineConfig,
  polymarketClient: PolymarketClient,
  supabaseManager?: SupabaseClientManager,
  existingOpikHandler?: any
): Promise<AnalysisResult> {
  // This is the existing implementation - no changes needed
  const logger = new GraphExecutionLogger();
  logger.info('workflow', 'Starting market analysis', { conditionId });

  const { app, opikHandler } = await createWorkflow(
    config,
    polymarketClient,
    supabaseManager,
    existingOpikHandler
  );

  try {
    logger.info('workflow', 'Invoking LangGraph workflow');
    const result = await app.invoke(
      { conditionId },
      {
        configurable: {
          thread_id: conditionId,
        },
        callbacks: [opikHandler],
      }
    );

    logger.info('workflow', 'Flushing Opik traces');
    await opikHandler.flushAsync();

    logger.info('workflow', 'Market analysis completed successfully', {
      action: result.recommendation?.action,
      expectedValue: result.recommendation?.expectedValue,
      agentSignalsCount: result.agentSignals?.length || 0,
    });

    return {
      recommendation: result.recommendation,
      agentSignals: result.agentSignals || [],
      cost: 0,
    };
  } catch (error) {
    logger.error('workflow', 'Market analysis failed', {
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
    });

    try {
      await opikHandler.flushAsync();
    } catch (flushError) {
      logger.error('workflow', 'Failed to flush Opik traces', {
        error: flushError instanceof Error ? flushError.message : String(flushError),
      });
    }

    throw error;
  }
}
```

### 4. Monitor Service Integration

The Monitor Service requires minimal changes - it already calls `analyzeMarket`, which now handles routing internally:

```typescript
// In src/utils/monitor-service.ts

async analyzeMarket(conditionId: string): Promise<TradeRecommendation> {
  console.log(`[MonitorService] Analyzing market: ${conditionId}`);
  const startTime = Date.now();

  try {
    // This call now automatically routes to local or remote execution
    // based on config.workflowService.url
    const analysisResult = await analyzeMarket(
      conditionId,
      this.config,
      this.polymarketClient,
      this.supabaseManager,
      this.opikHandler
    );

    if (!analysisResult.recommendation) {
      throw new Error('Analysis returned null recommendation');
    }

    const { recommendation, agentSignals, cost = 0 } = analysisResult;

    await this.storeAnalysisResults(conditionId, recommendation, agentSignals, cost, startTime);

    this.lastAnalysisTime = new Date();

    const duration = Date.now() - startTime;
    
    this.opikIntegration.recordAnalysis(conditionId, duration, cost, true, agentSignals);

    console.log(`[MonitorService] Market analyzed successfully in ${duration}ms`);

    return recommendation;
  } catch (error) {
    const duration = Date.now() - startTime;
    const errorMessage = error instanceof Error ? error.message : String(error);
    
    this.opikIntegration.recordAnalysis(conditionId, duration, 0, false, [], errorMessage);
    
    console.error(`[MonitorService] Market analysis failed after ${duration}ms:`, error);
    throw error;
  }
}
```

### 5. CLI Integration

The CLI also requires no changes - it already calls `analyzeMarket`:

```typescript
// In src/cli.ts

// The existing analyze command already works correctly
// because analyzeMarket now handles routing internally

// Example from existing CLI code:
const result = await analyzeMarket(
  conditionId,
  config,
  polymarketClient,
  supabaseManager
);

// This will automatically use workflow service if configured
```

## Data Models

### Request/Response Formats

**Workflow Service Request:**
```json
{
  "conditionId": "0x1234567890abcdef..."
}
```

**Workflow Service Response:**
```json
{
  "recommendation": {
    "marketId": "0x1234567890abcdef...",
    "action": "LONG_YES",
    "entryZone": [0.45, 0.50],
    "targetZone": [0.60, 0.70],
    "expectedValue": 25.5,
    "winProbability": 0.65,
    "liquidityRisk": "medium",
    "explanation": {
      "summary": "Strong bullish signal based on polling data...",
      "coreThesis": "Recent polls show...",
      "keyCatalysts": ["Poll release", "Debate performance"],
      "failureScenarios": ["Unexpected news", "Market reversal"]
    },
    "metadata": {
      "consensusProbability": 0.65,
      "marketProbability": 0.48,
      "edge": 0.17,
      "confidenceBand": [0.60, 0.70]
    }
  },
  "agentSignals": [
    {
      "agentName": "polling_intelligence",
      "timestamp": 1704067200000,
      "confidence": 0.85,
      "direction": "YES",
      "fairProbability": 0.67,
      "keyDrivers": ["Recent poll data", "Historical patterns"],
      "riskFactors": ["Sample size", "Timing"],
      "metadata": {}
    }
  ],
  "cost": 0.45
}
```

### Configuration Structure

```typescript
interface WorkflowServiceConfig {
  url?: string;              // e.g., "https://workflow.example.com/analyze"
  timeoutMs: number;         // Default: 120000 (2 minutes)
  headers?: Record<string, string>;  // Optional custom headers
}
```

## Error Handling

### Error Categories

1. **Configuration Errors**
   - Missing DIGITALOCEAN_API_TOKEN when workflow URL is set
   - Invalid workflow URL format
   - Handled at: Configuration loading time

2. **Network Errors**
   - Connection refused / unreachable service
   - DNS resolution failures
   - Handled at: HTTP request time
   - Action: Log error, propagate to caller

3. **Timeout Errors**
   - Request exceeds configured timeout
   - Handled at: HTTP request time with AbortController
   - Action: Log timeout duration, throw descriptive error

4. **Authentication Errors**
   - 401 Unauthorized / 403 Forbidden responses
   - Handled at: Response validation time
   - Action: Log auth failure, suggest checking token

5. **Response Validation Errors**
   - Missing required fields in response
   - Invalid data types
   - Handled at: Response parsing time
   - Action: Log validation error, throw with details

6. **Service Errors**
   - 5xx status codes from workflow service
   - Handled at: Response validation time
   - Action: Log service error, propagate to caller

### Error Handling Strategy

```typescript
// Example error handling in WorkflowServiceClient

try {
  const response = await fetch(url, options);
  
  if (!response.ok) {
    if (response.status === 401 || response.status === 403) {
      throw new Error('Authentication failed. Check DIGITALOCEAN_API_TOKEN.');
    }
    
    if (response.status >= 500) {
      throw new Error(`Workflow service error: ${response.status}`);
    }
    
    throw new Error(`Request failed: ${response.status}`);
  }
  
  const result = await response.json();
  validateResponse(result);
  return result;
  
} catch (error) {
  if (error.name === 'AbortError') {
    throw new Error(`Request timed out after ${timeoutMs}ms`);
  }
  
  if (error.code === 'ECONNREFUSED') {
    throw new Error('Workflow service is unreachable');
  }
  
  throw error;
}
```

### No Automatic Fallback

The system will NOT automatically fall back to local execution when a workflow URL is configured. This is intentional:

- Prevents silent failures that mask configuration issues
- Makes deployment issues immediately visible
- Avoids unexpected behavior differences between environments
- Allows operators to explicitly choose execution mode

If fallback is desired, operators should:
1. Remove the WORKFLOW_SERVICE_URL environment variable
2. Restart the service
3. System will use local execution


## Correctness Properties

A property is a characteristic or behavior that should hold true across all valid executions of a system - essentially, a formal statement about what the system should do. Properties serve as the bridge between human-readable specifications and machine-verifiable correctness guarantees.

### Property 1: URL Validation

*For any* string provided as a workflow service URL, the configuration SHALL accept it if and only if it is a valid HTTP or HTTPS URL format.

**Validates: Requirements 1.1, 1.4, 8.5**

### Property 2: Request Structure Consistency

*For any* condition ID and configured workflow URL, when sending a request, the HTTP client SHALL use POST method, include "Content-Type: application/json" header, include "Authorization: Bearer {token}" header (when token is set), and send a JSON body with field "conditionId" containing the condition ID.

**Validates: Requirements 2.1, 2.2, 2.3, 2.9**

### Property 3: Response Validation

*For any* workflow service response, the client SHALL validate that it contains a "recommendation" field (object or null), an "agentSignals" field (array), and an optional "cost" field (number), and SHALL throw a validation error if any required field is missing or has an incorrect type.

**Validates: Requirements 7.1, 7.2, 7.3, 7.4, 7.5**

### Property 4: Routing Based on Configuration

*For any* condition ID, when a workflow URL is configured, the system SHALL send the analysis request to that URL via HTTP, and when no workflow URL is configured, the system SHALL execute the local workflow.

**Validates: Requirements 1.3, 3.1, 4.1**

### Property 5: Successful Response Handling

*For any* HTTP response with a 2xx status code and valid JSON body, the workflow client SHALL parse the response and return an AnalysisResult without throwing an error.

**Validates: Requirements 2.4, 2.5**

### Property 6: Error Response Handling

*For any* HTTP response with a non-2xx status code, the workflow client SHALL throw an error that includes the status code and response body.

**Validates: Requirements 2.6, 5.2**

### Property 7: Timeout Configuration

*For any* configured timeout value, the workflow client SHALL abort requests that exceed that timeout duration and throw a timeout error.

**Validates: Requirements 2.8**

### Property 8: No Automatic Fallback

*For any* workflow service request failure when a workflow URL is configured, the system SHALL propagate the error to the caller and SHALL NOT automatically fall back to local execution.

**Validates: Requirements 5.5, 5.6**

### Property 9: Authentication Header Format

*For any* authentication token, when present, the workflow client SHALL format the Authorization header as "Bearer {token}" where {token} is the exact token value.

**Validates: Requirements 6.3**

### Property 10: Token Security

*For any* error message or log output, the system SHALL NOT include the authentication token value.

**Validates: Requirements 6.4**

### Property 11: Request Logging

*For any* workflow service request, the system SHALL log the condition ID being analyzed, and upon completion SHALL log either the success status with response time or the error details with status code.

**Validates: Requirements 9.3, 9.4, 9.5**

### Property 12: Monitor Error Resilience

*For any* workflow service request failure in the monitor service, the monitor SHALL log the error and continue processing other markets without stopping.

**Validates: Requirements 4.3**

### Property 13: Health Metrics Tracking

*For any* workflow service request failure, the monitor service SHALL update its health status metrics to reflect the failure.

**Validates: Requirements 4.4, 4.5, 9.6**

### Property 14: Output Consistency

*For any* analysis result (whether from local or remote execution), the CLI SHALL display the recommendation in the same format regardless of execution mode.

**Validates: Requirements 3.3**

### Property 15: Backward Compatibility

*For any* system configuration without a workflow URL, the system SHALL execute workflows locally and produce identical results to the pre-DOA implementation.

**Validates: Requirements 10.2, 10.4**

## Testing Strategy

### Dual Testing Approach

The testing strategy employs both unit tests and property-based tests to ensure comprehensive coverage:

**Unit Tests** focus on:
- Specific examples of valid and invalid URLs
- Configuration loading from environment variables (Requirements 1.5, 6.1, 8.4)
- Default behavior when no URL is configured (Requirements 1.2, 3.2, 4.2, 10.1)
- Specific error cases: unreachable service, auth failures, timeouts (Requirements 5.1, 5.3, 5.4, 6.2)
- Schema structure validation (Requirements 8.1, 8.2, 8.3)
- Logging specific messages (Requirements 9.1, 9.2)
- CLI error message display (Requirement 3.4)
- CLI logging behavior (Requirement 3.5)

**Property-Based Tests** focus on:
- Universal properties that hold across all inputs
- Request/response format validation across many condition IDs
- Error handling across various status codes
- Timeout behavior across different timeout values
- Security properties (token not in logs) across all error scenarios

### Property-Based Testing Configuration

- **Library**: fast-check (TypeScript property-based testing library)
- **Minimum iterations**: 100 per property test
- **Test tagging**: Each property test must include a comment referencing the design property

Example test structure:
```typescript
// Feature: doa-workflow-routing, Property 2: Request Structure Consistency
test('workflow client sends correctly formatted requests', async () => {
  await fc.assert(
    fc.asyncProperty(
      fc.string(), // condition ID
      fc.webUrl({ validSchemes: ['https'] }), // workflow URL
      async (conditionId, url) => {
        // Test that request has correct structure
      }
    ),
    { numRuns: 100 }
  );
});
```

### Integration Testing

Integration tests will verify:
- End-to-end workflow execution via HTTP
- Monitor service integration with workflow service
- CLI integration with workflow service
- Configuration loading and validation
- Error handling across the full stack

### Test Organization

```
tradewizard-agents/src/
├── utils/
│   ├── workflow-service-client.ts
│   ├── workflow-service-client.test.ts          # Unit tests
│   └── workflow-service-client.property.test.ts # Property tests
├── workflow.ts
├── workflow.test.ts                              # Unit tests for routing
└── workflow.property.test.ts                     # Property tests for routing
```

## Security Considerations

### Authentication Token Handling

1. **Token Storage**: Token is read from environment variable only, never stored in code
2. **Token Transmission**: Token is sent only in Authorization header over HTTPS
3. **Token Logging**: Token value is never logged or included in error messages
4. **Token Validation**: Missing token logs a warning but doesn't expose token requirements to unauthorized users

### HTTPS Enforcement

While the configuration accepts both HTTP and HTTPS URLs for flexibility in development, production deployments should:
- Use HTTPS URLs only
- Validate SSL certificates
- Consider adding a configuration option to enforce HTTPS in production

### Error Message Security

Error messages should be informative for operators but not expose sensitive information:
- ✅ "Authentication failed. Check DIGITALOCEAN_API_TOKEN."
- ❌ "Authentication failed. Token 'sk-abc123...' is invalid."

## Performance Considerations

### Timeout Configuration

The default timeout of 120 seconds (2 minutes) is chosen based on:
- Typical workflow execution time: 30-90 seconds
- Network latency buffer: 10-20 seconds
- Safety margin for complex markets: 10-20 seconds

Operators can adjust this based on their deployment:
- Fast networks + simple markets: 60 seconds
- Slow networks + complex markets: 180 seconds

### Connection Pooling

The current implementation uses Node.js's built-in `fetch` which handles connection pooling automatically. For high-throughput scenarios, consider:
- Implementing connection pooling explicitly
- Reusing HTTP agents across requests
- Monitoring connection pool exhaustion

### Request Concurrency

The monitor service may send multiple concurrent requests to the workflow service. The workflow service should:
- Handle concurrent requests efficiently
- Implement rate limiting if needed
- Return 429 status codes when overloaded

## Deployment Considerations

### Environment Variables

Required for workflow service usage:
- `WORKFLOW_SERVICE_URL`: The workflow service endpoint
- `DIGITALOCEAN_API_TOKEN`: Authentication token

Optional:
- `WORKFLOW_SERVICE_TIMEOUT_MS`: Custom timeout (default: 120000)

### Migration Path

To migrate from local to remote execution:

1. **Deploy workflow service** to Digital Ocean or other infrastructure
2. **Test workflow service** independently with sample requests
3. **Configure one instance** with WORKFLOW_SERVICE_URL
4. **Monitor logs and metrics** for errors or performance issues
5. **Gradually roll out** to more instances
6. **Keep local execution** as fallback by removing WORKFLOW_SERVICE_URL if needed

### Rollback Strategy

To rollback to local execution:
1. Remove WORKFLOW_SERVICE_URL environment variable
2. Restart the service
3. System automatically uses local execution

No code changes or redeployment needed.

## Monitoring and Observability

### Metrics to Track

1. **Request Metrics**
   - Request count (success/failure)
   - Request duration (p50, p95, p99)
   - Timeout rate
   - Error rate by status code

2. **Health Metrics**
   - Workflow service connectivity status
   - Last successful request timestamp
   - Consecutive failure count

3. **Cost Metrics**
   - Analysis cost per request
   - Total cost per day/week/month

### Logging Strategy

All workflow service interactions should be logged with:
- Timestamp
- Condition ID
- Execution mode (local/remote)
- Duration
- Success/failure status
- Error details (if applicable)

Example log format:
```
[Workflow] Using workflow service at https://workflow.example.com/analyze
[WorkflowService] Sending analysis request for 0x1234...
[WorkflowService] Analysis completed successfully in 45123ms
```

### Health Check Integration

The monitor service health check should include:
```json
{
  "status": "healthy",
  "workflowService": {
    "enabled": true,
    "url": "https://workflow.example.com/analyze",
    "lastSuccess": "2024-01-01T12:00:00Z",
    "consecutiveFailures": 0
  }
}
```
