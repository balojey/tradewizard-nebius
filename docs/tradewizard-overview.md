# TradeWizard

**The intelligence layer for real-world prediction markets.**

TradeWizard is an AI-powered platform that turns prediction markets on Polymarket into a guided, probability-driven trading experience. It pairs a multi-agent analysis engine - 14 specialized AI agents that debate every market and produce explainable recommendations - with an optional autonomous Portfolio Manager that can execute trades inside hard, user-defined risk limits. The submitted configuration runs all model inference on Nebius Token Factory, with NVIDIA Nemotron 3 Super on the tool-heavy research and news agents.

This document explains what TradeWizard is, how it works, the architecture behind it, and where it's going. Every technical claim here reflects what is actually implemented in the codebase.

---

## 1. The Problem

Prediction markets aggregate dispersed information into a single number - the price - and that number is a probability. They are one of the cleanest forecasting mechanisms ever built. But they offer markets without intelligence.

To trade them well, a person has to simultaneously monitor breaking news, read polling internals, watch order books for liquidity and whale activity, track narrative velocity across media and social platforms, and time entries against catalysts. That is five distinct analytical disciplines. Most retail traders have none of them, so they trade on headlines, lose money, and leave.

Bloomberg-grade analysis exists for equities. Nothing comparable existed for political, legal, economic, and geopolitical outcomes. TradeWizard is built to fill that gap - not as a content feed or a signal group, but as an actual decision system that produces explainable, probability-disciplined recommendations and tracks its own accuracy over time.

---

## 2. What TradeWizard Does

TradeWizard is two products that share one intelligence core.

### 2.1 The Intelligence Layer

A user can request analysis on any Polymarket market. Behind that request runs an 11-stage workflow that:

1. Gathers market data, price history, and real-time web context
2. Runs 14 specialized intelligence agents in parallel, each producing an independent signal
3. Fuses those signals deterministically with conflict detection
4. Constructs competing bull and bear theses
5. Subjects both theses to adversarial cross-examination
6. Computes a deterministic consensus probability
7. Produces a final recommendation with entry zone, target zone, mandatory stop-loss, expected value, win probability, and a full reasoning chain

If the agents disagree beyond a hard threshold, or if the expected value is non-positive, the system refuses to recommend. It returns a structured `NO_TRADE` with an explanation of why the market is not currently tradeable. This refusal behavior is enforced in deterministic code, not left to model discretion.

Results are delivered through multiple channels - in-app WebSocket, email, push, and webhook - according to each user's plan and notification preferences.

### 2.2 The Autonomous Portfolio Manager

For users on the Pro and Elite plans, TradeWizard offers an optional autonomous trading agent. A user activates it on a specific market by providing three things the system cannot change on its own:

- **The market** to trade
- **The capital amount** to commit (minimum $5)
- **The persona** that governs decision-making

The Portfolio Manager then consumes recurring analyses for that market and decides entry, position sizing, stop-loss, and take-profit per trade. It does not generate its own analysis - it acts on the intelligence layer's output. Orders are placed on the Polymarket CLOB. A Position Guard monitors open positions, and a Risk Engine enforces loss limits, cooldowns, and a kill switch. The user can pause, resume, stop, or kill all sessions at any time.

There are six trading personas, each with distinct entry, sizing, exit, and monitoring rules:

| Persona | Risk Level | Style |
|---------|-----------|-------|
| The Sniper | Aggressive | High-conviction, concentrated bets on rare high-edge opportunities |
| The Scalper | Moderate | Rapid, small-edge exploitation with high trade frequency |
| The Contrarian | Aggressive | Fades crowd consensus - buys fear, sells euphoria |
| The Catalyst Hunter | Moderate | Event-driven - positions before catalysts, exits on resolution |
| The Hedge Architect | Conservative | Multi-position strategist that reduces directional exposure |
| The Momentum Rider | Aggressive | Trend-following with pyramiding into winning positions |

---

## 3. How the Intelligence Engine Works

The analysis workflow runs in a self-hosted Lambda function using the Strands Agents SDK in TypeScript. It is an 11-stage pipeline that alternates between AI reasoning stages and deterministic, non-AI computation stages. Model inference runs on Nebius Token Factory; orchestration and state live on a serverless deployment substrate.

### 3.1 The 14 Intelligence Agents

All 14 agents run on every analysis. There is no conditional selection or routing - the system always produces a complete, comparable signal set. The agents are:

`market_microstructure`, `probability_baseline`, `risk_assessment`, `breaking_news`, `event_impact`, `polling_intelligence`, `historical_patterns`, `media_sentiment`, `social_sentiment`, `narrative_velocity`, `momentum`, `mean_reversion`, `catalyst_identification`, and `tail_risk`.

