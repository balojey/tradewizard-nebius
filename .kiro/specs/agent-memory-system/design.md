# Design Document: Agent Memory System

## Overview

The Agent Memory System transforms TradeWizard's multi-agent analysis workflow from an open-loop system into a closed-loop system by enabling agents to access and reference their previous analysis outputs for the same market. This creates a feedback mechanism where agents can track how their analysis evolves over time, explain changes in reasoning, and provide more thoughtful, consistent recommendations.

### Current State (Open-Loop)

Currently, when an agent analyzes a market multiple times:
- Each analysis is performed in complete isolation
- Agents have no awareness of what they previously concluded
- No ability to track evolving market conditions or explain reasoning changes
- Potential for inconsistent analysis across time periods

### Target State (Closed-Loop)

With the memory system:
- Agents retrieve their previous 3-5 analysis outputs before generating new analysis
- Historical signals are formatted as structured memory context in the agent prompt
- Agents explicitly reference previous analysis and explain changes
- Analysis continuity improves reasoning quality and consistency over time

### Key Design Principles

1. **Backward Compatibility**: Works with existing agent_signals table schema without modifications
2. **Performance**: Historical retrieval adds minimal latency (<100ms)
3. **Graceful Degradation**: Agents continue to function normally if memory retrieval fails
4. **Clean Integration**: Memory context flows through existing LangGraph state management
5. **Agent Autonomy**: Each agent receives only its own historical signals

## Architecture

### System Components

```
┌─────────────────────────────────────────────────────────────┐
│                    LangGraph Workflow                        │
│                                                              │
│  ┌────────────────┐                                         │
│  │ Market         │                                         │
│  │ Ingestion      │                                         │
│  └────────┬───────┘                                         │
│           │                                                  │
│           ▼                                                  │
│  ┌────────────────┐                                         │
│  │ Memory Context │◄──────┐                                │
│  │ Retrieval      │       │                                │
│  └────────┬───────┘       │                                │
│           │               │                                │
│           │        ┌──────┴────────┐                       │
│           │        │   Supabase    │                       │
│           │        │ agent_signals │                       │
│           │        │     Table     │                       │
│           │        └───────────────┘                       │
│           ▼                                                  │
│  ┌────────────────────────────────────────┐                │
│  │  Agent Nodes (Parallel Execution)      │                │
│  │                                         │                │
│  │  ┌──────────────┐  ┌──────────────┐   │                │
│  │  │ Market       │  │ Polling      │   │                │
│  │  │ Microstr.    │  │ Intelligence │   │                │
│  │  │ Agent        │  │ Agent        │   │                │
│  │  │              │  │              │   │                │
│  │  │ Memory: [...]│  │ Memory: [...]│   │                │
│  │  └──────────────┘  └──────────────┘   │                │
│  │                                         │                │
│  │  ┌──────────────┐  ┌──────────────┐   │                │
│  │  │ Probability  │  │ Risk         │   │                │
│  │  │ Baseline     │  │ Assessment   │   │                │
│  │  │ Agent        │  │ Agent        │   │                │
│  │  │              │  │              │   │                │
│  │  │ Memory: [...]│  │ Memory: [...]│   │                │
│  │  └──────────────┘  └──────────────┘   │                │
│  └────────────────────────────────────────┘                │
│           │                                                  │
│           ▼                                                  │
│  ┌────────────────┐                                         │
│  │ Signal Fusion  │                                         │
│  │ & Consensus    │                                         │
│  └────────┬───────┘                                         │
│           │                                                  │
│           ▼                                                  │
│  ┌────────────────┐                                         │
│  │ Recommendation │                                         │
│  │ Generation     │                                         │
│  └────────────────┘                                         │
└─────────────────────────────────────────────────────────────┘
```

### Data Flow

1. **Market Ingestion**: Workflow begins with market data ingestion (existing)
2. **Memory Retrieval**: New node queries Supabase for historical agent signals
3. **Context Injection**: Historical signals are formatted and added to LangGraph state
4. **Agent Execution**: Each agent receives its own memory context in the prompt
5. **Signal Storage**: New agent signals are stored (existing behavior)
6. **Evolution Tracking**: System compares new signals to historical signals for audit logging

## Components and Interfaces

### 1. Memory Retrieval Service

**Location**: `tradewizard-agents/src/database/memory-retrieval.ts`

**Purpose**: Encapsulates all logic for querying and formatting historical agent signals.

**Interface**:

