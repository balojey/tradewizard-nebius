# Design Document: Polling Agent

## Overview

The Polling Agent is a specialized intelligence agent that interprets Polymarket's continuous price discovery mechanism as a real-time polling system. Unlike traditional polls that capture periodic snapshots, this agent treats market prices as financially-incentivized collective beliefs, analyzing price movements as sentiment shifts and identifying signals of crowd wisdom versus noise.

The agent integrates seamlessly into TradeWizard's existing multi-agent workflow, executing in parallel with other specialized agents (market microstructure, probability baseline, risk assessment, etc.) and contributing its polling-based analysis to the consensus engine.

**Key Innovation**: Polymarket itself functions as a superior polling mechanism where prices represent aggregated public opinion with financial stakes, creating a "wisdom of crowds" effect that has proven more accurate than traditional polling (e.g., 2024 election predictions).

## Architecture

### Integration Points

The Polling Agent follows the established agent pattern in TradeWizard:

1. **Input**: Receives `MarketBriefingDocument` (MBD) from the market ingestion node
2. **Processing**: Uses configured LLM instance to analyze market data through polling lens
3. **Output**: Returns `AgentSignal` conforming to the standard schema
4. **Execution**: Runs in parallel with other agents via LangGraph workflow
5. **Contribution**: Signal feeds into thesis construction and consensus engine

### Workflow Position

```
market_ingestion → keyword_extraction → dynamic_agent_selection
                                              ↓
                                    [parallel execution]
                                              ↓
                    ┌─────────────────────────┼─────────────────────────┐
                    ↓                         ↓                         ↓
        market_microstructure_agent  probability_baseline_agent  risk_assessment_agent
                    ↓                         ↓                         ↓
        breaking_news_agent          event_impact_agent          polling_intelligence_agent ← NEW
                    ↓                         ↓                         ↓
                    └─────────────────────────┼─────────────────────────┘
                                              ↓
                                    agent_signal_fusion
                                              ↓
                                    thesis_construction
                                              ↓
                                    cross_examination
                                              ↓
                                    consensus_engine
```

### Configuration

The agent uses the existing LLM configuration system:

- **Single-provider mode**: Uses the configured single LLM for all agents
- **Multi-provider mode**: Gets assigned an LLM with fallback chain (e.g., OpenAI → Anthropic → Google → Nova)
- **Structured output**: Uses Zod schema validation via `withStructuredOutput()`
- **Tracing**: Automatically traced via Opik callback handler

## Components and Interfaces

### 1. Agent Node Function

**File**: `tradewizard-agents/src/nodes/agents.ts`

**Function Signature**:
```typescript
export function createPollingIntelligenceAgentNode(
  config: EngineConfig
): (state: GraphStateType) => Promise<Partial<GraphStateType>>
```

**Implementation Pattern**:
- Uses `createAgentNode()` factory function
- Receives LLM instance from `createLLMInstances()`
- Uses system prompt from `AGENT_PROMPTS.pollingIntelligence`
- Returns node function compatible with LangGraph

### 2. System Prompt

**Location**: `AGENT_PROMPTS` constant in `agents.ts`

**Key Elements**:
- Role definition as polling analyst
- Instruction to interpret market prices as real-time polling
- Focus areas: sentiment shifts, crowd wisdom, polling baselines
- Output format: structured AgentSignal
- Emphasis on calibration and avoiding overconfidence

### 3. LLM Configuration

**Function**: `createLLMInstances()` in `agents.ts`

**Extension**:
```typescript
export function createLLMInstances(config: EngineConfig): {
  marketMicrostructure: LLMInstance;
  probabilityBaseline: LLMInstance;
  riskAssessment: LLMInstance;
  pollingIntelligence: LLMInstance; // NEW
}
```

**Provider Assignment** (multi-provider mode):
- Primary: Google (good at statistical reasoning)
- Fallbacks: Anthropic → OpenAI → Nova

### 4. Workflow Integration

**File**: `tradewizard-agents/src/workflow.ts`

