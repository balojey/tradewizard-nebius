
# Technology Stack

## Infrastructure (infra/)

### Infrastructure as Code
- **AWS CDK** (TypeScript) for all infrastructure provisioning
- Stacks: network, database, auth, queue, notification, storage, monitoring, compute
- API Gateway (REST + WebSocket) is defined within the compute stack (no separate api-stack)
- Hosting handled via AWS Amplify Hosting (configured in `amplify.yml` at repo root)

### AWS Services

| Concern | Service | Purpose |
|---------|---------|---------|
| Authentication | Amazon Cognito | User sign-up/sign-in (Custom Auth / Magic Link), JWT tokens |
| API Layer | Amazon API Gateway | REST + WebSocket for real-time delivery |
| Compute | AWS Lambda (Node.js 20) | All request handling, orchestration, delivery |
| Database | Amazon Aurora PostgreSQL Serverless v2 | Users, subscriptions, credits, results, agent memory |
| Cache/Dedup | Amazon DynamoDB | Deduplication cache (TTL), WebSocket connections, rate limiting |
| Queue | Amazon SQS (FIFO) | Analysis request queue with DLQ |
| Scheduling | Amazon EventBridge Scheduler | Recurring analysis triggers |
| Event Bus | Amazon EventBridge | Event routing between services |
| AI Execution | AWS Lambda + Strands SDK (TypeScript) | Self-hosted multi-agent analysis workflow + portfolio manager |
| Model Provider | Amazon Bedrock (default) / Nebius Token Factory (optional) | `AI_PROVIDER=bedrock` or `nebius`; Nebius uses the OpenAI-compatible Token Factory API via Strands `OpenAIModel`. Inference only — trade execution stays in the portfolio executor. |
| Email | Resend (SES retained) | Transactional emails, analysis delivery |
| Push/SMS | Amazon SNS | Push notifications, subscriber fan-out |
| Object Storage | Amazon S3 | Analysis payloads, agent traces, artifacts |
| Monitoring | Amazon CloudWatch | Metrics, logs, alarms, dashboards |
| Secrets | AWS Secrets Manager | API keys, credentials (DB, Platform Wallet, Magic SDK, CLOB API, Resend API, Nebius API) |
| Payments | On-chain USDC.e (Polygon) | Wallet-based subscription billing, credit purchases |
| Frontend Hosting | AWS Amplify Hosting | Git-based CI/CD, SSR, CDN with custom domain |

### AI & Agent Framework
- **Strands Agents SDK** (TypeScript, `@strands-agents/sdk`): Multi-agent workflow orchestration in self-hosted Lambda functions
  - Two Lambda functions: Analysis_Lambda (11-stage workflow) and Portfolio_Lambda (persona-based trade decisions)
  - TypeScript throughout - no Python runtime dependency
  - Agent-as-code with tools, system prompts, and model selection
  - Multi-agent coordination (parallel via `Promise.all`)
  - Custom tools: News (NewsData.io), Search (Serper), Shell (bash/python on /tmp)
  - Direct Lambda invocation from dispatcher via `@aws-sdk/client-lambda`
- **Amazon Bedrock** (model provider): LLM inference via Strands SDK BedrockModel integration
- **Multi-model routing** via `infra/services/analysis-lambda/lib/multi-model.ts`: Distributes agents across models by capability and RPM budget
  - All model IDs and region are env-driven (set in `.env.dev` / `.env.prod`, injected via CDK)
  - **Intelligence agents (tool-capable, parallel):**
    - Nova Micro (`us.amazon.nova-micro-v1:0`, 200 RPM): market_microstructure, probability_baseline, momentum
    - Nova Lite (`us.amazon.nova-lite-v1:0`, 200 RPM): risk_assessment, polling_intelligence, mean_reversion
    - Nemotron 3 Super (`nvidia.nemotron-super-3-120b`, 100 RPM): breaking_news, event_impact, historical_patterns
    - GPT-OSS 120B (`openai.gpt-oss-120b-1:0`, 100 RPM): media_sentiment, social_sentiment, narrative_velocity
    - Kimi K2 Thinking (`moonshot.kimi-k2-thinking`, 100 RPM): catalyst_identification, tail_risk
  - **Non-tool stages (no tool-calling needed, high RPM):**
    - Llama 3.3 70B (`us.meta.llama3-3-70b-instruct-v1:0`, 8000 RPM): thesis, cross-exam, risk philosophy (×3), recommendation
  - **Web research (needs tools, runs alone before agents):**
    - Nemotron 3 Super (same instance as above)
  - Total tool-capable RPM budget: ~720 (well above 14 parallel agents)
  - All 14 intelligence agents run on every analysis (no conditional selection)
  - ~20-25 LLM calls per analysis (14 agents + thesis + cross-exam + 3 risk + recommendation)

