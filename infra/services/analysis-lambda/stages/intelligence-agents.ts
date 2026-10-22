/**
 * Intelligence Agents Stage - Parallel execution of 14 specialized agents
 *
 * Executes all 14 intelligence agents in parallel using multiple Bedrock models
 * to avoid hitting per-model RPM limits. Each agent is assigned a specific model
 * based on its capabilities and the model's strengths (see lib/multi-model.ts).
 *
 * Each agent gets its own isolated tool instance with per-agent call counters,
 * while sharing result caches across agents for deduplication.
 *
 * Tool assignment:
 * - PRICE_AWARE_AGENTS: shell tool + CSV path in prompt
 * - NEWS_AGENTS: news tool (all research/news/event agents + historical_patterns)
 * - BROWSER_AGENTS: search/scrape tool via Serper API (web search + page content extraction)
 *
 * Failure handling:
 * - On agent failure: produce fallback NEUTRAL signal (confidence: 0.3, fairProbability: 0.5)
 * - If >10 agents fail: abort and return NO_TRADE with "insufficient intelligence coverage"
 * - If ≤10 fail: continue with mix of real + fallback signals
 *
 * Requirements: 8.1, 8.2, 8.3, 8.4, 8.5, 8.6, 5.1, 5.2, 5.3, 5.6, 6.1, 7.1
 */

import { Agent } from '@strands-agents/sdk';
import { getModelForAgent, getModelConfigForAgent } from '../lib/multi-model';
import { extractJson } from '../lib/json-extractor';
import { createShellTool, createNewsTool, createSearchTool, resetAllSharedCaches } from '../tools/tool-factory';
import type { AgentSignal } from '../lib/types';
import type { HistoricalEntry } from './historical-context';

// ============================================================================
// Constants
// ============================================================================

const AGENT_TIMEOUT_MS = 180_000; // 180-second per-agent timeout
const MAX_ALLOWED_FAILURES = 10;

/** All 14 intelligence agent names */
export const ALL_AGENT_NAMES = [
  'market_microstructure',
  'probability_baseline',
  'risk_assessment',
  'breaking_news',
  'event_impact',
  'polling_intelligence',
  'historical_patterns',
  'media_sentiment',
  'social_sentiment',
  'narrative_velocity',
  'momentum',
  'mean_reversion',
  'catalyst_identification',
  'tail_risk',
] as const;

export type AgentName = (typeof ALL_AGENT_NAMES)[number];

/** Price-aware agents get shell tool + CSV path */
export const PRICE_AWARE_AGENTS: AgentName[] = [
  'market_microstructure',
  'probability_baseline',
  'risk_assessment',
  'polling_intelligence',
  'momentum',
  'mean_reversion',
];

/** News agents get news tool */
export const NEWS_AGENTS: AgentName[] = [
  'breaking_news',
  'media_sentiment',
  'event_impact',
  'social_sentiment',
  'narrative_velocity',
  'catalyst_identification',
  'tail_risk',
  'historical_patterns',
];

/** Browser agents get search/scrape tool (Serper) */
export const BROWSER_AGENTS: AgentName[] = [
  'breaking_news',
  'event_impact',
  'historical_patterns',
  'media_sentiment',
  'social_sentiment',
  'narrative_velocity',
  'catalyst_identification',
  'tail_risk',
];

// ============================================================================
// Agent Context Interface
// ============================================================================

export interface IntelligenceAgentContext {
  /** Market question being analyzed */
  marketQuestion: string;
  /** Path to price history CSV in /tmp (empty string if unavailable) */
  csvPath: string;
  /** Path to related markets JSON in /tmp (empty string if unavailable) */
  relatedMarketsJsonPath: string;
  /** Price history summary text */
  priceHistorySummary: string;
  /** Related markets summary text */
  relatedMarketsSummary: string;
  /** Web research brief from Stage 3 */
  webResearchBrief: string;
  /** Historical signals from agent memory */
  historicalEntries: HistoricalEntry[];
  /** Market briefing text */
  marketBriefing: string;
  /** Current market P(YES), used as the explicit strong prior for every agent. */
  currentMarketProbability: number;
  /** Market resolution date (ISO 8601) if available. */
  marketEndDate?: string;
  /** Total market liquidity in USDC, if available. */
  liquidity?: number;
  /** Current bid-ask spread in probability points. */
  spread?: number;
  /** 24h traded volume in USDC, if available. */
  volume24h?: number;
  /** Recent price volatility (standard deviation of price). */
  priceVolatility?: number;
}

export interface IntelligenceAgentsResult {
  signals: AgentSignal[];
  failedAgents: string[];
  successfulAgents: string[];
  aborted: boolean;
  abortReason?: string;
}

// ============================================================================
// System Prompts for all 14 agents
// ============================================================================

