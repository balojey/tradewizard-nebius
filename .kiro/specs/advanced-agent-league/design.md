# Design Document

## Overview

The Advanced Agent League expands TradeWizard's Market Intelligence Engine from 3 MVP agents to a comprehensive ecosystem of 13+ specialized agents that analyze prediction markets from every relevant angle. This transforms the system from a basic intelligence layer into a full "digital trading firm" with analysts, forecasters, strategists, and risk managers all contributing unique perspectives.

The Advanced Agent League is designed around four core principles:

1. **Specialization Over Generalization** - Each agent focuses on a specific analytical domain (events, sentiment, polling, price action, risk philosophy) to provide deep expertise
2. **Modular Extensibility** - New agents can be added without modifying the core engine, using the same LangGraph node pattern
3. **Intelligent Signal Fusion** - Agent signals are weighted dynamically based on market context, data availability, and agent performance
4. **Cost-Aware Activation** - Agents are selectively activated based on market type to optimize LLM and API costs

The system maintains backward compatibility with the existing Market Intelligence Engine while adding powerful new capabilities.

## Architecture

The Advanced Agent League integrates seamlessly into the existing LangGraph workflow by adding new parallel agent nodes. The core architecture remains unchanged-we simply expand the agent execution layer.

### High-Level Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                    EXTERNAL DATA SOURCES                         │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐         │
│  │  News APIs   │  │ Polling APIs │  │ Social APIs  │         │
│  │ (NewsAPI,    │  │ (538, RCP,   │  │ (Twitter,    │         │
│  │  Perplexity) │  │  Polymarket) │  │  Reddit)     │         │
│  └──────────────┘  └──────────────┘  └──────────────┘         │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│              DATA INTEGRATION & CACHING LAYER                    │
│  - Multi-source data fetching with rate limiting                 │
│  - Response caching with TTL                                     │
│  - Data freshness validation                                     │
│  - Fallback to cached data on source unavailability              │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│              LANGGRAPH STATE GRAPH WORKFLOW                      │
│                                                                   │
│  ┌────────────────────────────────────────────────────────┐    │
│  │ Node: Market Ingestion (existing)                      │    │
│  │ - Fetch market data from Polymarket                    │    │
│  │ - Create Market Briefing Document (MBD)                │    │
│  │ - Classify market type (election, court, policy, etc.) │    │
│  └────────────────────┬───────────────────────────────────┘    │
│                       │                                          │
│                       ▼                                          │
│  ┌────────────────────────────────────────────────────────┐    │
│  │ Node: Dynamic Agent Selection                          │    │
│  │ - Select agents based on market type                   │    │
│  │ - Check data availability for each agent               │    │
│  │ - Apply cost optimization rules                        │    │
│  └────────────────────┬───────────────────────────────────┘    │
│                       │                                          │
│                       ▼                                          │
│  ┌────────────────────────────────────────────────────────┐    │
│  │ Parallel Nodes: MVP Agents (existing)                  │    │
│  │ - Market Microstructure Agent                          │    │
│  │ - Probability Baseline Agent                           │    │
│  │ - Risk Assessment Agent                                │    │
│  └────────────────────┬───────────────────────────────────┘    │
│                       │                                          │
│  ┌────────────────────────────────────────────────────────┐    │
│  │ Parallel Nodes: Event Intelligence Agents (NEW)        │    │
│  │ - Breaking News Agent                                  │    │
│  │ - Event Impact Agent                                   │    │
│  └────────────────────┬───────────────────────────────────┘    │
│                       │                                          │
│  ┌────────────────────────────────────────────────────────┐    │
│  │ Parallel Nodes: Polling & Statistical Agents (NEW)     │    │
│  │ - Polling Intelligence Agent                           │    │
│  │ - Historical Pattern Agent                             │    │
│  └────────────────────┬───────────────────────────────────┘    │
│                       │                                          │
│  ┌────────────────────────────────────────────────────────┐    │
│  │ Parallel Nodes: Sentiment & Narrative Agents (NEW)     │    │
│  │ - Media Sentiment Agent                                │    │
│  │ - Social Sentiment Agent                               │    │
│  │ - Narrative Velocity Agent                             │    │
│  └────────────────────┬───────────────────────────────────┘    │
│                       │                                          │
│  ┌────────────────────────────────────────────────────────┐    │
│  │ Parallel Nodes: Price Action Agents (NEW)              │    │
│  │ - Momentum Agent                                       │    │
│  │ - Mean Reversion Agent                                 │    │
│  └────────────────────┬───────────────────────────────────┘    │
│                       │                                          │
│  ┌────────────────────────────────────────────────────────┐    │
│  │ Parallel Nodes: Event Scenario Agents (NEW)            │    │
│  │ - Catalyst Agent                                       │    │
│  │ - Shock & Tail-Risk Agent                              │    │
│  └────────────────────┬───────────────────────────────────┘    │
│                       │                                          │
│                       ▼                                          │
│  ┌────────────────────────────────────────────────────────┐    │
│  │ Node: Agent Signal Fusion (ENHANCED)                   │    │
│  │ - Aggregate all agent signals                          │    │
│  │ - Apply dynamic weighting based on context             │    │
│  │ - Detect signal conflicts and alignment                │    │
│  │ - Calculate fusion confidence score                    │    │
│  └────────────────────┬───────────────────────────────────┘    │
│                       │                                          │
│                       ▼                                          │
│  ┌────────────────────────────────────────────────────────┐    │
│  │ Node: Thesis Construction (existing)                   │    │
│  │ - Generate bull and bear theses from fused signals     │    │
│  └────────────────────┬───────────────────────────────────┘    │
│                       │                                          │
│                       ▼                                          │
│  ┌────────────────────────────────────────────────────────┐    │
│  │ Node: Cross-Examination (existing)                     │    │
│  └────────────────────┬───────────────────────────────────┘    │
│                       │                                          │
│                       ▼                                          │
│  ┌────────────────────────────────────────────────────────┐    │
│  │ Node: Consensus Engine (existing)                      │    │
│  └────────────────────┬───────────────────────────────────┘    │
│                       │                                          │
│                       ▼                                          │
│  ┌────────────────────────────────────────────────────────┐    │
│  │ Parallel Nodes: Risk Philosophy Agents (NEW)           │    │
│  │ - Aggressive Agent                                     │    │
│  │ - Conservative Agent                                   │    │
│  │ - Neutral Agent                                        │    │
│  └────────────────────┬───────────────────────────────────┘    │
│                       │                                          │
│                       ▼                                          │
│  ┌────────────────────────────────────────────────────────┐    │
│  │ Node: Recommendation Generation (ENHANCED)             │    │
│  │ - Generate trade recommendation                        │    │
│  │ - Include risk philosophy perspectives                 │    │
│  │ - Add advanced agent insights to explanation           │    │
│  └────────────────────┬───────────────────────────────────┘    │
│                       │                                          │
└───────────────────────┼──────────────────────────────────────────┘
                        │
                        ▼
                ┌───────────────┐
                │ Trade Output  │
                └───────────────┘
