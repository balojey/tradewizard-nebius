# Requirements Document

## Introduction

The Market Intelligence Engine is the foundational system that connects TradeWizard to real prediction markets and generates AI-powered trading recommendations. This system ingests market data from Polymarket, analyzes it through a multi-agent debate protocol, and produces explainable, probability-driven trade strategies. This is the core intelligence layer that differentiates TradeWizard from traditional prediction market platforms.

## Glossary

- **Market Intelligence Engine**: The core system that ingests market data, coordinates AI agent analysis, and generates trade recommendations
- **Polymarket**: A regulated prediction market platform providing real-money trading infrastructure
- **Market Contract**: A tradable prediction market instrument representing a binary outcome (YES/NO)
- **LangGraph**: An agentic framework for building stateful, multi-agent workflows with built-in LLM provider abstraction
- **Opik**: An open-source LLM observability and tracing platform for logging, debugging, and optimizing AI applications
- **Agent Node**: A LangGraph node representing a specialized AI component that analyzes markets from a specific perspective
- **Graph State**: The shared state object that flows through the LangGraph workflow, containing market data and agent outputs
- **Debate Protocol**: The structured LangGraph workflow by which agents analyze markets, challenge assumptions, and reach consensus
- **Trace**: An Opik log of a complete workflow execution including all LLM calls, agent outputs, and state transitions
- **Trade Recommendation**: A structured output containing position direction, entry price, expected value, and reasoning
- **Market Briefing Document (MBD)**: A standardized data structure containing all relevant market context
- **Thesis**: A structured argument for why a market outcome is likely or unlikely
- **Expected Value (EV)**: The probability-weighted return of a trade strategy
- **Fair Probability**: The agent-calculated probability of an outcome, independent of market price

## Requirements

### Requirement 1

**User Story:** As a trader, I want to connect to live Polymarket data, so that I can analyze real prediction markets with current pricing and liquidity.

#### Acceptance Criteria

1. WHEN the system initializes THEN the Market Intelligence Engine SHALL establish a connection to Polymarket's API
2. WHEN a market contract is requested THEN the system SHALL retrieve current market probability, liquidity score, bid/ask spread, and contract metadata
3. WHEN market data is unavailable or stale THEN the system SHALL detect the condition and signal an error state
4. WHEN multiple markets are queried THEN the system SHALL return results within 5 seconds per market
5. WHEN API rate limits are approached THEN the system SHALL implement backoff and retry logic

### Requirement 2

**User Story:** As a trader, I want market data structured in a standardized format, so that AI agents can consistently analyze any market.

#### Acceptance Criteria

1. WHEN market data is ingested THEN the system SHALL transform it into a Market Briefing Document with contract rules, expiry, current probability, liquidity, and volatility
2. WHEN contract resolution criteria are ambiguous THEN the system SHALL flag the ambiguity in the Market Briefing Document
3. WHEN historical price data is available THEN the system SHALL include volatility regime classification (low, medium, high)
4. WHEN the Market Briefing Document is created THEN the system SHALL validate all required fields are present and properly typed

### Requirement 3

**User Story:** As a system architect, I want specialized AI agents to analyze markets independently, so that we avoid groupthink and surface diverse perspectives.

#### Acceptance Criteria

1. WHEN a Market Briefing Document is created THEN the system SHALL dispatch it to all registered intelligence agents in parallel
2. WHEN an agent completes analysis THEN the system SHALL capture the agent's signal including confidence score, direction, fair probability, and key drivers
3. WHEN an agent fails or times out THEN the system SHALL continue processing with remaining agents and log the failure
4. WHEN all agents complete THEN the system SHALL aggregate signals into a structured collection for debate

### Requirement 4

**User Story:** As a trader, I want bull and bear agents to construct competing theses, so that I understand both sides of a trade before committing capital.

#### Acceptance Criteria

1. WHEN agent signals are aggregated THEN the system SHALL generate a bull thesis arguing for YES outcome
2. WHEN agent signals are aggregated THEN the system SHALL generate a bear thesis arguing for NO outcome
3. WHEN a thesis is constructed THEN the system SHALL include fair probability estimate, market edge calculation, core argument, catalysts, and failure conditions
4. WHEN market probability equals fair probability within 2% THEN the system SHALL flag the market as fairly priced with no edge

### Requirement 5

**User Story:** As a trader, I want agents to challenge each other's assumptions, so that weak arguments are exposed before I risk capital.

#### Acceptance Criteria

1. WHEN bull and bear theses are complete THEN the system SHALL execute a cross-examination protocol
2. WHEN a thesis makes a factual claim THEN the opposing agent SHALL verify the claim against available data
3. WHEN a thesis assumes causality THEN the opposing agent SHALL test whether correlation implies causation
4. WHEN cross-examination completes THEN the system SHALL produce a scored debate record showing which arguments survived scrutiny

