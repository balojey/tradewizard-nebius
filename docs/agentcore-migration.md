# TradeWizard - Bedrock AgentCore Migration Plan

## Executive Summary

Our current implementation uses the **legacy Amazon Bedrock Agents API** (`CreateAgent`/`InvokeAgent` via `@aws-sdk/client-bedrock-agent`), not **Amazon Bedrock AgentCore**. These are two completely different AWS services. This document outlines what we have, what AgentCore actually is, and the migration path to embrace it properly.

---

## What We Have Today (WRONG)

### Current Architecture

```
Lambda (orchestrator)
  → @aws-sdk/client-bedrock-agent-runtime → InvokeAgentCommand
  → Bedrock Agents (legacy managed service)
  → Each "agent" is just an instruction string + model ID
  → No actual agent code - AWS runs a ReAct loop internally
```

### Files to Scrap

| File | What it does (incorrectly) | Why it's wrong |
|------|---------------------------|----------------|
| `infra/agents/deploy-agents.ts` | Uses `CreateAgentCommand` from `@aws-sdk/client-bedrock-agent` to register 20+ agents as legacy Bedrock Agents | This is the old Bedrock Agents API, not AgentCore. AgentCore uses `CreateAgentRuntime` and deploys actual code. |
| `infra/lib/bedrock-stack.ts` | Creates IAM role trusting `bedrock.amazonaws.com` | AgentCore requires `bedrock-agentcore.amazonaws.com` as the trusted principal |
| `infra/services/analysis-orchestrator/handler.ts` | Invokes agents via `InvokeAgentCommand` from `@aws-sdk/client-bedrock-agent-runtime` | AgentCore uses `bedrock-agentcore:InvokeAgentRuntime` - a completely different API |
| `infra/agents/agent-definitions.ts` | Defines agents as instruction strings + model IDs | In AgentCore, agents are actual Python code using Strands SDK, wrapped with `BedrockAgentCoreApp` |

### What the Legacy Bedrock Agents API Does

- You give AWS an instruction string, a model ID, and optional action groups (Lambda-backed tools)
- AWS manages the entire agent loop internally (ReAct pattern)
- You invoke via `bedrock:InvokeAgent` with a text prompt
- You have zero control over the execution - no custom logic, no framework choice
- SDK: `@aws-sdk/client-bedrock-agent` / `@aws-sdk/client-bedrock-agent-runtime`

---

## What Bedrock AgentCore Actually Is

### Core Concept

AgentCore is a **serverless hosting platform for your own agent code**. You write the agent logic yourself (in Python, using any framework), and AgentCore handles:

- Isolated microVM execution (Firecracker)
- Session management (persistent filesystem per session)
- Auto-scaling and cold start optimization
- Built-in primitives: Memory, Browser, Code Interpreter, Gateway, Identity

### Key Differences

| Aspect | Legacy Bedrock Agents (what we use) | Bedrock AgentCore (what we should use) |
|--------|-------------------------------------|----------------------------------------|
| Agent code | None - just instruction strings | Full Python application you write |
| Framework | AWS-managed ReAct loop | Bring your own: Strands, LangGraph, CrewAI, etc. |
| Deployment | `CreateAgent` API call | Deploy Python code to AgentCore Runtime (zip or container) |
| Invocation | `bedrock:InvokeAgent` | `bedrock-agentcore:InvokeAgentRuntime` |
| Tools | Action Groups (Lambda-backed) | Native framework tools (Strands tools, Python functions) |
| SDK | `@aws-sdk/client-bedrock-agent` | `bedrock-agentcore` Python SDK (agent code) + `@aws/agentcore` npm CLI (project management & deployment) |
| Session | Managed by Bedrock, opaque | MicroVM with filesystem persistence, you control state |
| IAM trust | `bedrock.amazonaws.com` | `bedrock-agentcore.amazonaws.com` |
| Runtime | Node.js or Python (AWS chooses) | Python (you control version, deps, everything) |
| Protocols | Proprietary | HTTP, MCP, A2A (Agent-to-Agent), WebSocket |
| Built-in tools | None beyond action groups | Browser, Code Interpreter, Memory, Gateway |

### AgentCore Services

1. **AgentCore Runtime** - Serverless hosting for agent code in isolated microVMs
2. **AgentCore Memory** - Managed memory with semantic search, event storage, extraction strategies
3. **AgentCore Browser** - Cloud browser in Firecracker microVMs for web research
4. **AgentCore Code Interpreter** - Sandboxed Python/JS/TS execution
5. **AgentCore Gateway** - MCP-compatible gateway exposing APIs as agent tools
6. **AgentCore Identity** - Credential management (API keys, OAuth2) for agent tool access
7. **AgentCore Observability** - Tracing and monitoring

### How Agent Code Looks in AgentCore

