
# Project Structure

## Repository Layout

```
tradewizard/
├── tradewizard-frontend/   # Next.js web application
├── infra/                  # V2 AWS CDK infrastructure + Lambda services (Strands SDK)
├── docs/                   # Product and technical documentation
└── .kiro/                  # AI assistant configuration
    ├── specs/              # Feature specifications
    ├── steering/           # Steering rules
    └── settings/           # MCP and other settings
```

> **Note**: The V1 `tradewizard-agents/` (LangGraph) backend has been fully superseded by the self-hosted Lambda services in `infra/services/`. It no longer exists in the codebase.

## Infrastructure (infra/) - V2 Platform

```
infra/
├── bin/
│   └── tradewizard.ts              # CDK app entry point
├── lib/
│   ├── network-stack.ts            # Minimal VPC, public subnets, security groups
│   ├── database-stack.ts           # Aurora PostgreSQL Serverless v2 + DynamoDB tables (dedup, connections, rate limits)
│   ├── auth-stack.ts               # Cognito user pool, app clients, custom auth Lambda triggers
│   ├── queue-stack.ts              # SQS FIFO queue, DLQ, EventBridge event bus
│   ├── notification-stack.ts       # SNS topics (analysis-complete, system-notifications) and retained SES identity
│   ├── storage-stack.ts            # S3 buckets (analysis results, agent traces)
│   ├── monitoring-stack.ts         # CloudWatch dashboards, alarms
│   ├── compute-stack.ts            # All Lambda functions, API Gateway (REST + WebSocket), SQS triggers
│   ├── config.ts                   # Environment-specific configuration (dev/prod)
│   └── constructs/                 # Reusable CDK constructs (empty, for future use)
├── services/
│   ├── analysis-request/
│   │   └── handler.ts              # Credit check, dedup, dispatch, scheduling
│   ├── analysis-orchestrator/
│   │   └── handler.ts              # Thin dispatcher - invokes Analysis_Lambda via @aws-sdk/client-lambda
│   ├── analysis-lambda/
│   │   ├── handler.ts              # 11-stage analysis workflow entry point (Strands SDK)
│   │   ├── lib/
│   │   │   ├── multi-model.ts      # Multi-model routing (capability buckets via shared/ai-provider.ts)
│   │   │   ├── json-extractor.ts   # Robust JSON extraction from LLM responses
│   │   │   └── types.ts            # Shared interfaces (TradeRecommendation, AgentSignal, etc.)
│   │   ├── tools/
│   │   │   ├── news-tool.ts        # NewsData.io Strands tool (API key rotation, 15s timeout)
│   │   │   ├── search-tool.ts      # Serper Strands tool (search + scrape, key rotation)
│   │   │   ├── shell-tool.ts       # Shell analysis tool (bash/python on /tmp, 30s timeout)
│   │   │   └── tool-factory.ts     # Tool factory for agent-specific tool sets
│   │   └── stages/
│   │       ├── data-preparation.ts     # Price history CSV + related markets JSON
│   │       ├── historical-context.ts   # Agent memory from Aurora PostgreSQL
│   │       ├── web-research.ts         # Autonomous web research agent
│   │       ├── intelligence-agents.ts  # 14 parallel agents with system prompts
│   │       ├── signal-fusion.ts        # Deterministic weighted aggregation
│   │       ├── thesis-construction.ts  # Bull/bear thesis agent
│   │       ├── cross-examination.ts    # 5 adversarial tests agent
│   │       ├── consensus-engine.ts     # Deterministic consensus + action determination
│   │       ├── risk-philosophy.ts      # 3 parallel risk agents
│   │       └── recommendation.ts       # Final TradeRecommendation synthesis agent
│   ├── portfolio-lambda/
│   │   ├── handler.ts              # Portfolio manager entry point (persona agent + decision parsing)
│   │   ├── personas.ts             # 6 persona system prompts + exit evaluation addendum
│   │   ├── lib/
│   │   │   ├── model.ts            # Portfolio model factory (Nebius Token Factory)
│   │   │   ├── json-extractor.ts   # Robust JSON extraction
│   │   │   └── types.ts            # PortfolioDecision, PortfolioPayload schemas
│   │   └── tools/
│   │       ├── index.ts            # Tool registry (7 read-only tools)
│   │       ├── market-data.ts      # get_market_data (Polymarket CLOB)
│   │       ├── order-book.ts       # get_order_book (CLOB depth)
│   │       ├── analysis-reader.ts  # read_full_analysis (S3 - detail + public result)
│   │       ├── trade-history.ts    # get_trade_history (Aurora PostgreSQL)
│   │       ├── session-performance.ts # get_session_performance (Aurora PostgreSQL)
│   │       └── agent-accuracy.ts   # get_agent_accuracy (agent performance leaderboard)
│   ├── analysis-subscriptions/
│   │   └── handler.ts              # List + cancel recurring analysis subscriptions; publishes recurring-analysis.cancelled
│   ├── analysis-delivery/
│   │   └── handler.ts              # WebSocket push delivery (SNS → ApiGatewayManagementApi)
│   ├── analysis-dlq-handler/
│   │   └── handler.ts              # Dead-letter queue handler for failed analysis dispatches
│   ├── analysis-sweeper/
│   │   └── handler.ts              # Periodic cleanup of stale/orphaned analysis requests
│   ├── auth-create-challenge/
│   │   └── handler.ts              # Cognito Custom Auth: create challenge (Magic Link code generation)
│   ├── auth-define-challenge/
│   │   └── handler.ts              # Cognito Custom Auth: define challenge (flow orchestration)
│   ├── auth-verify-challenge/
│   │   └── handler.ts              # Cognito Custom Auth: verify challenge (code validation)
│   ├── auth-magic-sync/
│   │   └── handler.ts              # Magic SDK → Cognito user sync
│   ├── email-delivery/
│   │   └── handler.ts              # Analysis email delivery via Resend/SES (quiet hours, preferences)
│   ├── system-email-delivery/
│   │   └── handler.ts              # Subscription/billing transactional email (Resend/SES)
│   ├── push-delivery/
│   │   └── handler.ts              # Push notification via SNS Mobile Push
│   ├── webhook-delivery/
│   │   └── handler.ts              # HTTP POST to user webhook URLs (retry logic)
│   ├── notification-preferences/
│   │   └── handler.ts              # GET/PUT /user/notifications (plan-based validation)
│   ├── post-confirmation/
│   │   └── handler.ts              # Cognito post-confirmation trigger (user setup)
│   ├── recommendation-scorer/
│   │   └── handler.ts              # Scores past recommendations against market outcomes for accuracy tracking
│   ├── subscription-api/
│   │   └── handler.ts              # Wallet-based subscriptions, credit purchases, tx verification
│   ├── subscription-renewal/
│   │   └── handler.ts              # Automatic renewal via transferFrom (ERC-20 allowance)
│   ├── results-api/
│   │   └── handler.ts              # Paginated history, S3 result retrieval
│   ├── ws-connect/
│   │   └── handler.ts              # WebSocket $connect: JWT validation, DynamoDB store
│   ├── ws-disconnect/
│   │   └── handler.ts              # WebSocket $disconnect: DynamoDB cleanup
│   ├── portfolio-activation/
│   │   └── handler.ts              # Create portfolio sessions, validate prerequisites
│   ├── portfolio-trade-executor/
│   │   └── handler.ts              # Evaluate analysis, size positions, place CLOB orders
│   ├── portfolio-position-guard/
│   │   └── handler.ts              # Monitor positions, detect regime shifts, trigger exits
│   ├── portfolio-risk-engine/
│   │   └── handler.ts              # Enforce loss limits, kill switch, cooldowns
│   ├── portfolio-lifecycle/
│   │   └── handler.ts              # Market resolution, session termination, daily summaries
│   ├── portfolio-investment/
│   │   └── handler.ts              # Investment amount increase/decrease
│   ├── portfolio-dashboard-api/
│   │   └── handler.ts              # Session list, trades, decisions, stats, persona settings
│   ├── portfolio-ws-delivery/
│   │   └── handler.ts              # Real-time WebSocket push for portfolio events
│   ├── portfolio-notification/
│   │   └── handler.ts              # Multi-channel notification delivery for portfolio events
│   ├── portfolio-analysis-consumer/
│   │   └── handler.ts              # Subscription cancellation detection, session pausing
│   └── shared/
│       ├── ai-provider.ts          # Nebius Token Factory provider, capability mapping, key + model factory
│       ├── chain-verification.ts   # On-chain tx verification (viem), balance/allowance reads
│       ├── clob-credentials.ts     # Polymarket CLOB API credentials (Secrets Manager + env fallback)
│       ├── connections.ts          # WebSocket connection utilities (store, remove, getByUser)
│       ├── credits.ts              # Credit/subscription SQL queries, plan limits
│       ├── db.ts                   # Aurora PostgreSQL client
│       ├── delivery-utils.ts       # Common delivery utilities (quiet hours, preferences checks)
│       ├── dynamo.ts               # DynamoDB dedup cache, in-flight tracking, rate limiting
│       ├── email.ts                # Shared transactional email sender (Resend primary, SES retained)
│       ├── plans.ts                # Plan definitions, credit pack definitions, pricing
│       ├── portfolio-types.ts      # Portfolio Manager types, Zod schemas, constants
│       ├── portfolio-db.ts         # Portfolio Manager parameterized SQL queries + row mappers
│       └── persona-registry.ts     # 6 trading personas with rules and customization
├── sql/
│   └── 001-schema.sql              # Full PostgreSQL schema (all tables, indexes, triggers, idempotent migration guards)
├── deploy.sh                       # Deployment script (up/down/status, --skip-db)
├── package.json
├── tsconfig.json
├── vitest.config.ts
└── cdk.json
```

