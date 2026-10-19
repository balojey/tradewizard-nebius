# Implementation Plan: NewsData Multi-Key Rotation

## Overview

This implementation adds intelligent API key rotation to both Python (doa) and Node.js (tradewizard-agents) NewsData.io clients. The system automatically detects rate limits (HTTP 429), rotates to the next available API key, and gracefully degrades when all keys are exhausted. The implementation maintains full backward compatibility with single-key configurations while enabling higher throughput for production deployments.

## Tasks

- [x] 1. Python: Implement configuration parsing and key state initialization
  - Modify `NewsDataClient.__init__` to parse comma-separated API keys
  - Implement whitespace trimming and validation
  - Create `KeyState` dataclass with all required fields
  - Initialize `key_states` dictionary for all configured keys
  - Add `current_key_index` tracking
  - Raise `ValueError` if no valid keys provided
  - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 7.1, 7.4_

- [ ]* 1.1 Python: Write property test for configuration parsing
  - **Property 1: Configuration Parsing and Validation**
  - **Validates: Requirements 1.1, 1.2, 1.3, 1.5**
  - Generate random lists of API keys with varying whitespace
  - Verify parsing produces correct trimmed list
  - Test invalid inputs (empty, all whitespace) raise errors
  - _Requirements: 1.1, 1.2, 1.3, 1.5, 10.1_

- [ ]* 1.2 Python: Write unit tests for configuration parsing
  - Test single key configuration (backward compatibility)
  - Test multiple keys with various whitespace patterns
  - Test empty string raises ValueError
  - Test all whitespace raises ValueError
  - Test keys with special characters
  - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 10.1, 10.7_

- [x] 2. Python: Implement rate limit detection logic
  - Create `_is_rate_limit_error` method to check HTTP 429 responses
  - Parse response body to distinguish rate limit from quota exceeded
  - Create `_extract_retry_after` method to parse Retry-After header
  - Default to 900 seconds (15 minutes) if header missing
  - Handle both integer and HTTP date formats in Retry-After
  - _Requirements: 2.1, 2.2, 2.3, 2.5, 7.2_

- [ ]* 2.1 Python: Write property test for Retry-After extraction
  - **Property 2: Retry-After Header Extraction**
  - **Validates: Requirements 2.3**
  - Generate random integer values for Retry-After header
  - Verify extracted value matches header value
  - Test missing header defaults to 900 seconds
  - _Requirements: 2.3, 10.2_

- [ ]* 2.2 Python: Write unit tests for rate limit detection
  - Test HTTP 429 with Retry-After header
  - Test HTTP 429 without Retry-After header (default to 900s)
  - Test HTTP 429 with rate limit message in body
  - Test HTTP 429 with quota exceeded message in body
  - Test non-429 errors do not trigger rotation
  - _Requirements: 2.1, 2.2, 2.3, 2.5, 10.2_

- [x] 3. Python: Implement key rotation engine
  - Create `_rotate_api_key` method with retry_after_seconds parameter
  - Mark current key as rate-limited with expiry timestamp
  - Create `_get_available_keys` method with auto-expiry logic
  - Implement LRU selection (sort by last_used timestamp)
  - Update `current_key_index` to new key
  - Return None if all keys exhausted
  - Create `_get_key_id` helper method (first 8 characters)
  - _Requirements: 3.1, 3.2, 3.3, 3.4, 4.3, 4.4, 7.3_

- [ ]* 3.1 Python: Write property tests for key rotation
  - **Property 3: Rate Limit State Transition**
  - **Property 4: Available Key Selection**
  - **Property 8: LRU Key Selection**
  - **Validates: Requirements 3.1, 3.2, 3.3, 4.4**
  - Generate random API keys and retry-after durations
  - Verify state transitions to rate-limited with correct expiry
  - Generate key lists with mixed rate-limit states
  - Verify selected key is always available and LRU
  - _Requirements: 3.1, 3.2, 3.3, 4.4, 10.3, 10.4_