```

### Key Architectural Decisions

**1. Parallel Agent Execution with Dynamic Selection**
- All agents execute in parallel within their groups
- Dynamic selection node determines which agents to activate
- Inactive agents are skipped entirely (no LLM cost)
- Maintains existing parallel execution pattern from MVP

**2. Agent Signal Fusion as Explicit Node**
- New node between agents and thesis construction
- Centralizes signal weighting and conflict resolution
- Makes fusion logic explicit and testable
- Enables dynamic weighting based on market context

**3. External Data Integration Layer**
- Separate layer for fetching news, polling, social data
- Implements caching, rate limiting, and fallback logic
- Agents request data through this layer (not directly)
- Reduces API costs and improves reliability

**4. Risk Philosophy Agents After Consensus**
- Execute after consensus probability is established
- Provide position sizing and risk management perspectives
- Don't influence probability calculation (separation of concerns)
- Enhance recommendation with multiple risk approaches

**5. Backward Compatibility by Design**
- MVP agents remain unchanged
- New agents use same AgentSignal schema
- System works with any subset of agents
- Graceful degradation if advanced agents unavailable


## Components and Interfaces

### 1. External Data Integration Layer

**Responsibility**: Fetch, cache, and validate data from external sources for agent consumption

**Interface**:
```typescript
interface DataIntegrationLayer {
  /**
   * Fetch news articles relevant to market
   * @param market - Market context
   * @param timeWindow - Time window for news (e.g., last 24h)
   * @returns News articles with metadata
   */
  fetchNews(market: MarketBriefingDocument, timeWindow: number): Promise<NewsArticle[]>;
  
  /**
   * Fetch polling data for election markets
   * @param market - Market context
   * @returns Polling data with aggregation
   */
  fetchPollingData(market: MarketBriefingDocument): Promise<PollingData>;
  
  /**
   * Fetch social sentiment data
   * @param market - Market context
   * @param platforms - Social platforms to query
   * @returns Sentiment metrics
   */
  fetchSocialSentiment(market: MarketBriefingDocument, platforms: string[]): Promise<SocialSentiment>;
  
  /**
   * Check if data source is available
   * @param source - Data source identifier
   * @returns Availability status
   */
  checkDataAvailability(source: string): Promise<boolean>;
}
```

**Data Schemas**:
```typescript
interface NewsArticle {
  title: string;
  source: string;
  publishedAt: number; // Unix timestamp
  url: string;
  summary: string;
  sentiment: 'positive' | 'negative' | 'neutral';
  relevanceScore: number; // 0-1
}

interface PollingData {
  polls: Array<{
    pollster: string;
    date: number;
    sampleSize: number;
    yesPercentage: number;
    noPercentage: number;
    marginOfError: number;
    methodology: string;
  }>;
  aggregatedProbability: number; // Weighted average
  momentum: 'rising' | 'falling' | 'stable';
  biasAdjustment: number; // Adjustment factor for known pollster bias
}