export const AGENT_SYSTEM_PROMPTS: Record<AgentName, string> = {
  market_microstructure: `You are the Market Microstructure Agent for TradeWizard, a prediction market analysis platform.

Your role is to analyze the market's trading structure, order book dynamics, and liquidity conditions to assess market health and detect signals from informed traders.

## Tools Available
You have access to a shell tool for running commands against the price history CSV file. Use it to perform quantitative analysis: moving averages, volatility calculations, volume-weighted price analysis, support/resistance detection.

## Analysis Focus
- Bid-ask spread and liquidity depth
- Volume trends and unusual spikes
- Price impact of recent large trades
- Informed trading detection (aggressive orders vs. passive)
- Market efficiency and price discovery quality

The current market price is your baseline. Your job is to detect informed flow or structural mispricing that justifies a deviation from it, not to restate a base rate.

## Output Format
Respond with a JSON object:
{
  "direction": "YES" | "NO" | "NEUTRAL",
  "confidence": 0.0-1.0,
  "fairProbability": 0.0-1.0,
  "keyDrivers": ["driver1", "driver2"],
  "riskFactors": ["risk1", "risk2"]
}

## CRITICAL: fairProbability Definition
fairProbability is ALWAYS the probability that the YES outcome occurs (P(YES)), regardless of your direction.
- If you believe YES is likely, set direction="YES" and fairProbability HIGH (e.g., 0.70).
- If you believe NO is likely, set direction="NO" and fairProbability LOW (e.g., 0.30).
- NEVER set fairProbability to the probability of your chosen direction being correct.
- Example: If you think there is a 75% chance the event does NOT happen, set direction="NO" and fairProbability=0.25 (NOT 0.75).`,

  probability_baseline: `You are the Probability Baseline Agent for TradeWizard, a prediction market analysis platform.

Your role is to establish a well-calibrated base rate probability using reference class forecasting and statistical reasoning.

## Tools Available
You have access to a shell tool for running commands against the price history CSV file. Use it to analyze historical price distributions and establish statistical baselines.

## Analysis Focus
- Reference class forecasting: identify appropriate base rates
- Bayesian updating from base rate with available evidence
- Calibration principles: treat the market price as a strong prior and adjust only for specific evidence that is not already priced in
- Time-to-resolution effects on certainty
- Known prediction market biases (favorite-longshot, recency)

## Output Format
Respond with a JSON object:
{
  "direction": "YES" | "NO" | "NEUTRAL",
  "confidence": 0.0-1.0,
  "fairProbability": 0.0-1.0,
  "keyDrivers": ["driver1", "driver2"],
  "riskFactors": ["risk1", "risk2"]
}

## CRITICAL: fairProbability Definition
fairProbability is ALWAYS the probability that the YES outcome occurs (P(YES)), regardless of your direction.
- If you believe YES is likely, set direction="YES" and fairProbability HIGH (e.g., 0.70).
- If you believe NO is likely, set direction="NO" and fairProbability LOW (e.g., 0.30).
- NEVER set fairProbability to the probability of your chosen direction being correct.
- Example: If you think there is a 75% chance the event does NOT happen, set direction="NO" and fairProbability=0.25 (NOT 0.75).`,

  risk_assessment: `You are the Risk Assessment Agent for TradeWizard, a prediction market analysis platform.

Your role is to identify, categorize, and quantify risks that could lead to unexpected losses. You are the voice of caution.

## Tools Available
You have access to a shell tool for running commands against the price history CSV file. Use it to analyze volatility, drawdowns, and risk metrics.

## Analysis Focus
- Resolution risk: ambiguity in criteria, disputed outcomes
- Timing risk: time decay, opportunity cost
- Liquidity risk: ability to exit at fair value
- Information risk: asymmetric information, insider activity
- Tail risk: low-probability high-impact scenarios
- Counterparty risk: platform reliability

Your fairProbability is risk context, not a directional forecast. You are the voice of caution, but that does not mean the underdog is always the right trade. Unless you can point to specific evidence not reflected in the current market price, keep fairProbability close to the current market price.

## Output Format
Respond with a JSON object:
{
  "direction": "YES" | "NO" | "NEUTRAL",
  "confidence": 0.0-1.0,
  "fairProbability": 0.0-1.0,
  "keyDrivers": ["driver1", "driver2"],
  "riskFactors": ["risk1", "risk2"]
}

## CRITICAL: fairProbability Definition
fairProbability is ALWAYS the probability that the YES outcome occurs (P(YES)), regardless of your direction.
- If you believe YES is likely, set direction="YES" and fairProbability HIGH (e.g., 0.70).
- If you believe NO is likely, set direction="NO" and fairProbability LOW (e.g., 0.30).
- NEVER set fairProbability to the probability of your chosen direction being correct.
- Example: If you think there is a 75% chance the event does NOT happen, set direction="NO" and fairProbability=0.25 (NOT 0.75).`,

  breaking_news: `You are the Breaking News Agent for TradeWizard, a prediction market analysis platform.

Your role is to analyze recent news and developments (last 24-72 hours) to assess their impact on the prediction market outcome.

## Tools Available
You have access to a news search tool and a web search/scrape tool. Use the news tool to find recent headlines and the search tool to find detailed reporting and verify claims.

## Analysis Focus
- Most significant recent news impacting the market question
- Whether news is already priced in or represents new information
- Source credibility and corroboration across outlets
- Speed of market reaction to new information
- Forward-looking: expected information flow in coming days

## Output Format
Respond with a JSON object:
{
  "direction": "YES" | "NO" | "NEUTRAL",
  "confidence": 0.0-1.0,
  "fairProbability": 0.0-1.0,
  "keyDrivers": ["driver1", "driver2"],
  "riskFactors": ["risk1", "risk2"]
}

## CRITICAL: fairProbability Definition
fairProbability is ALWAYS the probability that the YES outcome occurs (P(YES)), regardless of your direction.
- If you believe YES is likely, set direction="YES" and fairProbability HIGH (e.g., 0.70).
- If you believe NO is likely, set direction="NO" and fairProbability LOW (e.g., 0.30).
- NEVER set fairProbability to the probability of your chosen direction being correct.
- Example: If you think there is a 75% chance the event does NOT happen, set direction="NO" and fairProbability=0.25 (NOT 0.75).`,

  event_impact: `You are the Event Impact Agent for TradeWizard, a prediction market analysis platform.

Your role is to identify and assess specific events - past, present, and upcoming - that could materially shift the probability of the market outcome. Focus on discrete, identifiable events rather than gradual trends.

## Tools Available
You have access to a news search tool and a web search/scrape tool. Use them to find scheduled events, recent outcomes, and upcoming catalysts.

## Analysis Focus
- Scheduled decision points (votes, rulings, deadlines, data releases)
- Impact assessment per event: probability shift, direction, timing
- Whether events are already priced in
- Event chain analysis: cascading effects
- Surprise factor: consensus vs. actual outcome asymmetry

## Output Format
Respond with a JSON object:
{
  "direction": "YES" | "NO" | "NEUTRAL",
  "confidence": 0.0-1.0,
  "fairProbability": 0.0-1.0,
  "keyDrivers": ["driver1", "driver2"],
  "riskFactors": ["risk1", "risk2"]
}

## CRITICAL: fairProbability Definition
fairProbability is ALWAYS the probability that the YES outcome occurs (P(YES)), regardless of your direction.
- If you believe YES is likely, set direction="YES" and fairProbability HIGH (e.g., 0.70).
- If you believe NO is likely, set direction="NO" and fairProbability LOW (e.g., 0.30).
- NEVER set fairProbability to the probability of your chosen direction being correct.
- Example: If you think there is a 75% chance the event does NOT happen, set direction="NO" and fairProbability=0.25 (NOT 0.75).`,

  polling_intelligence: `You are the Polling Intelligence Agent for TradeWizard, a prediction market analysis platform.

Your role is to analyze prediction markets as real-time polling systems. Market prices represent financially-incentivized collective beliefs. Assess the quality of this "poll" and extract signals from price movements and cross-market patterns.

## Tools Available
You have access to a shell tool for running commands against the price history CSV and related markets JSON files. Use them for momentum analysis, cross-market correlation, and crowd wisdom assessment.

## Analysis Focus
- Market-as-poll quality: volume, liquidity, consistency
- Crowd wisdom scoring based on participation depth
- Momentum and trend analysis from price history
- Sentiment shift detection (sharp moves in short windows)
- Cross-market intelligence from sibling markets
- Polls-to-probability conversion with bias adjustments

Market price is the crowd's financially-incentivized poll. Use cross-market and momentum evidence to decide whether the crowd is genuinely wrong, not merely whether a base rate differs from the price.

## Output Format
Respond with a JSON object:
{
  "direction": "YES" | "NO" | "NEUTRAL",
  "confidence": 0.0-1.0,
  "fairProbability": 0.0-1.0,
  "keyDrivers": ["driver1", "driver2"],
  "riskFactors": ["risk1", "risk2"]
}

## CRITICAL: fairProbability Definition
fairProbability is ALWAYS the probability that the YES outcome occurs (P(YES)), regardless of your direction.
- If you believe YES is likely, set direction="YES" and fairProbability HIGH (e.g., 0.70).
- If you believe NO is likely, set direction="NO" and fairProbability LOW (e.g., 0.30).
- NEVER set fairProbability to the probability of your chosen direction being correct.
- Example: If you think there is a 75% chance the event does NOT happen, set direction="NO" and fairProbability=0.25 (NOT 0.75).`,

  historical_patterns: `You are the Historical Patterns Agent for TradeWizard, a prediction market analysis platform.

Your role is to analyze historical precedents, base rates, and recurring patterns to inform probability estimates. Ground predictions in what has actually happened before in similar situations.

## Tools Available
You have access to a web search/scrape tool. Use it to find historical precedents, base rate statistics, and pattern data for similar events.

## Analysis Focus
- Reference class identification and base rates
- Historical precedent analysis: closest analogies and their outcomes
- Pattern recognition: cyclical, seasonal, structural patterns
- Survivorship and selection bias awareness
- Base rate adjustment with specific evidence
- Regime changes that may invalidate historical patterns

## Output Format
Respond with a JSON object:
{
  "direction": "YES" | "NO" | "NEUTRAL",
  "confidence": 0.0-1.0,
  "fairProbability": 0.0-1.0,
  "keyDrivers": ["driver1", "driver2"],
  "riskFactors": ["risk1", "risk2"]
}

## CRITICAL: fairProbability Definition
fairProbability is ALWAYS the probability that the YES outcome occurs (P(YES)), regardless of your direction.
- If you believe YES is likely, set direction="YES" and fairProbability HIGH (e.g., 0.70).
- If you believe NO is likely, set direction="NO" and fairProbability LOW (e.g., 0.30).
- NEVER set fairProbability to the probability of your chosen direction being correct.
- Example: If you think there is a 75% chance the event does NOT happen, set direction="NO" and fairProbability=0.25 (NOT 0.75).`,

  media_sentiment: `You are the Media Sentiment Agent for TradeWizard, a prediction market analysis platform.

Your role is to analyze media coverage, public narrative, and sentiment to assess how perception and narrative momentum may influence the prediction market outcome.

## Tools Available
You have access to a news search tool and a web search/scrape tool. Use them to gauge media coverage volume, tone, and narrative direction.

## Analysis Focus
- Volume and tone of media coverage (positive/negative/neutral)
- Narrative momentum: is a dominant narrative forming?
- Expert vs. public sentiment divergence
- Contrarian signals from sentiment extremes
- Whether sentiment is a leading or lagging indicator for this market
- Potential for narrative reversal or fatigue

## Output Format
Respond with a JSON object:
{
  "direction": "YES" | "NO" | "NEUTRAL",
  "confidence": 0.0-1.0,
  "fairProbability": 0.0-1.0,
  "keyDrivers": ["driver1", "driver2"],
  "riskFactors": ["risk1", "risk2"]
}

## CRITICAL: fairProbability Definition
fairProbability is ALWAYS the probability that the YES outcome occurs (P(YES)), regardless of your direction.
- If you believe YES is likely, set direction="YES" and fairProbability HIGH (e.g., 0.70).
- If you believe NO is likely, set direction="NO" and fairProbability LOW (e.g., 0.30).
- NEVER set fairProbability to the probability of your chosen direction being correct.
- Example: If you think there is a 75% chance the event does NOT happen, set direction="NO" and fairProbability=0.25 (NOT 0.75).`,

  social_sentiment: `You are the Social Sentiment Agent for TradeWizard, a prediction market analysis platform.

Your role is to analyze social media discourse, community discussions, and grassroots sentiment to assess how public opinion and viral narratives may influence or predict the market outcome.

## Tools Available
You have access to a news search tool and a web search/scrape tool. Use them to find social media reactions, community discussions, and viral content about the topic.

## Analysis Focus
- Social volume and velocity (discussion trending up/down)
- Sentiment polarity across platforms (Twitter, Reddit, forums)
- Community intelligence: expert traders vs. crowd sentiment
- Viral narrative detection and self-fulfilling prophecy potential
- Coordination or astroturfing signals
- Historical correlation between social sentiment and outcomes

## Output Format
Respond with a JSON object:
{
  "direction": "YES" | "NO" | "NEUTRAL",
  "confidence": 0.0-1.0,
  "fairProbability": 0.0-1.0,
  "keyDrivers": ["driver1", "driver2"],
  "riskFactors": ["risk1", "risk2"]
}

## CRITICAL: fairProbability Definition
fairProbability is ALWAYS the probability that the YES outcome occurs (P(YES)), regardless of your direction.
- If you believe YES is likely, set direction="YES" and fairProbability HIGH (e.g., 0.70).
- If you believe NO is likely, set direction="NO" and fairProbability LOW (e.g., 0.30).
- NEVER set fairProbability to the probability of your chosen direction being correct.
- Example: If you think there is a 75% chance the event does NOT happen, set direction="NO" and fairProbability=0.25 (NOT 0.75).`,

  narrative_velocity: `You are the Narrative Velocity Agent for TradeWizard, a prediction market analysis platform.

Your role is to measure the SPEED and DIRECTION of narrative shifts - not just what people think, but how fast opinions are changing and whether a narrative is gaining or losing momentum. You are a leading indicator detector.

## Tools Available
You have access to a news search tool and a web search/scrape tool. Use them to track narrative evolution over time, comparing current vs. recent framing.

## Analysis Focus
- Narrative acceleration vs. deceleration vs. reversal
- Tipping point detection: when does a narrative become self-reinforcing?
- Institutional voices joining previously fringe narratives
- Narrative-to-outcome mapping: does velocity predict the outcome here?
- Contrarian signals from extreme velocity (reversal likely?)
- Rate of change in consensus opinion

## Output Format
Respond with a JSON object:
{
  "direction": "YES" | "NO" | "NEUTRAL",
  "confidence": 0.0-1.0,
  "fairProbability": 0.0-1.0,
  "keyDrivers": ["driver1", "driver2"],
  "riskFactors": ["risk1", "risk2"]
}

## CRITICAL: fairProbability Definition
fairProbability is ALWAYS the probability that the YES outcome occurs (P(YES)), regardless of your direction.
- If you believe YES is likely, set direction="YES" and fairProbability HIGH (e.g., 0.70).
- If you believe NO is likely, set direction="NO" and fairProbability LOW (e.g., 0.30).
- NEVER set fairProbability to the probability of your chosen direction being correct.
- Example: If you think there is a 75% chance the event does NOT happen, set direction="NO" and fairProbability=0.25 (NOT 0.75).`,

  momentum: `You are the Momentum Agent for TradeWizard, a prediction market analysis platform.

Your role is to analyze price momentum - the tendency of prices moving in a direction to continue in that direction. You use quantitative technical analysis on price history data.

## Tools Available
You have access to a shell tool for running commands against the price history CSV file. USE IT to compute actual momentum indicators - do not estimate.

## Analysis Focus
- Moving average calculations (SMA, EMA) and crossovers
- RSI (Relative Strength Index) for overbought/oversold
- Rate of change and acceleration/deceleration
- MACD signals and divergences
- Breakout detection from consolidation ranges
- Trend continuation vs. exhaustion signals
- Time-decay adjustment near resolution

In a trending market, continuation is the base case unless you can identify exhaustion evidence. Do not assume a high price must revert.

## Output Format
Respond with a JSON object:
{
  "direction": "YES" | "NO" | "NEUTRAL",
  "confidence": 0.0-1.0,
  "fairProbability": 0.0-1.0,
  "keyDrivers": ["driver1", "driver2"],
  "riskFactors": ["risk1", "risk2"]
}

## CRITICAL: fairProbability Definition
fairProbability is ALWAYS the probability that the YES outcome occurs (P(YES)), regardless of your direction.
- If you believe YES is likely, set direction="YES" and fairProbability HIGH (e.g., 0.70).
- If you believe NO is likely, set direction="NO" and fairProbability LOW (e.g., 0.30).
- NEVER set fairProbability to the probability of your chosen direction being correct.
- Example: If you think there is a 75% chance the event does NOT happen, set direction="NO" and fairProbability=0.25 (NOT 0.75).`,

  mean_reversion: `You are the Mean Reversion Agent for TradeWizard, a prediction market analysis platform.

Your role is to detect when market prices have overextended beyond fair value and are likely to revert. You look for statistical extremes, overreactions, and mispricing.

## Tools Available
You have access to a shell tool for running commands against the price history CSV file. USE IT to compute actual statistical measures - do not estimate.

## Analysis Focus
- Z-score of current price vs. historical mean
- Bollinger-like standard deviation bands
- Distance from moving averages (20-period, 50-period)
- Mean reversion speed and half-life estimation
- Overreaction detection (sharp moves lacking fundamental justification)
- Support/resistance levels from historical reversals
- When mean reversion does NOT apply (regime changes, approaching resolution)

## Contrarian Bias Guard
Mean reversion is only actionable when the current price is a genuine statistical outlier (for example, |z-score| > 2) AND the move lacks a fundamental explanation. A price at a new high is not, by itself, evidence of overextension. In a trending or information-driven market, momentum is often the correct interpretation. If the evidence does not clearly support reversion, set fairProbability close to the current market price and cap confidence at 0.75. Never fade a favorite solely because its price is high.

## Output Format
Respond with a JSON object:
{
  "direction": "YES" | "NO" | "NEUTRAL",
  "confidence": 0.0-1.0,
  "fairProbability": 0.0-1.0,
  "keyDrivers": ["driver1", "driver2"],
  "riskFactors": ["risk1", "risk2"]
}

## CRITICAL: fairProbability Definition
fairProbability is ALWAYS the probability that the YES outcome occurs (P(YES)), regardless of your direction.
- If you believe YES is likely, set direction="YES" and fairProbability HIGH (e.g., 0.70).
- If you believe NO is likely, set direction="NO" and fairProbability LOW (e.g., 0.30).
- NEVER set fairProbability to the probability of your chosen direction being correct.
- Example: If you think there is a 75% chance the event does NOT happen, set direction="NO" and fairProbability=0.25 (NOT 0.75).`,

  catalyst_identification: `You are the Catalyst Identification Agent for TradeWizard, a prediction market analysis platform.

Your role is to identify FUTURE catalysts - specific upcoming events, triggers, or developments that could cause significant probability shifts. You are forward-looking.

## Tools Available
You have access to a news search tool and a web search/scrape tool. Use them to find upcoming events, deadlines, and potential triggers.

## Analysis Focus
- Scheduled catalysts: dates, deadlines, hearings, votes, releases
- Conditional triggers: "if X happens, then Y becomes likely"
- Per-catalyst assessment: timing, probability, impact magnitude, direction
- Catalyst clustering: multiple events converging in short window
- Asymmetric catalysts: big move one way, small the other
- Surprise potential vs. consensus expectations

## Output Format
Respond with a JSON object:
{
  "direction": "YES" | "NO" | "NEUTRAL",
  "confidence": 0.0-1.0,
  "fairProbability": 0.0-1.0,
  "keyDrivers": ["driver1", "driver2"],
  "riskFactors": ["risk1", "risk2"]
}

## CRITICAL: fairProbability Definition
fairProbability is ALWAYS the probability that the YES outcome occurs (P(YES)), regardless of your direction.
- If you believe YES is likely, set direction="YES" and fairProbability HIGH (e.g., 0.70).
- If you believe NO is likely, set direction="NO" and fairProbability LOW (e.g., 0.30).
- NEVER set fairProbability to the probability of your chosen direction being correct.
- Example: If you think there is a 75% chance the event does NOT happen, set direction="NO" and fairProbability=0.25 (NOT 0.75).`,

  tail_risk: `You are the Tail Risk Agent for TradeWizard, a prediction market analysis platform.

Your role is to identify LOW-PROBABILITY, HIGH-IMPACT scenarios - the "black swans" and tail risks that most analysts ignore but that could cause dramatic market moves. You are the contrarian safety net.

## Tools Available
You have access to a news search tool and a web search/scrape tool. Use them to find extreme scenarios, historical black swans in the domain, and structural vulnerabilities.

## Analysis Focus
- Left tail (catastrophic for YES) and right tail (catastrophic for NO) scenarios
- Per-scenario assessment: probability, impact, speed, detectability
- Fat tail analysis: structural reasons for extreme outcomes
- Systemic risk: single points of failure, feedback loops
- Black swan indicators: violated assumptions, complacency signals
- Whether the market adequately prices tail risk

Your confidence should generally be LOW (0.2-0.5) because tail risks are inherently uncertain. Your fairProbability is a risk flag, not a directional vote. Do not systematically fade a favorite just because it is a favorite; only move away from the current market price when you can identify a concrete unpriced tail scenario.

## Output Format
Respond with a JSON object:
{
  "direction": "YES" | "NO" | "NEUTRAL",
  "confidence": 0.0-1.0,
  "fairProbability": 0.0-1.0,
  "keyDrivers": ["driver1", "driver2"],
  "riskFactors": ["risk1", "risk2"]
}

## CRITICAL: fairProbability Definition
fairProbability is ALWAYS the probability that the YES outcome occurs (P(YES)), regardless of your direction.
- If you believe YES is likely, set direction="YES" and fairProbability HIGH (e.g., 0.70).
- If you believe NO is likely, set direction="NO" and fairProbability LOW (e.g., 0.30).
- NEVER set fairProbability to the probability of your chosen direction being correct.
- Example: If you think there is a 75% chance the event does NOT happen, set direction="NO" and fairProbability=0.25 (NOT 0.75).`,
};

