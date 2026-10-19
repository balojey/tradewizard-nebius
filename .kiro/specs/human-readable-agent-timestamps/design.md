# Design Document: Human-Readable Agent Timestamps

## Overview

This design introduces human-readable timestamp formatting for the TradeWizard multi-agent system. Currently, timestamps are passed to AI agents in ISO 8601 format, requiring agents to parse and understand temporal context. This design converts timestamps to natural language format (e.g., "2 hours ago", "January 15, 2024 at 3:30 PM EST") when presented to LLM agents, while maintaining standard formats for programmatic use.

The solution implements a formatting layer at the boundary between LangGraph state and agent prompts, ensuring zero impact on existing data structures, database schemas, or state management.

## Architecture

### High-Level Design

```
┌─────────────────────────────────────────────────────────────┐
│                    LangGraph Workflow                        │
│                                                              │
│  ┌──────────────┐      ┌──────────────┐      ┌──────────┐  │
│  │ Market       │      │ Agent        │      │ Consensus│  │
│  │ Ingestion    │─────▶│ Analysis     │─────▶│ Engine   │  │
│  │              │      │              │      │          │  │
│  └──────────────┘      └──────────────┘      └──────────┘  │
│         │                      │                    │        │
│         ▼                      ▼                    ▼        │
│  ┌──────────────────────────────────────────────────────┐  │
│  │           GraphState (ISO 8601 timestamps)           │  │
│  └──────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────┘
                               │
                               │ Formatting Boundary
                               ▼
┌─────────────────────────────────────────────────────────────┐
│              Timestamp Formatting Layer                      │
│                                                              │
│  ┌────────────────────────────────────────────────────────┐ │
│  │  formatMarketContextForAgent(mbd, externalData)        │ │
│  │  • Converts all timestamps to human-readable format    │ │
│  │  • Returns formatted context string for LLM prompt     │ │
│  └────────────────────────────────────────────────────────┘ │
│                               │                              │
│  ┌────────────────────────────────────────────────────────┐ │
│  │  Timestamp Formatter Utility                           │ │
│  │  • formatTimestamp(iso, options)                       │ │
│  │  • formatRelativeTime(iso)                             │ │
│  │  • formatAbsoluteTime(iso)                             │ │
│  └────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────┘
                               │
                               ▼
┌─────────────────────────────────────────────────────────────┐
│                    Agent LLM Prompt                          │
│                                                              │
│  Market created: 3 days ago                                  │
│  Market expires: January 20, 2025 at 11:59 PM EST          │
│  Latest news: 2 hours ago                                    │
│  Previous analysis: 1 day ago                                │
└─────────────────────────────────────────────────────────────┘
```

### Key Design Principles

1. **Non-invasive**: No changes to GraphState, database schemas, or existing data structures
2. **Boundary-based**: Formatting happens only when constructing agent prompts
3. **Centralized**: Single utility module handles all timestamp formatting
4. **Timezone-aware**: All timestamps converted to Eastern Time (EST/EDT)
5. **Fallback-safe**: Graceful handling of invalid or missing timestamps

## Components and Interfaces

### 1. Timestamp Formatter Utility

**Location**: `src/utils/timestamp-formatter.ts`

**Purpose**: Core utility for converting ISO 8601 timestamps to human-readable formats.