interface SocialSentiment {
  platforms: Record<string, {
    volume: number; // Number of mentions
    sentiment: number; // -1 to 1
    viralScore: number; // 0-1, measures narrative velocity
    topKeywords: string[];
  }>;
  overallSentiment: number; // -1 to 1
  narrativeVelocity: number; // Rate of change in mentions
}
```

**Caching Strategy**:
- News: Cache for 15 minutes (news changes frequently)
- Polling: Cache for 1 hour (polls update slowly)
- Social: Cache for 5 minutes (social moves fast)
- Use Redis or in-memory cache with TTL
- Serve stale data if source unavailable (with staleness flag)

**Rate Limiting**:
- Implement token bucket algorithm per data source
- Track API usage and stay within limits
- Prioritize critical data sources when approaching limits
- Log rate limit warnings for operator visibility


### 2. Dynamic Agent Selection Node

**Responsibility**: Determine which agents to activate based on market type, data availability, and configuration

**LangGraph Implementation**:
```typescript
async function dynamicAgentSelectionNode(state: GraphStateType): Promise<Partial<GraphStateType>> {
  const { mbd, config } = state;
  
  // Start with MVP agents (always active)
  const activeAgents = ['market_microstructure', 'probability_baseline', 'risk_assessment'];
  
  // Add agents based on market type
  if (mbd.eventType === 'election') {
    activeAgents.push('polling_intelligence', 'media_sentiment', 'social_sentiment');
  } else if (mbd.eventType === 'court') {
    activeAgents.push('breaking_news', 'event_impact', 'historical_pattern');
  } else if (mbd.eventType === 'policy' || mbd.eventType === 'geopolitical') {
    activeAgents.push('breaking_news', 'event_impact', 'media_sentiment', 'catalyst');
  }
  
  // Add price action agents if sufficient history
  if (mbd.volume24h > 1000 && hasHistoricalPrices(mbd)) {
    activeAgents.push('momentum', 'mean_reversion');
  }
  
  // Always add event scenario agents
  activeAgents.push('catalyst', 'tail_risk');
  
  // Check data availability and remove agents if data unavailable
  const availableAgents = await filterByDataAvailability(activeAgents, mbd);
  
  // Apply configuration overrides
  const finalAgents = applyConfigurationFilters(availableAgents, config);
  
  return {
    activeAgents: finalAgents,
    auditLog: [{
      stage: 'agent_selection',
      timestamp: Date.now(),
      data: { marketType: mbd.eventType, selectedAgents: finalAgents }
    }]
  };
}
```

**Selection Rules**:
- **Election markets**: Activate polling, sentiment, and narrative agents
- **Court markets**: Activate event intelligence and historical pattern agents
- **Policy markets**: Activate event intelligence, sentiment, and catalyst agents
- **Economic markets**: Activate event intelligence and historical pattern agents
- **Price action agents**: Only if sufficient trading history exists
- **Risk philosophy agents**: Always activate (run after consensus)

**Cost Optimization**:
- Skip agents if their data sources are unavailable
- Skip price action agents for new markets (no history)
- Allow configuration to disable expensive agent groups
- Log cost estimates per agent activation


### 3. Event Intelligence Agents

**Breaking News Agent**

**Responsibility**: Monitor and interpret breaking news relevant to the market

**System Prompt**:
```
You are a breaking news analyst specializing in political, legal, and policy developments.
Your role is to identify market-moving news and assess its probability impact.

Given a market and recent news articles, analyze:
1. Which news articles are most relevant to the market outcome
2. Whether the news increases or decreases the probability of YES
3. The magnitude of the probability shift (small, medium, large)
4. The confidence in your assessment

Focus on factual developments, not speculation. Flag regime-changing events.
```

**Agent Signal Schema**:
```typescript
interface BreakingNewsSignal extends AgentSignal {
  metadata: {
    relevantArticles: Array<{
      title: string;
      source: string;
      relevanceScore: number;
      probabilityImpact: 'positive' | 'negative' | 'neutral';
    }>;
    regimeChange: boolean; // True if news fundamentally changes market dynamics
    newsVelocity: number; // Rate of new articles (articles per hour)
  };
}
```

**Event Impact Agent**

**Responsibility**: Model how events reprice markets based on historical patterns

**System Prompt**:
```
You are an event impact modeler specializing in prediction market reactions.
Your role is to predict how upcoming or recent events will reprice the market.

Given a market and event context, analyze:
1. Historical analogs (similar events in the past)
2. How those events repriced similar markets
3. Expected market reaction to upcoming catalysts
4. Scenario trees for different event outcomes

Provide probability estimates for each scenario branch.
```

**Agent Signal Schema**:
```typescript
interface EventImpactSignal extends AgentSignal {
  metadata: {
    historicalAnalogs: Array<{
      event: string;
      date: number;
      marketReaction: number; // Probability change
      similarity: number; // 0-1
    }>;
    scenarioTree: Array<{
      scenario: string;
      probability: number;
      marketImpact: number;
    }>;
    upcomingCatalysts: Array<{
      event: string;
      date: number;
      expectedImpact: 'high' | 'medium' | 'low';
    }>;
  };
}
```


### 4. Polling & Statistical Agents

**Polling Intelligence Agent**

**Responsibility**: Aggregate and analyze polling data with bias adjustments

**System Prompt**:
```
You are a polling analyst specializing in election forecasting and statistical modeling.
Your role is to aggregate polls, adjust for bias, and detect momentum shifts.

Given polling data for an election market, analyze:
1. Weighted average probability across all polls
2. Pollster bias adjustments (house effects)
3. Momentum trends (rising, falling, stable)
4. Sample quality and methodology concerns

Apply rigorous statistical methods. Flag outlier polls and methodology issues.
```

**Agent Signal Schema**:
```typescript
interface PollingIntelligenceSignal extends AgentSignal {
  metadata: {
    aggregatedProbability: number; // Bias-adjusted weighted average
    momentum: 'rising' | 'falling' | 'stable';
    pollCount: number;
    averageSampleSize: number;
    biasAdjustments: Record<string, number>; // Pollster -> adjustment
    outlierPolls: string[]; // Pollster names
    methodologyConcerns: string[];
  };
}
```

**Historical Pattern Agent**

**Responsibility**: Identify historical analogs and pattern overlays

**System Prompt**:
```
You are a historical pattern analyst specializing in election and political outcomes.
Your role is to find analogous past events and extract predictive patterns.

Given a market and historical context, analyze:
1. Similar past events (elections, referendums, court cases)
2. Outcome patterns and success rates
3. Key factors that determined outcomes
4. Applicability of historical patterns to current market

Focus on structural similarities, not superficial ones.
```

**Agent Signal Schema**:
```typescript
interface HistoricalPatternSignal extends AgentSignal {
  metadata: {
    analogs: Array<{
      event: string;
      date: number;
      outcome: 'YES' | 'NO';
      similarity: number; // 0-1
      keyFactors: string[];
    }>;
    patternSuccessRate: number; // Historical accuracy of pattern
    applicabilityScore: number; // How well pattern applies to current market
  };
}
```


### 5. Sentiment & Narrative Agents

**Media Sentiment Agent**

**Responsibility**: Analyze news coverage tone, framing, and agenda dominance

**System Prompt**:
```
You are a media sentiment analyst specializing in news coverage analysis.
Your role is to measure sentiment, framing, and narrative dominance in media.

Given news articles about a market, analyze:
1. Overall sentiment (positive, negative, neutral toward YES outcome)
2. Sentiment trends over time
3. Which narratives dominate coverage
4. Media framing and agenda-setting effects