## Frontend Structure (tradewizard-frontend)

```
tradewizard-frontend/
├── middleware.ts           # Auth-aware routing (redirects authed users from / to /markets, unauthed from protected routes to /login)
├── app/                    # Next.js App Router
│   ├── layout.tsx         # Root layout (Inter + JetBrains Mono fonts, theme script, Providers)
│   ├── page.tsx           # Marketing landing page (public, server-rendered)
│   ├── login/page.tsx     # Magic Link login flow (AuthShell)
│   ├── markets/
│   │   ├── page.tsx       # Markets feed (AppShell) - search, filters, trending, grid + sidebar
│   │   └── [slug]/page.tsx # Market detail - chart, order book, AI panel, trade execution, PM activation
│   ├── insights/page.tsx  # AI Insights - running + recent analyses, credit usage, agent accuracy
│   ├── portfolio/page.tsx # Portfolio - positions, analysis history, closed trades, performance chart
│   ├── portfolio-manager/page.tsx # PM Dashboard - sessions, kill switch, real-time updates (Pro+)
│   ├── account/
│   │   ├── page.tsx       # Settings - delivery channels, quiet hours, thresholds, persona
│   │   ├── subscription/page.tsx  # Plan management + credit packs + billing history
│   │   ├── persona/page.tsx       # 6-persona picker + Elite slider customization
│   │   └── portfolio/              # Portfolio settings (redirect or sub-page)
│   └── api/               # API routes (Polymarket proxy, TradeWizard proxy)
├── components/
│   ├── ui/                # Design system primitives (OKLch tokens)
│   │   ├── index.ts       # Barrel export
│   │   ├── Card.tsx       # Variants: default, elevated, ai
│   │   ├── Button.tsx     # Variants: primary, secondary, ai, yes, no, ghost, danger
│   │   ├── Badge.tsx      # Tones: neutral, accent, ai, yes, no, warning, muted
│   │   ├── ProbabilityBar.tsx  # cents 0-100, optional aiCents marker
│   │   ├── MetricStat.tsx # label, value, sub, tone
│   │   ├── Modal.tsx      # Portal + focus trap + Escape close
│   │   ├── Toggle.tsx     # Accessible switch (role="switch")
│   │   ├── Tabs.tsx       # Arrow key navigation, active indicator
│   │   ├── Expandable.tsx # Native <details>/<summary>
│   │   ├── Slider.tsx     # Range input with custom styling
│   │   ├── ScrollToTop.tsx # Scroll-to-top button utility
│   │   ├── TierGate.tsx   # Plan-based conditional rendering (render/lock/hide)
│   │   ├── LockOverlay.tsx # Backdrop-blur lock with upgrade link
│   │   └── UpgradePrompt.tsx # Banner: free-to-starter, starter-to-pro, pro-to-elite
│   ├── shell/             # Layout shells
│   │   ├── index.ts       # Barrel export
│   │   ├── AppShell.tsx   # Product layout (AppNav + main content + banner slot)
│   │   ├── AppNav.tsx     # Sticky nav (56px, max-w 1200px, tier-gated links, mobile hamburger)
│   │   ├── MarketingShell.tsx # Public landing layout (transparent nav, footer)
│   │   ├── AuthShell.tsx  # Login layout (centered 400px card)
│   │   ├── CreditBadge.tsx # Credit balance display (∞ for elite)
│   │   ├── WalletBadge.tsx # Wallet address + hover panel (balance, committed, available)
│   │   └── ThemeToggle.tsx # Dark/light toggle (persists to localStorage)
│   ├── markets/           # Market-specific components
│   │   ├── MarketCard.tsx # Feed card with ProbabilityBar, Buy YES/NO
│   │   ├── AIPanel.tsx    # AI Intelligence panel (recommendation, expandable sections)
│   │   ├── AIIntelligencePanel.tsx # Extended AI intelligence display
│   │   ├── TradePanel.tsx # Trade execution (tabs, order types, summary, mobile pinned)
│   │   ├── TradeExecution.tsx # Trade execution logic component
│   │   ├── AnalysisModal.tsx # 11-stage progress pipeline
│   │   └── PMActivationCard.tsx # Portfolio Manager activation (TierGate pro)
│   ├── landing/           # Landing page components
│   │   └── BrowserFrame.tsx # Browser mockup frame for marketing visuals
│   ├── account/           # Account settings components
│   │   └── NotificationSettings.tsx # Notification preferences form
│   ├── subscription/      # Subscription management components
│   │   ├── PlanCard.tsx              # Plan comparison card (USDC.e pricing)
│   │   ├── ConfirmPurchaseDialog.tsx # Purchase confirmation modal
│   │   └── AllowanceApproval.tsx     # Auto-renewal allowance toggle
│   ├── portfolio/         # Portfolio Manager components
│   │   ├── ActivationModal.tsx  # Activate portfolio manager on a market
│   │   ├── WalletBalanceCard.tsx # Wallet balance display card
│   │   └── WithdrawModal.tsx    # Withdraw funds modal
│   └── Portal.tsx         # React Portal utility component
├── hooks/
│   ├── useCurrentPlan.ts            # Plan capabilities derived from useSubscription (no network call)
│   ├── useAuth.ts                    # Authentication hook
│   ├── useWebSocket.ts              # WebSocket connection hook
│   ├── useSubscription.ts           # Subscription & credits hook
│   ├── useWalletSubscription.ts     # Wallet-based subscription management
│   ├── useSubscriptionAllowance.ts  # USDC.e allowance for auto-renewal
│   ├── useAnalysisResults.ts        # Analysis history & detail hooks
│   ├── useAnalysisProgress.ts       # Real-time analysis progress tracking
│   ├── useAnalysisStatus.ts         # Analysis execution status tracking
│   ├── useAnalysisSubscriptions.ts  # Recurring analysis subscription management
│   ├── useMarketAnalysis.ts         # Market analysis data hook
│   ├── useMarketAnalysisHistory.ts  # Per-market analysis history
│   ├── useMarketTradePerformance.ts # Market trade performance metrics
│   ├── useAgentAccuracy.ts          # Agent accuracy leaderboard data
│   ├── useNotificationPreferences.ts # Notification settings hook
│   ├── useMarkets.ts               # Market listing hook
│   ├── useMarketSearch.ts          # Market search hook
│   ├── useClobClient.ts            # Polymarket CLOB client hook
│   ├── useClobOrder.ts             # Order placement hook
│   ├── useOrderBook.ts             # Order book depth data
│   ├── useUserPositions.ts         # User positions hook
│   ├── usePolygonBalances.ts       # Wallet balances hook
│   ├── usePriceHistory.ts          # Price history hook
│   ├── usePublicMarketPrices.ts    # Public market price data hook
│   ├── useInfiniteScroll.ts        # Infinite scroll utility
│   ├── useTradingSession.ts        # Trading session state hook
│   ├── useRedeemPosition.ts        # Position redemption hook
│   ├── useTickSize.ts              # Tick size utility hook
│   ├── useTokenApprovals.ts        # Token approval management hook
│   ├── useUsdcTransfer.ts          # USDC transfer hook
│   ├── useRelayClient.ts           # Relay client hook
│   ├── useSafeDeployment.ts        # Safe deployment hook
│   ├── useUserApiCredentials.ts    # User API credentials hook
│   ├── useGeoblock.ts             # Geoblocking detection hook
│   ├── usePoliticalCategories.ts  # Political market categories hook
│   ├── useAddressCopy.ts          # Address copy utility hook
│   ├── useDebounce.ts             # Debounce utility hook
│   ├── useMediaQuery.ts           # Media query responsive hook
│   ├── useSpotlight.ts            # Spotlight/search overlay hook
│   ├── usePortfolioSessions.ts    # Portfolio sessions list with WebSocket updates
│   ├── usePortfolioSession.ts     # Single portfolio session detail
│   ├── usePortfolioTrades.ts      # Paginated portfolio trade history
│   ├── usePortfolioStats.ts       # Aggregate portfolio statistics
│   ├── usePortfolioActions.ts     # Portfolio mutations: pause, resume, stop, kill switch
│   ├── usePortfolioWebSocket.ts   # Portfolio WebSocket event handler + cache invalidation
│   ├── usePortfolioActivation.ts  # Activation mutation + preflight checks
│   ├── usePortfolioDecisions.ts   # Portfolio decision log data
│   ├── usePersonaSettings.ts      # Persona config fetch + update selection
│   └── usePersonaParams.ts        # Elite persona customization with validation
├── lib/
│   ├── cognito-auth.ts    # Cognito client (InitiateAuth, tokens, refresh)
│   ├── api-client.ts      # Typed HTTP client with retry & error classes
│   ├── websocket-client.ts # WebSocket with reconnection & ping keepalive
│   ├── magic.ts           # Magic SDK wallet auth
│   └── market-search.ts   # Market search utilities
├── providers/
│   ├── index.tsx          # Provider composition (Auth → Wallet → Query → WebSocket → Trading)
│   ├── AuthProvider.tsx   # Auth context (user, tokens, auto-refresh)
│   ├── WalletProvider.tsx # Wallet context (Magic SDK)
│   ├── WalletContext.tsx  # Wallet context definition
│   ├── QueryProvider.tsx  # TanStack Query client
│   ├── WebSocketProvider.tsx # WebSocket context (connect/disconnect on auth)
│   └── TradingProvider.tsx   # Trading session state
├── constants/             # App constants
│   ├── plans.ts           # Plan types, PLAN_CAPABILITIES matrix, PLAN_RANK, planAtLeast()
│   ├── navigation.ts     # APP_NAV_ITEMS with tier-gated links
│   ├── api.ts            # API base URLs and endpoint paths
│   ├── categories.ts     # Market category definitions
│   ├── polymarket.ts     # Polymarket-specific constants
│   ├── query.ts          # TanStack Query key factories
│   ├── tokens.ts         # Token/contract addresses
│   ├── ui.ts             # UI constants (breakpoints, sizes)
│   └── validation.ts     # Validation rules and limits
├── utils/                 # Utility functions
│   ├── motion.ts          # Framer Motion duration tokens, easing, variants (fadeIn, slideUp, pulseAi)
│   ├── classNames.ts      # cn() utility for Tailwind class merging
│   ├── formatting.ts      # Number/date formatting utilities
│   ├── validation.ts      # Input validation logic
│   ├── marketFilters.ts   # Market filtering logic
│   ├── marketResolution.ts # Market resolution utilities
│   ├── approvals.ts       # Token approval utilities
│   ├── redeem.ts          # Position redemption utilities
│   ├── transfer.ts        # Transfer utilities
│   ├── session.ts         # Session management utilities
│   ├── errorLogging.ts    # Error logging utilities
│   ├── subscription-errors.ts # Subscription error handling
│   └── trade-errors.ts    # Trade error handling
├── styles/                # Global styles + mobile optimizations
└── public/                # Static assets (favicons, manifest)
```