Each agent emits a typed signal: a direction (YES / NO / NEUTRAL), a confidence score, a fair-probability estimate, key drivers, and risk factors. Agents that need external data are equipped with tools - a news tool (NewsData.io), a web search-and-scrape tool (Serper), and a sandboxed shell tool for numeric analysis over price-history data.

The agents execute in parallel using `Promise.allSettled`, so a single slow or failing agent does not block the others. If more than 10 of the 14 agents fail to produce a valid signal, the workflow aborts with `NO_TRADE` rather than recommending on thin coverage.

### 3.2 The Deterministic Gates

Between the AI-generated signals and the user, three non-AI stages act as hard validation gates. This is the architectural decision that separates TradeWizard from a chatbot that recommends trades.

**Gate 1 - Signal Fusion.** A pure-function stage (no LLM) that aggregates agent signals through market-anchored log-odds fusion. The ensemble's deviation from the current market price is shrunk by a configurable factor (`FUSION_SHRINKAGE`, default 0.15), so the fused probability stays tethered to the market rather than drifting with model enthusiasm. Weights combine agent type, individual confidence, and Brier-calibrated historical accuracy. When agent estimates diverge sharply, a divergence penalty reduces overall confidence. The output is a single fused probability with a conflict map.

**Gate 2 - Adversarial Cross-Examination.** An AI stage that generates competing bull and bear theses, then applies five structured tests to each: evidence, causality, timing, liquidity, and tail risk. Each test produces a scored, structured outcome - the debate result is data, not prose.

**Gate 3 - Consensus Engine.** A pure-function stage (no LLM) that uses the anchored fused probability as the probability source; the bull/bear role-play theses only modify confidence. It computes a disagreement index and a confidence floor. If disagreement exceeds 30% or confidence falls below 20%, consensus fails and the recommendation is forced to `NO_TRADE`. A divergence circuit breaker blocks implausible edges above 15% instead of fading the market. Separately, if the final expected value is non-positive, the recommendation is rejected and replaced with `NO_TRADE`.

After consensus, three risk-philosophy agents (aggressive, conservative, neutral) run in parallel to provide position-sizing perspectives. They do not influence the probability estimate - sizing and belief are kept architecturally separate.

### 3.3 Closed-Loop Learning

Every recommendation that carries a trade action enters a pending state. A scorer runs on a schedule, checks the recommendation against live market prices, and marks it a success (take-profit reached), a failure (stop-loss reached), or expired (no resolution within the window).

When a recommendation resolves, every contributing agent is scored: agents that took the correct side gain accuracy, agents that took the wrong side lose it, and agents that stayed neutral are excluded. This data feeds directly back into the next analysis as Brier-calibrated fusion weights - an agent's influence reflects both its accuracy and the calibration of its probability estimates, not just a binary win/loss record. The system measurably self-corrects toward the agents that have been right and well-calibrated.

Each agent's historical signals are stored per-market, and each agent sees only its own history during analysis. This is deliberate: exposing cross-agent history caused agents to anchor on each other rather than reason independently, which would undermine the disagreement signal the consensus engine depends on.

---

## 4. The Multi-Model Architecture

TradeWizard does not run on a single model. The submitted configuration routes every inference call through **Nebius Token Factory**, with seven capability buckets matched to workload:

- **Nemotron 3 Super** (`agentic`) - news and event agents, plus the web research stage
- **Qwen3-30B-A3B** (`fast`) - data-crunching agents (microstructure, probability baseline, momentum)
- **Qwen3-235B-A22B** (`analytical`) - analytical agents (risk assessment, polling intelligence, mean reversion)
- **GPT-OSS 120B** (`reasoning`) - sentiment and narrative agents
- **DeepSeek-V4-Pro** (`deep_reasoning`) - deep-reasoning scenario agents (catalyst identification, tail risk)
- **Kimi K3** (`non_tool`) - synthesis stages (thesis, cross-examination, the three risk agents, recommendation)
- **MiniMax M3** (`default`) - the Portfolio Manager's persona agent

This distribution serves two purposes. First, it matches each model to the kind of work it does best - fast models for numeric crunching, deeper-reasoning models for complex scenarios, non-tool models for pure synthesis. Second, it prevents a single model's rate limit from becoming the bottleneck for the parallel agent stage. NVIDIA Nemotron 3 Super is the agentic bucket because the news and research agents are tool-heavy: they call NewsData.io and Serper, observe results, and decide what to do next.