```typescript
/**
 * Historical agent signal retrieved from database
 */
export interface HistoricalSignal {
  agentName: string;
  marketId: string;
  timestamp: Date;
  direction: 'YES' | 'NO' | 'NEUTRAL';
  fairProbability: number;
  confidence: number;
  keyDrivers: string[];
  metadata: Record<string, unknown>;
}

/**
 * Memory context for a specific agent
 */
export interface AgentMemoryContext {
  agentName: string;
  marketId: string;
  historicalSignals: HistoricalSignal[];
  hasHistory: boolean;
}

/**
 * Memory retrieval service interface
 */
export interface MemoryRetrievalService {
  /**
   * Retrieve historical signals for a specific agent-market combination
   * @param agentName - Name of the agent
   * @param marketId - Market condition ID
   * @param limit - Maximum number of historical signals to retrieve (default: 3)
   * @returns Agent memory context with historical signals
   */
  getAgentMemory(
    agentName: string,
    marketId: string,
    limit?: number
  ): Promise<AgentMemoryContext>;

  /**
   * Retrieve memory context for all agents for a specific market
   * @param marketId - Market condition ID
   * @param agentNames - List of agent names to retrieve memory for
   * @param limit - Maximum number of historical signals per agent (default: 3)
   * @returns Map of agent name to memory context
   */
  getAllAgentMemories(
    marketId: string,
    agentNames: string[],
    limit?: number
  ): Promise<Map<string, AgentMemoryContext>>;
}
```

**Implementation Details**:

```typescript
export class MemoryRetrievalServiceImpl implements MemoryRetrievalService {
  constructor(private supabaseManager: SupabaseClientManager) {}

  async getAgentMemory(
    agentName: string,
    marketId: string,
    limit: number = 3
  ): Promise<AgentMemoryContext> {
    try {
      const client = this.supabaseManager.getClient();
      
      // Query agent_signals table with indexes
      const { data, error } = await client
        .from('agent_signals')
        .select('*')
        .eq('agent_name', agentName)
        .eq('market_id', marketId)
        .order('created_at', { ascending: false })
        .limit(Math.min(limit, 5)); // Cap at 5 for performance

      if (error) {
        console.error('[MemoryRetrieval] Query failed:', error);
        return this.emptyContext(agentName, marketId);
      }

      if (!data || data.length === 0) {
        return this.emptyContext(agentName, marketId);
      }

      // Transform database rows to HistoricalSignal objects
      const historicalSignals = data
        .map(row => this.transformToHistoricalSignal(row))
        .filter(signal => signal !== null) as HistoricalSignal[];

      return {
        agentName,
        marketId,
        historicalSignals,
        hasHistory: historicalSignals.length > 0,
      };
    } catch (error) {
      console.error('[MemoryRetrieval] Unexpected error:', error);
      return this.emptyContext(agentName, marketId);
    }
  }

  async getAllAgentMemories(
    marketId: string,
    agentNames: string[],
    limit: number = 3
  ): Promise<Map<string, AgentMemoryContext>> {
    const memoryMap = new Map<string, AgentMemoryContext>();

    // Fetch memories in parallel for all agents
    const memoryPromises = agentNames.map(agentName =>
      this.getAgentMemory(agentName, marketId, limit)
    );

    const memories = await Promise.all(memoryPromises);

    memories.forEach(memory => {
      memoryMap.set(memory.agentName, memory);
    });

    return memoryMap;
  }

  private emptyContext(agentName: string, marketId: string): AgentMemoryContext {
    return {
      agentName,
      marketId,
      historicalSignals: [],
      hasHistory: false,
    };
  }

  private transformToHistoricalSignal(row: any): HistoricalSignal | null {
    // Validate required fields
    if (!row.agent_name || !row.market_id || !row.direction) {
      return null;
    }

    // Validate probability and confidence ranges
    if (
      row.fair_probability < 0 || row.fair_probability > 1 ||
      row.confidence < 0 || row.confidence > 1
    ) {
      return null;
    }

    // Validate direction enum
    if (!['YES', 'NO', 'NEUTRAL'].includes(row.direction)) {
      return null;
    }

    return {
      agentName: row.agent_name,
      marketId: row.market_id,
      timestamp: new Date(row.created_at),
      direction: row.direction,
      fairProbability: row.fair_probability,
      confidence: row.confidence,
      keyDrivers: row.key_drivers || [],
      metadata: row.metadata || {},
    };
  }
}
```

### 2. Memory Context Formatter

**Location**: `tradewizard-agents/src/utils/memory-formatter.ts`

**Purpose**: Formats historical signals into human-readable text for agent prompts.

**Interface**:

```typescript
/**
 * Format options for memory context
 */
export interface MemoryFormatOptions {
  maxLength?: number; // Maximum character length (default: 1000)
  includeMetadata?: boolean; // Include metadata fields (default: false)
  dateFormat?: 'iso' | 'relative' | 'human'; // Date formatting style (default: 'human')
}

/**
 * Formatted memory context ready for agent prompt
 */
export interface FormattedMemoryContext {
  text: string;
  signalCount: number;
  truncated: boolean;
}

/**
 * Format agent memory context for inclusion in prompts
 */
export function formatMemoryContext(
  memory: AgentMemoryContext,
  options?: MemoryFormatOptions
): FormattedMemoryContext;
```

