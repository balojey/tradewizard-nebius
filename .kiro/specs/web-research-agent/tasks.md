# Implementation Plan: Web Research Agent

## Overview

This plan implements the Web Research Agent feature across both TypeScript (tradewizard-agents) and Python (doa) codebases. The agent provides real-world context about prediction markets by searching the web and scraping webpages using the Serper API with multi-key rotation support.

Implementation follows a phased approach: TypeScript core infrastructure first, then Python port, followed by comprehensive testing and documentation.

## Tasks

- [x] 1. TypeScript: Implement Serper API Client with multi-key rotation
  - [x] 1.1 Create SerperClient class with KeyState management
    - Create `tradewizard-agents/src/utils/serper-client.ts`
    - Implement KeyState interface (key, keyId, isRateLimited, rateLimitExpiry, totalRequests, lastUsed)
    - Implement SerperConfig, SerperSearchParams, SerperScrapeParams interfaces
    - Implement SerperSearchResponse and SerperScrapeResponse interfaces
    - Initialize SerperClient constructor with multi-key parsing (comma-separated)
    - _Requirements: 2.1, 2.5, 7.8, 11.1_
  
  - [x] 1.2 Implement key rotation methods following NewsData pattern
    - Implement getKeyId() method (first 8 characters)
    - Implement isRateLimitError() method (HTTP 429 detection)
    - Implement isBlockingError() method (HTTP 401, 403, 402 detection)
    - Implement extractRetryAfter() method (parse Retry-After header, default 900s)
    - Implement getAvailableKeys() method (LRU sorted, auto-expire rate limits)
    - Implement rotateApiKey() method (mark current as rate-limited, select LRU key)
    - Implement getKeyRotationStats() method for observability
    - _Requirements: 2.6, 8.6-8.10, 11.2-11.17_
  
  - [x] 1.3 Implement search() method with retry and rotation
    - Implement search() method accepting SerperSearchParams
    - Add request construction with API key in headers
    - Add timeout handling (default 30s)
    - Add retry logic with exponential backoff
    - Add key rotation on blocking errors (doesn't count as retry)
    - Add graceful degradation when all keys exhausted
    - Update key state (lastUsed, totalRequests) on success
    - _Requirements: 2.2, 2.4, 8.1-8.3, 11.15, 11.16_
  
  - [x] 1.4 Implement scrape() method with retry and rotation
    - Implement scrape() method accepting SerperScrapeParams
    - Add request construction with API key in headers
    - Add timeout handling (default 30s)
    - Add retry logic with exponential backoff
    - Add key rotation on blocking errors (doesn't count as retry)
    - Add graceful degradation when all keys exhausted
    - Update key state (lastUsed, totalRequests) on success
    - _Requirements: 2.3, 2.4, 8.1-8.3, 11.15, 11.16_
  
  - [ ]* 1.5 Write unit tests for SerperClient
    - Test API key parsing (single key, multiple keys, whitespace handling)
    - Test key rotation on HTTP 429, 401, 403, 402
    - Test LRU key selection strategy
    - Test rate limit auto-expiry
    - Test graceful degradation when all keys exhausted
    - Test search() and scrape() with mocked responses
    - Test timeout and network error handling
    - _Requirements: 9.1, 9.8-9.12_

- [x] 2. TypeScript: Implement Serper tools with caching and audit logging
  - [x] 2.1 Create search_web tool with Zod validation
    - Create `tradewizard-agents/src/tools/serper-tools.ts`
    - Define SearchWebInputSchema with Zod (query, numResults, timeRange)
    - Implement searchWeb() function with tool wrapper
    - Add input validation (numResults clamped to 1-20, default 10)
    - Add time range transformation (hour/day/week/month/year → qdr:h/d/w/m/y)
    - Add tool caching using ToolContext.cache
    - Add audit logging to ToolContext.auditLog
    - Return structured results (title, link, snippet, date, position)
    - _Requirements: 3.1, 3.3, 3.5, 3.6, 3.8, 3.9_
  
  - [x] 2.2 Create scrape_webpage tool with Zod validation
    - Define ScrapeWebpageInputSchema with Zod (url)
    - Implement scrapeWebpage() function with tool wrapper
    - Add URL validation
    - Add tool caching using ToolContext.cache
    - Add audit logging to ToolContext.auditLog
    - Add graceful error handling for scraping failures
    - Return structured results (url, title, text, metadata)
    - _Requirements: 3.2, 3.4, 3.7, 3.8, 3.9_
  
  - [x] 2.3 Create LangChain tool factories
    - Implement createSearchWebTool() factory function
    - Implement createScrapeWebpageTool() factory function
    - Add comprehensive tool descriptions with usage examples
    - Add schema binding for LangChain integration
    - Add JSON serialization for tool responses
    - _Requirements: 3.1, 3.2_
  
  - [ ]* 2.4 Write unit tests for Serper tools
    - Test input validation (invalid numResults, invalid URL)
    - Test tool caching (cache hits, cache misses)
    - Test audit logging (log entry creation, log content)
    - Test error handling (API errors, validation errors)
    - Test tool factories (LangChain integration)
    - _Requirements: 9.2, 9.3_

- [x] 3. TypeScript: Implement Web Research Agent node
  - [x] 3.1 Create agent system prompt for research strategy
    - Create `tradewizard-agents/src/nodes/web-research-agent.ts`
    - Define WEB_RESEARCH_AGENT_SYSTEM_PROMPT constant
    - Include query formulation guidance (extract entities, timeframes)
    - Include search prioritization by market type (geopolitical, election, policy, company)
    - Include source selection criteria (authoritative sources, recency)
    - Include tool usage limits (max 8 calls, typical pattern 2-3 searches + 2-4 scrapes)
    - Include research document synthesis requirements (structured, factual, comprehensive)
    - Include output format specification (confidence, keyDrivers, riskFactors, metadata)
    - _Requirements: 4.1-4.11, 5.1-5.13, 10.2, 10.4_
  
  - [x] 3.2 Implement createWebResearchAgentNode() function
    - Implement node factory function accepting EngineConfig
    - Add MBD availability check (return error if missing)
    - Add Serper API key check (return graceful degradation if missing)
    - Initialize SerperClient with config
    - Initialize ToolCache for session
    - Create ToolContext with serperClient, cache, auditLog, agentName
    - Create search_web and scrape_webpage tools
    - Create LLM instance using createLLMInstance()
    - Create ReAct agent with tools and system prompt
    - _Requirements: 1.1-1.5, 2.7, 4.1, 4.2, 8.3_
  
  - [x] 3.3 Implement agent execution with timeout and tool limits
    - Prepare agent input with market question and metadata
    - Execute agent with recursionLimit (maxToolCalls + 5 for reasoning)
    - Add timeout wrapper (default 60s)
    - Extract final message from agent result
    - Parse agent output as AgentSignal (with fallback for parse errors)
    - Add tool usage metadata (toolsCalled, totalToolTime, cacheHits, toolBreakdown)
    - Return state update with agentSignals and auditLog
    - _Requirements: 4.4, 5.12, 5.13, 8.2_
  
  - [x] 3.4 Implement error handling and graceful degradation
    - Add try-catch wrapper for entire node execution
    - Return low-confidence neutral signal when API key missing
    - Return partial results on timeout with timeout flag
    - Return error in agentErrors array on execution failure
    - Add comprehensive audit logging for all scenarios
    - Ensure no unhandled exceptions terminate workflow
    - _Requirements: 8.1-8.11_
  
  - [ ]* 3.5 Write unit tests for Web Research Agent node
    - Test graceful degradation when API key not configured
    - Test error handling when MBD missing
    - Test tool call limit enforcement
    - Test timeout handling
    - Test signal structure validation
    - Test metadata inclusion
    - _Requirements: 9.4_
  
  - [ ]* 3.6 Write integration tests with real API
    - Test end-to-end execution with real Serper API (when key available)
    - Test multi-key rotation in real scenarios
    - Test research document synthesis quality
    - Test performance and timeout behavior
    - _Requirements: 9.4_

- [x] 4. TypeScript: Configuration and workflow integration
  - [x] 4.1 Add Serper and Web Research configuration
    - Update `tradewizard-agents/src/config/index.ts`
    - Add SerperConfig interface (apiKey, searchUrl, scrapeUrl, timeout)
    - Add WebResearchConfig interface (enabled, maxToolCalls, timeout)
    - Add serper and webResearch fields to EngineConfig
    - Implement configuration loading from environment variables
    - Add default values (searchUrl, scrapeUrl, timeouts, enabled=true, maxToolCalls=8)
    - _Requirements: 7.1-7.8_
  
  - [x] 4.2 Update .env.example with Serper configuration
    - Update `tradewizard-agents/.env.example`
    - Add SERPER_API_KEY with description and multi-key example
    - Add SERPER_SEARCH_URL, SERPER_SCRAPE_URL, SERPER_TIMEOUT (optional)
    - Add WEB_RESEARCH_ENABLED, WEB_RESEARCH_MAX_TOOL_CALLS, WEB_RESEARCH_TIMEOUT
    - Add comments explaining Serper API setup and multi-key rotation
    - _Requirements: 7.1-7.8, 10.5_
  
  - [x] 4.3 Integrate Web Research Agent into workflow
    - Update `tradewizard-agents/src/workflow.ts`
    - Import createWebResearchAgentNode
    - Add web_research node conditionally (if config.webResearch.enabled)
    - Add edge: memory_retrieval → web_research
    - Add edge: web_research → dynamic_agent_selection
    - Add conditional edge: memory_retrieval → dynamic_agent_selection (if disabled)
    - Test workflow compilation and execution
    - _Requirements: 6.1-6.5_
  
  - [x] 4.4 Update TypeScript type definitions
    - Update `tradewizard-agents/src/models/types.ts`
    - Add SerperSearchResult interface
    - Add SerperScrapeResult interface
    - Add WebResearchConfig interface
    - Add SerperConfig interface
    - _Requirements: 1.1, 2.1, 2.3_

- [x] 5. Checkpoint - TypeScript implementation complete
  - Ensure all TypeScript tests pass
  - Verify workflow integration works end-to-end
  - Test with real Serper API key (if available)
  - Ask the user if questions arise

- [x] 6. Python: Port Serper API Client with multi-key rotation
  - [x] 6.1 Create SerperClient class with KeyState management
    - Create `doa/tools/serper_client.py`
    - Implement KeyState dataclass (key, key_id, is_rate_limited, rate_limit_expiry, total_requests, last_used)
    - Implement SerperConfig, SerperSearchParams, SerperScrapeParams dataclasses
    - Implement SerperSearchResponse and SerperScrapeResponse dataclasses
    - Initialize SerperClient constructor with multi-key parsing (comma-separated)
    - _Requirements: 2.1, 2.5, 7.8, 11.1_
  
  - [x] 6.2 Implement key rotation methods following NewsData pattern
    - Implement _get_key_id() method (first 8 characters)
    - Implement _is_rate_limit_error() method (HTTP 429 detection)
    - Implement _is_blocking_error() method (HTTP 401, 403, 402 detection)
    - Implement _extract_retry_after() method (parse Retry-After header, default 900s)
    - Implement _get_available_keys() method (LRU sorted, auto-expire rate limits)
    - Implement _rotate_api_key() method (mark current as rate-limited, select LRU key)
    - Implement get_key_rotation_stats() method for observability
    - _Requirements: 2.6, 8.6-8.10, 11.2-11.17_
  
  - [x] 6.3 Implement search() method with retry and rotation
    - Implement async search() method accepting SerperSearchParams
    - Add request construction with API key in headers
    - Add timeout handling (default 30s)
    - Add retry logic with exponential backoff
    - Add key rotation on blocking errors (doesn't count as retry)
    - Add graceful degradation when all keys exhausted
    - Update key state (last_used, total_requests) on success
    - _Requirements: 2.2, 2.4, 8.1-8.3, 11.15, 11.16_
  
  - [x] 6.4 Implement scrape() method with retry and rotation
    - Implement async scrape() method accepting SerperScrapeParams
    - Add request construction with API key in headers
    - Add timeout handling (default 30s)
    - Add retry logic with exponential backoff
    - Add key rotation on blocking errors (doesn't count as retry)
    - Add graceful degradation when all keys exhausted
    - Update key state (last_used, total_requests) on success
    - _Requirements: 2.3, 2.4, 8.1-8.3, 11.15, 11.16_
  
  - [ ]* 6.5 Write unit tests for SerperClient
    - Test API key parsing (single key, multiple keys, whitespace handling)
    - Test key rotation on HTTP 429, 401, 403, 402
    - Test LRU key selection strategy
    - Test rate limit auto-expiry
    - Test graceful degradation when all keys exhausted
    - Test search() and scrape() with mocked responses
    - Test timeout and network error handling
    - _Requirements: 9.1, 9.8-9.12_

- [x] 7. Python: Implement Serper tools with caching and audit logging
  - [x] 7.1 Create search_web tool with Pydantic validation
    - Create `doa/tools/serper_tools.py`
    - Define SearchWebInput Pydantic model (query, num_results, time_range)
    - Implement async search_web() function with tool wrapper
    - Add input validation (num_results clamped to 1-20, default 10)
    - Add time range transformation (hour/day/week/month/year → qdr:h/d/w/m/y)
    - Add tool caching using ToolContext cache
    - Add audit logging to ToolContext audit_log
    - Return structured results (title, link, snippet, date, position)
    - _Requirements: 3.1, 3.3, 3.5, 3.6, 3.8, 3.9_
  
  - [x] 7.2 Create scrape_webpage tool with Pydantic validation
    - Define ScrapeWebpageInput Pydantic model (url)
    - Implement async scrape_webpage() function with tool wrapper
    - Add URL validation
    - Add tool caching using ToolContext cache
    - Add audit logging to ToolContext audit_log
    - Add graceful error handling for scraping failures
    - Return structured results (url, title, text, metadata)
    - _Requirements: 3.2, 3.4, 3.7, 3.8, 3.9_
  
  - [x] 7.3 Create LangChain tool factories
    - Implement create_search_web_tool() factory function
    - Implement create_scrape_webpage_tool() factory function
    - Add comprehensive tool descriptions with usage examples
    - Add schema binding for LangChain integration
    - Add JSON serialization for tool responses
    - _Requirements: 3.1, 3.2_
  
  - [ ]* 7.4 Write unit tests for Serper tools
    - Test input validation (invalid num_results, invalid URL)
    - Test tool caching (cache hits, cache misses)
    - Test audit logging (log entry creation, log content)
    - Test error handling (API errors, validation errors)
    - Test tool factories (LangChain integration)
    - _Requirements: 9.2, 9.3_

- [x] 8. Python: Implement Web Research Agent node
  - [x] 8.1 Create agent system prompt for research strategy
    - Create `doa/nodes/web_research_agent.py`
    - Define WEB_RESEARCH_AGENT_SYSTEM_PROMPT constant (identical to TypeScript)
    - Include query formulation guidance (extract entities, timeframes)
    - Include search prioritization by market type (geopolitical, election, policy, company)
    - Include source selection criteria (authoritative sources, recency)
    - Include tool usage limits (max 8 calls, typical pattern 2-3 searches + 2-4 scrapes)
    - Include research document synthesis requirements (structured, factual, comprehensive)
    - Include output format specification (confidence, key_drivers, risk_factors, metadata)
    - _Requirements: 4.1-4.11, 5.1-5.13, 10.2, 10.4_
  
  - [x] 8.2 Implement web_research_agent_node() function
    - Implement async node function accepting GraphState and Config
    - Add MBD availability check (return error if missing)
    - Add Serper API key check (return graceful degradation if missing)
    - Initialize SerperClient with config
    - Initialize tool cache (simple dict for Python)
    - Create tool_context with serper_client, cache, audit_log, agent_name
    - Create search_web and scrape_webpage tools
    - Create LLM instance using create_llm_instance()
    - Create ReAct agent with tools and system_message
    - _Requirements: 1.1-1.5, 2.7, 4.1, 4.2, 8.3_
  
  - [x] 8.3 Implement agent execution with timeout and tool limits
    - Prepare agent input with market question and metadata
    - Execute agent with ainvoke()
    - Add timeout wrapper (default 60s)
    - Extract final message from agent result
    - Parse agent output as AgentSignal (with fallback for parse errors)
    - Add tool usage metadata (tools_called, total_tool_time, cache_hits, tool_breakdown)
    - Return state update with agent_signals and audit_log
    - _Requirements: 4.4, 5.12, 5.13, 8.2_
  
  - [x] 8.4 Implement error handling and graceful degradation
    - Add try-except wrapper for entire node execution
    - Return low-confidence neutral signal when API key missing
    - Return partial results on timeout with timeout flag
    - Return error in agent_errors array on execution failure
    - Add comprehensive audit logging for all scenarios
    - Ensure no unhandled exceptions terminate workflow
    - _Requirements: 8.1-8.11_
  
  - [ ]* 8.5 Write unit tests for Web Research Agent node
    - Test graceful degradation when API key not configured
    - Test error handling when MBD missing
    - Test tool call limit enforcement
    - Test timeout handling
    - Test signal structure validation
    - Test metadata inclusion
    - _Requirements: 9.4_
  
  - [ ]* 8.6 Write integration tests with real API
    - Test end-to-end execution with real Serper API (when key available)
    - Test multi-key rotation in real scenarios
    - Test research document synthesis quality
    - Test performance and timeout behavior
    - _Requirements: 9.4_

- [x] 9. Python: Configuration and workflow integration
  - [x] 9.1 Add Serper and Web Research configuration
    - Update `doa/config.py`
    - Add SerperConfig dataclass (api_key, search_url, scrape_url, timeout)
    - Add WebResearchConfig dataclass (enabled, max_tool_calls, timeout)
    - Add serper and web_research fields to Config
    - Implement configuration loading from environment variables
    - Add default values (search_url, scrape_url, timeouts, enabled=True, max_tool_calls=8)
    - _Requirements: 7.1-7.8_
  
  - [x] 9.2 Update .env.example with Serper configuration
    - Update `doa/.env.example`
    - Add SERPER_API_KEY with description and multi-key example
    - Add SERPER_SEARCH_URL, SERPER_SCRAPE_URL, SERPER_TIMEOUT (optional)
    - Add WEB_RESEARCH_ENABLED, WEB_RESEARCH_MAX_TOOL_CALLS, WEB_RESEARCH_TIMEOUT
    - Add comments explaining Serper API setup and multi-key rotation
    - _Requirements: 7.1-7.8, 10.5_
  
  - [x] 9.3 Integrate Web Research Agent into workflow
    - Update `doa/main.py`
    - Import web_research_agent_node
    - Add web_research node conditionally (if config.web_research.enabled)
    - Add edge: memory_retrieval → web_research
    - Add edge: web_research → dynamic_agent_selection
    - Add conditional edge: memory_retrieval → dynamic_agent_selection (if disabled)
    - Test workflow compilation and execution
    - _Requirements: 6.1-6.5_
  
  - [x] 9.4 Update Python type definitions
    - Update `doa/models/types.py`
    - Add SerperSearchResult Pydantic model
    - Add SerperScrapeResult Pydantic model
    - Add WebResearchConfig Pydantic model
    - Add SerperConfig Pydantic model
    - _Requirements: 1.1, 2.1, 2.3_

- [x] 10. Checkpoint - Python implementation complete
  - Ensure all Python tests pass
  - Verify workflow integration works end-to-end
  - Test with real Serper API key (if available)
  - Verify parity with TypeScript implementation
  - Ask the user if questions arise

- [ ] 11. Property-based testing for TypeScript
  - [ ]* 11.1 Write property test for API key parsing
    - **Property 2: API Key Parsing**
    - **Validates: Requirements 2.5, 7.8**
    - Create `tradewizard-agents/src/utils/serper-client.property.test.ts`
    - Use fast-check to generate arrays of API keys
    - Verify parsed keys match input keys (trimmed, correct count)
    - Run with 100+ iterations
  
  - [ ]* 11.2 Write property test for search parameter validation
    - **Property 3: Search Parameter Validation**
    - **Validates: Requirements 2.2, 3.5**
    - Use fast-check to generate numResults values
    - Verify clamping to [1, 20] range with default 10
    - Run with 100+ iterations
  
  - [ ]* 11.3 Write property test for confidence score range
    - **Property 13: Confidence Score Range**
    - **Validates: Requirements 5.13**
    - Use fast-check to generate various agent execution scenarios
    - Verify confidence is always between 0 and 1 (inclusive)
    - Run with 100+ iterations
  
  - [ ]* 11.4 Write property test for key ID generation
    - **Property 17: Key ID Generation**
    - **Validates: Requirements 11.2**
    - Use fast-check to generate API key strings of various lengths
    - Verify getKeyId() returns first 8 chars (or full key if shorter)
    - Run with 100+ iterations
  
  - [ ]* 11.5 Write property test for LRU key selection
    - **Property 20: LRU Key Selection**
    - **Validates: Requirements 11.7, 11.11**
    - Use fast-check to generate key states with various lastUsed timestamps
    - Verify selected key has oldest lastUsed timestamp
    - Run with 100+ iterations
  
  - [ ]* 11.6 Write property test for key state update after success
    - **Property 21: Key State Update After Success**
    - **Validates: Requirements 11.15**
    - Use fast-check to generate successful API requests
    - Verify lastUsed updated and totalRequests incremented
    - Run with 100+ iterations

- [ ] 12. Property-based testing for Python
  - [ ]* 12.1 Write property test for API key parsing
    - **Property 2: API Key Parsing**
    - **Validates: Requirements 2.5, 7.8**
    - Create `doa/tools/test_serper_client_property.py`
    - Use hypothesis to generate lists of API keys
    - Verify parsed keys match input keys (trimmed, correct count)
    - Run with 100+ iterations
  
  - [ ]* 12.2 Write property test for search parameter validation
    - **Property 3: Search Parameter Validation**
    - **Validates: Requirements 2.2, 3.5**
    - Use hypothesis to generate num_results values
    - Verify clamping to [1, 20] range with default 10
    - Run with 100+ iterations
  
  - [ ]* 12.3 Write property test for confidence score range
    - **Property 13: Confidence Score Range**
    - **Validates: Requirements 5.13**
    - Use hypothesis to generate various agent execution scenarios
    - Verify confidence is always between 0 and 1 (inclusive)
    - Run with 100+ iterations
  
  - [ ]* 12.4 Write property test for key ID generation
    - **Property 17: Key ID Generation**
    - **Validates: Requirements 11.2**
    - Use hypothesis to generate API key strings of various lengths
    - Verify _get_key_id() returns first 8 chars (or full key if shorter)
    - Run with 100+ iterations
  
  - [ ]* 12.5 Write property test for LRU key selection
    - **Property 20: LRU Key Selection**
    - **Validates: Requirements 11.7, 11.11**
    - Use hypothesis to generate key states with various last_used timestamps
    - Verify selected key has oldest last_used timestamp
    - Run with 100+ iterations
  
  - [ ]* 12.6 Write property test for key state update after success
    - **Property 21: Key State Update After Success**
    - **Validates: Requirements 11.15**
    - Use hypothesis to generate successful API requests
    - Verify last_used updated and total_requests incremented
    - Run with 100+ iterations

- [x] 13. Documentation and deployment preparation
  - [x] 13.1 Add inline code documentation
    - Add JSDoc comments to all TypeScript classes and methods
    - Add Python docstrings to all classes and functions
    - Document all interfaces, types, and dataclasses
    - Document configuration options and defaults
    - _Requirements: 10.1, 10.3_
  
  - [x] 13.2 Create Serper API setup README
    - Create `docs/serper-setup.md`
    - Document how to obtain Serper API keys
    - Document multi-key configuration format
    - Document rate limits and pricing tiers
    - Document troubleshooting common issues
    - _Requirements: 10.5_
  
  - [x] 13.3 Document research document format
    - Add examples of well-structured research documents to agent prompt
    - Document expected sections (Background, Current Status, Key Events, etc.)
    - Document inline citation format
    - Document information quality assessment format
    - _Requirements: 10.4, 10.6_
  
  - [x] 13.4 Update main project documentation
    - Update `tradewizard-agents/README.md` with Web Research Agent section
    - Update `doa/README.md` with Web Research Agent section
    - Document workflow integration and agent placement
    - Document configuration options
    - Add usage examples

- [x] 14. Final checkpoint - Complete implementation
  - Ensure all tests pass (unit, property, integration) in both codebases
  - Verify TypeScript and Python implementations have feature parity
  - Test end-to-end workflow execution with real Serper API
  - Verify graceful degradation when API key not configured
  - Verify multi-key rotation works correctly
  - Review all documentation for completeness
  - Ask the user if questions arise before deployment

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- Each task references specific requirements for traceability
- Checkpoints ensure incremental validation at major milestones
- Property tests validate universal correctness properties across all inputs
- Unit tests validate specific examples, edge cases, and error conditions
- TypeScript implementation is completed first, then ported to Python for consistency
- Both implementations must maintain identical functionality and behavior
- Multi-key rotation follows the exact same pattern as NewsData API client
- Research document synthesis is critical - output must be structured narrative, not raw results
