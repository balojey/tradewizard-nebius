# Design Document

## Overview

The Market Intelligence Engine is a multi-agent system that transforms raw prediction market data into explainable, probability-driven trade recommendations. The system follows a structured debate protocol where specialized AI agents independently analyze markets, construct competing theses, challenge each other's assumptions, and reach consensus on fair probability estimates.

The architecture is designed around three core principles:

1. **Adversarial Reasoning** - Multiple agents with different perspectives prevent groupthink and expose weak assumptions
2. **Explainability First** - Every recommendation traces back to specific data signals and agent reasoning
3. **Graceful Degradation** - Partial failures in any component do not crash the entire pipeline

The system operates as a continuous intelligence loop: ingest market data → analyze through agent debate → generate recommendations → log for learning.

## Architecture

The Market Intelligence Engine is built on **LangGraph**, a framework for building stateful, multi-agent workflows. The system is implemented as a LangGraph StateGraph where each pipeline stage is a node, and the debate protocol is encoded as edges between nodes.

```
┌─────────────────┐
│  Polymarket API │
└────────┬────────┘
         │
         ▼
┌─────────────────────────────────────────────────────────────┐
│              LANGGRAPH STATE GRAPH WORKFLOW                  │
│                                                               │
│  ┌──────────────────────────────────────────────────────┐  │
│  │ Node: Market Ingestion                               │  │
│  │ - Fetch market data from Polymarket APIs             │  │
│  │ - Transform into Market Briefing Document (MBD)      │  │
│  │ - Update graph state with MBD                        │  │
│  └──────────────────┬───────────────────────────────────┘  │
│                     │                                        │
│                     ▼                                        │
│  ┌──────────────────────────────────────────────────────┐  │
│  │ Parallel Nodes: Intelligence Agents                  │  │
│  │ - Market Microstructure Agent                        │  │
│  │ - Probability Baseline Agent                         │  │
│  │ - Risk Assessment Agent                              │  │
│  │ - Each agent reads MBD from state                    │  │
│  │ - Each agent writes signal to state                  │  │
│  └──────────────────┬───────────────────────────────────┘  │
│                     │                                        │
│                     ▼                                        │
│  ┌──────────────────────────────────────────────────────┐  │
│  │ Node: Thesis Construction                            │  │
│  │ - Read agent signals from state                      │  │
│  │ - Generate bull and bear theses                      │  │
│  │ - Write theses to state                              │  │
│  └──────────────────┬───────────────────────────────────┘  │
│                     │                                        │
│                     ▼                                        │
│  ┌──────────────────────────────────────────────────────┐  │
│  │ Node: Cross-Examination                              │  │
│  │ - Read theses from state                             │  │
│  │ - Execute debate tests                               │  │
│  │ - Write debate record to state                       │  │
│  └──────────────────┬───────────────────────────────────┘  │
│                     │                                        │
│                     ▼                                        │
│  ┌──────────────────────────────────────────────────────┐  │
│  │ Node: Consensus Engine                               │  │
│  │ - Read debate record and signals from state          │  │
│  │ - Calculate consensus probability                    │  │
│  │ - Write consensus to state                           │  │
│  └──────────────────┬───────────────────────────────────┘  │
│                     │                                        │
│                     ▼                                        │
│  ┌──────────────────────────────────────────────────────┐  │
│  │ Node: Recommendation Generation                      │  │
│  │ - Read consensus and theses from state               │  │
│  │ - Generate trade recommendation                      │  │
│  │ - Write recommendation to state                      │  │
│  └──────────────────┬───────────────────────────────────┘  │
│                     │                                        │
└─────────────────────┼────────────────────────────────────────┘
                      │
                      ▼
              ┌───────────────┐
              │ Trade Output  │
              └───────────────┘
```

### Key Architectural Decisions

**1. LangGraph StateGraph over Custom Pipeline**
- LangGraph manages state flow between nodes automatically
- Built-in support for parallel node execution (agents)
- Native debugging and visualization tools
- Reduces custom orchestration code by ~70%

**2. Graph State as Single Source of Truth**
- All data flows through a typed GraphState object
- Each node reads from and writes to state
- Enables easy debugging and state inspection
- Simplifies error handling and recovery

**3. LangGraph's Built-in LLM Integration**
- Use ChatOpenAI, ChatAnthropic, ChatGoogleGenerativeAI from LangChain
- Automatic retry logic and rate limiting
- Structured output support via `with_structured_output()`
- No need for custom LLM abstraction layer

**4. Conditional Edges for Error Handling**
- Use LangGraph conditional edges to route on errors
- Graceful degradation through alternate paths
- Retry logic encoded in graph structure

**5. Checkpointing for Audit Trail**
- LangGraph's built-in checkpointing provides automatic audit trail
- Every state transition is logged
- Easy to replay and debug workflows

## Components and Interfaces

### 0. LangGraph State Definition

**Responsibility**: Define the shared state that flows through the entire workflow