**Implementation**:

```typescript
export function formatMemoryContext(
  memory: AgentMemoryContext,
  options: MemoryFormatOptions = {}
): FormattedMemoryContext {
  const {
    maxLength = 1000,
    includeMetadata = false,
    dateFormat = 'human',
  } = options;

  if (!memory.hasHistory || memory.historicalSignals.length === 0) {
    return {
      text: 'No previous analysis available for this market.',
      signalCount: 0,
      truncated: false,
    };
  }

  // Sort signals chronologically (oldest first) to show evolution
  const sortedSignals = [...memory.historicalSignals].sort(
    (a, b) => a.timestamp.getTime() - b.timestamp.getTime()
  );

  let text = `Previous Analysis History (${sortedSignals.length} signals):\n\n`;
  let truncated = false;

  for (const signal of sortedSignals) {
    const signalText = formatSingleSignal(signal, dateFormat, includeMetadata);
    
    // Check if adding this signal would exceed max length
    if (text.length + signalText.length > maxLength) {
      text += '\n[Additional signals truncated for brevity]';
      truncated = true;
      break;
    }

    text += signalText + '\n\n';
  }

  return {
    text: text.trim(),
    signalCount: sortedSignals.length,
    truncated,
  };
}

function formatSingleSignal(
  signal: HistoricalSignal,
  dateFormat: 'iso' | 'relative' | 'human',
  includeMetadata: boolean
): string {
  const timestamp = formatTimestamp(signal.timestamp, dateFormat);
  const probability = formatPercentage(signal.fairProbability);
  const confidence = formatPercentage(signal.confidence);

  let text = `Analysis from ${timestamp}:\n`;
  text += `  Direction: ${signal.direction}\n`;
  text += `  Fair Probability: ${probability}\n`;
  text += `  Confidence: ${confidence}\n`;
  
  if (signal.keyDrivers.length > 0) {
    text += `  Key Drivers:\n`;
    signal.keyDrivers.forEach(driver => {
      text += `    • ${driver}\n`;
    });
  }

  if (includeMetadata && Object.keys(signal.metadata).length > 0) {
    text += `  Metadata: ${JSON.stringify(signal.metadata, null, 2)}\n`;
  }

  return text;
}

function formatTimestamp(date: Date, format: 'iso' | 'relative' | 'human'): string {
  switch (format) {
    case 'iso':
      return date.toISOString();
    case 'relative':
      return getRelativeTime(date);
    case 'human':
      return date.toLocaleString('en-US', {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        timeZone: 'UTC',
        timeZoneName: 'short',
      });
  }
}

function formatPercentage(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

function getRelativeTime(date: Date): string {
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
  const diffDays = Math.floor(diffHours / 24);

  if (diffHours < 1) return 'less than 1 hour ago';
  if (diffHours < 24) return `${diffHours} hour${diffHours > 1 ? 's' : ''} ago`;
  if (diffDays < 7) return `${diffDays} day${diffDays > 1 ? 's' : ''} ago`;
  return date.toLocaleDateString('en-US');
}
```

### 3. LangGraph State Extension

**Location**: `tradewizard-agents/src/models/state.ts`

**Purpose**: Add memory context to the shared workflow state.

**State Extension**:

```typescript
export const GraphState = Annotation.Root({
  // ... existing fields ...

  /**
   * Memory context for all agents
   * Maps agent name to their historical signals for this market
   */
  memoryContext: Annotation<Map<string, AgentMemoryContext>>({
    default: () => new Map(),
  }),
});
```

### 4. Memory Retrieval Node

**Location**: `tradewizard-agents/src/nodes/memory-retrieval.ts`

**Purpose**: LangGraph node that retrieves memory context and populates state.

**Implementation**:

```typescript
import type { GraphStateType } from '../models/state.js';
import type { MemoryRetrievalService } from '../database/memory-retrieval.js';

/**
 * Create memory retrieval node
 * 
 * This node runs after market ingestion and before agent execution.
 * It retrieves historical signals for all agents and populates the memoryContext state.
 */
export function createMemoryRetrievalNode(
  memoryService: MemoryRetrievalService,
  agentNames: string[]
): (state: GraphStateType) => Promise<Partial<GraphStateType>> {
  return async (state: GraphStateType): Promise<Partial<GraphStateType>> => {
    const startTime = Date.now();

    // Extract market ID from state
    const marketId = state.conditionId;

    if (!marketId) {
      console.warn('[MemoryRetrieval] No market ID in state, skipping memory retrieval');
      return {
        auditLog: [
          {
            stage: 'memory_retrieval',
            timestamp: Date.now(),
            data: {
              success: false,
              reason: 'No market ID',
              duration: Date.now() - startTime,
            },
          },
        ],
      };
    }

    try {
      // Retrieve memory context for all agents with timeout
      const memoryPromise = memoryService.getAllAgentMemories(marketId, agentNames, 3);
      const timeoutPromise = new Promise<Map<string, AgentMemoryContext>>((_, reject) =>
        setTimeout(() => reject(new Error('Memory retrieval timeout')), 5000)
      );

      const memoryContext = await Promise.race([memoryPromise, timeoutPromise]);

      // Count agents with historical signals
      const agentsWithHistory = Array.from(memoryContext.values()).filter(
        ctx => ctx.hasHistory
      ).length;

      return {
        memoryContext,
        auditLog: [
          {
            stage: 'memory_retrieval',
            timestamp: Date.now(),
            data: {
              success: true,
              marketId,
              totalAgents: agentNames.length,
              agentsWithHistory,
              duration: Date.now() - startTime,
            },
          },
        ],
      };
    } catch (error) {
      // Log error but don't fail the workflow
      console.error('[MemoryRetrieval] Failed to retrieve memory context:', error);

      return {
        memoryContext: new Map(), // Empty map allows agents to continue
        auditLog: [
          {
            stage: 'memory_retrieval',
            timestamp: Date.now(),
            data: {
              success: false,
              error: error instanceof Error ? error.message : String(error),
              duration: Date.now() - startTime,
            },
          },
        ],
      };
    }
  };
}
```

### 5. Agent Node Enhancement

**Location**: `tradewizard-agents/src/nodes/agents.ts`

**Purpose**: Modify agent node factory to inject memory context into agent prompts.

**Enhanced Agent Node Factory**:

```typescript
import { formatMemoryContext } from '../utils/memory-formatter.js';

/**
 * Enhanced agent node factory with memory context support
 */
export function createAgentNode(
  agentName: string,
  llm: LLMInstance,
  systemPrompt: string
): (state: GraphStateType) => Promise<Partial<GraphStateType>> {
  return async (state: GraphStateType): Promise<Partial<GraphStateType>> => {
    const startTime = Date.now();

    // Check if MBD is available
    if (!state.mbd) {
      // ... existing error handling ...
    }

    // Retrieve memory context for this agent
    const memoryContext = state.memoryContext?.get(agentName);
    const formattedMemory = memoryContext
      ? formatMemoryContext(memoryContext, { maxLength: 1000 })
      : { text: 'No previous analysis available for this market.', signalCount: 0, truncated: false };

    // Prepare the market context for the agent
    const marketContext = JSON.stringify(state.mbd, null, 2);
    
    // Enhanced prompt with memory context
    const enhancedSystemPrompt = `${systemPrompt}

## Your Previous Analysis

${formattedMemory.text}

## Instructions for Using Memory Context

When you have previous analysis available:
1. Review your previous analysis before generating new analysis
2. Identify what has changed since your last analysis (market conditions, probabilities, key drivers)
3. If your view has changed significantly, explain the reasoning for the change in your key drivers
4. If your view remains consistent, acknowledge the continuity and reinforce your reasoning
5. Reference specific changes from previous analysis when relevant

Your analysis should show thoughtful evolution over time, not random fluctuation.`;

    const messages = [
      { role: 'system', content: enhancedSystemPrompt },
      {
        role: 'user',
        content: `Analyze the following prediction market and provide your signal:\n\n${marketContext}`,
      },
    ];

    // ... rest of existing agent execution logic ...
    // (LLM invocation, validation, error handling remain unchanged)
  };
}
```

### 6. Evolution Tracking Service

**Location**: `tradewizard-agents/src/utils/evolution-tracker.ts`

**Purpose**: Compare new signals to historical signals and log significant changes.

**Interface**:

```typescript
/**
 * Signal evolution event types
 */
export type EvolutionEventType =
  | 'direction_change'
  | 'probability_shift'
  | 'confidence_change'
  | 'reasoning_evolution';

/**
 * Signal evolution event
 */
export interface EvolutionEvent {
  type: EvolutionEventType;
  agentName: string;
  marketId: string;
  timestamp: number;
  previousValue: unknown;
  currentValue: unknown;
  magnitude: number; // Quantified change magnitude
  description: string;
}

/**
 * Evolution tracking service
 */
export interface EvolutionTracker {
  /**
   * Compare new signal to most recent historical signal
   * @param newSignal - Newly generated agent signal
   * @param historicalSignals - Historical signals for this agent-market combination
   * @returns Array of evolution events detected
   */
  trackEvolution(
    newSignal: AgentSignal,
    historicalSignals: HistoricalSignal[]
  ): EvolutionEvent[];
}
```