- [ ]* 3.2 Python: Write unit tests for key rotation
  - Test rotation with 2 keys
  - Test rotation with 5 keys
  - Test rotation when all keys exhausted returns None
  - Test rotation with expired keys (auto-recovery)
  - Test multiple consecutive rotations
  - Test LRU selection with various usage patterns
  - _Requirements: 3.1, 3.2, 3.3, 3.4, 4.3, 4.4, 10.3_

- [x] 4. Python: Implement key state management
  - Update `_get_available_keys` to check expiry timestamps
  - Auto-expire rate-limited keys when expiry time passed
  - Update `total_requests` counter on each request
  - Update `last_used` timestamp on each request
  - Maintain state in memory (no disk persistence)
  - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.5, 7.4_

- [ ]* 4.1 Python: Write property tests for key state management
  - **Property 5: Retry-After Expiry Timing**
  - **Property 7: Key State Completeness**
  - **Validates: Requirements 3.4, 4.1, 4.2, 4.3**
  - Generate random expiry durations
  - Verify keys remain unavailable for exact duration
  - Verify keys become available after expiry
  - Verify all state fields present for each key
  - _Requirements: 4.1, 4.2, 4.3, 10.4_

- [ ]* 4.2 Python: Write unit tests for key state management
  - Test initial state after configuration
  - Test state updates after requests
  - Test state updates after rate limits
  - Test state expiry and auto-recovery
  - Test state completeness (all required fields)
  - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.5, 10.4_

