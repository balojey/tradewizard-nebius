# Design Document: Autonomous News and Polling Agents for DOA

## Overview

This design implements autonomous tool-calling capabilities for the DOA (Debate-Oriented Analysis) system by porting the ReAct (Reasoning + Acting) pattern from tradewizard-agents to Python. The system enables three intelligence agents (Breaking News, Media Sentiment, Polling Intelligence) to autonomously fetch external data using LangChain tools, cache results, and log all operations.

The design follows the existing DOA architecture patterns while introducing new capabilities:
- **NewsData API Client**: Python HTTP client for NewsData.io API
- **Polymarket Tools**: LangChain tools for fetching market data
- **Tool Cache**: Session-scoped caching to avoid redundant API calls
- **Autonomous Agent Factory**: Factory for creating ReAct agents with tools
- **Audit Logging**: Comprehensive logging of all tool invocations

## Architecture

### High-Level Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    DOA Workflow (LangGraph)                  │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│              Autonomous Agent Nodes (ReAct)                  │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐      │
│  │ Breaking     │  │ Media        │  │ Polling      │      │
│  │ News Agent   │  │ Sentiment    │  │ Intelligence │      │
│  │              │  │ Agent        │  │ Agent        │      │
│  └──────────────┘  └──────────────┘  └──────────────┘      │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                    Tool Layer (LangChain)                    │
│  ┌──────────────────────────┐  ┌──────────────────────────┐ │
│  │   NewsData Tools         │  │   Polymarket Tools       │ │
│  │  • fetch_latest_news     │  │  • fetch_related_markets │ │
│  │  • fetch_archive_news    │  │  • fetch_historical_prices│ │
│  │  • fetch_crypto_news     │  │  • fetch_cross_market_data│ │
│  │  • fetch_market_news     │  │  • analyze_market_momentum│ │
│  │                          │  │  • detect_sentiment_shifts│ │
│  └──────────────────────────┘  └──────────────────────────┘ │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                    Infrastructure Layer                      │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐      │
│  │ NewsData     │  │ Polymarket   │  │ Tool Cache   │      │
│  │ Client       │  │ Client       │  │              │      │
│  │ (HTTP)       │  │ (HTTP)       │  │ (In-Memory)  │      │
│  └──────────────┘  └──────────────┘  └──────────────┘      │
└─────────────────────────────────────────────────────────────┘
```

### ReAct Pattern Flow

```
Agent Receives Market Context
         │
         ▼
    ┌────────┐
    │ Reason │ ◄──────────┐
    └────────┘            │
         │                │
         ▼                │
    ┌────────┐            │
    │  Act   │            │
    │ (Call  │            │
    │ Tools) │            │
    └────────┘            │
         │                │
         ▼                │
    ┌────────┐            │
    │Observe │            │
    │Results │            │
    └────────┘            │
         │                │
         ▼                │
    Need More Data? ──────┘
         │ No
         ▼
    Generate Signal
```

## Components and Interfaces

### 1. NewsData API Client (`tools/newsdata_client.py`)

**Purpose**: HTTP client for NewsData.io API with async support.

**Interface**:
```python
class NewsDataClient:
    """Async HTTP client for NewsData.io API."""
    
    def __init__(
        self,
        api_key: str,
        base_url: str = "https://newsdata.io/api/1",
        timeout: int = 30
    ):
        """Initialize client with API key and configuration."""
        pass
    
    async def fetch_latest_news(
        self,
        query: Optional[str] = None,
        qInTitle: Optional[str] = None,
        timeframe: str = "24h",
        country: Optional[List[str]] = None,
        category: Optional[List[str]] = None,
        language: List[str] = ["en"],
        sentiment: Optional[str] = None,
        size: int = 20,
        removeduplicate: bool = True
    ) -> Dict[str, Any]:
        """Fetch latest news from past 48 hours."""
        pass
    
    async def fetch_archive_news(
        self,
        from_date: str,
        to_date: str,
        query: Optional[str] = None,
        qInTitle: Optional[str] = None,
        country: Optional[List[str]] = None,
        category: Optional[List[str]] = None,
        language: List[str] = ["en"],
        size: int = 20,
        removeduplicate: bool = True
    ) -> Dict[str, Any]:
        """Fetch historical news with date range."""
        pass
    
    async def fetch_crypto_news(
        self,
        coin: Optional[List[str]] = None,
        query: Optional[str] = None,
        qInTitle: Optional[str] = None,
        timeframe: Optional[str] = None,
        from_date: Optional[str] = None,
        to_date: Optional[str] = None,
        sentiment: Optional[str] = None,
        language: List[str] = ["en"],
        size: int = 20,
        removeduplicate: bool = True
    ) -> Dict[str, Any]:
        """Fetch cryptocurrency-related news."""
        pass
    
    async def fetch_market_news(
        self,
        symbol: Optional[List[str]] = None,
        organization: Optional[List[str]] = None,
        query: Optional[str] = None,
        qInTitle: Optional[str] = None,
        timeframe: Optional[str] = None,
        from_date: Optional[str] = None,
        to_date: Optional[str] = None,
        sentiment: Optional[str] = None,
        country: Optional[List[str]] = None,
        language: List[str] = ["en"],
        size: int = 20,
        removeduplicate: bool = True
    ) -> Dict[str, Any]:
        """Fetch financial market and company news."""
        pass
```

**Implementation Details**:
- Uses `httpx.AsyncClient` for async HTTP requests
- Implements exponential backoff for rate limiting
- Validates API responses and raises structured exceptions
- Supports all NewsData API parameters
- Returns raw JSON responses for tool layer to process

### 2. NewsData Tools (`tools/newsdata_tools.py`)

**Purpose**: LangChain tool wrappers for NewsData client with caching and audit logging.

**Interface**:
```python
from langchain_core.tools import StructuredTool
from pydantic import BaseModel, Field
from typing import List, Optional, Dict, Any