## Key Architectural Patterns

### V2 Analysis Flow (AWS-Native)
```
User requests analysis → API Gateway → Lambda (analysis-request)
  → Credit check (Aurora) → Dedup check (DynamoDB)
  → If cached: serve result immediately (200)
  → If in-flight: subscribe user to pending result
  → If fresh needed: SQS → Lambda (analysis-orchestrator)
    → Lambda invoke (Analysis_Lambda - 11-stage Strands SDK workflow)
    → Store result (Aurora + S3)
    → Publish to SNS (Analysis Complete topic)
    → Fan-out to delivery Lambdas:
      → WebSocket push (analysis-delivery)
      → Email via Resend/SES (email-delivery)
      → Push via SNS Mobile (push-delivery)
      → HTTP webhook (webhook-delivery)
```

### Market-Level Analysis Pool
- One fresh analysis per market per hour (hard minimum interval)
- DynamoDB TTL-based cache (1-hour TTL) for fast freshness checks
- Per-user delivery tracking via `analysis_deliveries` table in Aurora PostgreSQL
- Users only pay 1 credit when receiving an analysis they haven't seen before
- Recurring schedules coalesce to shortest active interval per market
- **When modifying**: `infra/services/analysis-request/handler.ts`, `infra/services/shared/dynamo.ts`

