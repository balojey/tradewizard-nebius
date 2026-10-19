# Implementation Plan: Autonomous News and Polling Agents for DOA

## Overview

This implementation plan breaks down the autonomous news and polling agents feature into discrete coding tasks. The plan follows a phased approach: infrastructure first, then tools, then autonomous agents. Each task builds on previous tasks and includes testing as sub-tasks.

## Tasks

- [x] 1. Set up infrastructure and dependencies
  - Add required dependencies to requirements.txt (httpx, langchain-core, langgraph, hypothesis, pytest-httpx)
  - Create directory structure: tools/, utils/ (if not exists), agents/ (already exists)
  - Update .env.example with new environment variables (NEWSDATA_API_KEY, MAX_TOOL_CALLS, AGENT_TIMEOUT_MS, TOOL_CACHE_ENABLED)
  - Remove AUTONOMOUS_AGENTS_ENABLED flag (autonomous agents are always enabled)
  - _Requirements: 9.1, 9.2, 9.3, 9.4, 9.9_

- [x] 2. Implement NewsData API Client
  - [x] 2.1 Create NewsData client class (tools/newsdata_client.py)
    - Implement __init__ with API key, base URL, and timeout configuration
    - Implement async HTTP client using httpx.AsyncClient
    - Implement exponential backoff for rate limiting
    - _Requirements: 1.1, 1.6_
  
  - [x] 2.2 Implement fetch_latest_news method
    - Accept all NewsData API parameters (query, qInTitle, timeframe, country, category, language, sentiment, size, removeduplicate)
    - Construct HTTP request with query parameters
    - Parse JSON response and return structured data
    - Handle errors and raise exceptions with context
    - _Requirements: 1.2, 1.7, 1.8_
  
  - [x] 2.3 Implement fetch_archive_news method
    - Accept date range parameters (from_date, to_date) and other filters
    - Construct HTTP request with date range parameters
    - Parse JSON response and return structured data
    - _Requirements: 1.3, 1.7_
  
  - [x] 2.4 Implement fetch_crypto_news method
    - Accept crypto-specific parameters (coin symbols)
    - Construct HTTP request with crypto parameters
    - Parse JSON response and return structured data
    - _Requirements: 1.4, 1.7_
  
  - [x] 2.5 Implement fetch_market_news method
    - Accept market-specific parameters (symbols, organizations)
    - Construct HTTP request with market parameters
    - Parse JSON response and return structured data
    - _Requirements: 1.5, 1.7_
  
  - [ ]* 2.6 Write unit tests for NewsData client
    - Test initialization with valid/invalid API keys
    - Test each fetch method with various parameter combinations
    - Test error handling (network errors, HTTP errors, invalid JSON)
    - Mock HTTP responses using pytest-httpx
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 1.7, 1.8_
  
  - [ ]* 2.7 Write property tests for NewsData client
    - **Property 1: HTTP Request Formation Correctness**
    - **Validates: Requirements 1.2, 1.3, 1.4, 1.5**
    - **Property 2: API Error Handling**
    - **Validates: Requirements 1.6, 1.8**
    - **Property 3: Response Parsing Correctness**
    - **Validates: Requirements 1.7**

- [x] 3. Implement Tool Cache Utility
  - [x] 3.1 Create ToolCache class (utils/tool_cache.py)
    - Implement __init__ with session_id
    - Implement _generate_cache_key with deterministic hashing
    - Implement get method with hit/miss tracking
    - Implement set method for storing results
    - Implement clear method for cache clearing
    - Implement get_stats method for statistics
    - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.5, 4.6, 4.7, 4.8_
  
  - [ ]* 3.2 Write unit tests for ToolCache
    - Test cache initialization
    - Test cache hit/miss behavior
    - Test cache key generation
    - Test statistics calculation
    - Test cache clearing
    - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.5, 4.6_
  
  - [ ]* 3.3 Write property tests for ToolCache
    - **Property 9: Cache Key Determinism**
    - **Validates: Requirements 4.7, 4.8**
    - **Property 10: Cache Statistics Accuracy**
    - **Validates: Requirements 4.5**
    - **Property 11: Cache Clearing**
    - **Validates: Requirements 4.6**