```typescript
/**
 * Options for timestamp formatting
 */
export interface TimestampFormatOptions {
  /**
   * Timezone for absolute time formatting
   * @default 'America/New_York'
   */
  timezone?: string;
  
  /**
   * Threshold in days for switching from relative to absolute time
   * @default 7
   */
  relativeThresholdDays?: number;
  
  /**
   * Reference time for relative calculations (defaults to now)
   */
  referenceTime?: Date;
}

/**
 * Format result with metadata
 */
export interface FormattedTimestamp {
  /**
   * Human-readable timestamp string
   */
  formatted: string;
  
  /**
   * Whether relative or absolute format was used
   */
  formatType: 'relative' | 'absolute' | 'fallback';
  
  /**
   * Original ISO 8601 timestamp (for debugging)
   */
  original: string;
}

/**
 * Main formatting function - automatically chooses relative or absolute format
 * 
 * @param isoTimestamp - ISO 8601 timestamp string or Unix timestamp number
 * @param options - Formatting options
 * @returns Formatted timestamp with metadata
 * 
 * @example
 * formatTimestamp('2024-01-15T15:30:00Z')
 * // => { formatted: '2 hours ago', formatType: 'relative', original: '2024-01-15T15:30:00Z' }
 * 
 * formatTimestamp('2024-01-01T15:30:00Z')
 * // => { formatted: 'January 1, 2024 at 3:30 PM EST', formatType: 'absolute', original: '2024-01-01T15:30:00Z' }
 */
export function formatTimestamp(
  isoTimestamp: string | number | null | undefined,
  options?: TimestampFormatOptions
): FormattedTimestamp;

/**
 * Format timestamp as relative time (e.g., "2 hours ago")
 * 
 * @param isoTimestamp - ISO 8601 timestamp string or Unix timestamp number
 * @param referenceTime - Reference time for calculation (defaults to now)
 * @returns Relative time string
 * 
 * @example
 * formatRelativeTime('2024-01-15T15:30:00Z')
 * // => 'just now' | '5 minutes ago' | '2 hours ago' | '3 days ago'
 */
export function formatRelativeTime(
  isoTimestamp: string | number,
  referenceTime?: Date
): string;

/**
 * Format timestamp as absolute time (e.g., "January 15, 2024 at 3:30 PM EST")
 * 
 * @param isoTimestamp - ISO 8601 timestamp string or Unix timestamp number
 * @param timezone - Timezone for formatting (defaults to America/New_York)
 * @returns Absolute time string
 * 
 * @example
 * formatAbsoluteTime('2024-01-15T15:30:00Z')
 * // => 'January 15, 2024 at 3:30 PM EST'
 */
export function formatAbsoluteTime(
  isoTimestamp: string | number,
  timezone?: string
): string;

/**
 * Batch format multiple timestamps efficiently
 * 
 * @param timestamps - Array of ISO 8601 timestamps
 * @param options - Formatting options
 * @returns Array of formatted timestamps
 */
export function formatTimestampBatch(
  timestamps: Array<string | number | null | undefined>,
  options?: TimestampFormatOptions
): FormattedTimestamp[];
```

### 2. Agent Context Formatter

**Location**: `src/utils/agent-context-formatter.ts`

**Purpose**: Formats market data, news, and agent signals for LLM consumption with human-readable timestamps.

```typescript
/**
 * Format Market Briefing Document for agent consumption
 * Converts all timestamps to human-readable format
 * 
 * @param mbd - Market Briefing Document from state
 * @returns Formatted string for LLM prompt
 */
export function formatMarketBriefingForAgent(
  mbd: MarketBriefingDocument
): string;

/**
 * Format external data (news, polling, social) for agent consumption
 * Converts all timestamps to human-readable format
 * 
 * @param externalData - External data from state
 * @returns Formatted string for LLM prompt
 */
export function formatExternalDataForAgent(
  externalData: GraphStateType['externalData']
): string;

/**
 * Format agent signals for agent consumption (for memory context)
 * Converts all timestamps to human-readable format
 * 
 * @param signals - Array of agent signals
 * @returns Formatted string for LLM prompt
 */
export function formatAgentSignalsForAgent(
  signals: AgentSignal[]
): string;

/**
 * Format complete market context for agent
 * Combines MBD, external data, and memory context with human-readable timestamps
 * 
 * @param state - LangGraph state
 * @param agentName - Name of the agent receiving the context
 * @returns Formatted context string for LLM prompt
 */
export function formatMarketContextForAgent(
  state: GraphStateType,
  agentName: string
): string;
```

### 3. Integration Points

**Modified Files**:
- `src/nodes/agents.ts` - Update agent nodes to use formatted context
- `src/nodes/autonomous-news-agents.ts` - Update news agent context formatting
- `src/nodes/thesis-construction.ts` - Update thesis construction context
- `src/nodes/cross-examination.ts` - Update debate context formatting
- `src/nodes/consensus-engine.ts` - Update consensus context formatting

