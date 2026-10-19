# Implementation Plan: DOA Workflow Routing

## Overview

This implementation plan breaks down the DOA workflow routing feature into discrete coding tasks. The approach is to build incrementally: first add configuration, then implement the HTTP client, then integrate routing logic, and finally add tests.

## Tasks

- [x] 1. Add workflow service configuration schema
  - Extend EngineConfigSchema in `src/config/index.ts` with `workflowService` section
  - Add Zod schema for `url` (optional string), `timeoutMs` (number, default 120000), and `headers` (optional record)
  - Add environment variable loading for WORKFLOW_SERVICE_URL and WORKFLOW_SERVICE_TIMEOUT_MS
  - Add URL validation to ensure only HTTP/HTTPS URLs are accepted
  - Update `loadConfig()` function to load workflow service configuration
  - _Requirements: 1.1, 1.4, 1.5, 8.1, 8.2, 8.3, 8.4, 8.5_

- [ ]* 1.1 Write unit tests for configuration loading
  - Test that WORKFLOW_SERVICE_URL is loaded correctly
  - Test that WORKFLOW_SERVICE_TIMEOUT_MS is loaded with default
  - Test that invalid URLs are rejected
  - Test that configuration works without workflow service settings
  - _Requirements: 1.5, 8.4_

- [x] 2. Implement workflow service HTTP client
  - [x] 2.1 Create `src/utils/workflow-service-client.ts` file
    - Define WorkflowServiceConfig, WorkflowServiceRequest, and WorkflowServiceResponse interfaces
    - Implement WorkflowServiceClient class with analyzeMarket method
    - Implement HTTP POST request with fetch API
    - Add timeout handling using AbortController
    - Add Bearer token authentication from DIGITALOCEAN_API_TOKEN
    - Add request/response logging
    - _Requirements: 2.1, 2.2, 2.3, 2.7, 2.8, 2.9, 6.1, 6.3, 9.3_

  - [x] 2.2 Implement response validation
    - Add validateResponse private method to check response structure
    - Validate recommendation field (object or null)
    - Validate agentSignals field (array)
    - Validate cost field (optional number)
    - Throw descriptive errors for invalid responses
    - _Requirements: 7.1, 7.2, 7.3, 7.4, 7.5_

  - [x] 2.3 Implement error handling
    - Handle non-2xx status codes with descriptive errors
    - Handle 401/403 with authentication error message
    - Handle timeout errors with AbortController
    - Handle network errors (ECONNREFUSED, etc.)
    - Ensure token is never logged in error messages
    - Log all errors with appropriate details
    - _Requirements: 2.6, 5.1, 5.2, 5.3, 5.4, 6.2, 6.4_

  - [x] 2.4 Implement createWorkflowServiceClient factory function
    - Return null if no workflow URL is configured
    - Read DIGITALOCEAN_API_TOKEN from environment
    - Log warning if token is not set
    - Create and return WorkflowServiceClient instance
    - _Requirements: 6.1, 6.2_

- [ ]* 2.5 Write unit tests for workflow service client
  - Test successful request/response flow
  - Test timeout handling
  - Test authentication header formatting
  - Test error response handling for various status codes
  - Test response validation with invalid responses
  - Test that token is not logged in errors
  - _Requirements: 2.1, 2.2, 2.3, 2.6, 2.7, 6.3, 6.4, 7.4_

- [ ]* 2.6 Write property test for request structure
  - **Property 2: Request Structure Consistency**
  - **Validates: Requirements 2.1, 2.2, 2.3, 2.9**

- [ ]* 2.7 Write property test for response validation
  - **Property 3: Response Validation**
  - **Validates: Requirements 7.1, 7.2, 7.3, 7.4, 7.5**

- [ ]* 2.8 Write property test for error handling
  - **Property 6: Error Response Handling**
  - **Validates: Requirements 2.6, 5.2**

- [ ]* 2.9 Write property test for token security
  - **Property 10: Token Security**
  - **Validates: Requirements 6.4**

- [x] 3. Implement workflow routing logic
  - [x] 3.1 Refactor analyzeMarket function in `src/workflow.ts`
    - Add check for config.workflowService?.url at start of function
    - Log "Using workflow service at {url}" when URL is configured
    - Log "Using local workflow execution" when URL is not configured
    - Call executeRemoteWorkflow when URL is configured
    - Call executeLocalWorkflow when URL is not configured
    - _Requirements: 1.2, 1.3, 9.1, 9.2_

  - [x] 3.2 Implement executeRemoteWorkflow function
    - Create WorkflowServiceClient using factory function
    - Call client.analyzeMarket with condition ID
    - Return AnalysisResult
    - Propagate errors without fallback
    - _Requirements: 5.5, 5.6_

  - [x] 3.3 Extract existing workflow logic into executeLocalWorkflow function
    - Move existing analyzeMarket implementation into executeLocalWorkflow
    - Keep all existing functionality unchanged
    - Ensure function signature matches requirements
    - _Requirements: 10.2, 10.4_