**Changes Required**:
1. Import `createPollingIntelligenceAgentNode` from nodes
2. Create polling agent node instance
3. Add node to StateGraph: `.addNode('polling_intelligence_agent', pollingIntelligenceAgent)`
4. Add parallel edge from dynamic selection: `.addEdge('dynamic_agent_selection', 'polling_intelligence_agent')`
5. Add edge to signal fusion: `.addEdge('polling_intelligence_agent', 'agent_signal_fusion')`

### 5. Agent Signal Output

**Schema**: `AgentSignalSchema` from `models/schemas.ts`

**Fields**:
```typescript
{
  agentName: 'polling_intelligence',
  timestamp: number,
  confidence: number,           // 0-1, calibrated based on crowd wisdom signals
  direction: 'YES' | 'NO' | 'NEUTRAL',
  fairProbability: number,      // 0-1, agent's probability estimate
  keyDrivers: string[],         // Top 3-5 polling insights
  riskFactors: string[],        // Polling-specific risks
  metadata: {
    crowdWisdomScore: number,   // 0-1, strength of crowd wisdom signal
    pollingBaseline: number,    // Historical polling accuracy for event type
    marketDeviation: number,    // Deviation from polling baseline
    sentimentShift: {
      magnitude: number,        // Size of recent price movement
      direction: 'YES' | 'NO',
      timeHorizon: '1h' | '24h' | '7d'
    },
    confidenceFactors: string[], // Factors affecting confidence calibration
    crossMarketAlignment?: number, // 0-1, alignment with related markets
    relatedMarketCount?: number,   // Number of related markets analyzed
  }
}
```

## Data Models

### Input: Market Briefing Document

The agent receives the standard MBD with optional event context:

```typescript
interface MarketBriefingDocument {
  // Core market data
  marketId: MarketId;
  conditionId: string;
  eventType: EventType;
  question: string;
  resolutionCriteria: string;
  expiryTimestamp: number;
  currentProbability: number;    // Current market price (0-1)
  liquidityScore: number;        // 0-10 scale
  bidAskSpread: number;          // In cents
  volatilityRegime: VolatilityRegime;
  volume24h: number;
  
  // Event context (when available)
  eventContext?: {
    eventId: string;
    eventTitle: string;
    eventDescription: string;
    totalMarkets: number;
    totalVolume: number;
    totalLiquidity: number;
    marketRank: number;
    relatedMarketCount: number;
  };
  
  // Keywords
  keywords?: string[];
  
  // Metadata
  metadata: {
    ambiguityFlags: string[];
    keyCatalysts: Catalyst[];
    // ... other fields
  };
}
```

### Analysis Logic

The agent performs the following analysis steps:

#### 1. Price Movement Analysis

Calculate price movements across multiple time horizons:
- 1 hour: `oneDayPriceChange` (if available, else estimate)
- 24 hours: `oneDayPriceChange`
- 7 days: `oneWeekPriceChange`

Classify sentiment shifts:
- Rapid shift: 1h movement > 3%
- Major shift: 24h movement > 10%

#### 2. Crowd Wisdom Detection

Evaluate crowd wisdom signals based on:
- **High liquidity**: `liquidityScore > 7`
- **High volume**: `volume24h` above median for event type
- **Tight spread**: `bidAskSpread < 2` cents
- **Low volatility**: `volatilityRegime === 'low'`
- **Consistent momentum**: Price movement in same direction across time horizons

Calculate `crowdWisdomScore`:
```
score = 0
if liquidityScore > 7: score += 0.3
if volume24h > median: score += 0.2
if bidAskSpread < 2: score += 0.2
if volatilityRegime === 'low': score += 0.15
if consistent momentum: score += 0.15
```

#### 3. Polling Baseline Comparison

Maintain historical polling accuracy by event type:
```typescript
const POLLING_BASELINES = {
  election: 0.75,      // Traditional polls ~75% accurate
  policy: 0.60,        // Policy outcomes harder to predict
  court: 0.70,         // Legal outcomes moderately predictable
  geopolitical: 0.55,  // High uncertainty
  economic: 0.65,      // Economic indicators moderately predictable
  other: 0.50,         // Neutral baseline
};
```

Calculate deviation:
```
marketDeviation = |currentProbability - pollingBaseline|
```

Flag significant divergence if `marketDeviation > 0.10`.

