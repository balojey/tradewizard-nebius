# Requirements Document

## Introduction

The Agent Memory System transforms TradeWizard's multi-agent analysis from an open-loop system (where agents have no awareness of their previous outputs) into a closed-loop system (where agents can access, reference, and build upon their historical analysis for the same market). This enables agents to provide more thoughtful, consistent, and evolving analysis as market conditions change over time.

Currently, when agents analyze a market multiple times, each analysis is performed in isolation without knowledge of previous outputs. This leads to potential inconsistencies, missed opportunities to track evolving conditions, and inability to explain changes in agent reasoning over time.

## Glossary

- **Agent**: A specialized AI component that analyzes prediction markets from a specific perspective (e.g., Market Microstructure Agent, Polling Intelligence Agent, Risk Assessment Agent, Probability Baseline Agent)
- **Agent_Signal**: The structured output produced by an agent for a specific market analysis, including confidence, direction, fair probability, key drivers, and risk factors
- **Market**: A prediction market on Polymarket identified by a condition_id
- **Analysis_Run**: A single execution of the multi-agent workflow for a specific market at a specific point in time
- **Memory_Context**: The historical agent signals retrieved from previous analysis runs for the same market
- **Closed_Loop_System**: A system where agents receive feedback from their previous outputs to inform current analysis
- **Open_Loop_System**: A system where agents operate without awareness of their previous outputs
- **Supabase**: The PostgreSQL database where agent signals are persisted
- **LangGraph_State**: The shared state object that flows through all nodes in the TradeWizard workflow

## Requirements

### Requirement 1: Historical Signal Retrieval

**User Story:** As an agent, I want to retrieve my previous analysis outputs for the same market, so that I can understand what I analyzed before and how conditions have changed.

#### Acceptance Criteria

1. WHEN an agent begins analysis for a market, THE System SHALL query the agent_signals table for previous signals from that agent for that market
2. WHEN querying historical signals, THE System SHALL order results by created_at timestamp in descending order (most recent first)
3. WHEN multiple historical signals exist, THE System SHALL retrieve at least the 3 most recent signals from that agent for that market
4. WHEN no historical signals exist for an agent-market combination, THE System SHALL return an empty result set without error
5. WHEN historical signals are retrieved, THE System SHALL include all fields: fair_probability, confidence, direction, key_drivers, metadata, and created_at timestamp

### Requirement 2: Memory Context Integration

**User Story:** As an agent, I want my previous analysis to be included in my current analysis context, so that I can reference what I said before and explain changes in my reasoning.

#### Acceptance Criteria

1. WHEN an agent node executes, THE System SHALL provide historical signals as part of the agent's input context
2. WHEN historical signals exist, THE System SHALL format them as a structured memory context in the agent's prompt
3. WHEN the memory context is provided, THE System SHALL include the timestamp, direction, fair probability, confidence, and key drivers from each historical signal
4. WHEN no historical signals exist, THE System SHALL indicate "No previous analysis available" in the memory context
5. WHEN formatting the memory context, THE System SHALL present signals in chronological order (oldest to most recent) to show evolution over time

### Requirement 3: Agent Prompt Enhancement

**User Story:** As an agent, I want clear instructions on how to use my historical analysis, so that I can provide thoughtful, consistent, and evolving analysis over time.

#### Acceptance Criteria

1. WHEN an agent receives memory context, THE Agent SHALL be instructed to review previous analysis before generating new analysis
2. WHEN previous analysis exists, THE Agent SHALL be instructed to identify what has changed since the last analysis
3. WHEN the agent's view has changed significantly, THE Agent SHALL explain the reasoning for the change in the key drivers
4. WHEN the agent's view remains consistent, THE Agent SHALL acknowledge continuity and reinforce the reasoning
5. WHEN market conditions have evolved, THE Agent SHALL reference specific changes from previous analysis in the current analysis

### Requirement 4: Database Query Performance

**User Story:** As a system operator, I want historical signal retrieval to be performant, so that agent analysis latency does not increase significantly.

#### Acceptance Criteria

1. WHEN querying historical signals, THE System SHALL use the existing idx_agent_signals_market_id index for efficient lookup
2. WHEN querying historical signals, THE System SHALL use the existing idx_agent_signals_agent_name index for efficient filtering
3. WHEN retrieving historical signals, THE System SHALL limit results to a maximum of 5 signals per agent-market combination
4. WHEN the query executes, THE System SHALL complete within 100ms for markets with up to 100 historical signals
5. WHEN database errors occur during retrieval, THE System SHALL log the error and continue agent execution without historical context