**Integration Pattern**:

```typescript
// BEFORE (current implementation)
const marketContext = JSON.stringify(state.mbd, null, 2);
const messages = [
  { role: 'system', content: systemPrompt },
  {
    role: 'user',
    content: `Analyze the following prediction market:\n\n${marketContext}`,
  },
];

// AFTER (with human-readable timestamps)
import { formatMarketContextForAgent } from '../utils/agent-context-formatter.js';

const marketContext = formatMarketContextForAgent(state, agentName);
const messages = [
  { role: 'system', content: systemPrompt },
  {
    role: 'user',
    content: `Analyze the following prediction market:\n\n${marketContext}`,
  },
];
```

## Data Models

### Timestamp Locations in State

The following fields contain timestamps that need formatting:

**MarketBriefingDocument**:
- `expiryTimestamp` (number) - Market expiration time
- `metadata.keyCatalysts[].timestamp` (number) - Catalyst event times

**External Data**:
- `externalData.news[].publishedAt` (number) - News article publication time
- `externalData.polling.polls[].date` (number) - Poll date
- `externalData.dataFreshness` (Record<string, number>) - Data fetch timestamps

**Agent Signals**:
- `agentSignals[].timestamp` (number) - Signal creation time

**Memory Context**:
- `memoryContext.signals[].timestamp` (number) - Historical signal timestamps

**Audit Log**:
- `auditLog[].timestamp` (number) - Audit entry timestamps

### Formatted Output Examples

**Relative Time Examples**:
```
just now
5 minutes ago
2 hours ago
3 days ago
```

**Absolute Time Examples**:
```
January 15, 2024 at 3:30 PM EST
December 25, 2023 at 11:59 PM EST
March 1, 2024 at 9:00 AM EDT
```

**Fallback Examples**:
```
unknown time (for null timestamps)
invalid timestamp (for malformed timestamps)
```

## Correctness Properties

*A property is a characteristic or behavior that should hold true across all valid executions of a system-essentially, a formal statement about what the system should do. Properties serve as the bridge between human-readable specifications and machine-verifiable correctness guarantees.*


### Property 1: ISO 8601 Format Preservation in State

*For any* LangGraph state and any formatting operation, all timestamp fields in the state SHALL remain in ISO 8601 format after the operation completes.

**Validates: Requirements 1.1, 1.3, 5.4, 6.3, 7.3, 8.2**

### Property 2: ISO 8601 Format Persistence in Database

*For any* timestamp written to the database, the persisted value SHALL be in valid ISO 8601 format with timezone information preserved.

**Validates: Requirements 1.2, 1.4**

### Property 3: Human-Readable Conversion

*For any* valid ISO 8601 timestamp, the Timestamp_Formatter SHALL convert it to a human-readable string that does not contain ISO 8601 format patterns.

**Validates: Requirements 2.1**

### Property 4: Relative Time Format Selection

*For any* timestamp less than 7 days old (relative to reference time), the Timestamp_Formatter SHALL produce a relative time format string (e.g., "X minutes ago", "X hours ago", "X days ago").

**Validates: Requirements 2.2, 3.5**

### Property 5: Absolute Time Format Selection

*For any* timestamp 7 or more days old (relative to reference time), the Timestamp_Formatter SHALL produce an absolute time format string matching the pattern "Month Day, Year at Hour:Minute AM/PM Timezone".

**Validates: Requirements 2.3, 4.1**

### Property 6: Timezone Inclusion in Absolute Format

*For any* timestamp formatted in absolute time, the output string SHALL contain either "EST" or "EDT" timezone abbreviation based on daylight saving time rules.

**Validates: Requirements 2.4, 4.3, 9.3**

### Property 7: Graceful Null and Invalid Handling

*For any* null or invalid timestamp input, the Timestamp_Formatter SHALL return a fallback string without throwing errors.

**Validates: Requirements 2.5, 11.4**

### Property 8: 12-Hour Clock Format

*For any* timestamp formatted in absolute time, the hour component SHALL be in 12-hour format (1-12) with AM or PM indicator, not 24-hour format (0-23).

