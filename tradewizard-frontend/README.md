# TradeWizard Frontend

> Next.js 16 web application for AI-powered prediction market trading on Polymarket

## Overview

TradeWizard transforms prediction markets from speculative guessing into guided, intelligence-driven trading. The frontend provides real-time analysis delivery, subscription management, and a complete trading interface powered by Cognito authentication and WebSocket connections. AI inference runs server-side on Nebius Token Factory; the browser never holds a provider key.

### Key Features

- 🔐 **Passwordless Auth**: Amazon Cognito with Magic Link (email-based, no passwords)
- ⚡ **Real-Time Delivery**: WebSocket connection with automatic reconnection for instant analysis results
- 🤖 **AI Analysis**: Request one-time or recurring multi-agent analysis on any market
- 📊 **Results Viewer**: Paginated history with infinite scroll, full detail view with agent signals
- 💳 **Subscription Management**: pUSD (Polymarket USD) wallet-based plans (Free, Starter, Pro, Elite) with credit system
- 🔔 **Notification Settings**: Configure email, push, webhook channels with quiet hours
- 💰 **Credit System**: Real-time balance display with optimistic updates
- 🔗 **On-Chain Payments**: pUSD transfers from Trading Wallet (Safe) on Polygon, with legacy USDC.e read compatibility
- 🔄 **Auto-Renewal**: ERC-20 allowance-based automatic subscription renewal
- 🤖 **Autonomous Portfolio Manager**: Activate AI trading agents per market with persona-based strategies
- 📈 **Portfolio Dashboard**: Real-time session monitoring, trade history, P&L tracking, kill switch
- 🎭 **Trading Personas**: 6 configurable personas (Sniper, Scalper, Contrarian, Catalyst Hunter, Hedge Architect, Momentum Rider)

## Quick Start

```bash
# 1. Install dependencies
npm install

# 2. Configure environment
cp .env.example .env.local
# Edit .env.local with your API keys (see below)

# 3. Start development server
npm run dev
```

Visit `http://localhost:3000`

## Environment Variables

```bash
# Amazon Cognito Authentication
NEXT_PUBLIC_COGNITO_USER_POOL_ID=us-east-1_xxxxx
NEXT_PUBLIC_COGNITO_CLIENT_ID=your_client_id
NEXT_PUBLIC_AWS_REGION=us-east-1

# API Gateway (REST)
NEXT_PUBLIC_API_BASE_URL=https://your-api-id.execute-api.us-east-1.amazonaws.com/dev

# WebSocket (Real-time delivery)
NEXT_PUBLIC_WS_URL=wss://your-ws-id.execute-api.us-east-1.amazonaws.com/dev

# Wallet Payments (pUSD on Polygon; legacy USDC.e fallback)
NEXT_PUBLIC_PLATFORM_WALLET_ADDRESS=0x...  # TradeWizard receiving wallet for subscription/credit payments
NEXT_PUBLIC_USDC_CONTRACT_ADDRESS=0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174  # Legacy USDC.e address (pUSD is canonical in code)

# Polymarket (Market data)
NEXT_PUBLIC_POLYMARKET_API_URL=https://clob.polymarket.com
```

| Variable | Required | Description |
|----------|----------|-------------|
| `NEXT_PUBLIC_COGNITO_USER_POOL_ID` | Yes | Cognito User Pool ID for authentication |
| `NEXT_PUBLIC_COGNITO_CLIENT_ID` | Yes | Cognito App Client ID (frontend client) |
| `NEXT_PUBLIC_AWS_REGION` | Yes | AWS region (e.g., `us-east-2`) |
| `NEXT_PUBLIC_API_BASE_URL` | Yes | REST API Gateway URL from CDK outputs |
| `NEXT_PUBLIC_WS_URL` | Yes | WebSocket API Gateway URL from CDK outputs |
| `NEXT_PUBLIC_PLATFORM_WALLET_ADDRESS` | Yes | Platform Wallet address that receives pUSD payments |
| `NEXT_PUBLIC_USDC_CONTRACT_ADDRESS` | No | Legacy USDC.e contract on Polygon (defaults to `0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174`) |
| `NEXT_PUBLIC_POLYMARKET_API_URL` | No | Polymarket CLOB API (defaults to `https://clob.polymarket.com`) |

## Tech Stack

| Category | Technology |
|----------|-----------|
| Framework | Next.js 16 (App Router) |
| Language | TypeScript (strict mode) |
| Styling | Tailwind CSS 4 |
| State | TanStack React Query |
| Auth | Amazon Cognito (Custom Auth / Magic Link) |
| Real-time | WebSocket with exponential backoff |
| Payments | pUSD on-chain transfers (Polygon) via relayClient, with legacy USDC.e fallback |
| Web3 | viem, Magic SDK, @polymarket/builder-relayer-client |
| Icons | Lucide React |
| Animations | Framer Motion |
| Infinite Scroll | react-intersection-observer |

