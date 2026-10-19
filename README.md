# TradeWizard

> AI-powered prediction trading platform providing intelligent analysis and trading recommendations for real-world outcomes on Polymarket.

TradeWizard transforms prediction markets from speculative guessing into guided, intelligence-driven trading. A multi-agent AI system analyzes markets from multiple perspectives to produce explainable trade recommendations with clear reasoning, catalysts, and risk scenarios.

## Components

| Component | Purpose | Tech Stack |
|-----------|---------|-----------|
| [infra/](infra/README.md) | V2 AWS-native platform (CDK, Lambda, Strands SDK) | TypeScript, AWS CDK, Lambda, RDS, DynamoDB |
| [tradewizard-frontend/](tradewizard-frontend/README.md) | Web UI with Cognito auth, real-time delivery, subscription management | Next.js 16, React 19, Tailwind CSS 4 |

## Architecture (V2)

```
User → Next.js Frontend (Cognito Auth)
         ↓ REST API (API Gateway)
   Analysis Request Lambda
         ↓ Credit check → Dedup → SQS
   Analysis Orchestrator Lambda
         ↓ Lambda invoke (Strands SDK)
   14 Specialized AI Agents (Bedrock default; Nebius Token Factory optional)
         ↓
   Results → S3 + RDS
         ↓ SNS Fan-out
   ┌─────────────────────────────────────┐
   │ WebSocket Push │ Email (Resend) │ Push │ Webhook │
   └─────────────────────────────────────┘
         ↓
   Real-time delivery to frontend
```

### Analysis Pipeline (11 Stages)

1. **Data Preparation** - Fetch live data from Polymarket CLOB + Gamma APIs
2. **Memory Retrieval** - Load historical agent signals from RDS
3. **Web Research** - Autonomous research via NewsData.io and Serper tools
4. **Agent Selection** - All 14 agents activated for every market (no conditional filtering)
5. **Parallel Intelligence Agents** - 14 agents execute in parallel via Promise.all
6. **Signal Fusion** (deterministic) - Weighted aggregation with conflict detection
7. **Thesis Construction** - Competing bull and bear theses
8. **Cross-Examination** - 5 adversarial tests on both theses
9. **Consensus Engine** (deterministic) - Weighted probability, fails if disagreement > 30%
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
- Plan comparison (Free, Starter 19 USDC.e, Pro 49 USDC.e, Elite 149 USDC.e)
- On-chain USDC.e payments from Trading Wallet (Safe) on Polygon
- Auto-renewal via ERC-20 allowance (approve/revoke from UI)
- Manual renewal flow for users without allowance set
- Credit pack purchases (20 for 9 USDC.e, 50 for 19 USDC.e)
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
| AWS Account | infra (CDK deployment) |
| Platform Wallet (Polygon) | USDC.e payment receiving + renewal transferFrom |
| Amazon Cognito User Pool | Authentication |

## Getting Started

### Option A: Full V2 Platform (AWS)

```bash
# 1. Deploy infrastructure (handles secrets, CDK, DB, Resend/SES email)
cd infra
npm install
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

## Environment Variables Reference

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
NEXT_PUBLIC_USDC_CONTRACT_ADDRESS=0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174

# Polymarket
NEXT_PUBLIC_POLYMARKET_API_URL=https://clob.polymarket.com
```

### infra (.env)

```bash
# AWS
AWS_REGION=us-east-1
CDK_DEFAULT_ACCOUNT=your_account_id
ENVIRONMENT=dev

# Wallet (stored in Secrets Manager via deploy.sh)
PLATFORM_WALLET_ADDRESS=0x...
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

| Plan | Price (USDC.e/mo) | Credits/Month | Intervals | Channels |
|------|-------------------|---------------|-----------|----------|
| Free | 0 | 20 | One-time only | In-app |
| Starter | 19 | 100 | One-time, 1 day | In-app, email, push |
| Pro | 49 | 350 | All (1h, 4h, 12h, 1d) | All channels |
| Elite | 149 | Unlimited | All intervals | All channels |

Credit packs: 20 credits for $4.99, 45 credits for $9.99, 75 credits for $14.99.

### Payment Model

Payments are made via on-chain USDC.e transfers on Polygon:
- **Frontend** initiates transfers from the user's Trading Wallet (Safe) via `relayClient.execute()`
- **Backend** verifies completed on-chain transactions (never initiates transfers from user wallets)
- **Auto-renewal** uses ERC-20 `transferFrom` with pre-approved allowance
- **Grace period** (3 days) if renewal fails, with retry every 24h and user notifications

## Project Structure

```
tradewizard/
├── infra/                  # V2 AWS CDK infrastructure + Lambda services
│   ├── lib/               # CDK stacks (network, database, auth, queue, compute, etc.)
│   ├── services/          # Lambda handlers (analysis, delivery, subscriptions, portfolio, etc.)
│   └── sql/               # PostgreSQL schema
├── tradewizard-frontend/   # Next.js web application
│   ├── app/               # App Router pages (login, markets, insights, portfolio, account)
│   ├── components/        # React components (ui, shell, markets, portfolio, subscription)
│   ├── hooks/             # Custom hooks (useAuth, useWebSocket, usePortfolio*, etc.)
│   ├── lib/               # Utilities (cognito-auth, api-client, websocket-client)
│   └── providers/         # Context providers (Auth, Wallet, Query, WebSocket, Trading)
├── docs/                   # Product and technical documentation
└── .kiro/                  # AI assistant configuration
```

## Documentation

- [infra/README.md](infra/README.md) - AWS infrastructure and deployment guide
- [tradewizard-frontend/README.md](tradewizard-frontend/README.md) - Frontend development guide
- [docs/](docs/) - Product overview, architecture specs, debate protocol

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

This project is proprietary software. All rights reserved.

---

**Disclaimer**: TradeWizard provides AI-generated analysis for educational and informational purposes. All trading involves risk. Past performance does not guarantee future results. Please trade responsibly.