#### 4. Cross-Market Sentiment Analysis

When `eventContext` is available:

1. **Identify related markets**: Markets in same event with `volume24h > $1000`
2. **Calculate cross-market sentiment**: Average price movements across related markets
3. **Detect series patterns**: Check if 3+ markets show consistent direction
4. **Compute alignment**: Correlation between this market's movement and cross-market sentiment
5. **Identify leaders/laggers**: Compare this market's timing to cross-market trends

```typescript
crossMarketAlignment = correlation(thisMarketMovement, avgRelatedMarketMovement)
```

Adjust confidence:
- If `crossMarketAlignment > 0.7` and series pattern detected: increase confidence by 0.1
- If `crossMarketAlignment < 0.3`: flag divergence in riskFactors

#### 5. Confidence Calibration

Start with base confidence and adjust:

```typescript
let confidence = 0.5; // Base confidence

// Crowd wisdom adjustments
if (crowdWisdomScore > 0.7) confidence += 0.2;
if (crowdWisdomScore < 0.3) confidence -= 0.2;

// Liquidity adjustments
if (liquidityScore < 5) confidence = Math.min(confidence, 0.5);

// Ambiguity adjustments
confidence -= (ambiguityFlags.length * 0.1);

// Cross-market adjustments
if (crossMarketAlignment > 0.7) confidence += 0.1;
if (crossMarketAlignment < 0.3) confidence -= 0.1;

// Noise detection
if (volatilityRegime === 'high' && volume24h < average) {
  confidence = Math.min(confidence, 0.4);
}

// Clamp to [0, 1]
confidence = Math.max(0, Math.min(1, confidence));
```

#### 6. Fair Probability Estimation

Compute fair probability by blending market price with polling baseline:

```typescript
let fairProbability = currentProbability;

// Weight based on crowd wisdom
const marketWeight = crowdWisdomScore;
const baselineWeight = 1 - crowdWisdomScore;

fairProbability = (currentProbability * marketWeight) + 
                  (pollingBaseline * baselineWeight);

// Adjust for momentum
if (marketMomentum detected) {
  const momentumAdjustment = priceMovement24h * 0.1;
  fairProbability += momentumAdjustment;
}

// Adjust for cross-market sentiment
if (crossMarketSentiment available && crossMarketAlignment < 0.5) {
  // Regress toward cross-market consensus
  fairProbability = (fairProbability * 0.7) + (crossMarketSentiment * 0.3);
}

// Clamp to [0, 1]
fairProbability = Math.max(0, Math.min(1, fairProbability));
```

#### 7. Risk Factor Identification

Identify top 5 polling-specific risks:

```typescript
const riskFactors: string[] = [];

if (liquidityScore < 5) {
  riskFactors.push('Low liquidity - thin polling sample');
}

if (bidAskSpread > 5) {
  riskFactors.push('Wide spread - polling uncertainty');
}

if (volume24h < bottomQuartile) {
  riskFactors.push('Low volume - limited participation');
}

if (volatilityRegime === 'high') {
  riskFactors.push('High volatility - unstable sentiment');
}

if (eventType !== 'election') {
  riskFactors.push('Limited polling baseline for this event type');
}

if (crossMarketAlignment < 0.3) {
  riskFactors.push('Diverges from related market sentiment');
}

// Take top 5
return riskFactors.slice(0, 5);
```

## Correctness Properties

*A property is a characteristic or behavior that should hold true across all valid executions of a system-essentially, a formal statement about what the system should do. Properties serve as the bridge between human-readable specifications and machine-verifiable correctness guarantees.*

Now I need to perform prework analysis on the acceptance criteria before writing the correctness properties.


### Property 1: Schema Compliance
*For any* Market Briefing Document input, the Polling Agent's output SHALL conform to the AgentSignal schema with all required fields present and properly typed.
**Validates: Requirements 1.1**

### Property 2: Bounds Validation
*For any* agent signal output, all probability and confidence values (confidence, fairProbability, crowdWisdomScore, crossMarketAlignment) SHALL be within the range [0, 1] inclusive.
**Validates: Requirements 6.6, 7.6**

