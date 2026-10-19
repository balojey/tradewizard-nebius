# TradeWizard V2 - Platform Architecture & New Direction

## Executive Summary

TradeWizard V2 evolves from a successful demo into a production-grade platform designed to serve tens of millions of users. The core intelligence remains the same - a multi-agent debate engine that produces explainable, probability-driven trading strategies - but the infrastructure, delivery model, and business logic are rebuilt for scale on AWS.

Key shifts:

- **Analysis workflow moves to Amazon Bedrock AgentCore** with agent orchestration via Strands SDK
- **Fully AWS-native infrastructure** - RDS, Cognito, ElastiCache, API Gateway, SQS, SNS, S3, EventBridge
- **User-initiated analysis** replaces always-on monitoring - users opt-in per market
- **Smart deduplication** prevents redundant execution internally to optimize *our* infrastructure costs
- **Subscription-based pricing** with a free tier and credit system
- **Event-driven architecture** decouples analysis execution from delivery

### Cost Philosophy

Deduplication is an **internal cost optimization** - it saves TradeWizard money on Bedrock invocations. From the user's perspective, every analysis request they make consumes a credit from their account, whether the system executes a fresh analysis or serves a cached result. The user pays for access to intelligence, not for compute.

---

## 1. Core Product Model

### What stays the same

- Multi-agent debate protocol (bull/bear thesis, cross-examination, consensus engine)
- Explainable recommendations with reasoning chains
- Real market execution via Polymarket
- Agent memory and closed-loop learning

### What changes

| Aspect | V1 (Demo) | V2 (Scale) |
|--------|-----------|-------------|
| Analysis trigger | Manual CLI or monitoring service | User-initiated (one-time or interval) |
| Orchestration | LangGraph on single Node.js process | Amazon Bedrock AgentCore + Strands SDK |
| Infrastructure | Supabase + single server | Fully AWS-native (RDS, Cognito, SQS, etc.) |
| Cost optimization | None | Internal deduplication saves Bedrock costs |
| Delivery | Synchronous response | Async with multi-channel notification |
| Pricing | Free | Subscription tiers + free plan |

---

## 2. User-Initiated Analysis Model

Users discover markets through the TradeWizard frontend. When a user finds a market they want intelligence on, they choose one of two modes:

### One-Time Analysis

- Single execution of the full debate protocol against the market's current state
- Results delivered immediately (or within seconds via async notification)
- Consumes 1 analysis credit from the user's account

### Interval Analysis (Recurring)

- User selects an interval: 1 hour, 4 hours, 12 hours, 1 day
- System schedules recurring analysis at the chosen cadence
- Each delivery consumes 1 analysis credit from the user's account
- User can cancel at any time
- Results pushed via notification (in-app, email, or webhook)

### User Experience Flow

```
User views market
  → "Get Analysis" button
  → Choose: One-Time | Recurring
  → If Recurring: select interval (1h, 4h, 12h, 1d)
  → Confirm (checks credit balance)
  → Analysis queued
  → Results delivered when ready
  → 1 credit deducted upon delivery
```

---

## 3. Smart Deduplication & Request Coalescing

This is our **internal cost management** backbone. It ensures we never pay for redundant Bedrock executions for the same market within overlapping time windows. Users are unaware of this - they always pay 1 credit per analysis delivery.

### How it works (internal)

1. When a user requests analysis for market X, the system checks:
   - Is there a **completed analysis** for market X within the current time window?
   - Is there a **pending analysis** for market X currently in-flight?

2. If a recent analysis exists within the window → serve the cached result to the user (saves us a Bedrock invocation)

3. If an analysis is in-flight → subscribe the user to receive the result when it completes (saves us a duplicate invocation)

4. If no recent analysis exists → queue a new Bedrock execution

### Credit Behavior (User-Facing)

- User requests analysis → 1 credit deducted regardless of internal execution
- User gets the result → same quality whether fresh or cached
- The user never knows or cares whether it was cached - they paid for intelligence access

### Time Window Logic

The deduplication window is determined by the shortest active interval for that market:

- If User A requests 1-hour interval analysis at 12:00 PM → analysis runs at 12:00 PM
- If User B requests 1-hour interval analysis at 12:30 PM → User B receives the 12:00 PM result immediately (1 credit deducted from User B, but no new Bedrock execution for us)
- At 1:00 PM → next analysis runs, both User A and User B receive it (1 credit each)

### Alignment Strategy

Rather than running separate analysis per user, the system maintains a **market analysis schedule**:

```
Market X:
  - Shortest active interval: 1 hour
  - Next scheduled run: 1:00 PM
  - Subscribers: [User A, User B, User C]
  - Last completed analysis: 12:00 PM (result_id: abc123)
```

When a new subscriber joins:
- They immediately receive the most recent completed analysis (1 credit deducted)
- They are added to the subscriber list for future deliveries

When the last subscriber cancels:
- The scheduled analysis is deactivated
- No more Bedrock invocations for that market

### Deduplication for One-Time Requests

One-time requests also benefit from internal coalescing:
- If a completed analysis exists within the last 15 minutes → serve cached result (saves us execution cost)
- If an analysis is in-flight → wait for it and deliver
- Otherwise → trigger new Bedrock execution

This 15-minute freshness window is configurable and balances our cost vs. data freshness.

### Why This Matters at Scale

At 1M users, many will request analysis on the same popular markets. Without deduplication, 10,000 users requesting the same market in the same hour = 10,000 Bedrock executions ($1,000-$1,900). With deduplication = 1 execution (~$0.15). We collect 10,000 credits worth of revenue either way.

---

## 4. Architecture Overview (Fully AWS-Native)

```
┌─────────────────────────────────────────────────────────────────────────┐
│                         TradeWizard Platform (AWS)                       │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  ┌──────────────┐     ┌──────────────────┐     ┌────────────────────┐  │
│  │   Frontend   │────▶│  Amazon API      │────▶│  Amazon Cognito    │  │
│  │  (Next.js    │     │  Gateway (REST   │     │  (Auth, User Mgmt) │  │
│  │   on AWS     │     │  + WebSocket)    │     │                    │  │
│  │   Amplify)   │     └────────┬─────────┘     └────────────────────┘  │
│  └──────────────┘              │                                        │
│                                ▼                                        │
│  ┌─────────────────────────────────────────────────────────────────┐   │
│  │            Analysis Request Service (AWS Lambda / ECS)           │   │
│  │                                                                 │   │
│  │  • Request validation & credit check                            │   │
│  │  • Deduplication engine (ElastiCache lookup)                    │   │
│  │  • Schedule manager (EventBridge Scheduler)                     │   │
│  │  • Result cache & subscriber registry                           │   │
│  └──────────────────────────────┬──────────────────────────────────┘   │
│                                 │                                       │
│                    ┌────────────┼────────────┐                          │
│                    ▼            ▼            ▼                          │
│  ┌────────────────────┐ ┌───────────┐ ┌──────────────────────────┐    │
│  │  Amazon SQS        │ │EventBridge│ │  Amazon ElastiCache      │    │
│  │  (Analysis Queue)  │ │(Scheduler)│ │  (Redis - Dedup Cache)   │    │
│  └─────────┬──────────┘ └───────────┘ └──────────────────────────┘    │
│            │                                                           │
│            ▼                                                           │
│  ┌─────────────────────────────────────────────────────────────────┐   │
│  │              Analysis Execution Engine                            │   │
│  │              (Amazon Bedrock AgentCore + Strands SDK)             │   │
│  │                                                                 │   │
│  │  ┌─────────┐ ┌─────────┐ ┌─────────┐ ┌─────────────────┐      │   │
│  │  │ Market  │ │  News   │ │ Polling │ │   Sentiment     │      │   │
│  │  │ Agent   │ │  Agent  │ │  Agent  │ │     Agent       │      │   │
│  │  └────┬────┘ └────┬────┘ └────┬────┘ └───────┬─────────┘      │   │
│  │       │            │           │              │                 │   │
│  │       ▼            ▼           ▼              ▼                 │   │
│  │  ┌─────────────────────────────────────────────────────────┐   │   │
│  │  │         Thesis + Cross-Examination + Consensus           │   │   │
│  │  └─────────────────────────┬───────────────────────────────┘   │   │
│  │                            │                                   │   │
│  │                            ▼                                   │   │
│  │  ┌─────────────────────────────────────────────────────────┐   │   │
│  │  │              Recommendation Generation                   │   │   │
│  │  └─────────────────────────────────────────────────────────┘   │   │
│  └──────────────────────────────┬──────────────────────────────────┘   │
│                                 │                                       │
│                                 ▼                                       │
│  ┌─────────────────────────────────────────────────────────────────┐   │
│  │                   Delivery & Notification                        │   │
│  │                                                                 │   │
│  │  • In-app (WebSocket via API Gateway)                           │   │
│  │  • Push notifications (Amazon SNS → Mobile Push)                │   │
│  │  • Email (Amazon SES)                                           │   │
│  │  • Webhook (Amazon EventBridge → HTTP target)                   │   │
│  └─────────────────────────────────────────────────────────────────┘   │
│                                                                         │
├─────────────────────────────────────────────────────────────────────────┤
│                        Data & Persistence (AWS)                          │
│                                                                         │
│  ┌──────────────────┐  ┌──────────────────┐  ┌──────────────────────┐  │
│  │  Amazon RDS      │  │ Amazon           │  │   Amazon S3          │  │
│  │  (PostgreSQL)    │  │ ElastiCache      │  │  (Analysis artifacts,│  │
│  │  - Users         │  │ (Redis)          │  │   agent traces,      │  │
│  │  - Subscriptions │  │  - Dedup cache   │  │   raw payloads)      │  │
│  │  - Results       │  │  - Session store │  │                      │  │
│  │  - Schedules     │  │  - Rate limiting │  │                      │  │
│  │  - Credits       │  │                  │  │                      │  │
│  └──────────────────┘  └──────────────────┘  └──────────────────────┘  │
│                                                                         │
│  ┌──────────────────┐  ┌──────────────────┐  ┌──────────────────────┐  │
│  │  Amazon DynamoDB │  │ Amazon           │  │   AWS CloudWatch     │  │
│  │  (High-speed     │  │ EventBridge      │  │  (Metrics, Logs,     │  │
│  │   lookups:       │  │ (Event bus,      │  │   Alarms, Dashboards)│  │
│  │   sessions,      │  │  scheduling,     │  │                      │  │
│  │   rate limits)   │  │  routing)        │  │                      │  │
│  └──────────────────┘  └──────────────────┘  └──────────────────────┘  │
└─────────────────────────────────────────────────────────────────────────┘
```

