# Implementation Plan: Autonomous NewsData Agents

## Overview

This implementation plan transforms three existing TradeWizard agents (Breaking News, Media Sentiment, and Market Microstructure) from passive news consumers into autonomous, tool-using agents. The implementation follows the proven autonomous polling agent pattern, creating LangChain tools for NewsData API access and integrating them with ReAct-based agent executors.

## Tasks

- [x] 1. Set up NewsData tool infrastructure
  - Create `src/tools/newsdata-tools.ts` with tool definitions
  - Implement tool context interface and helper functions
  - Set up tool cache integration (reuse from autonomous polling agent)
  - Update `src/tools/index.ts` to export NewsData tools
  - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.6_

- [x] 2. Implement fetchLatestNews tool
  - [x] 2.1 Create fetchLatestNews tool with Zod schema
    - Define input schema with query, timeframe, filtering parameters
    - Implement tool execution function
    - Add parameter validation and transformation logic
    - _Requirements: 2.1, 2.2, 2.3, 2.4_
  
  - [ ]* 2.2 Write property test for fetchLatestNews
    - **Property 6: Timeframe Enum Validation**
    - **Property 7: Article Schema Consistency**
    - **Property 8: Article Count Limit**
    - **Validates: Requirements 2.2, 2.5, 2.7**
  
  - [ ]* 2.3 Write unit tests for fetchLatestNews
    - Test valid parameters return articles
    - Test invalid timeframe returns validation error
    - Test no results returns empty array with warning
    - Test article schema compliance
    - _Requirements: 2.1, 2.2, 2.5, 2.6, 2.7_

- [x] 3. Implement fetchArchiveNews tool
  - [x] 3.1 Create fetchArchiveNews tool with Zod schema
    - Define input schema with date range and filtering parameters
    - Implement date range validation logic
    - Add warning for date ranges exceeding 30 days
    - _Requirements: 3.1, 3.2, 3.3, 3.6_
  
  - [ ]* 3.2 Write property test for fetchArchiveNews
    - **Property 9: Date Range Validation**
    - **Property 10: Date Format Validation**
    - **Validates: Requirements 3.2, 3.3**
  
  - [ ]* 3.3 Write unit tests for fetchArchiveNews
    - Test valid date range returns articles
    - Test fromDate >= toDate returns validation error
    - Test invalid date format returns validation error
    - Test date range > 30 days logs warning
    - _Requirements: 3.1, 3.2, 3.3, 3.5, 3.6, 3.7_

- [x] 4. Implement fetchCryptoNews tool
  - [x] 4.1 Create fetchCryptoNews tool with Zod schema
    - Define input schema with coin symbols and filtering parameters
    - Implement crypto-specific parameter handling
    - Add crypto metadata extraction logic
    - _Requirements: 4.1, 4.2, 4.3, 4.5_
  
  - [ ]* 4.2 Write property test for fetchCryptoNews
    - **Property 11: Crypto Metadata Presence**
    - **Validates: Requirements 4.4**
  
  - [ ]* 4.3 Write unit tests for fetchCryptoNews
    - Test with coin symbols returns crypto articles
    - Test with no coin symbols returns general crypto news
    - Test articles include crypto metadata when available
    - Test sentiment filtering works correctly
    - _Requirements: 4.1, 4.2, 4.4, 4.5, 4.6, 4.7_

- [x] 5. Implement fetchMarketNews tool
  - [x] 5.1 Create fetchMarketNews tool with Zod schema
    - Define input schema with symbols, organizations, and filtering parameters
    - Implement market-specific parameter handling
    - Add market metadata extraction logic
    - _Requirements: 5.1, 5.2, 5.3, 5.5_
  
  - [ ]* 5.2 Write property test for fetchMarketNews
    - **Property 12: Market Metadata Presence**
    - **Validates: Requirements 5.4**
  
  - [ ]* 5.3 Write unit tests for fetchMarketNews
    - Test with symbols/organizations returns market articles
    - Test with no symbols/organizations returns general market news
    - Test articles include market metadata when available
    - Test sentiment filtering works correctly
    - _Requirements: 5.1, 5.2, 5.3, 5.4, 5.5, 5.6, 5.7_