**Schema**:
```typescript
import { Annotation } from "@langchain/langgraph";

// Define the graph state using LangGraph's Annotation API
const GraphState = Annotation.Root({
  // Input
  conditionId: Annotation<string>,
  
  // Market Ingestion Output
  mbd: Annotation<MarketBriefingDocument | null>,
  ingestionError: Annotation<IngestionError | null>,
  
  // Agent Signals Output
  agentSignals: Annotation<AgentSignal[]>({
    reducer: (current, update) => [...current, ...update],
    default: () => []
  }),
  agentErrors: Annotation<AgentError[]>({
    reducer: (current, update) => [...current, ...update],
    default: () => []
  }),
  
  // Thesis Construction Output
  bullThesis: Annotation<Thesis | null>,
  bearThesis: Annotation<Thesis | null>,
  
  // Cross-Examination Output
  debateRecord: Annotation<DebateRecord | null>,
  
  // Consensus Output
  consensus: Annotation<ConsensusProbability | null>,
  consensusError: Annotation<RecommendationError | null>,
  
  // Final Recommendation
  recommendation: Annotation<TradeRecommendation | null>,
  
  // Audit Trail
  auditLog: Annotation<AuditEntry[]>({
    reducer: (current, update) => [...current, ...update],
    default: () => []
  })
});

type GraphStateType = typeof GraphState.State;
```

### 1. Market Ingestion Node

**Responsibility**: Fetch market data from Polymarket and transform into standardized format

**LangGraph Implementation**:
```typescript
async function marketIngestionNode(state: GraphStateType): Promise<Partial<GraphStateType>> {
  try {
    const mbd = await fetchAndTransformMarketData(state.conditionId);
    return {
      mbd,
      auditLog: [{
        stage: 'market_ingestion',
        timestamp: Date.now(),
        data: { conditionId: state.conditionId, success: true }
      }]
    };
  } catch (error) {
    return {
      ingestionError: { type: 'API_UNAVAILABLE', message: error.message },
      auditLog: [{
        stage: 'market_ingestion',
        timestamp: Date.now(),
        data: { conditionId: state.conditionId, error: error.message }
      }]
    };
  }
}
```

**External Dependencies**:
- Polymarket Gamma API (market metadata)
- Polymarket CLOB API (order book data)

### 2. Market Briefing Document (MBD)

**Responsibility**: Standardized data structure for agent consumption

**Schema**:
```typescript
interface MarketBriefingDocument {
  marketId: string;
  conditionId: string;
  eventType: 'election' | 'policy' | 'court' | 'geopolitical' | 'economic' | 'other';
  question: string;
  resolutionCriteria: string;
  expiryTimestamp: number;
  currentProbability: number; // Market-implied probability (0-1)
  liquidityScore: number; // 0-10 scale
  bidAskSpread: number; // In cents
  volatilityRegime: 'low' | 'medium' | 'high';
  volume24h: number;
  metadata: {
    ambiguityFlags: string[];
    keyCatalysts: Array<{event: string, timestamp: number}>;
  };
}
```

### 3. Intelligence Agent Nodes (Parallel Execution)

**Responsibility**: Analyze market from specialized perspectives using LLM