**Validates: Requirements 4.2**

### Property 9: Full Month Names

*For any* timestamp formatted in absolute time, the month SHALL be spelled out in full (e.g., "January", "February") rather than abbreviated.

**Validates: Requirements 4.4**

### Property 10: Market Data Timestamp Formatting

*For any* Market Briefing Document formatted for agent consumption, all timestamp fields (expiry, catalysts, creation) SHALL be converted to human-readable format in the output string.

**Validates: Requirements 5.1, 5.2, 5.3**

### Property 11: News Article Timestamp Formatting

*For any* collection of news articles formatted for agent consumption, all publication timestamps SHALL be converted to human-readable format using consistent formatting rules.

**Validates: Requirements 6.1, 6.2**

### Property 12: Agent Signal Timestamp Formatting

*For any* collection of agent signals formatted for agent consumption, all creation and update timestamps SHALL be converted to human-readable format.

**Validates: Requirements 7.1, 7.2**

### Property 13: Agent Context Boundary Conversion

*For any* agent context constructed from LangGraph state, the context string SHALL contain only human-readable timestamps and SHALL NOT contain ISO 8601 format patterns.

**Validates: Requirements 8.1, 8.4**

### Property 14: Consistent Formatting Across Nodes

*For any* two agent nodes receiving the same state, the formatted timestamps in their contexts SHALL be identical (given the same reference time).

**Validates: Requirements 8.3**

### Property 15: Eastern Time Conversion

*For any* timestamp formatted by the system, the timezone conversion SHALL use America/New_York timezone (EST/EDT) for all calculations.

**Validates: Requirements 9.1, 9.4**

### Property 16: Daylight Saving Time Handling

*For any* timestamp during a daylight saving time transition period, the Timestamp_Formatter SHALL automatically select the correct timezone abbreviation (EST or EDT) based on the date.

**Validates: Requirements 9.2**

### Property 17: Backward Compatibility

*For any* existing code that uses timestamps from state, the code SHALL continue to function correctly after the formatting layer is introduced.

**Validates: Requirements 10.2**

### Property 18: Formatting Disable Fallback

*For any* timestamp when formatting is disabled, the system SHALL return the original ISO 8601 format string.

**Validates: Requirements 10.3**

### Property 19: Timezone Conversion Failure Recovery

*For any* timestamp where timezone conversion fails, the Timestamp_Formatter SHALL fall back to UTC with a clear indication in the output string.

**Validates: Requirements 11.3**

### Property 20: Performance Constraint

*For any* single timestamp formatting operation, the execution time SHALL be less than 1 millisecond.

**Validates: Requirements 12.2**

### Property 21: Memory Leak Prevention

*For any* sequence of repeated timestamp formatting operations, memory usage SHALL remain stable without unbounded growth.

**Validates: Requirements 12.4**

## Error Handling

### Invalid Timestamp Handling

**Strategy**: Graceful degradation with clear fallback messages

**Error Cases**:
1. **Null timestamps**: Return "unknown time"
2. **Invalid ISO 8601 format**: Return "invalid timestamp"
3. **Timezone conversion failure**: Return UTC time with "(UTC)" suffix
4. **Out-of-range dates**: Return "invalid date"

**Implementation**:
```typescript
try {
  // Attempt timestamp parsing and formatting
  const date = parseISO(isoTimestamp);
  if (!isValid(date)) {
    return { formatted: 'invalid timestamp', formatType: 'fallback', original: isoTimestamp };
  }
  // ... formatting logic
} catch (error) {
  console.warn(`Timestamp formatting error: ${error.message}`, { timestamp: isoTimestamp });
  return { formatted: 'invalid timestamp', formatType: 'fallback', original: isoTimestamp };
}
```

### State Mutation Prevention

**Strategy**: Immutable data handling

**Approach**:
- Never modify the input state object
- Create new formatted strings without touching original timestamps
- Use TypeScript `Readonly` types to enforce immutability

**Implementation**:
```typescript
export function formatMarketContextForAgent(
  state: Readonly<GraphStateType>,
  agentName: string
): string {
  // Read from state but never write to it
  // All formatting creates new strings
}
```