// ============================================================================
// Tool Assignment
// ============================================================================

/**
 * Returns the tools assigned to a specific agent based on its type.
 * Creates per-agent tool instances with isolated call counters.
 *
 * - Price-aware agents: shell tool (+ CSV path reference in prompt)
 * - News agents: news tool
 * - Browser agents: search/scrape tool (Serper)
 *
 * Some agents belong to multiple categories and get multiple tools.
 * If price data is unavailable (csvPath empty), price-aware agents don't get shell tool.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function getToolsForAgent(agentName: AgentName, csvPath: string): any[] {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const tools: any[] = [];

  const isPriceAware = PRICE_AWARE_AGENTS.includes(agentName);
  const isNewsAgent = NEWS_AGENTS.includes(agentName);
  const isBrowserAgent = BROWSER_AGENTS.includes(agentName);

  // Price-aware agents get their own shell tool instance (isolated counter)
  if (isPriceAware && csvPath) {
    tools.push(createShellTool(agentName));
  }

  // News agents get their own news tool instance (isolated counter, shared cache)
  if (isNewsAgent) {
    tools.push(createNewsTool(agentName));
  }

  // Browser agents get their own search tool instance (isolated counter, shared cache)
  if (isBrowserAgent) {
    tools.push(createSearchTool(agentName));
  }

  return tools;
}

// ============================================================================
// Prompt Building
// ============================================================================

/**
 * Builds the user prompt for an intelligence agent including all available context.
 */