**LangGraph Implementation**:
```typescript
import { ChatOpenAI } from "@langchain/openai";
import { ChatAnthropic } from "@langchain/anthropic";
import { ChatGoogleGenerativeAI } from "@langchain/google-genai";

// Base agent node factory
function createAgentNode(
  agentName: string,
  llm: ChatOpenAI | ChatAnthropic | ChatGoogleGenerativeAI,
  systemPrompt: string
) {
  return async (state: GraphStateType): Promise<Partial<GraphStateType>> => {
    if (!state.mbd) {
      return {
        agentErrors: [{ type: 'EXECUTION_FAILED', agentName, error: new Error('No MBD available') }]
      };
    }
    
    try {
      const structuredLLM = llm.withStructuredOutput(AgentSignalSchema);
      const signal = await structuredLLM.invoke([
        { role: 'system', content: systemPrompt },
        { role: 'user', content: JSON.stringify(state.mbd) }
      ]);
      
      return {
        agentSignals: [{ ...signal, agentName, timestamp: Date.now() }],
        auditLog: [{
          stage: `agent_${agentName}`,
          timestamp: Date.now(),
          data: { agentName, success: true }
        }]
      };
    } catch (error) {
      return {
        agentErrors: [{ type: 'EXECUTION_FAILED', agentName, error }],
        auditLog: [{
          stage: `agent_${agentName}`,
          timestamp: Date.now(),
          data: { agentName, error: error.message }
        }]
      };
    }
  };
}

// LLM Configuration Factory
// Supports both multi-provider mode (different LLMs per agent) and single-provider mode (one LLM for all)
function createLLMInstances(config: EngineConfig): {
  marketMicrostructure: ChatOpenAI | ChatAnthropic | ChatGoogleGenerativeAI;
  probabilityBaseline: ChatOpenAI | ChatAnthropic | ChatGoogleGenerativeAI;
  riskAssessment: ChatOpenAI | ChatAnthropic | ChatGoogleGenerativeAI;
} {
  // Single-provider mode: use one LLM for all agents
  if (config.llm.singleProvider) {
    const provider = config.llm.singleProvider;
    let llm: ChatOpenAI | ChatAnthropic | ChatGoogleGenerativeAI;
    
    if (provider === 'openai' && config.llm.openai) {
      llm = new ChatOpenAI({ 
        apiKey: config.llm.openai.apiKey,
        model: config.llm.openai.defaultModel 
      });
    } else if (provider === 'anthropic' && config.llm.anthropic) {
      llm = new ChatAnthropic({ 
        apiKey: config.llm.anthropic.apiKey,
        model: config.llm.anthropic.defaultModel 
      });
    } else if (provider === 'google' && config.llm.google) {
      llm = new ChatGoogleGenerativeAI({ 
        apiKey: config.llm.google.apiKey,
        model: config.llm.google.defaultModel 
      });
    } else {
      throw new Error(`Invalid single provider configuration: ${provider}`);
    }
    
    return {
      marketMicrostructure: llm,
      probabilityBaseline: llm,
      riskAssessment: llm
    };
  }
  
  // Multi-provider mode: use different LLMs per agent (default for optimal performance)
  return {
    marketMicrostructure: new ChatOpenAI({ 
      apiKey: config.llm.openai?.apiKey,
      model: config.llm.openai?.defaultModel || 'gpt-4-turbo'
    }),
    probabilityBaseline: new ChatGoogleGenerativeAI({ 
      apiKey: config.llm.google?.apiKey,
      model: config.llm.google?.defaultModel || 'gemini-1.5-flash'
    }),
    riskAssessment: new ChatAnthropic({ 
      apiKey: config.llm.anthropic?.apiKey,
      model: config.llm.anthropic?.defaultModel || 'claude-3-sonnet'
    })
  };
}

// Create specific agent nodes with LLM instances
function createAgentNodes(config: EngineConfig) {
  const llms = createLLMInstances(config);
  
  return {
    marketMicrostructureAgent: createAgentNode(
      'market_microstructure',
      llms.marketMicrostructure,
      'You are a market microstructure analyst...'
    ),
    probabilityBaselineAgent: createAgentNode(
      'probability_baseline',
      llms.probabilityBaseline,
      'You are a probability estimation expert...'
    ),
    riskAssessmentAgent: createAgentNode(
      'risk_assessment',
      llms.riskAssessment,
      'You are a risk assessment specialist...'
    )
  };
}
```

**MVP Agent Set**:
- **Market Microstructure Agent**: Analyzes order book depth, spread, momentum (default: GPT-4-turbo)
- **Probability Baseline Agent**: Provides naive baseline probability estimate (default: Gemini-1.5-flash)
- **Risk Assessment Agent**: Identifies tail risks and failure modes (default: Claude-3-sonnet)

**LLM Configuration Modes**:
- **Multi-Provider Mode** (default): Each agent uses a different LLM optimized for its task
  - Provides diverse perspectives and reduces model-specific biases
  - Higher cost but better quality
- **Single-Provider Mode**: All agents use the same LLM with different system prompts
  - Lower cost, simpler API key management
  - Still maintains agent specialization through prompts
  - Useful for budget constraints or testing

### 4. Agent Signal

**Responsibility**: Standardized output from intelligence agents

**Schema**:
```typescript
interface AgentSignal {
  agentName: string;
  timestamp: number;
  confidence: number; // 0-1, agent's confidence in its analysis
  direction: 'YES' | 'NO' | 'NEUTRAL';
  fairProbability: number; // Agent's estimate of true probability (0-1)
  keyDrivers: string[]; // Top 3-5 factors influencing the signal
  riskFactors: string[]; // Identified risks or uncertainties
  metadata: Record<string, any>; // Agent-specific data
}
```

### 5. Thesis Construction Node

**Responsibility**: Generate bull and bear theses from agent signals

**LangGraph Implementation**:
```typescript
async function thesisConstructionNode(state: GraphStateType): Promise<Partial<GraphStateType>> {
  if (state.agentSignals.length < 2) {
    return {
      consensusError: { type: 'INSUFFICIENT_DATA', reason: 'Not enough agent signals' }
    };
  }
  
  const llm = new ChatOpenAI({ model: 'gpt-4-turbo' });
  const structuredLLM = llm.withStructuredOutput(ThesisSchema);
  
  // Generate bull thesis
  const bullThesis = await structuredLLM.invoke([
    { role: 'system', content: 'Generate a bull thesis (YES outcome) from agent signals...' },
    { role: 'user', content: JSON.stringify({ mbd: state.mbd, signals: state.agentSignals }) }
  ]);
  
  // Generate bear thesis
  const bearThesis = await structuredLLM.invoke([
    { role: 'system', content: 'Generate a bear thesis (NO outcome) from agent signals...' },
    { role: 'user', content: JSON.stringify({ mbd: state.mbd, signals: state.agentSignals }) }
  ]);
  
  return {
    bullThesis,
    bearThesis,
    auditLog: [{
      stage: 'thesis_construction',
      timestamp: Date.now(),
      data: { bullEdge: bullThesis.edge, bearEdge: bearThesis.edge }
    }]
  };
}
```

