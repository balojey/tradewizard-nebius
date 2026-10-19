# Requirements Document

## Introduction

This specification addresses the need for human-readable timestamp formatting in the TradeWizard multi-agent system. Currently, timestamps are passed to AI agents in Unix/ISO format, requiring agents to spend computational resources parsing and understanding temporal context. This feature will convert timestamps to natural language format when presented to LLM agents, while maintaining standard formats for programmatic use in the database and state management.

## Glossary

- **Agent**: An AI-powered analysis component that processes market data and generates insights
- **LangGraph_State**: The shared state object passed between nodes in the LangGraph workflow
- **Timestamp_Formatter**: A utility that converts ISO 8601 timestamps to human-readable formats
- **Agent_Context**: The formatted data structure passed to LLM agents in prompts
- **ISO_8601**: Standard timestamp format (e.g., "2024-01-15T15:30:00Z")
- **Relative_Time**: Human-readable time relative to now (e.g., "2 hours ago")
- **Absolute_Time**: Human-readable fixed time (e.g., "January 15, 2024 at 3:30 PM EST")
- **Market_Data**: Data structures containing market information from Polymarket
- **News_Article**: Data structures containing news feed items with publication timestamps
- **Agent_Signal**: Analysis results from individual agents with creation timestamps

## Requirements

### Requirement 1: Timestamp Storage Format

**User Story:** As a system architect, I want timestamps stored in ISO 8601 format, so that the system maintains standard, timezone-aware data persistence.

#### Acceptance Criteria

1. THE LangGraph_State SHALL store all timestamps in ISO 8601 format
2. THE Database SHALL persist all timestamps in ISO 8601 format
3. WHEN timestamps are written to state or database, THE System SHALL validate ISO 8601 format compliance
4. THE System SHALL preserve timezone information in all stored timestamps

### Requirement 2: Human-Readable Timestamp Conversion

**User Story:** As an AI agent, I want timestamps presented in human-readable format, so that I can understand temporal context without parsing overhead.

#### Acceptance Criteria

1. WHEN formatting timestamps for agents, THE Timestamp_Formatter SHALL convert ISO 8601 to natural language
2. THE Timestamp_Formatter SHALL support relative time format for recent events (within 7 days)
3. THE Timestamp_Formatter SHALL support absolute time format for older events (beyond 7 days)
4. THE Timestamp_Formatter SHALL include timezone information in absolute time formats
5. WHEN a timestamp is null or invalid, THE Timestamp_Formatter SHALL return a clear fallback message

### Requirement 3: Relative Time Formatting

**User Story:** As an AI agent, I want recent timestamps shown as relative time, so that I can quickly understand recency of events.

#### Acceptance Criteria

1. WHEN a timestamp is less than 1 minute old, THE Timestamp_Formatter SHALL display "just now"
2. WHEN a timestamp is 1-59 minutes old, THE Timestamp_Formatter SHALL display "X minutes ago"
3. WHEN a timestamp is 1-23 hours old, THE Timestamp_Formatter SHALL display "X hours ago"
4. WHEN a timestamp is 1-6 days old, THE Timestamp_Formatter SHALL display "X days ago"
5. WHEN a timestamp is 7 or more days old, THE Timestamp_Formatter SHALL use absolute time format

### Requirement 4: Absolute Time Formatting

**User Story:** As an AI agent, I want older timestamps shown in absolute format, so that I have precise temporal context for historical events.

#### Acceptance Criteria

1. THE Timestamp_Formatter SHALL format absolute times as "Month Day, Year at Hour:Minute AM/PM Timezone"
2. THE Timestamp_Formatter SHALL use 12-hour clock format with AM/PM indicators
3. THE Timestamp_Formatter SHALL display timezone as EST or EDT based on daylight saving time
4. THE Timestamp_Formatter SHALL use full month names (e.g., "January" not "Jan")

### Requirement 5: Market Data Timestamp Formatting

**User Story:** As an AI agent analyzing markets, I want market timestamps in human-readable format, so that I understand market timing and freshness.

#### Acceptance Criteria