## Architecture

```
┌─────────────────────────────────────────────────────┐
│                    Next.js Frontend                   │
├─────────────────────────────────────────────────────┤
│  Providers: Auth → Wallet → Query → WebSocket → Trading │
├─────────────────────────────────────────────────────┤
│  Hooks: useAuth, useWebSocket, useSubscription,      │
│         useAnalysisResults, useNotificationPreferences│
├─────────────────────────────────────────────────────┤
│  Lib: cognito-auth, api-client, websocket-client     │
└──────────────┬──────────────────────┬───────────────┘
               │ REST (Bearer JWT)     │ WebSocket (JWT query param)
               ▼                       ▼
        API Gateway REST         API Gateway WebSocket
               │                       │
               ▼                       ▼
        Lambda Handlers          ws-connect / ws-disconnect
```

### Data Flow

1. **Auth**: User signs in via Magic Link → Cognito issues JWT tokens → stored in localStorage
2. **API Calls**: `api-client.ts` attaches Bearer token, retries 5xx with backoff
3. **Real-time**: WebSocket connects on auth, receives analysis results, updates TanStack Query cache
4. **Payments**: User initiates a pUSD transfer from Trading Wallet (Safe) via relayClient (legacy USDC.e fallback) → backend verifies on-chain → activates subscription/credits

## Project Structure

```
tradewizard-frontend/
├── app/                          # Next.js App Router
│   ├── layout.tsx               # Root layout (wraps with Providers)
│   ├── page.tsx                 # Marketing landing page (public)
│   ├── login/page.tsx           # Magic Link login flow
│   ├── markets/
│   │   ├── page.tsx             # Markets feed (search, filters, grid)
│   │   └── [slug]/page.tsx      # Market detail (chart, order book, AI panel, trade, PM)
│   ├── insights/page.tsx        # AI Insights (running analyses, credit usage, agent accuracy)
│   ├── portfolio/page.tsx       # Portfolio (positions, history, closed trades, performance)
│   ├── portfolio-manager/page.tsx # PM Dashboard (sessions, kill switch, real-time updates)
│   ├── account/
│   │   ├── page.tsx             # Account settings + notifications
│   │   ├── subscription/page.tsx # Plan management + billing
│   │   ├── persona/page.tsx     # 6-persona picker + Elite customization
│   │   └── portfolio/           # Portfolio settings
│   └── api/                     # API routes (Polymarket proxy, TradeWizard proxy)
├── components/
│   ├── ui/                      # Design system primitives (OKLch tokens)
│   │   ├── Card.tsx, Button.tsx, Badge.tsx, Modal.tsx, Tabs.tsx, etc.
│   │   ├── TierGate.tsx         # Plan-based conditional rendering
│   │   ├── LockOverlay.tsx      # Locked feature overlay
│   │   └── UpgradePrompt.tsx    # Upgrade banner
│   ├── shell/                   # Layout shells
│   │   ├── AppShell.tsx         # Authenticated product layout
│   │   ├── AppNav.tsx           # Navigation with tier-gated links
│   │   ├── MarketingShell.tsx   # Public landing layout
│   │   ├── AuthShell.tsx        # Login layout
│   │   ├── CreditBadge.tsx      # Credit balance display
│   │   ├── WalletBadge.tsx      # Wallet info panel
│   │   └── ThemeToggle.tsx      # Dark/light toggle
│   ├── markets/                 # Market-specific components
│   │   ├── MarketCard.tsx       # Market feed card
│   │   ├── AIPanel.tsx          # AI analysis panel
│   │   ├── TradePanel.tsx       # Trade execution panel
│   │   ├── AnalysisModal.tsx    # 11-stage progress display
│   │   └── PMActivationCard.tsx # Portfolio Manager inline activation
│   ├── landing/                 # Landing page components
│   │   └── BrowserFrame.tsx     # Browser mockup frame
│   ├── portfolio/               # Portfolio Manager components
│   │   ├── ActivationModal.tsx  # Activate PM on a market
│   │   ├── WalletBalanceCard.tsx # Wallet balance card
│   │   └── WithdrawModal.tsx    # Withdraw funds
│   ├── subscription/            # Subscription components
│   │   ├── PlanCard.tsx         # Plan comparison card
│   │   ├── ConfirmPurchaseDialog.tsx
│   │   └── AllowanceApproval.tsx
│   ├── account/                 # Account settings components
│   │   └── NotificationSettings.tsx
│   └── Portal.tsx               # React Portal utility
├── hooks/                       # 49 custom hooks
│   ├── useAuth.ts, useWebSocket.ts, useSubscription.ts
│   ├── useAnalysisResults.ts, useAnalysisProgress.ts, useAnalysisSubscriptions.ts
│   ├── useMarkets.ts, useMarketSearch.ts, useMarketAnalysis.ts
│   ├── usePortfolioSessions.ts, usePortfolioTrades.ts, usePortfolioActions.ts
│   ├── usePersonaSettings.ts, usePersonaParams.ts
│   └── ... (useClobClient, useOrderBook, useAgentAccuracy, etc.)
├── lib/
│   ├── cognito-auth.ts          # Cognito client (tokens, refresh)
│   ├── api-client.ts            # Typed HTTP client with retry
│   ├── websocket-client.ts      # WebSocket with reconnection
│   ├── magic.ts                 # Magic SDK wallet auth
│   └── market-search.ts         # Market search utilities
├── providers/
│   ├── index.tsx                # Provider composition (Auth → Wallet → Query → WS → Trading)
│   ├── AuthProvider.tsx, WalletProvider.tsx, QueryProvider.tsx
│   ├── WebSocketProvider.tsx, TradingProvider.tsx
│   └── WalletContext.tsx
├── constants/                   # App constants (plans, navigation, api, tokens, etc.)
├── utils/                       # Utility functions (motion, formatting, validation, etc.)
└── styles/                      # Global styles
```

