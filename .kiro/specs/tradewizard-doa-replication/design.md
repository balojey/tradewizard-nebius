# Design Document: TradeWizard DOA Replication

## Overview

This document specifies the design for replicating TradeWizard's multi-agent prediction market analysis system into the DOA (Digital Ocean Agents) directory using Python and Digital Ocean's Gradient AI Platform.

### System Purpose

The system will analyze prediction markets on Polymarket using specialized AI agents that examine markets from different perspectives (market microstructure, probability baseline, risk assessment, news analysis, polling data, sentiment, price action, and event scenarios). The agents execute in parallel, their signals are fused, bull and bear theses are constructed and cross-examined, a consensus probability is calculated, and finally actionable trade recommendations are generated.

### Key Design Principles

1. **Preserve DOA Architecture**: Maintain DOA's file structure (agents/, tools/, main.py, prompts.py) and patterns
2. **Python-Native Implementation**: Use Python idioms, type hints, and Pydantic models throughout
3. **LangGraph Compatibility**: Leverage LangGraph's StateGraph, Send API for parallelism, and checkpointing
4. **Gradient AI Integration**: Use Digital Ocean's Gradient AI Platform for LLM capabilities
5. **Modular Agent Design**: Each agent is independent and can be enabled/disabled via configuration
6. **Observable and Traceable**: Integrate Opik for LLM observability and cost tracking

## Architecture

### High-Level Workflow

```
Market Analysis Request (condition_id)
    ↓
[Market Ingestion] → Fetch market data from Polymarket
    ↓
[Memory Retrieval] → Load historical agent signals for context
    ↓
[Keyword Extraction] → Extract keywords from market/event data
    ↓
[Dynamic Agent Selection] → Determine which agents to activate
    ↓
[Parallel Agent Execution] → All agents analyze simultaneously
    ↓
[Agent Signal Fusion] → Aggregate signals with dynamic weighting
    ↓
[Thesis Construction] → Build bull and bear theses
    ↓
[Cross-Examination] → Test theses against each other
    ↓
[Consensus Engine] → Calculate unified probability estimate
    ↓
[Risk Philosophy Agents] → Generate position sizing recommendations
    ↓
[Recommendation Generation] → Create actionable trade recommendation
    ↓
Trade Recommendation Output
```

### LangGraph State Management

The workflow uses a single shared state object that flows through all nodes. State is defined using Python TypedDict with Annotated fields for reducers.

**State Structure:**
- Input: `condition_id` (str)
- Market Data: `mbd` (MarketBriefingDocument), `market_keywords` (EventKeywords)
- Agent Context: `memory_context` (Dict[str, AgentMemoryContext]), `active_agents` (List[str])
- Agent Outputs: `agent_signals` (List[AgentSignal]), `agent_errors` (List[AgentError])
- Signal Fusion: `fused_signal` (FusedSignal)
- Debate: `bull_thesis` (Thesis), `bear_thesis` (Thesis), `debate_record` (DebateRecord)
- Consensus: `consensus` (ConsensusProbability)
- Risk Philosophy: `risk_philosophy_signals` (Dict with aggressive/conservative/neutral)
- Output: `recommendation` (TradeRecommendation)
- Audit: `audit_log` (List[AuditEntry])

### Parallel Execution Pattern

Agents execute in parallel using LangGraph's Send API:

1. **Dynamic Agent Selection** node determines which agents should run
2. **Dispatch Function** creates Send commands for each active agent
3. **Agent Nodes** execute concurrently (LangGraph handles parallelism)
4. **Signal Fusion** node waits for all agents to complete (fan-in)
5. State reducers automatically aggregate results from parallel executions

## Components and Interfaces

### 1. Main Entry Point (main.py)

**Purpose**: Orchestrate the market analysis workflow

**Key Functions**:
- `build_market_analysis_graph()`: Construct the LangGraph StateGraph
- `analyze_market(condition_id, config)`: Execute analysis for a market
- `main()`: CLI entry point for market analysis

**Interface**:
```python
async def analyze_market(
    condition_id: str,
    config: EngineConfig
) -> AnalysisResult:
    """
    Analyze a prediction market.
    
    Args:
        condition_id: Polymarket condition ID
        config: Engine configuration
        
    Returns:
        AnalysisResult with recommendation and agent signals
    """
```

### 2. Configuration Management (config.py)

**Purpose**: Load and validate configuration from environment variables

**Key Classes**:
- `EngineConfig`: Main configuration dataclass
- `PolymarketConfig`: Polymarket API settings
- `LLMConfig`: Gradient AI LLM settings
- `AgentConfig`: Agent execution settings
- `DatabaseConfig`: Supabase/PostgreSQL settings

**Interface**:
```python
@dataclass
class EngineConfig:
    polymarket: PolymarketConfig
    langgraph: LangGraphConfig
    opik: OpikConfig
    llm: LLMConfig
    agents: AgentConfig
    consensus: ConsensusConfig
    database: DatabaseConfig
    memory_system: MemorySystemConfig
    
def load_config() -> EngineConfig:
    """Load configuration from environment variables."""
```

### 3. State Definition (models/state.py)

**Purpose**: Define the shared state that flows through the workflow

**Key Types**:
- `GraphState`: TypedDict with all state fields
- State reducers for `agent_signals`, `agent_errors`, `audit_log`