- [ ]* 3.4 Write unit tests for workflow routing
  - Test that routing uses remote when URL is configured
  - Test that routing uses local when URL is not configured
  - Test that errors are propagated without fallback
  - Test logging messages for both modes
  - _Requirements: 1.2, 1.3, 5.5, 9.1, 9.2_

- [ ]* 3.5 Write property test for routing logic
  - **Property 4: Routing Based on Configuration**
  - **Validates: Requirements 1.3, 3.1, 4.1**

- [ ]* 3.6 Write property test for no automatic fallback
  - **Property 8: No Automatic Fallback**
  - **Validates: Requirements 5.5, 5.6**

- [ ]* 3.7 Write property test for backward compatibility
  - **Property 15: Backward Compatibility**
  - **Validates: Requirements 10.2, 10.4**

- [x] 4. Checkpoint - Ensure all tests pass
  - Run all unit tests and property tests
  - Verify configuration loading works correctly
  - Verify workflow routing works for both local and remote modes
  - Ensure all tests pass, ask the user if questions arise.

- [x] 5. Update monitor service for workflow service integration
  - [x] 5.1 Add workflow service health tracking to monitor service
    - Add workflowServiceStatus field to health status
    - Track last successful request timestamp
    - Track consecutive failure count
    - Update health status calculation to include workflow service status
    - _Requirements: 4.4, 4.5, 9.6_

  - [x] 5.2 Update analyzeMarket error handling in monitor service
    - Ensure errors are logged but don't stop monitoring
    - Update health metrics on failures
    - Continue processing other markets after failures
    - _Requirements: 4.3_

  - [x] 5.3 Update health check endpoint to include workflow service status
    - Add workflowService section to health check response
    - Include enabled flag, URL, lastSuccess timestamp, and consecutiveFailures count
    - _Requirements: 4.5, 9.6_

- [ ]* 5.4 Write unit tests for monitor service integration
  - Test that monitor continues after workflow service failures
  - Test that health metrics are updated on failures
  - Test that health check includes workflow service status
  - _Requirements: 4.3, 4.4, 4.5_

- [ ]* 5.5 Write property test for monitor error resilience
  - **Property 12: Monitor Error Resilience**
  - **Validates: Requirements 4.3**

- [ ]* 5.6 Write property test for health metrics tracking
  - **Property 13: Health Metrics Tracking**
  - **Validates: Requirements 4.4, 4.5, 9.6**

- [x] 6. Verify CLI integration
  - [x] 6.1 Test CLI with workflow service URL configured
    - Verify CLI uses workflow service when URL is set
    - Verify CLI displays recommendations correctly
    - Verify CLI shows error messages when service fails
    - Verify CLI logs execution mode
    - _Requirements: 3.1, 3.3, 3.4, 3.5_

  - [x] 6.2 Test CLI without workflow service URL
    - Verify CLI uses local execution when URL is not set
    - Verify CLI behavior is identical to pre-DOA implementation
    - _Requirements: 3.2, 10.1_

- [ ]* 6.3 Write property test for CLI output consistency
  - **Property 14: Output Consistency**
  - **Validates: Requirements 3.3**

- [ ] 7. Integration testing
  - [x] 7.1 Create integration test for end-to-end workflow service flow
    - Set up mock workflow service endpoint
    - Configure system to use mock endpoint
    - Execute analysis and verify complete flow
    - Test both success and failure scenarios
    - _Requirements: 1.3, 2.1, 2.2, 2.3, 2.4, 2.5_

  - [x] 7.2 Create integration test for local execution
    - Configure system without workflow URL
    - Execute analysis and verify local execution
    - Verify behavior matches pre-DOA implementation
    - _Requirements: 1.2, 10.1, 10.2, 10.4_

- [ ] 8. Documentation and deployment preparation
  - [x] 8.1 Update README or deployment docs with workflow service configuration
    - Document WORKFLOW_SERVICE_URL environment variable
    - Document DIGITALOCEAN_API_TOKEN environment variable
    - Document WORKFLOW_SERVICE_TIMEOUT_MS environment variable
    - Provide example configuration
    - Document migration path from local to remote execution
    - Document rollback strategy

  - [x] 8.2 Add logging documentation
    - Document log messages for workflow service usage
    - Document error message formats
    - Document health check response format

- [x] 9. Final checkpoint - Ensure all tests pass
  - Run complete test suite (unit + property + integration)
  - Verify all requirements are covered by tests
  - Verify backward compatibility with local execution
  - Test with actual workflow service URL (if available)
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- Each task references specific requirements for traceability
- Property tests validate universal correctness properties
- Unit tests validate specific examples and edge cases
- Integration tests verify end-to-end functionality
- The CLI and monitor service require minimal changes since routing is handled in the workflow layer
