# Implementation Plan: Human-Readable Agent Timestamps

## Overview

This implementation plan converts the timestamp formatting design into actionable coding tasks. The approach is incremental, starting with core utilities, adding comprehensive tests, then integrating with agent nodes. Each task builds on previous work, with checkpoints to ensure quality.

## Tasks

- [x] 1. Create core timestamp formatter utility
  - [x] 1.1 Implement timestamp formatter module with core functions
    - Create `src/utils/timestamp-formatter.ts`
    - Implement `formatTimestamp()` main function with auto-selection logic
    - Implement `formatRelativeTime()` for recent timestamps
    - Implement `formatAbsoluteTime()` for older timestamps
    - Implement `formatTimestampBatch()` for efficient batch processing
    - Add TypeScript interfaces: `TimestampFormatOptions`, `FormattedTimestamp`
    - Use date-fns functions: `parseISO`, `formatDistanceToNow`, `format`, `formatInTimeZone`, `isValid`
    - Implement 7-day threshold logic for relative vs absolute selection
    - Add null/invalid timestamp handling with fallback messages
    - _Requirements: 1.1, 1.3, 1.4, 2.1, 2.2, 2.3, 2.4, 2.5, 3.1-3.5, 4.1-4.4, 9.1, 9.2, 11.1, 11.2, 11.3_
  
  - [ ]* 1.2 Write property test for ISO 8601 format preservation
    - **Property 1: ISO 8601 Format Preservation in State**
    - **Validates: Requirements 1.1, 1.3, 5.4, 6.3, 7.3, 8.2**
  
  - [ ]* 1.3 Write property test for human-readable conversion
    - **Property 3: Human-Readable Conversion**
    - **Validates: Requirements 2.1**
  
  - [ ]* 1.4 Write property test for relative time format selection
    - **Property 4: Relative Time Format Selection**
    - **Validates: Requirements 2.2, 3.5**
  
  - [ ]* 1.5 Write property test for absolute time format selection
    - **Property 5: Absolute Time Format Selection**
    - **Validates: Requirements 2.3, 4.1**
  
  - [ ]* 1.6 Write property test for timezone inclusion
    - **Property 6: Timezone Inclusion in Absolute Format**
    - **Validates: Requirements 2.4, 4.3, 9.3**
  
  - [ ]* 1.7 Write property test for null and invalid handling
    - **Property 7: Graceful Null and Invalid Handling**
    - **Validates: Requirements 2.5, 11.4**
  
  - [ ]* 1.8 Write property test for 12-hour clock format
    - **Property 8: 12-Hour Clock Format**
    - **Validates: Requirements 4.2**
  
  - [ ]* 1.9 Write property test for full month names
    - **Property 9: Full Month Names**
    - **Validates: Requirements 4.4**
  
  - [ ]* 1.10 Write property test for Eastern Time conversion
    - **Property 15: Eastern Time Conversion**
    - **Validates: Requirements 9.1, 9.4**
  
  - [ ]* 1.11 Write property test for DST handling
    - **Property 16: Daylight Saving Time Handling**
    - **Validates: Requirements 9.2**
  
  - [ ]* 1.12 Write property test for timezone conversion failure recovery
    - **Property 19: Timezone Conversion Failure Recovery**
    - **Validates: Requirements 11.3**
  
  - [ ]* 1.13 Write property test for performance constraint
    - **Property 20: Performance Constraint**
    - **Validates: Requirements 12.2**
  
  - [ ]* 1.14 Write property test for memory leak prevention
    - **Property 21: Memory Leak Prevention**
    - **Validates: Requirements 12.4**
  
  - [ ]* 1.15 Write unit tests for timestamp formatter
    - Test specific examples: "just now", "5 minutes ago", "2 hours ago", "3 days ago"
    - Test boundary conditions: exactly 7 days old
    - Test null input returns "unknown time"
    - Test invalid format returns "invalid timestamp"
    - Test DST transition dates (March 10, November 3)
    - Test 12-hour format (1-12, not 0-23)
    - Test full month names (January, not Jan)
    - _Requirements: 2.5, 3.1-3.5, 4.1-4.4, 9.2, 11.1, 11.2_