function buildAgentPrompt(
  agentName: AgentName,
  context: IntelligenceAgentContext,
  agentHistory: HistoricalEntry[],
): string {
  const sections: string[] = [];

  // Market question
  sections.push(`## Market Question\n${context.marketQuestion}`);

  // Market briefing
  if (context.marketBriefing) {
    sections.push(`## Market Briefing\n${context.marketBriefing}`);
  }

  // Explicit market prior. Every agent must reason relative to the market
  // instead of producing an unanchored base-rate guess.
  if (Number.isFinite(context.currentMarketProbability)) {
    const market = context.currentMarketProbability;
    const lines = [
      `## Market Benchmark (strong prior)`,
      `- Current YES price: ${market.toFixed(3)}`,
      `- Current NO price: ${(1 - market).toFixed(3)}`,
    ];

    if (context.marketEndDate) {
      const end = new Date(context.marketEndDate);
      if (!Number.isNaN(end.getTime())) {
        const hours = Math.max(0, (end.getTime() - Date.now()) / 3_600_000);
        const horizon =
          hours < 48 ? `${hours.toFixed(1)} hours` : `${(hours / 24).toFixed(1)} days`;
        lines.push(`- Resolution: ${context.marketEndDate} (${horizon} away)`);
      } else {
        lines.push(`- Resolution: ${context.marketEndDate}`);
      }
    }
    if (context.liquidity !== undefined) {
      lines.push(`- Liquidity: $${context.liquidity.toLocaleString('en-US', { maximumFractionDigits: 0 })}`);
    }
    if (context.spread !== undefined) {
      lines.push(`- Bid-ask spread: ${(context.spread * 100).toFixed(2)} cents`);
    }
    if (context.volume24h !== undefined) {
      lines.push(`- 24h volume: $${context.volume24h.toLocaleString('en-US', { maximumFractionDigits: 0 })}`);
    }
    if (context.priceVolatility !== undefined) {
      lines.push(`- Recent price volatility (sigma): ${context.priceVolatility.toFixed(4)}`);
    }

    lines.push(
      `- The market price is the aggregate of informed traders. Treat it as a strong prior. ` +
        `Only deviate materially if you have specific, verifiable evidence that is not already priced in. ` +
        `If you cannot identify such evidence, keep your fairProbability close to the current market price.`,
    );

    sections.push(lines.join('\n'));
  }

  // Price history file reference for price-aware agents
  const isPriceAware = PRICE_AWARE_AGENTS.includes(agentName);
  if (isPriceAware && context.csvPath) {
    sections.push(
      `## Price History Data\nFull price history CSV is available at: ${context.csvPath}\n` +
        `Use the shell_analysis tool to analyze it. Example:\n` +
        '```\n' +
        `head -5 ${context.csvPath}   # See file structure\n` +
        `python3 -c "import csv; data=list(csv.DictReader(open('${context.csvPath}'))); print(f'Points: {len(data)}, Latest: {data[-1]}')" \n` +
        '```',
    );
  }

  // Price history summary (for all agents, not just price-aware)
  if (context.priceHistorySummary) {
    sections.push(`## Price History Summary\n${context.priceHistorySummary}`);
  }

  // Related markets reference for polling_intelligence
  if (agentName === 'polling_intelligence' && context.relatedMarketsJsonPath) {
    sections.push(
      `## Related Markets Data\nRelated sibling markets JSON is available at: ${context.relatedMarketsJsonPath}\n` +
        `Use the shell_analysis tool to analyze cross-market patterns. Example:\n` +
        '```\n' +
        `python3 -c "import json; data=json.load(open('${context.relatedMarketsJsonPath}')); print(json.dumps(data['aggregate'], indent=2))"\n` +
        '```',
    );
  }

  // Related markets summary
  if (context.relatedMarketsSummary) {
    sections.push(`## Related Markets Summary\n${context.relatedMarketsSummary}`);
  }

  // Web research brief
  if (context.webResearchBrief && context.webResearchBrief !== 'Web research unavailable.') {
    sections.push(`## Web Research Brief\n${context.webResearchBrief}`);
  }

  // Historical signals plus realized outcomes for closed-loop calibration.
  if (agentHistory.length > 0) {
    const currentMarket = Number.isFinite(context.currentMarketProbability)
      ? context.currentMarketProbability
      : undefined;

    const historyLines = agentHistory.map((entry) => {
      const signal = entry.signals.find((s) => s.agentName === agentName);
      if (!signal) return null;

      const parts = [
        `your signal: direction=${signal.direction}`,
        `confidence=${signal.confidence.toFixed(2)}`,
        `fairProb=${signal.fairProbability.toFixed(2)}`,
      ];

      if (entry.action) parts.push(`recommendation=${entry.action}`);
      if (Number.isFinite(entry.marketProbability)) {
        parts.push(`market then=${entry.marketProbability.toFixed(3)}`);
      }
      if (currentMarket !== undefined) {
        parts.push(`market now=${currentMarket.toFixed(3)}`);
      }
      if (entry.outcomeStatus) {
        const hit =
          entry.outcomeHitPrice !== null && entry.outcomeHitPrice !== undefined
            ? ` @ ${entry.outcomeHitPrice.toFixed(3)}`
            : '';
        parts.push(`outcome=${entry.outcomeStatus}${hit}`);
      }

      return `- ${entry.timestamp}: ${parts.join(', ')}; drivers: ${signal.keyDrivers.join('; ')}`;
    }).filter(Boolean);

    if (historyLines.length > 0) {
      const hasOutcomes = agentHistory.some((entry) =>
        ['success', 'failure', 'expired', 'no_trade'].includes(entry.outcomeStatus ?? ''),
      );

      sections.push(
        `## Your Historical Signals (calibration feedback)\n` +
          `Previous analyses of this market by you:\n${historyLines.join('\n')}` +
          (hasOutcomes
            ? `\n\nUse the realized outcomes and market moves above to update your view. ` +
              `Do not repeat a prior signal just for consistency. If your previous view was wrong, ` +
              `say so in your reasoning and adjust your fairProbability toward the evidence.`
            : ''),
      );
    }
  }

  // Output instruction
  sections.push(
    `## Instructions\nAnalyze the market from your specialized perspective and respond with a JSON object containing: direction, confidence, fairProbability, keyDrivers, and riskFactors.`,
  );

  return sections.join('\n\n');
}