Distinguish between sentiment and factual reporting.
```

**Agent Signal Schema**:
```typescript
interface MediaSentimentSignal extends AgentSignal {
  metadata: {
    overallSentiment: number; // -1 to 1
    sentimentTrend: 'improving' | 'declining' | 'stable';
    dominantNarratives: Array<{
      narrative: string;
      prevalence: number; // 0-1
      sentiment: number; // -1 to 1
    }>;
    coverageVelocity: number; // Articles per hour
    mediaConsensus: number; // 0-1, how aligned media sources are
  };
}
```

**Social Sentiment Agent**

**Responsibility**: Monitor social media discourse and crowd psychology

**System Prompt**:
```
You are a social sentiment analyst specializing in online discourse and crowd psychology.
Your role is to measure sentiment, detect viral narratives, and assess crowd positioning.

Given social media data about a market, analyze:
1. Overall sentiment across platforms
2. Viral narratives and meme momentum
3. Crowd psychology indicators (fear, greed, uncertainty)
4. Retail positioning signals

Focus on actionable signals, not noise.
```

**Agent Signal Schema**:
```typescript
interface SocialSentimentSignal extends AgentSignal {
  metadata: {
    platformSentiment: Record<string, number>; // Platform -> sentiment (-1 to 1)
    viralNarratives: Array<{
      narrative: string;
      viralScore: number; // 0-1
      sentiment: number;
    }>;
    crowdPsychology: 'fear' | 'greed' | 'uncertainty' | 'neutral';
    retailPositioning: 'bullish' | 'bearish' | 'neutral';
    mentionVelocity: number; // Mentions per hour
  };
}
```

**Narrative Velocity Agent**

**Responsibility**: Measure how fast narratives spread and predict next cycle dominance

**System Prompt**:
```
You are a narrative velocity analyst specializing in information diffusion.
Your role is to measure narrative spread rates and predict which stories will dominate.

Given media and social data, analyze:
1. Rate of narrative spread (velocity)
2. Acceleration or deceleration of narratives
3. Which narratives will dominate the next news cycle
4. Early detection of emerging narratives

Focus on predictive signals, not just current state.
```

**Agent Signal Schema**:
```typescript
interface NarrativeVelocitySignal extends AgentSignal {
  metadata: {
    narratives: Array<{
      narrative: string;
      velocity: number; // Spread rate (mentions per hour)
      acceleration: number; // Change in velocity
      peakPrediction: number; // Predicted time to peak (hours)
      dominanceProbability: number; // 0-1, will it dominate next cycle
    }>;
    emergingNarratives: string[]; // Early-stage narratives to watch
  };
}
```


### 6. Price Action & Timing Agents

**Momentum Agent**

**Responsibility**: Identify breakouts, order-flow momentum, and short-term price expansions

**System Prompt**:
```
You are a momentum trader specializing in price action and order flow.
Your role is to identify breakout patterns and momentum-driven opportunities.

Given market price history and order book data, analyze:
1. Momentum indicators (price velocity, volume acceleration)
2. Breakout patterns and continuation signals
3. Order flow imbalances
4. Short-term timing windows for entry

Focus on actionable short-term setups, not long-term fundamentals.
```

**Agent Signal Schema**:
```typescript
interface MomentumSignal extends AgentSignal {
  metadata: {
    momentumScore: number; // -1 to 1
    breakoutProbability: number; // 0-1
    orderFlowImbalance: number; // -1 to 1 (negative = selling pressure)
    timingWindow: {
      optimal: number; // Hours until optimal entry
      duration: number; // How long window stays open
    };
    priceTarget: number; // Short-term price target
  };
}
```

**Mean Reversion Agent**

**Responsibility**: Identify overextensions and fade opportunities

**System Prompt**:
```
You are a mean reversion trader specializing in overextension and crowd psychology.
Your role is to identify when markets have moved too far and are due for reversion.

Given market price history and sentiment data, analyze:
1. Overextension indicators (distance from mean, volatility)
2. Crowd overreaction signals
3. Reversion probability and timing
4. Target reversion levels

Focus on high-probability fade opportunities with defined risk.
```

**Agent Signal Schema**:
```typescript
interface MeanReversionSignal extends AgentSignal {
  metadata: {
    overextensionScore: number; // 0-1, how overextended
    reversionProbability: number; // 0-1
    reversionTarget: number; // Expected reversion price
    timingEstimate: number; // Hours until reversion
    crowdOverreaction: boolean;
  };
}
```


### 7. Event Scenario Agents

**Catalyst Agent**

**Responsibility**: Track upcoming events and model pre/post-event strategies

**System Prompt**:
```
You are a catalyst trader specializing in event-driven strategies.
Your role is to identify upcoming catalysts and model market reactions.

Given a market and upcoming events, analyze:
1. Scheduled catalysts (debates, rulings, announcements)
2. Expected market impact of each catalyst
3. Pre-event positioning strategies
4. Post-event reaction scenarios

Focus on timeline alignment and asymmetric opportunities.
```

**Agent Signal Schema**:
```typescript
interface CatalystSignal extends AgentSignal {
  metadata: {
    upcomingCatalysts: Array<{
      event: string;
      date: number;
      expectedImpact: 'high' | 'medium' | 'low';
      direction: 'bullish' | 'bearish' | 'neutral';
      preEventStrategy: string;
      postEventScenarios: Array<{
        outcome: string;
        probability: number;
        marketReaction: number;
      }>;
    }>;
    optimalEntryTiming: number; // Hours before catalyst
  };
}
```

**Shock & Tail-Risk Agent**

**Responsibility**: Identify underpriced surprise scenarios and asymmetric payoffs

**System Prompt**:
```
You are a tail-risk analyst specializing in low-probability, high-impact scenarios.
Your role is to identify underpriced surprise risks and convex opportunities.