```python
# main.py - A single TradeWizard agent deployed to AgentCore Runtime
from strands import Agent
from strands_tools import http_request
from bedrock_agentcore.runtime import BedrockAgentCoreApp

# Create the Strands agent with tools
agent = Agent(
    model="us.amazon.nova-2-lite-v1:0",
    tools=[http_request, custom_polymarket_tool, browser_tool],
    system_prompt="You are the Market Microstructure Agent..."
)

# Wrap with AgentCore Runtime SDK
app = BedrockAgentCoreApp()

@app.entrypoint
def handle_request(payload, context):
    """Handler invoked by AgentCore Runtime."""
    prompt = payload.get("prompt", "")
    result = agent(prompt)
    return {"result": result.message}

app.run()
```

---

## Target Architecture

### Option A: Single Orchestrator Runtime (Recommended for V2 MVP)

Deploy ONE AgentCore Runtime that contains the full orchestrator + all agent logic internally using Strands multi-agent patterns.

```
SQS → Lambda (thin dispatcher)
  → bedrock-agentcore:InvokeAgentRuntime (orchestrator runtime)
    → Strands Agent orchestrator (Python)
      → Internally creates/invokes sub-agents using Strands SDK
      → Uses AgentCore Browser for web research
      → Uses AgentCore Memory for historical signals
      → Runs signal fusion + consensus (deterministic Python)
      → Returns final TradeRecommendation JSON
  → Lambda stores result in S3, publishes to EventBridge
```

**Pros:**
- Simplest deployment (one runtime)
- All agent coordination happens in-process (fast, no network hops between agents)
- Single session maintains state across the full workflow
- Cheapest (one microVM session per analysis)

**Cons:**
- All agents share one microVM's resources
- Can't scale individual agents independently
- Single point of failure for the whole workflow

### Option B: Multi-Runtime with A2A (Future Scale)

Each specialist agent is its own AgentCore Runtime. The orchestrator runtime invokes them via `InvokeAgentRuntime`.

```
SQS → Lambda (thin dispatcher)
  → InvokeAgentRuntime (orchestrator)
    → InvokeAgentRuntime (web-research agent)
    → InvokeAgentRuntime (market-microstructure agent)
    → InvokeAgentRuntime (polling-intelligence agent)
    → ... (parallel)
    → Deterministic fusion + consensus
    → InvokeAgentRuntime (recommendation-generation agent)
    → Returns final result
```

