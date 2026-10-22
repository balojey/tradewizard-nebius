# TradeWizard

> Multi-agent intelligence for prediction markets. Fourteen specialists on Nebius Token Factory, three deterministic gates, and a bounded-autonomy Portfolio Manager.

TradeWizard turns prediction markets from speculative guessing into intelligence-driven trading. A multi-agent system analyzes Polymarket markets from independent perspectives, fuses their signals through deterministic stages, and produces explainable trade recommendations with clear reasoning, catalysts, and risk scenarios.

The inference layer runs on **Nebius Token Factory**, with NVIDIA Nemotron 3 Super handling the tool-heavy news and research agents. The orchestration, persistence, and execution layers run on a serverless AWS deployment substrate. The AI provider is a configuration boundary, not a rewrite: `AI_PROVIDER=nebius` routes every analysis and portfolio model call through Token Factory's OpenAI-compatible API.

## Why Nebius

The system does not need one giant model. It needs the right model for each job, a stable contract between the agent layer and the provider, and no single rate limit deciding whether a fourteen-agent run completes.

Nebius Token Factory gives us that as an OpenAI-compatible endpoint, so the same Strands agent code runs against open models from NVIDIA, Qwen, OpenAI, DeepSeek, Moonshot, and MiniMax. Agents are assigned to **capability buckets** - not hard-coded model names - and the environment resolves each bucket to a concrete model ID:

| Capability | Model | Used by |
|------------|-------|---------|
| `agentic` | `nvidia/nemotron-3-super-120b-a12b` | breaking news, event impact, historical patterns, web research |
| `fast` | `Qwen/Qwen3-30B-A3B-Instruct-2507` | market microstructure, probability baseline, momentum |
| `analytical` | `Qwen/Qwen3-235B-A22B-Instruct-2507` | risk assessment, polling intelligence, mean reversion |
| `reasoning` | `openai/gpt-oss-120b` | media sentiment, social sentiment, narrative velocity |
| `deep_reasoning` | `deepseek-ai/DeepSeek-V4-Pro` | catalyst identification, tail risk |
| `non_tool` | `moonshotai/Kimi-K3` | thesis, cross-examination, risk philosophy, recommendation |
| `default` | `MiniMaxAI/MiniMax-M3` | Portfolio Manager persona decisions |

Tool-using agents are never allowed to resolve to the `non_tool` bucket. That invariant is checked at registry construction, so a bad environment configuration fails before an analysis starts rather than silently degrading a tool call.

See [docs/nebius-token-factory.md](docs/nebius-token-factory.md) for the integration details, model validation, and failure modes.

## Components

| Component | Purpose | Tech Stack |
|-----------|---------|-----------|
| AI inference | Analysis and portfolio reasoning on Nebius Token Factory | NVIDIA Nemotron 3 Super + open models, Strands SDK, OpenAI-compatible API |
| [infra/](infra/README.md) | Serverless deployment substrate: CDK, Lambda, Aurora, DynamoDB | TypeScript, AWS CDK, Lambda, RDS, DynamoDB |
| [tradewizard-frontend/](tradewizard-frontend/README.md) | Web UI with Cognito auth, real-time delivery, subscription management | Next.js 16, React 19, Tailwind CSS 4 |
| [remotion/](remotion/) | Product demo video compositions | Remotion, React |

## Architecture

```
User → Next.js Frontend (Cognito Auth)
         ↓ REST API (API Gateway)
   Analysis Request Lambda
         ↓ Credit check → Dedup → SQS
   Analysis Orchestrator Lambda
         ↓ Lambda invoke (Strands SDK)
   Nebius Token Factory
   ┌──────────────────────────────────────────────────────────┐
   │ Web Research (Nemotron 3 Super)                          │
   │ 14 Intelligence Agents (capability-routed, parallel)     │
   │ Thesis · Cross-Exam · Risk Philosophy · Recommendation   │
   └──────────────────────────────────────────────────────────┘
         ↓ typed signals, deterministic gates
   Signal Fusion → Consensus → EV Check → Recommendation
         ↓
   Results → S3 + Aurora PostgreSQL
         ↓ SNS Fan-out
   ┌─────────────────────────────────────┐
   │ WebSocket Push │ Email (Resend) │ Push │ Webhook │
   └─────────────────────────────────────┘
         ↓
   Real-time delivery to frontend
```

The division of responsibility is deliberate. Nebius runs inference. The deterministic stages - signal fusion, consensus, expected-value rejection, schema validation - run in application code. The Portfolio Manager's executor, risk engine, and kill switch never depend on a model deciding to behave.

### Analysis Pipeline (11 Stages)