**Implementation**:

```typescript
export class EvolutionTrackerImpl implements EvolutionTracker {
  trackEvolution(
    newSignal: AgentSignal,
    historicalSignals: HistoricalSignal[]
  ): EvolutionEvent[] {
    if (historicalSignals.length === 0) {
      return []; // No history to compare against
    }

    // Compare against most recent signal
    const mostRecent = historicalSignals[0]; // Assuming sorted desc by timestamp
    const events: EvolutionEvent[] = [];

    // Check for direction change
    if (newSignal.direction !== mostRecent.direction) {
      events.push({
        type: 'direction_change',
        agentName: newSignal.agentName,
        marketId: String(newSignal.timestamp), // Use appropriate market ID
        timestamp: newSignal.timestamp,
        previousValue: mostRecent.direction,
        currentValue: newSignal.direction,
        magnitude: 1.0, // Binary change
        description: `Direction changed from ${mostRecent.direction} to ${newSignal.direction}`,
      });
    }

    // Check for probability shift (>10%)
    const probDiff = Math.abs(newSignal.fairProbability - mostRecent.fairProbability);
    if (probDiff > 0.1) {
      events.push({
        type: 'probability_shift',
        agentName: newSignal.agentName,
        marketId: String(newSignal.timestamp),
        timestamp: newSignal.timestamp,
        previousValue: mostRecent.fairProbability,
        currentValue: newSignal.fairProbability,
        magnitude: probDiff,
        description: `Fair probability shifted by ${(probDiff * 100).toFixed(1)}%`,
      });
    }

    // Check for confidence change (>0.2)
    const confDiff = Math.abs(newSignal.confidence - mostRecent.confidence);
    if (confDiff > 0.2) {
      events.push({
        type: 'confidence_change',
        agentName: newSignal.agentName,
        marketId: String(newSignal.timestamp),
        timestamp: newSignal.timestamp,
        previousValue: mostRecent.confidence,
        currentValue: newSignal.confidence,
        magnitude: confDiff,
        description: `Confidence changed by ${(confDiff * 100).toFixed(1)}%`,
      });
    }

    // Check for reasoning evolution (key drivers changed significantly)
    const reasoningChanged = this.detectReasoningChange(
      newSignal.keyDrivers,
      mostRecent.keyDrivers
    );
    if (reasoningChanged) {
      events.push({
        type: 'reasoning_evolution',
        agentName: newSignal.agentName,
        marketId: String(newSignal.timestamp),
        timestamp: newSignal.timestamp,
        previousValue: mostRecent.keyDrivers,
        currentValue: newSignal.keyDrivers,
        magnitude: 0.5, // Qualitative change
        description: 'Key drivers have evolved significantly',
      });
    }

    return events;
  }

  private detectReasoningChange(
    currentDrivers: string[],
    previousDrivers: string[]
  ): boolean {
    // Simple heuristic: if less than 50% overlap, reasoning has changed
    const currentSet = new Set(currentDrivers.map(d => d.toLowerCase()));
    const previousSet = new Set(previousDrivers.map(d => d.toLowerCase()));

    const intersection = new Set(
      [...currentSet].filter(d => previousSet.has(d))
    );

    const overlapRatio = intersection.size / Math.max(currentSet.size, previousSet.size);
    return overlapRatio < 0.5;
  }
}
```

## Data Models

### Database Schema (No Changes Required)

The existing `agent_signals` table already contains all necessary fields:

```sql
CREATE TABLE IF NOT EXISTS agent_signals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  market_id UUID REFERENCES markets(id) ON DELETE CASCADE,
  recommendation_id UUID REFERENCES recommendations(id) ON DELETE CASCADE,
  agent_name TEXT NOT NULL,
  agent_type TEXT NOT NULL,
  fair_probability DECIMAL(5,4),
  confidence DECIMAL(3,2),
  direction TEXT NOT NULL,
  key_drivers JSONB,
  metadata JSONB,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Existing indexes support efficient memory retrieval
CREATE INDEX IF NOT EXISTS idx_agent_signals_market_id ON agent_signals(market_id);
CREATE INDEX IF NOT EXISTS idx_agent_signals_agent_name ON agent_signals(agent_name);
```

### TypeScript Types