- [x] 6. Implement tool error handling and caching
  - [x] 6.1 Add error handling wrapper for all tools
    - Implement try-catch blocks with structured error returns
    - Add audit logging for errors
    - Ensure tools never throw uncaught exceptions
    - _Requirements: 1.4, 15.1, 15.3_
  
  - [x] 6.2 Integrate tool cache for all tools
    - Add cache check before tool execution
    - Add cache set after successful execution
    - Implement cache key generation for each tool
    - _Requirements: 1.6, 16.3, 16.4_
  
  - [ ]* 6.3 Write property tests for error handling and caching
    - **Property 1: Tool Input Validation**
    - **Property 2: Tool Audit Logging Completeness**
    - **Property 3: Tool Error Handling**
    - **Property 4: Tool Result Caching**
    - **Property 5: Cache Expiration**
    - **Property 15: Cache Hit Logging**
    - **Validates: Requirements 1.2, 1.3, 1.4, 1.6, 15.1, 15.3, 16.3, 16.4, 16.5, 16.6**

- [x] 7. Checkpoint - Ensure all tool tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 8. Create autonomous agent infrastructure
  - Create `src/nodes/autonomous-news-agents.ts` with agent factory functions
  - Implement createAutonomousNewsAgent function
  - Add agent configuration interfaces
  - Update `src/nodes/index.ts` to export autonomous agents
  - _Requirements: 6.1, 6.2, 7.1, 7.2, 8.1, 8.2_

- [x] 9. Implement Breaking News Agent system prompt
  - [x] 9.1 Create AUTONOMOUS_BREAKING_NEWS_SYSTEM_PROMPT
    - Define agent role and capabilities
    - Document available tools and usage guidelines
    - Specify breaking news detection strategy
    - Add analysis focus and output format instructions
    - _Requirements: 6.2, 6.4_
  
  - [x] 9.2 Create autonomous breaking news agent node function
    - Implement createAutonomousBreakingNewsAgentNode
    - Add tool initialization and agent creation
    - Implement agent invocation with timeout
    - Add tool usage metadata to output
    - _Requirements: 6.1, 6.3, 6.6, 6.7, 6.8_
  
  - [ ]* 9.3 Write unit tests for breaking news agent
    - Test agent accepts MBD input
    - Test agent produces AgentSignal output
    - Test agent includes tool usage metadata
    - Test agent handles tool failures gracefully
    - _Requirements: 6.1, 6.8, 15.6, 18.1, 18.2_

- [x] 10. Implement Media Sentiment Agent system prompt
  - [x] 10.1 Create AUTONOMOUS_MEDIA_SENTIMENT_SYSTEM_PROMPT
    - Define agent role and capabilities
    - Document available tools and usage guidelines
    - Specify sentiment aggregation strategy
    - Add analysis focus and output format instructions
    - _Requirements: 7.2, 7.4_
  
  - [x] 10.2 Create autonomous media sentiment agent node function
    - Implement createAutonomousMediaSentimentAgentNode
    - Add tool initialization and agent creation
    - Implement agent invocation with timeout
    - Add tool usage metadata to output
    - _Requirements: 7.1, 7.3, 7.6, 7.7, 7.8_
  
  - [ ]* 10.3 Write unit tests for media sentiment agent
    - Test agent accepts MBD input
    - Test agent produces AgentSignal output
    - Test agent includes tool usage metadata
    - Test agent handles tool failures gracefully
    - _Requirements: 7.1, 7.8, 15.6, 18.1, 18.2_

- [x] 11. Implement Market Microstructure Agent system prompt
  - [x] 11.1 Create AUTONOMOUS_MARKET_MICROSTRUCTURE_SYSTEM_PROMPT
    - Define agent role and capabilities
    - Document available tools and usage guidelines
    - Specify microstructure analysis strategy
    - Add analysis focus and output format instructions
    - _Requirements: 8.2, 8.4_
  
  - [x] 11.2 Create autonomous market microstructure agent node function
    - Implement createAutonomousMarketMicrostructureAgentNode
    - Add tool initialization and agent creation
    - Implement agent invocation with timeout
    - Add tool usage metadata to output
    - _Requirements: 8.1, 8.3, 8.6, 8.7, 8.8_
  
  - [ ]* 11.3 Write unit tests for market microstructure agent
    - Test agent accepts MBD input
    - Test agent produces AgentSignal output
    - Test agent includes tool usage metadata
    - Test agent handles tool failures gracefully
    - _Requirements: 8.1, 8.8, 15.6, 18.1, 18.2_

- [ ] 12. Implement agent property tests
  - [ ]* 12.1 Write property test for agent tool usage metadata
    - **Property 13: Agent Tool Usage Metadata**
    - **Validates: Requirements 6.8, 7.8, 8.8**
  
  - [ ]* 12.2 Write property test for workflow resilience
    - **Property 14: Workflow Resilience**
    - **Validates: Requirements 15.6**
  
  - [ ]* 12.3 Write property test for tool call limit
    - **Property 16: Tool Call Limit**
    - **Validates: Requirements 17.4**
  
  - [ ]* 12.4 Write property test for timing metrics
    - **Property 17: Timing Metrics Separation**
    - **Validates: Requirements 17.6**
  
  - [ ]* 12.5 Write property test for agent signal schema
    - **Property 18: Agent Signal Schema Compatibility**
    - **Validates: Requirements 18.2**
  
  - [ ]* 12.6 Write property test for audit summary
    - **Property 19: Audit Summary Completeness**
    - **Validates: Requirements 19.5, 19.6**