1. **Data Preparation** - Fetch live data from Polymarket CLOB + Gamma APIs
2. **Memory Retrieval** - Load historical agent signals from Aurora PostgreSQL
3. **Web Research** - Autonomous research via NewsData.io and Serper tools on Nemotron 3 Super
4. **Agent Selection** - All 14 agents activated for every market (no conditional filtering)
5. **Parallel Intelligence Agents** - 14 agents execute in parallel through Nebius Token Factory
6. **Signal Fusion** (deterministic) - Market-anchored log-odds aggregation with conservative shrinkage, Brier-calibrated agent weights, and conflict detection
7. **Thesis Construction** - Competing bull and bear theses
8. **Cross-Examination** - 5 adversarial tests on both theses
9. **Consensus Engine** (deterministic) - Uses the anchored fused probability; fails on disagreement > 30% or confidence < 20%
10. **Risk Philosophy Agents** - Aggressive, conservative, neutral position sizing
11. **Recommendation Generation** - LONG_YES, LONG_NO, or NO_TRADE with entry/exit zones

## Frontend Features (Phase 3)

### Authentication
- Amazon Cognito with Magic Link custom auth flow (passwordless)
- JWT token management with auto-refresh
- Secure localStorage token storage with `tw_` prefix

### Real-Time Delivery
- WebSocket connection with exponential backoff reconnection (1s → 30s max)
- Ping keepalive every 5 minutes
- TanStack Query cache integration (new results prepend without refresh)

### Analysis Request
- One-time or recurring analysis with plan-aware interval selection
- Credit balance display with optimistic decrement
- Handles cached (instant) and queued (async) responses

### Results Viewer
- Paginated history with infinite scroll
- Full detail view: agent signals, bull/bear thesis, cross-examination, position sizing
- Visual distinction between cached and fresh analyses
- Real-time prepend from WebSocket

### Subscription Management
- Plan comparison (Free, Starter $19, Pro $49, Elite $149 in pUSD)
- On-chain pUSD (Polymarket USD) payments from Trading Wallet (Safe) on Polygon, with legacy USDC.e read compatibility
- Auto-renewal via ERC-20 allowance (approve/revoke from UI)
- Manual renewal flow for users without allowance set
- Credit pack purchases in pUSD
- Subscription cancellation with period-end handling
- Payment history with on-chain transaction links
- Credit balance in header with optimistic updates

### Notification Settings
- Channel toggles (in-app, email, push, webhook) with plan-based restrictions
- Quiet hours configuration (HH:MM time pickers)
- Probability shift threshold (0.01–1.00)
- Webhook URL validation (HTTPS required)

## Prerequisites

| Requirement | Used by |
|-------------|---------|
| Node.js 18+ | All components |
| Nebius Token Factory API key | AI inference |
| AWS account | Serverless deployment substrate |
| Platform Wallet (Polygon) | pUSD payment receiving + renewal transferFrom; legacy USDC.e read compatibility |
| Amazon Cognito User Pool | Authentication |

## Getting Started

### Option A: Full Platform

```bash
# 1. Configure inference + deploy the substrate
cd infra
npm install
cp .env.example .env.dev
# Set AI_PROVIDER=nebius and NEBIUS_API_KEY in .env.dev
./deploy.sh up dev

# 2. Start the frontend
cd ../tradewizard-frontend
npm install
cp .env.example .env.local
npm run dev  # http://localhost:3000
```

### Option B: Frontend only (development)

```bash
cd tradewizard-frontend
npm install
cp .env.example .env.local
# Configure environment variables (see below)
npm run dev  # http://localhost:3000
```

## Environment Variables

### Nebius Token Factory

```bash
# Select the inference provider. "nebius" is the submitted configuration.
AI_PROVIDER=nebius

# Stored in Secrets Manager as tw-{env}-nebius-api-key by deploy.sh.
NEBIUS_API_KEY=
NEBIUS_BASE_URL=https://api.tokenfactory.nebius.com/v1/
NEBIUS_MAX_TOKENS=30000

# Capability → model ID. All IDs are env-driven and validated against
# the live catalog before deployment.
NEBIUS_MODEL_FAST=Qwen/Qwen3-30B-A3B-Instruct-2507
NEBIUS_MODEL_ANALYTICAL=Qwen/Qwen3-235B-A22B-Instruct-2507
NEBIUS_MODEL_AGENTIC=nvidia/nemotron-3-super-120b-a12b
NEBIUS_MODEL_REASONING=openai/gpt-oss-120b
NEBIUS_MODEL_DEEP_REASONING=deepseek-ai/DeepSeek-V4-Pro
NEBIUS_MODEL_NON_TOOL=moonshotai/Kimi-K3
NEBIUS_MODEL_DEFAULT=MiniMaxAI/MiniMax-M3
```

Validate the catalog and tool calling before deploying:

```bash
cd infra
set -a; source .env.dev; set +a
npx tsx scripts/validate-nebius.ts
```

### tradewizard-frontend (.env.local)