```typescript
// New types for memory system (added to src/models/types.ts)

/**
 * Historical agent signal retrieved from database
 */
export interface HistoricalSignal {
  agentName: string;
  marketId: string;
  timestamp: Date;
  direction: 'YES' | 'NO' | 'NEUTRAL';
  fairProbability: number;
  confidence: number;
  keyDrivers: string[];
  metadata: Record<string, unknown>;
}

/**
 * Memory context for a specific agent
 */
export interface AgentMemoryContext {
  agentName: string;
  marketId: string;
  historicalSignals: HistoricalSignal[];
  hasHistory: boolean;
}

/**
 * Signal evolution event
 */
export interface EvolutionEvent {
  type: 'direction_change' | 'probability_shift' | 'confidence_change' | 'reasoning_evolution';
  agentName: string;
  marketId: string;
  timestamp: number;
  previousValue: unknown;
  currentValue: unknown;
  magnitude: number;
  description: string;
}
```


## Correctness Properties

*A property is a characteristic or behavior that should hold true across all valid executions of a system-essentially, a formal statement about what the system should do. Properties serve as the bridge between human-readable specifications and machine-verifiable correctness guarantees.*

### Property 1: Memory Retrieval Correctness

*For any* agent-market combination with historical signals in the database, retrieving memory context should return the correct signals filtered by agent name and market ID, ordered by timestamp descending, limited to at most 5 signals, and including all required fields (agent_name, market_id, direction, fair_probability, confidence, key_drivers, metadata, created_at).

**Validates: Requirements 1.1, 1.2, 1.3, 1.5, 4.3**

### Property 2: Empty Memory Context Handling

*For any* agent-market combination with no historical signals, retrieving memory context should return an empty result set without throwing errors, and the system should continue normal operation.

**Validates: Requirements 1.4, 6.3, 9.1**

### Property 3: Memory Formatting Correctness

*For any* set of historical signals, formatting them as memory context should produce a string that: (1) presents each signal as a distinct entry with clear separation, (2) formats timestamps as human-readable dates, (3) displays probabilities and confidence as percentages, (4) presents key drivers as a bulleted list, and (5) maintains chronological order (oldest to most recent).

**Validates: Requirements 2.2, 2.3, 2.5, 7.1, 7.2, 7.3, 7.4**

### Property 4: Memory Context Truncation

*For any* set of historical signals that when formatted exceeds 1000 characters, the formatted output should truncate older signals and include a truncation indicator, while ensuring the output does not exceed the maximum length.

**Validates: Requirements 7.5**

### Property 5: State Integration

*For any* workflow execution, the memoryContext field should be present in the LangGraph state, populated with agent-specific historical data after memory retrieval, and preserved in the audit log upon workflow completion.

**Validates: Requirements 5.1, 5.2, 5.4**

### Property 6: Agent Memory Isolation

*For any* set of agents executing concurrently for the same market, each agent should receive only its own historical signals in its memory context, with no cross-contamination between agents.

**Validates: Requirements 5.5**

### Property 7: Signal Storage Compatibility

*For any* new agent signal stored after enabling the memory system, the signal format should match the existing agent_signals table schema, ensuring backward compatibility with existing queries and indexes.

**Validates: Requirements 6.2**

### Property 8: Evolution Event Detection

*For any* new agent signal compared to the most recent historical signal for the same agent-market combination, the system should detect and log evolution events when: (1) direction changes, (2) fair probability changes by more than 10%, (3) confidence changes by more than 0.2, or (4) key drivers change significantly (less than 50% overlap).

**Validates: Requirements 8.1, 8.2, 8.3, 8.4, 8.5**

### Property 9: Signal Validation

*For any* historical signal retrieved from the database, the system should validate that it contains all required fields (agent_name, market_id, direction, fair_probability, confidence), that fair_probability and confidence are in the range [0, 1], and that direction is one of ['YES', 'NO', 'NEUTRAL'], excluding any signals that fail validation from the memory context.

**Validates: Requirements 10.1, 10.2, 10.3, 10.4, 10.5**

### Property 10: Error Resilience

*For any* database error, timeout, rate limit, or data corruption during memory retrieval, the system should handle the error gracefully by logging it, implementing appropriate retry logic (exponential backoff up to 3 times for rate limits, 5-second timeout for queries), and continuing agent execution with empty memory context rather than failing the entire workflow.

**Validates: Requirements 9.1, 9.2, 9.3, 9.4, 9.5**

### Property 11: Agent Context Integration

*For any* agent node execution with available memory context, the agent's system prompt should include the formatted memory context and instructions for using historical analysis.

**Validates: Requirements 2.1**

### Property 12: Comparison Execution

*For any* agent that produces a new signal, the evolution tracker should compare it to the most recent historical signal for that agent-market combination.

**Validates: Requirements 8.1**

## Error Handling

### Error Categories

The memory system handles four categories of errors:

1. **Database Connection Errors**: Network failures, authentication issues, connection timeouts
2. **Query Errors**: Invalid queries, constraint violations, permission errors
3. **Data Validation Errors**: Corrupted data, missing fields, invalid values
4. **Timeout Errors**: Queries that exceed the 5-second timeout threshold