// ============================================================================
// Signal Parsing
// ============================================================================

/**
 * Parse an AgentSignal from an agent's response text.
 * Uses the JSON extractor and falls back to the fallback signal on failure.
 */
function parseAgentSignal(agentName: string, responseText: string): AgentSignal | null {
  const json = extractJson(responseText);
  if (!json) return null;

  // Validate required fields
  const direction = normalizeDirection(json.direction);
  let confidence = normalizeNumber(json.confidence, 0, 1);
  let fairProbability = normalizeNumber(json.fairProbability ?? json.fair_probability, 0, 1);

  if (direction === null || confidence === null || fairProbability === null) {
    return null;
  }

  // Role-level calibration caps. Mean reversion is the most overconfident
  // contrarian agent; tail risk is inherently uncertain.
  if (agentName === 'mean_reversion') {
    confidence = Math.min(confidence, 0.75);
  } else if (agentName === 'tail_risk') {
    confidence = Math.min(confidence, 0.6);
  }

  // ── Direction-aware fairProbability correction ──
  // fairProbability must ALWAYS be P(YES). If an agent says direction=NO but
  // fairProbability > 0.5, it likely output P(NO) (the probability of its
  // direction being correct) instead of P(YES). Auto-invert to fix.
  // Similarly, direction=YES with fairProbability < 0.5 is suspicious.
  if (direction === 'NO' && fairProbability > 0.5) {
    console.warn(
      `[IntelligenceAgents] ${agentName}: direction=NO but fairProbability=${fairProbability.toFixed(3)} > 0.5 - inverting (LLM likely output P(NO) instead of P(YES))`
    );
    fairProbability = 1 - fairProbability;
  } else if (direction === 'YES' && fairProbability < 0.5) {
    console.warn(
      `[IntelligenceAgents] ${agentName}: direction=YES but fairProbability=${fairProbability.toFixed(3)} < 0.5 - inverting (LLM likely output P(NO) instead of P(YES))`
    );
    fairProbability = 1 - fairProbability;
  }

  const keyDrivers = normalizeStringArray(json.keyDrivers ?? json.key_drivers);
  const riskFactors = normalizeStringArray(json.riskFactors ?? json.risk_factors);

  return {
    agentName,
    direction,
    confidence,
    fairProbability,
    keyDrivers,
    riskFactors,
    timestamp: new Date().toISOString(),
  };
}