```bash
# Cognito Auth
NEXT_PUBLIC_COGNITO_USER_POOL_ID=us-east-1_xxxxx
NEXT_PUBLIC_COGNITO_CLIENT_ID=your_client_id
NEXT_PUBLIC_AWS_REGION=us-east-1

# API Gateway
NEXT_PUBLIC_API_BASE_URL=https://your-api-id.execute-api.us-east-1.amazonaws.com/dev

# WebSocket
NEXT_PUBLIC_WS_URL=wss://your-ws-id.execute-api.us-east-1.amazonaws.com/dev

# Wallet Payments
NEXT_PUBLIC_PLATFORM_WALLET_ADDRESS=0x...
# Legacy USDC.e address; pUSD is canonical collateral in code.
NEXT_PUBLIC_USDC_CONTRACT_ADDRESS=0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174

# Polymarket
NEXT_PUBLIC_POLYMARKET_API_URL=https://clob.polymarket.com
```

### infra (.env)

```bash
# Deployment substrate
AWS_REGION=us-east-1
CDK_DEFAULT_ACCOUNT=your_account_id
ENVIRONMENT=dev

# Wallet (stored in Secrets Manager via deploy.sh)
PLATFORM_WALLET_ADDRESS=0x...
# Legacy USDC.e address retained for read compatibility; pUSD is canonical.
USDC_CONTRACT_ADDRESS=0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174
POLYGON_RPC_URL=https://polygon-rpc.com
SAFE_FACTORY_ADDRESS=0x...
```

## Common Commands

### infra (CDK)

```bash
./deploy.sh up dev                  # Full deploy (secrets + CDK + DB + Resend/SES)
./deploy.sh up dev --skip-db        # Skip DB migration
./deploy.sh status dev              # Check deployment status
./deploy.sh down dev                # Tear down
npx cdk diff --context env=development  # Show pending changes
```

### tradewizard-frontend

```bash
npm run dev     # Start dev server (localhost:3000)
npm run build   # Build for production
npm run lint    # Lint check
```

## Subscription Plans

| Plan | Price (pUSD/mo) | Credits/Month | Intervals | Channels |
|------|-------------------|---------------|-----------|----------|
| Free | 0 | 20 | One-time only | In-app |
| Starter | 19 | 100 | One-time, 1 day | In-app, email, push |
| Pro | 49 | 350 | All (1h, 4h, 12h, 1d) | All channels |
| Elite | 149 | Unlimited | All intervals | All channels |

Credit packs: 20 credits for $4.99, 45 credits for $9.99, 75 credits for $14.99.

### Payment Model

Payments are made on-chain in pUSD (Polymarket USD) on Polygon, with legacy USDC.e read compatibility:
- **Frontend** prefers a pUSD transfer from the user's Trading Wallet (Safe) and falls back to the legacy USDC.e path during the migration window
- **Backend** verifies completed on-chain transactions (never initiates transfers from user wallets) and accepts both pUSD and legacy USDC.e
- **Auto-renewal** uses ERC-20 `transferFrom` with a pre-approved allowance
- **Grace period** (3 days) if renewal fails, with retry every 24h and user notifications

## Project Structure

```
tradewizard/
├── infra/                  # Serverless substrate + Lambda services
│   ├── lib/               # CDK stacks (network, database, auth, queue, compute, etc.)
│   ├── services/          # Lambda handlers (analysis, delivery, subscriptions, portfolio, etc.)
│   └── sql/               # PostgreSQL schema
├── tradewizard-frontend/   # Next.js web application
│   ├── app/               # App Router pages (login, markets, insights, portfolio, account)
│   ├── components/        # React components (ui, shell, markets, portfolio, subscription)
│   ├── hooks/             # Custom hooks (useAuth, useWebSocket, usePortfolio*, etc.)
│   ├── lib/               # Utilities (cognito-auth, api-client, websocket-client)
│   └── providers/         # Context providers (Auth, Wallet, Query, WebSocket, Trading)
├── remotion/               # Product demo video compositions
├── docs/                   # Product and technical documentation
└── .kiro/                  # AI assistant configuration
```

## Documentation

- [docs/nebius-token-factory.md](docs/nebius-token-factory.md) - Nebius inference architecture, routing, validation, and failure modes
- [infra/README.md](infra/README.md) - Deployment substrate and operations guide
- [tradewizard-frontend/README.md](tradewizard-frontend/README.md) - Frontend development guide
- [docs/tradewizard-overview.md](docs/tradewizard-overview.md) - Product and system overview
- [docs/devpost-submission.md](docs/devpost-submission.md) - Full submission write-up

## Contributing

1. Fork the repository
2. Create a feature branch: `git checkout -b feature/my-feature`
3. Commit your changes: `git commit -m 'Add my feature'`
4. Push and open a Pull Request

Code quality requirements:
- TypeScript strict mode
- ESLint + Prettier
- All infrastructure changes via CDK (never manual console changes)
- Graceful error handling at every layer

## License

MIT. See [LICENSE](LICENSE).

---

**Disclaimer**: TradeWizard provides AI-generated analysis for educational and informational purposes. All trading involves risk. Past performance does not guarantee future results. Please trade responsibly.
