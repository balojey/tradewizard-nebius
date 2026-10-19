# Building a Multi-Agent Trading Intelligence System on AWS with Strands Agents SDK, Amazon Bedrock, Aurora PostgreSQL, and DynamoDB

**How we orchestrate 14 specialized AI agents across 7 foundation models in a single Lambda function - with Aurora Serverless v2 as the durable brain (agent memory, performance scoring, closed-loop learning) and DynamoDB as the speed layer (dedup cache, WebSocket connections, rate limiting, distributed locks).**

---

## The Problem We Solved

Prediction markets on platforms like Polymarket let anyone trade real-world outcomes - elections, court rulings, economic events - but they offer markets without intelligence. To trade well, you need to simultaneously monitor breaking news, read polling data, watch order books for whale activity, track narrative velocity, and time entries against catalysts. That's five different analytical jobs. Most retail traders have none of them.

TradeWizard is the intelligence layer we built to close that gap. It's a production-grade platform that runs a multi-agent AI analysis workflow on every market a user requests, producing explainable trade recommendations with entry zones, stop-losses, expected value, and full reasoning chains - or a structured refusal when the system doesn't have enough conviction to recommend.

This post covers the architecture decisions, the AWS services that make it work, and the patterns we discovered building a multi-agent system that needs to be both fast and trustworthy.

---

## Architecture Overview

TradeWizard runs entirely on AWS with no long-lived servers. The analysis intelligence lives in two Lambda functions orchestrated by the Strands Agents SDK in TypeScript:

- **Analysis_Lambda** - an 11-stage workflow that runs 14 parallel intelligence agents, fuses their signals deterministically, debates the result adversarially, and produces a final recommendation.
- **Portfolio_Lambda** - a persona-driven agent that consumes analysis results and makes autonomous trade entry/exit decisions within hard risk limits.

Both use Amazon Bedrock as the model provider, with multi-model routing across 7 foundation models.

```
User Request → API Gateway → Lambda (analysis-request)
  → Credit check (Aurora) → Dedup check (DynamoDB)
  → SQS FIFO → Lambda (orchestrator)
    → Lambda invoke (Analysis_Lambda - 11 stages)
    → Store result (Aurora + S3)
    → SNS fan-out → Delivery Lambdas (WebSocket, Email, Push, Webhook)
```

### AWS Services in Play

| Service | Role |
|---------|------|
| AWS Lambda (Node.js 20) | All compute - request handling, orchestration, agents, delivery |
| Amazon Bedrock | LLM inference for 7 models via Strands SDK BedrockModel |
| Aurora PostgreSQL Serverless v2 | Users, subscriptions, results, agent memory, performance tracking |
| Amazon DynamoDB | Dedup cache (1h TTL), WebSocket connections, rate limiting |
| Amazon SQS (FIFO) | Analysis queue with DLQ and 3-retry backoff |
| Amazon EventBridge | Recurring analysis scheduling, event routing |
| Amazon SNS | Fan-out to delivery Lambdas (parallel multi-channel) |
| Amazon S3 | Analysis artifacts, agent traces |
| Amazon Cognito | Passwordless auth (Custom Auth / Magic Link) |
| Amazon SES | Email delivery |
| AWS CDK (TypeScript) | Infrastructure as code for everything |
| AWS Amplify Hosting | Next.js 16 frontend with SSR |

