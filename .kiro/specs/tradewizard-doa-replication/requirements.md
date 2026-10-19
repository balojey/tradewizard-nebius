# Requirements Document

## Introduction

This document specifies the requirements for replicating the TradeWizard multi-agent prediction market analysis system into the DOA (Digital Ocean Agents) directory. The goal is to create a Python-based version of TradeWizard that runs on Digital Ocean's Gradient AI Platform while preserving DOA's architectural patterns and file structure.

TradeWizard is a sophisticated multi-agent system built with LangGraph, TypeScript, and Node.js that analyzes prediction markets on Polymarket using specialized AI agents. DOA is a Python-based research agent system also using LangGraph but designed for Digital Ocean's infrastructure. This replication will bridge both systems, creating a Python implementation of TradeWizard's market intelligence capabilities within DOA's framework.

## Glossary

- **TradeWizard**: Multi-agent prediction market analysis system built with TypeScript/LangGraph
- **DOA**: Digital Ocean Agents - Python-based research agent system using LangGraph
- **LangGraph**: Framework for building multi-agent workflows with state management
- **Polymarket**: Prediction market platform for real-world events
- **Market_Intelligence_Engine**: The core workflow system that orchestrates agent analysis
- **Agent_Signal**: Output from individual intelligence agents containing analysis and recommendations
- **Thesis**: Structured argument for or against a market outcome (bull/bear)
- **Consensus_Engine**: System that aggregates agent signals into unified probability estimates
- **MBD**: Market Briefing Document - structured input containing market data for agents
- **Gradient_AI**: Digital Ocean's AI platform providing LLM capabilities
- **CLOB**: Central Limit Order Book - Polymarket's trading API
- **Supabase**: PostgreSQL database service used for persistence
- **Opik**: Observability platform for LLM tracing and monitoring
- **StateGraph**: LangGraph's state management graph for workflow orchestration
- **Send_API**: LangGraph's parallel execution mechanism for concurrent agent processing
- **Checkpointer**: LangGraph's state persistence mechanism
- **Memory_Retrieval**: System for providing agents with historical context from past analyses

## Requirements

### Requirement 1: Core Architecture Replication

**User Story:** As a developer, I want to replicate TradeWizard's multi-agent architecture in Python, so that I can run market analysis on Digital Ocean's infrastructure.

#### Acceptance Criteria

1. THE System SHALL implement a LangGraph StateGraph workflow in Python that mirrors TradeWizard's node structure
2. WHEN the workflow executes, THE System SHALL process market data through sequential stages: ingestion, memory retrieval, keyword extraction, dynamic agent selection, parallel agent execution, signal fusion, thesis construction, cross-examination, consensus engine, and recommendation generation
3. THE System SHALL maintain state using LangGraph's state management with type-safe state definitions
4. THE System SHALL use Python type hints and Pydantic models for all data structures
5. THE System SHALL organize code following DOA's file structure: agents/, tools/, main.py, prompts.py

### Requirement 2: Polymarket Integration

**User Story:** As a market analyst, I want to ingest market data from Polymarket APIs, so that I can analyze prediction markets.

#### Acceptance Criteria

1. THE System SHALL create a Polymarket client tool in tools/polymarket_client.py
2. WHEN a market condition ID is provided, THE System SHALL fetch market data including question, outcomes, prices, volume, liquidity, and metadata
3. WHEN market data is fetched, THE System SHALL fetch related event data including event title, description, tags, and related markets
4. THE System SHALL transform Polymarket API responses into Market Briefing Documents (MBD)
5. THE System SHALL handle API errors gracefully and return structured error types
6. THE System SHALL support both individual market queries and event-based queries

### Requirement 3: Multi-Agent System Implementation

**User Story:** As a system architect, I want specialized AI agents that analyze markets from different perspectives, so that I can generate comprehensive market intelligence.

#### Acceptance Criteria

1. THE System SHALL implement MVP agents: Market Microstructure, Probability Baseline, and Risk Assessment
2. THE System SHALL implement Event Intelligence agents: Breaking News and Event Impact
3. THE System SHALL implement Polling & Statistical agents: Polling Intelligence and Historical Pattern
4. THE System SHALL implement Sentiment & Narrative agents: Media Sentiment, Social Sentiment, and Narrative Velocity
5. THE System SHALL implement Price Action agents: Momentum and Mean Reversion
6. THE System SHALL implement Event Scenario agents: Catalyst and Tail Risk
7. WHEN agents execute, THE System SHALL use Gradient AI LLM models for analysis
8. WHEN agents complete analysis, THE System SHALL return structured Agent_Signal objects with confidence, direction, fair probability, key drivers, and risk factors
9. THE System SHALL organize agent implementations in agents/ directory following DOA patterns

### Requirement 4: Parallel Agent Execution

**User Story:** As a performance engineer, I want agents to execute in parallel, so that market analysis completes efficiently.

#### Acceptance Criteria

1. THE System SHALL use LangGraph's Send API to dispatch agents for parallel execution
2. WHEN dynamic agent selection completes, THE System SHALL create Send commands for all active agents
3. WHEN all agents complete, THE System SHALL aggregate results using state reducers
4. THE System SHALL implement an agent signal fusion node that waits for all parallel agents to complete
5. THE System SHALL maintain execution order: parallel agents → signal fusion → thesis construction

### Requirement 5: Memory System Integration

**User Story:** As an AI agent, I want access to historical analysis context, so that I can make informed decisions based on past market behavior.

#### Acceptance Criteria