### Credit & Subscription System
- Credit deducted only when delivering a result to the user
- Plans: free (20/mo), starter (100/mo), pro (350/mo), elite (unlimited)
- Immutable audit trail in credit_transactions table
- Failed executions → refund all subscribers (not just requesting user)
- On-chain USDC.e payments on Polygon (tx hash verification)
- Auto-renewal via ERC-20 `transferFrom` with pre-approved allowance
- **When modifying**: `infra/services/shared/credits.ts`, `infra/services/shared/plans.ts`, `infra/services/subscription-api/handler.ts`

### Agent Orchestration (V2 - Self-Hosted Lambda + Strands SDK)
- 14 TypeScript intelligence agents defined in `infra/services/analysis-lambda/stages/intelligence-agents.ts`
- All 14 agents run on every market (no conditional selection by market type)
- Deterministic logic (signal fusion, consensus) in `infra/services/analysis-lambda/stages/signal-fusion.ts` and `consensus-engine.ts`
- Deployed via CDK as part of the Analysis_Lambda NodejsFunction (bundled into the Lambda)
- Orchestrator Lambda (`infra/services/analysis-orchestrator/handler.ts`) is a thin dispatcher that invokes Analysis_Lambda via `@aws-sdk/client-lambda`
- **Multi-model routing** (active, `infra/services/analysis-lambda/lib/multi-model.ts`): logical agent keys resolve to capability buckets, then to the active provider's model IDs:
  - `agentic` — NVIDIA Nemotron 3 Super: breaking_news, event_impact, historical_patterns, web research
  - `fast` — Qwen3-30B-A3B: market_microstructure, probability_baseline, momentum
  - `analytical` — Qwen3-235B-A22B: risk_assessment, polling_intelligence, mean_reversion
  - `reasoning` — GPT-OSS 120B: media_sentiment, social_sentiment, narrative_velocity
  - `deep_reasoning` — DeepSeek-V4-Pro: catalyst_identification, tail_risk
  - `non_tool` — Kimi K3: thesis, cross-exam, risk philosophy (×3), recommendation
  - `default` — MiniMax M3: portfolio persona decisions