## Key Modules

### Authentication (`lib/cognito-auth.ts`)

Passwordless auth via Cognito Custom Auth flow:

```typescript
import { useAuth } from '@/hooks/useAuth';

const { user, isAuthenticated, signIn, verifyCode, signOut } = useAuth();

// 1. Send magic link
await signIn('user@example.com');

// 2. User enters code from email
await verifyCode('123456');

// 3. Tokens stored, auto-refresh scheduled
```

- Tokens stored in localStorage with `tw_` prefix
- Auto-refresh 5 minutes before expiry
- Redirects to `/login` on refresh failure

### API Client (`lib/api-client.ts`)

Typed HTTP client with automatic auth and error handling:

```typescript
import { apiClient, InsufficientCreditsError } from '@/lib/api-client';

// Typed request with Bearer token auto-injected
const data = await apiClient.get<SubscriptionData>('/subscriptions');

// Error handling
try {
  await apiClient.post('/v2/analysis', { marketId, requestType: 'one_time' });
} catch (err) {
  if (err instanceof InsufficientCreditsError) {
    // Show upgrade prompt
  }
}
```

- Retries 5xx errors with exponential backoff (1s, 2s, 4s, max 3 retries)
- Typed errors: `InsufficientCreditsError` (402), `PlanRestrictionError` (403), `NotFoundError` (404)

### WebSocket Client (`lib/websocket-client.ts`)

Real-time analysis delivery with automatic reconnection:

```typescript
import { useWebSocket } from '@/hooks/useWebSocket';

const { isConnected, lastMessage } = useWebSocket();

// lastMessage contains: { type: 'analysis_complete', payload: { analysisId, ... } }
```

- Connects on authentication, disconnects on logout
- Exponential backoff: 1s → 2s → 4s → 8s → max 30s
- Ping keepalive every 5 minutes
- Invalidates TanStack Query cache on new messages

### Analysis Request

```typescript
import { GetAnalysisButton } from '@/components/analysis';

// Drop this on any market page
<GetAnalysisButton marketId="0x..." marketName="Will X happen?" />
```

- One-time or recurring (plan-aware intervals)
- Handles 402 (insufficient credits) with upgrade prompt
- Cached results navigate directly to detail view
- Queued results show toast notification

### Subscription Hooks

```typescript
import {
  useWalletSubscription,
  useSubscribePlan,
  usePurchaseCreditPack,
  useCancelSubscription,
  useManualRenew,
} from '@/hooks/useWalletSubscription';
import { useSubscriptionAllowance } from '@/hooks/useSubscriptionAllowance';

// Query subscription data
const { data } = useWalletSubscription();
// data.plan, data.creditsRemaining, data.billingCycleEnd, data.allowanceStatus

// Subscribe to a plan (pUSD transfer → backend verification)
const subscribePlan = useSubscribePlan();
await subscribePlan.mutateAsync({ planId: 'pro' });

// Purchase credit pack
const purchaseCredits = usePurchaseCreditPack();
await purchaseCredits.mutateAsync({ packId: 'pack_20' });

// Manage auto-renewal allowance
const { isAutoRenewalEnabled, approveAllowance, revokeAllowance } = useSubscriptionAllowance();
await approveAllowance.mutateAsync({}); // Approve pUSD/legacy USDC.e allowance for auto-renewal
```