### Requirement 5: State Management Integration

**User Story:** As a developer, I want historical signals to flow through the LangGraph state, so that the memory system integrates cleanly with the existing workflow architecture.

#### Acceptance Criteria

1. WHEN the workflow begins, THE System SHALL add a memoryContext field to the LangGraph state
2. WHEN historical signals are retrieved, THE System SHALL populate the memoryContext field with agent-specific historical data
3. WHEN an agent node executes, THE System SHALL access the memoryContext from the state object
4. WHEN the workflow completes, THE System SHALL preserve the memoryContext in the audit log for debugging
5. WHEN multiple agents execute concurrently, THE System SHALL ensure each agent receives only its own historical signals

### Requirement 6: Backward Compatibility

**User Story:** As a system operator, I want the memory system to work with existing agent outputs, so that historical data is immediately useful without migration.

#### Acceptance Criteria

1. WHEN retrieving historical signals, THE System SHALL work with the existing agent_signals table schema without modifications
2. WHEN agents execute, THE System SHALL continue to store signals in the same format as before
3. WHEN historical signals are unavailable, THE System SHALL allow agents to operate normally without memory context
4. WHEN the memory system is enabled, THE System SHALL not break existing agent implementations
5. WHEN new signals are stored, THE System SHALL maintain compatibility with existing database queries and indexes

### Requirement 7: Memory Context Formatting

**User Story:** As an agent, I want historical analysis to be presented in a clear, structured format, so that I can easily understand and reference previous outputs.

#### Acceptance Criteria

1. WHEN formatting memory context, THE System SHALL present each historical signal as a distinct entry with clear separation
2. WHEN displaying timestamps, THE System SHALL format them as human-readable dates (e.g., "2025-01-15 14:30 UTC")
3. WHEN showing fair probability and confidence, THE System SHALL format them as percentages (e.g., "65%" instead of "0.65")
4. WHEN presenting key drivers, THE System SHALL display them as a bulleted list for readability
5. WHEN the memory context exceeds 1000 characters, THE System SHALL truncate older signals and indicate truncation

### Requirement 8: Agent Analysis Evolution Tracking

**User Story:** As a system operator, I want to track how agent analysis evolves over time, so that I can understand agent reasoning patterns and improve agent quality.

#### Acceptance Criteria

1. WHEN an agent produces a new signal, THE System SHALL compare it to the most recent historical signal for that agent-market combination
2. WHEN the direction changes (e.g., YES to NO), THE System SHALL log a "direction_change" event in the audit log
3. WHEN the fair probability changes by more than 10%, THE System SHALL log a "probability_shift" event in the audit log
4. WHEN the confidence changes by more than 0.2, THE System SHALL log a "confidence_change" event in the audit log
5. WHEN key drivers change significantly, THE System SHALL log a "reasoning_evolution" event in the audit log

### Requirement 9: Error Handling and Resilience

**User Story:** As a system operator, I want the memory system to handle errors gracefully, so that agent analysis continues even when historical data is unavailable.

#### Acceptance Criteria

1. WHEN database connection fails during historical signal retrieval, THE System SHALL log the error and continue with empty memory context
2. WHEN historical signal data is corrupted or invalid, THE System SHALL skip the invalid signal and use remaining valid signals
3. WHEN the memory context query times out, THE System SHALL abort the query after 5 seconds and continue without memory context
4. WHEN Supabase rate limits are hit, THE System SHALL implement exponential backoff and retry up to 3 times
5. WHEN all retries fail, THE System SHALL log the failure and allow agent execution to proceed without historical context

### Requirement 10: Memory Context Validation

**User Story:** As a developer, I want historical signals to be validated before use, so that agents receive only well-formed memory context.

#### Acceptance Criteria

1. WHEN historical signals are retrieved, THE System SHALL validate that each signal contains required fields (agent_name, market_id, direction, fair_probability, confidence)
2. WHEN a historical signal is missing required fields, THE System SHALL exclude it from the memory context
3. WHEN fair_probability is outside the range [0, 1], THE System SHALL exclude that signal from memory context
4. WHEN confidence is outside the range [0, 1], THE System SHALL exclude that signal from memory context
5. WHEN direction is not one of ['YES', 'NO', 'NEUTRAL'], THE System SHALL exclude that signal from memory context