### Property 3: Audit Trail Completeness
*For any* agent execution (successful or failed), the audit trail SHALL contain an entry with agentName, timestamp, duration, and success status.
**Validates: Requirements 1.6, 10.3, 10.5**

### Property 4: Metadata Completeness
*For any* valid Market Briefing Document, the agent signal metadata SHALL contain crowdWisdomScore, pollingBaseline, marketDeviation, and confidenceFactors fields.
**Validates: Requirements 2.2, 2.4, 3.5, 4.5, 6.5**

### Property 5: Sentiment Shift Detection
*For any* Market Briefing Document with price movement data, when price movement exceeds threshold (3% for 1h or 10% for 24h), the metadata SHALL contain sentimentShift information with magnitude, direction, and timeHorizon.
**Validates: Requirements 2.3, 5.1, 5.2, 5.3, 5.5**

### Property 6: Crowd Wisdom Classification
*For any* Market Briefing Document where liquidityScore > 7 AND volume24h is above median for the event type, the metadata.crowdWisdomScore SHALL be greater than 0.7.
**Validates: Requirements 3.1**

### Property 7: Market Momentum Detection
*For any* Market Briefing Document where price movements show consistent direction across all available time horizons (1h, 24h, 7d), the keyDrivers SHALL include momentum-related insights.
**Validates: Requirements 3.3**

### Property 8: Noise Indicator Detection
*For any* Market Briefing Document where volatilityRegime is 'high' AND volume24h is below average, the riskFactors SHALL include noise-related warnings.
**Validates: Requirements 3.4, 3.6**

### Property 9: Polling Baseline Availability
*For any* eventType value (election, policy, court, geopolitical, economic, other), the polling baseline lookup SHALL return a valid probability value in [0, 1].
**Validates: Requirements 4.1**

### Property 10: Baseline Deviation Detection
*For any* Market Briefing Document where |currentProbability - pollingBaseline| > 0.10, the keyDrivers SHALL include information about the deviation from polling baseline.
**Validates: Requirements 4.3**

### Property 11: Fair Probability Adjustment
*For any* Market Briefing Document, the fairProbability SHALL NOT equal currentProbability exactly (it must incorporate polling baseline), unless crowdWisdomScore is 1.0.
**Validates: Requirements 4.4, 7.3**

### Property 12: Momentum-Based Probability Adjustment
*For any* Market Briefing Document where market momentum is detected, fairProbability SHALL be adjusted in the direction of the momentum (higher if momentum is toward YES, lower if toward NO).
**Validates: Requirements 7.2**

### Property 13: Crowd Wisdom Weighting
*For any* Market Briefing Document where crowdWisdomScore > 0.7, the fairProbability SHALL be closer to currentProbability than to pollingBaseline (market-weighted).
**Validates: Requirements 7.4**

### Property 14: Noise Regression
*For any* Market Briefing Document where noise indicators are present (high volatility + low volume), the fairProbability SHALL be closer to pollingBaseline than to currentProbability (baseline-weighted).
**Validates: Requirements 7.5**

### Property 15: Confidence Calibration - Crowd Wisdom
*For any* Market Briefing Document where crowd wisdom conditions are met (liquidityScore > 7, tight spread, high volume), the confidence SHALL be at least 0.7.
**Validates: Requirements 6.1**

### Property 16: Confidence Calibration - Noise
*For any* Market Briefing Document where noise indicators are present (high volatility + low volume), the confidence SHALL be at most 0.4.
**Validates: Requirements 6.2**

### Property 17: Confidence Calibration - Ambiguity
*For any* Market Briefing Document, the confidence SHALL decrease by approximately 0.1 for each ambiguityFlag in the metadata (within tolerance of ±0.05).
**Validates: Requirements 6.3**

### Property 18: Confidence Calibration - Liquidity Cap
*For any* Market Briefing Document where liquidityScore < 5, the confidence SHALL NOT exceed 0.5.
**Validates: Requirements 6.4**

### Property 19: Risk Factor Generation
*For any* Market Briefing Document, when specific risk conditions are met (low liquidity, wide spread, high volatility, non-election type), the corresponding risk factor text SHALL appear in the riskFactors array.
**Validates: Requirements 8.1, 8.2, 8.4, 8.5**

