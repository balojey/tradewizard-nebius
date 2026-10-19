
# Product Overview

TradeWizard is an AI-powered prediction trading platform that provides intelligent analysis and trading recommendations for real-world outcomes on Polymarket. V2 is a production-grade platform designed to serve tens of millions of users on fully AWS-native infrastructure.

## Core Value Proposition

Transforms prediction markets from speculative guessing into guided, intelligence-driven trading through multi-agent AI analysis with a subscription-based credit model.

## System Architecture

### Codebase Organization

- **tradewizard-frontend**: Web application (Next.js 16 + React 19 + TypeScript) providing UI for market discovery, trading, analysis delivery, and subscription management
- **infra**: AWS CDK infrastructure-as-code (TypeScript) - V2 platform services, Lambda handlers, self-hosted AI agent Lambdas (Analysis_Lambda + Portfolio_Lambda)

### Multi-Agent Intelligence System

The platform uses 14 specialized AI agents analyzing every market from multiple perspectives. All agents run on every analysis - no conditional selection:

- **MVP agents**: Market microstructure, probability baseline, risk assessment
- **Event intelligence**: Breaking news, event impact
- **Polling & statistical**: Polling intelligence, historical patterns
- **Sentiment & narrative**: Media sentiment, social sentiment, narrative velocity
- **Price action**: Momentum, mean reversion
- **Event scenario**: Catalyst identification, tail risk

### Risk Philosophy Agents (post-consensus)

Three parallel agents provide position sizing guidance without influencing probability estimates:
- **Aggressive**: Maximum EV, Kelly criterion, concentrated positions
- **Conservative**: Capital preservation, hedging, stop-losses
- **Neutral**: Market-neutral, spreads, arbitrage

## Analysis Workflow (11 Stages)

The workflow orchestrates analysis through sequential and parallel stages in a self-hosted AWS Lambda function using the Strands Agents SDK (TypeScript):

1. **Data Preparation**: Fetch price history from Polymarket CLOB API, write CSV to /tmp; fetch related sibling markets from Gamma API, calculate aggregate metrics, write JSON to /tmp
2. **Historical Context Retrieval**: Load past N agent signals from Aurora PostgreSQL `agent_memory` table for this market (configurable via `ANALYSIS_HISTORY_DEPTH`, default 5). Each agent receives only its own historical signals for consistency and drift detection.
3. **Web Research**: Autonomous Strands Agent with search/scrape tools gathers real-time web context (60s timeout, max 10 searches + 5 scrapes)
4. **Agent Selection**: All 14 intelligence agents are activated for every market (no conditional filtering)
5. **Parallel Intelligence Agents**: All 14 agents execute in parallel via Promise.all (120s per-agent timeout), each producing an AgentSignal (direction, confidence, fairProbability, keyDrivers, riskFactors)
6. **Agent Signal Fusion** (deterministic, no LLM): Weighted aggregation with conflict detection, alignment scoring, and divergence penalty
7. **Thesis Construction**: Strands Agent generates competing bull and bear theses from fused signal
8. **Cross-Examination**: Strands Agent applies 5 adversarial tests (evidence, causality, timing, liquidity, tail risk) to both theses
9. **Consensus Engine** (deterministic, no LLM): Weighted consensus probability with disagreement detection - fails if disagreement > 30%
10. **Risk Philosophy Agents**: Three parallel Strands Agents (aggressive, conservative, neutral) provide position sizing guidance
11. **Recommendation Generation**: Strands Agent synthesizes final trade action (LONG_YES, LONG_NO, NO_TRADE) with entry/exit zones, EV, and explanation

## User-Initiated Analysis Model

### One-Time Analysis
- Single execution of the full debate protocol
- Consumes 1 credit from user's account
- Results delivered via async notification (WebSocket, email, push, webhook)

### Interval Analysis (Recurring)
- User selects interval: 1h, 4h, 12h, 1d
- Each delivery consumes 1 credit
- Managed via EventBridge Scheduler
- User can cancel at any time

## Market-Level Analysis Pool

