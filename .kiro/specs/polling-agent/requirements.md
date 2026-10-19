# Requirements Document: Polling Agent

## Introduction

The Polling Agent is a specialized intelligence agent for the TradeWizard multi-agent system that analyzes prediction markets through the lens of real-time market-based polling. Unlike traditional polling that captures periodic snapshots of public opinion, this agent treats Polymarket's continuous price discovery mechanism as a live polling system where market prices represent financially-incentivized collective beliefs. The agent interprets price movements as sentiment shifts, compares market-implied probabilities with historical polling accuracy, and identifies signals of crowd wisdom versus noise.

## Glossary

- **Polling_Agent**: The specialized AI agent that analyzes market prices as real-time polling data
- **Market_Price**: The current probability implied by Polymarket's order book (0-1 scale)
- **Price_Movement**: Change in market price over a specified time period
- **Sentiment_Shift**: Directional change in collective market opinion inferred from price movements
- **Crowd_Wisdom_Signal**: Market consensus that demonstrates characteristics of accurate collective intelligence
- **Polling_Baseline**: Historical accuracy benchmark for traditional polling in similar event types
- **Volume_Weighted_Sentiment**: Sentiment analysis that weights price changes by trading volume
- **Market_Momentum**: Sustained directional price movement indicating strengthening consensus
- **Noise_Indicator**: Market behavior suggesting random fluctuation rather than information-driven movement
- **Cross_Market_Sentiment**: Sentiment analysis derived from related markets within the same event or series
- **Event_Context**: Information about the parent event containing multiple related markets
- **Series_Pattern**: Consistent sentiment direction observed across markets in a series
- **AgentSignal**: Structured output format conforming to the TradeWizard agent protocol
- **Market_Briefing_Document**: Input data structure containing market context and metrics (MBD)
- **LLM_Instance**: Language model instance used for analysis (OpenAI, Anthropic, or Google)
- **Multi_Agent_Workflow**: LangGraph-based parallel execution system for all intelligence agents

## Requirements

### Requirement 1: Agent Integration

**User Story:** As a system architect, I want the Polling Agent to integrate seamlessly with the existing multi-agent workflow, so that polling-based insights are available alongside other agent signals.

#### Acceptance Criteria

1. THE Polling_Agent SHALL conform to the AgentSignal output schema defined in schemas.ts
2. WHEN the Multi_Agent_Workflow executes, THE Polling_Agent SHALL run in parallel with existing agents
3. THE Polling_Agent SHALL accept a Market_Briefing_Document as input
4. WHEN the Market_Briefing_Document is unavailable, THE Polling_Agent SHALL return an error signal with type EXECUTION_FAILED
5. THE Polling_Agent SHALL use an LLM_Instance configured through the engine configuration system
6. THE Polling_Agent SHALL log execution metrics to the audit trail including duration and success status

### Requirement 2: Market-as-Poll Analysis

**User Story:** As a trader, I want the agent to interpret market prices as real-time polling data, so that I can understand what the crowd believes about event outcomes.

#### Acceptance Criteria

1. WHEN analyzing a market, THE Polling_Agent SHALL treat the Market_Price as the current polling result
2. THE Polling_Agent SHALL calculate Price_Movement over multiple time horizons (1 hour, 24 hours, 7 days)
3. WHEN Price_Movement exceeds 5% in any time horizon, THE Polling_Agent SHALL identify it as a Sentiment_Shift
4. THE Polling_Agent SHALL compute Volume_Weighted_Sentiment by combining price changes with volume24h data
5. WHEN volume24h is below the market's 30-day average, THE Polling_Agent SHALL flag low-conviction sentiment
6. THE Polling_Agent SHALL include sentiment analysis in the keyDrivers field of the AgentSignal

### Requirement 3: Crowd Wisdom Detection

**User Story:** As an analyst, I want to distinguish between genuine crowd wisdom and market noise, so that I can identify when market consensus is reliable.

#### Acceptance Criteria

1. WHEN liquidityScore is above 7 AND volume24h is above median, THE Polling_Agent SHALL classify the market as exhibiting Crowd_Wisdom_Signal
2. WHEN bidAskSpread is below 2 cents AND volatilityRegime is low, THE Polling_Agent SHALL increase confidence in crowd wisdom
3. WHEN Price_Movement shows consistent direction across multiple time horizons, THE Polling_Agent SHALL identify Market_Momentum
4. IF volatilityRegime is high AND volume24h is below average, THEN THE Polling_Agent SHALL flag Noise_Indicator
5. THE Polling_Agent SHALL include crowd wisdom assessment in the metadata field with a crowdWisdomScore (0-1)
6. THE Polling_Agent SHALL document noise indicators in the riskFactors field

### Requirement 4: Polling Baseline Comparison