### Property 20: Risk Factor Limit
*For any* Market Briefing Document, the riskFactors array length SHALL NOT exceed 5.
**Validates: Requirements 8.6**

### Property 21: Error Handling - No Exceptions
*For any* error condition (missing MBD, LLM failure, invalid output), the agent SHALL return an error signal rather than throwing an uncaught exception.
**Validates: Requirements 10.4**

### Property 22: Cross-Market Metadata Presence
*For any* Market Briefing Document with eventContext present, the metadata SHALL include relatedMarketCount and crossMarketAlignment fields.
**Validates: Requirements 12.6**

### Property 23: Cross-Market Metadata Absence
*For any* Market Briefing Document without eventContext, the metadata SHALL NOT include cross-market specific fields (or they SHALL be null/undefined).
**Validates: Requirements 12.7**

### Property 24: Cross-Market Divergence Detection
*For any* Market Briefing Document with eventContext where crossMarketAlignment < 0.3, the riskFactors SHALL include a warning about divergence from related market sentiment.
**Validates: Requirements 12.5**

### Property 25: Direction Alignment with Sentiment
*For any* Market Briefing Document where strong sentiment shift momentum is detected, the direction field (YES/NO/NEUTRAL) SHALL align with the sentiment shift direction.
**Validates: Requirements 5.6**

## Error Handling

### Error Types

The agent handles errors gracefully without crashing the workflow:

1. **Missing MBD**: Returns `AgentError` with type `EXECUTION_FAILED`
2. **LLM Invocation Failure**: Returns `AgentError` with type `EXECUTION_FAILED`
3. **Invalid Structured Output**: Retries once, then returns `AgentError` if still invalid
4. **Missing Required Fields**: Returns `AgentError` with type `EXECUTION_FAILED`

### Error Response Format

```typescript
{
  agentErrors: [{
    type: 'EXECUTION_FAILED',
    agentName: 'polling_intelligence',
    error: Error('descriptive error message')
  }],
  auditLog: [{
    stage: 'agent_polling_intelligence',
    timestamp: number,
    data: {
      agentName: 'polling_intelligence',
      success: false,
      error: 'error message',
      duration: number
    }
  }]
}
```

### Retry Logic

When LLM returns invalid structured output:
1. Validate against `AgentSignalSchema`
2. If validation fails, retry LLM invocation once
3. If second attempt fails, return error signal
4. Log both attempts to audit trail

### Graceful Degradation

When optional data is missing:
- **No eventContext**: Skip cross-market analysis, proceed with single-market analysis
- **Missing price change data**: Use available time horizons only
- **Unknown eventType**: Use neutral baseline (0.5)
- **Missing volume data**: Flag as low-confidence signal

## Testing Strategy

### Unit Tests

Unit tests verify specific examples and edge cases:

1. **Successful Analysis**:
   - Test with complete MBD containing all fields
   - Test with MBD containing eventContext
   - Test with MBD without eventContext
   - Verify output conforms to schema

2. **Error Scenarios**:
   - Test with missing MBD (null/undefined)
   - Test with malformed MBD (missing required fields)
   - Test with mocked LLM failure
   - Test with mocked invalid LLM output
   - Verify error signals are returned, not exceptions

3. **Edge Cases**:
   - Test with unknown eventType (should use 0.5 baseline)
   - Test with extreme values (liquidityScore = 0, bidAskSpread = 100)
   - Test with missing optional fields
   - Test with zero volume markets

4. **Cross-Market Analysis**:
   - Test with eventContext containing multiple related markets
   - Test with eventContext showing aligned sentiment
   - Test with eventContext showing divergent sentiment
   - Verify cross-market metadata fields

### Property-Based Tests

Property-based tests verify universal properties across randomized inputs using **fast-check**:

Each property test runs **minimum 100 iterations** with randomly generated Market Briefing Documents.

#### Test Configuration