class FetchLatestNewsInput(BaseModel):
    """Input schema for fetch_latest_news tool."""
    query: Optional[str] = Field(None, description="Search query for article content")
    qInTitle: Optional[str] = Field(None, description="Search query for article titles only")
    timeframe: str = Field("24h", description="Time window: 1h, 6h, 12h, 24h, 48h")
    country: Optional[List[str]] = Field(None, description="Country codes (e.g., ['us', 'uk'])")
    category: Optional[List[str]] = Field(None, description="News categories")
    language: List[str] = Field(["en"], description="Language codes")
    sentiment: Optional[str] = Field(None, description="Filter by sentiment: positive, negative, neutral")
    size: int = Field(20, description="Number of articles (1-50)")
    removeduplicate: bool = Field(True, description="Remove duplicate articles")

class ToolContext(BaseModel):
    """Context for tool execution."""
    newsdata_client: Any  # NewsDataClient instance
    cache: Any  # ToolCache instance
    audit_log: List[Dict[str, Any]]
    agent_name: str

def create_fetch_latest_news_tool(context: ToolContext) -> StructuredTool:
    """Create fetch_latest_news tool with context."""
    pass

def create_fetch_archive_news_tool(context: ToolContext) -> StructuredTool:
    """Create fetch_archive_news tool with context."""
    pass

def create_fetch_crypto_news_tool(context: ToolContext) -> StructuredTool:
    """Create fetch_crypto_news tool with context."""
    pass

def create_fetch_market_news_tool(context: ToolContext) -> StructuredTool:
    """Create fetch_market_news tool with context."""
    pass

def get_tool_usage_summary(audit_log: List[Dict[str, Any]]) -> Dict[str, Any]:
    """Generate summary statistics from audit log."""
    pass
```

**Implementation Details**:
- Each tool wraps a NewsData client method
- Tools use Pydantic models for input validation
- Tool execution wrapper handles caching, audit logging, and error handling
- Audit entries include: tool name, parameters, result, duration, cache status
- Tools return structured article data or error messages
- Cache keys are generated from tool name + sorted parameters

### 3. Polymarket Tools (`tools/polymarket_tools.py`)

**Purpose**: LangChain tool wrappers for Polymarket client with caching and audit logging.

**Interface**:
```python
from langchain_core.tools import StructuredTool
from pydantic import BaseModel, Field
from typing import List, Optional, Dict, Any

class FetchRelatedMarketsInput(BaseModel):
    """Input schema for fetch_related_markets tool."""
    condition_id: str = Field(..., description="Condition ID of the market")
    limit: int = Field(10, description="Maximum number of related markets to return")

class FetchHistoricalPricesInput(BaseModel):
    """Input schema for fetch_historical_prices tool."""
    condition_id: str = Field(..., description="Condition ID of the market")
    timeframe: str = Field("7d", description="Time window: 1d, 7d, 30d, 90d")

class FetchCrossMarketDataInput(BaseModel):
    """Input schema for fetch_cross_market_data tool."""
    condition_ids: List[str] = Field(..., description="List of condition IDs to compare")

class AnalyzeMarketMomentumInput(BaseModel):
    """Input schema for analyze_market_momentum tool."""
    condition_id: str = Field(..., description="Condition ID of the market")
    timeframe: str = Field("24h", description="Time window for momentum analysis")

class DetectSentimentShiftsInput(BaseModel):
    """Input schema for detect_sentiment_shifts tool."""
    condition_id: str = Field(..., description="Condition ID of the market")
    threshold: float = Field(0.05, description="Minimum price change to detect (0-1)")

def create_fetch_related_markets_tool(context: ToolContext) -> StructuredTool:
    """Create fetch_related_markets tool with context."""
    pass

def create_fetch_historical_prices_tool(context: ToolContext) -> StructuredTool:
    """Create fetch_historical_prices tool with context."""
    pass

def create_fetch_cross_market_data_tool(context: ToolContext) -> StructuredTool:
    """Create fetch_cross_market_data tool with context."""
    pass

def create_analyze_market_momentum_tool(context: ToolContext) -> StructuredTool:
    """Create analyze_market_momentum tool with context."""
    pass

def create_detect_sentiment_shifts_tool(context: ToolContext) -> StructuredTool:
    """Create detect_sentiment_shifts tool with context."""
    pass

def get_tool_usage_summary(audit_log: List[Dict[str, Any]]) -> Dict[str, Any]:
    """Generate summary statistics from audit log."""
    pass
```

**Implementation Details**:
- Each tool wraps Polymarket client methods
- Tools use Pydantic models for input validation
- Tool execution wrapper handles caching, audit logging, and error handling
- Audit entries include: tool name, parameters, result, duration, cache status
- Tools return structured market data or error messages
- Cache keys are generated from tool name + sorted parameters

### 4. Tool Cache (`utils/tool_cache.py`)

**Purpose**: Session-scoped cache for tool results to avoid redundant API calls.

**Interface**:
```python
import hashlib
import json
from typing import Any, Optional, Dict