- [x] 4. Implement NewsData LangChain Tools
  - [x] 4.1 Create tool input schemas (tools/newsdata_tools.py)
    - Define Pydantic models for each tool's input (FetchLatestNewsInput, FetchArchiveNewsInput, FetchCryptoNewsInput, FetchMarketNewsInput)
    - Define ToolContext model for tool execution context
    - Define ToolAuditEntry model for audit logging
    - _Requirements: 2.8_
  
  - [x] 4.2 Implement tool execution wrapper
    - Create execute_tool_with_wrapper function
    - Implement cache checking before execution
    - Implement audit logging (tool name, parameters, timestamp, result/error, duration, cache status)
    - Implement error handling and graceful degradation
    - _Requirements: 2.2, 2.3, 2.4, 2.5, 2.6_
  
  - [x] 4.3 Create LangChain tool factories
    - Implement create_fetch_latest_news_tool
    - Implement create_fetch_archive_news_tool
    - Implement create_fetch_crypto_news_tool
    - Implement create_fetch_market_news_tool
    - Each tool wraps NewsData client method with execution wrapper
    - _Requirements: 2.1, 2.7_
  
  - [x] 4.4 Implement tool usage summary function
    - Create get_tool_usage_summary function
    - Calculate tools_called, total_tool_time, cache_hits, cache_misses
    - Calculate tool_breakdown (tool name -> call count)
    - Calculate total_articles and errors
    - _Requirements: 2.2, 2.3_
  
  - [ ]* 4.5 Write unit tests for NewsData tools
    - Test tool creation and invocation
    - Test parameter validation
    - Test audit logging
    - Test cache integration
    - Test error handling
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 2.7, 2.8_
  
  - [ ]* 4.6 Write property tests for NewsData tools
    - **Property 4: Tool Parameter Pass-Through**
    - **Validates: Requirements 2.1**
    - **Property 5: Tool Audit Logging Completeness**
    - **Validates: Requirements 2.2, 2.3, 2.4**
    - **Property 6: Cache Hit Correctness**
    - **Validates: Requirements 2.5**
    - **Property 7: Cache Miss and Storage**
    - **Validates: Requirements 2.6, 4.2, 4.7**
    - **Property 8: Input Validation**
    - **Validates: Requirements 2.8**

- [x] 5. Implement Polymarket LangChain Tools
  - [x] 5.1 Create tool input schemas (tools/polymarket_tools.py)
    - Define Pydantic models for each tool's input (FetchRelatedMarketsInput, FetchHistoricalPricesInput, etc.)
    - Reuse ToolContext and ToolAuditEntry from newsdata_tools
    - _Requirements: 3.8_
  
  - [x] 5.2 Implement Polymarket tool methods
    - Implement fetch_related_markets using existing Polymarket client
    - Implement fetch_historical_prices using existing Polymarket client
    - Implement fetch_cross_market_data using existing Polymarket client
    - Implement analyze_market_momentum (calculate momentum from price data)
    - Implement detect_sentiment_shifts (detect price changes above threshold)
    - _Requirements: 3.1_
  
  - [x] 5.3 Create LangChain tool factories
    - Implement create_fetch_related_markets_tool
    - Implement create_fetch_historical_prices_tool
    - Implement create_fetch_cross_market_data_tool
    - Implement create_analyze_market_momentum_tool
    - Implement create_detect_sentiment_shifts_tool
    - Each tool wraps Polymarket client method with execution wrapper
    - _Requirements: 3.1, 3.7_
  
  - [x] 5.4 Implement tool usage summary function
    - Create get_tool_usage_summary function (same as NewsData)
    - _Requirements: 3.2, 3.3_
  
  - [ ]* 5.5 Write unit tests for Polymarket tools
    - Test tool creation and invocation
    - Test parameter validation
    - Test audit logging
    - Test cache integration
    - Test error handling
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7, 3.8_
  
  - [ ]* 5.6 Write property tests for Polymarket tools
    - **Property 4: Tool Parameter Pass-Through** (Polymarket variant)
    - **Validates: Requirements 3.1**
    - **Property 5: Tool Audit Logging Completeness** (Polymarket variant)
    - **Validates: Requirements 3.2, 3.3, 3.4**
    - **Property 6: Cache Hit Correctness** (Polymarket variant)
    - **Validates: Requirements 3.5**
    - **Property 7: Cache Miss and Storage** (Polymarket variant)
    - **Validates: Requirements 3.6**
    - **Property 8: Input Validation** (Polymarket variant)
    - **Validates: Requirements 3.8**