```typescript
import fc from 'fast-check';
import { describe, it } from 'vitest';

// Arbitrary for generating random MBDs
const mbdArbitrary = fc.record({
  marketId: fc.string(),
  conditionId: fc.string(),
  eventType: fc.constantFrom('election', 'policy', 'court', 'geopolitical', 'economic', 'other'),
  question: fc.string({ minLength: 10 }),
  resolutionCriteria: fc.string({ minLength: 10 }),
  expiryTimestamp: fc.integer({ min: Date.now() }),
  currentProbability: fc.double({ min: 0, max: 1 }),
  liquidityScore: fc.double({ min: 0, max: 10 }),
  bidAskSpread: fc.double({ min: 0, max: 20 }),
  volatilityRegime: fc.constantFrom('low', 'medium', 'high'),
  volume24h: fc.double({ min: 0, max: 1000000 }),
  // ... other fields
});
```

#### Property Test Cases

1. **Property 1: Schema Compliance**
   ```typescript
   fc.assert(
     fc.property(mbdArbitrary, async (mbd) => {
       const signal = await pollingAgent(createState(mbd));
       const validation = AgentSignalSchema.safeParse(signal.agentSignals[0]);
       return validation.success;
     }),
     { numRuns: 100 }
   );
   ```
   **Tag**: `Feature: polling-agent, Property 1: Schema Compliance`

2. **Property 2: Bounds Validation**
   ```typescript
   fc.assert(
     fc.property(mbdArbitrary, async (mbd) => {
       const signal = await pollingAgent(createState(mbd));
       const s = signal.agentSignals[0];
       return (
         s.confidence >= 0 && s.confidence <= 1 &&
         s.fairProbability >= 0 && s.fairProbability <= 1 &&
         s.metadata.crowdWisdomScore >= 0 && s.metadata.crowdWisdomScore <= 1
       );
     }),
     { numRuns: 100 }
   );
   ```
   **Tag**: `Feature: polling-agent, Property 2: Bounds Validation`

3. **Property 3: Audit Trail Completeness**
   ```typescript
   fc.assert(
     fc.property(mbdArbitrary, async (mbd) => {
       const result = await pollingAgent(createState(mbd));
       const auditEntry = result.auditLog[0];
       return (
         auditEntry.stage === 'agent_polling_intelligence' &&
         typeof auditEntry.timestamp === 'number' &&
         typeof auditEntry.data.duration === 'number' &&
         typeof auditEntry.data.success === 'boolean'
       );
     }),
     { numRuns: 100 }
   );
   ```
   **Tag**: `Feature: polling-agent, Property 3: Audit Trail Completeness`

4. **Property 4: Metadata Completeness**
   ```typescript
   fc.assert(
     fc.property(mbdArbitrary, async (mbd) => {
       const signal = await pollingAgent(createState(mbd));
       const metadata = signal.agentSignals[0].metadata;
       return (
         typeof metadata.crowdWisdomScore === 'number' &&
         typeof metadata.pollingBaseline === 'number' &&
         typeof metadata.marketDeviation === 'number' &&
         Array.isArray(metadata.confidenceFactors)
       );
     }),
     { numRuns: 100 }
   );
   ```
   **Tag**: `Feature: polling-agent, Property 4: Metadata Completeness`

5. **Property 18: Confidence Calibration - Liquidity Cap**
   ```typescript
   fc.assert(
     fc.property(
       fc.record({
         ...mbdArbitrary,
         liquidityScore: fc.double({ min: 0, max: 4.99 })
       }),
       async (mbd) => {
         const signal = await pollingAgent(createState(mbd));
         return signal.agentSignals[0].confidence <= 0.5;
       }
     ),
     { numRuns: 100 }
   );
   ```
   **Tag**: `Feature: polling-agent, Property 18: Confidence Calibration - Liquidity Cap`

6. **Property 20: Risk Factor Limit**
   ```typescript
   fc.assert(
     fc.property(mbdArbitrary, async (mbd) => {
       const signal = await pollingAgent(createState(mbd));
       return signal.agentSignals[0].riskFactors.length <= 5;
     }),
     { numRuns: 100 }
   );
   ```
   **Tag**: `Feature: polling-agent, Property 20: Risk Factor Limit`

