# Implementation Plan: Autonomous Polling Agent with Data Fetching

## Overview

This implementation plan adds autonomous data fetching capabilities to TradeWizard's polling intelligence agent. The agent will use LangChain's tool-calling capabilities to autonomously fetch related markets, historical prices, cross-market data, and perform momentum analysis. This transforms the agent from a passive data consumer into an active researcher capable of deep, context-aware analysis.

## Tasks

- [x] 1. Implement tool cache utility
  - [x] 1.1 Create ToolCache class in `src/utils/tool-cache.ts`
    - Implement in-memory cache with session scoping
    - Add cache key generation from tool name and parameters
    - Implement get(), set(), clear(), and getStats() methods
    - Add cache hit/miss tracking
    - _Requirements: 1.6, 13.3, 13.4, 13.5_
  
  - [ ]* 1.2 Write unit tests for ToolCache
    - Test cache hit on second identical call
    - Test cache miss on first call
    - Test cache isolation between sessions
    - Test cache statistics tracking
    - _Requirements: 1.6, 13.3, 13.4_
  
  - [ ]* 1.3 Write property test for cache behavior
    - **Property 4: Tool Result Caching**
    - **Validates: Requirements 1.6, 13.3, 13.4**

- [x] 2. Implement polling tools infrastructure
  - [x] 2.1 Create tool types and interfaces in `src/tools/polling-tools.ts`
    - Define ToolContext interface with polymarketClient, cache, auditLog
    - Define tool input/output schemas using Zod
    - Create tool execution wrapper with error handling
    - Add audit logging for all tool calls
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5_
  
  - [ ]* 2.2 Write property test for tool input validation
    - **Property 1: Tool Input Validation**
    - **Validates: Requirements 1.2**
  
  - [ ]* 2.3 Write property test for tool audit logging
    - **Property 2: Tool Audit Logging Completeness**
    - **Validates: Requirements 1.3, 16.1, 16.2, 16.3**
  
  - [ ]* 2.4 Write property test for tool error handling
    - **Property 3: Tool Error Handling**
    - **Validates: Requirements 1.4, 12.1, 12.6**

- [x] 3. Implement fetchRelatedMarkets tool
  - [x] 3.1 Create fetchRelatedMarkets tool function
    - Define input schema (conditionId, minVolume)
    - Use PolymarketClient to fetch parent event
    - Use PolymarketClient to fetch all markets in event
    - Filter out input market from results
    - Filter markets by minimum volume threshold
    - Return structured market data with required fields
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 2.6_
  
  - [ ]* 3.2 Write unit tests for fetchRelatedMarkets
    - Test with valid conditionId returns related markets
    - Test with invalid conditionId returns empty array with warning
    - Test volume filtering works correctly
    - Test input market is excluded from results
    - _Requirements: 2.3, 2.5, 2.6_
  
  - [ ]* 3.3 Write property test for related markets exclusion
    - **Property 5: Related Markets Exclusion**
    - **Validates: Requirements 2.3**
  
  - [ ]* 3.4 Write property test for related markets output schema
    - **Property 6: Related Markets Output Schema**
    - **Validates: Requirements 2.4**
  
  - [ ]* 3.5 Write property test for volume filtering
    - **Property 7: Related Markets Volume Filter**
    - **Validates: Requirements 2.6**

- [x] 4. Implement fetchHistoricalPrices tool
  - [x] 4.1 Create fetchHistoricalPrices tool function
    - Define input schema (conditionId, timeHorizon)
    - Validate timeHorizon is one of '1h', '24h', '7d', '30d'
    - Fetch or simulate historical price data
    - Calculate price change percentage
    - Determine trend direction
    - Return at least 10 data points when available
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6_
  
  - [ ]* 4.2 Write unit tests for fetchHistoricalPrices
    - Test with each valid time horizon
    - Test with invalid time horizon returns error
    - Test returns at least 10 data points
    - Test calculates price change correctly
    - Test with market having no historical data
    - _Requirements: 3.2, 3.4, 3.5, 3.6_
  
  - [ ]* 4.3 Write property test for time horizon validation
    - **Property 8: Historical Prices Time Horizon Validation**
    - **Validates: Requirements 3.2**
  
  - [ ]* 4.4 Write property test for output schema
    - **Property 9: Historical Prices Output Schema**
    - **Validates: Requirements 3.3, 3.4**
  
  - [ ]* 4.5 Write property test for minimum data points
    - **Property 10: Historical Prices Minimum Data Points**
    - **Validates: Requirements 3.6**

- [x] 5. Checkpoint - Ensure basic tools work
  - Ensure all tests pass, ask the user if questions arise.