- All model IDs are env-driven (`NEBIUS_MODEL_*`) for per-environment overrides
- `AI_PROVIDER=nebius` selects Nebius Token Factory via `infra/services/shared/ai-provider.ts`; model IDs use `NEBIUS_MODEL_<CAPABILITY>`. Tool-using agents must map to tool-capable capabilities; `non_tool` is only for stages without tools.
- Price-aware agents get shell tool, news agents get NewsData.io tool, browser agents get Serper search/scrape tool
- Tool assignment managed by `infra/services/analysis-lambda/tools/tool-factory.ts`
- **When adding agents**: Add system prompt to `AGENT_SYSTEM_PROMPTS` record, add name to `ALL_AGENT_NAMES`, add to tool category arrays in `intelligence-agents.ts`

### Memory System
- Historical agent signals stored in Aurora PostgreSQL `agent_memory` table
- Retrieved before each analysis via `infra/services/analysis-lambda/stages/historical-context.ts`
- Fetches the past N analyses from `analysis_results` + `agent_memory` tables using `pg` client
- Each agent receives only its own historical signals - independent opinions, no cross-agent anchoring
- N is configurable via `ANALYSIS_HISTORY_DEPTH` environment variable (default: 5, clamped to [1, 20])
- Enables closed-loop learning and consistency; agent performance leaderboard tracks accuracy over time
- **When debugging**: Check `agent_memory` table, verify `DB_SECRET_ARN` is set, check `ANALYSIS_HISTORY_DEPTH`

