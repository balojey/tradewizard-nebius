# Requirements Document

## Introduction

This feature adds support for multiple NewsData.io API keys with automatic failover when rate limits are detected. The system will rotate through available API keys to maximize throughput and prevent workflow interruptions when individual keys hit rate limits. This applies to both the Python (doa) and Node.js (tradewizard-agents) implementations.

## Glossary

- **NewsData_Client**: The HTTP client responsible for making requests to NewsData.io API (Python: `NewsDataClient` class, Node.js: `NewsDataClient` class)
- **API_Key**: Authentication credential for NewsData.io API access
- **Rate_Limit**: The maximum number of API requests allowed within a time window (typically 1800 requests per 15 minutes for paid plans)
- **Key_Rotation**: The process of switching from one API key to another when the current key encounters a rate limit
- **Monitor_Service**: The continuous background service that analyzes markets at regular intervals (Python: `main.py monitor`, Node.js: `monitor.ts`)
- **Workflow**: The multi-agent analysis pipeline that processes market data
- **Graceful_Degradation**: The ability to continue operation with reduced functionality when all API keys are exhausted

## Requirements

### Requirement 1: Multi-Key Configuration

**User Story:** As a system administrator, I want to configure multiple NewsData.io API keys, so that I can increase my effective rate limit and ensure continuous operation.

#### Acceptance Criteria

1. THE Configuration_System SHALL accept multiple API keys in the NEWSDATA_API_KEY environment variable separated by commas
2. THE Configuration_System SHALL trim whitespace from each API key during parsing
3. THE Configuration_System SHALL validate that each API key is non-empty after trimming
4. THE Configuration_System SHALL support single API key configuration for backward compatibility
5. WHEN no API keys are provided, THE Configuration_System SHALL raise a configuration error

### Requirement 2: Rate Limit Detection

**User Story:** As a developer, I want the system to automatically detect rate limit errors, so that it can trigger key rotation without manual intervention.

#### Acceptance Criteria

1. WHEN the NewsData API returns HTTP status code 429, THE NewsData_Client SHALL identify it as a rate limit error
2. WHEN the NewsData API response contains error code indicating rate limit, THE NewsData_Client SHALL identify it as a rate limit error
3. THE NewsData_Client SHALL extract the Retry-After header value when present in rate limit responses
4. THE NewsData_Client SHALL log rate limit detection events with timestamp and affected API key identifier
5. THE NewsData_Client SHALL distinguish between rate limit errors and other HTTP 429 errors (quota exceeded)

### Requirement 3: Automatic Key Rotation

**User Story:** As a system operator, I want the system to automatically rotate to the next available API key when rate limits are detected, so that the workflow continues without interruption.

#### Acceptance Criteria

1. WHEN a rate limit error is detected, THE NewsData_Client SHALL mark the current API key as rate-limited with a timestamp
2. WHEN a rate limit error is detected, THE NewsData_Client SHALL select the next available non-rate-limited API key from the configured list
3. WHEN selecting the next key, THE NewsData_Client SHALL skip keys that are currently marked as rate-limited
4. WHEN a Retry-After value is provided, THE NewsData_Client SHALL mark the key as unavailable until the specified time has elapsed
5. WHEN no Retry-After value is provided, THE NewsData_Client SHALL mark the key as unavailable for 15 minutes (default rate limit window)
6. THE NewsData_Client SHALL retry the failed request with the new API key immediately after rotation
7. THE NewsData_Client SHALL log each key rotation event with old key identifier, new key identifier, and reason

### Requirement 4: Key State Management

**User Story:** As a developer, I want the system to track the state of each API key, so that it can make intelligent rotation decisions.

#### Acceptance Criteria

1. THE NewsData_Client SHALL maintain a state record for each configured API key
2. THE Key_State SHALL include: key identifier (first 8 characters), rate limit status (available/rate-limited), rate limit expiry timestamp, total requests made, and last used timestamp
3. WHEN a key's rate limit expiry time has passed, THE NewsData_Client SHALL automatically mark the key as available again
4. THE NewsData_Client SHALL select the least recently used available key when multiple keys are available
5. THE NewsData_Client SHALL persist key state in memory only (no disk persistence required)

### Requirement 5: Graceful Degradation

**User Story:** As a system operator, I want the system to handle the case when all API keys are exhausted, so that the workflow degrades gracefully instead of crashing.

#### Acceptance Criteria