- [x] 6. Implement fetchCrossMarketData tool
  - [x] 6.1 Create fetchCrossMarketData tool function
    - Define input schema (eventId, maxMarkets)
    - Use PolymarketClient.fetchEventWithAllMarkets()
    - Sort markets by volume24h descending
    - Limit to maxMarkets (default 20)
    - Calculate aggregate sentiment metrics
    - Return event metadata and market array
    - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.5, 4.6_
  
  - [ ]* 6.2 Write unit tests for fetchCrossMarketData
    - Test with valid eventId returns event data
    - Test with invalid eventId returns error
    - Test limits results to maxMarkets
    - Test calculates aggregate sentiment correctly
    - Test markets are sorted by volume
    - _Requirements: 4.3, 4.4, 4.5, 4.6_
  
  - [ ]* 6.3 Write property test for output schema
    - **Property 11: Cross-Market Data Output Schema**
    - **Validates: Requirements 4.3, 4.5**
  
  - [ ]* 6.4 Write property test for market schema
    - **Property 12: Cross-Market Data Market Schema**
    - **Validates: Requirements 4.4**
  
  - [ ]* 6.5 Write property test for sentiment weighting
    - **Property 20: Cross-Market Sentiment Weighting**
    - **Validates: Requirements 9.4**

- [x] 7. Implement analyzeMarketMomentum tool
  - [x] 7.1 Create analyzeMarketMomentum tool function
    - Define input schema (conditionId)
    - Fetch historical prices for multiple time horizons
    - Calculate price velocity (rate of change)
    - Calculate price acceleration (change in velocity)
    - Compute momentum score (-1 to +1)
    - Classify direction (bullish/bearish/neutral) and strength (strong/moderate/weak)
    - Return momentum analysis with confidence
    - _Requirements: 5.1, 5.2, 5.3, 5.4, 5.5, 5.6_
  
  - [ ]* 7.2 Write unit tests for analyzeMarketMomentum
    - Test momentum score is within [-1, 1]
    - Test direction classification
    - Test strength classification
    - Test confidence is within [0, 1]
    - _Requirements: 5.3, 5.4, 5.5, 5.6_
  
  - [ ]* 7.3 Write property test for momentum score bounds
    - **Property 13: Momentum Score Bounds**
    - **Validates: Requirements 5.3**
  
  - [ ]* 7.4 Write property test for momentum output schema
    - **Property 14: Momentum Output Schema**
    - **Validates: Requirements 5.4, 5.5, 5.6**

- [x] 8. Implement detectSentimentShifts tool
  - [x] 8.1 Create detectSentimentShifts tool function
    - Define input schema (conditionId, threshold)
    - Fetch historical prices for all time horizons
    - Calculate price changes for each horizon
    - Compare changes against threshold
    - Classify magnitude (minor/moderate/major)
    - Return array of detected shifts
    - _Requirements: 6.1, 6.2, 6.3, 6.4, 6.5, 6.6_
  
  - [ ]* 8.2 Write unit tests for detectSentimentShifts
    - Test detects shifts above threshold
    - Test ignores movements below threshold
    - Test classifies magnitude correctly
    - Test identifies correct time horizon
    - _Requirements: 6.3, 6.4, 6.5_
  
  - [ ]* 8.3 Write property test for threshold enforcement
    - **Property 15: Sentiment Shift Threshold**
    - **Validates: Requirements 6.3**
  
  - [ ]* 8.4 Write property test for magnitude classification
    - **Property 16: Sentiment Shift Classification**
    - **Validates: Requirements 6.4**
  
  - [ ]* 8.5 Write property test for output schema
    - **Property 17: Sentiment Shift Output Schema**
    - **Validates: Requirements 6.5, 6.6**

- [x] 9. Create tool registry and exports
  - [x] 9.1 Create createPollingTools function in `src/tools/polling-tools.ts`
    - Convert all tool functions to LangChain StructuredTool format
    - Add tool descriptions for LLM
    - Register all tools in array
    - Export createPollingTools function
    - _Requirements: 1.1, 7.1_
  
  - [x] 9.2 Create barrel export in `src/tools/index.ts`
    - Export createPollingTools
    - Export tool types and interfaces
    - _Requirements: 1.1_

- [x] 10. Checkpoint - Ensure all tools are complete
  - Ensure all tests pass, ask the user if questions arise.

- [x] 11. Implement autonomous polling agent node
  - [x] 11.1 Create agent node in `src/nodes/autonomous-polling-agent.ts`
    - Import createReactAgent from @langchain/langgraph/prebuilt
    - Create LLM instance using createLLMInstance
    - Initialize PolymarketClient and ToolCache
    - Create polling tools with context
    - Create ReAct agent with tools and system prompt
    - _Requirements: 7.1, 7.2, 7.3, 7.4_
  
  - [x] 11.2 Implement agent node function
    - Check for MBD availability
    - Create tool cache with session ID
    - Prepare agent input with market data and keywords
    - Execute agent with timeout (45 seconds)
    - Parse agent output into AgentSignal
    - Add tool usage metadata to signal
    - Return agent signal and audit log
    - _Requirements: 7.5, 7.6, 14.1, 14.2, 14.4_
  
  - [x] 11.3 Add error handling to agent node
    - Handle missing MBD
    - Handle agent execution errors
    - Handle timeout errors
    - Return structured error responses
    - Log all errors to audit trail
    - _Requirements: 12.1, 12.2, 12.3, 12.6_
  
  - [ ]* 11.4 Write unit test for agent execution
    - Test agent successfully invokes tools
    - Test agent produces valid AgentSignal output
    - Test agent includes tool usage metadata
    - _Requirements: 7.4, 7.6_
  
  - [ ]* 11.5 Write property test for tool usage metadata
    - **Property 18: Agent Tool Usage Metadata**
    - **Validates: Requirements 7.6**
  
  - [ ]* 11.6 Write property test for tool call limit
    - **Property 23: Tool Call Limit**
    - **Validates: Requirements 14.2**
  
  - [ ]* 11.7 Write property test for agent signal schema
    - **Property 25: Agent Signal Schema Compatibility**
    - **Validates: Requirements 15.2**