### Error Handling
- Graceful degradation at every layer
- Partial failures don't crash the pipeline
- Consensus can fail (disagreement > 30%) - refuses to recommend
- SQS DLQ for failed dispatches (3 retries with exponential backoff)
- Failed executions → refund credit, notify user
- **When adding features**: Include error handling and audit logging from the start

### Notification & Delivery
- Multi-channel: in-app (WebSocket), email (Resend primary, SES retained), push (SNS), webhook (HTTP POST)
- WebSocket connections tracked in DynamoDB with 24h TTL
- User notification preferences stored in Aurora PostgreSQL
- Quiet hours and probability-shift thresholds supported
- Plan-based channel restrictions (free=in_app, starter+=email/push, pro+=webhook)
- SNS topic fan-out triggers all delivery Lambdas simultaneously
- Stale WebSocket connections cleaned up on 410 Gone response
- **When modifying**: `infra/services/analysis-delivery/`, `infra/services/email-delivery/`, etc.

### Frontend Authentication
- Cognito Custom Auth flow (Magic Link - passwordless)
- Tokens stored in localStorage with `tw_` prefix
- Auto-refresh scheduled 5 minutes before expiry
- API client auto-injects Bearer token on all requests
- WebSocket connects with token as query parameter
- Auth Cookie Bridge: `providers/AuthProvider.tsx` mirrors id token into `tw_id_token` cookie for middleware routing
- **When modifying**: `lib/cognito-auth.ts` (frozen), `providers/AuthProvider.tsx`