### AWS Service Mapping

| Concern | AWS Service | Purpose |
|---------|-------------|---------|
| Authentication | Amazon Cognito | User sign-up, sign-in, MFA, token management |
| API Layer | Amazon API Gateway | REST APIs + WebSocket for real-time |
| Compute | AWS Lambda + Amazon ECS (Fargate) | Request handling (Lambda), long-running analysis orchestration (ECS) |
| Database | Amazon RDS (PostgreSQL) | Users, subscriptions, results, schedules, credits |
| Cache | Amazon ElastiCache (Redis) | Deduplication cache, rate limiting, session store |
| Fast Lookups | Amazon DynamoDB | High-speed session/rate-limit lookups |
| Queue | Amazon SQS | Analysis request queue with dead-letter support |
| Scheduling | Amazon EventBridge Scheduler | Recurring analysis triggers |
| Event Bus | Amazon EventBridge | Event routing between services |
| AI Execution | Amazon Bedrock AgentCore | Multi-agent analysis workflow |
| Email | Amazon SES | Transactional emails, digests |
| Push/SMS | Amazon SNS | Push notifications, SMS alerts |
| Object Storage | Amazon S3 | Agent traces, raw payloads, artifacts |
| Monitoring | Amazon CloudWatch | Metrics, logs, alarms, dashboards |
| CDN/Hosting | AWS Amplify / CloudFront | Frontend hosting and CDN |
| Secrets | AWS Secrets Manager | API keys, credentials |
| IaC | AWS CDK | Infrastructure as code |

---

## 5. Amazon Bedrock AgentCore + Strands SDK

### Why Bedrock AgentCore

- **Managed infrastructure**: No need to manage agent compute, scaling, or orchestration ourselves
- **Multi-model access**: Native access to Nova, Claude, Llama, and other foundation models via a single API
- **Built-in tool use**: Agents can call tools (APIs, databases, code execution) natively
- **Scalability**: Handles thousands of concurrent agent sessions without custom scaling logic
- **Cost efficiency**: Pay-per-invocation model - we only pay when agents actually run
- **Observability**: Built-in tracing and logging for debugging agent behavior at scale
- **AWS-native**: Integrates seamlessly with IAM, CloudWatch, S3, and other services

### Why Strands SDK for Orchestration

Strands is the Python/TypeScript SDK for building multi-agent workflows on Bedrock AgentCore:

- **Agent-as-code**: Define agents with tools, instructions, and model selection in code
- **Multi-agent coordination**: Orchestrate parallel and sequential agent execution
- **State management**: Pass context between agents in a workflow
- **Tool integration**: Wrap external APIs (Polymarket, etc.) and browser access as agent tools
- **Browser tool**: Agents can browse the web autonomously - no need for dedicated news/search API subscriptions
- **Streaming**: Stream intermediate results for real-time UX updates
- **Native AWS integration**: Direct access to Bedrock models, S3, DynamoDB from within agents

### Full Agentic Workflow (Debate Protocol)

The TradeWizard analysis workflow is a multi-stage pipeline that transforms raw market data into an actionable trade recommendation through adversarial debate. This is the complete workflow as it exists today, ported to Strands on Bedrock AgentCore.