### Cost-Optimized Architecture
- No NAT Gateway (public Aurora endpoint with SSL enforcement)
- No ElastiCache (DynamoDB with TTL for dedup cache)
- Aurora Serverless v2 (scales to 0.5 ACU when idle, auto-scales under load)
- ~$15-20/mo baseline infrastructure cost
- Scale-up path: Add NAT, Multi-AZ, ElastiCache when revenue justifies

## Backend (infra/services/) - V2 Lambda Services

### Runtime & Language
- Node.js 20 (Lambda runtime)
- TypeScript 5.8+ with strict mode (required)
- ESM modules (type: "module")
- Zod 4.x for schema validation

### AI & Agent Framework
- **Strands Agents SDK** (TypeScript, `@strands-agents/sdk`): Multi-agent workflow orchestration in self-hosted Lambda functions
- **Amazon Bedrock** (model provider): LLM inference via Strands SDK BedrockModel integration
- **Multi-model routing** (active, `multi-model.ts`): Agents distributed across 7 models by capability and RPM budget
  - Tool-capable agents: Nova Micro, Nova Lite, Nemotron 3 Super, GPT-OSS 120B, Kimi K2 Thinking
  - Non-tool stages: Llama 3.3 70B (8000 RPM, thesis/cross-exam/risk/recommendation)
  - Web research: Nemotron 3 Super (needs tools, runs alone)
  - Nova 2 Lite available as fallback (20 RPM, tool-capable)
  - **Provider switch**: `AI_PROVIDER=bedrock` (default) or `nebius`. Logical agent assignments are unchanged and resolve through `services/shared/ai-provider.ts`; Nebius maps capabilities to `NEBIUS_MODEL_*`. Tool-using agents must never map to the `non_tool` capability. Validate model IDs and tool calling with `scripts/validate-nebius.ts`.

### Database & Storage
- Amazon Aurora PostgreSQL Serverless v2 for all persistence
- DynamoDB for cache/dedup, WebSocket connections, rate limiting
- Agent memory stored in database for closed-loop learning

### External APIs
- Polymarket CLOB API (@polymarket/clob-client via `viem`)
- Polymarket Gamma API for market data
- NewsData.io for news intelligence (Strands tool in Analysis_Lambda)
- Serper for web search and scraping (Strands tool in Analysis_Lambda)
- **Note**: Wrap all external integrations as tools with error handling and audit logging

### External APIs
- Polymarket CLOB API (@polymarket/clob-client via `viem`)
- Polymarket Gamma API for market data
- NewsData.io for news intelligence (Strands tool in Analysis_Lambda)
- Serper for web search and scraping (Strands tool in Analysis_Lambda)
- **Note**: Wrap all external integrations as tools with error handling and audit logging

### Testing
- Vitest 3.x for unit and integration tests
- fast-check for property-based testing
- **Critical**: 30s timeout for LLM-dependent tests
- Property-based tests validate correctness properties of critical paths

### Build & Development
- esbuild for Lambda bundling (via CDK NodejsFunction)
- tsx for local development
- ESLint + Prettier for code quality
- Audit logging for all agent decisions and API calls

## Frontend (tradewizard-frontend)

### Framework
- Next.js 16 with App Router
- React 19
- TypeScript 5 (strict mode)

### Styling
- Tailwind CSS 4
- Framer Motion for animations
- Lucide React for icons

### State Management
- TanStack React Query (@tanstack/react-query) for server state
- React hooks for local state

### Authentication
- Amazon Cognito (Custom Auth / Magic Link flow)
- @aws-sdk/client-cognito-identity-provider for direct Cognito API calls
- JWT tokens stored in localStorage with `tw_` prefix
- Auto-refresh 5 minutes before expiry
- Redirects to `/login` on refresh failure