### 6. Cross-Examination Service

**Responsibility**: Challenge thesis assumptions through structured tests

**Interface**:
```typescript
interface CrossExaminationService {
  /**
   * Execute debate protocol between theses
   * @param bull - Bull thesis
   * @param bear - Bear thesis
   * @param mbd - Market context
   * @returns Scored debate record
   */
  crossExamine(
    bull: Thesis,
    bear: Thesis,
    mbd: MarketBriefingDocument
  ): Promise<DebateRecord>;
}

interface DebateRecord {
  tests: Array<{
    testType: 'evidence' | 'causality' | 'timing' | 'liquidity' | 'tail-risk';
    claim: string;
    challenge: string;
    outcome: 'survived' | 'weakened' | 'refuted';
    score: number; // -1 to 1
  }>;
  bullScore: number; // Aggregate score
  bearScore: number;
  keyDisagreements: string[];
}
```

**Cross-Examination Tests**:
1. **Evidence Test**: Are factual claims verifiable?
2. **Causality Test**: Does correlation imply causation?
3. **Timing Test**: Are catalyst timelines realistic?
4. **Liquidity Test**: Can the position be executed at stated prices?
5. **Tail Risk Test**: Are low-probability, high-impact scenarios considered?

### 7. Consensus Engine

**Responsibility**: Calculate final probability estimate with uncertainty quantification

**Interface**:
```typescript
interface ConsensusEngine {
  /**
   * Calculate consensus probability from debate outcomes
   * @param bull - Bull thesis
   * @param bear - Bear thesis
   * @param debate - Debate record
   * @param signals - Original agent signals
   * @returns Consensus probability with confidence bands
   */
  calculateConsensus(
    bull: Thesis,
    bear: Thesis,
    debate: DebateRecord,
    signals: AgentSignal[]
  ): ConsensusProbability;
}

interface ConsensusProbability {
  consensusProbability: number; // 0-1
  confidenceBand: [number, number]; // [lower, upper]
  disagreementIndex: number; // 0-1, higher = more agent disagreement
  regime: 'high-confidence' | 'moderate-confidence' | 'high-uncertainty';
  contributingSignals: string[]; // Agent names
}
```

**Consensus Calculation**:
1. Weight bull and bear probabilities by debate scores
2. Calculate standard deviation across agent signals
3. Widen confidence band proportional to disagreement
4. Classify regime based on disagreement index:
   - High-confidence: disagreementIndex < 0.10
   - Moderate-confidence: 0.10 ≤ disagreementIndex < 0.20
   - High-uncertainty: disagreementIndex ≥ 0.20

### 8. Recommendation Generator

**Responsibility**: Generate actionable trade recommendation with explainability

**Interface**:
```typescript
interface RecommendationGenerator {
  /**
   * Generate trade recommendation from consensus
   * @param mbd - Market context
   * @param consensus - Consensus probability
   * @param bull - Bull thesis
   * @param bear - Bear thesis
   * @returns Trade recommendation or NO TRADE
   */
  generateRecommendation(
    mbd: MarketBriefingDocument,
    consensus: ConsensusProbability,
    bull: Thesis,
    bear: Thesis
  ): TradeRecommendation;
}

interface TradeRecommendation {
  marketId: string;
  action: 'LONG_YES' | 'LONG_NO' | 'NO_TRADE';
  entryZone: [number, number]; // [min, max] price
  targetZone: [number, number];
  expectedValue: number; // In dollars per $100 invested
  winProbability: number;
  liquidityRisk: 'low' | 'medium' | 'high';
  explanation: {
    summary: string; // 2-3 sentence plain language explanation
    coreThesis: string;
    keyCatalysts: string[];
    failureScenarios: string[];
    uncertaintyNote?: string; // Present if disagreementIndex > 0.15
  };
  metadata: {
    consensusProbability: number;
    marketProbability: number;
    edge: number;
    confidenceBand: [number, number];
  };
}
```

**Recommendation Logic**:
1. Calculate edge: `|consensusProbability - marketProbability|`
2. If edge < 0.05 (5%), recommend NO_TRADE (insufficient edge)
3. If expectedValue < 0, recommend NO_TRADE (negative EV)
4. If liquidityScore < 5.0, flag high slippage risk
5. Determine direction: LONG_YES if consensus > market, LONG_NO otherwise
6. Calculate entry zone: market price ± 2%
7. Calculate target zone: consensus probability ± confidence band
8. Generate explanation using LLM with structured prompt

### 9. Audit Logger