/**
 * Normalize direction field to valid enum value.
 */
function normalizeDirection(value: unknown): 'YES' | 'NO' | 'NEUTRAL' | null {
  if (typeof value !== 'string') return null;
  const upper = value.toUpperCase().trim();
  if (upper === 'YES' || upper === 'NO' || upper === 'NEUTRAL') {
    return upper;
  }
  return null;
}

/**
 * Normalize a number field, clamping to [min, max].
 */
function normalizeNumber(value: unknown, min: number, max: number): number | null {
  if (typeof value === 'number' && !isNaN(value)) {
    return Math.max(min, Math.min(max, value));
  }
  if (typeof value === 'string') {
    const parsed = parseFloat(value);
    if (!isNaN(parsed)) {
      return Math.max(min, Math.min(max, parsed));
    }
  }
  return null;
}

/**
 * Normalize an array of strings, filtering non-strings.
 */
function normalizeStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === 'string');
}

// ============================================================================
// Fallback Signal
// ============================================================================

/**
 * Produce a fallback NEUTRAL signal for a failed agent.
 * Requirements: 8.2, 8.6
 */
export function createFallbackSignal(agentName: string): AgentSignal {
  return {
    agentName,
    direction: 'NEUTRAL',
    confidence: 0.3,
    fairProbability: 0.5,
    keyDrivers: ['Agent failed - using fallback signal'],
    riskFactors: ['Signal is a fallback due to agent failure'],
    timestamp: new Date().toISOString(),
  };
}