Given a market, analyze:
1. Tail-risk scenarios the market is not pricing
2. Probability of surprise outcomes
3. Asymmetric payoff structures
4. Convex trade setups (limited downside, unlimited upside)

Focus on scenarios with positive expected value despite low probability.
```

**Agent Signal Schema**:
```typescript
interface TailRiskSignal extends AgentSignal {
  metadata: {
    tailScenarios: Array<{
      scenario: string;
      probability: number; // Low but non-zero
      marketPricing: number; // What market implies
      mispricing: number; // Difference
      payoffRatio: number; // Upside/downside
    }>;
    convexOpportunities: Array<{
      setup: string;
      maxLoss: number;
      expectedGain: number;
      probabilityOfProfit: number;
    }>;
  };
}
```


### 8. Risk Philosophy Agents

**Aggressive Agent**

**Responsibility**: Advocate for high-conviction, concentrated exposure

**System Prompt**:
```
You are an aggressive trader specializing in high-conviction, high-variance strategies.
Your role is to identify maximum EV opportunities and advocate for concentrated positions.

Given a consensus probability and market context, analyze:
1. Maximum position sizing for optimal Kelly criterion
2. High-conviction arguments for concentrated exposure
3. Scenarios where aggressive positioning is justified
4. Expected value maximization strategies

Focus on maximizing long-term returns, accepting high variance.
```

**Agent Signal Schema**:
```typescript
interface AggressiveSignal extends AgentSignal {
  metadata: {
    recommendedPositionSize: number; // Percentage of bankroll
    kellyCriterion: number; // Optimal Kelly fraction
    convictionLevel: 'extreme' | 'high' | 'moderate';
    expectedReturn: number; // Expected value per $100
    varianceWarning: string;
  };
}
```

**Conservative Agent**

**Responsibility**: Advocate for capital preservation and hedging

**System Prompt**:
```
You are a conservative trader specializing in capital preservation and risk management.
Your role is to identify downside risks and advocate for hedged, low-drawdown strategies.

Given a consensus probability and market context, analyze:
1. Downside protection strategies
2. Hedging opportunities
3. Maximum acceptable position size for capital preservation
4. Scenarios that could invalidate the thesis

Focus on minimizing drawdowns and preserving capital.
```

**Agent Signal Schema**:
```typescript
interface ConservativeSignal extends AgentSignal {
  metadata: {
    recommendedPositionSize: number; // Conservative sizing
    hedgingStrategy: string;
    maxDrawdownTolerance: number;
    stopLossLevel: number;
    capitalPreservationScore: number; // 0-1
  };
}
```

**Neutral Agent**

**Responsibility**: Advocate for market-neutral and arbitrage strategies

**System Prompt**:
```
You are a market-neutral trader specializing in arbitrage and spread strategies.
Your role is to identify market-neutral opportunities that profit regardless of outcome.

Given a consensus probability and market context, analyze:
1. Spread trade opportunities
2. Paired position strategies
3. Arbitrage setups
4. Market-neutral structures

Focus on low-risk, consistent returns with minimal directional exposure.
```

**Agent Signal Schema**:
```typescript
interface NeutralSignal extends AgentSignal {
  metadata: {
    spreadOpportunities: Array<{
      setup: string;
      expectedReturn: number;
      riskLevel: 'low' | 'medium';
    }>;
    pairedPositions: Array<{
      long: string;
      short: string;
      netExposure: number; // Should be near zero
    }>;
    arbitrageSetups: string[];
  };
}
```


### 9. Agent Signal Fusion Node

**Responsibility**: Aggregate and weight signals from all active agents

**LangGraph Implementation**:
```typescript
async function agentSignalFusionNode(state: GraphStateType): Promise<Partial<GraphStateType>> {
  const { agentSignals, mbd, activeAgents } = state;
  
  // Group signals by agent type
  const signalsByType = groupSignalsByType(agentSignals);
  
  // Apply dynamic weighting based on market context
  const weights = calculateDynamicWeights(signalsByType, mbd);
  
  // Calculate weighted consensus
  const fusedSignal = {
    fairProbability: calculateWeightedProbability(agentSignals, weights),
    confidence: calculateFusionConfidence(agentSignals, weights),
    signalAlignment: calculateSignalAlignment(agentSignals),
    conflictingSignals: identifyConflicts(agentSignals),
    contributingAgents: activeAgents,
    weights: weights
  };
  
  return {
    fusedSignal,
    auditLog: [{
      stage: 'signal_fusion',
      timestamp: Date.now(),
      data: { 
        agentCount: agentSignals.length,
        alignment: fusedSignal.signalAlignment,
        conflicts: fusedSignal.conflictingSignals.length
      }
    }]
  };
}
```

**Dynamic Weighting Strategy**:

1. **Base Weights by Agent Type**:
   - MVP agents (Market Microstructure, Probability Baseline, Risk Assessment): 1.0x
   - Event Intelligence agents: 1.2x for event-driven markets
   - Polling agents: 1.5x for election markets
   - Sentiment agents: 0.8x (sentiment is noisy)
   - Price Action agents: 1.0x for liquid markets, 0.5x for illiquid
   - Event Scenario agents: 1.0x

2. **Context Adjustments**:
   - Increase weight if agent has high confidence
   - Decrease weight if data is stale
   - Increase weight if agent's historical accuracy is high
   - Decrease weight if agent signal is an outlier

3. **Conflict Resolution**:
   - If agents strongly disagree, widen confidence bands
   - Flag conflicts in audit log
   - Surface disagreement in final recommendation

4. **Alignment Bonus**:
   - If multiple independent agents agree, increase overall confidence
   - Alignment across agent types is stronger signal than within-type alignment

**Fusion Confidence Calculation**:
```typescript
function calculateFusionConfidence(signals: AgentSignal[], weights: Record<string, number>): number {
  // Base confidence from weighted average of agent confidences
  const baseConfidence = weightedAverage(signals.map(s => s.confidence), weights);
  
  // Alignment bonus: increase confidence if agents agree
  const alignment = calculateSignalAlignment(signals);
  const alignmentBonus = alignment * 0.2; // Up to 20% bonus
  
  // Data quality penalty: decrease confidence if data is stale
  const dataQuality = assessDataQuality(signals);
  const qualityPenalty = (1 - dataQuality) * 0.3; // Up to 30% penalty
  
  return Math.max(0, Math.min(1, baseConfidence + alignmentBonus - qualityPenalty));
}
```


## Data Models

### Extended Graph State

The Advanced Agent League extends the existing GraphState with new fields:

```typescript
const AdvancedGraphState = Annotation.Root({
  // ... existing fields from base GraphState ...
  
  // Dynamic Agent Selection
  activeAgents: Annotation<string[]>({
    default: () => []
  }),
  
  // External Data
  externalData: Annotation<{
    news?: NewsArticle[];
    polling?: PollingData;
    social?: SocialSentiment;
    dataFreshness: Record<string, number>; // Source -> timestamp
  } | null>,
  
  // Agent Signal Fusion
  fusedSignal: Annotation<FusedSignal | null>,
  
  // Risk Philosophy Signals
  riskPhilosophySignals: Annotation<{
    aggressive?: AggressiveSignal;
    conservative?: ConservativeSignal;
    neutral?: NeutralSignal;
  } | null>,
  
  // Performance Tracking
  agentPerformance: Annotation<Record<string, AgentPerformanceMetrics>>({
    default: () => ({})
  })
});
```

### Agent Performance Metrics

```typescript
interface AgentPerformanceMetrics {
  agentName: string;
  totalAnalyses: number;
  averageConfidence: number;
  accuracyScore: number; // 0-1, based on resolved markets
  averageExecutionTime: number; // milliseconds
  errorRate: number; // 0-1
  lastUpdated: number; // timestamp
}
```

### Fused Signal Schema

```typescript
interface FusedSignal {
  fairProbability: number; // Weighted consensus probability
  confidence: number; // Overall fusion confidence
  signalAlignment: number; // 0-1, how much agents agree
  conflictingSignals: Array<{
    agent1: string;
    agent2: string;
    disagreement: number; // Magnitude of disagreement
  }>;
  contributingAgents: string[];
  weights: Record<string, number>; // Agent -> weight
  metadata: {
    mvpAgentCount: number;
    advancedAgentCount: number;
    dataQuality: number; // 0-1
  };
}
```


## Configuration

### Extended Engine Configuration

```typescript
interface AdvancedEngineConfig extends EngineConfig {
  // ... existing config fields ...
  