class ToolCache:
    """Session-scoped cache for tool results."""
    
    def __init__(self, session_id: str):
        """Initialize cache for a session."""
        self.session_id = session_id
        self._cache: Dict[str, Any] = {}
        self._hits = 0
        self._misses = 0
    
    def _generate_cache_key(self, tool_name: str, params: Any) -> str:
        """Generate deterministic cache key from tool name and parameters."""
        # Sort parameters for consistent keys
        sorted_params = json.dumps(params, sort_keys=True)
        key_str = f"{tool_name}:{sorted_params}"
        return hashlib.sha256(key_str.encode()).hexdigest()
    
    def get(self, tool_name: str, params: Any) -> Optional[Any]:
        """Retrieve cached result if available."""
        key = self._generate_cache_key(tool_name, params)
        if key in self._cache:
            self._hits += 1
            return self._cache[key]
        self._misses += 1
        return None
    
    def set(self, tool_name: str, params: Any, result: Any) -> None:
        """Store result in cache."""
        key = self._generate_cache_key(tool_name, params)
        self._cache[key] = result
    
    def clear(self) -> None:
        """Clear all cached entries."""
        self._cache.clear()
        self._hits = 0
        self._misses = 0
    
    def get_stats(self) -> Dict[str, Any]:
        """Get cache statistics."""
        total = self._hits + self._misses
        hit_rate = self._hits / total if total > 0 else 0.0
        return {
            "hits": self._hits,
            "misses": self._misses,
            "hit_rate": hit_rate,
            "size": len(self._cache)
        }
```

**Implementation Details**:
- Cache is scoped to a session (identified by condition_id)
- Cache keys are SHA-256 hashes of tool name + sorted parameters
- Parameters are JSON-serialized with sorted keys for deterministic hashing
- Cache tracks hits, misses, and hit rate for monitoring
- Cache is in-memory only (not persisted across sessions)

### 5. Autonomous Agent Factory (`agents/autonomous_agent_factory.py`)

**Purpose**: Factory for creating ReAct agents with tools and consistent configuration.

**Interface**:
```python
from langgraph.prebuilt import create_react_agent
from langchain_core.language_models import BaseChatModel
from langchain_core.tools import BaseTool
from typing import List, Callable, Dict, Any
from models.state import GraphState
from models.types import AgentSignal

def create_autonomous_agent(
    agent_name: str,
    system_prompt: str,
    llm: BaseChatModel,
    tools: List[BaseTool],
    max_tool_calls: int = 5,
    timeout_ms: int = 45000
) -> Callable:
    """
    Create a ReAct agent with tools.
    
    Args:
        agent_name: Unique identifier for the agent
        system_prompt: System prompt defining agent's role and strategy
        llm: LLM instance for reasoning
        tools: List of LangChain tools available to the agent
        max_tool_calls: Maximum tool calls per analysis (default: 5)
        timeout_ms: Timeout in milliseconds (default: 45000)
        
    Returns:
        Agent executor function
    """
    # Create ReAct agent using LangGraph
    agent = create_react_agent(
        model=llm,
        tools=tools,
        state_modifier=system_prompt
    )
    
    return agent

def create_autonomous_agent_node(
    agent_name: str,
    system_prompt: str,
    tools: List[BaseTool],
    config: Any,  # EngineConfig
    tool_context: Dict[str, Any]
) -> Callable[[GraphState], Dict[str, Any]]:
    """
    Create a LangGraph node for an autonomous agent.
    
    This wraps the ReAct agent with:
    - Timeout handling
    - Output parsing and validation
    - Tool usage metadata extraction
    - Error handling and graceful degradation
    - Audit logging
    
    Args:
        agent_name: Unique identifier for the agent
        system_prompt: System prompt defining agent's role
        tools: List of LangChain tools
        config: Engine configuration
        tool_context: Tool execution context (client, cache, audit log)
        
    Returns:
        Async function that takes GraphState and returns state update
    """
    pass
```

**Implementation Details**:
- Uses LangGraph's `create_react_agent` for ReAct pattern
- Agent executor follows: reason → act → observe → repeat loop
- Recursion limit set to `max_tool_calls + 10` (extra for reasoning)
- Timeout implemented using `asyncio.wait_for`
- On timeout: returns partial results with reduced confidence
- On tool failures: continues with available data, adjusts confidence
- Output parsing extracts AgentSignal from agent messages
- Tool usage metadata extracted from audit log and added to signal

### 6. Autonomous Agent Implementations

#### Breaking News Agent (`agents/breaking_news.py`)

**Purpose**: Autonomous agent that fetches and analyzes breaking news.

**System Prompt Strategy**:
- Prioritize `fetch_latest_news` with short timeframes (1h, 6h)
- Use `queryInTitle` with key terms from market question
- Calculate breaking news velocity (articles per hour)
- Flag high activity when velocity > 5 articles/hour
- Identify breaking news themes by clustering keywords

**Tool Selection Logic**:
- For all markets: Start with `fetch_latest_news` (1h timeframe)
- For election markets: Use candidate names in `queryInTitle`, add country filters
- For crypto markets: Use `fetch_crypto_news` with coin symbols
- For policy markets: Use keywords like "bill", "legislation", "vote"
- For company markets: Use `fetch_market_news` with organization names

#### Media Sentiment Agent (`agents/media_sentiment.py`)

**Purpose**: Autonomous agent that analyzes media sentiment and narrative framing.

**System Prompt Strategy**:
- Make separate queries for positive, negative, and neutral sentiment
- Use `fetch_archive_news` to compare current vs historical sentiment
- Calculate aggregate sentiment distribution
- Weight sentiment by source priority and recency
- Identify sentiment shifts when recent differs from historical

**Tool Selection Logic**:
- Make 2-3 queries with different sentiment filters
- Use `fetch_latest_news` for current sentiment (24h)
- Use `fetch_archive_news` for historical comparison (7d ago)
- For crypto markets: Use `fetch_crypto_news` with sentiment filters
- For policy markets: Analyze framing and narrative patterns

#### Polling Intelligence Agent (`agents/polling_intelligence.py`)

**Purpose**: Autonomous agent that analyzes market as polling mechanism.

**System Prompt Strategy**:
- Use `fetch_related_markets` to find cross-market patterns
- Use `fetch_historical_prices` to analyze price trends
- Use `analyze_market_momentum` to detect momentum
- Use `detect_sentiment_shifts` to identify rapid changes
- Calculate crowd wisdom score from market quality indicators

**Tool Selection Logic**:
- Start with `fetch_related_markets` to find context
- Use `fetch_historical_prices` for trend analysis
- Use `analyze_market_momentum` when volume is high
- Use `detect_sentiment_shifts` when volatility is high
- Use `fetch_cross_market_data` when related markets exist

## Data Models

### Tool Audit Entry

```python
from pydantic import BaseModel
from typing import Any, Optional

