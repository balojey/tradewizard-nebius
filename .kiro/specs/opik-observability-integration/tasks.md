# Implementation Plan: Opik Observability Integration for DOA

## Overview

This implementation plan adds comprehensive Opik observability to the DOA Python project, following the patterns established in tradewizard-agents. The integration provides automatic LLM tracing via OpikCallbackHandler and custom metrics tracking via OpikMonitorIntegration.

## Tasks

- [x] 1. Update environment configuration
  - Add Opik environment variables to .env.example
  - Document each variable with comments
  - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5_

- [ ] 2. Extend configuration module (config.py)
  - [x] 2.1 Create OpikConfig dataclass
    - Define all Opik configuration fields (api_key, project_name, workspace, base_url, track_costs)
    - Implement validate() method with validation rules
    - Implement is_enabled() method to check if tracking is active
    - _Requirements: 2.1, 2.2, 2.3, 2.4_
  
  - [x] 2.2 Integrate OpikConfig into EngineConfig
    - Add opik field to EngineConfig dataclass
    - Update EngineConfig.validate() to validate OpikConfig
    - Update EngineConfig.to_dict() to include Opik configuration
    - _Requirements: 2.5, 2.6_
  
  - [x] 2.3 Update load_config() function
    - Load Opik environment variables
    - Create OpikConfig instance with loaded values
    - Handle missing OPIK_API_KEY gracefully
    - Use default project name "doa-market-analysis" if not provided
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 1.7_
  
  - [ ]* 2.4 Write unit tests for OpikConfig
    - Test validation with valid configuration
    - Test validation with invalid api_key (empty string)
    - Test validation with invalid project_name (empty string)
    - Test validation with invalid base_url (malformed URL)
    - Test is_enabled() returns True when api_key is set
    - Test is_enabled() returns False when api_key is None or empty
    - _Requirements: 2.2, 2.3, 2.4_

- [ ] 3. Create Opik integration module (utils/opik_integration.py)
  - [x] 3.1 Define data models
    - Create AgentCycleMetrics dataclass
    - Create AnalysisCycleMetrics dataclass
    - Create AggregateMetrics dataclass
    - _Requirements: 6.1, 6.2, 6.3, 6.4, 6.5, 6.6, 6.7, 12.1, 12.2, 12.3, 12.4, 12.5, 12.6, 12.7, 12.8_
  
  - [x] 3.2 Implement OpikMonitorIntegration class
    - Implement __init__() to accept EngineConfig
    - Implement create_opik_handler() to create OpikCallbackHandler
    - Implement start_cycle() to initialize cycle tracking
    - Implement record_discovery() to track market discovery
    - Implement record_analysis() to track individual analysis
    - Implement record_update() to track market updates
    - Implement end_cycle() to finalize and store cycle metrics
    - Implement get_current_cycle_metrics() accessor
    - Implement get_cycle_history() accessor
    - Implement get_aggregate_metrics() to calculate aggregate statistics
    - Implement get_trace_url() to generate Opik dashboard URLs
    - Implement log_dashboard_link() to log dashboard URL
    - Implement _update_agent_metrics() private helper
    - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.5, 4.6, 4.7, 5.1, 5.2, 5.3, 5.4, 5.5, 5.6, 5.7, 5.8, 5.9, 6.1, 6.2, 6.3, 6.4, 6.5, 6.6, 6.7, 6.8, 8.1, 8.2, 8.3, 8.4, 8.5, 8.6, 8.7, 12.1, 12.2, 12.3, 12.4, 12.5, 12.6, 12.7, 12.8_
  
  - [x] 3.3 Implement formatting utilities
    - Create format_cycle_metrics() function
    - Create format_aggregate_metrics() function
    - _Requirements: 14.1, 14.2, 14.3, 14.4, 14.5, 14.6_
  
  - [x] 3.4 Implement factory function
    - Create create_opik_monitor_integration() factory function
    - _Requirements: 4.1_
  
  - [ ]* 3.5 Write unit tests for OpikMonitorIntegration
    - Test cycle tracking (start, record, end)
    - Test agent metrics accumulation
    - Test aggregate metrics calculation
    - Test trace URL generation with various configurations
    - Test graceful handling of missing active cycle
    - Test cycle history maintenance (max 100 cycles)
    - _Requirements: 5.1, 5.2, 5.3, 5.4, 5.5, 5.6, 5.7, 5.8, 6.1, 6.2, 6.3, 6.4, 6.5, 6.6, 6.7, 8.1, 8.2, 8.3, 8.4, 8.5, 8.6, 10.5, 12.1, 12.2, 12.3, 12.4, 12.5, 12.6, 12.7, 12.8_
  
  - [ ]* 3.6 Write unit tests for formatting utilities
    - Test format_cycle_metrics() output contains all required fields
    - Test format_aggregate_metrics() output contains all required fields
    - Test formatting with empty agent metrics
    - Test formatting with multiple agents
    - _Requirements: 14.1, 14.2, 14.3, 14.4, 14.5, 14.6_