#### Workflow Stages (Sequential)

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                    TRADEWIZARD ANALYSIS WORKFLOW                             │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  Stage 1: MARKET INGESTION                                                  │
│  ─────────────────────────                                                  │
│  • Fetch market data from Polymarket CLOB API + Gamma API                   │
│  • Build Market Briefing Document (MBD):                                    │
│    - Market question, resolution criteria, expiry                           │
│    - Current probability, bid/ask spread, volume                            │
│    - Liquidity score, volatility regime                                     │
│    - Key catalysts with timestamps                                          │
│  • If ingestion fails → workflow ends early with error                      │
│                                                                             │
│                              ▼                                              │
│                                                                             │
│  Stage 2: MEMORY RETRIEVAL                                                  │
│  ─────────────────────────                                                  │
│  • Load historical agent signals for this market from database              │
│  • Provides context for all 14 intelligence agents                          │
│  • Enables closed-loop learning (agents see their past predictions)         │
│  • Memory context keyed by agent name → historical signals                  │
│                                                                             │
│                              ▼                                              │
│                                                                             │
│  Stage 3: WEB RESEARCH (Required)                                           │
│  ────────────────────────────────                                           │
│  • Autonomous web research agent with browser tool                          │
│  • Gathers real-time context about the market from the open web             │
│  • Searches for breaking news, recent developments, expert opinions         │
│  • Produces a research brief that ALL downstream agents use for reasoning   │
│  • This is the primary external data gathering stage - no dedicated         │
│    news APIs needed, the agent browses the web like a human researcher      │
│                                                                             │
│                              ▼                                              │
│                                                                             │
│  Stage 4: AGENT SELECTION                                                   │
│  ────────────────────────────                                               │
│  • All 14 intelligence agents are activated for every market                │
│  • No conditional filtering by market type - full analysis always           │
│  • Agent categories:                                                        │
│    - MVP: market_microstructure, probability_baseline, risk_assessment      │
│    - Event: breaking_news, event_impact                                     │
│    - Statistical: polling_intelligence, historical_patterns                 │
│    - Sentiment: media_sentiment, social_sentiment, narrative_velocity       │
│    - Price action: momentum, mean_reversion                                 │
│    - Scenario: catalyst_identification, tail_risk                           │
│                                                                             │
│                              ▼                                              │
│                                                                             │
│  Stage 5: PARALLEL INTELLIGENCE AGENTS (14 agents)                          │
│  ─────────────────────────────────────────────────                          │
│  All 14 agents execute IN PARALLEL, each producing an                       │
│  independent AgentSignal with:                                              │
│    - direction (YES / NO / NEUTRAL)                                         │
│    - confidence (0-1)                                                       │
│    - fairProbability (0-1)                                                  │
│    - keyDrivers[]                                                           │
│    - riskFactors[]                                                          │
│                                                                             │
│  ┌─────────────────────────────────────────────────────────────────────┐    │
│  │ MVP AGENTS (always active):                                         │    │
│  │  • Market Microstructure Agent (autonomous, tools: browser, CLOB)   │    │
│  │    - Monitors order books, spreads, liquidity, whale activity       │    │
│  │  • Probability Baseline Agent                                       │    │
│  │    - Models base probability from market fundamentals               │    │
│  │  • Risk Assessment Agent                                            │    │
│  │    - Evaluates downside risk, tail scenarios, volatility            │    │
│  ├─────────────────────────────────────────────────────────────────────┤    │
│  │ EVENT INTELLIGENCE AGENTS:                                          │    │
│  │  • Breaking News Agent (autonomous, tools: browser)                 │    │
│  │    - Browses news sites, detects market-moving headlines            │    │
│  │    - Searches for regime shifts and breaking developments           │    │
│  │  • Event Impact Agent                                               │    │
│  │    - Models how events reprice markets, historical reactions        │    │
│  ├─────────────────────────────────────────────────────────────────────┤    │
│  │ POLLING & STATISTICAL AGENTS:                                       │    │
│  │  • Polling Intelligence Agent (autonomous, tools: browser)          │    │
│  │    - Browses polling aggregators, finds latest poll data            │    │
│  │    - Adjusts for bias, tracks momentum                             │    │
│  │  • Historical Pattern Agent                                         │    │
│  │    - Detects repeatable outcome patterns from past events           │    │
│  ├─────────────────────────────────────────────────────────────────────┤    │
│  │ SENTIMENT & NARRATIVE AGENTS:                                       │    │
│  │  • Media Sentiment Agent (autonomous, tools: browser)               │    │
│  │    - Browses news outlets, analyzes tone, coverage velocity         │    │
│  │  • Social Sentiment Agent (autonomous, tools: browser)              │    │
│  │    - Browses social platforms, monitors viral narratives            │    │
│  │  • Narrative Velocity Agent                                         │    │
│  │    - Measures narrative spread speed, predicts next-cycle stories   │    │
│  ├─────────────────────────────────────────────────────────────────────┤    │
│  │ PRICE ACTION AGENTS:                                                │    │
│  │  • Momentum Agent                                                   │    │
│  │    - Trades breakouts, order-flow momentum, short-term expansion    │    │
│  │  • Mean Reversion Agent                                             │    │
│  │    - Trades overextension, crowd overreaction, fades extreme moves  │    │
│  ├─────────────────────────────────────────────────────────────────────┤    │
│  │ EVENT SCENARIO AGENTS:                                              │    │
│  │  • Catalyst Agent (autonomous, tools: browser)                      │    │
│  │    - Browses event calendars, tracks upcoming debates/rulings       │    │
│  │  • Tail Risk Agent                                                  │    │
│  │    - Detects underpriced surprise risk, asymmetric payoffs          │    │
│  └─────────────────────────────────────────────────────────────────────┘    │
│                                                                             │
│                              ▼                                              │
│                                                                             │
│  Stage 6: AGENT SIGNAL FUSION                                               │
│  ────────────────────────────                                               │
│  • Aggregates all agent signals into a unified fused signal                 │
│  • Dynamic weighting based on:                                              │
│    - Agent type (polling 1.5x, event intel 1.2x, sentiment 0.8x, etc.)     │
│    - Agent confidence level                                                 │
│    - Data freshness (stale data = lower weight)                             │
│    - Market liquidity (for price action agents)                             │
│    - Historical performance (leaderboard accuracy)                          │
│  • Detects signal conflicts (divergent probability estimates > 20%)         │
│  • Calculates signal alignment (how much agents agree)                      │
│  • Produces: weighted fair probability, fusion confidence, conflict map     │
│  • Extreme divergence (>70% range) triggers confidence penalty              │
│                                                                             │
│                              ▼                                              │
│                                                                             │
│  Stage 7: THESIS CONSTRUCTION                                               │
│  ────────────────────────────                                               │
│  • LLM generates two competing theses from fused signal:                    │
│    - BULL THESIS (argues for YES outcome):                                  │
│      · Fair probability, edge vs market, core argument                      │
│      · Catalysts favoring YES, failure conditions                           │
│    - BEAR THESIS (argues for NO outcome):                                   │
│      · Fair probability, edge vs market, core argument                      │
│      · Catalysts favoring NO, failure conditions                            │
│  • Uses structured output (Zod schema) for reliable parsing                 │
│  • Minimum agent threshold enforced (won't proceed without enough signals)  │
│                                                                             │
│                              ▼                                              │
│                                                                             │
│  Stage 8: CROSS-EXAMINATION                                                 │
│  ──────────────────────────                                                 │
│  • Adversarial testing of BOTH theses through 5 structured tests:           │
│    1. EVIDENCE TEST - Are factual claims verifiable and accurate?            │
│    2. CAUSALITY TEST - Does the thesis confuse correlation/causation?        │
│    3. TIMING TEST - Are catalyst timelines realistic given market expiry?    │
│    4. LIQUIDITY TEST - Can the position be executed without slippage?        │
│    5. TAIL RISK TEST - Are low-probability high-impact scenarios covered?    │
│  • Each test applied to BOTH bull and bear theses (10 tests total)          │
│  • Each test produces: outcome (survived/weakened/refuted) + score (-1 to 1)│
│  • Aggregate bull score and bear score determine thesis strength             │
│  • Key disagreements identified between theses                              │
│                                                                             │
│                              ▼                                              │
│                                                                             │
│  Stage 9: CONSENSUS ENGINE                                                  │
│  ──────────────────────────                                                 │
│  • Calculates weighted consensus probability from:                          │
│    - Bull/bear fair probabilities weighted by debate scores                 │
│    - Per-agent signal weights (confidence × leaderboard accuracy)           │
│  • Computes disagreement index (standard deviation of agent probabilities)  │
│  • If disagreement > 30% → consensus fails (too much uncertainty)           │
│  • Calculates confidence band (widens with disagreement)                    │
│  • Classifies regime: high-confidence / moderate-confidence / high-uncertainty│
│  • Detects efficiently priced markets (edge < 3%)                           │
│                                                                             │
│                              ▼                                              │
│                                                                             │
│  Stage 10: RISK PHILOSOPHY AGENTS (parallel)                                │
│  ───────────────────────────────────────────                                │
│  Three agents run IN PARALLEL after consensus, each providing a             │
│  different risk management perspective:                                     │
│                                                                             │
│  • AGGRESSIVE AGENT:                                                        │
│    - Maximum EV, concentrated positions                                     │
│    - Kelly criterion sizing, conviction levels                              │
│    - Variance warnings                                                      │
│                                                                             │
│  • CONSERVATIVE AGENT:                                                      │
│    - Capital preservation, hedging strategies                               │
│    - Stop-loss levels, max drawdown tolerance                               │
│    - Downside protection                                                    │
│                                                                             │
│  • NEUTRAL AGENT:                                                           │
│    - Market-neutral, spread trades, arbitrage                               │
│    - Paired positions, low directional exposure                             │
│    - Consistent low-risk returns                                            │
│                                                                             │
│                              ▼                                              │
│                                                                             │
│  Stage 11: RECOMMENDATION GENERATION                                        │
│  ────────────────────────────────────                                       │
│  • Determines final trade action:                                           │
│    - LONG_YES if consensus > market probability                             │
│    - LONG_NO if consensus < market probability                              │
│    - NO_TRADE if edge < minimum threshold (5%) or negative EV               │
│  • Calculates:                                                              │
│    - Expected value per $100 invested                                       │
│    - Entry zone (market price ± 2%)                                         │
│    - Target zone (consensus probability ± confidence band)                  │
│    - Stop-loss (3-3.5% below entry, adjusted for liquidity)                 │
│    - Win probability                                                        │
│    - Liquidity risk level                                                   │
│  • Generates natural language explanation via LLM:                          │
│    - 2-3 sentence summary                                                   │
│    - Core thesis argument                                                   │
│    - Key catalysts                                                          │
│    - Failure scenarios                                                      │
│    - Risk philosophy perspectives (position sizing guidance)                │
│    - Uncertainty note (if high disagreement)                                │
│  • Incorporates risk philosophy signals into final recommendation           │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

#### Workflow Output (TradeRecommendation)

The final output delivered to the user contains:

```json
{
  "marketId": "0x...",
  "action": "LONG_YES | LONG_NO | NO_TRADE",
  "entryZone": [0.61, 0.65],
  "targetZone": [0.69, 0.75],
  "stopLoss": 0.58,
  "expectedValue": 21.4,
  "winProbability": 0.69,
  "liquidityRisk": "low | medium | high",
  "explanation": {
    "summary": "Buy YES shares. Polling momentum and breaking news...",
    "coreThesis": "Strong polling trend combined with...",
    "keyCatalysts": ["Upcoming debate on June 5", "New poll release"],
    "failureScenarios": ["Scandal breaks before resolution", "..."],
    "uncertaintyNote": "Moderate agent disagreement (18%) suggests...",
    "riskPerspectives": "Aggressive: 25% position (Kelly 0.31). Conservative: 8% with stop at 0.58."
  },
  "metadata": {
    "consensusProbability": 0.69,
    "marketProbability": 0.63,
    "edge": 0.06,
    "confidenceBand": [0.62, 0.75]
  }
}
```

#### Mapping to Strands SDK on Bedrock AgentCore

```python
# Strands workflow definition (conceptual)

from strands import Agent, Workflow, ParallelGroup, Tool

workflow = Workflow("market-analysis")

# Stage 1: Market Ingestion
market_agent = Agent(
    name="market-ingestion",
    model="amazon.nova-2-lite-v1:0",
    tools=[polymarket_clob_tool, gamma_api_tool],
    instructions="Fetch market data and build Market Briefing Document..."
)

# Stage 2: Memory Retrieval
memory_agent = Agent(
    name="memory-retrieval",
    model="amazon.nova-2-lite-v1:0",
    tools=[rds_query_tool],
    instructions="Load historical agent signals for this market..."
)

# Stage 3: Web Research (REQUIRED - primary external data gathering)
web_research_agent = Agent(
    name="web-research",
    model="amazon.nova-2-lite-v1:0",
    tools=[browser_tool],
    instructions="""Research current events relevant to this market.
    Browse news sites, social media, polling aggregators, and any relevant sources.
    Produce a comprehensive research brief that all downstream agents will use.
    You are the primary data gatherer - search broadly and deeply."""
)

# Stage 4: Agent Selection (all 14 agents, always)
# No conditional filtering - every market gets the full analysis pipeline
selected_agents = _select_agents()  # Returns all 14 agent names

# Stage 5: Parallel Intelligence Agents
# All agents have access to browser_tool for autonomous web research
intelligence_agents = ParallelGroup([
    Agent(name="market-microstructure", model="amazon.nova-2-lite-v1:0",
          tools=[browser_tool, polymarket_clob_tool]),
    Agent(name="probability-baseline", model="amazon.nova-2-lite-v1:0",
          tools=[browser_tool]),
    Agent(name="risk-assessment", model="amazon.nova-2-lite-v1:0",
          tools=[browser_tool]),
    Agent(name="breaking-news", model="amazon.nova-2-lite-v1:0",
          tools=[browser_tool]),
    Agent(name="event-impact", model="amazon.nova-2-lite-v1:0",
          tools=[browser_tool]),
    Agent(name="polling-intelligence", model="amazon.nova-2-lite-v1:0",
          tools=[browser_tool]),
    Agent(name="historical-pattern", model="amazon.nova-2-lite-v1:0",
          tools=[browser_tool]),
    Agent(name="media-sentiment", model="amazon.nova-2-lite-v1:0",
          tools=[browser_tool]),
    Agent(name="social-sentiment", model="amazon.nova-2-lite-v1:0",
          tools=[browser_tool]),
    Agent(name="narrative-velocity", model="amazon.nova-2-lite-v1:0",
          tools=[browser_tool]),
    Agent(name="momentum", model="amazon.nova-2-lite-v1:0",
          tools=[browser_tool]),
    Agent(name="mean-reversion", model="amazon.nova-2-lite-v1:0",
          tools=[browser_tool]),
    Agent(name="catalyst", model="amazon.nova-2-lite-v1:0",
          tools=[browser_tool]),
    Agent(name="tail-risk", model="amazon.nova-2-lite-v1:0",
          tools=[browser_tool]),
])

# Stage 6: Signal Fusion (deterministic, no LLM needed)
# Implemented as code logic, not an agent

# Stage 7: Thesis Construction
thesis_agent = Agent(
    name="thesis-construction",
    model="amazon.nova-2-lite-v1:0",
    instructions="Generate bull and bear theses from fused signal..."
)

# Stage 8: Cross-Examination
cross_exam_agent = Agent(
    name="cross-examination",
    model="amazon.nova-2-lite-v1:0",
    instructions="Apply 5 adversarial tests to both theses..."
)

# Stage 9: Consensus Engine (deterministic, no LLM needed)
# Implemented as code logic with leaderboard weighting

# Stage 10: Risk Philosophy Agents (parallel)
risk_agents = ParallelGroup([
    Agent(name="aggressive", model="amazon.nova-2-lite-v1:0",
          instructions="Maximize EV, Kelly criterion, concentrated positions..."),
    Agent(name="conservative", model="amazon.nova-2-lite-v1:0",
          instructions="Capital preservation, hedging, stop-losses..."),
    Agent(name="neutral", model="amazon.nova-2-lite-v1:0",
          instructions="Market-neutral, spreads, arbitrage..."),
])

# Stage 11: Recommendation Generation
recommendation_agent = Agent(
    name="recommendation-generation",
    model="amazon.nova-2-lite-v1:0",
    instructions="Generate final trade recommendation with explanation..."
)

# Wire the workflow (11 stages, down from 12 - keyword extraction removed)
workflow.add_sequential([
    market_agent,
    memory_agent,
    web_research_agent,       # required, gathers context for all agents
    selection_agent,
    intelligence_agents,      # parallel, all have browser access
    "signal_fusion_logic",    # code node
    thesis_agent,
    cross_exam_agent,
    "consensus_logic",        # code node
    risk_agents,              # parallel
    recommendation_agent,
])
```

#### Key Design Decisions in the Workflow

1. **Browser-native agents**: All intelligence agents have access to a browser tool. They can autonomously search the web, visit news sites, check polling aggregators, browse social platforms - no dedicated API subscriptions (NewsData, Serper, etc.) needed. Agents are skilled at crafting queries and navigating the web like human researchers.

2. **Web research is mandatory**: The Web Research Agent runs before all intelligence agents and produces a comprehensive research brief. This brief becomes shared context that all downstream agents use for their reasoning. It's the primary external data gathering stage.

3. **No keyword extraction**: Removed as redundant. Agents are intelligent enough to understand market context directly from the MBD and web research brief without needing pre-extracted keywords.

4. **All agents run on every market**: All 14 intelligence agents execute in parallel for every analysis regardless of market type. This ensures comprehensive coverage - every market benefits from the full breadth of perspectives (price action, sentiment, events, tail risk, etc.). The cost increase is justified by analysis quality.

5. **Signal fusion is deterministic**: No LLM call - it's pure math (weighted averages, conflict detection, alignment scoring). This makes it fast, cheap, and reproducible.

6. **Cross-examination is adversarial**: The same LLM argues against both theses. This prevents confirmation bias and groupthink that would occur if agents only reinforced each other.

7. **Consensus can fail**: If agent disagreement exceeds 30%, the system refuses to produce a recommendation rather than giving a low-confidence one. Integrity over output.

8. **Risk philosophy is post-consensus**: The three risk agents don't influence the probability estimate - they only influence position sizing and risk management in the final recommendation.

9. **Negative EV rejection**: Even if there's an edge, if expected value is negative (due to market structure), the system recommends NO_TRADE.

#### Agent Web Search Skill

All agents with browser access are equipped with a **Web Search Skill** - a set of instructions included in their system prompt that teaches them how to effectively find information on the web. This skill is critical because agents that can craft precise queries find better data faster, reducing both latency and token usage.

**The skill covers:**

##### Search Operators & Query Syntax

| Operator | Usage | Example |
|----------|-------|---------|
| `"exact phrase"` | Find exact matches | `"Trump indictment ruling"` |
| `site:` | Search within a specific site | `site:reuters.com Ukraine ceasefire` |
| `intitle:` | Term must appear in page title | `intitle:"election poll" 2026` |
| `inurl:` | Term must appear in URL | `inurl:results midterm 2026` |
| `-` (minus) | Exclude a term | `prediction market -crypto -sports` |
| `OR` | Either term | `"supreme court" OR "scotus" ruling` |
| `before:` / `after:` | Date range filtering | `after:2026-05-01 "fed rate decision"` |
| `filetype:` | Specific file types | `filetype:pdf "election forecast"` |
| `*` (wildcard) | Unknown word placeholder | `"* wins * primary 2026"` |
| `related:` | Find similar sites | `related:polymarket.com` |

##### Query Crafting Strategies

1. **Start broad, then narrow**: Begin with a general query to understand the landscape, then add operators to zero in on specifics.
   - Broad: `2026 senate race polls`
   - Narrow: `"2026 senate race" site:fivethirtyeight.com OR site:realclearpolling.com after:2026-05-01`

2. **Use multiple queries per task**: Don't rely on a single search. Cross-reference by searching from different angles:
   - Query 1: `"candidate name" latest poll numbers`
   - Query 2: `"candidate name" scandal OR controversy 2026`
   - Query 3: `"candidate name" endorsement OR fundraising`

3. **Source-specific searches**: Target authoritative sources directly:
   - Polling: `site:fivethirtyeight.com OR site:realclearpolling.com OR site:projects.economist.com`
   - News: `site:reuters.com OR site:apnews.com OR site:bbc.com`
   - Legal: `site:supremecourt.gov OR site:law.cornell.edu`
   - Financial: `site:bloomberg.com OR site:ft.com`
   - Social sentiment: `site:reddit.com OR site:x.com`

4. **Temporal precision**: Always include time constraints for current events:
   - `after:2026-05-10` for events in the last few days
   - `"May 2026"` for month-specific context
   - `"this week" OR "today"` for breaking news

5. **Disambiguation**: Use context terms to avoid irrelevant results:
   - Bad: `Georgia race` (state or country?)
   - Good: `"Georgia senate race" 2026 United States`

##### Navigation Strategies

1. **Follow citation chains**: When a page references a study, poll, or ruling - navigate to the primary source.
2. **Check "About" and methodology pages**: For polling data, always verify methodology and sample size.
3. **Look for data tables**: Prefer structured data (tables, charts) over narrative summaries.
4. **Check publication dates**: Discard stale information. For prediction markets, data older than 24-48 hours may be outdated.
5. **Cross-validate claims**: If one source makes a strong claim, verify it against at least one other independent source.

##### Domain-Specific Search Patterns

**For Election Markets:**
```
"[candidate] poll" site:fivethirtyeight.com after:[date]
"[state] senate race" polling average 2026
"[candidate]" approval rating trend
```

**For Court/Legal Markets:**
```
"[case name]" ruling OR decision site:scotusblog.com
"[case name]" oral arguments analysis
"[judge name]" opinion OR dissent [topic]
```

**For Economic Markets:**
```
"fed funds rate" forecast OR prediction [month] [year]
"inflation" CPI data site:bls.gov OR site:fred.stlouisfed.org
"[economic indicator]" consensus estimate
```

**For Geopolitical Markets:**
```
"[country]" "[event]" site:reuters.com OR site:bbc.com after:[date]
"[leader name]" statement OR announcement [topic]
"[conflict/negotiation]" latest development
```

This skill is injected into every agent's system prompt as part of their instructions, ensuring consistent high-quality web research across the entire agent fleet.

### Model Selection Strategy

All agents use **Amazon Nova 2 Lite** (`amazon.nova-2-lite-v1:0`) as the single model across the entire workflow. This simplifies deployment, reduces cost, and leverages Nova 2 Lite's strong tool-calling and reasoning capabilities.

| Agent Type | Model | Rationale |
|-----------|-------|-----------|
| All agents (unified) | Amazon Nova 2 Lite (`amazon.nova-2-lite-v1:0`) | Cost-efficient, strong tool-calling, fast inference, native Bedrock integration |
| Signal fusion + consensus | No LLM (code logic) | Deterministic, fast, reproducible |

**Why a single model:**
- **Cost**: Nova 2 Lite is significantly cheaper per token than Claude or GPT-4, critical when running 30+ calls per analysis
- **Speed**: Lower latency means faster end-to-end analysis completion
- **Simplicity**: One model to tune, monitor, and optimize - no multi-provider complexity
- **Native**: First-party AWS model with best Bedrock AgentCore integration and tool-calling support
- **Scale**: Favorable pricing at high volume, no cross-provider rate limit concerns

### Estimated LLM Calls Per Analysis

| Stage | LLM Calls | Model |
|-------|-----------|-------|
| Market ingestion | 0 (API calls only) | - |
| Memory retrieval | 0 (DB query only) | - |
| Web research | 1-5 (browsing iterations) | Nova 2 Lite |
| Agent selection | 0 (code logic, all 14 always) | - |
| Intelligence agents | 14 (always, parallel) + browser calls | Nova 2 Lite |
| Signal fusion | 0 (code logic) | - |
| Thesis construction | 2 (bull + bear) | Nova 2 Lite |
| Cross-examination | 10 (5 tests × 2 theses) | Nova 2 Lite |
| Consensus engine | 0 (code logic) | - |
| Risk philosophy | 3 (parallel) | Nova 2 Lite |
| Recommendation | 1 | Nova 2 Lite |
| **Total** | **~31-35 LLM calls** | - |

Note: Intelligence agents with browser access may make additional LLM calls during their browsing sessions (each page visit = 1 additional call). The actual count depends on how many pages each agent needs to visit. Budget for ~40-50 total calls in worst case.

This is why deduplication matters so much at scale - each fresh analysis costs 30-50 LLM invocations.

---

## 6. Analysis Request Service (The Brain)

This service is the central coordinator. It runs on AWS Lambda (for request intake) and ECS Fargate (for orchestration). It sits between the user-facing API Gateway and the Bedrock execution engine.

### Responsibilities

1. **Request intake**: Validate analysis requests, check user credits via RDS
2. **Credit deduction**: Deduct 1 credit immediately upon valid request (always)
3. **Deduplication**: Check ElastiCache for recent results or in-flight analyses (internal optimization)
4. **Scheduling**: Manage recurring analysis subscriptions via EventBridge Scheduler
5. **Dispatch**: Send execution requests to Bedrock AgentCore (only if no cache hit)
6. **Result handling**: Store results in RDS + S3, notify subscribers via SNS/WebSocket

### Database Schema (Amazon RDS PostgreSQL)

```sql
-- ============================================================================
-- USERS & AUTH
-- ============================================================================

-- Users (synced from Cognito via post-confirmation Lambda trigger)
CREATE TABLE users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  cognito_sub TEXT NOT NULL UNIQUE,
  email TEXT NOT NULL UNIQUE,
  display_name TEXT,
  status TEXT NOT NULL DEFAULT 'active', -- active, suspended, deleted
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ============================================================================
-- SUBSCRIPTIONS & BILLING
-- ============================================================================

-- User subscriptions (one active subscription per user)
CREATE TABLE subscriptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  plan TEXT NOT NULL DEFAULT 'free', -- free, starter, pro, elite
  status TEXT NOT NULL DEFAULT 'active', -- active, cancelled, past_due, trialing
  credits_remaining INTEGER NOT NULL DEFAULT 5,
  credits_monthly_limit INTEGER NOT NULL DEFAULT 5,
  billing_cycle_start TIMESTAMPTZ NOT NULL,
  billing_cycle_end TIMESTAMPTZ NOT NULL, -- when credits refresh
  stripe_customer_id TEXT,
  stripe_subscription_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  cancelled_at TIMESTAMPTZ,
  CONSTRAINT one_active_subscription_per_user UNIQUE (user_id) -- enforces 1:1
);

-- Credit transactions (immutable audit trail)
CREATE TABLE credit_transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  amount INTEGER NOT NULL, -- negative = consumed, positive = granted
  balance_after INTEGER NOT NULL, -- snapshot of credits_remaining after this transaction
  reason TEXT NOT NULL, -- 'analysis_request', 'monthly_refresh', 'plan_upgrade', 'credit_pack_purchase', 'refund'
  reference_id UUID, -- points to analysis_requests.id, subscriptions.id, etc.
  reference_type TEXT, -- 'analysis_request', 'subscription', 'credit_pack'
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ============================================================================
-- MARKETS (cached metadata)
-- ============================================================================

-- Market metadata cache (refreshed periodically from Polymarket APIs)
CREATE TABLE markets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  condition_id TEXT NOT NULL UNIQUE, -- Polymarket condition ID
  question TEXT NOT NULL,
  description TEXT,
  resolution_criteria TEXT,
  event_type TEXT, -- election, court, policy, economic, geopolitical, other
  expiry_at TIMESTAMPTZ,
  is_active BOOLEAN NOT NULL DEFAULT true,
  current_probability NUMERIC(5, 4), -- latest known probability
  volume_24h NUMERIC(12, 2),
  liquidity_score NUMERIC(4, 2),
  last_synced_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ============================================================================
-- ANALYSIS REQUESTS & SCHEDULING
-- ============================================================================

-- Analysis requests (one-time and recurring, user-facing)
CREATE TABLE analysis_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  market_id TEXT NOT NULL, -- Polymarket condition ID (references markets.condition_id)
  request_type TEXT NOT NULL, -- 'one_time', 'recurring'
  interval_seconds INTEGER, -- NULL for one-time; 3600, 14400, 43200, 86400 for recurring
  status TEXT NOT NULL DEFAULT 'active', -- active, paused, cancelled, completed
  eventbridge_schedule_arn TEXT, -- ARN of the EventBridge schedule (recurring only)
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  cancelled_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ, -- set when one-time request is fulfilled
  CONSTRAINT valid_interval CHECK (
    (request_type = 'one_time' AND interval_seconds IS NULL) OR
    (request_type = 'recurring' AND interval_seconds IS NOT NULL AND interval_seconds >= 3600)
  )
);

-- Market analysis schedule (internal deduplication backbone)
-- One row per market that has active subscribers
CREATE TABLE market_analysis_schedule (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  market_id TEXT NOT NULL UNIQUE, -- Polymarket condition ID
  shortest_interval_seconds INTEGER NOT NULL,
  next_scheduled_run TIMESTAMPTZ NOT NULL,
  last_completed_at TIMESTAMPTZ,
  last_result_id UUID, -- references analysis_results.id (set after completion)
  is_executing BOOLEAN NOT NULL DEFAULT false, -- true while Bedrock execution is in-flight
  execution_started_at TIMESTAMPTZ, -- when current execution began (for timeout detection)
  status TEXT NOT NULL DEFAULT 'active', -- active, idle (no subscribers)
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Market subscribers (junction: which users subscribe to which market's recurring analysis)
CREATE TABLE market_subscribers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  market_id TEXT NOT NULL, -- Polymarket condition ID
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  analysis_request_id UUID NOT NULL REFERENCES analysis_requests(id) ON DELETE CASCADE,
  subscribed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  unsubscribed_at TIMESTAMPTZ,
  CONSTRAINT unique_user_market_subscription UNIQUE (market_id, user_id, analysis_request_id)
);

-- ============================================================================
-- ANALYSIS RESULTS & DELIVERY
-- ============================================================================

-- Analysis results (immutable - one row per actual Bedrock execution)
CREATE TABLE analysis_results (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  market_id TEXT NOT NULL, -- Polymarket condition ID
  executed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  execution_duration_ms INTEGER,
  total_llm_calls INTEGER, -- how many LLM invocations this analysis used
  model_costs_usd NUMERIC(10, 6), -- total Bedrock cost for this execution
  result_payload_s3_key TEXT NOT NULL, -- S3 key for full JSON payload
  consensus_probability NUMERIC(5, 4), -- 0.0000 to 1.0000
  recommendation TEXT, -- LONG_YES, LONG_NO, NO_TRADE
  confidence_score NUMERIC(5, 4), -- 0.0000 to 1.0000
  edge NUMERIC(5, 4), -- absolute difference between consensus and market probability
  market_probability_at_execution NUMERIC(5, 4), -- market price when analysis ran
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Delivery log (who received what result, and whether it was from cache or fresh)
CREATE TABLE analysis_deliveries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  result_id UUID NOT NULL REFERENCES analysis_results(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  analysis_request_id UUID NOT NULL REFERENCES analysis_requests(id) ON DELETE CASCADE,
  was_cached_delivery BOOLEAN NOT NULL DEFAULT false, -- true if result was served from cache (no new Bedrock execution)
  delivery_channel TEXT NOT NULL, -- 'in_app', 'email', 'push', 'webhook'
  delivered_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT no_duplicate_delivery UNIQUE (result_id, user_id, analysis_request_id)
);

-- ============================================================================
-- AGENT MEMORY (closed-loop learning)
-- ============================================================================

-- Agent signals stored after each analysis for memory retrieval in future runs
CREATE TABLE agent_memory (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  market_id TEXT NOT NULL, -- Polymarket condition ID
  agent_name TEXT NOT NULL, -- e.g. 'breaking_news', 'polling_intelligence'
  result_id UUID NOT NULL REFERENCES analysis_results(id) ON DELETE CASCADE,
  direction TEXT NOT NULL, -- 'YES', 'NO', 'NEUTRAL'
  confidence NUMERIC(5, 4) NOT NULL,
  fair_probability NUMERIC(5, 4) NOT NULL,
  key_drivers JSONB NOT NULL DEFAULT '[]', -- array of strings
  risk_factors JSONB NOT NULL DEFAULT '[]', -- array of strings
  signal_timestamp TIMESTAMPTZ NOT NULL,
  -- Performance tracking (updated after market resolution)
  was_correct BOOLEAN, -- NULL until market resolves, then true/false
  accuracy_score NUMERIC(5, 4), -- how close fair_probability was to actual outcome
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Agent performance leaderboard (materialized view or table, updated periodically)
CREATE TABLE agent_performance (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_name TEXT NOT NULL UNIQUE,
  total_signals INTEGER NOT NULL DEFAULT 0,
  correct_signals INTEGER NOT NULL DEFAULT 0,
  accuracy_pct NUMERIC(5, 2) NOT NULL DEFAULT 50.00, -- percentage
  avg_confidence NUMERIC(5, 4) NOT NULL DEFAULT 0.5000,
  avg_execution_time_ms INTEGER,
  last_updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ============================================================================
-- NOTIFICATION PREFERENCES
-- ============================================================================

-- User notification preferences (per-market or global)
CREATE TABLE notification_preferences (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  market_id TEXT, -- NULL = global preference, non-NULL = market-specific override
  channel_in_app BOOLEAN NOT NULL DEFAULT true,
  channel_email BOOLEAN NOT NULL DEFAULT false,
  channel_push BOOLEAN NOT NULL DEFAULT false,
  channel_webhook BOOLEAN NOT NULL DEFAULT false,
  webhook_url TEXT, -- required if channel_webhook = true
  quiet_hours_start TIME, -- e.g. '22:00'
  quiet_hours_end TIME, -- e.g. '08:00'
  min_probability_shift NUMERIC(5, 4), -- only notify if probability shifted > this amount
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT unique_user_market_pref UNIQUE (user_id, market_id)
);

-- ============================================================================
-- INDEXES
-- ============================================================================

-- Fast deduplication lookups (most critical query path)
CREATE INDEX idx_results_market_time ON analysis_results(market_id, executed_at DESC);

-- Schedule management (scheduler queries this every minute)
CREATE INDEX idx_schedule_next_run ON market_analysis_schedule(next_scheduled_run)
  WHERE status = 'active' AND is_executing = false;

-- User request history
CREATE INDEX idx_requests_user_status ON analysis_requests(user_id, status);
CREATE INDEX idx_requests_market_status ON analysis_requests(market_id, status)
  WHERE status = 'active';

-- Subscriber lookups (for fan-out delivery)
CREATE INDEX idx_subscribers_market ON market_subscribers(market_id)
  WHERE unsubscribed_at IS NULL;

-- Credit balance (hot path on every request)
CREATE INDEX idx_subscriptions_user ON subscriptions(user_id)
  WHERE status = 'active';

-- Delivery history (user's analysis history page)
CREATE INDEX idx_deliveries_user ON analysis_deliveries(user_id, delivered_at DESC);

-- Agent memory retrieval (loaded before each analysis)
CREATE INDEX idx_agent_memory_market ON agent_memory(market_id, agent_name, signal_timestamp DESC);

-- Market lookup by condition ID
CREATE INDEX idx_markets_condition ON markets(condition_id);

-- Credit transaction audit trail
CREATE INDEX idx_credit_transactions_user ON credit_transactions(user_id, created_at DESC);
```

### Request Flow (Pseudocode)

```
function handleAnalysisRequest(userId, marketId, requestType, interval):
  
  // 1. Check credits
  if not hasCredits(userId):
    return ERROR_NO_CREDITS

  // 2. ALWAYS deduct credit from user (they pay for access)
  debitCredit(userId, 1, requestId)

  // 3. Internal optimization: check for cached result (saves US money)
  freshWindow = (requestType == 'one_time') ? 15_MINUTES : interval
  recentResult = checkElastiCache(marketId, freshWindow)
  
  if recentResult exists:
    deliverResult(userId, recentResult)
    return SUCCESS  // No Bedrock execution needed (internal savings)
  
  // 4. Check for in-flight analysis
  pendingAnalysis = checkInFlight(marketId)
  
  if pendingAnalysis exists:
    subscribeToResult(userId, pendingAnalysis)
    return SUCCESS_PENDING  // Will deliver when complete (internal savings)
  
  // 5. No cache hit → execute new analysis on Bedrock
  sendToSQS(marketId, requestId)
  subscribeToResult(userId, requestId)
  
  // 6. If recurring, create/update EventBridge schedule
  if requestType == 'recurring':
    createOrUpdateSchedule(marketId, interval, userId)
  
  return SUCCESS_QUEUED
```

---

## 7. Subscription & Pricing Model

### Plans

| Plan | Monthly Price | Analysis Credits / Month | Intervals Available | Features |
|------|--------------|--------------------------|---------------------|----------|
| **Free** | $0 | 5 | One-time only | Basic analysis, standard delivery |
| **Starter** | $19/mo | 50 | One-time, 1 day | Full analysis, real-time delivery, email alerts |
| **Pro** | $49/mo | 200 | All intervals | Priority execution, all notification channels, API access |
| **Elite** | $149/mo | Unlimited | All intervals | Dedicated capacity, webhook delivery, portfolio-level analysis |

### Credit Mechanics

- Credits refresh monthly on billing cycle start
- Unused credits do not roll over (except Elite)
- **Every analysis request consumes 1 credit** - no exceptions, no free cache hits for users
- Users can purchase additional credit packs: 20 credits for $9, 50 for $19
- Credit deduction happens at request time (before delivery)

### Free Tier Strategy

The free tier serves two purposes:
1. **Acquisition**: Let users experience the intelligence quality before committing
2. **Viral loop**: Free users can share analysis results, driving organic growth

Free tier limitations:
- 5 analyses per month
- One-time analysis only (no recurring)
- Standard delivery (no priority queue)
- No API access
- No email/push notifications (in-app only)

### Payment Integration

- Stripe for subscription management and credit pack purchases
- Stripe webhooks → Lambda → RDS for subscription lifecycle events
- Credits granted atomically on successful payment confirmation

---

## 8. Scheduling & Execution Infrastructure

### Scheduler Architecture (EventBridge)

Recurring analysis uses **Amazon EventBridge Scheduler**:

1. When a user creates a recurring request, an EventBridge schedule is created
2. The schedule fires at the configured interval, targeting an SQS queue
3. A Lambda consumer picks up the message and runs the deduplication check
4. If execution is needed, it dispatches to Bedrock AgentCore
5. On completion, results are stored and all subscribers are notified

### Why EventBridge Scheduler (not cron on ECS)

- Serverless - no idle compute costs
- Per-schedule granularity - each market/interval combo is its own schedule
- Built-in retry and DLQ support
- Scales to millions of schedules without custom infrastructure

### Execution Flow

```
EventBridge Schedule fires
  → SQS message
  → Lambda: deduplication check (ElastiCache)
  → If no cache hit: invoke Bedrock AgentCore workflow
  → Bedrock completes → result stored in RDS + S3
  → Result cached in ElastiCache (TTL = interval duration)
  → SNS notification → all subscribers
  → WebSocket push to connected clients
```

### Scaling Considerations

- **Lambda concurrency**: Reserved concurrency for analysis dispatch to prevent thundering herd
- **SQS FIFO**: Per-market message grouping prevents duplicate concurrent executions
- **ElastiCache cluster**: Multi-AZ Redis for high availability
- **Bedrock throttling**: Respect Bedrock rate limits with SQS-based backpressure
- **Cost ceiling**: CloudWatch alarm on daily Bedrock spend with auto-pause at threshold

### Failure Handling

- SQS dead-letter queue for failed dispatches (3 retries with exponential backoff)
- If Bedrock execution fails after retries → refund user credit, notify of failure
- CloudWatch alarm on DLQ depth for operational awareness
- Step Functions for complex retry/compensation logic if needed

---

## 9. Delivery & Notification System

### Channels (All AWS-Native)

| Channel | AWS Service | Availability | Latency |
|---------|-------------|-------------|---------|
| In-app (Real-time) | API Gateway WebSocket | All plans | < 1s |
| Push notification | Amazon SNS (Mobile Push) | Starter+ | < 5s |
| Email | Amazon SES | Starter+ | < 30s |
| Webhook | EventBridge → HTTP target | Pro+ | < 2s |

### Real-Time Delivery (WebSocket)

```
Client connects to WebSocket API Gateway
  → Connection ID stored in DynamoDB
  → When result is ready: Lambda posts to @connections/{connectionId}
  → Client receives result in real-time
```

### Notification Flow

```
Analysis complete
  → Store result (RDS + S3)
  → Publish to SNS topic: "analysis-complete"
  → Fan-out to subscribers:
      → Lambda: WebSocket push (in-app)
      → Lambda: SES email (if enabled)
      → Lambda: SNS mobile push (if enabled)
      → EventBridge: webhook delivery (if configured)
```

### Notification Preferences

Users configure per-market notification preferences (stored in RDS):
- Which channels to use
- Quiet hours (no notifications between X and Y)
- Threshold alerts (only notify if probability shifted > N%)

---

## 10. Data Architecture

### Storage Strategy

| Data Type | AWS Service | Retention | Access Pattern |
|-----------|-------------|-----------|----------------|
| Users, subscriptions, credits | Amazon RDS (PostgreSQL) | Indefinite | Transactional, consistent reads |
| Analysis results (metadata) | Amazon RDS (PostgreSQL) | Indefinite | Read-heavy, indexed by market + time |
| Analysis results (full payload) | Amazon S3 | Indefinite | Read on demand, large JSON blobs |
| Agent memory | Amazon RDS (PostgreSQL) | Indefinite | Read before each analysis |
| Deduplication cache | Amazon ElastiCache (Redis) | TTL-based (15 min - 1 hour) | High-speed lookup |
| WebSocket connections | Amazon DynamoDB | Transient | Fast connection ID lookups |
| Rate limiting counters | Amazon DynamoDB | TTL-based | Atomic increments |
| Raw agent traces | Amazon S3 | 90 days | Debugging, cost analysis |
| Application logs | Amazon CloudWatch Logs | 30 days | Operational debugging |

### Indexing Strategy (RDS)

All indexes are defined in the database schema above (Section 6). Key indexes cover:
- Deduplication lookups (`market_id + executed_at`)
- Schedule management (`next_scheduled_run` for active, non-executing schedules)
- Subscriber fan-out (`market_id` for active subscribers)
- Credit balance checks (`user_id` for active subscriptions)
- Agent memory retrieval (`market_id + agent_name + timestamp`)
- Delivery history (`user_id + delivered_at`)

---

## 11. Security & Access Control

### Authentication (Amazon Cognito)

- Passwordless sign-in via Magic Link (Cognito custom auth flow)
- Social sign-in (Google, Apple) via Cognito identity providers
- JWT tokens for API authentication (validated at API Gateway)
- MFA support for high-value accounts
- Cognito user pools for user management and profile storage

### Authorization

- API Gateway authorizers validate Cognito JWTs
- Lambda functions enforce business logic (credit checks, plan limits)
- IAM roles for service-to-service communication
- Resource-based policies on S3 buckets and SQS queues

### Rate Limiting (DynamoDB + API Gateway)

| Endpoint | Free | Starter | Pro | Elite |
|----------|------|---------|-----|-------|
| Analysis requests | 5/month | 50/month | 200/month | Unlimited |
| API calls | N/A | N/A | 100/min | 1000/min |
| Webhook deliveries | N/A | N/A | 10/min | 100/min |

Rate limiting implemented via:
- API Gateway usage plans and API keys (per-plan throttling)
- DynamoDB atomic counters for credit tracking
- ElastiCache sliding window counters for per-minute limits

### Data Protection

- RDS encryption at rest (AWS KMS)
- S3 server-side encryption (SSE-S3 or SSE-KMS)
- ElastiCache encryption in transit and at rest
- VPC isolation for RDS and ElastiCache (private subnets)
- Secrets Manager for all API keys and credentials
- CloudTrail for audit logging of all AWS API calls

---

## 12. Observability & Cost Tracking

### Per-Analysis Cost Tracking

Every analysis execution records:
- Model invocation costs (per agent, per model) - from Bedrock usage metrics
- Tool call costs (API calls to external services)
- Compute duration
- Total cost
- Whether result was served from cache (internal metric)

This enables:
- Accurate unit economics (cost per analysis vs. revenue per credit)
- Internal savings tracking (how much deduplication saves us)
- Anomaly detection (runaway agent loops, cost spikes)

### Monitoring Stack (CloudWatch)

- **Bedrock metrics**: Invocation count, latency, errors, token usage
- **Lambda metrics**: Duration, errors, throttles, concurrent executions
- **RDS metrics**: Connections, query latency, storage
- **DynamoDB metrics**: Read/write capacity, throttled requests, latency
- **SQS metrics**: Queue depth, message age, DLQ depth
- **Business metrics** (custom CloudWatch metrics):
  - Active subscribers by plan
  - Credit utilization rate
  - Cache hit rate (internal savings)
  - Analysis requests per market (popularity)

### Alerting (CloudWatch Alarms)

- Analysis execution time > 60s → warning
- Analysis execution time > 120s → critical
- Cache hit rate < 30% → investigate (low user overlap on markets)
- Daily Bedrock spend > 80% budget → alert
- DLQ depth > 0 → investigate failures
- RDS connections > 80% max → scale warning
- Credit refund rate > 5% → investigate execution failures

### Cost Dashboard

Custom CloudWatch dashboard showing:
- Daily/weekly/monthly Bedrock spend
- Cost per analysis trend
- Revenue per analysis (credit value)
- Gross margin in real-time
- Deduplication savings (executions avoided × avg cost)

---

## 13. Migration Path from V1

### Phase 1: AWS Foundation (Weeks 1-3) ✅ COMPLETED

- Set up AWS account structure with CDK (development + production environments)
- Deploy core infrastructure via CDK: Minimal VPC (public subnets, no NAT), RDS PostgreSQL, Cognito
- Set up DynamoDB tables for dedup cache, WebSocket connections, and rate limiting
- Deploy API Gateway (REST + WebSocket) with Cognito authorizer
- Set up SQS FIFO queue + DLQ, EventBridge event bus
- Create S3 buckets for analysis results and agent traces
- Configure Bedrock AgentCore IAM roles (agent execution + orchestrator)
- Port existing agent prompts and tools to Strands SDK agent definitions
- Set up SNS topics and SES for notification delivery
- Deploy CloudWatch dashboards and alarms

**Cost-optimization decisions made:**
- Removed ElastiCache Redis → DynamoDB with TTL (saves $12-48/mo)
- Removed NAT Gateways → RDS in public subnet with SSL enforcement (saves $35-70/mo)
- Single-AZ RDS t4g.micro for both environments (saves $25-50/mo)
- Result: ~$15-20/mo baseline instead of ~$170/mo

### Phase 2: Core Services (Weeks 3-5) ✅ COMPLETED

- ✅ Implement Analysis Request Service (Lambda + SQS)
  - `services/analysis-request/handler.ts` - credit check, dedup, dispatch
- ✅ Build deduplication engine with DynamoDB TTL-based cache
  - `services/shared/dynamo.ts` - dedup cache, in-flight tracking, rate limiting
- ✅ Implement credit/subscription system in RDS
  - `services/shared/credits.ts` - SQL queries, plan limits, validation
- ✅ Set up EventBridge Scheduler for recurring analysis
  - Integrated into request handler (createOrUpdateSchedule)
- ✅ Deploy agents to Bedrock AgentCore using Strands SDK
  - `agents/deploy-agents.ts` - one-time script to register agents
- ✅ Implement lightweight Lambda orchestrator that invokes AgentCore agents
  - `services/analysis-orchestrator/handler.ts` - full 11-stage workflow
- ✅ Wire signal fusion and consensus engine into the orchestrator Lambda
  - Imports from `agents/orchestrator.ts` (deterministic logic)
- ✅ CDK Compute Stack deploys both Lambdas with proper IAM permissions
  - `lib/compute-stack.ts` - SQS trigger, API Gateway integration
- End-to-end testing of analysis flow (request → AgentCore → delivery)

### Phase 3: Delivery & Frontend (Weeks 5-7) ✅ COMPLETED

- ✅ Implement WebSocket connection management (Lambda + DynamoDB connections table)
  - `services/ws-connect/handler.ts` - JWT validation, DynamoDB PutItem with 24h TTL
  - `services/ws-disconnect/handler.ts` - DynamoDB DeleteItem on disconnect
  - `services/shared/connections.ts` - shared connection utilities
- ✅ Implement real-time analysis delivery via WebSocket push
  - `services/analysis-delivery/handler.ts` - SNS → PostToConnection fan-out, 410 cleanup
- ✅ Set up SES email templates for analysis delivery
  - `services/email-delivery/handler.ts` - quiet hours, notification preferences, SES templates
- ✅ Configure SNS for push notifications
  - `services/push-delivery/handler.ts` - plan-based restrictions, quiet hours, SNS Mobile Push
- ✅ Implement webhook delivery for Pro/Elite users
  - `services/webhook-delivery/handler.ts` - HTTP POST with retry logic, delivery recording
- ✅ Build notification preferences API
  - `services/notification-preferences/handler.ts` - GET/PUT with plan-based channel validation
- ✅ Build subscription & billing API (Stripe integration)
  - `services/subscription-api/handler.ts` - Checkout sessions, webhooks, credit management
- ✅ Build analysis results API with cursor-based pagination
  - `services/results-api/handler.ts` - paginated history, S3 payload retrieval, ownership verification
- ✅ CDK infrastructure updates (compute-stack.ts)
  - All 9 new Lambda functions defined with proper IAM permissions
  - SNS subscriptions for delivery fan-out
  - WebSocket route integrations ($connect, $disconnect)
  - REST API Lambda proxy integrations (replacing mock integrations)
  - Stripe secrets in environment variables
- ✅ Frontend Cognito auth module (passwordless Magic Link)
  - `lib/cognito-auth.ts` - InitiateAuth, RespondToChallenge, token management
  - `providers/AuthProvider.tsx` - React context with auto-refresh
  - `app/login/page.tsx` - Magic Link login flow UI
- ✅ Frontend API client with typed errors and retry logic
  - `lib/api-client.ts` - Bearer token injection, 402/403/404 typed errors, exponential backoff
- ✅ Frontend WebSocket client with real-time delivery
  - `lib/websocket-client.ts` - exponential backoff reconnection, ping keepalive
  - `providers/WebSocketProvider.tsx` - TanStack Query cache invalidation on message
- ✅ Add "Get Analysis" UI flow to market pages
  - `components/analysis/AnalysisRequestModal.tsx` - plan-aware intervals, credit handling
  - `components/analysis/GetAnalysisButton.tsx` - reusable CTA button
- ✅ Build analysis results viewer with historical access
  - `app/analysis/page.tsx` - infinite scroll history with real-time WebSocket prepend
  - `components/analysis/AnalysisDetail.tsx` - full detail (agents, thesis, cross-exam, sizing)
  - `components/analysis/AnalysisResultCard.tsx` - list item with cached/fresh indicator
- ✅ Implement subscription management UI (Stripe integration)
  - `app/account/subscription/page.tsx` - plan comparison, Stripe Checkout, credit packs, cancellation
  - `components/subscription/PlanCard.tsx` - plan card with pricing and features
- ✅ Credit balance display in header
  - `components/Header/CreditBalance.tsx` - optimistic updates, warning states
- ✅ Notification settings UI
  - `components/account/NotificationSettings.tsx` - channel toggles, quiet hours, threshold
  - `hooks/useNotificationPreferences.ts` - GET/PUT notification preferences

### Phase 4: Billing, Testing & Launch (Weeks 7-9)

- ✅ Integrate Stripe for payments (webhooks → Lambda → RDS)
  - `services/subscription-api/handler.ts` - full Stripe Checkout integration
  - Webhook signature verification via `stripe.webhooks.constructEvent`
  - Handles `checkout.session.completed`, `customer.subscription.updated`, `invoice.paid`
  - Stripe secrets stored in AWS Secrets Manager, accessed via cached client
  - CDK wires `POST /webhooks/stripe` with `AuthorizationType.NONE` (Stripe sends directly)
  - Plan changes create Stripe Checkout sessions (mode: 'subscription')
  - Billing cycle reset on `invoice.paid` with `billing_reason === 'subscription_cycle'`
- ✅ Implement credit purchase flow
  - `POST /credits/purchase` creates Stripe Checkout session (mode: 'payment')
  - Credit packs: 20 credits for $9 (`pack_20`), 50 credits for $19 (`pack_50`)
  - On `checkout.session.completed` with `mode === 'payment'`: credits added atomically to subscription
  - Immutable `credit_transactions` audit trail recorded for every credit change
  - Frontend: `hooks/useSubscription.ts` - `usePurchaseCredits` mutation with Checkout redirect
  - Frontend: `app/account/subscription/page.tsx` - credit pack purchase buttons, success/cancel URL handling
  - Optimistic credit decrement via `useOptimisticCreditDecrement` for instant UI feedback
- Load testing
- Cost optimization pass (right-size Lambda, RDS)
- Security review and penetration testing
- Staged rollout: invite-only → waitlist → public

### What Gets Preserved

- All agent prompts and debate protocol logic (ported to Strands SDK)
- Polymarket integration tools
- Agent memory system (migrated to RDS)
- Frontend market discovery UI (repointed to new API)

### What Gets Replaced

| V1 Component | V2 Replacement |
|-------------|----------------|
| LangGraph orchestration | Strands SDK on Bedrock AgentCore |
| Supabase (Postgres) | Amazon RDS (PostgreSQL) |
| Supabase Auth | Amazon Cognito |
| Supabase Realtime | API Gateway WebSocket |
| NewsData.io API | Browser tool (agents browse news sites directly) |
| Serper API | Browser tool (agents search the web directly) |
| Keyword extraction node | Removed (redundant) |
| CLI-based analysis | API-driven with Cognito auth |
| Always-on monitoring | User-initiated with EventBridge scheduling |
| Single-process execution | Managed serverless agents (Bedrock) |
| Manual deployment | AWS CDK + CI/CD pipeline |
| Redis/ElastiCache (planned) | DynamoDB with TTL (cost-optimized) |
| NAT Gateways (planned) | Public RDS endpoint with SSL enforcement |

---

## 14. Scaling Projections

### Cost Model (Per Analysis - Our Cost)

| Component | Estimated Cost |
|-----------|---------------|
| Bedrock Nova 2 Lite invocations (web research + 14 agents + debate) | $0.04 - $0.10 |
| Browser tool usage (web page fetches) | $0.01 - $0.02 |
| Lambda + SQS + EventBridge | $0.002 |
| RDS + DynamoDB (amortized) | $0.002 |
| **Total per fresh execution** | **~$0.06 - $0.13** |
| **Cached result delivery** | **~$0.001** (just DB read + notification) |

*Note: Using Nova 2 Lite exclusively brings per-analysis cost significantly below what Claude Sonnet would cost (~3-5x cheaper per token). No external API subscription costs (NewsData, Serper, etc.) - agents browse the web directly. DynamoDB replaces ElastiCache for dedup at a fraction of the cost.*

### Revenue vs. Cost at Scale

| Users | Requests/Month | Actual Executions (after dedup) | Revenue/Month | Our Cost/Month | Margin |
|-------|---------------|--------------------------------|---------------|----------------|--------|
| 1,000 | 15,000 | 12,000 (80%) | $25,000 | $1,200 | 95% |
| 10,000 | 120,000 | 60,000 (50%) | $200,000 | $6,000 | 97% |
| 100,000 | 800,000 | 250,000 (31%) | $1,500,000 | $25,000 | 98% |
| 1,000,000 | 5,000,000 | 800,000 (16%) | $12,000,000 | $80,000 | 99% |

*Deduplication ratio improves dramatically at scale because more users cluster on the same popular markets.*

### Why Margins Improve at Scale

- **Deduplication**: At 1M users, we execute ~16% of requests (the rest are cache hits costing us nearly nothing)
- **Nova 2 Lite pricing**: Already one of the cheapest foundation models on Bedrock, with volume discounts at scale
- **Single model simplicity**: No multi-provider overhead, one billing relationship, predictable costs
- **Amortized infrastructure**: RDS and DynamoDB costs spread across more users (DynamoDB scales linearly with usage)
- **Popular market clustering**: Top 100 markets get 80% of requests - massive cache hit rates
- **No fixed cache costs**: DynamoDB pay-per-request means dedup costs scale with actual usage, not provisioned capacity

---

## 15. Infrastructure as Code (AWS CDK)

All infrastructure is defined and deployed via AWS CDK (TypeScript):

```
infra/
├── bin/
│   └── tradewizard.ts          # CDK app entry point
├── lib/
│   ├── network-stack.ts        # Minimal VPC, public subnets, security groups
│   ├── database-stack.ts       # RDS PostgreSQL, DynamoDB tables (dedup, connections, rate limits)
│   ├── auth-stack.ts           # Cognito user pool, app clients
│   ├── api-stack.ts            # API Gateway (REST + WebSocket)
│   ├── queue-stack.ts          # SQS FIFO queue, DLQ, EventBridge event bus
│   ├── notification-stack.ts   # SNS topics, SES email, delivery IAM role
│   ├── storage-stack.ts        # S3 buckets (analysis results, agent traces)
│   ├── monitoring-stack.ts     # CloudWatch dashboards, alarms
│   └── bedrock-stack.ts        # Bedrock AgentCore IAM roles
├── agents/
│   ├── agent-definitions.ts    # All 20+ agent definitions for Strands SDK
│   └── orchestrator.ts         # Signal fusion, consensus engine logic
├── sql/
│   └── 001-initial-schema.sql  # PostgreSQL schema (all tables + indexes)
├── package.json
└── tsconfig.json
```

### Environments

- **development**: Minimal resources, single-AZ, no NAT, deletion allowed
- **production**: Same lean architecture, deletion protected, SSL enforced

### Cost-Optimized Architecture Decisions

| Decision | Rationale | Scale-up path |
|----------|-----------|---------------|
| No NAT Gateway | Saves $35-70/mo | Add when moving RDS to private subnet |
| No ElastiCache | Saves $12-48/mo | Add when dedup latency matters (>10K users) |
| DynamoDB for cache | Pay-per-request, pennies at low volume | Switch to ElastiCache at scale |
| Single-AZ RDS | Saves $13-25/mo | Enable Multi-AZ with one config change |
| Public RDS endpoint | Eliminates VPC complexity | Move to private subnet + RDS Proxy at scale |

---

## 16. Future Extensions

### Portfolio-Level Analysis (Elite)

- Analyze correlations across a user's entire position set
- Cross-market hedging recommendations
- Portfolio risk scoring

### Social Features

- Share analysis results publicly (drives viral growth)
- Leaderboards for prediction accuracy
- Community-driven market watchlists

### API Platform

- Third-party developers build on TradeWizard intelligence
- Webhook integrations with trading bots
- White-label analysis for institutional clients

### Additional Market Verticals

- Sports outcomes
- Entertainment (awards, releases)
- Economic indicators
- Corporate events

### Advanced AWS Integrations

- Amazon Personalize for market recommendations
- Amazon Comprehend for enhanced sentiment analysis
- AWS Step Functions for complex multi-stage workflows
- Amazon Kinesis for real-time market data streaming

---

## Summary

TradeWizard V2 transforms from a single-user demo into a multi-tenant intelligence platform running entirely on AWS. The key architectural decisions are:

1. **Bedrock AgentCore + Strands SDK** for managed, scalable agent execution
2. **Fully AWS-native** - RDS, Cognito, DynamoDB, API Gateway, SQS, SNS, EventBridge, S3
3. **Cost-optimized from day one** - No NAT, no ElastiCache, DynamoDB for cache (~$15-20/mo baseline)
4. **User-initiated analysis** with one-time and recurring modes (credit always consumed)
5. **Internal deduplication** via DynamoDB TTL to optimize Bedrock costs without affecting user pricing
6. **Subscription pricing** with credits - users pay for intelligence access, not compute
7. **Async delivery** via WebSocket, push, email, and webhook
8. **Clear scale-up path** - Add NAT, Multi-AZ, ElastiCache when revenue justifies it (config changes only)

The result is a platform that can serve tens of millions of users at 95%+ margins, where deduplication makes popular markets essentially free for us to serve while users pay full price for every analysis they request.