- [x] 2. Create agent context formatter utility
  - [x] 2.1 Implement agent context formatter module
    - Create `src/utils/agent-context-formatter.ts`
    - Implement `formatMarketBriefingForAgent()` to format MBD with human-readable timestamps
    - Implement `formatExternalDataForAgent()` to format news/polling/social data
    - Implement `formatAgentSignalsForAgent()` to format historical signals
    - Implement `formatMarketContextForAgent()` as main integration function
    - Import and use timestamp formatter utility
    - Format all timestamp fields: expiryTimestamp, catalyst timestamps, news publishedAt, poll dates, signal timestamps
    - Return formatted string suitable for LLM prompt
    - Ensure state immutability (use Readonly types)
    - _Requirements: 5.1, 5.2, 5.3, 5.4, 6.1, 6.2, 6.3, 7.1, 7.2, 7.3, 8.1, 8.2, 8.4_
  
  - [ ]* 2.2 Write property test for market data timestamp formatting
    - **Property 10: Market Data Timestamp Formatting**
    - **Validates: Requirements 5.1, 5.2, 5.3**
  
  - [ ]* 2.3 Write property test for news article timestamp formatting
    - **Property 11: News Article Timestamp Formatting**
    - **Validates: Requirements 6.1, 6.2**
  
  - [ ]* 2.4 Write property test for agent signal timestamp formatting
    - **Property 12: Agent Signal Timestamp Formatting**
    - **Validates: Requirements 7.1, 7.2**
  
  - [ ]* 2.5 Write property test for agent context boundary conversion
    - **Property 13: Agent Context Boundary Conversion**
    - **Validates: Requirements 8.1, 8.4**
  
  - [ ]* 2.6 Write unit tests for agent context formatter
    - Test MBD formatting includes human-readable expiry and catalyst times
    - Test news article formatting with multiple articles
    - Test agent signal formatting with historical signals
    - Test complete market context formatting
    - Test state immutability (original state unchanged after formatting)
    - _Requirements: 5.1-5.4, 6.1-6.3, 7.1-7.3, 8.1, 8.2, 8.4_

- [ ] 3. Checkpoint - Ensure all utility tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 4. Integrate with agent nodes
  - [x] 4.1 Update main agent node to use formatted context
    - Modify `src/nodes/agents.ts` in `createAgentNode()` function
    - Import `formatMarketContextForAgent` from agent-context-formatter
    - Replace `JSON.stringify(state.mbd, null, 2)` with formatted context
    - Update user message to use formatted context instead of raw JSON
    - Ensure memory context formatting also uses human-readable timestamps
    - _Requirements: 8.1, 8.2, 8.3, 8.4_
  
  - [ ]* 4.2 Write property test for consistent formatting across nodes
    - **Property 14: Consistent Formatting Across Nodes**
    - **Validates: Requirements 8.3**
  
  - [ ]* 4.3 Write integration test for agent node formatting
    - Test agent node receives formatted timestamps in context
    - Test agent node state remains unchanged after formatting
    - Test agent can successfully analyze with formatted timestamps
    - _Requirements: 8.1, 8.2, 8.3, 8.4_

- [x] 5. Integrate with autonomous news agents
  - [x] 5.1 Update autonomous news agent node to use formatted context
    - Modify `src/nodes/autonomous-news-agents.ts` in `createAutonomousNewsAgentNode()` function
    - Import `formatExternalDataForAgent` from agent-context-formatter
    - Update news data formatting to use human-readable timestamps
    - Ensure consistency with main agent node formatting
    - _Requirements: 6.1, 6.2, 8.3_
  
  - [ ]* 5.2 Write integration test for news agent formatting
    - Test news agent receives formatted news timestamps
    - Test multiple news articles have consistent formatting
    - _Requirements: 6.1, 6.2, 8.3_

- [x] 6. Integrate with thesis construction node
  - [x] 6.1 Update thesis construction to use formatted context
    - Modify `src/nodes/thesis-construction.ts`
    - Import formatting utilities
    - Update bull and bear thesis construction to use formatted timestamps
    - Format catalyst timestamps in thesis context
    - _Requirements: 8.1, 8.3_
  
  - [ ]* 6.2 Write integration test for thesis construction formatting
    - Test thesis construction receives formatted timestamps
    - Test catalyst timestamps are human-readable
    - _Requirements: 8.1, 8.3_