- [x] 12. Create autonomous polling agent system prompt
  - [x] 12.1 Define AUTONOMOUS_POLLING_SYSTEM_PROMPT constant
    - Define agent role as autonomous polling analyst
    - List available tools with descriptions
    - Provide analysis strategy guidelines
    - Define tool usage guidelines (max 5 calls)
    - Specify output format requirements
    - _Requirements: 7.2, 8.1, 8.2, 8.3, 8.4, 8.5, 8.6_

- [x] 13. Add configuration for autonomous polling agent
  - [x] 13.1 Create polling agent config in `src/config/polling-agent-config.ts`
    - Define PollingAgentConfig interface
    - Add autonomous mode flag (default: false)
    - Add maxToolCalls setting (default: 5)
    - Add timeout setting (default: 45000ms)
    - Add cacheEnabled flag (default: true)
    - Add fallbackToBasic flag (default: true)
    - _Requirements: 15.3, 15.4_
  
  - [x] 13.2 Update main config in `src/config/index.ts`
    - Add pollingAgent config to EngineConfig
    - Export PollingAgentConfig type
    - _Requirements: 15.3_

- [x] 14. Integrate autonomous agent into workflow
  - [x] 14.1 Export autonomous polling agent from `src/nodes/index.ts`
    - Export createAutonomousPollingAgentNode
    - _Requirements: 15.6_
  
  - [x] 14.2 Add conditional agent selection in `src/workflow.ts`
    - Check config.pollingAgent.autonomous flag
    - Use autonomous agent when enabled, basic agent when disabled
    - Add autonomous_polling_agent node to StateGraph
    - Add parallel edges (from dynamic selection, to signal fusion)
    - _Requirements: 15.3, 15.4, 15.6_
  
  - [ ]* 14.3 Write integration test for workflow
    - Test autonomous agent integrates into workflow
    - Test agent signal reaches consensus engine
    - Test workflow completes successfully
    - _Requirements: 15.6_

- [x] 15. Implement audit logging enhancements
  - [x] 15.1 Add tool audit logging to agent node
    - Log each tool invocation with timestamp, name, params
    - Log tool execution time
    - Log tool results or errors
    - Log cache hits and misses
    - Include tool usage summary in agent audit entry
    - _Requirements: 16.1, 16.2, 16.3, 16.4, 16.5, 16.6_
  
  - [ ]* 15.2 Write property test for tool error logging
    - **Property 21: Tool Error Audit Logging**
    - **Validates: Requirements 12.3**
  
  - [ ]* 15.3 Write property test for cache statistics logging
    - **Property 22: Cache Statistics Logging**
    - **Validates: Requirements 13.6, 16.4**
  
  - [ ]* 15.4 Write property test for execution time logging
    - **Property 24: Tool Execution Time Logging**
    - **Validates: Requirements 14.5**
  
  - [ ]* 15.5 Write property test for audit summary completeness
    - **Property 26: Audit Summary Completeness**
    - **Validates: Requirements 16.5, 16.6**

- [ ] 16. Add cross-market analysis properties
  - [ ]* 16.1 Write property test for cross-market alignment bounds
    - **Property 19: Cross-Market Alignment Bounds**
    - **Validates: Requirements 9.5**

- [x] 17. Final checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 18. Add documentation and examples
  - [x] 18.1 Create README for autonomous polling agent
    - Document tool capabilities
    - Provide configuration examples
    - Show example agent outputs
    - Document performance characteristics
  
  - [x] 18.2 Add inline code documentation
    - Document all tool functions
    - Document agent node function
    - Document configuration options
    - Add usage examples in comments

## Notes

- Tasks marked with `*` are optional test tasks and can be skipped for faster MVP
- Each task references specific requirements for traceability
- Property tests validate universal correctness properties with 100+ iterations
- Unit tests validate specific examples and edge cases
- Integration tests validate workflow integration
- The implementation uses LangChain's tool-calling capabilities
- No new external dependencies required - all packages already in project
- Backward compatible - existing polling agent continues to work
- Feature flag controls autonomous mode activation