### Requirement 6

**User Story:** As a trader, I want a consensus probability estimate, so that I have a single actionable view despite agent disagreement.

#### Acceptance Criteria

1. WHEN cross-examination completes THEN the system SHALL calculate a consensus probability using weighted agent signals
2. WHEN agent disagreement is high (standard deviation > 0.15) THEN the system SHALL widen the confidence band and flag uncertainty
3. WHEN consensus probability is calculated THEN the system SHALL include confidence band, disagreement index, and probability regime classification
4. WHEN consensus probability differs from market probability by less than 3% THEN the system SHALL classify the market as efficiently priced

### Requirement 7

**User Story:** As a trader, I want a clear trade recommendation with entry price, target, and stop loss, so that I can execute with confidence.

#### Acceptance Criteria

1. WHEN consensus probability is established THEN the system SHALL generate a trade recommendation if edge exceeds 5%
2. WHEN a trade recommendation is generated THEN the system SHALL include direction (LONG YES, LONG NO, or NO TRADE), entry zone, target zone, expected value, and win probability
3. WHEN expected value is negative THEN the system SHALL recommend NO TRADE regardless of edge
4. WHEN liquidity score is below 5.0 THEN the system SHALL flag the trade as high slippage risk
5. WHEN a trade recommendation is generated THEN the system SHALL include explainable reasoning referencing specific agent signals and debate outcomes

### Requirement 8

**User Story:** As a trader, I want recommendations explained in plain language, so that I understand the reasoning without being a data scientist.

#### Acceptance Criteria

1. WHEN a trade recommendation is generated THEN the system SHALL produce a natural language summary explaining the core thesis
2. WHEN key catalysts exist THEN the system SHALL list them with expected timing
3. WHEN failure conditions exist THEN the system SHALL describe scenarios that would invalidate the thesis
4. WHEN agent disagreement is significant THEN the system SHALL acknowledge the uncertainty in the explanation

### Requirement 11

**User Story:** As a system operator, I want to use LangGraph for agent orchestration with Opik for observability, so that I can leverage battle-tested multi-agent workflows, built-in LLM provider abstraction, and comprehensive tracing for debugging and optimization.

#### Acceptance Criteria

1. WHEN the system initializes THEN the Market Intelligence Engine SHALL use LangGraph to orchestrate the multi-agent debate workflow
2. WHEN agents execute THEN the system SHALL use LangGraph's state management to pass data between agent nodes
3. WHEN LLM inference is required THEN the system SHALL use LangGraph's built-in LLM integration supporting OpenAI, Anthropic, and Google Gemini
4. WHEN the debate protocol executes THEN the system SHALL define the workflow as a LangGraph StateGraph with nodes for each pipeline stage
5. WHEN debugging is needed THEN the system SHALL leverage LangGraph's built-in visualization and state inspection tools
6. WHEN the workflow executes THEN the system SHALL use Opik to trace all LLM calls, agent executions, and state transitions for observability
7. WHEN traces are logged THEN the system SHALL include LangGraph graph visualization in Opik for enhanced debugging
8. WHEN LLM costs need tracking THEN the system SHALL use Opik's automatic token usage and cost tracking via LangChain callbacks
9. WHEN LLM configuration is provided THEN the system SHALL support both multi-provider mode (different LLMs per agent) and single-provider mode (one LLM for all agents)
10. WHEN single-provider mode is configured THEN the system SHALL use the same LLM instance for all agent nodes while maintaining agent-specific system prompts

### Requirement 9

**User Story:** As a system operator, I want all agent outputs and debate steps logged, so that I can audit decisions and improve the system.

#### Acceptance Criteria

1. WHEN any agent produces output THEN the system SHALL log the output with timestamp, agent identifier, and market context
2. WHEN the debate protocol executes THEN the system SHALL log each phase transition and intermediate results
3. WHEN a trade recommendation is generated THEN the system SHALL log the complete decision chain from raw data to final output
4. WHEN system errors occur THEN the system SHALL log error details, context, and recovery actions

### Requirement 10

**User Story:** As a developer, I want the system to handle errors gracefully, so that partial failures don't crash the entire intelligence pipeline.

#### Acceptance Criteria

1. WHEN an API call fails THEN the system SHALL retry with exponential backoff up to 3 attempts
2. WHEN an agent times out THEN the system SHALL continue processing with remaining agents
3. WHEN data validation fails THEN the system SHALL log the validation error and return a structured error response
4. WHEN consensus cannot be reached THEN the system SHALL recommend NO TRADE and explain why
5. WHEN any component fails THEN the system SHALL maintain system stability and provide degraded functionality where possible