The analysis pool is **market-level, not user-level**. The system produces at most one fresh analysis per market every hour, shared across all users.

### Core Rules
- **1-hour minimum interval** between analyses on the same market (hard minimum, regardless of demand)
- **Every user pays 1 credit for every analysis they receive** - no free rides
- **Users never pay for something they don't receive**, and never receive the same analysis twice
- **Per-user delivery tracking** via `analysis_deliveries` table prevents duplicate charges

### Request Flow
1. Check for a fresh result (< 1hr old) for this market
2. If fresh result exists AND user hasn't received it → charge 1 credit, deliver it
3. If fresh result exists AND user already has it → no charge, check for upcoming schedule:
   - Has upcoming schedule → subscribe user to next delivery (they pay when it arrives)
   - No upcoming schedule → respond "next analysis available in X minutes"
4. If no fresh result AND analysis is in-flight → charge 1 credit, subscribe to pending result
5. If no fresh result AND nothing in-flight → charge 1 credit, dispatch new execution

### Recurring Schedule Coalescing
- Multiple users' recurring schedules on the same market share the same execution cadence
- The system coalesces to the shortest active interval for that market
- When a user activates a recurring schedule and a fresh result exists that they haven't received, they get it immediately (charged 1 credit) then continue on the recurring cadence
- At scale, this reduces Bedrock executions dramatically (shared pool across all users)

## Subscription & Pricing

| Plan | Price | Credits/Month | Intervals | Notification Channels |
|------|-------|---------------|-----------|----------------------|
| Free | $0 | 20 | One-time only | In-app |
| Starter | $19/mo | 100 | One-time, 1 day | In-app, email, push |
| Pro | $49/mo | 350 | All intervals | All channels |
| Elite | $149/mo | Unlimited | All intervals | All channels |

### Credit Packs (Add-on)
- 20 credits for $4.99
- 45 credits for $9.99
- 75 credits for $14.99

### Billing (On-Chain USDC.e on Polygon)
- Users pay via USDC.e transfers on Polygon to the platform wallet
- Transaction hash verification confirms payment on-chain
- Auto-renewal via pre-approved `transferFrom` allowance (ERC-20 approve)
- Credit packs purchased the same way (verify tx hash → add credits)
- Cancellation at period end (user retains access until billing cycle ends)
- Grace period for failed renewals before downgrade to free

## Multi-Channel Delivery

Analysis results are delivered through multiple channels simultaneously:

| Channel | Implementation | Plan Requirement |
|---------|---------------|-----------------|
| In-app (WebSocket) | API Gateway WebSocket → DynamoDB connections | All plans |
| Email | Transactional email (Resend; SES retained) | Starter+ |
| Push | SNS Mobile Push | Starter+ |
| Webhook | HTTP POST to user URL | Pro+ |

All channels respect:
- User notification preferences (enable/disable per channel)
- Quiet hours (start/end time, skip delivery during window)
- Probability shift thresholds (only notify on significant changes)

## Frontend Features

### Authentication
- Passwordless via Amazon Cognito Custom Auth (Magic Link)
- Email-based - no passwords to remember
- Auto-refresh tokens 5 minutes before expiry

### Market Discovery & Trading
- Browse and search Polymarket markets
- Real-time price data via CLOB API
- Order placement and position management
- Position redemption
- Portfolio performance tracking
- Wallet management (Magic SDK + Polygon)
- Geoblocking detection and compliance
- Simulated portfolio for paper trading

### Analysis Experience
- "Get Analysis" button on any market page
- Choose one-time or recurring (plan-aware intervals)
- Real-time delivery via WebSocket (appears instantly)
- Paginated history with infinite scroll
- Full detail view: agent signals, thesis, cross-examination, position sizing
- Cached vs fresh analysis visual indicator

### Subscription Management
- Plan comparison with current plan highlight
- On-chain USDC.e payment for upgrades/downgrades
- Credit pack purchase via wallet transfer
- USDC.e allowance approval for auto-renewal
- Cancellation with confirmation dialog
- Real-time credit balance in header (optimistic updates)
- Payment transaction history