  advancedAgents: {
    // Enable/disable agent groups
    eventIntelligence: {
      enabled: boolean;
      breakingNews: boolean;
      eventImpact: boolean;
    };
    pollingStatistical: {
      enabled: boolean;
      pollingIntelligence: boolean;
      historicalPattern: boolean;
    };
    sentimentNarrative: {
      enabled: boolean;
      mediaSentiment: boolean;
      socialSentiment: boolean;
      narrativeVelocity: boolean;
    };
    priceAction: {
      enabled: boolean;
      momentum: boolean;
      meanReversion: boolean;
      minVolumeThreshold: number; // Minimum 24h volume to activate
    };
    eventScenario: {
      enabled: boolean;
      catalyst: boolean;
      tailRisk: boolean;
    };
    riskPhilosophy: {
      enabled: boolean;
      aggressive: boolean;
      conservative: boolean;
      neutral: boolean;
    };
  };
  
  externalData: {
    news: {
      provider: 'newsapi' | 'perplexity' | 'none';
      apiKey?: string;
      cacheT TL: number; // seconds
      maxArticles: number;
    };
    polling: {
      provider: '538' | 'rcp' | 'polymarket' | 'none';
      apiKey?: string;
      cacheTTL: number;
    };
    social: {
      providers: Array<'twitter' | 'reddit'>;
      apiKeys?: Record<string, string>;
      cacheTTL: number;
      maxMentions: number;
    };
  };
  
  signalFusion: {
    baseWeights: Record<string, number>; // Agent type -> base weight
    contextAdjustments: boolean; // Enable dynamic weight adjustments
    conflictThreshold: number; // Disagreement threshold to flag conflicts
    alignmentBonus: number; // Confidence bonus for agent alignment (0-1)
  };
  
  costOptimization: {
    maxCostPerAnalysis: number; // USD
    skipLowImpactAgents: boolean;
    batchLLMRequests: boolean;
  };
  