- [ ] 4. Integrate OpikCallbackHandler into workflow (main.py)
  - [x] 4.1 Update analyze_market() function
    - Import OpikCallbackHandler from opik.integrations.langchain
    - Check if Opik is enabled via config.opik.is_enabled()
    - Create OpikCallbackHandler with project_name and workspace
    - Add error handling for handler creation failures
    - Pass handler in callbacks list to graph.ainvoke()
    - Log Opik status (enabled/disabled)
    - _Requirements: 3.1, 3.2, 3.3, 3.6, 10.1, 11.1_
  
  - [ ]* 4.2 Write integration tests for workflow with Opik
    - Test workflow execution with Opik enabled
    - Test workflow execution with Opik disabled
    - Test graceful degradation when handler creation fails
    - Test that workflow continues when Opik API is unreachable
    - _Requirements: 3.1, 3.2, 3.3, 3.6, 10.1, 10.2, 10.3, 13.2_

- [ ] 5. Add error handling and logging
  - [x] 5.1 Implement graceful degradation in OpikMonitorIntegration
    - Wrap Opik API calls in try-except blocks
    - Log errors without raising exceptions
    - Return fallback values on errors
    - _Requirements: 10.2, 10.5, 10.6_
  
  - [x] 5.2 Add comprehensive logging
    - Log Opik initialization status
    - Log cycle start with cycle_id
    - Log analysis recording with condition_id and trace URL
    - Log cycle end with summary statistics
    - Log errors with stack traces
    - Use appropriate log levels (INFO, WARNING, ERROR)
    - _Requirements: 11.1, 11.2, 11.3, 11.4, 11.5, 11.6, 11.7_
  
  - [ ]* 5.3 Write unit tests for error handling
    - Test OpikCallbackHandler creation failure handling
    - Test Opik API call failure handling
    - Test invalid API key handling
    - Test methods called without active cycle
    - Test trace URL generation failure
    - _Requirements: 10.1, 10.2, 10.4, 10.5, 10.6_

- [x] 6. Checkpoint - Ensure all tests pass
  - Run all unit tests
  - Run all integration tests
  - Verify no regressions in existing functionality
  - Ask the user if questions arise