**User Story:** As a trader, I want to compare market-implied probabilities with traditional polling accuracy, so that I can assess whether the market is over or under-confident.

#### Acceptance Criteria

1. THE Polling_Agent SHALL maintain Polling_Baseline accuracy rates for each eventType (election, policy, court, geopolitical, economic)
2. WHEN analyzing an election market, THE Polling_Agent SHALL compare Market_Price to historical polling accuracy for elections
3. WHEN Market_Price deviates more than 10% from Polling_Baseline, THE Polling_Agent SHALL flag the divergence in keyDrivers
4. THE Polling_Agent SHALL adjust fairProbability estimate based on historical polling performance for the eventType
5. THE Polling_Agent SHALL include polling baseline comparison in metadata with fields pollingBaseline and marketDeviation
6. IF Polling_Baseline data is unavailable for an eventType, THEN THE Polling_Agent SHALL use a neutral baseline of 0.5

### Requirement 5: Sentiment Shift Detection

**User Story:** As a trader, I want to be alerted to significant sentiment shifts in real-time, so that I can react to changing market consensus before prices fully adjust.

#### Acceptance Criteria

1. WHEN Price_Movement in 1 hour exceeds 3%, THE Polling_Agent SHALL classify it as a rapid Sentiment_Shift
2. WHEN Price_Movement in 24 hours exceeds 10%, THE Polling_Agent SHALL classify it as a major Sentiment_Shift
3. THE Polling_Agent SHALL analyze the direction of Sentiment_Shift (toward YES or toward NO)
4. WHEN a Sentiment_Shift occurs with high volume, THE Polling_Agent SHALL increase confidence in the signal
5. THE Polling_Agent SHALL include sentiment shift analysis in keyDrivers with magnitude and direction
6. THE Polling_Agent SHALL adjust the direction field (YES/NO/NEUTRAL) based on sentiment shift momentum

### Requirement 6: Confidence Calibration

**User Story:** As a system operator, I want the agent's confidence scores to be well-calibrated, so that downstream consensus mechanisms can properly weight the polling signal.

#### Acceptance Criteria

1. WHEN Crowd_Wisdom_Signal is detected, THE Polling_Agent SHALL set confidence above 0.7
2. WHEN Noise_Indicator is present, THE Polling_Agent SHALL set confidence below 0.4
3. THE Polling_Agent SHALL reduce confidence by 0.1 for each ambiguityFlag in the Market_Briefing_Document metadata
4. WHEN liquidityScore is below 5, THE Polling_Agent SHALL cap confidence at 0.5
5. THE Polling_Agent SHALL include confidence calibration factors in metadata with field confidenceFactors
6. THE Polling_Agent SHALL ensure confidence value is between 0 and 1 inclusive

### Requirement 7: Fair Probability Estimation

**User Story:** As an analyst, I want the agent to provide its own probability estimate based on polling analysis, so that I can compare it with market prices to identify edge.

#### Acceptance Criteria

1. THE Polling_Agent SHALL compute fairProbability as its estimate of true outcome probability
2. WHEN Market_Momentum is detected, THE Polling_Agent SHALL adjust fairProbability in the direction of momentum
3. THE Polling_Agent SHALL incorporate Polling_Baseline accuracy into fairProbability calculation
4. WHEN Crowd_Wisdom_Signal is strong, THE Polling_Agent SHALL weight Market_Price more heavily in fairProbability
5. WHEN Noise_Indicator is present, THE Polling_Agent SHALL regress fairProbability toward the Polling_Baseline
6. THE Polling_Agent SHALL ensure fairProbability is between 0 and 1 inclusive

### Requirement 8: Risk Factor Identification

**User Story:** As a risk manager, I want the agent to identify polling-specific risks, so that I can understand limitations of market-based polling.

#### Acceptance Criteria

1. WHEN liquidityScore is below 5, THE Polling_Agent SHALL include "Low liquidity - thin polling sample" in riskFactors
2. WHEN bidAskSpread exceeds 5 cents, THE Polling_Agent SHALL include "Wide spread - polling uncertainty" in riskFactors
3. WHEN volume24h is in the bottom quartile, THE Polling_Agent SHALL include "Low volume - limited participation" in riskFactors
4. WHEN volatilityRegime is high, THE Polling_Agent SHALL include "High volatility - unstable sentiment" in riskFactors
5. IF eventType is not election, THEN THE Polling_Agent SHALL include "Limited polling baseline for this event type" in riskFactors
6. THE Polling_Agent SHALL limit riskFactors array to the 5 most significant risks

### Requirement 9: System Prompt Definition

**User Story:** As a developer, I want a well-defined system prompt for the Polling Agent, so that the LLM consistently produces high-quality polling analysis.

#### Acceptance Criteria