- [x] 6. Checkpoint - Ensure all infrastructure and tools tests pass
  - Run all unit tests and property tests
  - Verify cache functionality
  - Verify tool execution and audit logging
  - Ask the user if questions arise

- [x] 7. Implement Autonomous Agent Factory
  - [x] 7.1 Create autonomous agent factory (agents/autonomous_agent_factory.py)
    - Implement create_autonomous_agent function using LangGraph's create_react_agent
    - Configure agent with LLM, tools, and system prompt
    - Set recursion limit based on max_tool_calls
    - _Requirements: 5.1, 5.2, 5.3, 5.4, 5.5_
  
  - [x] 7.2 Implement autonomous agent node wrapper
    - Create create_autonomous_agent_node function
    - Implement timeout handling using asyncio.wait_for
    - Implement output parsing and validation
    - Implement tool usage metadata extraction
    - Implement error handling and graceful degradation
    - _Requirements: 5.6, 5.7, 5.8_
  
  - [ ]* 7.3 Write unit tests for agent factory
    - Test agent creation with various configurations
    - Test timeout handling
    - Test output parsing
    - Test error handling
    - Mock LLM responses for deterministic testing
    - _Requirements: 5.1, 5.2, 5.3, 5.4, 5.5, 5.6, 5.7_

- [x] 8. Implement Autonomous Breaking News Agent (Replace Old Version)
  - [x] 8.1 Delete old breaking_news.py agent
    - Remove doa/agents/breaking_news.py (non-autonomous version)
    - Remove any imports of the old agent from other files
    - _Requirements: 6.9, 6.10_
  
  - [x] 8.2 Create new autonomous Breaking News agent (agents/breaking_news.py)
    - Define system prompt with tool selection strategy
    - Create agent node using autonomous_agent_factory
    - Configure with NewsData tools
    - Set max_tool_calls to 5
    - _Requirements: 6.1, 6.2_
  
  - [x] 8.3 Implement agent node function
    - Check for MBD availability
    - Check for NewsData configuration
    - Initialize NewsData client and tool cache
    - Create tool context and audit log
    - Create NewsData tools
    - Execute agent with timeout
    - Parse output into AgentSignal
    - Add tool usage metadata
    - Implement graceful degradation on tool failures
    - Return agent signal with comprehensive audit log
    - _Requirements: 6.3, 6.4, 6.5, 6.6, 6.7, 6.8_
  
  - [ ]* 8.4 Write unit tests for Breaking News agent
    - Test agent initialization
    - Test agent execution with mocked tools
    - Test timeout handling
    - Test tool failure handling
    - Test output structure
    - _Requirements: 6.1, 6.3, 6.4, 6.5, 6.6, 6.7, 6.8_
  
  - [ ]* 8.5 Write property tests for Breaking News agent
    - **Property 12: Tool Call Limit Enforcement**
    - **Validates: Requirements 6.3**
    - **Property 13: Agent Signal Structure**
    - **Validates: Requirements 6.4**
    - **Property 14: Graceful Degradation on Tool Failures**
    - **Validates: Requirements 6.5, 10.1**
    - **Property 15: Timeout Handling**
    - **Validates: Requirements 6.6, 10.3**
    - **Property 16: Tool Usage Metadata Inclusion**
    - **Validates: Requirements 6.7**
    - **Property 17: Comprehensive Audit Trail**
    - **Validates: Requirements 6.8**