Baseline infrastructure cost: ~$15–20/month at idle. Aurora scales to 0.5 ACU when idle, no NAT Gateway (public endpoint with SSL enforcement), no ElastiCache (DynamoDB with TTL instead). We built this for the [H0: Hack the Zero Stack](https://h01.devpost.com/) hackathon - and the "zero stack" philosophy stuck: every service earns its place or gets removed.

---

## Multi-Model Routing: Why One Model Isn't Enough

Our first iteration ran all 14 agents on a single model (Nova 2 Lite). It worked - until we hit RPM limits under parallel execution. Running 14 agents simultaneously on one model with 20 RPM is a bottleneck by definition.

The solution was `multi-model.ts` - a routing layer that distributes agents across models based on two criteria: **capability match** and **RPM budget**.

```typescript
// Agent → Model assignment (simplified)
const AGENT_MODEL_ASSIGNMENT: Record<AgentName, string> = {
  // Nova Micro (200 RPM) - fast data-crunching agents
  market_microstructure: 'nova_micro',
  probability_baseline: 'nova_micro',
  momentum: 'nova_micro',

  // Nova Lite (200 RPM) - analytical agents
  risk_assessment: 'nova_lite',
  polling_intelligence: 'nova_lite',
  mean_reversion: 'nova_lite',

  // Nemotron 3 Super (100 RPM) - agentic, news-heavy
  breaking_news: 'nemotron',
  event_impact: 'nemotron',
  historical_patterns: 'nemotron',

  // GPT-OSS 120B (100 RPM) - sentiment reasoning
  media_sentiment: 'gpt_oss',
  social_sentiment: 'gpt_oss',
  narrative_velocity: 'gpt_oss',

  // Kimi K2 Thinking (100 RPM) - deep scenario reasoning
  catalyst_identification: 'kimi_k2',
  tail_risk: 'kimi_k2',
};

// Non-tool stages use Llama 3.3 70B (8000 RPM, no tool-calling)
const STAGE_MODEL_ASSIGNMENT = {
  thesis: 'llama_3_3',
  cross_exam: 'llama_3_3',
  risk_aggressive: 'llama_3_3',
  risk_conservative: 'llama_3_3',
  risk_neutral: 'llama_3_3',
  recommendation: 'llama_3_3',
};
```

Each model instance is cached per Lambda container (cold-start optimization), and all model IDs are environment-driven - no hardcoding.

**The key insight:** Match models to workload characteristics, not just quality. Nova Micro is fast and cheap for numeric data crunching. Kimi K2 is slower but better for complex multi-step scenario reasoning. Llama 3.3 has massive RPM headroom but no tool-calling - perfect for pure synthesis stages that don't need external data.

Total tool-capable RPM across the fleet: ~720. Each model handles at most 3 agents in parallel. No single model becomes a bottleneck.

---

## The Strands Agents SDK: Agent-as-Code in TypeScript

We chose the Strands Agents SDK because it gave us agent orchestration without leaving TypeScript. The entire stack - CDK, Lambda handlers, agents, and frontend - is one language.

Here's a simplified view of how we define and run an intelligence agent:

```typescript
import { Agent } from '@strands-agents/sdk';
import { BedrockModel } from '@strands-agents/sdk';
import { getModelForAgent } from '../lib/multi-model';
import { getToolsForAgent } from '../tools/tool-factory';

async function runAgent(
  agentName: AgentName,
  systemPrompt: string,
  context: string,
): Promise<AgentSignal> {
  const model = getModelForAgent(agentName);  // Routes to correct Bedrock model
  const tools = getToolsForAgent(agentName);  // News, search, shell, or none

  const agent = new Agent({
    model,
    tools,
    systemPrompt,
  });

  const response = await agent.run(context);
  return parseAndValidateSignal(response);  // Zod schema enforcement
}
```

All 14 agents run in parallel via `Promise.all` with a 120-second per-agent timeout. If an agent fails to produce valid output (timeout, parse failure, model error), it's excluded from downstream stages - not retried. The system degrades gracefully rather than blocking on a single slow agent.

### Custom Tools

Each agent gets a tool kit matched to its analytical role:

- **News tool** (NewsData.io): API key rotation across multiple keys, 15-second timeout, structured response parsing.
- **Search tool** (Serper): Web search + page scrape. Key rotation, result truncation to stay within context windows.
- **Shell tool**: Sandboxed bash/Python execution on `/tmp`. Used by price-aware agents to run numeric analysis over the CSV data-preparation stage writes. 30-second timeout, output capped at 4KB.

Tools are wrapped with error handling so a dead API key or slow response doesn't crash the run - the agent proceeds with whatever data it could gather.

---

## The Three Deterministic Gates

This is the architectural decision we're most proud of. Between the LLM-generated agent signals and what reaches the user, three non-LLM stages act as hard validation gates.

### Gate 1: Signal Fusion (Pure TypeScript, No LLM)

```typescript
export function fuseSignals(
  signals: AgentSignal[],
  agentPerformance: Record<string, number>,
): FusedSignal {
  // Weight = type_weight × confidence × historical_accuracy
  // Divergence penalty: if max spread > 70%, confidence halved
  // Output: weighted fair probability, conflict map
}
```

Agent performance weights come from a closed-loop scoring system: every recommendation is tracked against the market's actual price movement. Agents that were right gain influence (up to 2×). Agents that were wrong lose influence (down to 0.5×). This feeds back into the next analysis automatically.

### Gate 2: Adversarial Cross-Examination

A Llama 3.3 agent generates bull and bear theses, then a second agent runs 5 adversarial tests against each:

1. **Evidence test** - Are claims verifiable?
2. **Causality test** - Is the thesis confusing correlation with causation?
3. **Timing test** - Are catalysts realistic given market expiry?
4. **Liquidity test** - Can the position be executed without slippage?
5. **Tail risk test** - Are low-probability high-impact scenarios covered?

Each test produces a structured score. The debate is not prose - it's a typed object the consensus engine can compute over.

### Gate 3: Consensus Engine (Pure TypeScript, No LLM)

```typescript
// Disagreement = stddev of agent fair probabilities
// If disagreement > 0.30 → consensus FAILS → forced NO_TRADE
// If EV ≤ 0 → recommendation REJECTED → forced NO_TRADE
```

The consensus engine computes a final probability weighted by debate scores and agent accuracy. If agents fundamentally disagree (>30% spread), the system refuses to recommend. This is not a prompt instruction - it's a deterministic check the model cannot override.

**Why this matters:** LLMs are probabilistic. They will occasionally hallucinate confidence. The deterministic gates ensure that even a confidently wrong model cannot produce a recommendation that violates basic statistical sanity.

---

## Aurora PostgreSQL Serverless v2: The Durable Brain

Aurora is where everything that needs to survive a Lambda cold start lives. We use it as the single source of truth for the entire intelligence lifecycle - from agent memory through recommendation scoring to Portfolio Manager state.

### What Aurora Stores

| Table | Purpose | Access Pattern |
|-------|---------|---------------|
| `agent_memory` | Per-agent historical signals keyed by market + result | Read at analysis start (per-agent isolation), write after each analysis |
| `agent_performance` | Accuracy stats per agent (total signals, correct signals, avg confidence) | Read at analysis start for weighting, upsert after each scoring event |
| `analysis_results` | Full recommendation payloads with outcome tracking (pending/success/failure/expired) | Write after analysis, read by scorer every 5min, read by users for history |
| `analysis_deliveries` | Per-user delivery dedup (which user received which result) | Read on every request to prevent double-billing, write on delivery |
| `market_analysis_schedule` | Recurring analysis cadences and subscriber lists per market | Read/write by scheduler and request handler |
| `credit_transactions` | Immutable audit trail of every credit movement | Append-only writes, read for balance checks |
| `portfolio_manager_sessions` | Active PM sessions with capital, persona, position state | Read/write by Trade Executor, Position Guard, Risk Engine |
| `portfolio_manager_trades` | Full trade history (entry, exit, P&L, SL/TP levels) | Write on trade events, read by dashboard |
| `portfolio_manager_decisions` | Complete decision audit log (every entry/skip/exit with reasoning) | Append-only writes, read by dashboard |

### Why Aurora Serverless v2

- **Scales to 0.5 ACU at idle.** We pay ~$45/month for the cluster when traffic is low. Under load, it auto-scales without intervention.
- **PostgreSQL feature set.** We use CTEs, window functions, `ON CONFLICT DO UPDATE` (upserts) for atomic agent scoring, and `INTERVAL` arithmetic for freshness checks - none of which DynamoDB offers.
- **Relational joins.** The scoring Lambda joins `agent_memory` with `analysis_results` to compute per-market and global accuracy. The weight calculation query is a single SQL statement, not an application-level scatter-gather.
- **Transaction safety.** Credit deductions, delivery tracking, and subscriber management require ACID guarantees. A user must never be charged twice or receive a result without being charged.

### The Memory Architecture

Agent memory is the foundation of closed-loop learning. The key design decision: **each agent sees only its own history**.

```sql
-- Fetched at analysis start (per-agent isolation)
SELECT direction, confidence, fair_probability, key_drivers, risk_factors
FROM agent_memory
WHERE market_id = $1 AND agent_name = $2
ORDER BY created_at DESC
LIMIT $3  -- ANALYSIS_HISTORY_DEPTH (default 5, max 20)
```

We deliberately avoided cross-agent history because it caused anchoring - agents converging on each other's prior outputs instead of reasoning independently. Per-agent isolation makes the disagreement index a genuine signal of market uncertainty rather than a measure of how much agents copy each other.

### No NAT Gateway: Public Aurora Endpoint

We run Aurora on a public endpoint with SSL enforcement (`sslmode=no-verify` at the client, but transport is encrypted). This eliminates the $45/month NAT Gateway cost that would otherwise be required for Lambda functions in a private subnet to reach the internet. At our scale, the NAT is more expensive than the database itself. Security is maintained through:
- Security group allowing inbound only from Lambda's security group
- SSL/TLS in transit (enforced at the cluster level)
- Credentials stored in AWS Secrets Manager
- `statement_timeout` on all queries to prevent runaway connections

---

## DynamoDB: The Speed Layer

DynamoDB handles every access pattern that needs single-digit millisecond latency, doesn't require relational joins, and benefits from automatic TTL cleanup.

### Access Patterns

| Table / Key Pattern | Purpose | TTL |
|---------------------|---------|-----|
| `pk: dedup#<marketId>` | Analysis freshness cache - is there a result < 1hr old? | 1 hour |
| `pk: inflight#<marketId>` | In-flight tracking - is an analysis currently running? | 10 minutes |
| `pk: ws#<connectionId>` | WebSocket connection registry (userId, connectedAt) | 24 hours |
| `pk: rate#<userId>#<action>` | Rate limiting (requests per minute/hour) | Sliding window |
| `pk: lock#<sessionId>` | Distributed lock for Trade Executor (mutual exclusion) | 2 minutes |
| `pk: kill_switch#<userId>` | Kill switch state (active/reset timestamp) | None (permanent until user resets) |
| `pk: cooldown#<sessionId>` | Loss-exit cooldown tracking | 30 minutes |

### Why DynamoDB Instead of ElastiCache

Our initial architecture had ElastiCache (Redis) for the dedup cache and rate limiting. We replaced it with DynamoDB for three reasons:

1. **Cost.** A single-node ElastiCache cluster starts at ~$15/month even at idle. DynamoDB on-demand pricing for our access patterns is under $1/month at low traffic and scales linearly.
2. **TTL is native.** Redis requires explicit expiry management or eviction policies. DynamoDB TTL is a column - set it on write, forget about it. Items disappear automatically.
3. **No cluster management.** ElastiCache requires selecting node types, managing failover, and monitoring memory. DynamoDB on-demand just works.

The trade-off: DynamoDB latency is 5–10ms vs. Redis's sub-millisecond. For our access patterns (dedup check on every analysis request, rate limit check on every API call), 5ms is fine. We're not building a real-time trading engine at the dedup layer - we're preventing redundant Bedrock invocations.

### The Dedup Flow (DynamoDB + Aurora working together)

```
Request arrives for market X
  │
  ├─ DynamoDB GET: dedup#<marketId>
  │   ├─ EXISTS (TTL not expired) → fresh result available
  │   │   └─ Aurora: SELECT FROM analysis_deliveries WHERE user_id = $1 AND result_id = $2
  │   │       ├─ NOT DELIVERED → deliver, charge 1 credit, INSERT delivery record
  │   │       └─ ALREADY DELIVERED → "next analysis available in X minutes"
  │   │
  │   └─ NOT EXISTS → check inflight
  │       ├─ DynamoDB GET: inflight#<marketId>
  │       │   ├─ EXISTS → subscribe user to pending result (Aurora: INSERT subscriber)
  │       │   └─ NOT EXISTS → dispatch new analysis
  │       │       ├─ DynamoDB PUT: inflight#<marketId> (TTL 10min)
  │       │       └─ SQS: send to analysis queue
  │       │
  │       └─ On analysis complete:
  │           ├─ Aurora: INSERT analysis_results
  │           ├─ DynamoDB PUT: dedup#<marketId> (TTL 1hr)
  │           ├─ DynamoDB DELETE: inflight#<marketId>
  │           └─ SNS: fan-out to delivery Lambdas
```

DynamoDB provides the millisecond-latency gate (should we even look at Aurora?). Aurora provides the durable, relational state (who has received what, who owes a credit). The split keeps each service in its natural operating range.

### WebSocket Connections (DynamoDB)

Real-time delivery uses API Gateway WebSocket. Connection state lives in DynamoDB:

```typescript
// On $connect: store connection with userId and TTL
await dynamoClient.send(new PutItemCommand({
  TableName: CONNECTIONS_TABLE,
  Item: marshall({
    pk: `ws#${connectionId}`,
    userId,
    connectedAt: Date.now(),
    ttl: Math.floor(Date.now() / 1000) + 86400, // 24hr TTL
  }),
}));