### Error Handling Strategy

**Graceful Degradation**: All memory system errors result in graceful degradation rather than workflow failure. When memory retrieval fails, agents continue execution with empty memory context.

**Retry Logic**:
- Rate limit errors: Exponential backoff with 3 retry attempts
- Transient connection errors: Single retry after 1-second delay
- Timeout errors: No retry (abort after 5 seconds)
- Data validation errors: No retry (skip invalid signals)

**Error Logging**:
All errors are logged with full context:
```typescript
{
  stage: 'memory_retrieval',
  timestamp: number,
  data: {
    success: false,
    error: string,
    errorType: 'connection' | 'query' | 'validation' | 'timeout',
    agentName?: string,
    marketId?: string,
    retryAttempt?: number,
    duration: number
  }
}
```

**Fallback Behavior**:
- Memory retrieval failure → Empty memory context
- Partial data corruption → Use valid signals, skip invalid ones
- Formatting errors → Return "No previous analysis available"
- Evolution tracking failure → Skip evolution logging, continue workflow

### Error Recovery

The system implements several recovery mechanisms:

1. **Connection Pooling**: Supabase client manager maintains connection pool for resilience
2. **Query Timeout**: 5-second timeout prevents hanging on slow queries
3. **Validation Filtering**: Invalid signals are filtered out rather than causing failures
4. **Audit Trail**: All errors are logged for debugging and monitoring

## Testing Strategy

### Dual Testing Approach

The memory system requires both unit tests and property-based tests for comprehensive coverage:

**Unit Tests**: Focus on specific examples, edge cases, and integration points
- Empty memory context formatting
- Single signal retrieval
- Database connection mocking
- State integration with LangGraph
- Specific error scenarios (connection failure, timeout, validation error)

**Property-Based Tests**: Verify universal properties across all inputs using fast-check
- Memory retrieval correctness across random agent-market combinations
- Formatting correctness for arbitrary signal sets
- Validation logic for all possible invalid inputs
- Evolution detection for all types of signal changes
- Error handling for all error categories

### Property Test Configuration

All property tests should:
- Run minimum 100 iterations (due to randomization)
- Use fast-check library for TypeScript
- Tag tests with feature name and property number
- Reference the design document property

**Example Property Test**:

```typescript
import fc from 'fast-check';
import { describe, it, expect } from 'vitest';

describe('Memory Retrieval', () => {
  it('Property 1: Memory Retrieval Correctness', async () => {
    // Feature: agent-memory-system, Property 1: Memory retrieval correctness
    await fc.assert(
      fc.asyncProperty(
        fc.string(), // agentName
        fc.string(), // marketId
        fc.array(fc.record({
          agent_name: fc.string(),
          market_id: fc.string(),
          direction: fc.constantFrom('YES', 'NO', 'NEUTRAL'),
          fair_probability: fc.float({ min: 0, max: 1 }),
          confidence: fc.float({ min: 0, max: 1 }),
          key_drivers: fc.array(fc.string()),
          metadata: fc.object(),
          created_at: fc.date(),
        }), { minLength: 1, maxLength: 10 }),
        async (agentName, marketId, signals) => {
          // Store signals in test database
          await storeTestSignals(signals);
          
          // Retrieve memory context
          const memory = await memoryService.getAgentMemory(agentName, marketId);
          
          // Verify correctness
          expect(memory.historicalSignals.length).toBeLessThanOrEqual(5);
          expect(memory.historicalSignals).toEqual(
            expect.arrayContaining([
              expect.objectContaining({
                agentName,
                marketId,
                direction: expect.stringMatching(/^(YES|NO|NEUTRAL)$/),
                fairProbability: expect.any(Number),
                confidence: expect.any(Number),
              })
            ])
          );
          
          // Verify ordering (descending by timestamp)
          for (let i = 1; i < memory.historicalSignals.length; i++) {
            expect(memory.historicalSignals[i-1].timestamp.getTime())
              .toBeGreaterThanOrEqual(memory.historicalSignals[i].timestamp.getTime());
          }
        }
      ),
      { numRuns: 100 }
    );
  });
});
```

### Integration Tests

Integration tests verify the memory system works correctly within the full LangGraph workflow:

1. **End-to-End Memory Flow**: Test complete workflow with memory retrieval, agent execution, and signal storage
2. **Concurrent Agent Execution**: Verify memory isolation when multiple agents run in parallel
3. **Evolution Tracking**: Test that evolution events are logged correctly across multiple analysis runs
4. **Error Recovery**: Simulate database failures and verify graceful degradation

### Test Data Management