### Frontend Routing & Shells
- `middleware.ts` handles auth-aware redirects before page render (no crypto validation, just exp check)
- Three shell layouts: `AppShell` (authenticated), `MarketingShell` (public landing), `AuthShell` (login)
- Protected routes: `/markets`, `/insights`, `/portfolio`, `/portfolio-manager`, `/account/*`
- Public routes: `/`, `/login`, `/api/*`

### Frontend Tier-Gating
- `constants/plans.ts` defines the Plan Capability Matrix (intervals, channels, PM sessions, persona customization)
- `hooks/useCurrentPlan.ts` derives capabilities from `useSubscription` without new network calls
- `components/ui/TierGate.tsx` conditionally renders/locks/hides content based on plan
- Backend remains the single source of truth - frontend gates are UI affordances only
- **When modifying**: `constants/plans.ts`, `hooks/useCurrentPlan.ts`, `components/ui/TierGate.tsx`

### Frontend Design System
- OKLch color tokens defined in `app/globals.css` with dark/light theme support via `data-theme` attribute
- Tailwind 4 `@theme inline` directive exposes tokens as utility classes (`bg-surface`, `text-ai`, etc.)
- UI primitives in `components/ui/` enforce consistent styling (12px radius, hairline borders, focus rings)
- Motion tokens in `utils/motion.ts` (duration, easing, Framer Motion variants)
- Theme persisted in `localStorage('tw-theme')`, applied before hydration via inline script