- [x] 9. Implement Autonomous Media Sentiment Agent (Replace Old Version)
  - [x] 9.1 Delete old media_sentiment.py agent
    - Remove doa/agents/media_sentiment.py (non-autonomous version)
    - Remove any imports of the old agent from other files
    - _Requirements: 7.9, 7.10_
  
  - [x] 9.2 Create new autonomous Media Sentiment agent (agents/media_sentiment.py)
    - Define system prompt with sentiment analysis strategy
    - Create agent node using autonomous_agent_factory
    - Configure with NewsData tools
    - Set max_tool_calls to 5
    - _Requirements: 7.1, 7.2_
  
  - [x] 9.3 Implement agent node function
    - Follow same pattern as Breaking News agent
    - Use sentiment-specific tool selection strategy
    - _Requirements: 7.3, 7.4, 7.5, 7.6, 7.7, 7.8_
  
  - [ ]* 9.4 Write unit tests for Media Sentiment agent
    - Test agent initialization
    - Test agent execution with mocked tools
    - Test sentiment analysis logic
    - _Requirements: 7.1, 7.3, 7.4, 7.5, 7.6, 7.7, 7.8_
  
  - [ ]* 9.5 Write property tests for Media Sentiment agent
    - Same properties as Breaking News agent (Properties 12-17)
    - **Validates: Requirements 7.3, 7.4, 7.5, 7.6, 7.7, 7.8**

- [x] 10. Implement Autonomous Polling Intelligence Agent (Replace Old Version)
  - [x] 10.1 Delete old polling_intelligence.py agent
    - Remove doa/agents/polling_intelligence.py (non-autonomous version)
    - Remove any imports of the old agent from other files
    - _Requirements: 8.9, 8.10_
  
  - [x] 10.2 Create new autonomous Polling Intelligence agent (agents/polling_intelligence.py)
    - Define system prompt with polling analysis strategy
    - Create agent node using autonomous_agent_factory
    - Configure with Polymarket tools
    - Set max_tool_calls to 5
    - _Requirements: 8.1, 8.2_
  
  - [x] 10.3 Implement agent node function
    - Follow same pattern as Breaking News agent
    - Use Polymarket tools instead of NewsData tools
    - Use polling-specific tool selection strategy
    - _Requirements: 8.3, 8.4, 8.5, 8.6, 8.7, 8.8_
  
  - [ ]* 10.4 Write unit tests for Polling Intelligence agent
    - Test agent initialization
    - Test agent execution with mocked tools
    - Test polling analysis logic
    - _Requirements: 8.1, 8.3, 8.4, 8.5, 8.6, 8.7, 8.8_
  
  - [ ]* 10.5 Write property tests for Polling Intelligence agent
    - Same properties as Breaking News agent (Properties 12-17)
    - **Validates: Requirements 8.3, 8.4, 8.5, 8.6, 8.7, 8.8**

- [x] 11. Extend Configuration Management (Simplified - No Fallback Flags)
  - [x] 11.1 Add NewsDataConfig to config.py
    - Define NewsDataConfig dataclass with api_key, base_url, timeout
    - Implement validate method
    - _Requirements: 9.1, 9.5_
  
  - [x] 11.2 Add AutonomousAgentConfig to config.py
    - Define AutonomousAgentConfig dataclass with max_tool_calls, timeout_ms, cache_enabled
    - Remove any "enabled" flag (autonomous agents are always enabled)
    - Implement validate method
    - _Requirements: 9.4, 9.5, 9.9_
  
  - [x] 11.3 Update EngineConfig to include new configurations
    - Add newsdata: NewsDataConfig field
    - Add autonomous_agents: AutonomousAgentConfig field
    - Update validate method to validate new configs
    - Update to_dict method to include new configs
    - _Requirements: 9.7_
  
  - [x] 11.4 Update load_config function
    - Load NEWSDATA_API_KEY from environment
    - Load MAX_TOOL_CALLS, AGENT_TIMEOUT_MS, TOOL_CACHE_ENABLED
    - Do NOT load AUTONOMOUS_AGENTS_ENABLED (removed)
    - Create NewsDataConfig and AutonomousAgentConfig instances
    - Add to EngineConfig
    - _Requirements: 9.1, 9.2, 9.3, 9.4, 9.9_
  
  - [ ]* 11.5 Write unit tests for configuration
    - Test configuration loading with valid values
    - Test configuration validation with invalid values
    - Test missing required configuration
    - Test default values for optional configuration
    - Verify no fallback flags exist
    - _Requirements: 9.1, 9.2, 9.3, 9.4, 9.5, 9.6, 9.7, 9.9_

