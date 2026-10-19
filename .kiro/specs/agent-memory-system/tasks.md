# Implementation Plan: Agent Memory System

## Overview

This implementation plan transforms TradeWizard's multi-agent system from an open-loop to a closed-loop architecture by enabling agents to access and reference their previous analysis outputs. The implementation follows a layered approach: database layer → formatting utilities → state integration → agent enhancement → evolution tracking.

## Tasks

- [x] 1. Implement Memory Retrieval Service
  - Create database service for querying historical agent signals
  - Implement query logic with proper indexing and limits
  - Add validation and error handling
  - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 4.3, 4.5_

- [ ]* 1.1 Write property test for memory retrieval correctness
  - **Property 1: Memory Retrieval Correctness**
  - **Validates: Requirements 1.1, 1.2, 1.3, 1.5, 4.3**

- [ ]* 1.2 Write property test for empty memory context handling
  - **Property 2: Empty Memory Context Handling**
  - **Validates: Requirements 1.4, 6.3, 9.1**

- [x] 2. Implement Memory Context Formatter
  - Create formatting utilities for historical signals
  - Implement timestamp, percentage, and list formatting
  - Add truncation logic for long memory contexts
  - _Requirements: 2.2, 2.3, 2.5, 7.1, 7.2, 7.3, 7.4, 7.5_

- [ ]* 2.1 Write property test for memory formatting correctness
  - **Property 3: Memory Formatting Correctness**
  - **Validates: Requirements 2.2, 2.3, 2.5, 7.1, 7.2, 7.3, 7.4**

- [ ]* 2.2 Write property test for memory context truncation
  - **Property 4: Memory Context Truncation**
  - **Validates: Requirements 7.5**

- [x] 3. Extend LangGraph State
  - Add memoryContext field to GraphState annotation
  - Update state type definitions
  - Ensure backward compatibility with existing state
  - _Requirements: 5.1_

- [x]* 3.1 Write unit test for state extension
  - Test that memoryContext field is present in state
  - Test default value is empty Map
  - _Requirements: 5.1_

- [x] 4. Create Memory Retrieval Node
  - Implement LangGraph node for memory retrieval
  - Add parallel memory fetching for all agents
  - Implement timeout and error handling
  - Add audit logging for memory retrieval operations
  - _Requirements: 5.2, 5.4, 9.1, 9.3_

- [ ]* 4.1 Write property test for state integration
  - **Property 5: State Integration**
  - **Validates: Requirements 5.1, 5.2, 5.4**

- [ ]* 4.2 Write property test for agent memory isolation
  - **Property 6: Agent Memory Isolation**
  - **Validates: Requirements 5.5**

- [x] 5. Checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 6. Enhance Agent Node Factory
  - Modify createAgentNode to inject memory context into prompts
  - Add memory context formatting to system prompts
  - Include instructions for using historical analysis
  - Ensure backward compatibility with agents that have no history
  - _Requirements: 2.1, 3.1, 3.2, 3.3, 3.4, 3.5_

- [ ]* 6.1 Write property test for agent context integration
  - **Property 11: Agent Context Integration**
  - **Validates: Requirements 2.1**

- [ ]* 6.2 Write unit test for prompt enhancement
  - Test that memory context is included in agent prompts
  - Test that instructions are added when memory exists
  - Test that empty memory message is shown when no history
  - _Requirements: 2.1, 2.4_

- [x] 7. Implement Evolution Tracking Service
  - Create service for comparing new signals to historical signals
  - Implement detection logic for direction changes
  - Implement detection logic for probability shifts (>10%)
  - Implement detection logic for confidence changes (>0.2)
  - Implement detection logic for reasoning evolution (key drivers)
  - Add audit logging for evolution events
  - _Requirements: 8.1, 8.2, 8.3, 8.4, 8.5_

- [ ]* 7.1 Write property test for evolution event detection
  - **Property 8: Evolution Event Detection**
  - **Validates: Requirements 8.1, 8.2, 8.3, 8.4, 8.5**

- [ ]* 7.2 Write property test for comparison execution
  - **Property 12: Comparison Execution**
  - **Validates: Requirements 8.1**

- [x] 8. Implement Signal Validation
  - Add validation logic for required fields
  - Add range validation for probabilities and confidence
  - Add enum validation for direction
  - Implement filtering of invalid signals
  - _Requirements: 10.1, 10.2, 10.3, 10.4, 10.5_

- [ ]* 8.1 Write property test for signal validation
  - **Property 9: Signal Validation**
  - **Validates: Requirements 10.1, 10.2, 10.3, 10.4, 10.5**

- [x] 9. Implement Error Handling and Retry Logic
  - Add database connection error handling
  - Implement exponential backoff for rate limits
  - Add query timeout logic (5 seconds)
  - Implement graceful degradation for all error types
  - Add comprehensive error logging
  - _Requirements: 9.1, 9.2, 9.3, 9.4, 9.5_

- [ ]* 9.1 Write property test for error resilience
  - **Property 10: Error Resilience**
  - **Validates: Requirements 9.1, 9.2, 9.3, 9.4, 9.5**

- [ ]* 9.2 Write unit tests for specific error scenarios
  - Test connection failure handling
  - Test timeout handling
  - Test rate limit retry logic
  - Test data corruption handling
  - _Requirements: 9.1, 9.2, 9.3, 9.4, 9.5_

- [x] 10. Integrate Memory Retrieval into Workflow
  - Add memory retrieval node to workflow graph
  - Add edge from market ingestion to memory retrieval
  - Add edge from memory retrieval to agent nodes
  - Ensure memory retrieval runs before agent execution
  - Update workflow configuration
  - _Requirements: 2.1, 5.2_

- [ ]* 10.1 Write integration test for workflow integration
  - Test end-to-end memory flow in workflow
  - Test that agents receive memory context
  - Test that new signals are stored correctly
  - _Requirements: 2.1, 5.2, 6.2_

- [x] 11. Add Feature Flag Configuration
  - Add memorySystem configuration to EngineConfig
  - Implement feature flag check in memory retrieval node
  - Add configuration for maxSignalsPerAgent, queryTimeoutMs, retryAttempts
  - Document configuration options
  - _Requirements: All (feature flag controls entire system)_

- [ ]* 11.1 Write unit test for feature flag
  - Test that memory system is disabled when flag is false
  - Test that memory system is enabled when flag is true
  - Test configuration parameters are respected

- [x] 12. Checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 13. Add Monitoring and Logging
  - Add performance metrics for memory retrieval latency
  - Add error rate tracking
  - Add memory context size metrics
  - Add evolution event frequency metrics
  - Implement audit trail logging for all operations
  - _Requirements: 5.4, 8.2, 8.3, 8.4, 8.5, 9.1_

- [ ]* 13.1 Write unit tests for monitoring
  - Test that metrics are collected correctly
  - Test that audit log entries are created
  - _Requirements: 5.4_

- [x] 14. Update Documentation
  - Update README with memory system overview
  - Document configuration options
  - Add examples of memory context usage
  - Document error handling behavior
  - Add troubleshooting guide

- [ ] 15. Final Checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- Each task references specific requirements for traceability
- Checkpoints ensure incremental validation
- Property tests validate universal correctness properties (minimum 100 iterations each)
- Unit tests validate specific examples and edge cases
- Integration tests validate end-to-end workflows
- Feature flag enables gradual rollout and easy rollback