1. THE System SHALL implement a memory retrieval service that queries historical agent signals
2. WHEN a market is analyzed, THE System SHALL retrieve past analyses for the same market
3. WHEN memory is retrieved, THE System SHALL provide context to each agent about previous signals and outcomes
4. THE System SHALL store agent signals and recommendations in a database for future retrieval
5. THE System SHALL implement memory retrieval as a workflow node that executes after market ingestion

### Requirement 6: Database Persistence

**User Story:** As a data engineer, I want to persist analysis results to a database, so that I can track market intelligence over time.

#### Acceptance Criteria

1. THE System SHALL integrate with Supabase PostgreSQL for data persistence
2. WHEN analysis completes, THE System SHALL store market data, agent signals, and recommendations
3. THE System SHALL create database tables for: markets, agent_signals, recommendations, and analysis_history
4. THE System SHALL implement a persistence layer in database/ directory
5. THE System SHALL support both Supabase and local PostgreSQL connections

### Requirement 7: CLI Interface

**User Story:** As a user, I want a command-line interface to analyze markets, so that I can easily run market analysis.

#### Acceptance Criteria

1. THE System SHALL implement a CLI command: analyze <condition_id>
2. WHEN the analyze command runs, THE System SHALL execute the full workflow and display results
3. THE System SHALL implement a CLI command: history <condition_id> to query past analyses
4. THE System SHALL implement a CLI command: monitor to start continuous market monitoring
5. THE System SHALL display progress indicators during analysis execution
6. THE System SHALL format output as human-readable text with structured data

### Requirement 8: Observability Integration

**User Story:** As a system operator, I want to trace LLM calls and monitor costs, so that I can optimize system performance.

#### Acceptance Criteria

1. THE System SHALL integrate Opik for LLM observability and tracing
2. WHEN LLM calls are made, THE System SHALL automatically trace them with Opik callbacks
3. WHEN analysis completes, THE System SHALL flush Opik traces asynchronously
4. THE System SHALL track token usage and estimated costs per analysis
5. THE System SHALL support both Opik Cloud and self-hosted Opik instances

### Requirement 9: Debate Protocol Implementation

**User Story:** As a market analyst, I want bull and bear theses to be cross-examined, so that I can identify weaknesses in market arguments.

#### Acceptance Criteria

1. THE System SHALL construct bull and bear theses from agent signals
2. WHEN theses are constructed, THE System SHALL execute cross-examination tests: evidence, causality, timing, liquidity, and tail-risk
3. WHEN cross-examination completes, THE System SHALL score each thesis based on test outcomes
4. THE System SHALL generate a debate record with test results and key disagreements
5. THE System SHALL use debate results to inform consensus probability estimation

### Requirement 10: Consensus Engine

**User Story:** As a decision maker, I want a unified probability estimate from all agents, so that I can make informed trading decisions.

#### Acceptance Criteria

1. THE System SHALL aggregate agent signals into a consensus probability
2. WHEN agents disagree significantly, THE System SHALL calculate a disagreement index
3. WHEN consensus is calculated, THE System SHALL provide confidence bands around the probability
4. THE System SHALL classify probability regime as: high-confidence, moderate-confidence, or high-uncertainty
5. THE System SHALL weight agent signals based on confidence and historical accuracy

### Requirement 11: Trade Recommendation Generation

**User Story:** As a trader, I want actionable trade recommendations with clear reasoning, so that I can execute informed trades.

#### Acceptance Criteria

1. THE System SHALL generate trade recommendations with action: LONG_YES, LONG_NO, or NO_TRADE
2. WHEN a trade is recommended, THE System SHALL provide entry zone, target zone, and expected value
3. WHEN a trade is recommended, THE System SHALL provide win probability and liquidity risk assessment
4. THE System SHALL include explanation with: summary, core thesis, key catalysts, and failure scenarios
5. THE System SHALL include metadata with: consensus probability, market probability, edge, and confidence bands

### Requirement 12: Configuration Management

**User Story:** As a system administrator, I want flexible configuration options, so that I can adapt the system to different environments.

#### Acceptance Criteria

1. THE System SHALL load configuration from environment variables
2. THE System SHALL support configuration for: Gradient AI credentials, Polymarket API keys, Supabase connection, and Opik settings
3. THE System SHALL provide example configuration files: .env.example
4. THE System SHALL validate required configuration on startup
5. THE System SHALL support multiple LLM provider configurations for Gradient AI

### Requirement 13: Error Handling and Resilience

**User Story:** As a system operator, I want robust error handling, so that the system degrades gracefully under failure conditions.

#### Acceptance Criteria

1. WHEN API calls fail, THE System SHALL return structured error types with retry information
2. WHEN an agent fails, THE System SHALL log the error and continue with remaining agents
3. WHEN database operations fail, THE System SHALL fall back to in-memory state
4. WHEN LLM calls timeout, THE System SHALL return partial results with error indicators
5. THE System SHALL implement exponential backoff for retryable errors

### Requirement 14: Testing Infrastructure

**User Story:** As a developer, I want comprehensive testing capabilities, so that I can ensure system correctness.

#### Acceptance Criteria

1. THE System SHALL support unit tests for individual agents and tools
2. THE System SHALL support integration tests for workflow execution
3. THE System SHALL support property-based tests for data transformations
4. THE System SHALL provide test fixtures for Polymarket API responses
5. THE System SHALL support end-to-end tests with real market data

### Requirement 15: Documentation and Examples

**User Story:** As a new developer, I want clear documentation and examples, so that I can understand and extend the system.

#### Acceptance Criteria

1. THE System SHALL provide a README.md with setup instructions and usage examples
2. THE System SHALL document all agent types and their analysis focus
3. THE System SHALL provide example CLI commands with expected outputs
4. THE System SHALL document the workflow graph structure with diagrams
5. THE System SHALL include inline code documentation for all public functions