The pipeline asks for capabilities, not model names. `infra/services/shared/ai-provider.ts` resolves a logical key (`nova_micro`, `nemotron`, `llama_3_3`, etc.) to a capability, then to the Token Factory model ID. All model IDs are environment-driven (`NEBIUS_MODEL_FAST`, `NEBIUS_MODEL_AGENTIC`, and so on), so routing changes without code changes. Trade execution and risk enforcement never depend on the inference provider at all.

---

## 5. Risk, Safety, and Human Control

TradeWizard is built on the assumption that recommendations will sometimes be wrong, and that an autonomous trading agent must operate inside a perimeter it cannot exceed.

### 5.1 The Human Draws the Perimeter

The AI never decides how much of a user's money is at risk. Activating the Portfolio Manager requires the user to explicitly choose the market, commit a capital amount, and select a persona. The system cannot self-activate or increase committed capital - increasing investment requires a separate, user-initiated action. The kill switch is always available to the user and terminates everything immediately.

On the intelligence layer, the system only recommends. The user places the trade. Autonomous execution happens only when a user has explicitly opted into it on a specific market with a specific capital envelope.

### 5.2 Hard Risk Limits (Enforced in Code)

The Portfolio Manager operates under invariants enforced by the execution layer, not by model prompts:

- **Mandatory stop-loss and take-profit** on every position. The stop-loss is placed as a resting order on the exchange, so it executes even if our infrastructure is unavailable. If protective orders cannot be placed, the entry is cancelled to avoid an unprotected position.
- **Position size cap** at 50% of session capital.
- **Loss limits**: a warning and automatic position-size reduction at 30% session loss, an exit sequence initiated at 45%, and hard session termination at 50%.
- **Cross-session loss limit** at 40% cumulative loss, which automatically trips the kill switch across all of a user's sessions.
- **30-minute cooldown** after any loss exit before the agent may re-enter - preventing automated revenge trading.
- **Kill switch that fails closed**: if anything errors during an emergency exit, the system stops all activity rather than continuing. Re-activation requires explicit user action.
- **Decision/execution separation**: the persona agent's tools are read-only - it produces a structured decision but cannot place an order itself. A separate executor validates that decision against the hard limits before any order reaches the market.

### 5.3 Designed Against Over-Reliance

The most dangerous failure mode for an AI trading product is users trusting it uncritically. TradeWizard reduces this structurally: the system visibly refuses to recommend under high uncertainty, every recommendation surfaces its disagreement index and failure scenarios rather than a clean buy signal, mandatory stop-losses bound the cost of any single misplaced trade, and a public per-agent accuracy record gives users calibrated rather than blind trust.

---

## 6. Technical Architecture

TradeWizard runs with no long-lived servers. The intelligence layer is TS/Node and provider-agnostic at the model boundary; the deployment substrate is AWS. The entire stack - infrastructure, backend services, AI agents, and frontend - is TypeScript.

### 6.1 Platform Services

| Concern | Service |
|---------|---------|
| AI inference | **Nebius Token Factory** (NVIDIA Nemotron 3 Super + open models) |
| Compute | AWS Lambda (Node.js 20) |
| Durable state | Amazon Aurora PostgreSQL Serverless v2 |
| Cache / dedup / locks | Amazon DynamoDB (with TTL) |
| Queue | Amazon SQS (FIFO) with dead-letter queue |
| Scheduling & events | Amazon EventBridge |
| Fan-out delivery | Amazon SNS |
| Object storage | Amazon S3 |
| Authentication | Amazon Cognito (passwordless Magic Link) |
| Email | Resend (SES retained) |
| Infrastructure as code | AWS CDK (TypeScript) |
| Frontend hosting | AWS Amplify Hosting |

### 6.2 Aurora as the Durable Brain

Aurora PostgreSQL Serverless v2 holds everything that must survive: user accounts, subscriptions, credit transactions, analysis results, per-agent memory, agent performance scores, delivery tracking, and the full Portfolio Manager state (sessions, trades, and an audit log of every decision). It auto-scales down to 0.5 ACU at idle and scales up under load. The relational feature set - joins, window functions, atomic upserts, transactional guarantees - is what makes the closed-loop scoring and the never-charge-twice billing logic possible.

### 6.3 DynamoDB as the Speed Layer

DynamoDB handles everything that needs millisecond latency and benefits from automatic expiry: the analysis dedup cache (1-hour TTL), in-flight request tracking, WebSocket connection registry, rate limiting, distributed locks for the Portfolio Manager, and kill-switch state. Using DynamoDB with native TTL instead of a managed cache cluster removes an always-on cost and a service to operate.