**Interface**:
```python
class GraphState(TypedDict, total=False):
    # Input
    condition_id: str
    
    # Market Data
    mbd: Optional[MarketBriefingDocument]
    market_keywords: Optional[EventKeywords]
    ingestion_error: Optional[IngestionError]
    
    # Agent Context
    memory_context: Dict[str, AgentMemoryContext]
    active_agents: List[str]
    
    # Agent Outputs (with reducers)
    agent_signals: Annotated[List[AgentSignal], operator.add]
    agent_errors: Annotated[List[AgentError], operator.add]
    
    # ... (other fields)
```

### 4. Data Models (models/types.py)

**Purpose**: Define all data structures using Pydantic

**Key Models**:
- `MarketBriefingDocument`: Market data input for agents
- `AgentSignal`: Output from individual agents
- `Thesis`: Bull or bear argument structure
- `DebateRecord`: Cross-examination results
- `ConsensusProbability`: Unified probability estimate
- `TradeRecommendation`: Final actionable output

**Example**:
```python
class AgentSignal(BaseModel):
    agent_name: str
    timestamp: int
    confidence: float  # 0-1
    direction: Literal["YES", "NO", "NEUTRAL"]
    fair_probability: float  # 0-1
    key_drivers: List[str]
    risk_factors: List[str]
    metadata: Dict[str, Any]
```

### 5. Polymarket Client Tool (tools/polymarket_client.py)

**Purpose**: Fetch market data from Polymarket APIs

**Key Functions**:
- `fetch_market_data(condition_id)`: Get market details
- `fetch_event_data(event_id)`: Get event context
- `transform_to_mbd(market, event)`: Create Market Briefing Document

**Interface**:
```python
class PolymarketClient:
    def __init__(self, config: PolymarketConfig):
        self.gamma_api_url = config.gamma_api_url
        self.clob_api_url = config.clob_api_url
        
    async def fetch_market_data(
        self, 
        condition_id: str
    ) -> Result[PolymarketMarket, IngestionError]:
        """Fetch market data from Polymarket API."""
        
    async def fetch_event_data(
        self, 
        event_id: str
    ) -> Result[PolymarketEvent, IngestionError]:
        """Fetch event data from Polymarket API."""
        
    def transform_to_mbd(
        self,
        market: PolymarketMarket,
        event: Optional[PolymarketEvent]
    ) -> MarketBriefingDocument:
        """Transform Polymarket data to MBD format."""
```

### 6. Agent Factory (agents/agent_factory.py)

**Purpose**: Create agent node functions with consistent patterns

**Key Functions**:
- `create_agent_node(agent_name, system_prompt)`: Factory for agent nodes
- `create_llm_instance(config)`: Create Gradient AI LLM instance

**Interface**:
```python
def create_agent_node(
    agent_name: str,
    system_prompt: str,
    config: EngineConfig
) -> Callable[[GraphState], Awaitable[Dict[str, Any]]]:
    """
    Create a LangGraph node for an intelligence agent.
    
    Args:
        agent_name: Unique identifier for the agent
        system_prompt: System prompt defining agent's perspective
        config: Engine configuration
        
    Returns:
        Async function that analyzes market and returns AgentSignal
    """
```

### 7. Individual Agent Modules (agents/)

**Purpose**: Implement specialized intelligence agents

**Agent Types**:
- `market_microstructure.py`: MVP agent analyzing order book dynamics
- `probability_baseline.py`: MVP agent providing baseline probability
- `risk_assessment.py`: MVP agent identifying tail risks
- `breaking_news.py`: Event intelligence agent analyzing news
- `event_impact.py`: Event intelligence agent assessing impact
- `polling_intelligence.py`: Polling agent interpreting market as poll
- `historical_pattern.py`: Statistical agent finding patterns
- `media_sentiment.py`: Sentiment agent analyzing media
- `social_sentiment.py`: Sentiment agent analyzing social media
- `narrative_velocity.py`: Narrative agent tracking story evolution
- `momentum.py`: Price action agent detecting momentum
- `mean_reversion.py`: Price action agent detecting reversals
- `catalyst.py`: Event scenario agent identifying catalysts
- `tail_risk.py`: Event scenario agent modeling tail risks

**Common Interface**:
```python
# Each agent module exports:
AGENT_NAME = "market_microstructure"
SYSTEM_PROMPT = """..."""  # Agent-specific prompt

# Created via factory:
market_microstructure_node = create_agent_node(
    AGENT_NAME,
    SYSTEM_PROMPT,
    config
)
```

### 8. Workflow Nodes (nodes/)

**Purpose**: Implement non-agent workflow stages

**Key Nodes**:
- `market_ingestion.py`: Fetch and transform market data
- `memory_retrieval.py`: Load historical agent signals
- `keyword_extraction.py`: Extract keywords from market/event
- `dynamic_agent_selection.py`: Determine which agents to activate
- `agent_signal_fusion.py`: Aggregate agent signals
- `thesis_construction.py`: Build bull and bear theses
- `cross_examination.py`: Test theses against each other
- `consensus_engine.py`: Calculate consensus probability
- `recommendation_generation.py`: Generate trade recommendation

**Example Node Interface**:
```python
async def market_ingestion_node(
    state: GraphState
) -> Dict[str, Any]:
    """
    Fetch market data from Polymarket and create MBD.
    
    Returns:
        Dict with mbd, market_keywords, or ingestion_error
    """
```