### Data Fetching
- API Gateway REST endpoints with typed API client (`lib/api-client.ts`)
- WebSocket for real-time analysis delivery (`lib/websocket-client.ts`)
- Polymarket CLOB client for market data
- Retry logic: 3 retries with exponential backoff (1s, 2s, 4s) for 5xx errors
- Typed errors: `InsufficientCreditsError` (402), `PlanRestrictionError` (403), `NotFoundError` (404)

### Real-Time
- WebSocket client with exponential backoff reconnection (1s → 2s → 4s → 8s → max 30s)
- Ping keepalive every 5 minutes to prevent idle timeout
- Connects on authentication, disconnects on logout
- Invalidates TanStack Query cache on new messages

### Payments (On-Chain Wallet)
- On-chain USDC.e transfers on Polygon for plan activation and credit purchases
- Transaction hash verification via `viem` (confirms sender, recipient, amount on-chain)
- Auto-renewal via ERC-20 `transferFrom` with pre-approved allowance
- Safe wallet derivation for deterministic user wallet addresses

### UI Components
- Recharts for data visualization
- react-intersection-observer for infinite scroll / lazy loading
- @tanstack/react-virtual for virtualized lists

### Provider Architecture
Provider composition order in `providers/index.tsx`:
```
AuthProvider → WalletProvider → QueryProvider → WebSocketProvider → TradingProvider
```
Auth must be outermost (other providers need auth state). WebSocket must be inside Query (it invalidates query cache).

### Web3 / Trading
- ethers v5 for Ethereum interactions
- viem for wallet operations
- Magic SDK for wallet authentication
- @polymarket/clob-client for order placement
- @polymarket/builder-signing-sdk for transaction signing
- @polymarket/builder-relayer-client for relay operations

## Code Style & Conventions

### TypeScript/JavaScript (all packages)
- kebab-case for files: `market-ingestion.ts`
- PascalCase for classes/components: `MarketBriefingDocument`, `AnalysisDetail.tsx`
- camelCase for functions/variables: `analyzeMarket`
- Strict mode required for all TypeScript files

## Common Commands

### Infrastructure (infra/)

```bash
# Deploy script (recommended - handles CDK + DB + Wallet/API/Resend/Nebius Secrets + SES)
./deploy.sh up dev                  # Full deploy to development
./deploy.sh up prod                 # Full deploy to production
./deploy.sh up dev --skip-db        # CDK stacks only (fastest)
./deploy.sh down dev                # Tear down development
./deploy.sh status dev              # Check deployment status

# npm script shortcuts
npm run deploy:dev               # Full deploy to dev
npm run deploy:prod              # Full deploy to prod
npm run deploy:dev:fast          # CDK-only (skips DB)
npm run deploy:prod:fast         # CDK-only for prod (skips DB)
npm run destroy:dev              # Destroy dev environment
npm run destroy:prod             # Destroy prod environment
npm run status:dev               # Check dev status
npm run status:prod              # Check prod status

# CDK utilities
npm run synth:dev        # Synthesize for development
npm run synth:prod       # Synthesize for production
npm run diff:dev         # Show dev changes
npm run diff:prod        # Show prod changes

# Testing
npm test                 # Run all tests (Vitest)
npm run test:watch       # Watch mode

# Data management
npm run wipe:dev         # Wipe dev data (dangerous)
npm run wipe:prod        # Wipe prod data (dangerous)
```

### Frontend (tradewizard-frontend)

```bash
# Development
npm run dev              # Start dev server (localhost:3000)
npm run build            # Build for production
npm start                # Run production build

# Code Quality
npm run lint             # Check linting
```

## Configuration Files

- `.env` / `.env.example` / `.env.local` - Environment variables (required for all services)
- `package.json` - Node.js dependencies and scripts
- `tsconfig.json` - TypeScript configuration (strict mode)
- `vitest.config.ts` - Vitest test configuration
- `infra/cdk.json` - CDK configuration
- `infra/lib/config.ts` - Environment-specific configuration (dev/prod)
- `infra/deploy.sh` - Deployment script (up/down/status with environment selection)

## Critical Implementation Patterns