### Timezone Conversion Errors

**Strategy**: Fallback to UTC with clear indication

**Approach**:
- Attempt conversion to America/New_York
- On failure, use UTC and append "(UTC)" to output
- Log warning for monitoring

**Implementation**:
```typescript
try {
  return formatInTimeZone(date, 'America/New_York', formatString);
} catch (error) {
  console.warn('Timezone conversion failed, falling back to UTC', { error });
  return format(date, formatString) + ' (UTC)';
}
```

## Testing Strategy

### Dual Testing Approach

This feature requires both unit tests and property-based tests for comprehensive coverage:

**Unit Tests**: Focus on specific examples and edge cases
- Specific timestamp values (e.g., "2024-01-15T15:30:00Z")
- Boundary conditions (exactly 7 days old)
- Error cases (null, invalid format)
- Integration with agent nodes

**Property-Based Tests**: Verify universal properties across all inputs
- Random valid ISO 8601 timestamps
- Random dates across multiple years
- Random times of day
- DST transition periods
- Comprehensive input coverage (100+ iterations per property)

### Property-Based Testing Configuration

**Library**: fast-check (already in dependencies)

**Configuration**:
- Minimum 100 iterations per property test
- Each test references its design document property
- Tag format: `Feature: human-readable-agent-timestamps, Property {number}: {property_text}`

**Example Property Test**:
```typescript
import fc from 'fast-check';
import { describe, it, expect } from 'vitest';
import { formatTimestamp } from '../utils/timestamp-formatter.js';

describe('Timestamp Formatter Properties', () => {
  // Feature: human-readable-agent-timestamps, Property 3: Human-Readable Conversion
  it('Property 3: converts any valid ISO 8601 timestamp to human-readable format', () => {
    fc.assert(
      fc.property(
        fc.date({ min: new Date('2020-01-01'), max: new Date('2030-12-31') }),
        (date) => {
          const isoTimestamp = date.toISOString();
          const result = formatTimestamp(isoTimestamp);
          
          // Should not contain ISO 8601 patterns
          expect(result.formatted).not.toMatch(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
          expect(result.formatted).not.toMatch(/Z$/);
          
          // Should be human-readable
          expect(result.formatted.length).toBeGreaterThan(0);
          expect(result.formatType).toMatch(/^(relative|absolute)$/);
        }
      ),
      { numRuns: 100 }
    );
  });
});
```

### Unit Test Coverage

**Core Utility Tests** (`timestamp-formatter.test.ts`):
- Relative time formatting for each range (minutes, hours, days)
- Absolute time formatting with various dates
- Null and invalid input handling
- Timezone conversion (EST/EDT)
- 12-hour clock format validation
- Full month name validation
- Performance benchmarks

**Integration Tests** (`agent-context-formatter.test.ts`):
- Market Briefing Document formatting
- External data formatting (news, polling)
- Agent signal formatting
- Complete market context formatting
- State immutability verification

**Node Integration Tests**:
- Agent node context formatting
- Thesis construction context formatting
- Cross-examination context formatting
- Consensus engine context formatting

### Test Data Generators

**For Property-Based Tests**:
```typescript
// Generate random valid ISO 8601 timestamps
const isoTimestampArbitrary = fc.date({
  min: new Date('2020-01-01'),
  max: new Date('2030-12-31')
}).map(d => d.toISOString());

// Generate timestamps in specific ranges
const recentTimestampArbitrary = fc.date({
  min: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000),
  max: new Date()
}).map(d => d.toISOString());

const oldTimestampArbitrary = fc.date({
  min: new Date('2020-01-01'),
  max: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)
}).map(d => d.toISOString());

// Generate DST transition dates
const dstTransitionArbitrary = fc.constantFrom(
  '2024-03-10T07:00:00Z', // Spring forward
  '2024-11-03T06:00:00Z'  // Fall back
);
```

### Continuous Integration

**Test Execution**:
- Run all tests on every commit
- Property tests with 100 iterations minimum
- Performance tests to catch regressions
- Integration tests with real state objects