**Pros:**
- Each agent scales independently
- Fault isolation (one agent failure doesn't kill others)
- Can version/update agents independently
- Matches the multi-agent architecture conceptually

**Cons:**
- More infrastructure (20+ runtimes)
- Network latency between agent invocations
- Higher cost (each runtime = separate microVM session)
- More complex deployment and IAM

### Recommendation

**Start with Option A** for the hackathon/MVP. Migrate to Option B when you need independent scaling or have revenue justifying the infrastructure cost.

---

## Migration Steps

### Phase 1: Scrap Legacy Bedrock Agents Infrastructure

#### 1.1 Delete legacy agent deployment

```bash
# Remove the old deploy-agents.ts script
rm infra/agents/deploy-agents.ts

# Remove the old agent-definitions.ts (will be replaced with Python agent code)
rm infra/agents/agent-definitions.ts
```

#### 1.2 Rewrite `bedrock-stack.ts`

Replace the current stack with AgentCore-compatible IAM:

```typescript
// New trust principal for AgentCore
this.agentExecutionRole = new iam.Role(this, 'AgentCoreExecutionRole', {
  roleName: resourceName(config.envName, 'agentcore-execution-role'),
  assumedBy: new iam.ServicePrincipal('bedrock-agentcore.amazonaws.com'),
  description: 'Execution role for AgentCore Runtime',
});

// AgentCore-specific permissions
this.agentExecutionRole.addToPolicy(new iam.PolicyStatement({
  actions: [
    'bedrock:InvokeModel',
    'bedrock:InvokeModelWithResponseStream',
  ],
  resources: ['*'],
}));

// CloudWatch Logs (required for AgentCore)
this.agentExecutionRole.addToPolicy(new iam.PolicyStatement({
  actions: [
    'logs:CreateLogGroup',
    'logs:CreateLogStream',
    'logs:PutLogEvents',
  ],
  resources: ['*'],
}));

// Orchestrator Lambda needs AgentCore invocation permissions
this.orchestratorRole.addToPolicy(new iam.PolicyStatement({
  actions: [
    'bedrock-agentcore:InvokeAgentRuntime',
    'bedrock-agentcore:StopRuntimeSession',
  ],
  resources: ['*'],
}));
```

#### 1.3 Rewrite the orchestrator Lambda

The Lambda becomes a thin dispatcher that invokes the AgentCore Runtime:

```typescript
// New orchestrator handler - invokes AgentCore Runtime instead of legacy Bedrock Agents
import { BedrockAgentCoreClient, InvokeAgentRuntimeCommand, StopRuntimeSessionCommand } from '@aws-sdk/client-bedrock-agentcore';

const client = new BedrockAgentCoreClient({ region: process.env.AWS_REGION });
const RUNTIME_ARN = process.env.AGENTCORE_RUNTIME_ARN; // From CDK output

async function invokeOrchestrator(marketId: string, userId: string): Promise<TradeRecommendation> {
  const sessionId = `analysis-${crypto.randomUUID()}`;

  const response = await client.send(new InvokeAgentRuntimeCommand({
    agentRuntimeArn: RUNTIME_ARN,
    runtimeSessionId: sessionId,
    qualifier: 'DEFAULT',
    payload: Buffer.from(JSON.stringify({
      prompt: `Analyze market ${marketId}`,
      marketId,
      userId,
    })),
  }));

  // Parse response
  const result = JSON.parse(new TextDecoder().decode(response.payload));

  // Stop session to save costs (don't wait for idle timeout)
  await client.send(new StopRuntimeSessionCommand({
    agentRuntimeArn: RUNTIME_ARN,
    runtimeSessionId: sessionId,
  }));

  return result;
}
```

### Phase 2: Build the AgentCore Python Application

#### 2.1 Project structure

```
infra/agentcore/
├── agentcore/
│   ├── agentcore.json             # Project and agent configuration
│   ├── aws-targets.json           # AWS account and region targets
│   └── .env.local                 # Local environment variables (gitignored)
├── app/
│   └── TradeWizardOrchestrator/
│       ├── main.py                # BedrockAgentCoreApp entrypoint
│       ├── orchestrator.py        # 11-stage workflow coordinator
│       ├── agents/
│       │   ├── __init__.py
│       │   ├── web_research.py    # Web research agent (uses AgentCore Browser)
│       │   ├── market_microstructure.py
│       │   ├── probability_baseline.py
│       │   ├── risk_assessment.py
│       │   ├── breaking_news.py
│       │   ├── polling_intelligence.py
│       │   ├── media_sentiment.py
│       │   ├── thesis_construction.py
│       │   ├── cross_examination.py
│       │   ├── recommendation.py
│       │   └── risk_philosophy.py
│       ├── tools/
│       │   ├── __init__.py
│       │   ├── polymarket.py      # Polymarket CLOB/Gamma API tool
│       │   └── browser.py         # AgentCore Browser integration
│       ├── fusion/
│       │   ├── __init__.py
│       │   ├── signal_fusion.py   # Deterministic signal fusion (ported from TS)
│       │   └── consensus_engine.py # Deterministic consensus (ported from TS)
│       ├── models/
│       │   ├── __init__.py
│       │   └── types.py           # AgentSignal, Thesis, TradeRecommendation dataclasses
│       └── pyproject.toml         # Python dependencies
└── README.md
```

#### 2.2 Main entrypoint (`main.py`)

```python
from bedrock_agentcore.runtime import BedrockAgentCoreApp
from orchestrator import run_analysis_workflow

app = BedrockAgentCoreApp()

@app.entrypoint
def handle_analysis(payload, context):
    """Main entrypoint for the TradeWizard analysis workflow."""
    market_id = payload.get("marketId")
    user_id = payload.get("userId")

    result = run_analysis_workflow(market_id, user_id)
    return result

if __name__ == "__main__":
    app.run()
```

#### 2.3 Orchestrator (`orchestrator.py`)

```python
from strands import Agent
from agents.web_research import create_web_research_agent
from agents.market_microstructure import create_microstructure_agent
from agents.thesis_construction import create_thesis_agent
# ... etc
from fusion.signal_fusion import fuse_signals
from fusion.consensus_engine import calculate_consensus, determine_action
from tools.polymarket import fetch_market_briefing

async def run_analysis_workflow(market_id: str, user_id: str) -> dict:
    """Execute the full 11-stage analysis workflow."""

    # Stage 1: Market Ingestion (direct API call, no LLM)
    market_data = await fetch_market_briefing(market_id)

    # Stage 2: Memory Retrieval
    # TODO: Use AgentCore Memory or direct RDS query
    memory_context = ""

    # Stage 3: Web Research (uses AgentCore Browser)
    web_agent = create_web_research_agent()
    web_research = web_agent(f"Research: {market_data['question']}")

    # Stage 4: Dynamic Agent Selection
    active_agents = select_agents(market_data)

    # Stage 5: Parallel Intelligence Agents
    import asyncio
    signals = await asyncio.gather(*[
        run_intelligence_agent(name, market_data, web_research.message)
        for name in active_agents
    ])

    # Stage 6: Signal Fusion (deterministic)
    fused = fuse_signals(signals, agent_performance={})

    # Stage 7-8: Thesis + Cross-Examination
    thesis_agent = create_thesis_agent()
    theses = thesis_agent(f"Build theses from: {fused}")
    cross_exam_agent = create_cross_exam_agent()
    cross_exam = cross_exam_agent(f"Test theses: {theses.message}")

    # Stage 9: Consensus (deterministic)
    consensus = calculate_consensus(bull_thesis, bear_thesis, cross_exam, fused)

    # Stage 10-11: Risk + Recommendation
    # ...

    return recommendation
```

#### 2.4 Individual agent example (`agents/web_research.py`)

```python
from strands import Agent

def create_web_research_agent() -> Agent:
    """Create the web research agent with AgentCore Browser tool."""
    return Agent(
        model="us.amazon.nova-2-lite-v1:0",
        tools=[browser_tool],  # AgentCore Browser
        system_prompt="""You are the Web Research Agent - the primary data gatherer.
        Research current events for the given market topic.
        Find breaking news, expert opinions, data points, and upcoming catalysts.
        Cross-validate claims against multiple sources.
        Discard information older than 48 hours for prediction markets."""
    )
```

### Phase 3: Deploy to AgentCore

#### 3.1 Install the AgentCore CLI

```bash
npm install -g @aws/agentcore
```

#### 3.2 Create the project (or configure existing code)

**Option A - Scaffold a new project:**
```bash
agentcore create --name TradeWizardOrchestrator --framework Strands --model-provider Bedrock --memory none --defaults
cd TradeWizardOrchestrator
# Then copy your agent code into app/TradeWizardOrchestrator/main.py
```

**Option B - Configure existing code:**
```bash
cd infra/agentcore
# Ensure you have a main.py with BedrockAgentCoreApp + @app.entrypoint
# and a requirements.txt with: strands-agents, bedrock-agentcore, strands-agents-tools, boto3
```

#### 3.3 Test locally

```bash
# Start the dev server (auto-creates venv, installs deps, hot-reloads)
agentcore dev

# In another terminal, invoke locally:
agentcore dev '{"marketId": "0x123...", "userId": "user-1"}'
```

#### 3.4 Deploy to AWS

```bash
agentcore deploy
```

This packages your code (CodeZip or Container), deploys via CDK, and creates the AgentCore Runtime.

#### 3.5 Get the Runtime ARN and wire into CDK

After deployment, the Runtime ARN goes into the orchestrator Lambda's environment:

```typescript
// In compute-stack.ts
this.orchestratorHandler.addEnvironment(
  'AGENTCORE_RUNTIME_ARN',
  'arn:aws:bedrock-agentcore:us-east-2:ACCOUNT:runtime/tradewizard-orchestrator'
);
```

### Phase 4: Integrate AgentCore Primitives

#### 4.1 AgentCore Memory (replaces RDS agent_memory table)

```bash
# Using the @aws/agentcore CLI:
agentcore add memory --name MarketSignals --strategies SEMANTIC
# Then redeploy:
agentcore deploy
```

Use Memory to store and retrieve historical agent signals with semantic search instead of raw SQL queries.

#### 4.2 AgentCore Browser (replaces Serper/NewsData APIs)

The Browser tool is available natively in AgentCore Runtime. No API keys needed - agents browse the web autonomously.

```python
from strands import Agent
from strands_tools import http_request  # or use AgentCore Browser directly

# AgentCore Browser is available as a built-in tool in the runtime environment
# Agents can browse the web autonomously without API key subscriptions
agent = Agent(
    model="us.amazon.nova-2-lite-v1:0",
    tools=[http_request],
    system_prompt="Research the web for market intelligence..."
)
```

#### 4.3 AgentCore Gateway (optional - expose Polymarket API as MCP tool)

If you want agents to call Polymarket through a managed gateway:

```bash
agentcore gateway create-mcp-gateway --name PolymarketGateway
# Then add a target with an OpenAPI spec for the Polymarket API
agentcore gateway create-mcp-gateway-target \
  --gateway-arn <ARN from above> \
  --gateway-url <URL from above> \
  --role-arn <role ARN from above> \
  --name PolymarketTarget \
  --target-type openApiSchema \
  --target-payload '{"s3": {"uri": "s3://your-bucket/polymarket-openapi.json"}}'
```

---

## Phase 5: Portfolio Manager Agent (New AgentCore Runtime)

### The Problem

The portfolio manager services (`portfolio-trade-executor`, `portfolio-position-guard`, `portfolio-risk-engine`) are currently **deterministic rule-based Lambdas**. They check thresholds, calculate conviction scores with fixed formulas, and place orders mechanically.

The spec defines 6 distinct personas (Sniper, Scalper, Contrarian, Catalyst Hunter, Hedge Architect, Momentum Rider) - each with unique entry philosophy, monitoring style, and exit behavior. Implementing these as if/else trees produces brittle code that can't adapt to nuance. A real portfolio manager:
- Reasons about *why* an edge exists, not just that it exceeds a threshold
- Considers market context, timing, and regime changes holistically
- Adapts position sizing based on conviction quality AND market conditions
- Makes nuanced exit decisions (partial exits, trailing stops, re-entry timing)
- Explains reasoning in natural language (spec requires 500-char reasoning per decision)
- Handles persona-specific logic naturally (Contrarian fading sentiment, Momentum Rider pyramiding)

### What the Spec Requires (Key Decisions)

From the spec, these are the critical architectural constraints the agent must respect:

1. **Personas are strategy profiles** - 6 personas with distinct entry rules, sizing rules, exit rules, and monitoring intervals
2. **Session-scoped capital** - each activation has its own Investment_Amount with strict capital conservation (positions + pending + available ≤ investment)
3. **Analysis-driven, not self-triggering** - the PM consumes recurring analysis results via EventBridge, never triggers its own
4. **Position Guard monitors at persona intervals** - Scalper every 5 min, Sniper every 30 min, others every 15 min (EventBridge Scheduler)
5. **Risk Engine enforces hard limits** - 50% max loss per session, 40% max total loss, 50% max position size, 30-min cooldown after loss exit
6. **Kill Switch is atomic and total** - terminates ALL sessions, cancels ALL orders, overrides everything
7. **Concurrent session limits** - Pro: 3, Elite: 10
8. **Distributed locks** - DynamoDB conditional writes prevent Position Guard and Trade Executor from conflicting
9. **Order flexibility** - limit orders, market orders, simultaneous buy/sell, stop-loss + take-profit on book

### Target Architecture - Hybrid: Agent Brain + Deterministic Guardrails

The key insight: **not everything should be agentic**. The spec defines hard invariants (capital conservation, loss limits, kill switch) that must NEVER be violated - these stay deterministic. But the *reasoning* about when to enter, how to size, when to exit, and how to adapt - that's where the agent shines.

```
EventBridge (analysis-complete for market with active session)
  → Lambda (portfolio-dispatcher) [DETERMINISTIC]
    → Check kill switch (DynamoDB) - hard gate, no AI needed
    → Check session status (active only)
    → Check cooldown (30-min after loss exit)
    → Acquire distributed lock (DynamoDB)
    → IF all gates pass:
      → bedrock-agentcore:InvokeAgentRuntime (portfolio-manager)
        → Agent receives: analysis result, portfolio state, persona config, market data
        → Agent reasons about the opportunity
        → Agent decides: enter (with size + price), hold, exit, scale, or skip
        → Agent returns structured decision JSON
    → Lambda validates agent decision against hard limits [DETERMINISTIC]:
      → Position size ≤ 50% of available
      → Position size ≤ persona max allocation
      → Size ≥ $5 minimum
      → Capital conservation invariant holds
    → Lambda executes validated order on CLOB API
    → Lambda records decision + trade in RDS
    → Lambda publishes notification event
    → Release lock, stop AgentCore session

EventBridge Scheduler (per-session, persona interval)
  → Lambda (position-guard-dispatcher) [DETERMINISTIC]
    → Check kill switch
    → Acquire lock
    → IF positioned:
      → bedrock-agentcore:InvokeAgentRuntime (portfolio-manager)
        → Agent receives: current position, market data, latest analysis, persona exit rules
        → Agent reasons: hold, adjust stops, partial exit, full exit?
        → Agent returns structured exit decision JSON
    → Lambda validates exit decision
    → Lambda executes on CLOB API
    → Release lock, stop session
```

### Why Hybrid (Not Fully Agentic)

| Concern | Why deterministic | Why NOT let the agent handle it |
|---------|-------------------|-------------------------------|
| Kill switch | Must be atomic, instant, 100% reliable | Agent could hallucinate "it's fine to keep trading" |
| Capital conservation | Invariant must NEVER be violated | Agent might miscalculate available capital |
| Loss limits (50% session, 40% total) | Hard safety boundary | Agent might rationalize "this time is different" |
| Cooldown (30 min after loss) | Prevents revenge trading | Agent might convince itself the next trade is different |
| Position size cap (50%) | Prevents concentration risk | Agent might over-allocate on high conviction |
| Distributed locking | Infrastructure concern | Agent has no concept of concurrent Lambda invocations |
| Order execution + retry | Mechanical API interaction | Agent doesn't need to reason about HTTP retries |

| Concern | Why agentic | Why NOT deterministic |
|---------|-------------|---------------------|
| Entry decision | Persona logic is nuanced (Contrarian needs sentiment reasoning, Catalyst Hunter needs event timing) | If/else trees can't capture "is this sentiment divergence meaningful?" |
| Position sizing within bounds | Conviction is contextual - same edge in a liquid vs illiquid market should size differently | Fixed formula ignores market microstructure |
| Exit reasoning | "Is this a temporary dip or regime change?" requires judgment | Price-only triggers miss context |
| Persona behavior | Each persona has a *philosophy*, not just parameters | 6 personas × N market conditions = combinatorial explosion of rules |
| Reasoning generation | Spec requires 500-char reasoning per decision | Template strings are uninformative |

### Agent Definition (`app/PortfolioManager/main.py`)

```python
from strands import Agent, tool
from bedrock_agentcore.runtime import BedrockAgentCoreApp
import json

app = BedrockAgentCoreApp()

@app.entrypoint
def handle_trade_decision(payload, context):
    """Portfolio Manager Agent entrypoint.
    
    Receives pre-validated context from the dispatcher Lambda and returns
    a structured trading decision. The dispatcher handles all hard safety
    checks BEFORE invoking this agent.
    """
    persona = payload["persona"]
    
    # Build persona-specific system prompt
    system_prompt = build_persona_prompt(persona)
    
    agent = Agent(
        model="us.amazon.nova-2-lite-v1:0",
        tools=[
            get_market_data,
            get_order_book,
            read_full_analysis,
            get_trade_history,
            get_session_performance,
        ],
        system_prompt=system_prompt,
    )
    
    # Build the decision prompt with all context
    prompt = build_decision_prompt(payload)
    
    result = agent(prompt)
    
    # Parse agent's response into structured decision
    decision = parse_agent_decision(result.message)
    return decision

if __name__ == "__main__":
    app.run()
```

### Persona-Specific System Prompts

Each persona gets a tailored system prompt that captures its *philosophy*:

```python
PERSONA_PROMPTS = {
    "sniper": """You are The Sniper - a high-conviction, concentrated position trader.

## Your Philosophy
You wait patiently for rare, high-confidence opportunities. Most analysis cycles, you do nothing.
When you act, you act decisively with large positions (30-50% of available capital).

## Entry Criteria
- Edge must exceed 10% (you don't waste time on small edges)
- Signal alignment must exceed 0.8 (near-unanimous agent agreement)
- You may watch a market for multiple cycles before acting - patience is your edge

## Exit Philosophy
- Exit when conviction drops below 0.5 OR edge narrows below 5%
- You use limit orders for entry (waiting for optimal price)
- Patience window: 4 hours for limit fills

## Decision Output
Return a JSON decision with: action, direction, size_pct, price, order_type, reasoning
""",

    "scalper": """You are The Scalper - a rapid, small-edge exploitation specialist.

## Your Philosophy
You take many small positions on tight edges. Speed and frequency are your advantage.
You only trade liquid markets with tight spreads (≤ 2% bid-ask).

## Entry Criteria
- Edge as low as 3% is acceptable (you make money on volume)
- Signal alignment ≥ 0.5 (moderate agreement is sufficient)
- Spread must be ≤ 2% (you need tight execution)
- Position size: 5-15% of available capital per trade

## Exit Philosophy
- Exit when edge drops below 1% or alignment drops below 0.4
- You use market orders for immediate execution
- Patience window: 15 minutes (if not filled, cancel and move on)

## Decision Output
Return a JSON decision with: action, direction, size_pct, price, order_type, reasoning
""",

    "contrarian": """You are The Contrarian - you fade crowd consensus and buy fear.

## Your Philosophy
You enter when social sentiment diverges from fundamental probability by >20 percentage points.
Markets overreact to news. You profit from mean reversion.

## Entry Criteria
- Sentiment-fundamental divergence > 20 percentage points
- Example: sentiment implies 70% but analysis shows ≤ 50% → you buy NO
- Position size: 20-35% of available capital

## Exit Philosophy
- Exit when sentiment-fundamental divergence narrows to within 5 percentage points
- You use dynamic exits (no fixed take-profit) - the Position Guard manages this
- You scale out in 3 tranches as divergence narrows

## Decision Output
Return a JSON decision with: action, direction, size_pct, price, order_type, reasoning
""",

    "catalyst_hunter": """You are The Catalyst Hunter - an event-driven specialist.

## Your Philosophy
You identify upcoming catalysts (debates, rulings, data releases) and position BEFORE the event.
All your positions are time-boxed to the catalyst event window.

## Entry Criteria
- A clear upcoming catalyst must be identified
- Position before the event, exit immediately after resolution regardless of outcome
- Position size: 20-40% of available capital

## Exit Philosophy
- EXIT IMMEDIATELY after catalyst resolution - win or lose
- Patience window: 1 hour for limit fills
- You always define a take-profit target

## Decision Output
Return a JSON decision with: action, direction, size_pct, price, order_type, reasoning, catalyst_event, catalyst_date
""",

    "hedge_architect": """You are The Hedge Architect - a multi-position strategist.

## Your Philosophy
You build positions across related markets to reduce directional exposure.
You target consistent gains through spread trades and relative value.

## Entry Criteria
- Focus on market inefficiencies between correlated outcomes
- Maximum 20% of available capital per individual position
- You look for relative value, not directional bets

## Exit Philosophy
- You always define take-profit targets
- Conservative stop-losses to preserve capital
- Patience window: 2 hours

## Decision Output
Return a JSON decision with: action, direction, size_pct, price, order_type, reasoning
""",

    "momentum_rider": """You are The Momentum Rider - a trend-following specialist.

## Your Philosophy
You enter when price momentum confirms the analysis direction (3 consecutive moves same direction).
You add to winning positions (pyramiding) and ride trends until they reverse.

## Entry Criteria
- Price momentum must confirm analysis direction (3 consecutive same-direction moves)
- Initial entry: 15-25% of available capital
- Pyramiding: add to winners up to 60% total allocation in one market

## Exit Philosophy
- Exit when price reverses >10% from local peak
- Exit when 2 consecutive analysis cycles show weakening signal alignment
- You use dynamic exits (no fixed take-profit) - trailing stop managed by Position Guard
- The Position Guard adjusts your take-profit further out when you're winning

## Decision Output
Return a JSON decision with: action, direction, size_pct, price, order_type, reasoning, is_pyramid
""",
}
```

### Agent Tools (Read-Only - Agent Doesn't Execute Orders)

The agent's tools are **read-only**. It gathers information and returns a decision. The dispatcher Lambda executes the actual order. This prevents the agent from bypassing safety checks.

```python
@tool
def get_market_data(market_id: str) -> dict:
    """Get current market state: price, spread, volume, liquidity, 
    and recent price movements (last 24h)."""
    # Polymarket Gamma API call
    ...

@tool
def get_order_book(market_id: str) -> dict:
    """Get order book depth: best bid/ask, depth at various levels,
    and estimated slippage for common position sizes ($50, $100, $500)."""
    # Polymarket CLOB API call
    ...

@tool
def read_full_analysis(analysis_result_s3_key: str) -> dict:
    """Read the full analysis result including all agent signals,
    signal fusion output, thesis construction, cross-examination scores,
    consensus probability, and final recommendation."""
    # S3 fetch
    ...

@tool
def get_trade_history(session_id: str, limit: int = 10) -> list:
    """Get recent trade history for this session: entries, exits, P&L per trade,
    win/loss streak, and average hold duration. Use this to calibrate sizing."""
    # RDS query
    ...

@tool
def get_session_performance(session_id: str) -> dict:
    """Get session-level performance: total P&L, win rate, cumulative loss %,
    whether position size reduction is active, and capital breakdown."""
    # RDS query
    ...
```

### Agent Decision Schema (Structured Output)

The agent returns a structured JSON decision that the dispatcher validates:

```python
# Expected agent output format
{
    "action": "enter",           # enter | hold | exit | scale | skip
    "direction": "YES",          # YES | NO (for enter/scale)
    "size_pct": 0.25,           # % of available capital (0.0-1.0)
    "price": 0.42,              # target price for limit, or null for market
    "order_type": "limit",      # limit | market
    "reasoning": "Edge of 12% with 0.85 signal alignment on a liquid market...",
    "conviction": 0.78,         # agent's self-assessed conviction (0.0-1.0)
    "exit_reason": null,        # for exit actions: regime_shift | stale_market | contradicting_analysis | target_reached
    "is_pyramid": false,        # for Momentum Rider
}
```

### Position Guard - Agent for Exit Reasoning

The Position Guard also invokes the agent, but with a different prompt focused on exit evaluation:

```python
POSITION_GUARD_PROMPT = """You are monitoring an open position. Evaluate whether to HOLD or EXIT.

Current Position:
- Direction: {direction} @ entry price {entry_price}
- Current Price: {current_price}
- Unrealized P&L: {unrealized_pnl_pct}%
- Hold Duration: {hold_duration_minutes} minutes
- Patience Window Remaining: {patience_remaining_minutes} minutes

Market Conditions:
- 24h Volume: ${volume_24h}
- Current Spread: {spread}%
- Volume Trend: {volume_trend} (increasing/stable/declining)

Latest Analysis (if available):
- Recommendation: {latest_recommendation}
- Consensus Probability: {consensus_prob}
- Signal Alignment: {signal_alignment}

Persona Exit Rules:
- Stop-loss: {stop_loss_pct}% (already on book as limit sell)
- Take-profit: {take_profit_pct}% (already on book as limit sell)

Your job is NOT to duplicate the mechanical stop-loss/take-profit already on the book.
Your job is to detect:
1. Regime shifts (probability swing >15%, volume spike >3x, new catalyst)
2. Stale markets (declining volume 3 cycles, widening spread >5%)
3. Analysis contradicting your position
4. Opportunities to adjust stops (Momentum Rider: trail stop further out when winning)

Return a JSON decision: action (hold/exit/adjust_stops), reasoning, exit_type if exiting.
"""
```

### Files to Scrap (Portfolio)

| File | Replacement |
|------|-------------|
| `infra/services/portfolio-trade-executor/handler.ts` | Rewrite as thin dispatcher: safety checks → invoke AgentCore → validate decision → execute order |
| `infra/services/portfolio-position-guard/handler.ts` | Rewrite as thin dispatcher: safety checks → invoke AgentCore → validate exit decision → execute |
| `infra/services/shared/conviction-score.ts` | Agent reasons about conviction naturally; remove fixed formula |

### Files to Keep (Portfolio)

| File | Why |
|------|-----|
| `infra/services/portfolio-activation/handler.ts` | Session creation is validation + CRUD, not reasoning |
| `infra/services/portfolio-risk-engine/handler.ts` | **KEEP AS-IS** - hard safety limits must be deterministic, never AI |
| `infra/services/portfolio-lifecycle/handler.ts` | Session state machine (pause/resume/exit/resolve) is deterministic |
| `infra/services/portfolio-notification/handler.ts` | Notification delivery is infrastructure |
| `infra/services/portfolio-analysis-consumer/handler.ts` | Subscription lifecycle validation is deterministic |
| `infra/services/portfolio-dashboard-api/handler.ts` | Read-only API |
| `infra/services/portfolio-investment/handler.ts` | Capital deposit/withdrawal is CRUD |
| `infra/services/shared/portfolio-db.ts` | SQL queries stay the same |
| `infra/services/shared/portfolio-types.ts` | Type definitions stay the same |

### Key Difference from Previous Plan

The previous version of this doc had the agent calling `place_order` directly. That's **wrong** for a system managing real money. The corrected architecture:

1. **Agent is read-only** - it gathers data and returns a decision
2. **Dispatcher validates** - hard limits checked deterministically AFTER agent decides
3. **Dispatcher executes** - order placement, recording, notifications happen outside the agent
4. **Risk Engine stays deterministic** - kill switch, loss limits, cooldowns are never AI-controlled

This means the agent can never bypass safety guardrails, even if it hallucinates or reasons incorrectly about risk.

---

## CDK Changes Summary

### Remove

- `bedrock-stack.ts` → Rewrite with AgentCore IAM
- `agents/deploy-agents.ts` → Delete entirely
- `agents/agent-definitions.ts` → Replace with Python agent code
- `bedrock:InvokeAgent` permissions → Replace with `bedrock-agentcore:InvokeAgentRuntime`

### Add

- AgentCore execution role (trusts `bedrock-agentcore.amazonaws.com`)
- `bedrock-agentcore:InvokeAgentRuntime` permission on orchestrator Lambda
- `bedrock-agentcore:StopRuntimeSession` permission on orchestrator Lambda
- `AGENTCORE_RUNTIME_ARN` environment variable on orchestrator Lambda (analysis)
- `PORTFOLIO_AGENTCORE_RUNTIME_ARN` environment variable on portfolio dispatcher Lambda
- New `infra/agentcore/` directory with Python analysis orchestrator agent code
- New `infra/agentcore-portfolio/` directory with Python portfolio manager agent code

### Remove (Portfolio)

- `infra/services/portfolio-trade-executor/handler.ts` → Rewrite as dispatcher: safety gates → invoke AgentCore → validate → execute
- `infra/services/portfolio-position-guard/handler.ts` → Rewrite as dispatcher: safety gates → invoke AgentCore → validate → execute exit
- `infra/services/shared/conviction-score.ts` → Agent reasons about conviction naturally; fixed formula removed

### Keep (unchanged)

- `infra/agents/orchestrator.ts` - The `fuseSignals()` and `calculateConsensus()` functions are correct deterministic logic. Port them to Python for the AgentCore app, or keep them in the Lambda if the Lambda still does the deterministic stages.
- All other CDK stacks (network, database, auth, queue, notification, storage, monitoring, compute)
- The overall flow: SQS → Lambda → store result → EventBridge → delivery
- Portfolio CRUD services: `portfolio-activation`, `portfolio-lifecycle`, `portfolio-notification`, `portfolio-dashboard-api`, `portfolio-investment`, `portfolio-analysis-consumer`
- Portfolio Risk Engine (`portfolio-risk-engine`) - hard safety limits stay deterministic, never AI-controlled

---

## npm Script Changes

### Remove

```json
{
  "deploy-agents:dev": "ENVIRONMENT=development AGENT_ROLE_ARN=... npx tsx agents/deploy-agents.ts",
  "deploy-agents:prod": "ENVIRONMENT=production AGENT_ROLE_ARN=... npx tsx agents/deploy-agents.ts"
}
```

### Add

```json
{
  "agentcore:dev": "cd agentcore && agentcore dev",
  "agentcore:deploy": "cd agentcore && agentcore deploy",
  "agentcore:invoke": "cd agentcore && agentcore invoke",
  "agentcore:status": "cd agentcore && agentcore status",
  "agentcore:logs": "cd agentcore && agentcore logs",
  "agentcore:destroy": "cd agentcore && agentcore remove all && agentcore deploy"
}
```

---

## Cost Comparison

| Item | Legacy Bedrock Agents | AgentCore Runtime |
|------|----------------------|-------------------|
| Per-invocation | Bedrock model cost + per-step fee | Bedrock model cost + microVM compute time |
| Session idle | N/A (stateless) | Billed until idle timeout (default 15 min) - use `StopRuntimeSession` |
| Browser | Not available (need Serper/NewsData APIs) | Built-in, no API key costs |
| Memory | Custom RDS queries | AgentCore Memory (managed, semantic search) |
| Baseline infra | ~$0/mo (pay per invoke) | ~$0/mo (pay per session-second) |

**Key cost optimization:** Always call `StopRuntimeSession` after each analysis completes. Don't let sessions idle for 15 minutes.

---

## Timeline Estimate

| Phase | Effort | Description |
|-------|--------|-------------|
| Phase 1 | 1 day | Scrap legacy infra, rewrite IAM, update Lambda to call AgentCore |
| Phase 2 | 2-3 days | Build Python orchestrator + all agent code using Strands SDK |
| Phase 3 | 0.5 day | Deploy to AgentCore, wire ARN into CDK |
| Phase 4 | 1-2 days | Integrate Memory + Browser primitives |
| Phase 5 | 2-3 days | Build Portfolio Manager Agent (tools, system prompt, testing) |
| **Total** | **7-10 days** | Full migration: analysis pipeline + portfolio manager on AgentCore |

---

## Steering File Updates

After migration, update `.kiro/steering/tech.md`:

- Remove references to `@aws-sdk/client-bedrock-agent`
- Change "Bedrock AgentCore" section to reflect actual AgentCore usage
- Add `agentcore` CLI commands to Common Commands
- Update "Adding New Agents" to reference Python agent files in `infra/agentcore/src/agents/`
- Change IAM trust principal documentation from `bedrock.amazonaws.com` to `bedrock-agentcore.amazonaws.com`