// On delivery: find all connections for a user
const connections = await dynamoClient.send(new QueryCommand({
  TableName: CONNECTIONS_TABLE,
  IndexName: 'userId-index',
  KeyConditionExpression: 'userId = :uid',
  ExpressionAttributeValues: marshall({ ':uid': userId }),
}));
```

Stale connections (410 Gone response from API Gateway) are deleted immediately. TTL handles connections that disconnected without a clean `$disconnect` event (client crash, network drop).

### Distributed Locks for Portfolio Manager (DynamoDB)

The Trade Executor and Position Guard must never act on the same session simultaneously. We use DynamoDB conditional writes as a distributed lock:

```typescript
// Acquire lock (fails if already held)
await dynamoClient.send(new PutItemCommand({
  TableName: RATE_LIMIT_TABLE,
  Item: marshall({
    pk: `lock#${sessionId}`,
    sk: 'executor',
    acquiredAt: Date.now(),
    ttl: Math.floor(Date.now() / 1000) + 120, // 2min auto-release
  }),
  ConditionExpression: 'attribute_not_exists(pk)',
}));
```

If the lock is already held (conditional check fails), the executor records a `skipReason: 'pipeline_failure'` decision and exits cleanly. The 2-minute TTL prevents deadlocks if a Lambda times out while holding the lock.

---

## Market-Level Analysis Pool: The Cost Architecture

At scale, naive per-user execution is financial suicide. If 10,000 users request analysis on the same election market in the same hour, that's 10,000 Bedrock invocations at ~$0.15 each = $1,500. With our dedup architecture, it's 1 invocation = $0.15.

The pattern:

1. **DynamoDB dedup cache** with 1-hour TTL tracks which markets have fresh results.
2. When a request arrives, check the cache:
   - Fresh result exists + user hasn't received it → deliver immediately, charge 1 credit.
   - Analysis in-flight → subscribe user to pending result.
   - Nothing fresh → dispatch new execution via SQS.
3. **Per-user delivery tracking** in Aurora's `analysis_deliveries` table ensures users never pay twice for the same result.
4. **Recurring schedules coalesce** - multiple users' intervals on the same market collapse to the shortest active cadence.

The cost scales with *markets analyzed*, not with *users requesting*. That's the unit economics that makes the platform viable.

---

## Closed-Loop Learning: Agents That Get Better (Aurora as the Learning Fabric)

The closed-loop scoring system is entirely Aurora-native. Every recommendation enters a `pending` state in the `analysis_results` table. A Recommendation Scorer Lambda runs every 5 minutes:

- Fetches current market prices from Polymarket's Gamma API.
- Queries Aurora: `SELECT FROM analysis_results WHERE outcome_status = 'pending' AND recommendation IN ('LONG_YES', 'LONG_NO') LIMIT 200`
- If price hits the recommendation's **take-profit** → `UPDATE analysis_results SET outcome_status = 'success'`
- If price hits the **stop-loss** → `UPDATE analysis_results SET outcome_status = 'failure'`
- If neither within 7 days → `UPDATE analysis_results SET outcome_status = 'expired'`

On success or failure, every contributing agent is scored via an atomic upsert in Aurora:

```typescript
// Aligned agent + success = correct++
// Aligned agent + failure = incorrect++
// Dissenting agent + failure = correct++ (they were right to dissent)
```

These scores feed into `fetchAgentPerformanceWeights()`, which the next analysis calls during historical context retrieval. The weight formula:

```
weight = 0.5 + (accuracy × 1.5)
// 0% accuracy → 0.5 (half influence)
// 50% accuracy → 1.0 (neutral)
// 100% accuracy → 2.0 (double influence)
```

The system self-corrects toward agents that are empirically right. No manual tuning, no retraining - just outcome-driven weight adjustment on every recommendation that resolves.

---

## The Autonomous Portfolio Manager: Bounded Autonomy on Lambda

The Portfolio Manager is where the architecture gets interesting from a safety perspective. It trades real money autonomously - but within a perimeter the user defines and cannot be exceeded by design.

**Architectural split:**
- **Portfolio_Lambda** (the agent) has **read-only tools**. It can fetch market data, order books, analysis results, and trade history. It cannot place an order.
- **Trade Executor Lambda** (the enforcer) receives the agent's structured decision and validates it against hard limits before calling the Polymarket CLOB API.

The hard limits enforced by the executor (in code, not in prompts):
- Mandatory stop-loss and take-profit on every position
- 50% per-session loss limit, 40% cross-session cap
- 30-minute cooldown after loss exits
- 50% max position size per session capital
- Token ID resolved by outcome string (never array index)
- Mutual exclusion between Trade Executor and Position Guard

The kill switch fails closed - if any internal check errors during emergency exit, the system stops all activity rather than continuing. Re-activation requires explicit human action.

---

## What We'd Do Differently

**Start with multi-model routing from day one.** We lost time hitting RPM limits on a single model before distributing the workload. The routing layer is simple to build and eliminates an entire class of scaling problems.

**Make the consensus engine stricter earlier.** Our first version under-weighted disagreement. The 30% threshold and the per-agent isolated memory (no cross-agent history to prevent anchoring) made the system dramatically more useful by letting it refuse.

**DynamoDB for dedup instead of ElastiCache - but we'd plan the key schema earlier.** We initially planned Redis, then switched to DynamoDB after realizing the cost difference was $15/month for a service we'd have to manage vs. pennies for one we wouldn't. The switch was easy because our access patterns (key-value with TTL) are DynamoDB's sweet spot. But we designed the partition key schema ad-hoc and had to refactor once when we added the distributed lock pattern. Planning the single-table design upfront would have saved a migration.

**Aurora Serverless v2's cold start matters less than we feared.** We spent time optimizing connection pooling expecting cold-start latency to be painful. In practice, the cluster stays warm with the Recommendation Scorer hitting it every 5 minutes, and the 0.5 ACU minimum means it never truly sleeps. The real lesson: keep at least one periodic workload touching the cluster and cold starts become irrelevant.

---

## Results

- 14 agents running in parallel across 7 Bedrock models in a single Lambda invocation
- ~20–25 LLM calls per analysis, completing within Lambda's timeout
- $15–20/month baseline infrastructure (Aurora Serverless v2 at 0.5 ACU + DynamoDB on-demand + Lambda)
- DynamoDB dedup cache reduces Bedrock cost by orders of magnitude at scale (10,000 requests → 1 invocation)
- Aurora stores the complete learning fabric: agent memory, performance scoring, delivery accounting, trade audit trails
- DynamoDB handles all millisecond-latency gates: dedup, rate limits, WebSocket connections, distributed locks, kill switch state
- Closed-loop scoring in Aurora adjusts agent weights without manual intervention
- The system refuses to recommend when disagreement exceeds 30% - by design, not by accident
- Zero ElastiCache, zero NAT Gateway, zero always-on compute - every dollar of infrastructure earns its keep

---

## Try It / Learn More

- **GitHub**: [https://github.com/balojey/tradewizard-ai](https://github.com/balojey/tradewizard-ai)
- **Live demo**: [https://tradewizard.live](https://tradewizard.live)
- **Strands Agents SDK**: [https://github.com/strands-agents/sdk-typescript](https://github.com/strands-agents/sdk-typescript)

---

*Built with AWS Lambda, Amazon Bedrock, Aurora PostgreSQL Serverless v2, DynamoDB, SQS, SNS, EventBridge, API Gateway, Cognito, SES, S3, CloudWatch, Amplify Hosting, and the Strands Agents SDK.*
