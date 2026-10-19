# Requirements Document: Autonomous News and Polling Agents for DOA

## Introduction

This feature brings autonomous tool-calling capabilities to the DOA (Debate-Oriented Analysis) system by implementing ReAct (Reasoning + Acting) pattern agents for news and polling intelligence. The agents will autonomously decide which tools to call based on market context, fetch data from external APIs, cache results, and log all operations for debugging and analysis.

## Glossary

- **DOA**: Debate-Oriented Analysis system - Python-based prediction market analysis system
- **ReAct Agent**: An AI agent that follows the Reasoning + Acting pattern, iteratively deciding which tools to use
- **Tool**: A function that an agent can call to fetch external data or perform operations
- **Tool Cache**: A session-scoped cache that stores tool results to avoid redundant API calls
- **Agent Signal**: Structured output from an agent containing analysis, confidence, probability estimate, and metadata
- **NewsData API**: External API service (NewsData.io) for fetching news articles
- **Polymarket API**: External API service for fetching prediction market data
- **Audit Entry**: A log record capturing tool invocation details (parameters, results, duration, cache status)
- **LangGraph**: Framework for building multi-agent workflows with state management
- **LangChain**: Framework for building LLM applications with tool integration

## Requirements

### Requirement 1: NewsData API Client

**User Story:** As a developer, I want a Python client for the NewsData.io API, so that agents can fetch news articles programmatically.

#### Acceptance Criteria

1. WHEN the client is initialized with an API key, THEN the System SHALL create a configured HTTP client for NewsData.io
2. WHEN the client fetches latest news, THEN the System SHALL make an HTTP request to the NewsData API with query parameters
3. WHEN the client fetches archive news, THEN the System SHALL make an HTTP request with date range parameters
4. WHEN the client fetches crypto news, THEN the System SHALL make an HTTP request with cryptocurrency-specific parameters
5. WHEN the client fetches market news, THEN the System SHALL make an HTTP request with financial market parameters
6. WHEN an API request fails, THEN the System SHALL raise an exception with error details
7. WHEN an API request succeeds, THEN the System SHALL parse the JSON response and return structured data
8. WHEN the API returns an error status code, THEN the System SHALL handle it gracefully and provide error context

### Requirement 2: NewsData LangChain Tools

**User Story:** As an AI agent, I want LangChain tools for fetching news, so that I can autonomously gather news data during analysis.

#### Acceptance Criteria

1. WHEN a tool is invoked with parameters, THEN the System SHALL call the NewsData client with those parameters
2. WHEN a tool is invoked, THEN the System SHALL log an audit entry with tool name, parameters, and timestamp
3. WHEN a tool completes successfully, THEN the System SHALL log the result, duration, and cache status
4. WHEN a tool encounters an error, THEN the System SHALL log the error and continue execution
5. WHEN a tool result is cached, THEN the System SHALL retrieve from cache instead of making an API call
6. WHEN a tool result is not cached, THEN the System SHALL make an API call and store the result in cache
7. WHEN multiple tools are available, THEN the System SHALL provide four distinct tools: fetch_latest_news, fetch_archive_news, fetch_crypto_news, fetch_market_news
8. WHEN a tool is called, THEN the System SHALL validate input parameters using Pydantic schemas

### Requirement 3: Polymarket LangChain Tools

**User Story:** As an AI agent, I want LangChain tools for fetching Polymarket data, so that I can autonomously gather market intelligence during analysis.

#### Acceptance Criteria

1. WHEN a tool is invoked with a condition ID, THEN the System SHALL call the Polymarket client with that condition ID
2. WHEN a tool is invoked, THEN the System SHALL log an audit entry with tool name, parameters, and timestamp
3. WHEN a tool completes successfully, THEN the System SHALL log the result, duration, and cache status
4. WHEN a tool encounters an error, THEN the System SHALL log the error and continue execution
5. WHEN a tool result is cached, THEN the System SHALL retrieve from cache instead of making an API call
6. WHEN a tool result is not cached, THEN the System SHALL make an API call and store the result in cache
7. WHEN multiple tools are available, THEN the System SHALL provide five distinct tools: fetch_related_markets, fetch_historical_prices, fetch_cross_market_data, analyze_market_momentum, detect_sentiment_shifts
8. WHEN a tool is called, THEN the System SHALL validate input parameters using Pydantic schemas