- [x] 7. Integrate with cross-examination node
  - [x] 7.1 Update cross-examination to use formatted context
    - Modify `src/nodes/cross-examination.ts`
    - Import formatting utilities
    - Update debate context to use formatted timestamps
    - Format thesis timestamps and catalyst times
    - _Requirements: 8.1, 8.3_
  
  - [ ]* 7.2 Write integration test for cross-examination formatting
    - Test debate context uses formatted timestamps
    - Test consistency with other nodes
    - _Requirements: 8.1, 8.3_

- [x] 8. Integrate with consensus engine node
  - [x] 8.1 Update consensus engine to use formatted context
    - Modify `src/nodes/consensus-engine.ts`
    - Import formatting utilities
    - Update consensus calculation context to use formatted timestamps
    - Format signal timestamps in consensus context
    - _Requirements: 8.1, 8.3_
  
  - [ ]* 8.2 Write integration test for consensus engine formatting
    - Test consensus engine receives formatted timestamps
    - Test signal timestamps are human-readable
    - _Requirements: 8.1, 8.3_

- [ ] 9. Checkpoint - Ensure all integration tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 10. Add backward compatibility verification
  - [ ]* 10.1 Write property test for backward compatibility
    - **Property 17: Backward Compatibility**
    - **Validates: Requirements 10.2**
  
  - [ ]* 10.2 Write property test for formatting disable fallback
    - **Property 18: Formatting Disable Fallback**
    - **Validates: Requirements 10.3**
  
  - [ ]* 10.3 Write integration tests for backward compatibility
    - Test existing code that reads timestamps from state still works
    - Test database persistence still uses ISO 8601
    - Test API responses still use ISO 8601
    - Test disabling formatting returns ISO 8601 strings
    - _Requirements: 10.2, 10.3_

- [x] 11. Add configuration and feature flag support
  - [x] 11.1 Add configuration options for timestamp formatting
    - Add environment variables: `ENABLE_HUMAN_READABLE_TIMESTAMPS`, `TIMESTAMP_TIMEZONE`, `RELATIVE_TIME_THRESHOLD_DAYS`
    - Create configuration interface in timestamp-formatter
    - Add default configuration values
    - Support runtime configuration override
    - _Requirements: 10.3_
  
  - [x] 11.2 Implement feature flag for gradual rollout
    - Add feature flag check in agent-context-formatter
    - When disabled, return ISO 8601 format
    - When enabled, use human-readable format
    - Default to enabled for new deployments
    - _Requirements: 10.3_

- [-] 12. Update memory context formatting
  - [x] 12.1 Update memory retrieval to use formatted timestamps
    - Modify `src/database/memory-retrieval.ts` if it formats timestamps for agents
    - Ensure historical signal timestamps are human-readable
    - Maintain consistency with agent context formatting
    - _Requirements: 7.1, 7.2, 8.3_
  
  - [ ]* 12.2 Write integration test for memory context formatting
    - Test memory context includes formatted timestamps
    - Test consistency with agent signal formatting
    - _Requirements: 7.1, 7.2, 8.3_

- [ ] 13. Final checkpoint - Comprehensive testing
  - Ensure all tests pass, ask the user if questions arise.

- [x] 14. Documentation and deployment preparation
  - [x] 14.1 Add JSDoc comments to all public functions
    - Document timestamp-formatter.ts functions
    - Document agent-context-formatter.ts functions
    - Include usage examples in comments
    - Document configuration options
  
  - [x] 14.2 Update README or documentation
    - Document the timestamp formatting feature
    - Explain configuration options
    - Provide examples of formatted output
    - Document feature flag usage for deployment

## Notes

- Tasks marked with `*` are optional property-based and unit tests that can be skipped for faster MVP
- Each task references specific requirements for traceability
- Checkpoints ensure incremental validation at key milestones
- Property tests validate universal correctness properties with 100+ iterations
- Unit tests validate specific examples and edge cases
- Integration tests ensure the formatting layer works correctly with existing nodes
- The implementation maintains backward compatibility - no breaking changes to existing code
- Feature flag allows gradual rollout and easy rollback if issues arise