**Responsibility**: Log all pipeline stages for debugging and learning

**Interface**:
```typescript
interface AuditLogger {
  logStage(stage: string, data: any): void;
  logError(stage: string, error: Error, context: any): void;
  getAuditTrail(marketId: string): Promise<AuditTrail>;
}

interface AuditTrail {
  marketId: string;
  timestamp: number;
  stages: Array<{
    name: string;
    timestamp: number;
    duration: number;
    data: any;
    errors?: any[];
  }>;
}
```

## Data Models

### Core Data Flow

```
Polymarket APIs
      ↓
MarketBriefingDocument
      ↓
AgentSignal[] (parallel)
      ↓
{bull: Thesis, bear: Thesis}
      ↓
DebateRecord
      ↓
ConsensusProbability
      ↓
TradeRecommendation
```

### Error Types

```typescript
type IngestionError = 
  | { type: 'API_UNAVAILABLE', message: string }
  | { type: 'RATE_LIMIT_EXCEEDED', retryAfter: number }
  | { type: 'INVALID_MARKET_ID', marketId: string }
  | { type: 'VALIDATION_FAILED', field: string, reason: string };

type AgentError =
  | { type: 'TIMEOUT', agentName: string, timeoutMs: number }
  | { type: 'EXECUTION_FAILED', agentName: string, error: Error };

type RecommendationError =
  | { type: 'INSUFFICIENT_DATA', reason: string }
  | { type: 'CONSENSUS_FAILED', reason: string }
  | { type: 'NO_EDGE', edge: number };
```

### Configuration

```typescript
interface EngineConfig {
  polymarket: {
    gammaApiUrl: string;
    clobApiUrl: string;
    rateLimitBuffer: number; // Percentage of rate limit to use (0-100)
  };
  langgraph: {
    checkpointer?: 'memory' | 'sqlite' | 'postgres'; // For state persistence
    recursionLimit?: number; // Max graph execution depth
    streamMode?: 'values' | 'updates'; // How to stream graph execution
  };
  opik: {
    apiKey?: string; // Opik API key (optional for self-hosted)
    projectName: string; // Opik project name
    workspace?: string; // Opik workspace (for cloud)
    baseUrl?: string; // For self-hosted Opik instances
    tags?: string[]; // Default tags for all traces
    trackCosts: boolean; // Enable automatic cost tracking
  };
  llm: {
    // Single-provider mode: use one LLM for all agents (cost-effective)
    singleProvider?: 'openai' | 'anthropic' | 'google';
    
    // Multi-provider mode: configure each provider separately (default, better quality)
    openai?: {
      apiKey: string;
      defaultModel: string; // e.g., 'gpt-4-turbo', 'gpt-4o-mini'
    };
    anthropic?: {
      apiKey: string;
      defaultModel: string; // e.g., 'claude-3-sonnet', 'claude-3-haiku'
    };
    google?: {
      apiKey: string;
      defaultModel: string; // e.g., 'gemini-1.5-pro', 'gemini-1.5-flash'
    };
  };
  agents: {
    timeoutMs: number; // Max time to wait for agent response
    minAgentsRequired: number; // Minimum agents needed for consensus
  };
  consensus: {
    minEdgeThreshold: number; // Minimum edge to recommend trade (default: 0.05)
    highDisagreementThreshold: number; // Disagreement index threshold (default: 0.15)
  };
  logging: {
    level: 'debug' | 'info' | 'warn' | 'error';
    auditTrailRetentionDays: number;
  };
}
```

**LLM Configuration Modes**:

1. **Single-Provider Mode** (Budget-Friendly):
   ```typescript
   {
     llm: {
       singleProvider: 'openai',
       openai: {
         apiKey: process.env.OPENAI_API_KEY,
         defaultModel: 'gpt-4o-mini'
       }
     }
   }
   ```
   - All agents use the same LLM instance
   - Lower cost, simpler API key management
   - Agent specialization maintained through system prompts

2. **Multi-Provider Mode** (Optimal Quality):
   ```typescript
   {
     llm: {
       openai: {
         apiKey: process.env.OPENAI_API_KEY,
         defaultModel: 'gpt-4-turbo'
       },
       anthropic: {
         apiKey: process.env.ANTHROPIC_API_KEY,
         defaultModel: 'claude-3-sonnet'
       },
       google: {
         apiKey: process.env.GOOGLE_API_KEY,
         defaultModel: 'gemini-1.5-flash'
       }
     }
   }
   ```
   - Each agent uses a different LLM optimized for its task
   - Diverse perspectives reduce model-specific biases
   - Higher cost but better quality recommendations

### LangGraph Workflow Definition