### 9. Database Persistence (database/)

**Purpose**: Store and retrieve analysis results

**Key Modules**:
- `supabase_client.py`: Supabase connection management
- `persistence.py`: Save/load market data, signals, recommendations
- `memory_retrieval.py`: Query historical agent signals

**Interface**:
```python
class PersistenceLayer:
    def __init__(self, supabase_client: SupabaseClient):
        self.client = supabase_client
        
    async def save_market_data(
        self, 
        mbd: MarketBriefingDocument
    ) -> None:
        """Save market data to database."""
        
    async def save_agent_signals(
        self,
        condition_id: str,
        signals: List[AgentSignal]
    ) -> None:
        """Save agent signals to database."""
        
    async def save_recommendation(
        self,
        recommendation: TradeRecommendation
    ) -> None:
        """Save trade recommendation to database."""
        
    async def get_historical_signals(
        self,
        condition_id: str,
        agent_name: str,
        limit: int = 3
    ) -> List[AgentSignal]:
        """Retrieve historical signals for memory context."""
```

### 10. CLI Interface (cli.py)

**Purpose**: Provide command-line interface for market analysis

**Commands**:
- `analyze <condition_id>`: Analyze a market
- `history <condition_id>`: Query past analyses
- `monitor`: Start continuous monitoring

**Interface**:
```python
import click

@click.group()
def cli():
    """TradeWizard Market Intelligence CLI"""
    pass

@cli.command()
@click.argument('condition_id')
def analyze(condition_id: str):
    """Analyze a prediction market."""
    
@cli.command()
@click.argument('condition_id')
def history(condition_id: str):
    """Query analysis history for a market."""
    
@cli.command()
def monitor():
    """Start continuous market monitoring."""
```

### 11. Prompts Module (prompts.py)

**Purpose**: Centralize all agent system prompts

**Structure**:
```python
# MVP Agent Prompts
MARKET_MICROSTRUCTURE_PROMPT = """..."""
PROBABILITY_BASELINE_PROMPT = """..."""
RISK_ASSESSMENT_PROMPT = """..."""

# Event Intelligence Prompts
BREAKING_NEWS_PROMPT = """..."""
EVENT_IMPACT_PROMPT = """..."""

# Polling & Statistical Prompts
POLLING_INTELLIGENCE_PROMPT = """..."""
HISTORICAL_PATTERN_PROMPT = """..."""

# Sentiment & Narrative Prompts
MEDIA_SENTIMENT_PROMPT = """..."""
SOCIAL_SENTIMENT_PROMPT = """..."""
NARRATIVE_VELOCITY_PROMPT = """..."""

# Price Action Prompts
MOMENTUM_PROMPT = """..."""
MEAN_REVERSION_PROMPT = """..."""

# Event Scenario Prompts
CATALYST_PROMPT = """..."""
TAIL_RISK_PROMPT = """..."""

# Debate Protocol Prompts
THESIS_CONSTRUCTION_PROMPT = """..."""
CROSS_EXAMINATION_PROMPT = """..."""
CONSENSUS_ENGINE_PROMPT = """..."""
RECOMMENDATION_GENERATION_PROMPT = """..."""
```

## Data Models

### Core Data Structures

#### MarketBriefingDocument
```python
class MarketBriefingDocument(BaseModel):
    """Primary input to all intelligence agents."""
    market_id: str
    condition_id: str
    event_type: Literal["election", "policy", "court", "geopolitical", "economic", "other"]
    question: str
    resolution_criteria: str
    expiry_timestamp: int
    current_probability: float  # 0-1
    liquidity_score: float  # 0-10
    bid_ask_spread: float  # in cents
    volatility_regime: Literal["low", "medium", "high"]
    volume_24h: float
    
    # Event context (optional)
    event_context: Optional[EventContext]
    
    # Keywords
    keywords: Optional[List[str]]
    
    # Metadata
    metadata: StreamlinedEventMetadata
```

#### AgentSignal
```python
class AgentSignal(BaseModel):
    """Output from an intelligence agent."""
    agent_name: str
    timestamp: int
    confidence: float  # 0-1
    direction: Literal["YES", "NO", "NEUTRAL"]
    fair_probability: float  # 0-1
    key_drivers: List[str]  # Top 3-5 factors
    risk_factors: List[str]  # Identified risks
    metadata: Dict[str, Any]  # Agent-specific data
```

#### Thesis
```python
class Thesis(BaseModel):
    """Structured argument for or against an outcome."""
    direction: Literal["YES", "NO"]
    fair_probability: float
    market_probability: float
    edge: float  # |fair - market|
    core_argument: str
    catalysts: List[str]
    failure_conditions: List[str]
    supporting_signals: List[str]  # Agent names
```

#### DebateRecord
```python
class DebateTest(BaseModel):
    """Individual debate test result."""
    test_type: Literal["evidence", "causality", "timing", "liquidity", "tail-risk"]
    claim: str
    challenge: str
    outcome: Literal["survived", "weakened", "refuted"]
    score: float  # -1 to 1

class DebateRecord(BaseModel):
    """Result of cross-examination."""
    tests: List[DebateTest]
    bull_score: float
    bear_score: float
    key_disagreements: List[str]
```