## Pages

| Route | Description |
|-------|-------------|
| `/` | Marketing landing page (public) |
| `/login` | Magic Link authentication flow |
| `/markets` | Market discovery and browsing |
| `/markets/[slug]` | Market detail (chart, order book, AI panel, trade execution, PM activation) |
| `/insights` | AI Insights (running analyses, credit usage, agent accuracy) |
| `/portfolio` | Portfolio (positions, history, closed trades, performance) |
| `/portfolio-manager` | Portfolio Manager dashboard (sessions, trades, P&L, kill switch) |
| `/account` | Account settings + notification preferences |
| `/account/subscription` | Plan management, credit packs, billing |
| `/account/persona` | Trading persona selection and customization |

## Subscription Plans

| Plan | Price (pUSD/mo) | Credits/Month | Recurring Intervals | Notification Channels |
|------|-------------------|---------------|--------------------|-----------------------|
| Free | 0 | 20 | One-time only | In-app |
| Starter | 19 | 100 | 1 day | In-app, email, push |
| Pro | 49 | 350 | 1h, 4h, 12h, 1d | All channels |
| Elite | 149 | Unlimited | All intervals | All channels |

### Payment Flow

1. User selects a plan or credit pack on the subscription page
2. Frontend creates a pUSD transfer (or legacy `USDC.e.transfer` fallback) to the Platform Wallet
3. Transaction is executed via `relayClient.execute()` from the Trading Wallet (Safe)
4. Frontend receives the on-chain transaction hash
5. Frontend POSTs the txHash to the backend for verification
6. Backend verifies the transfer on-chain and activates the subscription/credits

### Auto-Renewal

Users can approve a pUSD or legacy USDC.e allowance to enable automatic renewal:
- Frontend calls `pUSD.approve` (or legacy `USDC.e.approve`) via SafeTransaction
- At billing cycle end, the Renewal Lambda calls `transferFrom` to pull funds
- If allowance/balance is insufficient, a 3-day grace period begins with retry every 24h

## Development

### Commands

```bash
npm run dev      # Start dev server (localhost:3000)
npm run build    # Production build
npm start        # Start production server
npm run lint     # ESLint check
```

### Adding a New Page

1. Create `app/your-page/page.tsx` with `'use client'` directive
2. Wrap in `AppShell` (authenticated), `MarketingShell` (public), or `AuthShell` (login)
3. Use existing hooks (`useAuth`, `useSubscription`, `useCurrentPlan`, etc.)
4. Use UI primitives from `components/ui/` (Card, Button, Badge, TierGate, etc.)
5. Style with Tailwind CSS using OKLch token utilities
6. Add to navigation in `constants/navigation.ts`

### Adding a New Hook

1. Create `hooks/useYourHook.ts` with `'use client'` directive
2. Use `useQuery` / `useMutation` from TanStack Query
3. Use `apiClient` for API calls
4. Export from the hooks directory

### Provider Order

Providers are composed in `providers/index.tsx`:

```
AuthProvider → WalletProvider → QueryProvider → WebSocketProvider → TradingProvider
```

Auth must be outermost (other providers need auth state). WebSocket must be inside Query (it invalidates query cache).

## Deployment

### AWS Amplify (Recommended)

Connect your repository to AWS Amplify for automatic deployments with environment variable management.

### Vercel

```bash
vercel deploy
# Set environment variables in Vercel dashboard
```

### Docker

```dockerfile
FROM node:18-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --only=production
COPY . .
RUN npm run build
CMD ["npm", "start"]
```

## Troubleshooting

| Issue | Solution |
|-------|----------|
| Auth not working | Verify `NEXT_PUBLIC_COGNITO_USER_POOL_ID` and `NEXT_PUBLIC_COGNITO_CLIENT_ID` |
| WebSocket won't connect | Check `NEXT_PUBLIC_WS_URL` and that user is authenticated |
| API calls return 401 | Token may be expired - check auto-refresh logic, clear `tw_*` localStorage keys |
| Analysis not appearing | Verify WebSocket is connected (check `useWebSocket().isConnected`) |
| Stripe redirect fails | N/A - Stripe has been replaced with on-chain pUSD payments |
| Credits not updating | TanStack Query cache may be stale - check `useWalletSubscription` staleTime |
| Payment verification fails | Ensure `NEXT_PUBLIC_PLATFORM_WALLET_ADDRESS` matches the backend config |
| Allowance not detected | Check that the Safe address has approved the Platform Wallet on pUSD (or legacy USDC.e) |

## License

MIT. See [../LICENSE](../LICENSE).