1. WHEN all configured API keys are rate-limited, THE NewsData_Client SHALL return an empty result set instead of throwing an error
2. WHEN all keys are exhausted, THE NewsData_Client SHALL log a warning message indicating all keys are rate-limited
3. WHEN all keys are exhausted, THE NewsData_Client SHALL include the earliest key expiry time in the warning message
4. THE Monitor_Service SHALL continue running when all keys are exhausted
5. THE Workflow SHALL continue to completion when all keys are exhausted, using empty news data for affected agents

### Requirement 6: Backward Compatibility

**User Story:** As an existing user, I want my single API key configuration to continue working, so that I don't need to modify my setup immediately.

#### Acceptance Criteria

1. WHEN only one API key is configured, THE NewsData_Client SHALL function identically to the current implementation
2. WHEN a single API key hits rate limit, THE NewsData_Client SHALL apply graceful degradation (return empty results)
3. THE Configuration_System SHALL accept API keys with or without comma separators
4. THE NewsData_Client SHALL not log key rotation events when only one key is configured

### Requirement 7: Python Implementation

**User Story:** As a Python developer, I want the multi-key rotation feature implemented in the doa codebase, so that Python-based workflows benefit from increased rate limits.

#### Acceptance Criteria

1. THE Python NewsData_Client SHALL implement multi-key configuration parsing in the `__init__` method
2. THE Python NewsData_Client SHALL implement rate limit detection in the `_make_request` method
3. THE Python NewsData_Client SHALL implement key rotation logic as a new private method `_rotate_api_key`
4. THE Python NewsData_Client SHALL implement key state management as instance variables
5. THE Python NewsData_Client SHALL maintain the existing method signatures for backward compatibility
6. THE Python implementation SHALL use type hints for all new methods and variables
7. THE Python implementation SHALL follow PEP 8 style guidelines

### Requirement 8: Node.js Implementation

**User Story:** As a Node.js developer, I want the multi-key rotation feature implemented in the tradewizard-agents codebase, so that Node.js-based workflows benefit from increased rate limits.

#### Acceptance Criteria

1. THE Node.js NewsData_Client SHALL implement multi-key configuration parsing in the constructor
2. THE Node.js NewsData_Client SHALL implement rate limit detection in the `makeDirectRequest` method
3. THE Node.js NewsData_Client SHALL implement key rotation logic as a new private method `rotateApiKey`
4. THE Node.js NewsData_Client SHALL implement key state management as private class properties
5. THE Node.js NewsData_Client SHALL maintain the existing method signatures for backward compatibility
6. THE Node.js implementation SHALL use TypeScript types for all new methods and properties
7. THE Node.js implementation SHALL follow the existing code style and conventions

### Requirement 9: Observability and Logging

**User Story:** As a system operator, I want comprehensive logging of key rotation events, so that I can monitor API key usage and troubleshoot issues.

#### Acceptance Criteria

1. WHEN a rate limit is detected, THE NewsData_Client SHALL log the event at WARNING level with key identifier and timestamp
2. WHEN a key rotation occurs, THE NewsData_Client SHALL log the event at INFO level with old and new key identifiers
3. WHEN all keys are exhausted, THE NewsData_Client SHALL log the event at ERROR level with next available time
4. WHEN a rate-limited key becomes available again, THE NewsData_Client SHALL log the event at INFO level
5. THE NewsData_Client SHALL include request context (endpoint, agent name, parameters) in all rotation-related log messages
6. THE NewsData_Client SHALL integrate with existing observability systems (Opik, audit logger) for key rotation metrics

### Requirement 10: Testing and Validation

**User Story:** As a developer, I want comprehensive tests for the multi-key rotation feature, so that I can ensure it works correctly under various scenarios.

#### Acceptance Criteria

1. THE Test_Suite SHALL include unit tests for multi-key configuration parsing
2. THE Test_Suite SHALL include unit tests for rate limit detection logic
3. THE Test_Suite SHALL include unit tests for key rotation logic
4. THE Test_Suite SHALL include unit tests for key state management
5. THE Test_Suite SHALL include unit tests for graceful degradation when all keys are exhausted
6. THE Test_Suite SHALL include integration tests simulating rate limit scenarios with multiple keys
7. THE Test_Suite SHALL include tests for backward compatibility with single key configuration
8. THE Test_Suite SHALL use mocking to simulate NewsData API rate limit responses
