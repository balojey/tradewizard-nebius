# Design Document: Autonomous Polling Agent with Data Fetching

## Overview

The Autonomous Polling Agent transforms TradeWizard's existing polling intelligence agent from a passive data consumer into an active, tool-using agent capable of autonomously fetching and researching Polymarket data. This enhancement leverages LangChain's tool-calling capabilities to enable the agent to:

- Autonomously decide what data it needs based on market context
- Fetch related markets for cross-market sentiment analysis
- Retrieve historical price data for trend analysis
- Perform event-level intelligence gathering
- Synthesize information from multiple sources

**Key Innovation**: By giving the polling agent direct access to Polymarket data through tools, it can perform deep, context-aware analysis that adapts to each market's unique characteristics, rather than being limited to pre-fetched data in the workflow state.

**Architecture Pattern**: The agent uses LangChain's ReAct (Reasoning + Acting) pattern, where it iteratively reasons about what data it needs, invokes tools to fetch that data, and synthesizes the results into its final polling analysis.

## Architecture

### High-Level Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                   Autonomous Polling Agent                   │
│                                                              │
│  ┌────────────────────────────────────────────────────────┐ │
│  │              LangChain Agent Executor                   │ │
│  │  ┌──────────────────────────────────────────────────┐  │ │
│  │  │         LLM (Google/OpenAI/Anthropic)            │  │ │
│  │  │  - Decides which tools to use                    │  │ │
│  │  │  - Synthesizes tool results                      │  │ │
│  │  │  - Generates final polling analysis              │  │ │
│  │  └──────────────────────────────────────────────────┘  │ │
│  │                         ↓↑                              │ │
│  │  ┌──────────────────────────────────────────────────┐  │ │
│  │  │              Tool Execution Layer                │  │ │
│  │  │  - Validates tool inputs                         │  │ │
│  │  │  - Executes tool functions                       │  │ │
│  │  │  - Returns structured results                    │  │ │
│  │  └──────────────────────────────────────────────────┘  │ │
│  └────────────────────────────────────────────────────────┘ │
│                         ↓↑                                  │
│  ┌────────────────────────────────────────────────────────┐ │
│  │                  Polling Tools                          │ │
│  │  - fetchRelatedMarkets                                  │ │
│  │  - fetchHistoricalPrices                                │ │
│  │  - fetchCrossMarketData                                 │ │
│  │  - analyzeMarketMomentum                                │ │
│  │  - detectSentimentShifts                                │ │
│  └────────────────────────────────────────────────────────┘ │
│                         ↓↑                                  │
│  ┌────────────────────────────────────────────────────────┐ │
│  │              PolymarketClient                           │ │
│  │  - fetchEventDetails()                                  │ │
│  │  - fetchEventWithAllMarkets()                           │ │
│  │  - fetchMarketData()                                    │ │
│  │  - Rate limiting & caching                              │ │
│  └────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────┘
```

### Integration with Existing Workflow

The autonomous polling agent integrates into the existing TradeWizard workflow as an enhanced version of the polling intelligence agent:

```
market_ingestion → keyword_extraction → dynamic_agent_selection
                                              ↓
                                    [parallel execution]
                                              ↓
                    ┌─────────────────────────┼─────────────────────────┐
                    ↓                         ↓                         ↓
        market_microstructure_agent  probability_baseline_agent  risk_assessment_agent
                    ↓                         ↓                         ↓
        breaking_news_agent          event_impact_agent          autonomous_polling_agent ← ENHANCED
                    ↓                         ↓                         ↓
                    └─────────────────────────┼─────────────────────────┘
                                              ↓
                                    agent_signal_fusion
```

### Configuration

The agent supports two modes:

1. **Autonomous Mode** (new): Agent uses tools to fetch data
2. **Basic Mode** (existing): Agent uses pre-fetched data from state

Configuration via feature flag:
```typescript
{
  pollingAgent: {
    autonomous: true,  // Enable autonomous mode
    maxToolCalls: 5,   // Limit tool calls per analysis
    timeout: 45000,    // 45 second timeout
  }
}
```

## Components and Interfaces

### 1. Tool Definitions

**File**: `tradewizard-agents/src/tools/polling-tools.ts` (new file)

Each tool is defined as a LangChain Structured Tool with:
- Input schema (Zod)
- Description for the LLM
- Execution function
- Error handling

**Tool Interface**:
```typescript
interface PollingTool {
  name: string;
  description: string;
  schema: z.ZodObject<any>;
  func: (input: any, context: ToolContext) => Promise<any>;
}