#### ConsensusProbability
```python
class ConsensusProbability(BaseModel):
    """Final probability estimate with uncertainty."""
    consensus_probability: float  # 0-1
    confidence_band: Tuple[float, float]  # [lower, upper]
    disagreement_index: float  # 0-1
    regime: Literal["high-confidence", "moderate-confidence", "high-uncertainty"]
    contributing_signals: List[str]  # Agent names
```

#### TradeRecommendation
```python
class TradeRecommendation(BaseModel):
    """Final actionable output."""
    market_id: str
    action: Literal["LONG_YES", "LONG_NO", "NO_TRADE"]
    entry_zone: Tuple[float, float]  # [min, max] price
    target_zone: Tuple[float, float]
    expected_value: float  # Dollars per $100 invested
    win_probability: float
    liquidity_risk: Literal["low", "medium", "high"]
    explanation: TradeExplanation
    metadata: TradeMetadata
```

## Correctness Properties

*A property is a characteristic or behavior that should hold true across all valid executions of a system-essentially, a formal statement about what the system should do. Properties serve as the bridge between human-readable specifications and machine-verifiable correctness guarantees.*

Now I'll perform the prework analysis to identify testable properties from the requirements.



### Property Reflection

After analyzing all acceptance criteria, I've identified the following testable properties. Now reviewing for redundancy:

**Redundancy Analysis:**
- Properties 2.2, 2.3, 2.4 (market data fetching and transformation) can be combined into a single comprehensive property about the data ingestion pipeline
- Properties 11.2, 11.3, 11.4, 11.5 (recommendation field requirements) can be combined into one property about recommendation completeness
- Properties 8.2, 8.3, 8.4 (Opik tracing) can be combined into one property about observability completeness
- Properties 4.2 and 4.3 (parallel execution) are related but test different aspects - keep both
- Properties 5.2 and 5.3 (memory retrieval) can be combined into one property about memory context provision

**Final Property Set** (after eliminating redundancy):
1. Market data ingestion pipeline (combines 2.2, 2.3, 2.4)
2. API error handling (2.5)
3. Agent signal structure validation (3.8)
4. Parallel agent dispatch (4.2)
5. Agent signal aggregation (4.3)
6. Memory context provision (combines 5.2, 5.3)
7. Data persistence round-trip (5.4)
8. Complete analysis storage (6.2)
9. CLI workflow execution (7.2)
10. Output formatting (7.6)
11. Observability completeness (combines 8.2, 8.3, 8.4)
12. Thesis construction (9.1)
13. Thesis scoring (9.3)
14. Debate record completeness (9.4)
15. Debate influence on consensus (9.5)
16. Consensus probability generation (10.1)
17. Disagreement index calculation (10.2)
18. Confidence band provision (10.3)
19. Regime classification (10.4)
20. Signal weighting (10.5)
21. Recommendation action validity (11.1)
22. Recommendation completeness (combines 11.2, 11.3, 11.4, 11.5)
23. Configuration validation (12.4)
24. Structured error handling (13.1)
25. Agent failure isolation (13.2)
26. Database fallback (13.3)
27. Timeout handling (13.4)
28. Exponential backoff (13.5)

### Correctness Properties

Property 1: Market Data Ingestion Pipeline
*For any* valid Polymarket condition ID, fetching market data should successfully retrieve market details, related event data, and transform them into a valid Market Briefing Document with all required fields populated
**Validates: Requirements 2.2, 2.3, 2.4**

Property 2: API Error Handling
*For any* API failure (network error, rate limit, invalid ID), the system should return a structured IngestionError with error type, message, and retry information rather than raising an unhandled exception
**Validates: Requirements 2.5**

Property 3: Agent Signal Structure Validation
*For any* agent execution that completes successfully, the returned AgentSignal should have all required fields (agent_name, timestamp, confidence, direction, fair_probability, key_drivers, risk_factors, metadata) with values in valid ranges (confidence 0-1, fair_probability 0-1, direction in YES/NO/NEUTRAL)
**Validates: Requirements 3.8**

Property 4: Parallel Agent Dispatch
*For any* set of active agents determined by dynamic agent selection, the number of Send commands created should equal the number of active agents, ensuring all selected agents are dispatched for parallel execution
**Validates: Requirements 4.2**

Property 5: Agent Signal Aggregation
*For any* set of agents that execute in parallel, all successfully completed agent signals should appear in the final state's agent_signals list, with no signals lost during parallel aggregation
**Validates: Requirements 4.3**

Property 6: Memory Context Provision
*For any* market with historical analysis data, when the workflow executes, each agent should receive memory context containing that agent's past signals for the same market (up to the configured limit), enabling agents to reference their previous analysis
**Validates: Requirements 5.2, 5.3**

Property 7: Data Persistence Round-Trip
*For any* agent signal or trade recommendation, storing it to the database and then retrieving it should produce an equivalent object with all fields preserved
**Validates: Requirements 5.4**

Property 8: Complete Analysis Storage
*For any* completed market analysis, the database should contain entries in all three tables: markets (with MBD data), agent_signals (with all agent outputs), and recommendations (with the final trade recommendation)
**Validates: Requirements 6.2**

Property 9: CLI Workflow Execution
*For any* valid condition ID provided to the CLI analyze command, the system should execute the complete workflow (all stages from ingestion to recommendation) and return either a successful recommendation or a structured error, never hanging or crashing
**Validates: Requirements 7.2**