### Adding New Agents (V2 - Self-Hosted Lambda + Strands SDK)
- Add agent system prompt to `infra/services/analysis-lambda/stages/intelligence-agents.ts` in the `AGENT_SYSTEM_PROMPTS` record
- Add agent name to `ALL_AGENT_NAMES` array
- Add to appropriate tool category arrays (`PRICE_AWARE_AGENTS`, `NEWS_AGENTS`, `BROWSER_AGENTS`)
- All 14 intelligence agents run on every market - no conditional selection
- Deploy via CDK: `npm run deploy:dev` from `infra/` directory (agents are bundled into the Lambda)
- The TypeScript dispatcher Lambda (`infra/services/analysis-orchestrator/handler.ts`) invokes Analysis_Lambda - no changes needed there for new agents

### Adding New Lambda Services
- Create handler in `infra/services/service-name/handler.ts`
- Add Lambda function to `infra/lib/compute-stack.ts`
- Wire IAM permissions, environment variables, and triggers
- Shared utilities go in `infra/services/shared/`

### Modifying the Analysis Workflow
- TypeScript orchestrator (11-stage workflow): `infra/services/analysis-lambda/handler.ts`
- Agent definitions and prompts: `infra/services/analysis-lambda/stages/intelligence-agents.ts`
- Stage implementations: `infra/services/analysis-lambda/stages/` (data-preparation, historical-context, web-research, signal-fusion, thesis-construction, cross-examination, consensus-engine, risk-philosophy, recommendation)
- Deterministic stages (signal fusion, consensus): `infra/services/analysis-lambda/stages/signal-fusion.ts`, `consensus-engine.ts`
- Tools: `infra/services/analysis-lambda/tools/` (news-tool, search-tool, shell-tool, tool-factory)
- Shared libraries: `infra/services/analysis-lambda/lib/` (model, multi-model, json-extractor, types)
- Dispatcher (thin - invokes Analysis_Lambda via `@aws-sdk/client-lambda`): `infra/services/analysis-orchestrator/handler.ts`
- Request intake + dedup + credits: `infra/services/analysis-request/handler.ts`

### Database Schema Changes
- Schema defined in `infra/sql/001-schema.sql` (single consolidated file containing all tables, indexes, triggers, and idempotent migration guards)
- Key tables: users, subscriptions, credit_transactions, markets, analysis_requests, market_analysis_schedule, market_subscribers, analysis_results, analysis_deliveries, agent_memory, agent_performance, notification_preferences, payment_transactions, portfolio_manager_sessions, portfolio_manager_trades, portfolio_manager_decisions
- Always test migrations in both directions

### Market-Level Analysis Pool & Deduplication
- **1-hour minimum interval** between analyses on the same market (hard minimum)
- DynamoDB dedup cache with 1-hour TTL (replaces Redis/ElastiCache)
- Implementation: `infra/services/shared/dynamo.ts` (cache), `infra/services/analysis-request/handler.ts` (flow logic)
- Per-user delivery tracking via `analysis_deliveries` table in Aurora PostgreSQL
- Users only pay when they receive an analysis they haven't seen before
- Recurring schedules coalesce to shortest active interval per market

### Credit System
- Credit deduction only when delivering a result to the user
- Implementation: `infra/services/shared/credits.ts`
- Plans: free (20/mo), starter (100/mo), pro (350/mo), elite (unlimited)
- Immutable audit trail in credit_transactions table
- Refund all subscribers on analysis failure (not just the requesting user)

### Subscription & Billing (On-Chain USDC.e)
- Implementation: `infra/services/subscription-api/handler.ts`
- On-chain USDC.e transfers on Polygon verified via transaction hash
- Auto-renewal via `transferFrom` with pre-approved ERC-20 allowance
- Renewal handler: `infra/services/subscription-renewal/handler.ts`
- Plan definitions: `infra/services/shared/plans.ts`
- Chain verification: `infra/services/shared/chain-verification.ts`
- Credit packs: 20 credits for $4.99, 45 credits for $9.99, 75 credits for $14.99
- Cancellation: cancel at period end, grace period before downgrade