**Coverage Requirements**:
- Minimum 90% line coverage for new utilities
- 100% coverage for error handling paths
- All 21 properties must have corresponding tests

## Implementation Notes

### Dependencies

**Existing Dependencies** (no new installations required):
- `date-fns` - Already in package.json, provides date manipulation
- `date-fns-tz` - Already in package.json, provides timezone support
- `fast-check` - Already in package.json, provides property-based testing

**Key Functions from date-fns**:
- `parseISO()` - Parse ISO 8601 strings
- `formatDistanceToNow()` - Generate relative time strings
- `format()` - Format dates with patterns
- `formatInTimeZone()` - Format with timezone conversion
- `isValid()` - Validate date objects

### Performance Considerations

**Optimization Strategies**:
1. **Timezone caching**: date-fns-tz automatically caches timezone rules
2. **Batch formatting**: Process multiple timestamps in single pass
3. **Lazy evaluation**: Only format timestamps when constructing agent context
4. **Memoization**: Cache formatted strings for identical timestamps (optional)

**Performance Targets**:
- Single timestamp: < 1ms
- Batch of 100 timestamps: < 50ms
- Agent context formatting: < 10ms total overhead

### Migration Path

**Phase 1: Add Utilities** (No Breaking Changes)
- Create `timestamp-formatter.ts` utility
- Create `agent-context-formatter.ts` utility
- Add comprehensive tests
- No changes to existing code

**Phase 2: Integrate with Agent Nodes** (Backward Compatible)
- Update `agents.ts` to use formatted context
- Update other node files incrementally
- Maintain existing functionality
- Add feature flag for gradual rollout

**Phase 3: Extend to All Nodes** (Complete Integration)
- Update all remaining nodes
- Update memory context formatting
- Update audit logging (optional)
- Remove feature flag

### Configuration Options

**Environment Variables** (optional):
```bash
# Enable/disable human-readable timestamps
ENABLE_HUMAN_READABLE_TIMESTAMPS=true

# Timezone for formatting (defaults to America/New_York)
TIMESTAMP_TIMEZONE=America/New_York

# Threshold for relative vs absolute (defaults to 7 days)
RELATIVE_TIME_THRESHOLD_DAYS=7
```

**Runtime Configuration**:
```typescript
export interface TimestampFormatterConfig {
  enabled: boolean;
  timezone: string;
  relativeThresholdDays: number;
}

// Default configuration
export const DEFAULT_CONFIG: TimestampFormatterConfig = {
  enabled: true,
  timezone: 'America/New_York',
  relativeThresholdDays: 7,
};
```

## Deployment Considerations

### Zero-Downtime Deployment

**Strategy**: Feature flag with gradual rollout

**Steps**:
1. Deploy utilities without integration (no impact)
2. Deploy agent node updates with feature flag disabled
3. Enable feature flag for 10% of requests
4. Monitor for errors and performance impact
5. Gradually increase to 100%
6. Remove feature flag after stable period

### Monitoring and Observability

**Metrics to Track**:
- Timestamp formatting errors (should be near zero)
- Formatting performance (should be < 1ms per timestamp)
- Agent LLM token usage (may decrease with better formatting)
- Agent analysis quality (should improve or stay same)

**Logging**:
- Warn on invalid timestamps
- Warn on timezone conversion failures
- Debug log formatting statistics

### Rollback Plan

**If Issues Arise**:
1. Disable feature flag immediately
2. System reverts to ISO 8601 timestamps
3. No data loss or corruption (state unchanged)
4. Investigate and fix issues
5. Re-enable gradually

## Future Enhancements

### Potential Improvements

1. **Localization**: Support multiple languages for timestamp formatting
2. **User Preferences**: Allow users to choose timezone and format preferences
3. **Smart Context**: Adjust relative/absolute threshold based on market expiry
4. **Caching**: Memoize formatted strings for frequently accessed timestamps
5. **Audit Trail**: Include human-readable timestamps in audit logs for debugging

### Extension Points

The design supports future extensions:
- Custom format patterns per agent type
- Dynamic threshold based on market characteristics
- Integration with frontend timestamp display
- Unified timestamp formatting across backend and frontend