Property 10: Output Formatting
*For any* trade recommendation generated, the CLI output should contain both human-readable text (explanation summary, key catalysts, failure scenarios) and structured data (action, entry zone, target zone, expected value) in a parseable format
**Validates: Requirements 7.6**

Property 11: Observability Completeness
*For any* market analysis execution, Opik should capture traces for all LLM calls made during the workflow, traces should be flushed asynchronously after completion, and cost tracking data (token usage, estimated cost) should be available in the analysis result
**Validates: Requirements 8.2, 8.3, 8.4**

Property 12: Thesis Construction
*For any* set of agent signals with at least one YES-leaning signal and one NO-leaning signal, the system should construct both a bull thesis (direction YES) and a bear thesis (direction NO), each with core argument, catalysts, failure conditions, and supporting signals
**Validates: Requirements 9.1**

Property 13: Thesis Scoring
*For any* debate record generated from cross-examination, both the bull thesis and bear thesis should have numerical scores calculated from the test outcomes, with scores reflecting the strength of each thesis after adversarial testing
**Validates: Requirements 9.3**

Property 14: Debate Record Completeness
*For any* cross-examination execution, the debate record should contain all five test types (evidence, causality, timing, liquidity, tail-risk), each with claim, challenge, outcome, and score, plus a list of key disagreements between the theses
**Validates: Requirements 9.4**

Property 15: Debate Influence on Consensus
*For any* consensus probability calculation, the debate record scores should influence the final consensus probability, such that a thesis with higher debate score has greater weight in the consensus calculation
**Validates: Requirements 9.5**

Property 16: Consensus Probability Generation
*For any* set of agent signals (minimum 2 agents), the consensus engine should produce a consensus probability value between 0 and 1, representing the aggregated view of all agents
**Validates: Requirements 10.1**

Property 17: Disagreement Index Calculation
*For any* set of agent signals where agents have divergent fair_probability estimates (standard deviation > 0.15), the consensus should include a disagreement_index > 0.15, reflecting the lack of agent alignment
**Validates: Requirements 10.2**

Property 18: Confidence Band Provision
*For any* consensus probability calculated, the consensus object should include a confidence_band tuple with lower and upper bounds, where lower < consensus_probability < upper, and the band width reflects the disagreement_index
**Validates: Requirements 10.3**

Property 19: Regime Classification
*For any* consensus probability, the regime field should be exactly one of "high-confidence", "moderate-confidence", or "high-uncertainty", determined by the disagreement_index and confidence_band width
**Validates: Requirements 10.4**

Property 20: Signal Weighting
*For any* consensus calculation, agent signals with higher confidence values should receive greater weight in the consensus probability calculation, and if historical accuracy data is available, agents with better track records should receive additional weight
**Validates: Requirements 10.5**

Property 21: Recommendation Action Validity
*For any* trade recommendation generated, the action field should be exactly one of "LONG_YES", "LONG_NO", or "NO_TRADE", with no other values permitted
**Validates: Requirements 11.1**

Property 22: Recommendation Completeness
*For any* trade recommendation with action "LONG_YES" or "LONG_NO", the recommendation should include all required fields: entry_zone (tuple), target_zone (tuple), expected_value (float), win_probability (float), liquidity_risk (enum), explanation (with summary, core_thesis, key_catalysts, failure_scenarios), and metadata (with consensus_probability, market_probability, edge, confidence_band)
**Validates: Requirements 11.2, 11.3, 11.4, 11.5**

Property 23: Configuration Validation
*For any* configuration with missing required fields (e.g., no Gradient AI credentials, no Polymarket API URL), the system should fail at startup with a clear validation error message indicating which required configuration is missing, rather than failing later during execution
**Validates: Requirements 12.4**

Property 24: Structured Error Handling
*For any* API call failure (Polymarket, Supabase, Gradient AI), the system should return a structured error object with error type, descriptive message, and retry information (if applicable), rather than raising a generic exception
**Validates: Requirements 13.1**

Property 25: Agent Failure Isolation
*For any* agent that fails during parallel execution, the failure should be recorded in agent_errors, but all other agents should complete successfully and their signals should be included in the final result
**Validates: Requirements 13.2**

Property 26: Database Fallback
*For any* database operation failure (connection error, query timeout), the system should log the error, fall back to in-memory state management, and continue workflow execution without crashing
**Validates: Requirements 13.3**

Property 27: Timeout Handling
*For any* LLM call that exceeds the configured timeout, the system should cancel the call, return a partial result with an error indicator in the agent_errors list, and continue with remaining workflow stages
**Validates: Requirements 13.4**

Property 28: Exponential Backoff
*For any* retryable error (rate limit, temporary network failure), the system should retry with exponentially increasing delays (e.g., 1s, 2s, 4s, 8s) up to the maximum retry count, rather than retrying immediately or with fixed delays
**Validates: Requirements 13.5**

## Error Handling

### Error Types

The system defines structured error types for different failure scenarios:

**IngestionError**:
- `API_UNAVAILABLE`: Polymarket API is unreachable
- `RATE_LIMIT_EXCEEDED`: API rate limit hit, includes retry_after
- `INVALID_MARKET_ID`: Condition ID not found
- `INVALID_EVENT_ID`: Event ID not found
- `VALIDATION_FAILED`: Data validation error