```typescript
import { StateGraph, END } from "@langchain/langgraph";
import { OpikTracer, track_langgraph } from "opik/integrations/langchain";

// Create the Opik tracer for observability
const opikTracer = new OpikTracer({
  projectName: "market-intelligence-engine",
  tags: ["production", "debate-protocol"]
});

// Create the graph
const workflow = new StateGraph(GraphState)
  // Add nodes
  .addNode("market_ingestion", marketIngestionNode)
  .addNode("market_microstructure_agent", marketMicrostructureAgent)
  .addNode("probability_baseline_agent", probabilityBaselineAgent)
  .addNode("risk_assessment_agent", riskAssessmentAgent)
  .addNode("thesis_construction", thesisConstructionNode)
  .addNode("cross_examination", crossExaminationNode)
  .addNode("consensus_engine", consensusEngineNode)
  .addNode("recommendation_generation", recommendationGenerationNode)
  
  // Define edges
  .addEdge("__start__", "market_ingestion")
  
  // Conditional edge: if ingestion fails, end early
  .addConditionalEdges(
    "market_ingestion",
    (state) => state.ingestionError ? "error" : "agents",
    {
      agents: "market_microstructure_agent",
      error: END
    }
  )
  
  // Parallel agent execution
  .addEdge("market_ingestion", "market_microstructure_agent")
  .addEdge("market_ingestion", "probability_baseline_agent")
  .addEdge("market_ingestion", "risk_assessment_agent")
  
  // All agents converge to thesis construction
  .addEdge("market_microstructure_agent", "thesis_construction")
  .addEdge("probability_baseline_agent", "thesis_construction")
  .addEdge("risk_assessment_agent", "thesis_construction")
  
  // Sequential flow through debate protocol
  .addEdge("thesis_construction", "cross_examination")
  .addEdge("cross_examination", "consensus_engine")
  .addEdge("consensus_engine", "recommendation_generation")
  .addEdge("recommendation_generation", END);

// Compile the graph with checkpointer
const app = workflow.compile({
  checkpointer: new MemorySaver(), // Or SqliteSaver, PostgresSaver
});

// Wrap with Opik tracking - automatically logs all executions with graph visualization
const trackedApp = track_langgraph(app, opikTracer);

// Execute the workflow
async function analyzeMarket(conditionId: string): Promise<TradeRecommendation> {
  const result = await trackedApp.invoke(
    { conditionId },
    { 
      configurable: { 
        thread_id: conditionId // Used for both LangGraph checkpointing and Opik thread tracking
      } 
    }
  );
  
  return result.recommendation;
}
```

### Opik Observability Features

**Automatic Tracing**:
- Every LangGraph node execution is logged as an Opik span
- LLM calls are automatically traced with input/output, tokens, cost
- Graph visualization is extracted and displayed in Opik UI
- State transitions are logged for debugging

**Cost Tracking**:
- Automatic token usage tracking via LangChain callbacks
- Per-provider cost calculation (OpenAI, Anthropic, Gemini)
- Aggregated costs per market analysis
- Cost breakdown by agent and node

**Thread-Based Conversations**:
- Each market analysis uses `thread_id` (condition ID) for tracking
- Complete audit trail per market accessible via thread ID
- Easy to replay and debug specific market analyses

**Debugging Capabilities**:
- Visual graph representation in Opik UI
- Step-by-step execution trace with timing
- Input/output inspection for each node
- Error tracking with full context
- LLM prompt and response logging


## Correctness Properties

*A property is a characteristic or behavior that should hold true across all valid executions of a system-essentially, a formal statement about what the system should do. Properties serve as the bridge between human-readable specifications and machine-verifiable correctness guarantees.*

### Property 1: Market data retrieval completeness

*For any* valid market contract ID, when market data is requested, the system should return a response containing market probability, liquidity score, bid/ask spread, and contract metadata.

**Validates: Requirements 1.2**

### Property 2: Market Briefing Document validity

*For any* market data successfully ingested, the resulting Market Briefing Document should pass schema validation with all required fields present and properly typed, including contract rules, expiry, current probability, liquidity, and volatility regime when historical data is available.

**Validates: Requirements 2.1, 2.3, 2.4**

### Property 3: Agent dispatch completeness

*For any* Market Briefing Document and any set of registered agents, all agents should receive the MBD for analysis.

**Validates: Requirements 3.1**

### Property 4: Agent signal structure validity

*For any* set of agent signals aggregated from completed agents, each signal should contain confidence score, direction, fair probability, and key drivers.

**Validates: Requirements 3.2, 3.4**

### Property 5: Thesis generation completeness

*For any* aggregated agent signals, the system should generate both a bull thesis (YES) and a bear thesis (NO), each containing fair probability estimate, market edge calculation, core argument, catalysts, and failure conditions.

**Validates: Requirements 4.1, 4.2, 4.3**

### Property 6: Cross-examination execution

*For any* pair of complete bull and bear theses, the system should execute the cross-examination protocol and produce a scored debate record showing which arguments survived scrutiny.

**Validates: Requirements 5.1, 5.4**

### Property 7: Factual claim verification

*For any* factual claim made in a thesis, the opposing agent should verify the claim against available data during cross-examination.

**Validates: Requirements 5.2**

### Property 8: Causality testing