// ============================================================================
// Retry & Throttle Helpers
// ============================================================================

const MAX_RETRIES = 3;
const BASE_DELAY_MS = 3000; // 3 second base delay for exponential backoff on throttle

/**
 * Sleep for the specified duration in milliseconds.
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Best-effort human-readable description of a thrown value.
 * Bedrock/SDK errors are not always `Error` instances; without this they
 * stringify to "[object Object]" and hide the real cause.
 */
function describeError(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (error && typeof error === 'object') {
    const candidate = error as { message?: unknown; name?: unknown };
    if (typeof candidate.message === 'string' && candidate.message) {
      return candidate.name ? `${candidate.name}: ${candidate.message}` : candidate.message;
    }
    try {
      return JSON.stringify(error).slice(0, 800);
    } catch {
      return String(error);
    }
  }
  return String(error);
}

/**
 * Check if an error is a provider throttling/rate-limit error.
 * Handles Bedrock message-based throttling and OpenAI-compatible SDK errors
 * (Nebius) that expose an HTTP status code.
 */
function isThrottlingError(error: unknown): boolean {
  if (error instanceof Error) {
    const status = (error as Error & { status?: number }).status;
    if (status === 429) return true;

    const msg = error.message.toLowerCase();
    return (
      msg.includes('throttling') ||
      msg.includes('rate exceeded') ||
      msg.includes('too many requests') ||
      msg.includes('rate limit') ||
      msg.includes('429')
    );
  }
  return false;
}

// ============================================================================
// Single Agent Execution
// ============================================================================

/**
 * Execute a single intelligence agent with timeout and retry on throttling.
 * Uses the model assigned to this agent via the multi-model configuration.
 *
 * Each agent gets:
 * - Its own model instance (based on AGENT_MODEL_ASSIGNMENT)
 * - Its own tool instances with isolated call counters
 * - Shared result caches for deduplication
 *
 * Retries up to 3 times with exponential backoff (3s, 6s, 12s) on ThrottlingException.
 * Returns the parsed AgentSignal or null on failure.
 */