**AgentError**:
- `TIMEOUT`: Agent execution exceeded timeout
- `EXECUTION_FAILED`: Agent LLM call or processing failed

**RecommendationError**:
- `INSUFFICIENT_DATA`: Not enough agent signals to generate recommendation
- `CONSENSUS_FAILED`: Unable to calculate consensus probability
- `NO_EDGE`: No trading edge detected (edge < threshold)

### Error Handling Strategy

1. **Graceful Degradation**: Agent failures don't stop the workflow; remaining agents continue
2. **Structured Errors**: All errors are typed and include context for debugging
3. **Retry Logic**: Transient errors (rate limits, network) are retried with exponential backoff
4. **Fallback Mechanisms**: Database failures fall back to in-memory state
5. **Partial Results**: Timeouts return partial results rather than complete failure
6. **Error Propagation**: Errors are collected in state and included in audit log

### Error Recovery Patterns

```python
# API call with retry
async def fetch_with_retry(
    url: str,
    max_retries: int = 3
) -> Result[Dict, IngestionError]:
    for attempt in range(max_retries):
        try:
            response = await httpx.get(url)
            response.raise_for_status()
            return Ok(response.json())
        except httpx.HTTPStatusError as e:
            if e.response.status_code == 429:  # Rate limit
                retry_after = int(e.response.headers.get("Retry-After", 2 ** attempt))
                await asyncio.sleep(retry_after)
                continue
            return Err(IngestionError(type="API_UNAVAILABLE", message=str(e)))
        except Exception as e:
            if attempt == max_retries - 1:
                return Err(IngestionError(type="API_UNAVAILABLE", message=str(e)))
            await asyncio.sleep(2 ** attempt)
    
    return Err(IngestionError(type="API_UNAVAILABLE", message="Max retries exceeded"))

# Agent execution with timeout
async def execute_agent_with_timeout(
    agent_fn: Callable,
    state: GraphState,
    timeout_ms: int
) -> Dict[str, Any]:
    try:
        result = await asyncio.wait_for(
            agent_fn(state),
            timeout=timeout_ms / 1000
        )
        return result
    except asyncio.TimeoutError:
        return {
            "agent_errors": [AgentError(
                type="TIMEOUT",
                agent_name=agent_fn.__name__,
                timeout_ms=timeout_ms
            )]
        }
    except Exception as e:
        return {
            "agent_errors": [AgentError(
                type="EXECUTION_FAILED",
                agent_name=agent_fn.__name__,
                error=e
            )]
        }

# Database fallback
async def save_with_fallback(
    data: Any,
    persistence: PersistenceLayer,
    in_memory_store: Dict
) -> None:
    try:
        await persistence.save(data)
    except Exception as e:
        logger.warning(f"Database save failed, using in-memory: {e}")
        in_memory_store[data.id] = data
```

## Testing Strategy

### Dual Testing Approach

The system requires both unit tests and property-based tests for comprehensive coverage:

**Unit Tests**:
- Specific examples of market data transformations
- Edge cases (empty agent signals, single agent, all agents fail)
- Error conditions (API failures, timeouts, invalid data)
- Integration points (database connections, LLM calls)
- CLI command execution

**Property-Based Tests**:
- Universal properties across all inputs (see Correctness Properties section)
- Randomized market data, agent signals, and configurations
- Comprehensive input coverage through generation
- Minimum 100 iterations per property test

### Property-Based Testing Configuration

**Testing Library**: Use `hypothesis` for Python property-based testing

**Test Configuration**:
```python
from hypothesis import given, settings, strategies as st

@settings(max_examples=100)
@given(
    condition_id=st.text(min_size=10, max_size=50),
    market_data=st.builds(PolymarketMarket),
    event_data=st.builds(PolymarketEvent)
)
def test_market_data_ingestion_pipeline(condition_id, market_data, event_data):
    """
    Feature: tradewizard-doa-replication, Property 1: Market Data Ingestion Pipeline
    
    For any valid Polymarket condition ID, fetching market data should successfully
    retrieve market details, related event data, and transform them into a valid
    Market Briefing Document with all required fields populated.
    """
    # Test implementation
```

**Test Tagging**: Each property test must reference its design document property:
```python
# Feature: tradewizard-doa-replication, Property {number}: {property_text}
```

### Unit Test Organization

```
tests/
├── unit/
│   ├── test_polymarket_client.py
│   ├── test_agent_factory.py
│   ├── test_state_management.py
│   ├── test_persistence.py
│   └── test_cli.py
├── integration/
│   ├── test_workflow_execution.py
│   ├── test_database_integration.py
│   └── test_llm_integration.py
├── property/
│   ├── test_ingestion_properties.py
│   ├── test_agent_properties.py
│   ├── test_consensus_properties.py
│   └── test_recommendation_properties.py
└── fixtures/
    ├── market_data.json
    ├── event_data.json
    └── agent_signals.json
```

### Test Fixtures

Provide realistic test data for Polymarket markets:

```python
# tests/fixtures/market_data.py
SAMPLE_MARKET = {
    "id": "0x123...",
    "question": "Will Donald Trump win the 2024 US Presidential Election?",
    "conditionId": "0xabc...",
    "outcomes": '["Yes", "No"]',
    "outcomePrices": "[0.52, 0.48]",
    "volume": "15000000",
    "liquidity": "2500000",
    "active": True,
    "closed": False,
    # ... (other fields)
}

SAMPLE_EVENT = {
    "id": "event-123",
    "title": "2024 US Presidential Election",
    "description": "Markets related to the 2024 US Presidential Election",
    "markets": [SAMPLE_MARKET],
    "tags": [{"id": 2, "label": "Politics", "slug": "politics"}],
    # ... (other fields)
}
```