1. WHEN formatting Market_Data for agents, THE System SHALL convert market creation timestamps to human-readable format
2. WHEN formatting Market_Data for agents, THE System SHALL convert market end date timestamps to human-readable format
3. WHEN formatting Market_Data for agents, THE System SHALL convert last update timestamps to human-readable format
4. THE System SHALL preserve original ISO 8601 timestamps in the LangGraph_State

### Requirement 6: News Article Timestamp Formatting

**User Story:** As an AI agent analyzing news, I want article timestamps in human-readable format, so that I can assess news recency and relevance.

#### Acceptance Criteria

1. WHEN formatting News_Article data for agents, THE System SHALL convert publication timestamps to human-readable format
2. WHEN multiple news articles are formatted, THE System SHALL maintain consistent timestamp formatting
3. THE System SHALL preserve original ISO 8601 timestamps in the LangGraph_State

### Requirement 7: Agent Signal Timestamp Formatting

**User Story:** As an AI agent reviewing prior analysis, I want signal timestamps in human-readable format, so that I understand when analysis was performed.

#### Acceptance Criteria

1. WHEN formatting Agent_Signal data for agents, THE System SHALL convert creation timestamps to human-readable format
2. WHEN formatting Agent_Signal data for agents, THE System SHALL convert update timestamps to human-readable format
3. THE System SHALL preserve original ISO 8601 timestamps in the LangGraph_State

### Requirement 8: Agent Context Boundary Conversion

**User Story:** As a system architect, I want timestamp conversion at the agent context boundary, so that state management remains unchanged and conversion is centralized.

#### Acceptance Criteria

1. WHEN constructing Agent_Context from LangGraph_State, THE System SHALL apply timestamp formatting
2. THE System SHALL NOT modify timestamps in the LangGraph_State during formatting
3. THE System SHALL apply formatting consistently across all agent nodes
4. WHEN agents receive context, THE Agent_Context SHALL contain only human-readable timestamps

### Requirement 9: Timezone Awareness

**User Story:** As an AI agent analyzing US political markets, I want timestamps in Eastern Time, so that temporal context aligns with US political events.

#### Acceptance Criteria

1. THE Timestamp_Formatter SHALL convert all timestamps to Eastern Time (EST/EDT)
2. THE Timestamp_Formatter SHALL automatically handle daylight saving time transitions
3. WHEN displaying absolute times, THE Timestamp_Formatter SHALL include the timezone abbreviation
4. THE System SHALL use the America/New_York timezone for all conversions

### Requirement 10: Backward Compatibility

**User Story:** As a system maintainer, I want timestamp changes to be backward compatible, so that existing functionality continues working without modifications.

#### Acceptance Criteria

1. THE System SHALL NOT require database schema migrations for timestamp formatting
2. THE System SHALL NOT break existing API contracts or data structures
3. WHEN timestamp formatting is disabled, THE System SHALL fall back to ISO 8601 format
4. THE System SHALL maintain all existing timestamp-related functionality

### Requirement 11: Error Handling

**User Story:** As a system operator, I want graceful error handling for invalid timestamps, so that agent analysis continues even with malformed data.

#### Acceptance Criteria

1. WHEN a timestamp is null, THE Timestamp_Formatter SHALL return "unknown time"
2. WHEN a timestamp is invalid, THE Timestamp_Formatter SHALL return "invalid timestamp"
3. WHEN timezone conversion fails, THE Timestamp_Formatter SHALL fall back to UTC with clear indication
4. THE System SHALL log warnings for invalid timestamps without throwing errors

### Requirement 12: Performance Optimization

**User Story:** As a system architect, I want efficient timestamp formatting, so that agent processing is not slowed by conversion overhead.

#### Acceptance Criteria

1. THE Timestamp_Formatter SHALL cache timezone conversion rules
2. THE Timestamp_Formatter SHALL complete conversions in under 1 millisecond per timestamp
3. WHEN formatting multiple timestamps, THE System SHALL batch timezone lookups
4. THE System SHALL NOT introduce memory leaks through timestamp formatting