### Multi-Channel Delivery
- WebSocket (in-app): `infra/services/analysis-delivery/handler.ts`
- Email (Resend; SES retained): `infra/services/shared/email.ts`, `infra/services/email-delivery/handler.ts`, `infra/services/system-email-delivery/handler.ts`
- Push (SNS Mobile): `infra/services/push-delivery/handler.ts`
- Webhook (HTTP POST): `infra/services/webhook-delivery/handler.ts`
- Portfolio events: `infra/services/portfolio-notification/handler.ts`
- All channels respect quiet hours and notification preferences
- Kill switch and loss warning events override quiet hours
- SNS topic fan-out triggers all delivery Lambdas in parallel

### Portfolio Manager (Autonomous Trading)
- **Activation**: `infra/services/portfolio-activation/handler.ts` - validates subscription, session limits, recurring analysis, wallet balance
- **Trade Execution**: `infra/services/portfolio-trade-executor/handler.ts` - consumes analysis-complete events, invokes Portfolio_Lambda for entry decisions (including SL/TP prices), validates against hard limits, places CLOB orders (BUY + mandatory SL + mandatory TP)
- **Position Guard**: `infra/services/portfolio-position-guard/handler.ts` - monitors positions via EventBridge Scheduler, invokes Portfolio_Lambda for exit evaluation, detects regime shifts/stale markets
- **Risk Engine**: `infra/services/portfolio-risk-engine/handler.ts` - enforces loss limits, kill switch, cooldowns, emergency exits
- **Lifecycle**: `infra/services/portfolio-lifecycle/handler.ts` - market resolution, subscription downgrade, capital depletion, daily summaries
- **Investment**: `infra/services/portfolio-investment/handler.ts` - increase/decrease investment amounts
- **Dashboard API**: `infra/services/portfolio-dashboard-api/handler.ts` - unified REST interface (sessions, trades, decisions, stats, persona, kill switch)
- **WebSocket Delivery**: `infra/services/portfolio-ws-delivery/handler.ts` - real-time push for portfolio events
- **Analysis Consumer**: `infra/services/portfolio-analysis-consumer/handler.ts` - pauses sessions when recurring analysis is cancelled
- **Shared modules**: `infra/services/shared/portfolio-types.ts`, `portfolio-db.ts`, `persona-registry.ts`, `clob-credentials.ts`
- **Schema**: `infra/sql/001-schema.sql` (sessions, trades, decisions tables - consolidated in the single schema file)
- **Frontend**: Dashboard at `app/portfolio-manager/page.tsx`, Persona settings at `app/account/persona/page.tsx`, Activation modal at `components/portfolio/ActivationModal.tsx`, Inline activation at `components/markets/PMActivationCard.tsx`
- **Hooks**: `usePortfolioSessions`, `usePortfolioSession`, `usePortfolioTrades`, `usePortfolioStats`, `usePortfolioActions`, `usePortfolioWebSocket`, `usePortfolioActivation`, `usePersonaSettings`, `usePersonaParams`
- **Key invariants**: Capital conservation, session uniqueness, concurrent limits, loss limit enforcement, cooldown enforcement, kill switch totality (fails closed), mandatory SL/TP on every position, mutual exclusion between Trade Executor and Position Guard
- **Exit evaluation**: Portfolio Lambda's payload validation makes `analysisResult` optional when `decisionType === 'exit_evaluation'` (Position Guard doesn't have an analysis to pass)
- **Token ID resolution**: Trade executor resolves YES/NO token IDs by matching the `outcome` field from the CLOB API (never by array index - order is not guaranteed)

### Testing Strategy
- **Unit tests**: Test individual functions/methods in isolation
- **Integration tests**: Test component interactions (e.g., agent + tools)
- **Property-based tests**: Use fast-check for correctness properties
- **E2E tests**: Test full workflow with real or mocked external APIs
- **Critical**: All LLM-dependent tests must complete within 30 seconds

## Error Handling & Observability

- Graceful degradation at every layer - partial failures don't crash the pipeline
- Consensus can fail (disagreement > 30%) - system refuses to recommend rather than giving low-confidence output
- CloudWatch alarms: execution time > 60s (warn), > 120s (critical), DLQ depth > 0, daily Bedrock spend > 80% budget
- Per-analysis cost tracking (model costs, tool costs, compute duration)
- SQS dead-letter queue for failed dispatches (3 retries with exponential backoff)
- Failed executions → refund user credit, notify of failure
- Comprehensive audit logging for all agent decisions and API calls
- WebSocket stale connection cleanup (410 Gone → delete from DynamoDB)

```