### Requirement 4: Tool Cache Utility

**User Story:** As a system administrator, I want tool results cached within a session, so that redundant API calls are avoided and costs are reduced.

#### Acceptance Criteria

1. WHEN a cache is initialized with a session ID, THEN the System SHALL create an empty cache for that session
2. WHEN a tool result is stored in cache, THEN the System SHALL use a cache key based on tool name and parameters
3. WHEN a tool result is retrieved from cache, THEN the System SHALL return the cached value if it exists
4. WHEN a cache key does not exist, THEN the System SHALL return None to indicate a cache miss
5. WHEN cache statistics are requested, THEN the System SHALL return hit count, miss count, and hit rate
6. WHEN a cache is cleared, THEN the System SHALL remove all cached entries for that session
7. WHEN cache keys are generated, THEN the System SHALL create deterministic keys from tool name and sorted parameters
8. WHEN parameters contain complex objects, THEN the System SHALL serialize them to JSON for cache key generation

### Requirement 5: Autonomous Agent Factory

**User Story:** As a developer, I want a factory for creating ReAct agents with tools, so that I can easily instantiate autonomous agents with consistent configuration.

#### Acceptance Criteria

1. WHEN an agent is created with tools, THEN the System SHALL use LangGraph's create_react_agent function
2. WHEN an agent is created, THEN the System SHALL configure it with the provided LLM instance
3. WHEN an agent is created, THEN the System SHALL configure it with the provided system prompt
4. WHEN an agent is created, THEN the System SHALL configure it with the provided tool list
5. WHEN an agent is created, THEN the System SHALL set a recursion limit to prevent infinite loops
6. WHEN an agent is created, THEN the System SHALL configure timeout handling for long-running operations
7. WHEN an agent is created, THEN the System SHALL return a callable agent executor
8. WHEN an agent executor is invoked, THEN the System SHALL follow the ReAct pattern: reason, act, observe, repeat

### Requirement 6: Autonomous Breaking News Agent (Replaces Non-Autonomous Version)

**User Story:** As a market analyst, I want an autonomous Breaking News agent that completely replaces the old non-autonomous version, so that I can get real-time news analysis with tool-calling capabilities.

#### Acceptance Criteria

1. WHEN the agent is initialized, THEN the System SHALL create a ReAct agent with NewsData tools
2. WHEN the agent analyzes a market, THEN the System SHALL autonomously decide which news tools to call
3. WHEN the agent calls tools, THEN the System SHALL limit tool calls to 5 maximum per analysis
4. WHEN the agent completes analysis, THEN the System SHALL return a structured AgentSignal with news insights
5. WHEN the agent encounters tool failures, THEN the System SHALL continue with available data and adjust confidence
6. WHEN the agent times out, THEN the System SHALL return partial results with reduced confidence
7. WHEN the agent completes successfully, THEN the System SHALL include tool usage metadata in the signal
8. WHEN the agent logs audit entries, THEN the System SHALL include all tool invocations with parameters, results, and duration
9. WHEN the system loads agents, THEN the System SHALL NOT load or reference the old non-autonomous breaking_news agent
10. WHEN the old breaking_news.py file exists, THEN the System SHALL delete it and replace it with the autonomous version

### Requirement 7: Autonomous Media Sentiment Agent (Replaces Non-Autonomous Version)

**User Story:** As a market analyst, I want an autonomous Media Sentiment agent that completely replaces the old non-autonomous version, so that I can get sentiment analysis with tool-calling capabilities.

#### Acceptance Criteria