  performanceTracking: {
    enabled: boolean;
    evaluateOnResolution: boolean;
    minSampleSize: number; // Minimum analyses before adjusting weights
  };
}
```

### Example Configuration

**Budget-Conscious Configuration** (MVP agents + selective advanced agents):
```typescript
{
  advancedAgents: {
    eventIntelligence: { enabled: true, breakingNews: true, eventImpact: false },
    pollingStatistical: { enabled: true, pollingIntelligence: true, historicalPattern: false },
    sentimentNarrative: { enabled: false },
    priceAction: { enabled: false },
    eventScenario: { enabled: true, catalyst: true, tailRisk: false },
    riskPhilosophy: { enabled: true, aggressive: true, conservative: true, neutral: false }
  },
  costOptimization: {
    maxCostPerAnalysis: 0.50,
    skipLowImpactAgents: true,
    batchLLMRequests: true
  }
}
```

**Premium Configuration** (All agents enabled):
```typescript
{
  advancedAgents: {
    eventIntelligence: { enabled: true, breakingNews: true, eventImpact: true },
    pollingStatistical: { enabled: true, pollingIntelligence: true, historicalPattern: true },
    sentimentNarrative: { enabled: true, mediaSentiment: true, socialSentiment: true, narrativeVelocity: true },
    priceAction: { enabled: true, momentum: true, meanReversion: true, minVolumeThreshold: 1000 },
    eventScenario: { enabled: true, catalyst: true, tailRisk: true },
    riskPhilosophy: { enabled: true, aggressive: true, conservative: true, neutral: true }
  },
  costOptimization: {
    maxCostPerAnalysis: 2.00,
    skipLowImpactAgents: false,
    batchLLMRequests: true
  }
}
```


## Correctness Properties

*A property is a characteristic or behavior that should hold true across all valid executions of a system-essentially, a formal statement about what the system should do. Properties serve as the bridge between human-readable specifications and machine-verifiable correctness guarantees.*

### Property 1: Dynamic agent selection completeness

*For any* market with a classified event type, the dynamic agent selection node should activate at least the MVP agents plus event-type-appropriate advanced agents.

**Validates: Requirements 9.1, 9.2, 9.3, 9.4, 9.5**

### Property 2: External data caching consistency

*For any* external data source with a configured TTL, when data is fetched within the TTL window, the system should return cached data without making a new API call.

**Validates: Requirements 7.2, 13.2**

### Property 3: Agent signal fusion weight validity

*For any* set of agent signals being fused, all assigned weights should be non-negative and the sum of weights should equal 1.0.

**Validates: Requirements 8.2**

### Property 4: Signal conflict detection

*For any* pair of agent signals where the fair probability estimates differ by more than 0.20, the fusion node should flag the signals as conflicting.

**Validates: Requirements 8.3**

### Property 5: Risk philosophy signal completeness

*For any* consensus probability established, when risk philosophy agents are enabled, the system should generate signals from all enabled risk philosophy agents (aggressive, conservative, neutral).

**Validates: Requirements 6.1, 6.2, 6.3, 6.4, 6.5, 6.6, 6.7**

### Property 6: Backward compatibility with MVP agents

*For any* market analysis, when all advanced agents are disabled, the system should produce a valid recommendation using only MVP agents.

**Validates: Requirements 11.1, 11.4**

### Property 7: Agent performance tracking accuracy

*For any* resolved market where agents produced signals, the system should calculate accuracy metrics for each agent based on the actual outcome.

**Validates: Requirements 10.2, 10.3**

### Property 8: Cost optimization threshold enforcement

*For any* market analysis with a configured maximum cost, when the estimated cost exceeds the threshold, the system should skip optional agents to stay within budget.

**Validates: Requirements 13.3, 13.4**

### Property 9: External data unavailability graceful degradation

*For any* external data source that is unavailable, the system should skip dependent agents and continue analysis with remaining agents.

**Validates: Requirements 1.5, 2.6, 3.7, 7.4, 14.2**

### Property 10: Agent timeout isolation

*For any* agent that times out during execution, the system should exclude that agent's signal and continue with remaining agents without crashing.

**Validates: Requirements 14.3**

### Property 11: Polling agent bias adjustment

*For any* polling data with known pollster biases, the Polling Intelligence Agent should apply bias adjustments before calculating aggregated probability.

**Validates: Requirements 2.2**

### Property 12: Event intelligence relevance filtering

*For any* set of news articles fetched for a market, the Breaking News Agent should only include articles with relevance scores above a minimum threshold in its signal.

**Validates: Requirements 1.2**

### Property 13: Price action agent activation condition

*For any* market with insufficient trading history (volume24h below threshold), the system should skip price action agents.

**Validates: Requirements 4.5**

### Property 14: Sentiment agent platform aggregation

*For any* social sentiment data from multiple platforms, the Social Sentiment Agent should aggregate sentiment across all platforms into a single overall sentiment score.

**Validates: Requirements 3.4**

### Property 15: Agent signal schema consistency

*For any* agent signal produced by advanced agents, the signal should conform to the base AgentSignal schema with valid confidence, direction, fairProbability, and keyDrivers fields.

**Validates: Requirements 11.3**

### Property 16: Configuration validation

*For any* engine configuration loaded, when agent groups are enabled but required external data sources are not configured, the system should log validation errors and disable those agent groups.

**Validates: Requirements 12.5**

### Property 17: Audit trail completeness for advanced agents

*For any* market analysis using advanced agents, the audit log should contain entries for agent selection, external data fetching, signal fusion, and all agent executions.

**Validates: Requirements 15.1, 15.2, 15.3, 15.4, 15.5**


## Error Handling

The Advanced Agent League implements comprehensive error handling at multiple layers:

### 1. External Data Layer Error Handling

**Data Source Unavailability**:
- Attempt to use cached data if available (even if stale)
- Flag data as stale in agent signals
- Skip dependent agents if no cached data available
- Log data source failures for operator visibility

**Rate Limiting**:
- Implement token bucket algorithm per data source
- When approaching rate limit (>80%), prioritize critical sources
- When rate limit exceeded, use cached data or skip agents
- Log rate limit warnings

**Data Validation Failures**:
- Validate external data against expected schemas
- Log validation errors with full context
- Skip dependent agents if data invalid
- Do not crash pipeline

### 2. Agent Layer Error Handling

**Agent Execution Failures**:
- Wrap each agent in try-catch
- Log full error stack with agent context
- Mark agent as failed, exclude from fusion
- Continue with remaining agents

**Agent Timeouts**:
- Set timeout per agent (configurable, default: 15s)
- Use Promise.race() to enforce timeout
- Log timeout with agent name
- Continue with remaining agents

**Insufficient Active Agents**:
- If fewer than minimum agents complete (including MVP), return error
- Error type: `{type: 'INSUFFICIENT_AGENTS', activeCount, minimumRequired}`
- Recommend NO_TRADE to user

### 3. Signal Fusion Error Handling

**Extreme Signal Divergence**:
- If agent signals span full probability range (0 to 1), flag high uncertainty
- Widen confidence bands significantly
- Surface disagreement prominently in recommendation
- Consider recommending NO_TRADE if divergence too extreme

**Weight Calculation Failures**:
- If dynamic weighting fails, fall back to equal weights
- Log weighting failure
- Continue with equal-weighted fusion

### 4. Configuration Error Handling

**Invalid Configuration**:
- Validate configuration on load
- Log validation errors
- Fall back to default configuration
- Disable misconfigured agent groups

**Missing API Keys**:
- Check for required API keys on initialization
- Disable agent groups that require missing keys
- Log missing key warnings
- Continue with available agents

### 5. Cost Optimization Error Handling

**Cost Threshold Exceeded**:
- Estimate cost before activating agents
- If estimated cost > threshold, skip optional agents
- Prioritize MVP agents and high-value advanced agents
- Log cost optimization decisions

**Cost Tracking Failures**:
- If Opik cost tracking fails, continue without cost data
- Log cost tracking failure
- Do not block analysis


## Testing Strategy

The Advanced Agent League requires comprehensive testing across unit tests, integration tests, and property-based tests.

### Unit Testing Approach

**External Data Integration Tests**:
- Test news API integration with mocked responses
- Test polling API integration with sample data
- Test social API integration with mock data
- Test caching behavior (cache hits, misses, TTL expiration)
- Test rate limiting logic
- Test data validation and error handling

**Dynamic Agent Selection Tests**:
- Test agent selection for each market type (election, court, policy, etc.)
- Test data availability filtering
- Test configuration-based agent filtering
- Test cost optimization agent skipping
- Test minimum agent threshold enforcement

**Individual Agent Tests**:
- Test each new agent with sample MBD and external data
- Verify agent signal structure and content
- Test agent-specific logic (bias adjustment, sentiment aggregation, etc.)
- Test agent error handling
- Test agent timeout behavior

**Signal Fusion Tests**:
- Test weight calculation with various agent combinations
- Test conflict detection with divergent signals
- Test alignment bonus calculation
- Test data quality penalty
- Test fusion confidence calculation

**Risk Philosophy Agent Tests**:
- Test aggressive agent position sizing recommendations
- Test conservative agent hedging strategies
- Test neutral agent spread trade identification
- Test risk philosophy signal structure

### Integration Testing Approach

**End-to-End with Advanced Agents**:
- Test full workflow with all agent groups enabled
- Test workflow with selective agent groups
- Test workflow with only MVP agents (backward compatibility)
- Test workflow with various market types
- Test workflow with external data unavailability
- Test workflow with agent failures

**External Data Integration**:
- Test with real external APIs (integration test, not unit test)
- Verify data fetching, caching, and validation
- Test rate limiting behavior under load
- Test fallback to cached data

**Cost Optimization**:
- Test cost estimation accuracy
- Test agent skipping when cost threshold exceeded
- Verify Opik cost tracking integration

### Property-Based Testing Approach

Using **fast-check** for property-based testing with minimum 100 iterations per test.

**Property Test Implementation**:

1. **Property 1** - Generate random market types, verify appropriate agents selected
2. **Property 2** - Generate random data fetch sequences, verify caching behavior
3. **Property 3** - Generate random agent signal sets, verify weight validity
4. **Property 4** - Generate random signal pairs, verify conflict detection
5. **Property 5** - Generate random consensus results, verify risk philosophy completeness
6. **Property 6** - Generate random markets with MVP-only config, verify valid output
7. **Property 7** - Generate random resolved markets, verify accuracy calculation
8. **Property 8** - Generate random cost scenarios, verify threshold enforcement
9. **Property 9** - Generate random data unavailability scenarios, verify graceful degradation
10. **Property 10** - Generate random agent timeout scenarios, verify isolation
11. **Property 11** - Generate random polling data with biases, verify adjustments
12. **Property 12** - Generate random news articles, verify relevance filtering
13. **Property 13** - Generate random markets with low volume, verify price action skipping
14. **Property 14** - Generate random multi-platform sentiment, verify aggregation
15. **Property 15** - Generate random advanced agent signals, verify schema compliance
16. **Property 16** - Generate random invalid configurations, verify validation
17. **Property 17** - Generate random advanced agent executions, verify audit trail

**Generator Strategy**:
- Create generators for each agent signal type
- Generate valid external data responses
- Generate edge cases (empty data, extreme values, conflicts)
- Use fast-check's built-in generators for primitives
- Constrain generators to valid domains

**Example Property Test**:
```typescript
import fc from 'fast-check';