class ToolAuditEntry(BaseModel):
    """Audit log entry for tool invocation."""
    tool_name: str
    timestamp: int  # Unix timestamp
    params: Dict[str, Any]
    result: Optional[Any] = None
    error: Optional[str] = None
    duration: int  # Milliseconds
    cache_hit: bool
    article_count: Optional[int] = None
```

### Tool Usage Summary

```python
class ToolUsageSummary(BaseModel):
    """Summary of tool usage for an agent."""
    tools_called: int
    total_tool_time: int  # Milliseconds
    cache_hits: int
    cache_misses: int
    tool_breakdown: Dict[str, int]  # tool_name -> call_count
    total_articles: int
    errors: int
```

### Agent Signal Metadata Extension

```python
# Extend existing AgentSignal.metadata with tool usage
{
    "tool_usage": {
        "tools_called": 3,
        "total_tool_time": 2500,  # ms
        "cache_hits": 1,
        "cache_misses": 2,
        "tool_breakdown": {
            "fetch_latest_news": 2,
            "fetch_archive_news": 1
        }
    },
    "tool_failures": {  # Optional, only if failures occurred
        "count": 1,
        "rate": 0.33,
        "failures": [
            {
                "tool_name": "fetch_crypto_news",
                "error": "Rate limit exceeded",
                "timestamp": 1234567890
            }
        ],
        "confidence_adjustment": 0.1
    }
}
```

## Correctness Properties

*A property is a characteristic or behavior that should hold true across all valid executions of a system-essentially, a formal statement about what the system should do. Properties serve as the bridge between human-readable specifications and machine-verifiable correctness guarantees.*

### Property 1: HTTP Request Formation Correctness
*For any* NewsData API method (latest, archive, crypto, market) and any valid parameter combination, the client SHALL construct an HTTP request with all provided parameters correctly encoded in the query string.
**Validates: Requirements 1.2, 1.3, 1.4, 1.5**

### Property 2: API Error Handling
*For any* API request that fails (network error, timeout, invalid response), the client SHALL raise an exception containing error details and context.
**Validates: Requirements 1.6, 1.8**

### Property 3: Response Parsing Correctness
*For any* valid JSON response from the NewsData API, the client SHALL successfully parse it and return structured data matching the expected schema.
**Validates: Requirements 1.7**

### Property 4: Tool Parameter Pass-Through
*For any* LangChain tool invocation with parameters, the tool SHALL pass those exact parameters to the underlying client method without modification.
**Validates: Requirements 2.1, 3.1**

### Property 5: Tool Audit Logging Completeness
*For any* tool invocation (successful or failed), the system SHALL create an audit entry containing tool name, parameters, timestamp, result/error, duration, and cache status.
**Validates: Requirements 2.2, 2.3, 2.4, 3.2, 3.3, 3.4**

### Property 6: Cache Hit Correctness
*For any* tool invocation where a cached result exists for the same tool name and parameters, the system SHALL return the cached result without making an API call.
**Validates: Requirements 2.5, 3.5**

### Property 7: Cache Miss and Storage
*For any* tool invocation where no cached result exists, the system SHALL make an API call and store the result in cache with a deterministic key based on tool name and sorted parameters.
**Validates: Requirements 2.6, 3.6, 4.2, 4.7**

### Property 8: Input Validation
*For any* tool invocation with invalid parameters (wrong types, missing required fields, out-of-range values), the system SHALL reject the invocation with a validation error before making any API calls.
**Validates: Requirements 2.8, 3.8**

### Property 9: Cache Key Determinism
*For any* tool name and parameter combination, generating a cache key multiple times SHALL produce identical keys, ensuring consistent cache behavior.
**Validates: Requirements 4.7, 4.8**

### Property 10: Cache Statistics Accuracy
*For any* sequence of cache operations (hits and misses), the cache statistics SHALL accurately reflect the number of hits, misses, and the calculated hit rate.
**Validates: Requirements 4.5**

### Property 11: Cache Clearing
*For any* cache with stored entries, calling clear() SHALL remove all entries and reset statistics to zero.
**Validates: Requirements 4.6**

### Property 12: Tool Call Limit Enforcement
*For any* autonomous agent analysis, the number of tool calls SHALL never exceed the configured maximum (default: 5).
**Validates: Requirements 6.3, 7.3, 8.3**

### Property 13: Agent Signal Structure
*For any* completed agent analysis (successful or timed out), the system SHALL return a structured AgentSignal that validates against the AgentSignal schema.
**Validates: Requirements 6.4, 7.4, 8.4**

### Property 14: Graceful Degradation on Tool Failures
*For any* agent analysis where some (but not all) tool calls fail, the agent SHALL continue execution with available data and reduce confidence proportionally to the failure rate.
**Validates: Requirements 6.5, 7.5, 8.5, 10.1**

### Property 15: Timeout Handling
*For any* agent analysis that exceeds the timeout threshold, the system SHALL return partial results with reduced confidence and timeout indication in metadata.
**Validates: Requirements 6.6, 7.6, 8.6, 10.3**

### Property 16: Tool Usage Metadata Inclusion
*For any* successful agent analysis, the returned AgentSignal SHALL include tool usage metadata containing tools_called, total_tool_time, cache_hits, cache_misses, and tool_breakdown.
**Validates: Requirements 6.7, 7.7, 8.7**

### Property 17: Comprehensive Audit Trail
*For any* agent analysis, the audit log SHALL contain entries for all tool invocations with complete information (tool name, parameters, result/error, duration, cache status).
**Validates: Requirements 6.8, 7.8, 8.8**

### Property 18: Complete Tool Failure Handling
*For any* agent analysis where all tool calls fail, the system SHALL return a low-confidence signal (confidence ≤ 0.3) with error details in risk factors.
**Validates: Requirements 10.2**

### Property 19: Rate Limit Handling
*For any* API request that encounters a rate limit error, the system SHALL handle it gracefully, include rate limit information in risk factors, and not crash the analysis.
**Validates: Requirements 10.4**

### Property 20: Network Error Retry
*For any* API request that encounters a network error, the system SHALL retry once before failing, and log both attempts in the audit trail.
**Validates: Requirements 10.5**

### Property 21: JSON Parsing Error Handling
*For any* API response with invalid JSON, the system SHALL log the parsing error and return a structured error response without crashing.
**Validates: Requirements 10.6**

### Property 22: Schema Validation Error Handling
*For any* agent output that fails schema validation, the system SHALL log validation errors and return a fallback signal with low confidence.
**Validates: Requirements 10.7**

### Property 23: Error Context Logging
*For any* critical error (timeout, complete failure, parsing error), the system SHALL include detailed error context in audit logs for debugging.
**Validates: Requirements 10.8**


### Property 1: HTTP Request Formation Correctness
*For any* NewsData API method (latest, archive, crypto, market) and any valid parameter combination, the client SHALL construct an HTTP request with all provided parameters correctly encoded in the query string.
**Validates: Requirements 1.2, 1.3, 1.4, 1.5**

### Property 2: API Error Handling
*For any* API request that fails (network error, timeout, invalid response), the client SHALL raise an exception containing error details and context.
**Validates: Requirements 1.6, 1.8**

### Property 3: Response Parsing Correctness
*For any* valid JSON response from the NewsData API, the client SHALL successfully parse it and return structured data matching the expected schema.
**Validates: Requirements 1.7**

### Property 4: Tool Parameter Pass-Through
*For any* LangChain tool invocation with parameters, the tool SHALL pass those exact parameters to the underlying client method without modification.
**Validates: Requirements 2.1, 3.1**

### Property 5: Tool Audit Logging Completeness
*For any* tool invocation (successful or failed), the system SHALL create an audit entry containing tool name, parameters, timestamp, result/error, duration, and cache status.
**Validates: Requirements 2.2, 2.3, 2.4, 3.2, 3.3, 3.4**

### Property 6: Cache Hit Correctness
*For any* tool invocation where a cached result exists for the same tool name and parameters, the system SHALL return the cached result without making an API call.
**Validates: Requirements 2.5, 3.5**

### Property 7: Cache Miss and Storage
*For any* tool invocation where no cached result exists, the system SHALL make an API call and store the result in cache with a deterministic key based on tool name and sorted parameters.
**Validates: Requirements 2.6, 3.6, 4.2, 4.7**

### Property 8: Input Validation
*For any* tool invocation with invalid parameters (wrong types, missing required fields, out-of-range values), the system SHALL reject the invocation with a validation error before making any API calls.
**Validates: Requirements 2.8, 3.8**

### Property 9: Cache Key Determinism
*For any* tool name and parameter combination, generating a cache key multiple times SHALL produce identical keys, ensuring consistent cache behavior.
**Validates: Requirements 4.7, 4.8**

### Property 10: Cache Statistics Accuracy
*For any* sequence of cache operations (hits and misses), the cache statistics SHALL accurately reflect the number of hits, misses, and the calculated hit rate.
**Validates: Requirements 4.5**

### Property 11: Cache Clearing
*For any* cache with stored entries, calling clear() SHALL remove all entries and reset statistics to zero.
**Validates: Requirements 4.6**

### Property 12: Tool Call Limit Enforcement
*For any* autonomous agent analysis, the number of tool calls SHALL never exceed the configured maximum (default: 5).
**Validates: Requirements 6.3, 7.3, 8.3**

### Property 13: Agent Signal Structure
*For any* completed agent analysis (successful or timed out), the system SHALL return a structured AgentSignal that validates against the AgentSignal schema.
**Validates: Requirements 6.4, 7.4, 8.4**

### Property 14: Graceful Degradation on Tool Failures
*For any* agent analysis where some (but not all) tool calls fail, the agent SHALL continue execution with available data and reduce confidence proportionally to the failure rate.
**Validates: Requirements 6.5, 7.5, 8.5, 10.1**

### Property 15: Timeout Handling
*For any* agent analysis that exceeds the timeout threshold, the system SHALL return partial results with reduced confidence and timeout indication in metadata.
**Validates: Requirements 6.6, 7.6, 8.6, 10.3**

### Property 16: Tool Usage Metadata Inclusion
*For any* successful agent analysis, the returned AgentSignal SHALL include tool usage metadata containing tools_called, total_tool_time, cache_hits, cache_misses, and tool_breakdown.
**Validates: Requirements 6.7, 7.7, 8.7**

### Property 17: Comprehensive Audit Trail
*For any* agent analysis, the audit log SHALL contain entries for all tool invocations with complete information (tool name, parameters, result/error, duration, cache status).
**Validates: Requirements 6.8, 7.8, 8.8**

### Property 18: Complete Tool Failure Handling
*For any* agent analysis where all tool calls fail, the system SHALL return a low-confidence signal (confidence ≤ 0.3) with error details in risk factors.
**Validates: Requirements 10.2**

### Property 19: Rate Limit Handling
*For any* API request that encounters a rate limit error, the system SHALL handle it gracefully, include rate limit information in risk factors, and not crash the analysis.
**Validates: Requirements 10.4**

### Property 20: Network Error Retry
*For any* API request that encounters a network error, the system SHALL retry once before failing, and log both attempts in the audit trail.
**Validates: Requirements 10.5**

### Property 21: JSON Parsing Error Handling
*For any* API response with invalid JSON, the system SHALL log the parsing error and return a structured error response without crashing.
**Validates: Requirements 10.6**

### Property 22: Schema Validation Error Handling
*For any* agent output that fails schema validation, the system SHALL log validation errors and return a fallback signal with low confidence.
**Validates: Requirements 10.7**

### Property 23: Error Context Logging
*For any* critical error (timeout, complete failure, parsing error), the system SHALL include detailed error context in audit logs for debugging.
**Validates: Requirements 10.8**

## Error Handling

### Error Categories

1. **API Errors**
   - Network failures (connection timeout, DNS resolution)
   - HTTP errors (4xx, 5xx status codes)
   - Rate limiting (429 Too Many Requests)
   - Invalid responses (malformed JSON, unexpected schema)

2. **Tool Errors**
   - Invalid parameters (validation failures)
   - Tool execution failures (client errors)
   - Cache errors (serialization failures)

3. **Agent Errors**
   - Timeout (exceeds configured threshold)
   - LLM
- Tool execution times
- Total analysis duration

Log these metrics to audit log for analysis and optimization.
at compatible)

### Performance Considerations

- Tool caching reduces API calls by ~60-80% (based on tradewizard-agents data)
- Autonomous agents add ~2-5 seconds per agent (tool execution time)
- Total analysis time: ~45-60 seconds (within existing timeout)
- API rate limits: NewsData allows 200 requests/day on free tier, 10,000/day on paid tier
- Recommend paid tier for production use

### Monitoring

Add monitoring for:
- Tool call counts per agent
- Cache hit rates
- API error rates
- Agent timeout ratess** (Replaces existing agents)
   - Add autonomous Breaking News agent
   - Add autonomous Media Sentiment agent
   - Add autonomous Polling Intelligence agent
   - Update workflow to use new agents
   - Remove old agent implementations

### Backward Compatibility

- Old agent implementations remain functional during migration
- Configuration is additive (new env vars, existing ones unchanged)
- Workflow can be toggled between old and new agents via feature flag
- Database schema unchanged (AgentSignal form
hypothesis>=6.100.0  # Property-based testing
pytest-httpx>=0.30.0  # HTTP mocking for tests
```