### Integration Testing

Test end-to-end workflows with real external services (in test environment):

```python
@pytest.mark.integration
async def test_full_market_analysis_workflow():
    """Test complete workflow from condition ID to recommendation."""
    config = load_test_config()
    condition_id = "0xtest123"
    
    result = await analyze_market(condition_id, config)
    
    assert result.recommendation is not None
    assert result.recommendation.action in ["LONG_YES", "LONG_NO", "NO_TRADE"]
    assert len(result.agent_signals) >= config.agents.min_agents_required
    assert result.recommendation.metadata.consensus_probability >= 0
    assert result.recommendation.metadata.consensus_probability <= 1
```

### Mocking Strategy

Mock external services for unit tests:

```python
@pytest.fixture
def mock_polymarket_client(monkeypatch):
    """Mock Polymarket API client."""
    async def mock_fetch_market_data(condition_id):
        return Ok(SAMPLE_MARKET)
    
    async def mock_fetch_event_data(event_id):
        return Ok(SAMPLE_EVENT)
    
    monkeypatch.setattr(
        "tools.polymarket_client.PolymarketClient.fetch_market_data",
        mock_fetch_market_data
    )
    monkeypatch.setattr(
        "tools.polymarket_client.PolymarketClient.fetch_event_data",
        mock_fetch_event_data
    )

@pytest.fixture
def mock_gradient_llm(monkeypatch):
    """Mock Gradient AI LLM calls."""
    async def mock_invoke(messages):
        return AgentSignal(
            agent_name="test_agent",
            timestamp=int(time.time()),
            confidence=0.7,
            direction="YES",
            fair_probability=0.55,
            key_drivers=["Test driver 1", "Test driver 2"],
            risk_factors=["Test risk 1"],
            metadata={}
        )
    
    monkeypatch.setattr(
        "langchain_gradient.ChatGradient.invoke",
        mock_invoke
    )
```

## Implementation Notes

### Python-Specific Considerations

1. **Async/Await**: Use `asyncio` for all I/O operations (API calls, database queries, LLM calls)
2. **Type Hints**: Use Python 3.10+ type hints throughout (`str`, `int`, `float`, `List`, `Dict`, `Optional`, `Literal`)
3. **Pydantic Models**: Use Pydantic v2 for all data models with validation
4. **Error Handling**: Use `Result` type (Ok/Err) for operations that can fail
5. **Logging**: Use Python's `logging` module with structured logging
6. **Configuration**: Use `python-dotenv` for environment variables
7. **Testing**: Use `pytest` for unit tests, `hypothesis` for property tests

### LangGraph Integration

1. **State Definition**: Use `TypedDict` with `Annotated` fields for reducers
2. **Node Functions**: All nodes are async functions that take `GraphState` and return `Dict[str, Any]`
3. **Parallel Execution**: Use `Send` API for dispatching parallel agents
4. **Checkpointing**: Support both `MemorySaver` and PostgreSQL checkpointers
5. **Error Handling**: Nodes return partial state updates, errors are accumulated in state

### Gradient AI Integration

1. **Model Selection**: Use `ChatGradient` with model name (e.g., "openai-gpt-4.1")
2. **Structured Output**: Use `.with_structured_output(PydanticModel)` for agent signals
3. **Callbacks**: Pass Opik callback handler to LLM invocations
4. **Temperature**: Use 0.2-0.3 for agents (balance creativity and consistency)
5. **Timeout**: Set reasonable timeouts (30-45s) for LLM calls

### Database Schema

```sql
-- Markets table
CREATE TABLE markets (
    condition_id TEXT PRIMARY KEY,
    market_id TEXT NOT NULL,
    question TEXT NOT NULL,
    event_type TEXT NOT NULL,
    current_probability REAL NOT NULL,
    liquidity_score REAL NOT NULL,
    volume_24h REAL NOT NULL,
    metadata JSONB NOT NULL,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

-- Agent signals table
CREATE TABLE agent_signals (
    id SERIAL PRIMARY KEY,
    condition_id TEXT NOT NULL REFERENCES markets(condition_id),
    agent_name TEXT NOT NULL,
    timestamp BIGINT NOT NULL,
    confidence REAL NOT NULL,
    direction TEXT NOT NULL,
    fair_probability REAL NOT NULL,
    key_drivers JSONB NOT NULL,
    risk_factors JSONB NOT NULL,
    metadata JSONB NOT NULL,
    created_at TIMESTAMP DEFAULT NOW()
);

-- Recommendations table
CREATE TABLE recommendations (
    id SERIAL PRIMARY KEY,
    condition_id TEXT NOT NULL REFERENCES markets(condition_id),
    action TEXT NOT NULL,
    entry_zone JSONB NOT NULL,
    target_zone JSONB NOT NULL,
    expected_value REAL NOT NULL,
    win_probability REAL NOT NULL,
    liquidity_risk TEXT NOT NULL,
    explanation JSONB NOT NULL,
    metadata JSONB NOT NULL,
    created_at TIMESTAMP DEFAULT NOW()
);

-- Analysis history table
CREATE TABLE analysis_history (
    id SERIAL PRIMARY KEY,
    condition_id TEXT NOT NULL REFERENCES markets(condition_id),
    analysis_timestamp BIGINT NOT NULL,
    agent_count INTEGER NOT NULL,
    consensus_probability REAL NOT NULL,
    disagreement_index REAL NOT NULL,
    recommendation_action TEXT NOT NULL,
    audit_log JSONB NOT NULL,
    created_at TIMESTAMP DEFAULT NOW()
);

-- Indexes for performance
CREATE INDEX idx_agent_signals_condition_agent ON agent_signals(condition_id, agent_name);
CREATE INDEX idx_agent_signals_timestamp ON agent_signals(timestamp DESC);
CREATE INDEX idx_recommendations_condition ON recommendations(condition_id);
CREATE INDEX idx_analysis_history_condition ON analysis_history(condition_id);
```