*For any* causal claim in a thesis, the opposing agent should test whether the claimed correlation implies causation.

**Validates: Requirements 5.3**

### Property 9: Consensus probability structure

*For any* completed cross-examination, the system should calculate a consensus probability that includes confidence band, disagreement index, and probability regime classification.

**Validates: Requirements 6.1, 6.3**

### Property 10: Trade recommendation structure validity

*For any* trade recommendation generated (not NO_TRADE), the recommendation should include direction, entry zone, target zone, expected value, and win probability.

**Validates: Requirements 7.2**

### Property 11: Negative expected value rejection

*For any* consensus probability calculation where expected value is negative, the system should recommend NO_TRADE regardless of edge magnitude.

**Validates: Requirements 7.3**

### Property 12: Explanation completeness

*For any* trade recommendation generated, the explanation should include a natural language summary, and when catalysts or failure conditions exist in the underlying thesis, they should be referenced in the explanation, and when agent disagreement is significant, the explanation should acknowledge uncertainty.

**Validates: Requirements 7.5, 8.1, 8.2, 8.3, 8.4**

### Property 13: Audit trail completeness

*For any* trade recommendation generated, the audit log should contain entries for all agent outputs, all debate protocol phase transitions, and the complete decision chain from raw market data to final recommendation.

**Validates: Requirements 9.1, 9.2, 9.3**

### Property 14: Error logging

*For any* system error that occurs during pipeline execution, the error should be logged with error details, context, and recovery actions.

**Validates: Requirements 9.4**

### Property 15: Agent failure isolation

*For any* agent that times out or fails during analysis, the system should continue processing with the remaining agents and produce a valid output if minimum agent threshold is met.

**Validates: Requirements 3.3, 10.2**

### Property 16: LangGraph state flow

*For any* market analysis execution, the LangGraph workflow should successfully pass state through all nodes and produce a final recommendation in the graph state.

**Validates: Requirements 11.1, 11.2, 11.4**

### Property 17: LangGraph parallel agent execution

*For any* market briefing document in the graph state, all agent nodes should execute in parallel and write their signals to the shared state.

**Validates: Requirements 11.2**

## Error Handling

The Market Intelligence Engine implements defense-in-depth error handling at multiple levels:

### 1. API Layer Error Handling

**Polymarket API Failures**:
- Implement exponential backoff with jitter for transient failures
- Maximum 3 retry attempts with delays: 1s, 2s, 4s
- Circuit breaker pattern: after 5 consecutive failures, pause requests for 60s
- Fallback: return structured error to caller, do not crash pipeline

**Rate Limiting**:
- Monitor rate limit headers from Polymarket APIs
- Implement token bucket algorithm to stay within limits
- When rate limit approached (>80% of limit), slow request rate
- When rate limit exceeded, wait for reset window before retrying

**Data Validation Failures**:
- Validate API responses against expected schemas
- Log validation errors with full context
- Return structured error: `{type: 'VALIDATION_FAILED', field, reason}`
- Do not proceed with invalid data

### 2. Agent Layer Error Handling

**Agent Timeouts**:
- Set timeout per agent (default: 10 seconds)
- Use Promise.race() to enforce timeout
- Log timeout with agent name and duration
- Continue with other agents if minimum threshold met (default: 2 agents)

**Agent Execution Failures**:
- Wrap agent execution in try-catch
- Log full error stack trace with agent context
- Mark agent as failed, exclude from aggregation
- Continue with remaining agents

**LLM Provider Failures**:
- If primary LLM provider fails, attempt fallback provider if configured
- Implement exponential backoff for LLM API failures
- Log provider failures with error details
- If all providers fail, mark agent as failed

**Insufficient Agents**:
- If fewer than minimum agents complete, return error
- Error type: `{type: 'INSUFFICIENT_DATA', reason: 'Only N agents completed'}`
- Recommend NO_TRADE to user

### 3. Consensus Layer Error Handling

**Consensus Failure**:
- If agent signals are too divergent (disagreementIndex > 0.30), consensus may fail
- Return structured error: `{type: 'CONSENSUS_FAILED', reason: 'Agent disagreement too high'}`
- Recommend NO_TRADE with explanation of uncertainty

**No Edge Detected**:
- If |consensusProbability - marketProbability| < 0.05, no tradeable edge exists
- Return: `{type: 'NO_EDGE', edge: calculatedEdge}`
- Recommend NO_TRADE with explanation

### 4. System-Wide Error Handling

**Graceful Degradation**:
- Each pipeline stage is independent
- Failure in one stage does not crash subsequent stages
- Return partial results when possible (e.g., MBD without recommendation)

**Error Propagation**:
- Use Result<T, E> pattern for error handling
- Errors bubble up with context at each layer
- Top-level handler logs and returns user-friendly error

**Monitoring and Alerting**:
- Log all errors to structured logging system
- Track error rates by type and stage
- Alert on: API failure rate > 10%, agent timeout rate > 20%, consensus failure rate > 15%