- [x] 5. Python: Integrate rotation into request handler
  - Modify `_make_request` method to use current API key
  - Update key usage statistics before each request
  - Detect rate limit responses using `_is_rate_limit_error`
  - Extract retry-after value using `_extract_retry_after`
  - Call `_rotate_api_key` on rate limit detection
  - Retry request immediately with new key (don't count as retry)
  - Return empty result set if rotation returns None
  - Maintain existing error handling for non-rate-limit errors
  - _Requirements: 3.6, 5.1, 7.2, 7.5_

- [ ]* 5.1 Python: Write property test for request retry
  - **Property 6: Request Retry After Rotation**
  - **Validates: Requirements 3.6**
  - Generate random request parameters
  - Simulate rate limit on first attempt
  - Verify retry occurs with new key without counting as retry
  - _Requirements: 3.6, 10.6_

- [ ]* 5.2 Python: Write unit tests for request handler integration
  - Mock httpx to return 429 response
  - Verify rotation triggered on rate limit
  - Verify request retried with new key
  - Verify empty results returned when all keys exhausted
  - Verify existing error handling preserved
  - _Requirements: 3.6, 5.1, 7.2, 7.5, 10.6_

- [x] 6. Python: Implement graceful degradation
  - Return empty result set when `_rotate_api_key` returns None
  - Calculate earliest expiry time across all keys
  - Log ERROR level message with earliest expiry time
  - Log WARNING level message about returning empty results
  - Ensure workflow continues without throwing exceptions
  - _Requirements: 5.1, 5.2, 5.3, 5.4, 5.5_

- [ ]* 6.1 Python: Write property tests for graceful degradation
  - **Property 9: Graceful Degradation on Exhaustion**
  - **Property 10: Workflow Continuation**
  - **Validates: Requirements 5.1, 5.4, 5.5**
  - Generate configurations where all keys are exhausted
  - Verify empty result set returned
  - Verify no exceptions thrown
  - _Requirements: 5.1, 5.4, 5.5, 10.5_

- [ ]* 6.2 Python: Write unit tests for graceful degradation
  - Test all keys exhausted returns empty results
  - Test workflow continues with empty results
  - Test monitor service continues running
  - Test earliest expiry time calculated correctly
  - _Requirements: 5.1, 5.2, 5.3, 5.4, 5.5, 10.5_

- [x] 7. Python: Implement logging and observability
  - Log WARNING when rate limit detected (include key ID and timestamp)
  - Log INFO when key rotation occurs (include old/new key IDs)
  - Log ERROR when all keys exhausted (include earliest expiry)
  - Log INFO when rate-limited key becomes available
  - Include request context in all rotation logs (endpoint, agent, params)
  - Integrate with existing audit logger for metrics
  - Only log rotation events when multiple keys configured
  - _Requirements: 2.4, 3.7, 9.1, 9.2, 9.3, 9.4, 9.5, 9.6_

- [ ]* 7.1 Python: Write property tests for logging
  - **Property 12: Rotation Event Logging**
  - **Property 13: Rate Limit Detection Logging**
  - **Property 14: Key Availability Logging**
  - **Property 15: Context-Rich Logging**
  - **Validates: Requirements 2.4, 3.7, 9.1, 9.2, 9.4, 9.5**
  - Generate random rotation scenarios
  - Verify all required log fields present
  - Verify correct log levels used
  - _Requirements: 2.4, 3.7, 9.1, 9.2, 9.4, 9.5, 10.9_

- [ ]* 7.2 Python: Write unit tests for logging
  - Test rate limit detection logs WARNING with key ID
  - Test key rotation logs INFO with old/new IDs
  - Test all keys exhausted logs ERROR with expiry time
  - Test key availability logs INFO message
  - Test request context included in logs
  - Test no rotation logs with single key
  - _Requirements: 2.4, 3.7, 9.1, 9.2, 9.3, 9.4, 9.5_

- [x] 8. Checkpoint - Python implementation complete
  - Ensure all Python tests pass
  - Verify backward compatibility with single key
  - Verify type hints on all new methods
  - Verify PEP 8 compliance
  - Ask the user if questions arise

- [x] 9. Node.js: Implement configuration parsing and key state initialization
  - Modify `NewsDataClient` constructor to parse comma-separated API keys
  - Implement whitespace trimming and validation
  - Create `KeyState` interface with all required fields
  - Initialize `keyStates` Map for all configured keys
  - Add `currentKeyIndex` tracking
  - Throw Error if no valid keys provided
  - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 8.1, 8.4_

- [ ]* 9.1 Node.js: Write property test for configuration parsing
  - **Property 1: Configuration Parsing and Validation**
  - **Validates: Requirements 1.1, 1.2, 1.3, 1.5**
  - Generate random lists of API keys with varying whitespace
  - Verify parsing produces correct trimmed list
  - Test invalid inputs (empty, all whitespace) throw errors
  - _Requirements: 1.1, 1.2, 1.3, 1.5, 10.1_

- [ ]* 9.2 Node.js: Write unit tests for configuration parsing
  - Test single key configuration (backward compatibility)
  - Test multiple keys with various whitespace patterns
  - Test empty string throws Error
  - Test all whitespace throws Error
  - Test keys with special characters
  - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 10.1, 10.7_

- [x] 10. Node.js: Implement rate limit detection logic
  - Create `isRateLimitError` private method to check HTTP 429 responses
  - Parse response body to distinguish rate limit from quota exceeded
  - Create `extractRetryAfter` private method to parse Retry-After header
  - Default to 900 seconds (15 minutes) if header missing
  - Handle both integer and HTTP date formats in Retry-After
  - _Requirements: 2.1, 2.2, 2.3, 2.5, 8.2_

- [ ]* 10.1 Node.js: Write property test for Retry-After extraction
  - **Property 2: Retry-After Header Extraction**
  - **Validates: Requirements 2.3**
  - Generate random integer values for Retry-After header
  - Verify extracted value matches header value
  - Test missing header defaults to 900 seconds
  - _Requirements: 2.3, 10.2_

- [ ]* 10.2 Node.js: Write unit tests for rate limit detection
  - Test HTTP 429 with Retry-After header
  - Test HTTP 429 without Retry-After header (default to 900s)
  - Test HTTP 429 with rate limit message in body
  - Test HTTP 429 with quota exceeded message in body
  - Test non-429 errors do not trigger rotation
  - _Requirements: 2.1, 2.2, 2.3, 2.5, 10.2_

- [x] 11. Node.js: Implement key rotation engine
  - Create `rotateApiKey` private method with retryAfterSeconds parameter
  - Mark current key as rate-limited with expiry timestamp
  - Create `getAvailableKeys` private method with auto-expiry logic
  - Implement LRU selection (sort by lastUsed timestamp)
  - Update `currentKeyIndex` to new key
  - Return null if all keys exhausted
  - Create `getKeyId` private helper method (first 8 characters)
  - _Requirements: 3.1, 3.2, 3.3, 3.4, 4.3, 4.4, 8.3_

- [ ]* 11.1 Node.js: Write property tests for key rotation
  - **Property 3: Rate Limit State Transition**
  - **Property 4: Available Key Selection**
  - **Property 8: LRU Key Selection**
  - **Validates: Requirements 3.1, 3.2, 3.3, 4.4**
  - Generate random API keys and retry-after durations
  - Verify state transitions to rate-limited with correct expiry
  - Generate key lists with mixed rate-limit states
  - Verify selected key is always available and LRU
  - _Requirements: 3.1, 3.2, 3.3, 4.4, 10.3, 10.4_

- [ ]* 11.2 Node.js: Write unit tests for key rotation
  - Test rotation with 2 keys
  - Test rotation with 5 keys
  - Test rotation when all keys exhausted returns null
  - Test rotation with expired keys (auto-recovery)
  - Test multiple consecutive rotations
  - Test LRU selection with various usage patterns
  - _Requirements: 3.1, 3.2, 3.3, 3.4, 4.3, 4.4, 10.3_

- [x] 12. Node.js: Implement key state management
  - Update `getAvailableKeys` to check expiry timestamps
  - Auto-expire rate-limited keys when expiry time passed
  - Update `totalRequests` counter on each request
  - Update `lastUsed` timestamp on each request
  - Maintain state in memory (no disk persistence)
  - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.5, 8.4_

- [ ]* 12.1 Node.js: Write property tests for key state management
  - **Property 5: Retry-After Expiry Timing**
  - **Property 7: Key State Completeness**
  - **Validates: Requirements 3.4, 4.1, 4.2, 4.3**
  - Generate random expiry durations
  - Verify keys remain unavailable for exact duration
  - Verify keys become available after expiry
  - Verify all state fields present for each key
  - _Requirements: 4.1, 4.2, 4.3, 10.4_

- [ ]* 12.2 Node.js: Write unit tests for key state management
  - Test initial state after configuration
  - Test state updates after requests
  - Test state updates after rate limits
  - Test state expiry and auto-recovery
  - Test state completeness (all required fields)
  - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.5, 10.4_

- [x] 13. Node.js: Integrate rotation into request handler
  - Modify `makeDirectRequest` method to use current API key
  - Create `updateUrlApiKey` helper to inject key into URL
  - Update key usage statistics before each request
  - Detect rate limit responses using `isRateLimitError`
  - Extract retry-after value using `extractRetryAfter`
  - Call `rotateApiKey` on rate limit detection
  - Retry request immediately with new key (don't count as retry)
  - Return empty result set if rotation returns null
  - Maintain existing error handling for non-rate-limit errors
  - _Requirements: 3.6, 5.1, 8.2, 8.5_

- [ ]* 13.1 Node.js: Write property test for request retry
  - **Property 6: Request Retry After Rotation**
  - **Validates: Requirements 3.6**
  - Generate random request parameters
  - Simulate rate limit on first attempt
  - Verify retry occurs with new key without counting as retry
  - _Requirements: 3.6, 10.6_

- [ ]* 13.2 Node.js: Write unit tests for request handler integration
  - Mock fetch to return 429 response
  - Verify rotation triggered on rate limit
  - Verify request retried with new key
  - Verify empty results returned when all keys exhausted
  - Verify existing error handling preserved
  - _Requirements: 3.6, 5.1, 8.2, 8.5, 10.6_

- [x] 14. Node.js: Implement graceful degradation
  - Return empty result set when `rotateApiKey` returns null
  - Calculate earliest expiry time across all keys
  - Log error message with earliest expiry time
  - Log warning message about returning empty results
  - Ensure workflow continues without throwing exceptions
  - _Requirements: 5.1, 5.2, 5.3, 5.4, 5.5_

- [ ]* 14.1 Node.js: Write property tests for graceful degradation
  - **Property 9: Graceful Degradation on Exhaustion**
  - **Property 10: Workflow Continuation**
  - **Validates: Requirements 5.1, 5.4, 5.5**
  - Generate configurations where all keys are exhausted
  - Verify empty result set returned
  - Verify no exceptions thrown
  - _Requirements: 5.1, 5.4, 5.5, 10.5_

- [ ]* 14.2 Node.js: Write unit tests for graceful degradation
  - Test all keys exhausted returns empty results
  - Test workflow continues with empty results
  - Test monitor service continues running
  - Test earliest expiry time calculated correctly
  - _Requirements: 5.1, 5.2, 5.3, 5.4, 5.5, 10.5_

- [x] 15. Node.js: Implement logging and observability
  - Log warning when rate limit detected (include key ID and timestamp)
  - Log info when key rotation occurs (include old/new key IDs)
  - Log error when all keys exhausted (include earliest expiry)
  - Log info when rate-limited key becomes available
  - Include request context in all rotation logs (endpoint, agent, params)
  - Integrate with existing audit logger for metrics
  - Only log rotation events when multiple keys configured
  - _Requirements: 2.4, 3.7, 9.1, 9.2, 9.3, 9.4, 9.5, 9.6_

- [ ]* 15.1 Node.js: Write property tests for logging
  - **Property 12: Rotation Event Logging**
  - **Property 13: Rate Limit Detection Logging**
  - **Property 14: Key Availability Logging**
  - **Property 15: Context-Rich Logging**
  - **Validates: Requirements 2.4, 3.7, 9.1, 9.2, 9.4, 9.5**
  - Generate random rotation scenarios
  - Verify all required log fields present
  - Verify correct log levels used
  - _Requirements: 2.4, 3.7, 9.1, 9.2, 9.4, 9.5, 10.9_

- [ ]* 15.2 Node.js: Write unit tests for logging
  - Test rate limit detection logs warning with key ID
  - Test key rotation logs info with old/new IDs
  - Test all keys exhausted logs error with expiry time
  - Test key availability logs info message
  - Test request context included in logs
  - Test no rotation logs with single key
  - _Requirements: 2.4, 3.7, 9.1, 9.2, 9.3, 9.4, 9.5_

- [x] 16. Checkpoint - Node.js implementation complete
  - Ensure all Node.js tests pass
  - Verify backward compatibility with single key
  - Verify TypeScript types on all new methods
  - Verify code style compliance
  - Ask the user if questions arise

- [ ]* 17. Integration testing across both implementations
  - Test Python implementation with real NewsData API (rate limit simulation)
  - Test Node.js implementation with real NewsData API (rate limit simulation)
  - Verify both implementations behave identically
  - Test monitor service continues with key exhaustion
  - Test multi-agent workflow with key rotation
  - _Requirements: 5.4, 5.5, 10.6_

- [ ]* 18. Backward compatibility validation
  - **Property 11: Backward Compatibility**
  - **Validates: Requirements 7.5, 8.5**
  - Test Python single-key configuration works identically
  - Test Node.js single-key configuration works identically
  - Verify all method signatures unchanged
  - Verify all return types unchanged
  - _Requirements: 6.1, 6.2, 6.3, 6.4, 7.5, 8.5, 10.7_

- [x] 19. Documentation updates
  - Update Python README with multi-key configuration instructions
  - Update Node.js README with multi-key configuration instructions
  - Add environment variable examples to .env.example files
  - Document graceful degradation behavior
  - Add troubleshooting section for rate limit issues
  - _Requirements: 1.1, 5.1, 9.1, 9.2, 9.3_

- [x] 20. Final checkpoint - Feature complete
  - Ensure all tests pass in both implementations
  - Verify observability integration working
  - Verify backward compatibility maintained
  - Run full workflow end-to-end test
  - Ask the user if questions arise

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- Each task references specific requirements for traceability
- Property tests validate universal correctness properties from the design document
- Unit tests validate specific examples and edge cases
- Python implementation in `doa/tools/newsdata_client.py`
- Node.js implementation in `tradewizard-agents/src/utils/newsdata-client.ts`
- Both implementations must maintain backward compatibility with single-key configurations
- Graceful degradation ensures workflows continue even when all keys are exhausted