### Notification Settings
- Channel toggle switches (plan-based disabling)
- Quiet hours time pickers
- Probability shift threshold configuration
- Webhook URL validation (HTTPS required)

### Autonomous Portfolio Manager (Pro/Elite)
- Activate AI trading agents per market with a specified USDC.e investment amount
- 6 trading personas: Sniper, Scalper, Contrarian, Catalyst Hunter, Hedge Architect, Momentum Rider
- Persona selected once in account settings, applies to all market activations
- Consumes existing recurring analysis results (does NOT trigger its own analysis)
- Autonomous trade execution via Polymarket CLOB API (limit orders, market orders, mandatory stop-loss and take-profit decided by the PM agent per-trade)
- Position Guard monitors for regime shifts, stale markets, and persona-specific exit signals
- Risk Engine enforces loss limits (50% per session, 40% cross-session), position size caps (50%), and 30-minute cooldowns
- Kill Switch immediately terminates all sessions and exits all positions
- Real-time dashboard with session status, P&L, trade history, and utilization
- Investment amount adjustable on the fly (increase/decrease uninvested portion)
- Session lifecycle: multiple entry/exit cycles until user stops, market resolves, or capital depletes
- Concurrent session limits: 3 (Pro) / 10 (Elite)
- Elite users can customize persona parameters (exit sensitivity, monitoring frequency, position sizing)
- Multi-channel notifications for every trade, exit, and risk event

## Key Architectural Principles

- **Explainability**: All recommendations include clear reasoning chains
- **Autonomy**: Agents use NewsData.io and Serper search/scrape tools for autonomous web research - direct API integration without browser dependency
- **Multi-Model Routing**: Agents distributed across 7 Bedrock models by capability and RPM budget (Nova Micro, Nova Lite, Nemotron 3 Super, GPT-OSS 120B, Kimi K2 for tool-capable stages; Llama 3.3 70B for non-tool stages; Nova 2 Lite as fallback)
- **Observability**: CloudWatch metrics, alarms, and per-analysis cost tracking
- **Memory**: Historical agent signals stored in Aurora PostgreSQL for closed-loop learning
- **Resilience**: Graceful degradation - partial failures don't crash the pipeline; consensus can fail (refuses to recommend under high uncertainty)
- **Cost Efficiency**: DynamoDB-based dedup cache, no NAT gateways, no ElastiCache, Aurora Serverless v2 auto-scales
- **Negative EV Rejection**: Even with an edge, negative expected value → NO_TRADE
- **Real-Time First**: WebSocket delivery for instant results, with email/push/webhook as secondary channels

## Development Guidance

### When Adding Features

- **infra/**: CDK stacks for AWS resources, Lambda handlers in `services/`, analysis workflow in `services/analysis-lambda/`, portfolio manager in `services/portfolio-lambda/`
- **tradewizard-frontend/**: Pages in `app/`, components in `components/`, hooks in `hooks/`, core libs in `lib/`
- New agents: add system prompt to `infra/services/analysis-lambda/stages/intelligence-agents.ts`
- Deterministic logic (signal fusion, consensus) lives in `infra/services/analysis-lambda/stages/`
- Lambda handlers go in `infra/services/`
- Frontend hooks use TanStack Query + `apiClient` for data fetching

### When Fixing Issues

- Check CloudWatch logs and alarms for error context
- Verify agent memory retrieval from Aurora PostgreSQL
- Check DynamoDB dedup cache for stale entries
- Test with property-based testing to ensure correctness properties hold
- Review per-analysis cost metrics for anomalies
- Check WebSocket connection state (DynamoDB connections table)
- Verify on-chain payment verification (subscription-api handler logs)
- Check renewal dedup table for duplicate transaction processing

### Code Quality Standards

- TypeScript strict mode required for all code
- Property-based testing for critical paths (fast-check)
- 30s timeout for LLM-dependent tests
- Comprehensive audit logging for all agent decisions
- All infrastructure changes via CDK (never manual console changes)
- Frontend: typed API client, typed errors, retry logic on all external calls

```