### Migration Path

1. **Phase 1: Infrastructure** (No breaking changes)
   - Add NewsData client
   - Add tool cache utility
   - Add configuration extensions
   - All new code, no modifications to existing agents

2. **Phase 2: Tools** (No breaking changes)
   - Add NewsData tools
   - Add Polymarket tools
   - Add autonomous agent factory
   - All new code, existing agents unchanged

3. **Phase 3: Autonomous Agent"MAX_TOOL_CALLS must be positive")
        if self.timeout_ms <= 0:
            errors.append("AGENT_TIMEOUT_MS must be positive")
        return errors

# Add to EngineConfig
@dataclass
class EngineConfig:
    # ... existing fields ...
    newsdata: NewsDataConfig
    autonomous_agents: AutonomousAgentConfig
```

## Deployment Considerations

### Dependencies

Add to `requirements.txt`:
```
httpx>=0.27.0  # Async HTTP client
langchain-core>=0.3.0  # LangChain core
langgraph>=0.2.0  # LangGraph for ReAct agentss.append("NEWSDATA_BASE_URL must be a valid URL")
        if self.timeout <= 0:
            errors.append("NewsData timeout must be positive")
        return errors

@dataclass
class AutonomousAgentConfig:
    """Autonomous agent configuration."""
    enabled: bool
    max_tool_calls: int
    timeout_ms: int
    cache_enabled: bool
    
    def validate(self) -> List[str]:
        """Validate autonomous agent configuration."""
        errors = []
        if self.max_tool_calls <= 0:
            errors.append(ration Model Extension

Extend existing `EngineConfig` in `config.py`:

```python
@dataclass
class NewsDataConfig:
    """NewsData API configuration."""
    api_key: str
    base_url: str = "https://newsdata.io/api/1"
    timeout: int = 30
    
    def validate(self) -> List[str]:
        """Validate NewsData configuration."""
        errors = []
        if not self.api_key:
            errors.append("NEWSDATA_API_KEY is required")
        if not self.base_url.startswith(("http://", "https://")):
            errorOA)
POLYMARKET_GAMMA_API_URL=https://gamma-api.polymarket.com
POLYMARKET_CLOB_API_URL=https://clob.polymarket.com

# Agent Configuration
AUTONOMOUS_AGENTS_ENABLED=true  # Enable autonomous agents
MAX_TOOL_CALLS=5  # Maximum tool calls per agent
AGENT_TIMEOUT_MS=45000  # Agent timeout in milliseconds
TOOL_CACHE_ENABLED=true  # Enable tool result caching

# LLM Configuration (already exists in DOA)
DIGITALOCEAN_INFERENCE_KEY=your_llm_api_key
LLM_MODEL_NAME=llama-3.3-70b-instruct
LLM_TEMPERATURE=0.7
```

### Configu*:
- Use in-memory cache for tests (no mocking needed)
- Clear cache between tests for isolation

### Coverage Goals

- Line coverage: > 90%
- Branch coverage: > 85%
- Property test coverage: All 23 properties implemented
- Integration test coverage: All critical paths tested

## Configuration

### Environment Variables

```bash
# NewsData API Configuration
NEWSDATA_API_KEY=your_api_key_here
NEWSDATA_BASE_URL=https://newsdata.io/api/1  # Optional, defaults to this

# Polymarket API Configuration (already exists in D Generate synthetic market data for edge cases
- Generate synthetic news articles for specific scenarios

### Mocking Strategy

**Mock External APIs**:
- Use `pytest-httpx` for mocking HTTP requests
- Create fixtures for common API responses
- Create fixtures for error responses (rate limits, timeouts, invalid JSON)

**Mock LLM Responses**:
- Use `unittest.mock` to mock LLM invocations
- Create fixtures for valid AgentSignal outputs
- Create fixtures for invalid outputs (schema validation failures)

**Mock Cache*Agent property tests

### Integration Tests

**End-to-End Tests**:
- Test complete workflow: market ingestion → autonomous agent → signal output
- Test with real API calls (using test API keys)
- Test with mocked API responses (for deterministic testing)
- Test timeout scenarios with slow API responses
- Test rate limiting scenarios
- Test graceful degradation with injected failures

**Test Data**:
- Use real market data from Polymarket
- Use real news articles from NewsData (cached for deterministic tests)
-test_autonomous_agent_factory.py` - Agent factory tests
- `agents/test_breaking_news.py` - Breaking News agent tests
- `agents/test_media_sentiment.py` - Media Sentiment agent tests
- `agents/test_polling_intelligence.py` - Polling Intelligence agent tests

**Property Tests**:
- `tools/test_newsdata_client.property.py` - Client property tests
- `tools/test_newsdata_tools.property.py` - Tools property tests
- `utils/test_tool_cache.property.py` - Cache property tests
- `agents/test_autonomous_agents.property.py` - he("test_session")
    
    # Generate key twice with same inputs
    key1 = cache._generate_cache_key(tool_name, params)
    key2 = cache._generate_cache_key(tool_name, params)
    
    # Keys must be identical
    assert key1 == key2
```

### Test Organization

**Unit Tests**:
- `tools/test_newsdata_client.py` - NewsData client tests
- `tools/test_newsdata_tools.py` - NewsData tools tests
- `tools/test_polymarket_tools.py` - Polymarket tools tests
- `utils/test_tool_cache.py` - Tool cache tests
- `agents/
**Example Property Test**:
```python
from hypothesis import given, strategies as st
import pytest

# Feature: autonomous-news-polling-agents, Property 9: Cache Key Determinism
@given(
    tool_name=st.text(min_size=1),
    params=st.dictionaries(
        keys=st.text(min_size=1),
        values=st.one_of(st.text(), st.integers(), st.floats(), st.booleans())
    )
)
def test_cache_key_determinism(tool_name, params):
    """For any tool name and parameters, cache keys should be deterministic."""
    cache = ToolCac across all inputs (see Correctness Properties section)
- Randomized parameter generation for tools
- Randomized cache operations
- Randomized error injection for graceful degradation

### Property-Based Testing Configuration

**Framework**: Use `hypothesis` library for Python property-based testing

**Configuration**:
- Minimum 100 iterations per property test
- Each test must reference its design document property
- Tag format: `# Feature: autonomous-news-polling-agents, Property {number}: {property_text}`
probability
4. Add "All tool calls failed" to risk factors

## Testing Strategy

### Dual Testing Approach

This feature requires both unit tests and property-based tests for comprehensive coverage:

**Unit Tests**:
- Specific examples of API requests and responses
- Edge cases (empty responses, single article, max size)
- Error conditions (network failures, rate limits, invalid JSON)
- Configuration loading and validation
- Cache initialization and clearing

**Property-Based Tests**:
- Universal propertiese confidence by 10% per failed tool (max 50% reduction)
3. Add tool failure details to risk factors
4. Include tool failure metadata in signal

When timeout occurs:
1. Return partial results from completed tools
2. Set confidence to 0.3 (low confidence)
3. Add timeout indication to metadata
4. Include "Analysis incomplete due to timeout" in key drivers

When all tools fail:
1. Return neutral signal (direction: NEUTRAL)
2. Set confidence to 0.2 (very low confidence)
3. Set fair probability to current market  fast with validation error (don't make API call)
- Tool execution failures: Log error, continue with other tools, adjust confidence
- Cache errors: Log warning, bypass cache, continue execution

**Agent Errors**:
- Timeout: Return partial results with reduced confidence (0.3)
- LLM failures: Retry once, then return fallback signal
- Schema validation: Log errors, return fallback signal with low confidence

### Graceful Degradation

When tool failures occur:
1. Continue execution with remaining tools
2. Reduc failures (invalid structured output)
   - Schema validation failures (output doesn't match AgentSignal)

### Error Handling Strategies

**API Errors**:
- Network failures: Retry once with exponential backoff, then fail gracefully
- HTTP 429 (rate limit): Wait for retry-after header, include in risk factors
- HTTP 4xx: Log error, don't retry, include in risk factors
- HTTP 5xx: Retry once, then fail gracefully
- Invalid JSON: Log error, return structured error response

**Tool Errors**:
- Invalid parameters: Fail


## Error Handling

### Error Categories

1. **API Errors**
   - Network failures (connection timeout, DNS resolution)
   - HTTP errors (4xx, 5xx status codes)
   - Rate limiting (429 Too Many Requests)
   - Invalid responses (malformed JSON, unexpected schema)

2. **Tool Errors**
   - Invalid parameters (validation failures)
   - Tool execution failures (client errors)
   - Cache errors (serialization failures)

3. **Agent Errors**
   - Timeout (exceeds configured threshold)
   - LLM failures (invalid structured output)
   - Schema validation failures (output doesn't match AgentSignal)

### Error Handling Strategies

**API Errors**:
- Network failures: Retry once with exponential backoff, then fail gracefully
- HTTP 429 (rate limit): Wait for retry-after header, include in risk factors
- HTTP 4xx: Log error, don't retry, include in risk factors
- HTTP 5xx: Retry once, then fail gracefully
- Invalid JSON: Log error, return structured error response

**Tool Errors**:
- Invalid parameters: Fail fast with validation error (don't make API call)
- Tool execution failures: Log error, continue with other tools, adjust confidence
- Cache errors: Log warning, bypass cache, continue execution

**Agent Errors**:
- Timeout: Return partial results with reduced confidence (0.3)
- LLM failures: Retry once, then return fallback signal
- Schema validation: Log errors, return fallback signal with low confidence

### Graceful Degradation

When tool failures occur:
1. Continue execution with remaining tools
2. Reduce confidence by 10% per failed tool (max 50% reduction)
3. Add tool failure details to risk factors
4. Include tool failure metadata in signal

When timeout occurs:
1. Return partial results from completed tools
2. Set confidence to 0.3 (low confidence)
3. Add timeout indication to metadata
4. Include "Analysis incomplete due to timeout" in key drivers

When all tools fail:
1. Return neutral signal (direction: NEUTRAL)
2. Set confidence to 0.2 (very low confidence)
3. Set fair probability to current market probability
4. Add "All tool calls failed" to risk factors

## Testing Strategy

### Dual Testing Approach

This feature requires both unit tests and property-based tests for comprehensive coverage:

**Unit Tests**:
- Specific examples of API requests and responses
- Edge cases (empty responses, single article, max size)
- Error conditions (network failures, rate limits, invalid JSON)
- Configuration loading and validation
- Cache initialization and clearing

**Property-Based Tests**:
- Universal properties across all inputs (see Correctness Properties section)
- Randomized parameter generation for tools
- Randomized cache operations
- Randomized error injection for graceful degradation

### Property-Based Testing Configuration

**Framework**: Use `hypothesis` library for Python property-based testing

**Configuration**:
- Minimum 100 iterations per property test
- Each test must reference its design document property
- Tag format: `# Feature: autonomous-news-polling-agents, Property {number}: {property_text}`

**Example Property Test**:
```python
from hypothesis import given, strategies as st
import pytest

# Feature: autonomous-news-polling-agents, Property 9: Cache Key Determinism
@given(
    tool_name=st.text(min_size=1),
    params=st.dictionaries(
        keys=st.text(min_size=1),
        values=st.one_of(st.text(), st.integers(), st.floats(), st.booleans())
    )
)
def test_cache_key_determinism(tool_name, params):
    """For any tool name and parameters, cache keys should be deterministic."""
    cache = ToolCache("test_session")
    
    # Generate key twice with same inputs
    key1 = cache._generate_cache_key(tool_name, params)
    key2 = cache._generate_cache_key(tool_name, params)
    
    # Keys must be identical
    assert key1 == key2
```

### Test Organization

**Unit Tests**:
- `tools/test_newsdata_client.py` - NewsData client tests
- `tools/test_newsdata_tools.py` - NewsData tools tests
- `tools/test_polymarket_tools.py` - Polymarket tools tests
- `utils/test_tool_cache.py` - Tool cache tests
- `agents/test_autonomous_agent_factory.py` - Agent factory tests
- `agents/test_breaking_news.py` - Breaking News agent tests
- `agents/test_media_sentiment.py` - Media Sentiment agent tests
- `agents/test_polling_intelligence.py` - Polling Intelligence agent tests

**Property Tests**:
- `tools/test_newsdata_client.property.py` - Client property tests
- `tools/test_newsdata_tools.property.py` - Tools property tests
- `utils/test_tool_cache.property.py` - Cache property tests
- `agents/test_autonomous_agents.property.py` - Agent property tests

### Integration Tests

**End-to-End Tests**:
- Test complete workflow: market ingestion → autonomous agent → signal output
- Test with real API calls (using test API keys)
- Test with mocked API responses (for deterministic testing)
- Test timeout scenarios with slow API responses
- Test rate limiting scenarios
- Test graceful degradation with injected failures

**Test Data**:
- Use real market data from Polymarket
- Use real news articles from NewsData (cached for deterministic tests)
- Generate synthetic market data for edge cases
- Generate synthetic news articles for specific scenarios

### Mocking Strategy

**Mock External APIs**:
- Use `pytest-httpx` for mocking HTTP requests
- Create fixtures for common API responses
- Create fixtures for error responses (rate limits, timeouts, invalid JSON)

**Mock LLM Responses**:
- Use `unittest.mock` to mock LLM invocations
- Create fixtures for valid AgentSignal outputs
- Create fixtures for invalid outputs (schema validation failures)

**Mock Cache**:
- Use in-memory cache for tests (no mocking needed)
- Clear cache between tests for isolation

### Coverage Goals

- Line coverage: > 90%
- Branch coverage: > 85%
- Property test coverage: All 23 properties implemented
- Integration test coverage: All critical paths tested