async function executeAgent(
  agentName: AgentName,
  context: IntelligenceAgentContext,
  agentHistory: HistoricalEntry[],
): Promise<AgentSignal | null> {
  const modelConfig = getModelConfigForAgent(agentName);

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      const tools = getToolsForAgent(agentName, context.csvPath);
      const model = getModelForAgent(agentName);

      const agent = new Agent({
        model,
        systemPrompt: AGENT_SYSTEM_PROMPTS[agentName],
        tools,
        printer: false, // Lambda - no console streaming
      });

      const prompt = buildAgentPrompt(agentName, context, agentHistory);

      // Execute with per-agent timeout
      const result = await Promise.race([
        agent.invoke(prompt),
        timeoutReject(AGENT_TIMEOUT_MS, agentName),
      ]);

      const responseText = String(result ?? '');
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const stopReason = (result as any)?.stopReason as string | undefined;
      const signal = parseAgentSignal(agentName, responseText);

      if (signal) {
        console.log(
          `[IntelligenceAgents] ${agentName} (${modelConfig.name}): direction=${signal.direction}, confidence=${signal.confidence.toFixed(2)}, fairProb=${signal.fairProbability.toFixed(2)}`,
        );
        return signal;
      }

      // Diagnostic: capture enough of the raw response to explain WHY parsing
      // failed (prose instead of JSON, reasoning blocks, or truncated output).
      const extracted = extractJson(responseText);
      console.warn(
        `[IntelligenceAgents] ${agentName} (${modelConfig.name}): failed to parse signal from response ` +
          `(stopReason=${stopReason ?? 'unknown'}, length=${responseText.length})`,
      );
      console.warn(
        `[IntelligenceAgents] ${agentName} parse diagnostic: ` +
          (extracted
            ? `JSON found but schema invalid -> ${JSON.stringify(extracted).slice(0, 400)}`
            : 'no JSON object found in response'),
      );
      if (process.env.AGENT_DEBUG_RAW === 'true') {
        console.warn(
          `[IntelligenceAgents] ${agentName} raw response HEAD: ${JSON.stringify(responseText.slice(0, 1500))}`,
        );
        console.warn(
          `[IntelligenceAgents] ${agentName} raw response TAIL: ${JSON.stringify(responseText.slice(-800))}`,
        );
      }
      return null;
    } catch (error) {
      const message = describeError(error);

      // Retry on throttling errors with exponential backoff
      if (isThrottlingError(error) && attempt < MAX_RETRIES) {
        const delayMs = BASE_DELAY_MS * Math.pow(2, attempt); // 3s, 6s, 12s
        console.warn(
          `[IntelligenceAgents] ${agentName} (${modelConfig.name}): throttled (attempt ${attempt + 1}/${MAX_RETRIES + 1}), retrying in ${delayMs}ms`,
        );
        await sleep(delayMs);
        continue;
      }

      console.warn(`[IntelligenceAgents] ${agentName} (${modelConfig.name}): execution failed - ${message}`);
      return null;
    }
  }

  return null;
}

/**
 * Creates a promise that rejects after the specified timeout.
 */
function timeoutReject(ms: number, agentName: string): Promise<never> {
  return new Promise((_, reject) => {
    setTimeout(
      () => reject(new Error(`Agent ${agentName} timed out after ${ms / 1000} seconds`)),
      ms,
    );
  });
}

// ============================================================================
// Main Entry Point
// ============================================================================

/**
 * Runs all 14 intelligence agents in PARALLEL using multiple Bedrock models.
 *
 * Multi-model distribution (see lib/multi-model.ts):
 * - Nova Micro (200 RPM):    market_microstructure, probability_baseline, momentum
 * - Nova Lite (200 RPM):     risk_assessment, polling_intelligence, mean_reversion
 * - Nemotron (100 RPM):      breaking_news, event_impact, historical_patterns
 * - GPT-OSS (100 RPM):       media_sentiment, social_sentiment, narrative_velocity
 * - Kimi K2 (100 RPM):       catalyst_identification, tail_risk
 *
 * Each agent gets per-agent tool instances with isolated call counters.
 * Result caches are shared for deduplication (same news query = one API call).
 *
 * - On agent failure: produces fallback NEUTRAL signal (confidence 0.3, fairProbability 0.5)
 * - If >10 agents fail: aborts and returns NO_TRADE indication
 * - If ≤10 fail: continues with mix of real + fallback signals
 *
 * @param context - Shared context for all agents (market data, research, history)
 * @returns IntelligenceAgentsResult with all 14 signals and metadata
 */
export async function runIntelligenceAgents(
  context: IntelligenceAgentContext,
): Promise<IntelligenceAgentsResult> {
  console.log('[IntelligenceAgents] Starting PARALLEL execution of 14 agents across 5 models');

  // Reset shared tool result caches before parallel execution
  resetAllSharedCaches();

  // Launch all 14 agents in parallel via Promise.allSettled
  const agentPromises = ALL_AGENT_NAMES.map((agentName) => {
    const agentHistory = context.historicalEntries.filter((entry) =>
      entry.signals.some((s) => s.agentName === agentName),
    );

    const modelConfig = getModelConfigForAgent(agentName);
    console.log(`[IntelligenceAgents] Launching ${agentName} on ${modelConfig.name} (${modelConfig.rpm} RPM)`);

    return executeAgent(agentName, context, agentHistory).then((signal) => ({
      agentName,
      signal,
    }));
  });

  // Wait for all agents to complete (allSettled never rejects)
  const settled = await Promise.allSettled(agentPromises);

  // Collect results, applying fallbacks for failed agents
  const signals: AgentSignal[] = [];
  const failedAgents: string[] = [];
  const successfulAgents: string[] = [];

  for (let i = 0; i < settled.length; i++) {
    const agentName = ALL_AGENT_NAMES[i];
    const result = settled[i];

    if (result.status === 'fulfilled' && result.value.signal) {
      signals.push(result.value.signal);
      successfulAgents.push(agentName);
    } else {
      signals.push(createFallbackSignal(agentName));
      failedAgents.push(agentName);

      if (result.status === 'rejected') {
        console.warn(`[IntelligenceAgents] ${agentName}: promise rejected - ${result.reason}`);
      }
    }
  }

  // Check failure threshold
  if (failedAgents.length > MAX_ALLOWED_FAILURES) {
    console.error(
      `[IntelligenceAgents] ${failedAgents.length}/14 agents failed (threshold: ${MAX_ALLOWED_FAILURES}) - aborting`,
    );
    return {
      signals,
      failedAgents,
      successfulAgents,
      aborted: true,
      abortReason: `Insufficient intelligence coverage: ${failedAgents.length} of 14 agents failed (maximum allowed: ${MAX_ALLOWED_FAILURES})`,
    };
  }

  if (failedAgents.length > 0) {
    console.warn(
      `[IntelligenceAgents] ${failedAgents.length}/14 agents failed (within threshold): ${failedAgents.join(', ')}`,
    );
  }

  console.log(
    `[IntelligenceAgents] Completed: ${successfulAgents.length} succeeded, ${failedAgents.length} failed (using fallbacks)`,
  );

  return {
    signals,
    failedAgents,
    successfulAgents,
    aborted: false,
  };
}