### Frontend Real-Time
- WebSocket client with exponential backoff reconnection
- Connects on auth, disconnects on logout
- Invalidates TanStack Query cache on new analysis messages
- Ping keepalive every 5 minutes
- **When modifying**: `lib/websocket-client.ts`, `providers/WebSocketProvider.tsx`

## File Naming Conventions

### TypeScript/JavaScript
- kebab-case for files: `market-ingestion.ts`
- PascalCase for classes/components: `MarketBriefingDocument`, `AnalysisDetail.tsx`
- camelCase for functions/variables: `analyzeMarket`

## Test File Locations

### Infrastructure (infra/)
- Lambda service tests co-located: `infra/services/analysis-lambda/__tests__/`, `infra/services/portfolio-lambda/__tests__/`
- Vitest + fast-check for property-based testing
- Property tests: `*.property.test.ts`

### Frontend (tradewizard-frontend)
- Hook tests in `hooks/__tests__/`
- Utility tests in `utils/__tests__/`

## Configuration Files Location

- Root `.env` files for each project
- `.env.example` templates for documentation
- `.env.local` for local frontend overrides
- `.env.production` for production overrides
- `infra/cdk.json` for CDK configuration
- `infra/lib/config.ts` for environment-specific settings
- `infra/deploy.sh` for deployment orchestration (up/down/status)
- `.kiro/settings/` for AI assistant configuration

## Common Development Tasks

### Adding a New Agent (V2 - Self-Hosted Lambda + Strands SDK)
1. Open `infra/services/analysis-lambda/stages/intelligence-agents.ts`
2. Add your agent name to the `ALL_AGENT_NAMES` array
3. Add a system prompt to the `AGENT_SYSTEM_PROMPTS` record
4. Add to appropriate tool category arrays (`PRICE_AWARE_AGENTS`, `NEWS_AGENTS`, `BROWSER_AGENTS`)
5. Deploy with `npm run deploy:dev` from `infra/` directory (agents are bundled into Analysis_Lambda)
6. The TypeScript dispatcher Lambda (`infra/services/analysis-orchestrator/handler.ts`) invokes Analysis_Lambda - no changes needed there for new agents

### Adding a New Lambda Service
1. Create handler in `infra/services/service-name/handler.ts`
2. Add Lambda function to `infra/lib/compute-stack.ts`
3. Configure IAM permissions, environment variables, triggers
4. Add API Gateway integration if needed (REST or WebSocket route)
5. Shared utilities go in `infra/services/shared/`

### Adding a Frontend Page
1. Create `app/your-page/page.tsx` with `'use client'` directive (or omit for server-rendered pages like the landing)
2. Wrap in `AppShell` (authenticated pages), `MarketingShell` (public), or `AuthShell` (login)
3. Use existing hooks (`useCurrentPlan`, `useSubscription`, etc.)
4. Use UI primitives from `components/ui/` (Card, Button, Badge, TierGate, etc.)
5. Style with Tailwind CSS using OKLch token utilities (`bg-surface`, `text-fg`, `border-border`, etc.)
6. Navigation links are defined in `constants/navigation.ts` - add new entries there for AppNav
7. For tier-gated content, wrap in `<TierGate plan="pro" feature="Feature Name">`
8. Add `UpgradePrompt` banners for free/starter users where appropriate

### Adding a Frontend Hook
1. Create `hooks/useYourHook.ts` with `'use client'` directive
2. Use `useQuery` / `useMutation` from TanStack Query
3. Use `apiClient` for API calls (auto-injects auth token)
4. Export from the hooks directory

### Database Schema Changes
1. Modify `infra/sql/001-schema.sql` (all tables, indexes, and idempotent migration guards are in this single file)
2. Apply to Aurora cluster (deploy.sh handles this automatically)
3. Update relevant service handlers if schema affects queries
4. Verify agent memory retrieval works after changes

### Testing Strategy
- **Unit tests**: Test individual functions/methods in isolation
- **Integration tests**: Test component interactions (e.g., agent + tools)
- **Property-based tests**: Use fast-check for correctness properties
- **E2E tests**: Test full workflow with real or mocked external APIs
- All LLM-dependent tests must complete within 30 seconds

```