1. WHEN the agent is initialized, THEN the System SHALL create a ReAct agent with NewsData tools
2. WHEN the agent analyzes a market, THEN the System SHALL autonomously decide which news tools to call for sentiment analysis
3. WHEN the agent calls tools, THEN the System SHALL limit tool calls to 5 maximum per analysis
4. WHEN the agent completes analysis, THEN the System SHALL return a structured AgentSignal with sentiment insights
5. WHEN the agent encounters tool failures, THEN the System SHALL continue with available data and adjust confidence
6. WHEN the agent times out, THEN the System SHALL return partial results with reduced confidence
7. WHEN the agent completes successfully, THEN the System SHALL include tool usage metadata in the signal
8. WHEN the agent logs audit entries, THEN the System SHALL include all tool invocations with parameters, results, and duration
9. WHEN the system loads agents, THEN the System SHALL NOT load or reference the old non-autonomous media_sentiment agent
10. WHEN the old media_sentiment.py file exists, THEN the System SHALL delete it and replace it with the autonomous version

### Requirement 8: Autonomous Polling Intelligence Agent (Replaces Non-Autonomous Version)

**User Story:** As a market analyst, I want an autonomous Polling Intelligence agent that completely replaces the old non-autonomous version, so that I can get polling analysis with tool-calling capabilities.

#### Acceptance Criteria

1. WHEN the agent is initialized, THEN the System SHALL create a ReAct agent with Polymarket tools
2. WHEN the agent analyzes a market, THEN the System SHALL autonomously decide which Polymarket tools to call
3. WHEN the agent calls tools, THEN the System SHALL limit tool calls to 5 maximum per analysis
4. WHEN the agent completes analysis, THEN the System SHALL return a structured AgentSignal with polling insights
5. WHEN the agent encounters tool failures, THEN the System SHALL continue with available data and adjust confidence
6. WHEN the agent times out, THEN the System SHALL return partial results with reduced confidence
7. WHEN the agent completes successfully, THEN the System SHALL include tool usage metadata in the signal
8. WHEN the agent logs audit entries, THEN the System SHALL include all tool invocations with parameters, results, and duration
9. WHEN the system loads agents, THEN the System SHALL NOT load or reference the old non-autonomous polling_intelligence agent
10. WHEN the old polling_intelligence.py file exists, THEN the System SHALL delete it and replace it with the autonomous version

### Requirement 9: Configuration Management (Simplified - No Fallback)

**User Story:** As a system administrator, I want environment-based configuration for API keys and URLs, so that I can deploy the system securely across environments.

#### Acceptance Criteria

1. WHEN the system starts, THEN the System SHALL load NewsData API key from environment variables
2. WHEN the system starts, THEN the System SHALL load Polymarket API URLs from environment variables
3. WHEN required configuration is missing, THEN the System SHALL raise a clear error message
4. WHEN optional configuration is missing, THEN the System SHALL use sensible defaults
5. WHEN configuration is loaded, THEN the System SHALL validate API keys are non-empty strings
6. WHEN configuration is loaded, THEN the System SHALL validate URLs are properly formatted
7. WHEN configuration is accessed, THEN the System SHALL provide type-safe access through Pydantic models
8. WHEN configuration is updated, THEN the System SHALL reload without requiring system restart
9. WHEN the system loads configuration, THEN the System SHALL NOT include any flags for enabling/disabling autonomous agents (they are always enabled)

### Requirement 10: Error Handling and Graceful Degradation

**User Story:** As a system operator, I want graceful error handling, so that agent failures don't crash the entire analysis workflow.

#### Acceptance Criteria

1. WHEN a tool call fails, THEN the System SHALL log the error and continue with remaining tools
2. WHEN all tool calls fail, THEN the System SHALL return a low-confidence signal with error details
3. WHEN an agent times out, THEN the System SHALL return partial results with timeout indication
4. WHEN an API rate limit is hit, THEN the System SHALL handle it gracefully and include in risk factors
5. WHEN network errors occur, THEN the System SHALL retry once before failing
6. WHEN JSON parsing fails, THEN the System SHALL log the error and return a structured error response
7. WHEN schema validation fails, THEN the System SHALL log validation errors and return a fallback signal
8. WHEN critical errors occur, THEN the System SHALL include error context in audit logs for debugging