## Testing Strategy

The Market Intelligence Engine requires a dual testing approach combining unit tests for specific behaviors and property-based tests for universal correctness guarantees.

### Unit Testing Approach

Unit tests verify specific examples, edge cases, and integration points:

**API Integration Tests**:
- Test successful market data fetch from Polymarket
- Test handling of invalid market IDs
- Test rate limit detection and backoff
- Test API unavailability scenarios
- Mock Polymarket APIs for deterministic testing

**Component Integration Tests**:
- Test MBD creation from sample market data
- Test agent dispatch with mock agents
- Test thesis construction from sample signals
- Test cross-examination with predefined theses
- Test recommendation generation from sample consensus

**Edge Case Tests**:
- Test ambiguous resolution criteria flagging (Req 2.2)
- Test fairly priced market detection (edge < 2%) (Req 4.4)
- Test high disagreement confidence band widening (Req 6.2)
- Test efficient market classification (edge < 3%) (Req 6.4)
- Test edge threshold boundary (5%) for recommendations (Req 7.1)
- Test liquidity threshold (< 5.0) for slippage warnings (Req 7.4)

**Error Handling Tests**:
- Test API retry logic with exponential backoff (Req 10.1)
- Test agent timeout handling (Req 10.2)
- Test validation failure error responses (Req 10.3)
- Test consensus failure NO_TRADE recommendation (Req 10.4)

**Example Tests**:
- Test system initialization and API connection (Req 1.1)
- Test stale data detection (Req 1.3)
- Test agent failure isolation (Req 3.3)

### Property-Based Testing Approach

Property-based tests verify universal properties across randomly generated inputs using a PBT library. For TypeScript/JavaScript, we will use **fast-check** as the property-based testing framework.

**Configuration**:
- Each property test should run a minimum of 100 iterations
- Use fast-check's `fc.assert()` with `{numRuns: 100}` or higher
- Tag each test with the property number and requirement reference

**Test Tagging Format**:
```typescript
// Feature: market-intelligence-engine, Property 1: Market data retrieval completeness
// Validates: Requirements 1.2
```

**Property Test Implementation**:

Each correctness property from the design document must be implemented as a single property-based test:

1. **Property 1** - Generate random valid market IDs, verify response structure
2. **Property 2** - Generate random market data, verify MBD validity
3. **Property 3** - Generate random MBDs and agent sets, verify all agents receive MBD
4. **Property 4** - Generate random agent signal sets, verify structure validity
5. **Property 5** - Generate random agent signals, verify both theses generated with required fields
6. **Property 6** - Generate random thesis pairs, verify cross-examination executes
7. **Property 7** - Generate random theses with factual claims, verify verification occurs
8. **Property 8** - Generate random theses with causal claims, verify causality testing
9. **Property 9** - Generate random debate outcomes, verify consensus structure
10. **Property 10** - Generate random consensus results, verify recommendation structure
11. **Property 11** - Generate random negative EV scenarios, verify NO_TRADE
12. **Property 12** - Generate random recommendations, verify explanation completeness
13. **Property 13** - Generate random pipeline executions, verify audit trail
14. **Property 14** - Generate random error scenarios, verify error logging
15. **Property 15** - Generate random agent failure scenarios, verify isolation

**Generator Strategy**:
- Create smart generators that produce valid domain objects
- Use fast-check's built-in generators (`fc.string()`, `fc.float()`, `fc.record()`)
- Constrain generators to valid input spaces (e.g., probabilities in [0, 1])
- Generate edge cases explicitly (empty arrays, boundary values)

**Example Property Test**:
```typescript
import fc from 'fast-check';

// Feature: market-intelligence-engine, Property 2: Market Briefing Document validity
// Validates: Requirements 2.1, 2.3, 2.4
test('MBD validity property', () => {
  fc.assert(
    fc.property(
      fc.record({
        marketId: fc.string(),
        probability: fc.float({min: 0, max: 1}),
        liquidity: fc.float({min: 0, max: 10}),
        // ... other fields
      }),
      (marketData) => {
        const mbd = createMBD(marketData);
        return validateMBD(mbd).isValid;
      }
    ),
    { numRuns: 100 }
  );
});
```

### Test Coverage Goals

- Unit test coverage: >80% of code paths
- Property test coverage: 100% of correctness properties
- Integration test coverage: All external API interactions
- Edge case coverage: All threshold boundaries and error conditions

### Testing Philosophy

- **Unit tests catch specific bugs** - They verify concrete examples work correctly
- **Property tests verify general correctness** - They verify universal rules hold across all inputs
- **Together they provide comprehensive coverage** - Unit tests for the specific, property tests for the general
- **Tests may reveal bugs in the code** - Do not assume the implementation is always correct
- **Seek clarification when needed** - If tests reveal confusing behavior not covered in the spec, ask the user

The testing strategy ensures the Market Intelligence Engine is both correct in specific cases and robust across the full input space.