1. THE Polling_Agent SHALL use a system prompt that defines its role as a polling analyst
2. THE system prompt SHALL instruct the LLM to interpret market prices as real-time polling data
3. THE system prompt SHALL specify focus areas including sentiment shifts, crowd wisdom, and polling baselines
4. THE system prompt SHALL require structured output conforming to AgentSignal schema
5. THE system prompt SHALL emphasize calibration and avoiding overconfidence
6. THE system prompt SHALL be stored in the AGENT_PROMPTS constant in agents.ts

### Requirement 10: Error Handling

**User Story:** As a system operator, I want robust error handling, so that polling agent failures don't crash the entire workflow.

#### Acceptance Criteria

1. WHEN the LLM_Instance invocation fails, THE Polling_Agent SHALL return an AgentError with type EXECUTION_FAILED
2. WHEN the Market_Briefing_Document is missing required fields, THE Polling_Agent SHALL return an AgentError with type EXECUTION_FAILED
3. THE Polling_Agent SHALL log all errors to the audit trail with error message and duration
4. WHEN an error occurs, THE Polling_Agent SHALL NOT throw an exception that propagates to the workflow
5. THE Polling_Agent SHALL include error context in the audit log data field
6. WHEN the LLM returns invalid structured output, THE Polling_Agent SHALL retry once before failing

### Requirement 11: Performance Requirements

**User Story:** As a system operator, I want the polling agent to execute efficiently, so that it doesn't become a bottleneck in the multi-agent workflow.

#### Acceptance Criteria

1. THE Polling_Agent SHALL complete analysis within 30 seconds for 95% of requests
2. THE Polling_Agent SHALL log execution duration to the audit trail
3. WHEN execution exceeds 30 seconds, THE Polling_Agent SHALL continue but log a warning
4. THE Polling_Agent SHALL use structured output to minimize LLM response parsing overhead
5. THE Polling_Agent SHALL reuse the configured LLM_Instance without creating new instances
6. THE Polling_Agent SHALL perform all calculations synchronously without introducing unnecessary async operations

### Requirement 12: Cross-Market Sentiment Analysis

**User Story:** As a trader, I want the agent to analyze sentiment across related markets in the same event or series, so that I can identify broader polling trends and validate individual market signals.

#### Acceptance Criteria

1. WHEN Event_Context is available in the Market_Briefing_Document, THE Polling_Agent SHALL analyze cross-market sentiment patterns
2. THE Polling_Agent SHALL identify Series_Pattern when multiple markets in an event show consistent Price_Movement direction
3. WHEN 3 or more related markets show Sentiment_Shift in the same direction, THE Polling_Agent SHALL increase confidence in the signal
4. THE Polling_Agent SHALL compute Cross_Market_Sentiment by analyzing price movements across all markets in the event
5. WHEN Cross_Market_Sentiment contradicts the individual Market_Price, THE Polling_Agent SHALL flag the divergence in riskFactors
6. THE Polling_Agent SHALL include cross-market analysis in metadata with fields relatedMarketCount and crossMarketAlignment
7. IF Event_Context is unavailable, THEN THE Polling_Agent SHALL perform single-market analysis without cross-market features

### Requirement 13: Event-Level Polling Intelligence

**User Story:** As an analyst, I want to understand how sentiment in one market relates to sentiment in other markets within the same event, so that I can identify leading indicators and lagging markets.

#### Acceptance Criteria

1. WHEN analyzing markets within an event, THE Polling_Agent SHALL identify which markets are sentiment leaders
2. THE Polling_Agent SHALL detect when the analyzed market is lagging behind Cross_Market_Sentiment
3. WHEN the market is a sentiment leader, THE Polling_Agent SHALL increase confidence in its polling signal
4. WHEN the market is lagging, THE Polling_Agent SHALL adjust fairProbability toward Cross_Market_Sentiment
5. THE Polling_Agent SHALL include event-level insights in keyDrivers when cross-market patterns are significant
6. THE Polling_Agent SHALL limit event-level analysis to markets with volume24h above $1000 to filter noise

### Requirement 14: Testing Requirements

**User Story:** As a developer, I want comprehensive tests for the polling agent, so that I can verify correctness and prevent regressions.

#### Acceptance Criteria

1. THE Polling_Agent SHALL have unit tests covering successful analysis scenarios with and without Event_Context
2. THE Polling_Agent SHALL have unit tests covering error scenarios (missing MBD, LLM failure)
3. THE Polling_Agent SHALL have property-based tests verifying output schema compliance
4. THE Polling_Agent SHALL have property-based tests verifying confidence bounds (0-1)
5. THE Polling_Agent SHALL have property-based tests verifying fairProbability bounds (0-1)
6. THE Polling_Agent SHALL have integration tests verifying workflow integration with other agents
7. THE Polling_Agent SHALL have unit tests verifying cross-market sentiment calculation with multiple related markets