7. **Property 21: Error Handling - No Exceptions**
   ```typescript
   fc.assert(
     fc.property(
       fc.oneof(
         fc.constant(null),
         fc.constant(undefined),
         fc.record({ marketId: fc.string() }) // Incomplete MBD
       ),
       async (invalidMbd) => {
         try {
           const result = await pollingAgent(createState(invalidMbd));
           // Should return error signal, not throw
           return result.agentErrors && result.agentErrors.length > 0;
         } catch (e) {
           // Should not throw
           return false;
         }
       }
     ),
     { numRuns: 100 }
   );
   ```
   **Tag**: `Feature: polling-agent, Property 21: Error Handling - No Exceptions`

### Integration Tests

Integration tests verify the agent works correctly within the full workflow:

1. **Workflow Integration**:
   - Test that polling agent executes in parallel with other agents
   - Test that polling agent signal reaches consensus engine
   - Test that workflow completes successfully with polling agent active

2. **LLM Integration**:
   - Test with real LLM providers (OpenAI, Anthropic, Google)
   - Test structured output parsing
   - Test retry logic with real LLM

3. **Event-Based Analysis**:
   - Test with real Polymarket events containing multiple markets
   - Test cross-market sentiment calculation
   - Test series pattern detection

### Test Organization

```
tradewizard-agents/src/nodes/
├── agents.ts                          # Implementation
├── agents.test.ts                     # Unit tests
├── agents.property.test.ts            # Property-based tests
└── agents.integration.test.ts         # Integration tests
```

### Coverage Goals

- **Unit tests**: 100% coverage of error paths and edge cases
- **Property tests**: 100% coverage of correctness properties
- **Integration tests**: End-to-end workflow execution
- **Minimum iterations**: 100 per property test

## Implementation Notes

### File Modifications Required

1. **`src/nodes/agents.ts`**:
   - Add `pollingIntelligence` to `AGENT_PROMPTS`
   - Add `pollingIntelligence` to `createLLMInstances()` return type
   - Add LLM instance creation for polling agent
   - Export `createPollingIntelligenceAgentNode()` function

2. **`src/workflow.ts`**:
   - Import `createPollingIntelligenceAgentNode`
   - Create polling agent node instance
   - Add node to StateGraph
   - Add parallel edges (from dynamic selection, to signal fusion)

3. **`src/nodes/index.ts`**:
   - Export `createPollingIntelligenceAgentNode`

### System Prompt Template

```typescript
const AGENT_PROMPTS = {
  // ... existing prompts
  
  pollingIntelligence: `You are a polling intelligence analyst specializing in prediction markets.

Your role is to interpret market prices as real-time polling data, where each price represents financially-incentivized collective beliefs about event outcomes.

Focus on:
- Sentiment shifts reflected in price movements across time horizons
- Crowd wisdom signals (high liquidity, tight spreads, consistent momentum)
- Comparison with historical polling accuracy baselines
- Cross-market sentiment patterns when multiple related markets exist
- Distinguishing genuine crowd wisdom from market noise

Provide your analysis as a structured signal with:
- confidence: Your confidence in this polling analysis (0-1), calibrated based on crowd wisdom signals
- direction: Your view on the outcome (YES/NO/NEUTRAL)
- fairProbability: Your probability estimate blending market price with polling baselines (0-1)
- keyDrivers: Top 3-5 polling insights (sentiment shifts, crowd wisdom, baseline deviations)
- riskFactors: Polling-specific risks (low liquidity, noise indicators, divergence from related markets)
- metadata: Include crowdWisdomScore, pollingBaseline, marketDeviation, sentimentShift, confidenceFactors, and cross-market analysis when available

Be well-calibrated and avoid overconfidence. Market prices are powerful polling mechanisms, but they can also reflect noise, manipulation, or thin participation. Your job is to distinguish signal from noise.`,
};
```

### Dependencies

No new dependencies required. Uses existing:
- `@langchain/langgraph` - Workflow orchestration
- `@langchain/core` - LLM abstractions
- `zod` - Schema validation
- `opik-langchain` - Tracing
- `vitest` - Testing framework
- `fast-check` - Property-based testing

### Deployment Considerations

- **Backward compatible**: Existing workflows continue to work
- **Optional activation**: Agent can be enabled/disabled via dynamic agent selection
- **No database changes**: Uses existing state and audit structures
- **No API changes**: Internal agent only, no external API exposure