interface ToolContext {
  polymarketClient: PolymarketClient;
  cache: ToolCache;
  auditLog: AuditLogger;
}
```

### 2. Tool Implementations

#### fetchRelatedMarkets Tool

**Purpose**: Fetch all markets within the same Polymarket event

**Input Schema**:
```typescript
const FetchRelatedMarketsSchema = z.object({
  conditionId: z.string().describe('The condition ID of the market to find related markets for'),
  minVolume: z.number().optional().default(100).describe('Minimum 24h volume in USD to include'),
});
```

**Output Schema**:
```typescript
{
  eventId: string;
  eventTitle: string;
  markets: Array<{
    conditionId: string;
    question: string;
    currentProbability: number;
    volume24h: number;
    liquidityScore: number;
  }>;
  totalMarkets: number;
}
```

**Implementation Logic**:
1. Use `polymarketClient.fetchEventDetails()` to find parent event
2. Use `polymarketClient.fetchEventWithAllMarkets()` to get all markets
3. Filter out the input market
4. Filter by minimum volume threshold
5. Return structured market data

#### fetchHistoricalPrices Tool

**Purpose**: Fetch historical price data for trend analysis

**Input Schema**:
```typescript
const FetchHistoricalPricesSchema = z.object({
  conditionId: z.string().describe('The condition ID of the market'),
  timeHorizon: z.enum(['1h', '24h', '7d', '30d']).describe('Time horizon for historical data'),
});
```

**Output Schema**:
```typescript
{
  conditionId: string;
  timeHorizon: string;
  dataPoints: Array<{
    timestamp: number;
    probability: number;
  }>;
  priceChange: number;  // Percentage change from first to last
  trend: 'uptrend' | 'downtrend' | 'sideways';
}
```

**Implementation Logic**:
1. Calculate start timestamp based on time horizon
2. Fetch market data at multiple time points (simulate historical data)
3. Calculate price change percentage
4. Determine trend direction based on price movements
5. Return structured price history

**Note**: Since Polymarket doesn't provide historical price API, we'll use current price and simulate historical data based on volume and volatility patterns. In production, this would integrate with a time-series database.

#### fetchCrossMarketData Tool

**Purpose**: Fetch comprehensive event-level data for all markets

**Input Schema**:
```typescript
const FetchCrossMarketDataSchema = z.object({
  eventId: z.string().describe('The event ID to fetch cross-market data for'),
  maxMarkets: z.number().optional().default(20).describe('Maximum number of markets to return'),
});
```

**Output Schema**:
```typescript
{
  eventId: string;
  eventTitle: string;
  eventDescription: string;
  totalVolume: number;
  totalLiquidity: number;
  markets: Array<{
    conditionId: string;
    question: string;
    currentProbability: number;
    volume24h: number;
    liquidityScore: number;
    volumeRank: number;
  }>;
  aggregateSentiment: {
    averageProbability: number;
    weightedAverageProbability: number;  // Weighted by volume
    sentimentDirection: 'bullish' | 'bearish' | 'neutral';
  };
}
```

**Implementation Logic**:
1. Use `polymarketClient.fetchEventWithAllMarkets()`
2. Sort markets by volume24h descending
3. Take top N markets (default 20)
4. Calculate aggregate sentiment metrics
5. Return structured event data

#### analyzeMarketMomentum Tool

**Purpose**: Calculate momentum indicators from price history

**Input Schema**:
```typescript
const AnalyzeMarketMomentumSchema = z.object({
  conditionId: z.string().describe('The condition ID of the market'),
});
```

**Output Schema**:
```typescript
{
  conditionId: string;
  momentum: {
    score: number;  // -1 to +1
    direction: 'bullish' | 'bearish' | 'neutral';
    strength: 'strong' | 'moderate' | 'weak';
    confidence: number;  // 0-1
  };
  timeHorizons: {
    '1h': { priceChange: number; velocity: number };
    '24h': { priceChange: number; velocity: number };
    '7d': { priceChange: number; velocity: number };
  };
}
```

**Implementation Logic**:
1. Fetch historical prices for multiple time horizons
2. Calculate price velocity (rate of change)
3. Calculate price acceleration (change in velocity)
4. Compute momentum score based on velocity and acceleration
5. Classify momentum direction and strength
6. Return structured momentum analysis

#### detectSentimentShifts Tool

**Purpose**: Detect significant sentiment shifts across time horizons

**Input Schema**:
```typescript
const DetectSentimentShiftsSchema = z.object({
  conditionId: z.string().describe('The condition ID of the market'),
  threshold: z.number().optional().default(0.05).describe('Minimum price change to flag as shift (default 5%)'),
});
```

**Output Schema**:
```typescript
{
  conditionId: string;
  shifts: Array<{
    timeHorizon: '1h' | '24h' | '7d';
    magnitude: number;  // Percentage change
    direction: 'toward_yes' | 'toward_no';
    classification: 'minor' | 'moderate' | 'major';
    timestamp: number;
  }>;
  hasSignificantShift: boolean;
}
```

**Implementation Logic**:
1. Fetch historical prices for all time horizons
2. Calculate price changes for each horizon
3. Compare changes against threshold
4. Classify magnitude: minor (5-10%), moderate (10-20%), major (>20%)
5. Return array of detected shifts

### 3. Tool Cache

**File**: `tradewizard-agents/src/utils/tool-cache.ts` (new file)

**Purpose**: Cache tool results within an analysis session to avoid redundant API calls

**Interface**:
```typescript
class ToolCache {
  private cache: Map<string, CacheEntry>;
  private sessionId: string;