- [x] 13. Checkpoint - Ensure all agent tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 14. Add agent configuration
  - [x] 14.1 Create `src/config/news-agents-config.ts`
    - Define NewsAgentConfig interface
    - Add default configuration values
    - Implement configuration validation
    - _Requirements: 18.3_
  
  - [x] 14.2 Update `src/config/index.ts`
    - Add news agent configuration to EngineConfig
    - Export news agent config types
    - _Requirements: 18.3_
  
  - [ ]* 14.3 Write unit tests for configuration
    - Test configuration validation
    - Test feature flag behavior
    - Test fallback to basic mode when autonomous disabled
    - _Requirements: 18.3, 18.4_

- [x] 15. Integrate autonomous agents into workflow
  - [x] 15.1 Update `src/workflow.ts`
    - Add autonomous breaking news agent node
    - Add autonomous media sentiment agent node
    - Add autonomous market microstructure agent node
    - Add conditional logic for autonomous vs basic mode
    - _Requirements: 18.4, 18.6_
  
  - [x] 15.2 Add feature flag checks
    - Implement autonomous mode detection from config
    - Add fallback to basic agents when autonomous disabled
    - _Requirements: 18.3, 18.4_
  
  - [ ]* 15.3 Write integration tests for workflow
    - Test autonomous agents integrate into workflow
    - Test agent signals reach consensus engine
    - Test workflow completes successfully
    - Test fallback to basic mode works correctly
    - _Requirements: 18.4, 18.5, 18.6_

- [x] 16. Add comprehensive error handling
  - [x] 16.1 Implement timeout handling for all agents
    - Add Promise.race with timeout for agent invocation
    - Return partial results on timeout
    - Log timeout warnings
    - _Requirements: 17.1, 17.2, 17.3_
  
  - [x] 16.2 Implement graceful degradation
    - Add fallback to basic mode on critical failures
    - Include tool failure information in riskFactors
    - Adjust confidence downward on tool failures
    - _Requirements: 15.2, 15.4, 15.5, 15.6_
  
  - [ ]* 16.3 Write integration tests for error handling
    - Test agent continues on tool failure
    - Test workflow doesn't crash on agent error
    - Test timeout handling with slow tools
    - Test graceful degradation to basic mode
    - _Requirements: 15.2, 15.6, 18.4_

- [x] 17. Add audit logging and monitoring
  - [x] 17.1 Implement comprehensive audit logging
    - Log all tool invocations with parameters
    - Log tool execution time and results
    - Log cache hits and misses
    - Add tool usage summary to agent audit entries
    - _Requirements: 1.3, 15.3, 16.6, 19.1, 19.2, 19.3, 19.4, 19.5, 19.6_
  
  - [x] 17.2 Add timing metrics separation
    - Track tool execution time separately from LLM time
    - Include both metrics in audit log
    - _Requirements: 17.6_
  
  - [ ]* 17.3 Write unit tests for audit logging
    - Test all tool calls are logged
    - Test error logging works correctly
    - Test cache hit/miss logging
    - Test audit summary completeness
    - _Requirements: 1.3, 15.3, 16.6, 19.1, 19.2, 19.3, 19.4, 19.5, 19.6_

- [x] 18. Final checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 19. Documentation and cleanup
  - [x] 19.1 Add inline documentation
    - Document all tool functions with JSDoc comments
    - Document agent system prompts with usage examples
    - Document configuration options
    - _Requirements: All_
  
  - [x] 19.2 Update README or docs
    - Document autonomous news agents feature
    - Add configuration examples
    - Add usage examples
    - Document performance characteristics
    - _Requirements: All_
  
  - [x] 19.3 Code cleanup
    - Remove any debug logging
    - Ensure consistent code style
    - Verify all imports are correct
    - _Requirements: All_

## Notes

- Tasks marked with `*` are optional property-based and unit tests that can be skipped for faster MVP
- Each task references specific requirements for traceability
- Checkpoints ensure incremental validation
- Property tests validate universal correctness properties with 100+ iterations
- Unit tests validate specific examples and edge cases
- Integration tests validate end-to-end agent execution with tools
- The implementation reuses the tool cache from the autonomous polling agent
- All agents follow the same ReAct pattern as the autonomous polling agent
- Feature flags enable gradual rollout alongside existing basic agents