### File Structure

```
doa/
├── main.py                          # Main entry point and workflow
├── cli.py                           # CLI interface
├── config.py                        # Configuration management
├── prompts.py                       # All agent system prompts
├── requirements.txt                 # Python dependencies
├── .env.example                     # Example environment variables
├── README.md                        # Setup and usage documentation
│
├── models/
│   ├── __init__.py
│   ├── state.py                     # LangGraph state definition
│   ├── types.py                     # Pydantic data models
│   └── schemas.py                   # Validation schemas
│
├── agents/
│   ├── __init__.py
│   ├── agent_factory.py             # Agent node factory
│   ├── market_microstructure.py     # MVP agent
│   ├── probability_baseline.py      # MVP agent
│   ├── risk_assessment.py           # MVP agent
│   ├── breaking_news.py             # Event intelligence agent
│   ├── event_impact.py              # Event intelligence agent
│   ├── polling_intelligence.py      # Polling agent
│   ├── historical_pattern.py        # Statistical agent
│   ├── media_sentiment.py           # Sentiment agent
│   ├── social_sentiment.py          # Sentiment agent
│   ├── narrative_velocity.py        # Narrative agent
│   ├── momentum.py                  # Price action agent
│   ├── mean_reversion.py            # Price action agent
│   ├── catalyst.py                  # Event scenario agent
│   └── tail_risk.py                 # Event scenario agent
│
├── nodes/
│   ├── __init__.py
│   ├── market_ingestion.py          # Market data ingestion
│   ├── memory_retrieval.py          # Historical signal retrieval
│   ├── keyword_extraction.py        # Keyword extraction
│   ├── dynamic_agent_selection.py   # Agent selection logic
│   ├── agent_signal_fusion.py       # Signal aggregation
│   ├── thesis_construction.py       # Bull/bear thesis building
│   ├── cross_examination.py         # Thesis testing
│   ├── consensus_engine.py          # Consensus calculation
│   └── recommendation_generation.py # Final recommendation
│
├── tools/
│   ├── __init__.py
│   ├── polymarket_client.py         # Polymarket API client
│   └── serper_search.py             # Web search tool (existing)
│
├── database/
│   ├── __init__.py
│   ├── supabase_client.py           # Supabase connection
│   ├── persistence.py               # Data persistence layer
│   ├── memory_retrieval.py          # Memory query service
│   └── migrations/
│       └── 001_initial_schema.sql   # Database schema
│
├── utils/
│   ├── __init__.py
│   ├── llm_factory.py               # LLM instance creation
│   ├── memory_formatter.py          # Format memory context
│   ├── audit_logger.py              # Structured logging
│   └── result.py                    # Result type (Ok/Err)
│
└── tests/
    ├── unit/
    ├── integration/
    ├── property/
    └── fixtures/
```

### Dependencies

```txt
# requirements.txt
langgraph>=0.2.0
langchain-core>=0.3.0
langchain-gradient>=0.1.0
pydantic>=2.0.0
python-dotenv>=1.0.0
httpx>=0.27.0
supabase>=2.0.0
opik>=0.1.0
click>=8.1.0
pytest>=8.0.0
pytest-asyncio>=0.23.0
hypothesis>=6.100.0
```

### Environment Variables

```bash
# .env.example

# Polymarket Configuration
POLYMARKET_GAMMA_API_URL=https://gamma-api.polymarket.com
POLYMARKET_CLOB_API_URL=https://clob.polymarket.com
POLYMARKET_RATE_LIMIT_BUFFER=80

# Gradient AI Configuration
GRADIENT_ACCESS_TOKEN=your_gradient_token_here
GRADIENT_WORKSPACE_ID=your_workspace_id_here

# Supabase Configuration
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_KEY=your_supabase_key_here

# Opik Configuration
OPIK_API_KEY=your_opik_key_here
OPIK_PROJECT_NAME=tradewizard-doa
OPIK_WORKSPACE=your_workspace

# Agent Configuration
AGENT_TIMEOUT_MS=30000
MIN_AGENTS_REQUIRED=2

# Consensus Configuration
MIN_EDGE_THRESHOLD=0.05
HIGH_DISAGREEMENT_THRESHOLD=0.15

# Memory System Configuration
MEMORY_SYSTEM_ENABLED=true
MAX_SIGNALS_PER_AGENT=3
MEMORY_QUERY_TIMEOUT_MS=5000

# Logging Configuration
LOG_LEVEL=info
```