  constructor(sessionId: string);
  
  get(toolName: string, params: any): any | null;
  set(toolName: string, params: any, result: any): void;
  clear(): void;
  getStats(): { hits: number; misses: number };
}

interface CacheEntry {
  result: any;
  timestamp: number;
  params: any;
}
```

**Cache Key Generation**:
```typescript
function generateCacheKey(toolName: string, params: any): string {
  return `${toolName}:${JSON.stringify(params)}`;
}
```

**Cache Behavior**:
- Cache is scoped to a single analysis session (conditionId)
- Cache expires when analysis completes
- Cache hits/misses are logged to audit trail

### 4. Agent Executor

**File**: `tradewizard-agents/src/nodes/autonomous-polling-agent.ts` (new file)

**Purpose**: Create and execute the autonomous polling agent with tool-calling capabilities

**Agent Creation**:
```typescript
import { createReactAgent } from '@langchain/langgraph/prebuilt';
import { StructuredTool } from '@langchain/core/tools';

function createAutonomousPollingAgent(
  config: EngineConfig,
  tools: StructuredTool[]
): AgentExecutor {
  // Create LLM instance
  const llm = createLLMInstance(config, 'google', ['openai', 'anthropic']);
  
  // Create ReAct agent with tools
  const agent = createReactAgent({
    llm,
    tools,
    messageModifier: AUTONOMOUS_POLLING_SYSTEM_PROMPT,
  });
  
  return agent;
}
```

**Agent Node Function**:
```typescript
export function createAutonomousPollingAgentNode(
  config: EngineConfig
): (state: GraphStateType) => Promise<Partial<GraphStateType>> {
  // Initialize tools with PolymarketClient
  const polymarketClient = createPolymarketClient(config.polymarket);
  const tools = createPollingTools(polymarketClient);
  
  // Create agent executor
  const agent = createAutonomousPollingAgent(config, tools);
  
  // Return node function
  return async (state: GraphStateType): Promise<Partial<GraphStateType>> => {
    const startTime = Date.now();
    const sessionId = state.mbd?.conditionId || 'unknown';
    const cache = new ToolCache(sessionId);
    const toolAuditLog: ToolAuditEntry[] = [];
    
    try {
      // Check if MBD is available
      if (!state.mbd) {
        return createErrorResponse('No Market Briefing Document available');
      }
      
      // Prepare agent input
      const input = {
        market: JSON.stringify(state.mbd, null, 2),
        keywords: state.marketKeywords ? JSON.stringify(state.marketKeywords, null, 2) : 'None',
      };
      
      // Execute agent with timeout
      const result = await Promise.race([
        agent.invoke(input, {
          configurable: {
            cache,
            auditLog: toolAuditLog,
          },
        }),
        timeout(config.pollingAgent.timeout || 45000),
      ]);
      
      // Parse agent output into AgentSignal
      const signal = parseAgentOutput(result);
      
      // Add tool usage metadata
      signal.metadata.toolUsage = {
        toolsCalled: toolAuditLog.length,
        totalToolTime: toolAuditLog.reduce((sum, entry) => sum + entry.duration, 0),
        cacheHits: cache.getStats().hits,
        cacheMisses: cache.getStats().misses,
      };
      
      return {
        agentSignals: [signal],
        auditLog: [
          {
            stage: 'agent_autonomous_polling',
            timestamp: Date.now(),
            data: {
              agentName: 'autonomous_polling',
              success: true,
              direction: signal.direction,
              confidence: signal.confidence,
              fairProbability: signal.fairProbability,
              toolsCalled: toolAuditLog.length,
              duration: Date.now() - startTime,
              toolAudit: toolAuditLog,
            },
          },
        ],
      };
    } catch (error) {
      return createErrorResponse(error);
    }
  };
}
```

### 5. System Prompt

**Enhanced System Prompt for Autonomous Agent**:

```typescript
const AUTONOMOUS_POLLING_SYSTEM_PROMPT = `You are an autonomous polling intelligence analyst with the ability to fetch and research Polymarket data.

Your role is to analyze prediction markets as real-time polling systems, where prices represent financially-incentivized collective beliefs.

AVAILABLE TOOLS:
You have access to the following tools to gather data:

1. fetchRelatedMarkets: Find other markets in the same event for cross-market analysis
2. fetchHistoricalPrices: Get price history to analyze sentiment trends over time
3. fetchCrossMarketData: Get comprehensive event-level data for all markets
4. analyzeMarketMomentum: Calculate momentum indicators from price movements
5. detectSentimentShifts: Identify significant sentiment changes across time horizons

ANALYSIS STRATEGY:
Based on the market characteristics, intelligently decide which tools to use:

- For election markets: Prioritize fetchRelatedMarkets and fetchCrossMarketData for cross-market sentiment
- For high-volatility markets: Prioritize fetchHistoricalPrices and analyzeMarketMomentum for trend analysis
- For low-liquidity markets: Fetch related markets to supplement thin data
- For multi-market events: Always fetch event-level context

TOOL USAGE GUIDELINES:
- Limit yourself to 5 tool calls maximum to control latency
- Use tools in sequence to build comprehensive analysis
- Synthesize information from multiple tool results
- Document your data gathering strategy in keyDrivers

ANALYSIS FOCUS:
- Sentiment shifts reflected in price movements
- Crowd wisdom signals (high liquidity, tight spreads, consistent momentum)
- Cross-market sentiment patterns when multiple related markets exist
- Historical trends and momentum indicators
- Comparison with polling baselines

OUTPUT FORMAT:
Provide your analysis as a structured signal with:
- confidence: Your confidence in this polling analysis (0-1)
- direction: Your view on the outcome (YES/NO/NEUTRAL)
- fairProbability: Your probability estimate (0-1)
- keyDrivers: Top 3-5 polling insights including data gathering strategy
- riskFactors: Polling-specific risks and data limitations
- metadata: Include all relevant metrics from tool results

Be well-calibrated and document your reasoning process.`;
```

## Data Models

### Tool Input/Output Schemas

All tool schemas are defined using Zod for runtime validation:

```typescript
// Tool input schemas
export const ToolInputSchemas = {
  fetchRelatedMarkets: z.object({
    conditionId: z.string(),
    minVolume: z.number().optional().default(100),
  }),
  
  fetchHistoricalPrices: z.object({
    conditionId: z.string(),
    timeHorizon: z.enum(['1h', '24h', '7d', '30d']),
  }),
  
  fetchCrossMarketData: z.object({
    eventId: z.string(),
    maxMarkets: z.number().optional().default(20),
  }),
  
  analyzeMarketMomentum: z.object({
    conditionId: z.string(),
  }),
  
  detectSentimentShifts: z.object({
    conditionId: z.string(),
    threshold: z.number().optional().default(0.05),
  }),
};
```

### Agent Signal Output

The autonomous agent produces the same `AgentSignal` schema as the basic polling agent, with additional metadata:

```typescript
{
  agentName: 'autonomous_polling',
  timestamp: number,
  confidence: number,
  direction: 'YES' | 'NO' | 'NEUTRAL',
  fairProbability: number,
  keyDrivers: string[],
  riskFactors: string[],
  metadata: {
    // Standard polling metadata
    crowdWisdomScore: number,
    pollingBaseline: number,
    marketDeviation: number,
    sentimentShift?: {
      magnitude: number,
      direction: 'YES' | 'NO',
      timeHorizon: string,
    },
    
    // Cross-market metadata (when available)
    crossMarketAlignment?: number,
    relatedMarketCount?: number,
    eventLevelSentiment?: {
      averageProbability: number,
      weightedAverageProbability: number,
      sentimentDirection: string,
    },
    
    // Momentum metadata (when analyzed)
    momentum?: {
      score: number,
      direction: string,
      strength: string,
      confidence: number,
    },
    
    // Tool usage metadata (new)
    toolUsage: {
      toolsCalled: number,
      totalToolTime: number,
      cacheHits: number,
      cacheMisses: number,
    },
  },
}
```

### Tool Audit Entry

```typescript
interface ToolAuditEntry {
  toolName: string;
  timestamp: number;
  params: any;
  result?: any;
  error?: string;
  duration: number;
  cacheHit: boolean;
}
```

## Correctness Properties

*A property is a characteristic or behavior that should hold true across all valid executions of a system-essentially, a formal statement about what the system should do. Properties serve as the bridge between human-readable specifications and machine-verifiable correctness guarantees.*

Before writing the correctness properties, I need to perform prework analysis on the acceptance criteria:


## Property Reflection

After reviewing the prework analysis, I'll identify and eliminate redundant properties:

**Redundancy Analysis**:
- Properties 1.3 and 16.1-16.6 all relate to audit logging - these can be consolidated into comprehensive audit logging properties
- Properties 13.3 and 13.4 both test caching behavior - these can be combined into a single caching property
- Properties 2.4, 3.3, 4.3, 4.4 all test tool output structure - these can be consolidated into a schema validation property per tool
- Properties 5.4, 5.5, 6.5 all test enum field validation - these can be combined with their parent properties

**Consolidated Properties**:
After consolidation, we have the following unique, non-redundant properties:

### Property 1: Tool Input Validation
*For any* tool invocation with invalid input parameters, the system SHALL reject the invocation and return a validation error without executing the tool function.
**Validates: Requirements 1.2**

### Property 2: Tool Audit Logging Completeness
*For any* tool invocation (successful or failed), the audit trail SHALL contain an entry with timestamp, toolName, params, duration, and either result or error fields.
**Validates: Requirements 1.3, 16.1, 16.2, 16.3**

### Property 3: Tool Error Handling
*For any* tool execution that encounters an error, the system SHALL return a structured error object to the agent without throwing an uncaught exception.
**Validates: Requirements 1.4, 12.1, 12.6**

### Property 4: Tool Result Caching
*For any* tool invocation within the same analysis session, when the same tool is called with identical parameters, the second call SHALL return a cached result and log a cache hit.
**Validates: Requirements 1.6, 13.3, 13.4**

### Property 5: Related Markets Exclusion
*For any* conditionId passed to fetchRelatedMarkets, the returned markets array SHALL NOT contain a market with that conditionId.
**Validates: Requirements 2.3**

### Property 6: Related Markets Output Schema
*For any* successful fetchRelatedMarkets invocation, all returned markets SHALL have conditionId, question, currentProbability, volume24h, and liquidityScore fields.
**Validates: Requirements 2.4**

### Property 7: Related Markets Volume Filter
*For any* successful fetchRelatedMarkets invocation, all returned markets SHALL have volume24h >= minVolume parameter (default 100).
**Validates: Requirements 2.6**

### Property 8: Historical Prices Time Horizon Validation
*For any* fetchHistoricalPrices invocation, the timeHorizon parameter SHALL be one of '1h', '24h', '7d', '30d', otherwise the tool SHALL return a validation error.
**Validates: Requirements 3.2**

### Property 9: Historical Prices Output Schema
*For any* successful fetchHistoricalPrices invocation, all returned dataPoints SHALL have timestamp and probability fields, and the result SHALL include a priceChange field.
**Validates: Requirements 3.3, 3.4**

### Property 10: Historical Prices Minimum Data Points
*For any* successful fetchHistoricalPrices invocation where historical data is available, the dataPoints array SHALL contain at least 10 elements.
**Validates: Requirements 3.6**

### Property 11: Cross-Market Data Output Schema
*For any* successful fetchCrossMarketData invocation, the result SHALL include eventId, eventTitle, eventDescription, totalVolume, totalLiquidity, markets array, and aggregateSentiment object.
**Validates: Requirements 4.3, 4.5**

### Property 12: Cross-Market Data Market Schema
*For any* successful fetchCrossMarketData invocation, all returned markets SHALL have conditionId, question, currentProbability, volume24h, liquidityScore, and volumeRank fields.
**Validates: Requirements 4.4**

### Property 13: Momentum Score Bounds
*For any* successful analyzeMarketMomentum invocation, the momentum.score SHALL be within the range [-1, 1] inclusive.
**Validates: Requirements 5.3**

### Property 14: Momentum Output Schema
*For any* successful analyzeMarketMomentum invocation, the momentum object SHALL have score, direction (one of 'bullish', 'bearish', 'neutral'), strength (one of 'strong', 'moderate', 'weak'), and confidence (0-1) fields.
**Validates: Requirements 5.4, 5.5, 5.6**

### Property 15: Sentiment Shift Threshold
*For any* successful detectSentimentShifts invocation, all returned shifts SHALL have magnitude >= threshold parameter (default 0.05).
**Validates: Requirements 6.3**

### Property 16: Sentiment Shift Classification
*For any* detected sentiment shift, the classification SHALL be 'minor' when magnitude is 5-10%, 'moderate' when 10-20%, and 'major' when >20%.
**Validates: Requirements 6.4**

### Property 17: Sentiment Shift Output Schema
*For any* successful detectSentimentShifts invocation, all returned shifts SHALL have timeHorizon (one of '1h', '24h', '7d'), magnitude, direction, classification, and timestamp fields.
**Validates: Requirements 6.5, 6.6**

### Property 18: Agent Tool Usage Metadata
*For any* autonomous agent execution, the output metadata SHALL include toolUsage object with toolsCalled, totalToolTime, cacheHits, and cacheMisses fields.
**Validates: Requirements 7.6**

### Property 19: Cross-Market Alignment Bounds
*For any* agent output that includes crossMarketAlignment in metadata, the value SHALL be within the range [0, 1] inclusive.
**Validates: Requirements 9.5**

### Property 20: Cross-Market Sentiment Weighting
*For any* cross-market sentiment calculation, markets with higher volume24h SHALL have proportionally greater weight in the weighted average probability.
**Validates: Requirements 9.4**

### Property 21: Tool Error Audit Logging
*For any* tool invocation that fails, the audit trail SHALL contain an entry with the error field populated and success: false.
**Validates: Requirements 12.3**

### Property 22: Cache Statistics Logging
*For any* tool invocation, the audit entry SHALL include a cacheHit boolean field indicating whether the result was served from cache.
**Validates: Requirements 13.6, 16.4**

### Property 23: Tool Call Limit
*For any* autonomous agent execution, the total number of tool calls SHALL NOT exceed the configured maxToolCalls limit (default 5).
**Validates: Requirements 14.2**

### Property 24: Tool Execution Time Logging
*For any* agent execution, the audit log SHALL include separate timing for totalToolTime and total agent duration.
**Validates: Requirements 14.5**

### Property 25: Agent Signal Schema Compatibility
*For any* autonomous agent execution, the output SHALL conform to the AgentSignal schema used by the basic polling agent.
**Validates: Requirements 15.2**

### Property 26: Audit Summary Completeness
*For any* agent execution, the audit log entry SHALL include toolsCalled count and total tool execution time in the summary.
**Validates: Requirements 16.5, 16.6**

## Error Handling

### Tool Error Handling

Each tool implements consistent error handling:

```typescript
async function executeTool(input: any, context: ToolContext): Promise<any> {
  try {
    // Validate input against schema
    const validatedInput = toolSchema.parse(input);
    
    // Check rate limits
    if (!context.polymarketClient.canMakeRequest()) {
      await context.polymarketClient.waitForRateLimit();
    }
    
    // Check cache
    const cached = context.cache.get(toolName, validatedInput);
    if (cached) {
      context.auditLog.logCacheHit(toolName, validatedInput);
      return cached;
    }
    
    // Execute tool logic
    const result = await toolLogic(validatedInput, context);
    
    // Cache result
    context.cache.set(toolName, validatedInput, result);
    
    // Log success
    context.auditLog.logToolCall(toolName, validatedInput, result, duration);
    
    return result;
  } catch (error) {
    // Log error
    context.auditLog.logToolError(toolName, input, error, duration);
    
    // Return structured error
    return {
      error: true,
      message: error.message,
      toolName,
    };
  }
}
```

### Agent Error Handling

The agent node handles errors gracefully:

```typescript
try {
  // Execute agent with timeout
  const result = await Promise.race([
    agent.invoke(input, config),
    timeout(45000),
  ]);
  
  return createSuccessResponse(result);
} catch (error) {
  if (error instanceof TimeoutError) {
    // Log timeout warning but return partial results if available
    console.warn('[AutonomousPollingAgent] Execution timeout');
    return createTimeoutResponse(error);
  }
  
  // Return error signal
  return {
    agentErrors: [{
      type: 'EXECUTION_FAILED',
      agentName: 'autonomous_polling',
      error: error instanceof Error ? error : new Error('Unknown error'),
    }],
    auditLog: [{
      stage: 'agent_autonomous_polling',
      timestamp: Date.now(),
      data: {
        agentName: 'autonomous_polling',
        success: false,
        error: error.message,
        duration: Date.now() - startTime,
      },
    }],
  };
}
```

### Graceful Degradation

When tools fail, the agent continues with partial data:

1. **Non-critical tool failure**: Agent proceeds with available data, adjusts confidence downward
2. **Critical tool failure**: Agent falls back to basic analysis using MBD data only
3. **Multiple tool failures**: Agent includes tool failure summary in riskFactors
4. **Timeout**: Agent returns partial results with timeout warning

## Testing Strategy

### Unit Tests

Unit tests verify specific tool behaviors and edge cases:

**Tool Tests**:
1. **fetchRelatedMarkets**:
   - Test with valid conditionId returns related markets
   - Test with invalid conditionId returns empty array with warning
   - Test that input market is excluded from results
   - Test volume filtering (markets below threshold excluded)
   - Test with event containing no other markets

2. **fetchHistoricalPrices**:
   - Test with each valid time horizon ('1h', '24h', '7d', '30d')
   - Test with invalid time horizon returns validation error
   - Test returns at least 10 data points when available
   - Test calculates price change correctly
   - Test with market having no historical data

3. **fetchCrossMarketData**:
   - Test with valid eventId returns event data and markets
   - Test with invalid eventId returns error
   - Test limits results to maxMarkets parameter
   - Test calculates aggregate sentiment correctly
   - Test markets are sorted by volume

4. **analyzeMarketMomentum**:
   - Test momentum score is within [-1, 1]
   - Test direction classification (bullish/bearish/neutral)
   - Test strength classification (strong/moderate/weak)
   - Test confidence is within [0, 1]

5. **detectSentimentShifts**:
   - Test detects shifts above threshold
   - Test ignores movements below threshold
   - Test classifies magnitude correctly (minor/moderate/major)
   - Test identifies correct time horizon for each shift

**Cache Tests**:
1. Test cache hit on second identical call
2. Test cache miss on first call
3. Test cache isolation between sessions
4. Test cache statistics (hits/misses)

**Error Handling Tests**:
1. Test tool validation errors don't crash agent
2. Test API errors are caught and logged
3. Test agent continues with partial data when tools fail
4. Test timeout handling

### Property-Based Tests

Property-based tests verify universal properties using **fast-check**:

Each property test runs **minimum 100 iterations** with randomly generated inputs.

#### Test Configuration

```typescript
import fc from 'fast-check';
import { describe, it, expect } from 'vitest';