- [ ] 12. Implement Error Handling Properties
  - [ ]* 12.1 Write property tests for error handling
    - **Property 18: Complete Tool Failure Handling**
    - **Validates: Requirements 10.2**
    - **Property 19: Rate Limit Handling**
    - **Validates: Requirements 10.4**
    - **Property 20: Network Error Retry**
    - **Validates: Requirements 10.5**
    - **Property 21: JSON Parsing Error Handling**
    - **Validates: Requirements 10.6**
    - **Property 22: Schema Validation Error Handling**
    - **Validates: Requirements 10.7**
    - **Property 23: Error Context Logging**
    - **Validates: Requirements 10.8**

- [x] 13. Integration and Workflow Updates (Complete Replacement)
  - [x] 13.1 Update workflow to use only autonomous agents
    - Import autonomous agent nodes (breaking_news, media_sentiment, polling_intelligence)
    - Remove all imports of old non-autonomous agents
    - Remove any conditional logic for enabling/disabling autonomous agents
    - Use autonomous agents as the only implementation
    - _Requirements: 6.1, 6.9, 7.1, 7.9, 8.1, 8.9_
  
  - [x] 13.2 Update agent selection logic
    - Remove any checks for AUTONOMOUS_AGENTS_ENABLED
    - Always use autonomous agents (no fallback)
    - _Requirements: 9.9_
  
  - [x] 13.3 Clean up old agent references
    - Search codebase for any remaining references to old agents
    - Remove or update all references to point to new autonomous agents
    - Update any documentation that mentions the old agents
    - _Requirements: 6.9, 6.10, 7.9, 7.10, 8.9, 8.10_
  
  - [ ]* 13.4 Write integration tests
    - Test complete workflow with autonomous agents
    - Test with real API calls (using test API keys)
    - Test with mocked API responses
    - Test timeout scenarios
    - Test rate limiting scenarios
    - Test graceful degradation with injected failures
    - Verify no old agent code paths are executed
    - _Requirements: 6.1, 6.2, 6.3, 6.4, 6.5, 6.6, 6.7, 6.8, 7.1, 7.2, 7.3, 7.4, 7.5, 7.6, 7.7, 7.8, 8.1, 8.2, 8.3, 8.4, 8.5, 8.6, 8.7, 8.8_

- [ ] 14. Final checkpoint - Ensure all tests pass
  - Run all unit tests
  - Run all property tests
  - Run all integration tests
  - Verify test coverage meets goals (>90% line coverage, >85% branch coverage)
  - Verify all 23 properties are implemented and passing
  - Ask the user if questions arise

- [x] 15. Documentation and Deployment
  - [x] 15.1 Update README with new features
    - Document autonomous agents as the default and only implementation
    - Document new environment variables
    - Document tool-calling capabilities
    - Remove any mention of non-autonomous agents or fallback modes
    - _Requirements: 9.1, 9.2, 9.4, 9.9_
  
  - [x] 15.2 Create migration guide
    - Document complete replacement of old agents with autonomous agents
    - Document configuration changes
    - Document removal of AUTONOMOUS_AGENTS_ENABLED flag
    - Explain that there is no backward compatibility (clean break)
    - _Requirements: 6.9, 6.10, 7.9, 7.10, 8.9, 8.10, 9.9_
  
  - [x] 15.3 Update .env.example
    - Add all new environment variables with descriptions
    - Remove AUTONOMOUS_AGENTS_ENABLED (no longer needed)
    - _Requirements: 9.1, 9.2, 9.4, 9.9_

## Notes

- Tasks marked with `*` are optional testing tasks that can be skipped for faster MVP
- Each task references specific requirements for traceability
- Property tests validate universal correctness properties from the design document
- Unit tests validate specific examples and edge cases
- Integration tests validate end-to-end workflows
- Checkpoints ensure incremental validation and allow for user feedback
- The implementation follows a phased approach: infrastructure → tools → agents
- **IMPORTANT**: This is a complete replacement - old non-autonomous agents are deleted, no backward compatibility
- **IMPORTANT**: No configuration flags for enabling/disabling autonomous agents - they are always enabled
- **IMPORTANT**: The autonomous agents are the only implementation going forward