**Test Database**: Use separate Supabase project or local PostgreSQL for testing
**Data Fixtures**: Create reusable fixtures for common scenarios (empty history, single signal, multiple signals, invalid data)
**Cleanup**: Ensure tests clean up after themselves to prevent test pollution

## Performance Considerations

### Query Optimization

**Index Usage**: Memory retrieval queries leverage existing indexes:
- `idx_agent_signals_market_id`: Filters by market_id
- `idx_agent_signals_agent_name`: Filters by agent_name
- Combined index usage enables efficient lookups

**Query Limits**: Hard limit of 5 signals per agent-market combination prevents unbounded result sets

**Query Timeout**: 5-second timeout prevents slow queries from blocking workflow

### Memory Overhead

**State Size**: Memory context adds minimal overhead to LangGraph state:
- Average: ~2-5 KB per agent (3 signals × ~500 bytes each)
- Maximum: ~12.5 KB per agent (5 signals × ~2.5 KB each)
- Total for 4 agents: ~10-50 KB

**Formatting Cost**: Memory formatting is O(n) where n is number of signals (max 5), negligible overhead

### Latency Impact

**Target**: Memory retrieval should add <100ms to workflow execution time

**Breakdown**:
- Database query: 20-50ms (with indexes)
- Data transformation: 5-10ms
- Formatting: 5-10ms
- State population: <5ms
- **Total**: 35-75ms (well under 100ms target)

**Parallel Retrieval**: Fetching memory for all agents in parallel (using `Promise.all`) minimizes latency impact

### Scalability

**Database Load**: Memory retrieval adds one query per agent per workflow execution
- 4 agents × 1 query = 4 additional queries per analysis
- With 100 analyses/hour: 400 queries/hour (negligible for Supabase)

**Storage Growth**: Agent signals table grows linearly with analysis frequency
- 4 signals per analysis × 100 analyses/day = 400 rows/day
- 146,000 rows/year (manageable for PostgreSQL)

**Retention Policy**: Consider implementing data retention policy to archive old signals after 90-180 days

## Deployment Considerations

### Feature Flag

Implement feature flag for gradual rollout:

```typescript
// config/index.ts
export interface EngineConfig {
  // ... existing config ...
  
  memorySystem: {
    enabled: boolean; // Feature flag
    maxSignalsPerAgent: number; // Default: 3
    queryTimeoutMs: number; // Default: 5000
    retryAttempts: number; // Default: 3
  };
}
```

### Rollout Strategy

1. **Phase 1**: Deploy with feature flag disabled, monitor for regressions
2. **Phase 2**: Enable for 10% of markets, monitor performance and error rates
3. **Phase 3**: Enable for 50% of markets, validate memory context quality
4. **Phase 4**: Enable for 100% of markets, full production rollout

### Monitoring

**Key Metrics**:
- Memory retrieval latency (p50, p95, p99)
- Memory retrieval error rate
- Memory context size distribution
- Evolution event frequency by type
- Agent analysis quality (subjective, requires manual review)

**Alerts**:
- Memory retrieval latency > 200ms (p95)
- Memory retrieval error rate > 5%
- Database connection failures

### Rollback Plan

If issues arise:
1. Disable feature flag via environment variable (no code deployment required)
2. Agents continue functioning with empty memory context
3. Investigate and fix issues
4. Re-enable feature flag after validation

## Migration and Compatibility

### No Database Migration Required

The memory system uses the existing `agent_signals` table schema without modifications. No database migration is needed.

### Backward Compatibility

**Existing Agents**: All existing agent implementations continue to work without changes. Memory context is additive-agents that don't use it simply ignore it.

**Existing Queries**: All existing database queries and indexes remain functional. The memory system adds new queries but doesn't modify existing ones.

**Existing Data**: All historical agent signals are immediately usable by the memory system. No data migration or transformation is required.

### Forward Compatibility

**Future Enhancements**: The memory system design supports future enhancements:
- Configurable memory window (e.g., last 7 days vs. last 3 signals)
- Memory summarization for long histories
- Cross-agent memory (agents referencing other agents' historical signals)
- Memory-based agent learning (agents improving over time based on accuracy)

## Security Considerations

### Data Access Control

**Row-Level Security**: Leverage Supabase RLS policies to ensure agents can only access signals for markets they're authorized to analyze.

**API Key Protection**: Supabase API keys are stored in environment variables, never in code.

### Data Privacy

**No PII**: Agent signals contain no personally identifiable information. All data is market analysis metadata.

**Data Retention**: Consider implementing retention policy to automatically delete signals older than 180 days.

### Audit Trail

**Complete Logging**: All memory retrieval operations are logged in the audit trail, including:
- Which agent accessed which memory
- When memory was accessed
- Whether retrieval succeeded or failed
- Any errors encountered

This provides full traceability for debugging and compliance.