- [ ] 7. Write property-based tests
  - [ ]* 7.1 Write property test for configuration validation (Property 1)
    - **Property 1: Configuration Validation Rejects Invalid Inputs**
    - **Validates: Requirements 2.2, 2.3, 2.4**
  
  - [ ]* 7.2 Write property test for unique cycle IDs (Property 2)
    - **Property 2: Unique Cycle ID Generation**
    - **Validates: Requirements 5.2**
  
  - [ ]* 7.3 Write property test for metric accumulation (Property 3)
    - **Property 3: Metric Accumulation Correctness**
    - **Validates: Requirements 5.3, 5.4, 5.5, 5.6, 5.7, 7.6**
  
  - [ ]* 7.4 Write property test for agent metrics tracking (Property 4)
    - **Property 4: Agent Metrics Tracking Completeness**
    - **Validates: Requirements 6.2, 6.3, 6.4**
  
  - [ ]* 7.5 Write property test for average calculations (Property 5)
    - **Property 5: Average Calculation Correctness**
    - **Validates: Requirements 6.5, 6.6, 6.7**
  
  - [ ]* 7.6 Write property test for cost calculations (Property 6)
    - **Property 6: Cost Calculation Formula**
    - **Validates: Requirements 7.1, 7.2, 7.3**
  
  - [ ]* 7.7 Write property test for aggregate summation (Property 7)
    - **Property 7: Aggregate Metrics Summation**
    - **Validates: Requirements 12.2, 12.3, 12.4**
  
  - [ ]* 7.8 Write property test for aggregate averages (Property 8)
    - **Property 8: Aggregate Average Calculations**
    - **Validates: Requirements 12.5, 12.6, 12.7**
  
  - [ ]* 7.9 Write property test for agent ranking (Property 9)
    - **Property 9: Top Agents Ranking**
    - **Validates: Requirements 12.8**
  
  - [ ]* 7.10 Write property test for trace URL structure (Property 10)
    - **Property 10: Trace URL Structure**
    - **Validates: Requirements 8.1, 8.2, 8.3, 8.4**
  
  - [ ]* 7.11 Write property test for formatted output (Property 11)
    - **Property 11: Formatted Output Completeness**
    - **Validates: Requirements 14.2, 14.4, 14.5, 14.6**

- [ ] 8. Test compatibility with checkpointers
  - [ ]* 8.1 Test with MemorySaver checkpointer
    - Verify Opik integration works with in-memory checkpointing
    - _Requirements: 13.4_
  
  - [ ]* 8.2 Test with SQLite checkpointer
    - Verify Opik integration works with SQLite checkpointing
    - _Requirements: 13.5_
  
  - [ ]* 8.3 Test with PostgreSQL checkpointer
    - Verify Opik integration works with PostgreSQL checkpointing
    - _Requirements: 13.6_

- [ ] 9. Test independence of Opik and database persistence
  - [ ]* 9.1 Test workflow with both Opik and persistence enabled
    - Verify both systems work independently
    - _Requirements: 13.7_
  
  - [ ]* 9.2 Test workflow with Opik enabled and persistence disabled
    - Verify Opik works without persistence
    - _Requirements: 13.7_
  
  - [ ]* 9.3 Test workflow with Opik disabled and persistence enabled
    - Verify persistence works without Opik
    - _Requirements: 13.7_

- [ ] 10. Update Gradient ADK entrypoint
  - [x] 10.1 Ensure main() entrypoint includes Opik tracking
    - Verify OpikCallbackHandler is used when calling analyze_market()
    - _Requirements: 13.3_
  
  - [ ]* 10.2 Write integration test for ADK entrypoint
    - Test entrypoint with Opik enabled
    - Test entrypoint with Opik disabled
    - _Requirements: 13.3_

- [x] 11. Final checkpoint - Ensure all tests pass
  - Run all unit tests
  - Run all property-based tests
  - Run all integration tests
  - Verify test coverage is adequate
  - Ask the user if questions arise

- [x] 12. Documentation and cleanup
  - Add docstrings to all new functions and classes
  - Update README with Opik configuration instructions
  - Add inline comments for complex logic
  - Verify code follows Python style guidelines (PEP 8)

## Notes

- Tasks marked with `*` are optional test-related sub-tasks and can be skipped for faster MVP
- Each task references specific requirements for traceability
- Property tests validate universal correctness properties with minimum 100 iterations
- Integration tests ensure Opik works seamlessly with existing DOA components
- Graceful degradation ensures observability failures don't break core functionality