### 6.4 Cost-Efficient by Design

The infrastructure is deliberately lean: no NAT Gateway (Aurora uses a public endpoint with SSL enforcement and security-group restrictions), no managed cache cluster, and serverless compute and database that scale to near-zero at idle. Baseline infrastructure cost is roughly $15–20 per month, with a clear scale-up path as usage grows. Inference is metered separately on Token Factory, and the market-level analysis pool is what keeps that cost proportional to distinct markets rather than user traffic.

### 6.5 The Market-Level Analysis Pool

Analysis is pooled at the market level, not the user level. The system produces at most one fresh analysis per market per hour, deduplicated through DynamoDB. Per-user delivery is tracked in Aurora so that users pay one credit only when they receive an analysis they have not already seen, and never pay twice for the same result. Recurring schedules from many users on the same market coalesce to the shortest active interval.

The effect on unit economics is significant: when many users request the same popular market in the same window, the system runs one analysis and serves it to all of them, while still attributing a credit per delivery. Cost scales with the number of distinct markets analyzed, not with the number of users requesting - which is what makes the platform viable at scale.

### 6.6 The Frontend

The web application is built on Next.js with React and TypeScript. It provides market discovery and search, real-time price data, an AI intelligence panel on every market, trade execution, a paginated analysis history, subscription and credit management, notification settings, and a Portfolio Manager dashboard with real-time session status and trade history. Authentication is passwordless via Cognito Magic Link. Real-time updates arrive over WebSocket with automatic reconnection.

---

## 7. Business Model

TradeWizard monetizes the intelligence layer, not the underlying market. Revenue comes from subscription plans and add-on credit packs.

### 7.1 Plans

| Plan | Price | Credits / month | Notes |
|------|-------|-----------------|-------|
| Free | $0 | 20 | In-app delivery |
| Starter | $19 | 100 | Adds email and push; 30-day trial eligible |
| Pro | $49 | 350 | All channels; Portfolio Manager (up to 3 concurrent sessions) |
| Elite | $149 | Unlimited | All features; Portfolio Manager (up to 10 sessions); persona customization |

A credit is consumed only when a user receives an analysis result.

### 7.2 Credit Packs

Add-on credits can be purchased at any time: 20 credits for $4.99, 45 credits for $9.99, or 75 credits for $14.99.

### 7.3 On-Chain Billing

Payments are made on-chain in pUSD (Polymarket USD) on Polygon, with legacy USDC.e read compatibility during the migration. Subscriptions and credit packs are verified by on-chain transaction hash. Auto-renewal works through a pre-approved ERC-20 allowance, so there is no card processor in the loop. Cancellation takes effect at the end of the billing period.

---

## 8. Why Now

Three trends converge to make TradeWizard timely:

- **Prediction markets are entering the mainstream.** Platforms like Polymarket have made real-world outcomes tradable with real liquidity.
- **Events move faster than humans can process.** Modern news and sentiment cycles reprice markets in minutes. Continuous, multi-source analysis is beyond manual reach.
- **AI can now act as a real-time analyst.** Foundation models with tool use and structured output make explainable, multi-agent market analysis practical to build and operate.

The opportunity is a horizontal one. The architecture is event-agnostic: the same workflow that analyzes political and economic markets extends to any domain where outcomes can be priced.

---

## 9. What's Next

- **Model performance benchmarking** - systematic quality-and-cost evaluation per agent category, with routing that adapts as model economics shift.
- **Agent ablation and specialization** - using accumulated accuracy data to retire weak agents and split strong ones into more specialized variants.
- **Domain expansion** - extending beyond politics into macroeconomic events, then other verticals, each inheriting the same workflow with domain-specific tools.
- **Portfolio-aware analysis** - recommendations conditioned on a user's existing exposure, with correlation-aware sizing.
- **Institutional surface** - a research-grade API with audit logs and signed reasoning chains.
- **Published performance reporting** - making the accuracy track record public, with methodology.

---

## 10. Summary

TradeWizard is a working, Nebius-powered platform that turns prediction markets into explainable, intelligence-driven trading. Fourteen specialized agents debate every market; three deterministic gates decide what reaches the user and allow the system to refuse when uncertainty is too high; a closed-loop scoring system makes the agents measurably better over time; and an optional autonomous Portfolio Manager executes only inside hard, user-defined limits with a kill switch that fails closed.

The user always holds the perimeter - they choose the market, the capital, the persona, and the off switch. Inside that perimeter, a coordinated system of AI specialists works the problem continuously, and every recommendation it makes is explainable, scored against reality, and bounded by design.