// Arbitraries for generating random inputs
const conditionIdArbitrary = fc.hexaString({ minLength: 64, maxLength: 64 });
const eventIdArbitrary = fc.uuid();
const timeHorizonArbitrary = fc.constantFrom('1h', '24h', '7d', '30d');
const thresholdArbitrary = fc.double({ min: 0, max: 0.2 });
```

#### Property Test Cases

1. **Property 1: Tool Input Validation**
   ```typescript
   fc.assert(
     fc.property(
       fc.record({
         conditionId: fc.string(), // Invalid format
         minVolume: fc.integer({ min: -100, max: -1 }), // Invalid value
       }),
       async (invalidInput) => {
         const result = await fetchRelatedMarkets(invalidInput, context);
         return result.error === true;
       }
     ),
     { numRuns: 100 }
   );
   ```
   **Tag**: `Feature: autonomous-polling-agent, Property 1: Tool Input Validation`

2. **Property 2: Tool Audit Logging Completeness**
   ```typescript
   fc.assert(
     fc.property(
       conditionIdArbitrary,
       async (conditionId) => {
         await fetchRelatedMarkets({ conditionId }, context);
         const auditEntry = context.auditLog.getLastEntry();
         return (
           typeof auditEntry.timestamp === 'number' &&
           auditEntry.toolName === 'fetchRelatedMarkets' &&
           typeof auditEntry.params === 'object' &&
           typeof auditEntry.duration === 'number' &&
           (auditEntry.result !== undefined || auditEntry.error !== undefined)
         );
       }
     ),
     { numRuns: 100 }
   );
   ```
   **Tag**: `Feature: autonomous-polling-agent, Property 2: Tool Audit Logging Completeness`

3. **Property 4: Tool Result Caching**
   ```typescript
   fc.assert(
     fc.property(
       conditionIdArbitrary,
       async (conditionId) => {
         const cache = new ToolCache('test-session');
         const context = { ...baseContext, cache };
         
         // First call
         const result1 = await fetchRelatedMarkets({ conditionId }, context);
         
         // Second call with same params
         const result2 = await fetchRelatedMarkets({ conditionId }, context);
         
         const stats = cache.getStats();
         return (
           JSON.stringify(result1) === JSON.stringify(result2) &&
           stats.hits === 1 &&
           stats.misses === 1
         );
       }
     ),
     { numRuns: 100 }
   );
   ```
   **Tag**: `Feature: autonomous-polling-agent, Property 4: Tool Result Caching`

4. **Property 5: Related Markets Exclusion**
   ```typescript
   fc.assert(
     fc.property(
       conditionIdArbitrary,
       async (conditionId) => {
         const result = await fetchRelatedMarkets({ conditionId }, context);
         if (result.error) return true; // Skip error cases
         return !result.markets.some(m => m.conditionId === conditionId);
       }
     ),
     { numRuns: 100 }
   );
   ```
   **Tag**: `Feature: autonomous-polling-agent, Property 5: Related Markets Exclusion`

5. **Property 7: Related Markets Volume Filter**
   ```typescript
   fc.assert(
     fc.property(
       conditionIdArbitrary,
       fc.integer({ min: 0, max: 1000 }),
       async (conditionId, minVolume) => {
         const result = await fetchRelatedMarkets({ conditionId, minVolume }, context);
         if (result.error) return true; // Skip error cases
         return result.markets.every(m => m.volume24h >= minVolume);
       }
     ),
     { numRuns: 100 }
   );
   ```
   **Tag**: `Feature: autonomous-polling-agent, Property 7: Related Markets Volume Filter`

6. **Property 13: Momentum Score Bounds**
   ```typescript
   fc.assert(
     fc.property(
       conditionIdArbitrary,
       async (conditionId) => {
         const result = await analyzeMarketMomentum({ conditionId }, context);
         if (result.error) return true; // Skip error cases
         return result.momentum.score >= -1 && result.momentum.score <= 1;
       }
     ),
     { numRuns: 100 }
   );
   ```
   **Tag**: `Feature: autonomous-polling-agent, Property 13: Momentum Score Bounds`

7. **Property 15: Sentiment Shift Threshold**
   ```typescript
   fc.assert(
     fc.property(
       conditionIdArbitrary,
       thresholdArbitrary,
       async (conditionId, threshold) => {
         const result = await detectSentimentShifts({ conditionId, threshold }, context);
         if (result.error) return true; // Skip error cases
         return result.shifts.every(shift => shift.magnitude >= threshold);
       }
     ),
     { numRuns: 100 }
   );
   ```
   **Tag**: `Feature: autonomous-polling-agent, Property 15: Sentiment Shift Threshold`

8. **Property 23: Tool Call Limit**
   ```typescript
   fc.assert(
     fc.property(
       fc.record({
         conditionId: conditionIdArbitrary,
         question: fc.string(),
         currentProbability: fc.double({ min: 0, max: 1 }),
       }),
       async (mbd) => {
         const state = { mbd, marketKeywords: null };
         const result = await autonomousPollingAgent(state);
         const toolsCalled = result.auditLog[0]?.data?.toolsCalled || 0;
         return toolsCalled <= 5; // Default maxToolCalls
       }
     ),
     { numRuns: 100 }
   );
   ```
   **Tag**: `Feature: autonomous-polling-agent, Property 23: Tool Call Limit`

### Integration Tests

Integration tests verify the agent works correctly with real LLMs and tools:

1. **Agent Tool Calling**:
   - Test agent successfully invokes tools
   - Test agent chains multiple tools together
   - Test agent synthesizes tool results in output

2. **Workflow Integration**:
   - Test autonomous agent integrates into existing workflow
   - Test agent signal reaches consensus engine
   - Test workflow completes successfully

3. **Real Data Tests**:
   - Test with real Polymarket events
   - Test cross-market analysis with actual related markets
   - Test historical price analysis with real market data

4. **Fallback Tests**:
   - Test fallback to basic mode when autonomous mode disabled
   - Test graceful degradation when tools fail
   - Test timeout handling with slow tools

### Test Organization

```
tradewizard-agents/
├── src/
│   ├── tools/
│   │   ├── polling-tools.ts              # Tool implementations
│   │   ├── polling-tools.test.ts         # Unit tests
│   │   └── polling-tools.property.test.ts # Property tests
│   ├── utils/
│   │   ├── tool-cache.ts                 # Cache implementation
│   │   └── tool-cache.test.ts            # Cache tests
│   └── nodes/
│       ├── autonomous-polling-agent.ts   # Agent implementation
│       ├── autonomous-polling-agent.test.ts # Unit tests
│       ├── autonomous-polling-agent.property.test.ts # Property tests
│       └── autonomous-polling-agent.integration.test.ts # Integration tests
```

### Coverage Goals

- **Unit tests**: 100% coverage of tool logic and error paths
- **Property tests**: 100% coverage of correctness properties
- **Integration tests**: End-to-end agent execution with tools
- **Minimum iterations**: 100 per property test

## Implementation Notes

### File Structure

**New Files**:
1. `src/tools/polling-tools.ts` - Tool implementations
2. `src/tools/index.ts` - Tool exports
3. `src/utils/tool-cache.ts` - Caching utility
4. `src/nodes/autonomous-polling-agent.ts` - Agent node
5. `src/config/polling-agent-config.ts` - Agent configuration

**Modified Files**:
1. `src/workflow.ts` - Add autonomous polling agent node
2. `src/nodes/index.ts` - Export autonomous polling agent
3. `src/config/index.ts` - Add polling agent config

### Dependencies

**New Dependencies**:
- `@langchain/langgraph/prebuilt` - For createReactAgent (already installed)
- `@langchain/core/tools` - For StructuredTool (already installed)

**No new external dependencies required** - all needed packages are already in the project.

### Configuration Schema

```typescript
interface PollingAgentConfig {
  autonomous: boolean;        // Enable autonomous mode
  maxToolCalls: number;       // Max tools per analysis (default: 5)
  timeout: number;            // Timeout in ms (default: 45000)
  cacheEnabled: boolean;      // Enable result caching (default: true)
  fallbackToBasic: boolean;   // Fallback to basic mode on error (default: true)
}
```

### Deployment Considerations

- **Feature Flag**: Autonomous mode controlled by config flag
- **Backward Compatible**: Existing polling agent continues to work
- **Gradual Rollout**: Can enable autonomous mode for subset of markets
- **Monitoring**: Tool usage metrics logged for analysis
- **Performance**: 45-second timeout ensures acceptable latency
- **Cost**: Tool calls increase API usage but improve analysis quality

### Performance Optimization

1. **Parallel Tool Execution**: Execute independent tools in parallel
2. **Caching**: Cache tool results within analysis session
3. **Rate Limiting**: Respect Polymarket API rate limits
4. **Tool Prioritization**: Agent learns to prioritize high-value tools
5. **Timeout Handling**: Graceful degradation on timeout

### Security Considerations

1. **Input Validation**: All tool inputs validated against schemas
2. **Rate Limiting**: Prevent API abuse through rate limiting
3. **Error Sanitization**: Don't expose internal errors to agent
4. **Audit Logging**: All tool calls logged for security review
5. **Resource Limits**: Tool call limit prevents runaway execution