// Feature: advanced-agent-league, Property 3: Agent signal fusion weight validity
// Validates: Requirements 8.2
test('Signal fusion weight validity property', () => {
  fc.assert(
    fc.property(
      fc.array(agentSignalGenerator(), { minLength: 3, maxLength: 15 }),
      (signals) => {
        const weights = calculateDynamicWeights(signals, mockMBD);
        const weightSum = Object.values(weights).reduce((a, b) => a + b, 0);
        const allNonNegative = Object.values(weights).every(w => w >= 0);
        
        return allNonNegative && Math.abs(weightSum - 1.0) < 0.001;
      }
    ),
    { numRuns: 100 }
  );
});
```

### Test Coverage Goals

- Unit test coverage: >80% of code paths
- Property test coverage: 100% of correctness properties
- Integration test coverage: All external API interactions
- Edge case coverage: All threshold boundaries and error conditions

### Testing Philosophy

- **Unit tests verify specific behaviors** - They test concrete examples and edge cases
- **Property tests verify universal rules** - They test that properties hold across all inputs
- **Integration tests verify system behavior** - They test real external interactions
- **Together they provide comprehensive coverage** - Each testing approach complements the others

The testing strategy ensures the Advanced Agent League integrates seamlessly with the existing Market Intelligence Engine while adding robust new capabilities.

