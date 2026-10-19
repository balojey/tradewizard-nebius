# TradeWizard V2 Infrastructure

AWS CDK infrastructure for TradeWizard V2 platform. Cost-optimized for pre-revenue stage.

## Architecture

- **Network**: Minimal VPC with public subnets only (no NAT Gateway)
- **Database**: Aurora PostgreSQL Serverless v2 (public endpoint, SSL enforced, auto-scales)
- **Cache/Dedup**: DynamoDB with TTL (replaces ElastiCache Redis)
- **Auth**: Amazon Cognito (passwordless Magic Link support)
- **API**: API Gateway REST + WebSocket with Cognito authorizer
- **Queue**: SQS FIFO (analysis requests) + EventBridge (scheduling)
- **Storage**: S3 (analysis results, agent traces)
- **AI**: AWS Lambda + Strands SDK (TypeScript) for self-hosted multi-agent analysis; Bedrock by default, Nebius Token Factory via `AI_PROVIDER=nebius`
- **Notifications**: SNS (push) + Resend (email; SES retained as explicit fallback)
- **Monitoring**: CloudWatch dashboards + alarms + SNS alerts
- **Payments**: USDC.e on-chain transfers (Polygon) via wallet-based payment model

## Cost Optimization Strategy

This infrastructure is designed for **minimal cost at low volume** while maintaining a clear scale-up path:

| What we removed | Savings | Replacement |
|----------------|---------|-------------|
| NAT Gateway(s) | $35-70/mo | Aurora in public subnet with SSL + strict SG |
| ElastiCache Redis | $12-48/mo | DynamoDB with TTL (pay-per-request) |
| Private/Isolated subnets | $0 (simplicity) | Lambda runs outside VPC |

### Scale-Up Path (when revenue justifies it)

1. Move Aurora to private subnet → add NAT Gateway
2. Increase Aurora max ACU capacity
3. Add ElastiCache Redis for sub-ms dedup lookups
4. Add second NAT Gateway for HA

All changes are config-level - no architecture redesign needed.

## Environments

| Environment | Purpose | Database | DynamoDB | NAT | Deletion Protection |
|-------------|---------|----------|----------|-----|---------------------|
| `development` | Dev/testing | Aurora Serverless v2 (0.5-4 ACU) | Pay-per-request | None | Off |
| `production` | Live traffic | Aurora Serverless v2 (1-16 ACU) + reader | Pay-per-request | None | On |

## Cost Estimates

### Development (~$30-45/mo)
- Aurora Serverless v2 (0.5 ACU min): ~$30-43/mo
- DynamoDB: ~$0-1/mo (pay-per-request, minimal traffic)
- S3 + SQS + Cognito + API GW: ~$0-2/mo
- **Total: ~$30-45/mo**

### Production (~$45-70/mo)
- Aurora Serverless v2 (1 ACU min + reader): ~$43-60/mo
- DynamoDB: ~$1-2/mo
- S3 + SQS + Cognito + API GW + SNS + Resend: ~$2-5/mo
- **Total: ~$45-70/mo**

Bedrock costs are usage-based (~$0.06-$0.13 per analysis execution) on top of infrastructure. If `AI_PROVIDER=nebius`, those inference costs shift to Nebius Token Factory's per-token pricing.

---

## Prerequisites

1. **AWS CLI** configured with appropriate credentials (`aws configure`)
2. **Node.js 18+** installed
3. **CDK CLI** installed: `npm install -g aws-cdk`
4. **PostgreSQL client** (`psql`) for database migrations
5. **Python 3** (used by deploy script to parse Secrets Manager JSON)

> The deploy script checks for prerequisites and gracefully skips steps if optional tools (psql) are missing.

---

## Quick Start

```bash
cd infra
npm install

# Deploy everything (first time - creates wallet/API secrets, stacks, DB, Resend/SES email)
./deploy.sh up dev

# Check status
./deploy.sh status dev

# Tear down everything when done
./deploy.sh down dev
```

The `./deploy.sh up` command automates the entire setup:
1. Creates wallet & API secrets in Secrets Manager (Platform Wallet key, Magic SDK key)
2. Deploys all CDK stacks (including Aurora Serverless v2 + Amplify Hosting)
3. Populates Polymarket CLOB credentials and the Resend API key
4. Runs database migrations (all `sql/*.sql` files in order)
5. Initiates SES email identity verification (retained fallback)
6. Triggers Amplify frontend build

The `./deploy.sh down` command automates the entire teardown:
1. Destroys all CDK stacks
2. Optionally deletes Secrets Manager secrets

---

## Setup Guide (First-Time Deployment)

### Step 1: Install Dependencies

```bash
cd infra
npm install
```

### Step 2: Configure AWS Credentials

Ensure your AWS CLI is configured with credentials that have admin access (or at minimum: CloudFormation, IAM, RDS, DynamoDB, Lambda, API Gateway, Cognito, S3, SQS, SNS, SES, Secrets Manager, EventBridge, Bedrock, CloudWatch permissions).

```bash
aws configure
# Or use a named profile:
export AWS_PROFILE=tradewizard
```

The default region is `us-east-2`. To change it, set `CDK_DEFAULT_REGION`:

```bash
export CDK_DEFAULT_REGION=us-east-1
```

### Step 3: Deploy

```bash
./deploy.sh up dev
```

That's it. The script handles everything else automatically. It will prompt you for the Platform Wallet private key and Magic SDK secret key if they don't already exist in Secrets Manager.

At the end of deployment, the script prints all key outputs (API URL, WebSocket URL, Cognito IDs) and a ready-to-copy `.env.local` block for the frontend.

### CDK Outputs

After deployment, key outputs are printed automatically. You can also retrieve them:

```bash
./deploy.sh status dev
```

| Output | Export Name | Used By |
|--------|-------------|---------|
| User Pool ID | `tw-dev-user-pool-id` | Frontend (Cognito auth) |
| Frontend Client ID | `tw-dev-frontend-client-id` | Frontend (Cognito auth) |
| REST API URL | `tw-dev-api-url` | Frontend (API client) |
| WebSocket URL | `tw-dev-ws-url` | Frontend (real-time delivery) |
| DB Endpoint | `tw-dev-db-endpoint` | Manual DB access |
| DB Secret ARN | `tw-dev-db-secret-arn` | Manual DB access |

---

## Frontend Configuration

The frontend (`tradewizard-frontend`) needs these environment variables in `.env.local`:

```env
# Cognito
NEXT_PUBLIC_COGNITO_USER_POOL_ID=us-east-2_XXXXXXXXX
NEXT_PUBLIC_COGNITO_CLIENT_ID=xxxxxxxxxxxxxxxxxxxxxxxxxx
NEXT_PUBLIC_COGNITO_REGION=us-east-2

# API
NEXT_PUBLIC_API_URL=https://<api-id>.execute-api.us-east-2.amazonaws.com/dev
NEXT_PUBLIC_WS_URL=wss://<ws-api-id>.execute-api.us-east-2.amazonaws.com/dev

# Wallet Payments (USDC.e on Polygon)
NEXT_PUBLIC_PLATFORM_WALLET_ADDRESS=0x...  # Must match PLATFORM_WALLET_ADDRESS in infra config
NEXT_PUBLIC_USDC_CONTRACT_ADDRESS=0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174  # Optional, defaults to this
```

Get these values from the CDK stack outputs after deployment. The `PLATFORM_WALLET_ADDRESS` must be the same address configured in `infra/lib/config.ts`.

---

## Commands

### Deploy (bring everything up)

```bash
# Full deploy (CDK + Wallet/API/Resend secrets + DB + SES - all automated)
./deploy.sh up dev                  # Development environment
./deploy.sh up prod                 # Production environment

# Selective deploy
./deploy.sh up dev --skip-db        # Skip database migration
./deploy.sh up dev --skip-db        # CDK stacks only (fastest)

# npm script shortcuts
npm run deploy:dev               # Full deploy to dev
npm run deploy:prod              # Full deploy to prod
npm run deploy:dev:fast          # CDK-only (skips DB + agents)
npm run deploy:prod:fast         # CDK-only (skips DB + agents)

# Legacy syntax (backwards-compatible)
./deploy.sh dev                  # Same as: ./deploy.sh up dev
./deploy.sh prod                 # Same as: ./deploy.sh up prod
```

### Destroy (tear everything down)

```bash
# Full teardown (empties S3, deletes secrets, destroys stacks)
./deploy.sh down dev                # Development (press Enter to confirm)
./deploy.sh down prod               # Production (type "destroy production" to confirm)
./deploy.sh down dev --force        # Skip confirmation prompt

# npm script shortcuts
npm run destroy:dev              # Destroy dev environment
npm run destroy:prod             # Destroy prod environment
```

### Status (check what's deployed)

```bash
./deploy.sh status dev           # Show all stack statuses, endpoints, secrets
./deploy.sh status prod

npm run status:dev
npm run status:prod
```

### CDK Utilities

```bash
npm run synth:dev                # Synthesize dev CloudFormation templates
npm run synth:prod               # Synthesize prod templates
npm run diff:dev                 # Show pending dev changes
npm run diff:prod                # Show pending prod changes
```

### CDK Utilities

```bash
npm run synth:dev                # Synthesize dev CloudFormation templates
npm run synth:prod               # Synthesize prod templates
npm run diff:dev                 # Show pending dev changes
npm run diff:prod                # Show pending prod changes
```

---

## Stack Structure

```
TradeWizard-{Dev|Prod}-Network       → Minimal VPC, public subnets, security groups
TradeWizard-{Dev|Prod}-Database      → Aurora PostgreSQL Serverless v2, DynamoDB tables (dedup, connections, rate limits)
TradeWizard-{Dev|Prod}-Auth          → Cognito user pool, app clients (frontend + backend), custom auth triggers
TradeWizard-{Dev|Prod}-Storage       → S3 buckets (analysis results, agent traces)
TradeWizard-{Dev|Prod}-Queue         → SQS FIFO queue, DLQ, EventBridge event bus
TradeWizard-{Dev|Prod}-Notification  → SNS topics, retained SES identity, delivery IAM roles
TradeWizard-{Dev|Prod}-Compute       → All Lambda functions, API Gateway (REST + WebSocket), SQS triggers
TradeWizard-{Dev|Prod}-Monitoring    → CloudWatch dashboards, alarms, SNS alerts
```

---

## Lambda Functions

The compute stack deploys 26 Lambda functions (25 in the compute stack + 1 Cognito post-confirmation trigger in the auth stack):

| Function | Entry Point | Trigger | Purpose |
|----------|-------------|---------|---------|
| `analysis-request` | `services/analysis-request/handler.ts` | API Gateway POST | Credit check, dedup, dispatch to SQS |
| `analysis-orchestrator` | `services/analysis-orchestrator/handler.ts` | SQS FIFO | Thin dispatcher - invokes Analysis_Lambda via @aws-sdk/client-lambda, fans out one event per delivered subscriber |
| `analysis-subscriptions` | `services/analysis-subscriptions/handler.ts` | API Gateway GET / DELETE | List and cancel recurring analysis subscriptions; publishes `recurring-analysis.cancelled` |
| `auth-magic-sync` | `services/auth-magic-sync/handler.ts` | API Gateway POST | Magic SDK → Cognito user sync (no Cognito auth on route) |
| `post-confirmation` | `services/post-confirmation/handler.ts` | Cognito post-confirmation trigger | Provisions `users` row + free subscription on signup (deployed by AuthStack) |
| `ws-connect` | `services/ws-connect/handler.ts` | WebSocket $connect | JWT validation, translates cognito sub → users.id, stores connection |
| `ws-disconnect` | `services/ws-disconnect/handler.ts` | WebSocket $disconnect | Remove connection from DynamoDB |
| `analysis-delivery` | `services/analysis-delivery/handler.ts` | SNS + EventBridge (AnalysisFailed) | WebSocket push for completion and failure events |
| `email-delivery` | `services/email-delivery/handler.ts` | SNS | Send analysis email via Resend (SES retained) |
| `system-email-delivery` | `services/system-email-delivery/handler.ts` | SNS (system-notifications) | Send subscription/billing transactional email via Resend (SES retained) |
| `push-delivery` | `services/push-delivery/handler.ts` | SNS | Push notification via SNS Mobile |
| `webhook-delivery` | `services/webhook-delivery/handler.ts` | SNS | HTTP POST to user webhook URLs |
| `notification-preferences` | `services/notification-preferences/handler.ts` | API Gateway | GET/PUT notification settings |
| `subscription-api` | `services/subscription-api/handler.ts` | API Gateway | Wallet subscriptions, credits, payment verification |
| `subscription-renewal` | `services/subscription-renewal/handler.ts` | SQS (EventBridge → SQS) | Automatic renewal via transferFrom; publishes user notifications via SystemNotificationsTopic |
| `results-api` | `services/results-api/handler.ts` | API Gateway | Paginated history, S3 result retrieval |
| `portfolio-activation` | `services/portfolio-activation/handler.ts` | API Gateway POST | Create portfolio sessions, validate prerequisites |
| `portfolio-trade-executor` | `services/portfolio-trade-executor/handler.ts` | EventBridge | Evaluate analysis, size positions, place CLOB orders |
| `portfolio-position-guard` | `services/portfolio-position-guard/handler.ts` | EventBridge Scheduler | Monitor positions, detect regime shifts, trigger exits |
| `portfolio-risk-engine` | `services/portfolio-risk-engine/handler.ts` | EventBridge + API Gateway | Enforce loss limits, kill switch, cooldowns |
| `portfolio-lifecycle` | `services/portfolio-lifecycle/handler.ts` | EventBridge Scheduler + API Gateway | Market resolution, capital depletion, profit target, daily summaries |
| `portfolio-investment` | `services/portfolio-investment/handler.ts` | API Gateway | Investment amount increase/decrease |
| `portfolio-dashboard-api` | `services/portfolio-dashboard-api/handler.ts` | API Gateway | Session list, trades, decisions, stats, persona settings |
| `portfolio-ws-delivery` | `services/portfolio-ws-delivery/handler.ts` | EventBridge | Real-time WebSocket push for portfolio events |
| `portfolio-notification` | `services/portfolio-notification/handler.ts` | EventBridge | Multi-channel (WS / email / push) delivery of portfolio events with quiet-hours overrides |
| `portfolio-analysis-consumer` | `services/portfolio-analysis-consumer/handler.ts` | EventBridge | Pauses portfolio sessions when their recurring analysis subscription is cancelled or paused |

### Lambda Environment Variables

**subscription-api** (Wallet Service):

| Variable | Source | Description |
|----------|--------|-------------|
| `DB_SECRET_ARN` | CDK (Secrets Manager) | Aurora credentials secret ARN |
| `DB_HOST` | CDK (Aurora endpoint) | PostgreSQL hostname |
| `PLATFORM_WALLET_ADDRESS` | `config.ts` / env | TradeWizard receiving wallet for USDC.e payments |
| `USDC_CONTRACT_ADDRESS` | `config.ts` / env | USDC.e contract on Polygon (`0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174`) |
| `POLYGON_RPC_URL` | `config.ts` / env | Polygon JSON-RPC endpoint |
| `SAFE_FACTORY_ADDRESS` | `config.ts` / env | Safe factory for deterministic address derivation |
| `DEDUP_TABLE` | CDK (DynamoDB) | Renewal dedup table name |
| `RENEWAL_QUEUE_ARN` | CDK (SQS) | SQS queue ARN for scheduling renewals |
| `SCHEDULER_ROLE_ARN` | CDK (IAM) | IAM role ARN for EventBridge Scheduler targets |

**subscription-renewal** (Renewal Handler):

| Variable | Source | Description |
|----------|--------|-------------|
| `DB_SECRET_ARN` | CDK (Secrets Manager) | Aurora credentials secret ARN |
| `DB_HOST` | CDK (Aurora endpoint) | PostgreSQL hostname |
| `PLATFORM_WALLET_ADDRESS` | `config.ts` / env | TradeWizard receiving wallet |
| `USDC_CONTRACT_ADDRESS` | `config.ts` / env | USDC.e contract on Polygon |
| `POLYGON_RPC_URL` | `config.ts` / env | Polygon JSON-RPC endpoint |
| `SAFE_FACTORY_ADDRESS` | `config.ts` / env | Safe factory for address derivation |
| `DEDUP_TABLE` | CDK (DynamoDB) | Renewal dedup table name |
| `PLATFORM_WALLET_PRIVATE_KEY_ARN` | CDK (Secrets Manager) | Secret ARN for Platform Wallet private key (for `transferFrom`) |
| `RENEWAL_QUEUE_ARN` | CDK (SQS) | SQS queue ARN for scheduling next renewal |
| `SCHEDULER_ROLE_ARN` | CDK (IAM) | IAM role ARN for EventBridge Scheduler targets |
| `SNS_NOTIFICATION_TOPIC_ARN` | CDK (SNS) | SNS topic for user notifications (renewal failures, reminders) |

**email-delivery / system-email-delivery / portfolio-notification** (Email senders):

| Variable | Source | Description |
|----------|--------|-------------|
| `EMAIL_PROVIDER` | `config.ts` / env | `resend` (default) or `ses` (retained fallback); no automatic fallback between providers |
| `RESEND_API_KEY_SECRET_ARN` | CDK (Secrets Manager) | Secret ARN containing `{"apiKey":"re_..."}` |
| `RESEND_FROM_EMAIL` | env | Resend sender; must be on a domain verified in Resend |
| `RESEND_REPLY_TO` | env | Optional Resend `reply_to` address |
| `SES_FROM_EMAIL` | env | Sender used when `EMAIL_PROVIDER=ses` |
| `APP_URL` | env | Base URL used in email deep links |

**analysis-lambda / portfolio-lambda** (AI provider):

| Variable | Source | Description |
|----------|--------|-------------|
| `AI_PROVIDER` | `config.ts` / env | `bedrock` (default) or `nebius` |
| `NEBIUS_API_KEY_SECRET_ARN` | CDK (Secrets Manager) | Secret ARN containing `{"apiKey":"..."}` |
| `NEBIUS_BASE_URL` | env | OpenAI-compatible endpoint (default `https://api.tokenfactory.nebius.com/v1/`) |
| `NEBIUS_MAX_TOKENS` | env | Default max tokens for Nebius models |
| `NEBIUS_MODEL_<CAPABILITY>` | env | Model ID for `FAST`, `ANALYTICAL`, `AGENTIC`, `REASONING`, `DEEP_REASONING`, `NON_TOOL`, `DEFAULT` |
| `NEBIUS_MODEL_<CAPABILITY>_MAX_TOKENS` | env | Optional per-capability max-token override |

---

## API Routes

### Authenticated (Cognito JWT required)

| Method | Path | Handler | Description |
|--------|------|---------|-------------|
| POST | `/analysis` | analysis-request | Request market analysis |
| GET | `/analysis/history` | results-api | Paginated analysis history |
| GET | `/analysis/{analysisId}` | results-api | Full analysis detail |
| GET | `/analysis/subscriptions` | analysis-subscriptions | List active recurring subscriptions |
| DELETE | `/analysis/subscriptions/{requestId}` | analysis-subscriptions | Cancel a recurring subscription |
| GET | `/subscriptions` | subscription-api | Current plan & credits |
| POST | `/subscriptions` | subscription-api | Verify tx hash and activate plan |
| DELETE | `/subscriptions/{id}` | subscription-api | Cancel subscription |
| POST | `/subscriptions/renew` | subscription-api | Manual renewal (verify tx hash) |
| POST | `/credits/purchase` | subscription-api | Verify tx hash and add credits |
| GET | `/wallet/balance` | subscription-api | Read USDC.e balance from blockchain |
| GET | `/payments/history` | subscription-api | Paginated payment transaction history |
| GET | `/user/notifications` | notification-preferences | Get notification settings |
| PUT | `/user/notifications` | notification-preferences | Update notification settings |
| GET | `/markets` | (mock) | List markets |
| GET | `/markets/{marketId}` | (mock) | Market detail |
| GET | `/credits` | (mock) | Credit balance |

### Unauthenticated

| Method | Path | Handler | Description |
|--------|------|---------|-------------|
| GET | `/health` | (mock) | Health check |

### Portfolio Manager (Authenticated)

| Method | Path | Handler | Description |
|--------|------|---------|-------------|
| POST | `/portfolio/sessions` | portfolio-activation | Activate portfolio manager on a market |
| GET | `/portfolio/sessions` | portfolio-dashboard-api | List all user sessions |
| GET | `/portfolio/sessions/{id}` | portfolio-dashboard-api | Session detail with full stats |
| DELETE | `/portfolio/sessions/{id}` | portfolio-lifecycle | Stop session (exit positions) |
| PUT | `/portfolio/sessions/{id}/pause` | portfolio-dashboard-api | Pause session (halt new entries) |
| PUT | `/portfolio/sessions/{id}/resume` | portfolio-dashboard-api | Resume paused session |
| PUT | `/portfolio/sessions/{id}/investment` | portfolio-investment | Update investment amount |
| GET | `/portfolio/sessions/{id}/investment` | portfolio-investment | Get capital breakdown |
| GET | `/portfolio/sessions/{id}/trades` | portfolio-dashboard-api | Paginated trade history |
| GET | `/portfolio/sessions/{id}/decisions` | portfolio-dashboard-api | Paginated decision log |
| GET | `/portfolio/stats` | portfolio-dashboard-api | Aggregate portfolio statistics |
| PUT | `/portfolio/settings/persona` | portfolio-dashboard-api | Update persona selection |
| GET | `/portfolio/settings/persona` | portfolio-dashboard-api | Get current persona config |
| POST | `/portfolio/kill-switch` | portfolio-risk-engine | Trigger global kill switch |
| DELETE | `/portfolio/kill-switch` | portfolio-risk-engine | Reset kill switch |

---

## Database

### Aurora PostgreSQL Serverless v2

- **Cluster**: Aurora Serverless v2 (auto-scales ACUs based on load)
- **Database name**: `tradewizard`
- **Username**: `tradewizard`
- **Password**: Auto-generated, stored in Secrets Manager (`tw-{env}-db-credentials`)
- **SSL**: Enforced (`rds.force_ssl = 1`)
- **Public access**: Yes (secured by security group + SSL)
- **Dev capacity**: 0.5–4 ACUs (scales down when idle)
- **Prod capacity**: 1–16 ACUs + read replica

### Schema

The full schema is in `sql/001-initial-schema.sql`. Key tables:

| Table | Purpose |
|-------|---------|
| `users` | User accounts (synced from Cognito) |
| `subscriptions` | Active plan, credits, wallet address, billing cycle, grace period |
| `credit_transactions` | Immutable audit trail of all credit changes (plan + credit_pack) |
| `payment_transactions` | On-chain USDC.e payment history (subscription, renewal, credit pack) |
| `markets` | Cached market metadata from Polymarket |
| `analysis_requests` | User analysis requests (one-time + recurring) |
| `market_analysis_schedule` | Internal dedup schedule per market |
| `market_subscribers` | Which users subscribe to which market |
| `analysis_results` | Completed analysis metadata |
| `analysis_deliveries` | Delivery log (who got what, cached vs fresh) |
| `agent_memory` | Historical agent signals for closed-loop learning |
| `agent_performance` | Agent accuracy leaderboard |
| `notification_preferences` | Per-user notification channel settings |
| `portfolio_manager_sessions` | Autonomous trading sessions (status, position, capital, risk state) |
| `portfolio_manager_trades` | Trade records (entries, exits, stop-loss, take-profit) |
| `portfolio_manager_decisions` | Decision log (analysis-to-action with reasoning) |

Portfolio manager schema is in `sql/003-portfolio-manager.sql` and adds:
- `portfolio_persona_id` and `portfolio_persona_params` columns to `users` table
- Partial unique index ensuring one active session per user per market
- Indexes for efficient session/trade/decision queries

### Manual Database Access

```bash
# Get credentials
DB_ENDPOINT=$(aws cloudformation describe-stacks \
  --stack-name "TradeWizard-Dev-Database" \
  --query "Stacks[0].Outputs[?ExportName=='tw-dev-db-endpoint'].OutputValue" \
  --output text)

SECRET_ARN=$(aws cloudformation describe-stacks \
  --stack-name "TradeWizard-Dev-Database" \
  --query "Stacks[0].Outputs[?ExportName=='tw-dev-db-secret-arn'].OutputValue" \
  --output text)

DB_PASSWORD=$(aws secretsmanager get-secret-value \
  --secret-id "$SECRET_ARN" \
  --query "SecretString" \
  --output text | python3 -c "import sys,json; print(json.load(sys.stdin)['password'])")

# Connect
PGPASSWORD="$DB_PASSWORD" psql "host=$DB_ENDPOINT dbname=tradewizard user=tradewizard sslmode=require"
```

### Running Migrations Manually

```bash
PGPASSWORD="$DB_PASSWORD" psql \
  "host=$DB_ENDPOINT dbname=tradewizard user=tradewizard sslmode=require" \
  -f sql/001-initial-schema.sql
```

> **Note**: The schema uses `CREATE TABLE` without `IF NOT EXISTS`. Re-running on an existing database will show errors for already-existing tables - this is safe and expected.

### DynamoDB Tables

| Table | Partition Key | Sort Key | TTL | Purpose |
|-------|--------------|----------|-----|---------|
| `tw-{env}-dedup-cache` | `marketId` (S) | `executedAt` (S) | `ttl` | Analysis dedup cache |
| `tw-{env}-ws-connections` | `connectionId` (S) | - | `ttl` | WebSocket connection tracking |
| `tw-{env}-rate-limits` | `pk` (S) | `sk` (S) | `ttl` | Rate limiting counters |
| `tw-{env}-renewal-dedup` | `pk` (S) | - | `ttl` | Subscription renewal idempotency |

The connections table has a GSI (`userId-index`) for looking up all connections by user. The `userId` stored here is the **internal `users.id` UUID** (not the Cognito sub) - see "User Identity Convention" below.

The renewal-dedup table stores `{subscription_id}#{billing_cycle_end_iso}` as the partition key with a 7-day TTL to prevent duplicate renewal charges from EventBridge Scheduler retries.

The rate-limits table also stores kill-switch state (`pk = kill_switch#{userId}`, `sk = state`) and per-session distributed locks (`pk = session_lock#{sessionId}`, `sk = lock`) used by the portfolio Lambdas. All writes use `userId = users.id` (UUID), never the Cognito sub.

---

## User Identity Convention

The platform stores users with two distinct identifiers:

- `users.cognito_sub` (TEXT, UNIQUE) - Cognito's user identifier from the JWT `sub` claim.
- `users.id` (UUID, PRIMARY KEY) - internal identifier referenced by every foreign key in the schema (`subscriptions.user_id`, `notification_preferences.user_id`, `portfolio_manager_sessions.user_id`, etc.).

**Cross-service contracts use `users.id`, not the Cognito sub.** This includes:

- WebSocket connection records in DynamoDB (`tw-{env}-ws-connections.userId`)
- EventBridge events emitted by the orchestrator and portfolio Lambdas
- SNS payloads consumed by email / push / webhook delivery handlers
- Kill-switch and session-lock keys in the rate-limits table

The translation happens at the boundary where a Cognito sub first enters the system:

- API Gateway routes use Cognito JWT auth; handlers call `getUserIdByCognitoSub(claims.sub)` from `services/shared/db.ts` to resolve the internal id before any Aurora / SNS / EventBridge work.
- The `ws-connect` Lambda translates `payload.sub` → `users.id` and stores the internal id in the connections table.
- The `analysis-orchestrator` Lambda translates the requesting user's sub → `users.id` and emits one EventBridge event per delivered subscriber (each with the canonical `users.id`), so SNS fan-out reaches the right user.

This means delivery handlers can do `WHERE notification_preferences.user_id = $1::uuid` directly with the value from the SNS message - no per-handler translation needed.

---

## Event Flow Reference

### Analysis pipeline

```
POST /analysis (API GW, Cognito-auth)
  → analysis-request (Aurora credit check, DDB dedup, SQS dispatch)
  → SQS analysisQueue (FIFO, MessageGroupId = marketId)
  → analysis-orchestrator (Lambda invoke → Analysis_Lambda Strands SDK workflow)
  → S3 + Aurora analysis_results
  → EventBridge AnalysisCompleted (one event per delivered subscriber)
       ├→ SNS analysisCompleteTopic
       │    ├→ analysis-delivery (WebSocket push)
       │    ├→ email-delivery (Resend/SES)
       │    ├→ push-delivery (SNS Mobile)
       │    └→ webhook-delivery (HTTP POST)
       └→ portfolio-trade-executor (matches sessions for this user/market)
  → EventBridge AnalysisFailed (on error)
       └→ SNS analysisCompleteTopic (delivery handlers detect detail-type='AnalysisFailed')
            ├→ analysis-delivery (WS failure notice)
            ├→ email-delivery (failure email template)
            ├→ push-delivery (short failure push)
            └→ webhook-delivery (POST { event: 'analysis_failed' })
```

### Portfolio Manager pipeline

```
analysis-complete event
  → portfolio-trade-executor (kill-switch → cooldown → lock → Portfolio_Lambda → CLOB order)
  → publishes portfolio.trade.executed (Source: tradewizard.portfolio-manager)

EventBridge Scheduler (per-session, persona interval)
  → portfolio-position-guard (kill-switch → lock → Portfolio_Lambda exit eval → CLOB exit)
  → publishes portfolio.position.exited

EventBridge rate-rule (every 5/10/15 min, daily 00:00 UTC)
  → portfolio-lifecycle (resolution check / capital check / profit-target check / daily summary)
  → publishes portfolio.session.terminated, portfolio.session.daily-summary, etc.

REST POST /portfolio/kill-switch (or cross-session loss limit hit)
  → portfolio-risk-engine (executes kill switch, exits all positions, sets DDB state)
  → publishes portfolio.kill_switch.triggered, portfolio.risk.alert

All portfolio.* events fan out via two EventBridge rules:
  → portfolio-ws-delivery (real-time WebSocket push)
  → portfolio-notification (multi-channel: WS, email, push - with quiet-hours overrides)

portfolio-trade-executor + portfolio-position-guard publishers also feed
the risk engine via PortfolioTradeEventRule for cross-session loss tracking.
```

### Subscription lifecycle

When a user cancels their recurring analysis subscription via `DELETE /analysis/subscriptions/{requestId}` (handled by `analysis-subscriptions`), the handler:

1. Marks `analysis_requests.status = 'cancelled'` and unsubscribes the user from `market_subscribers`.
2. Deletes the EventBridge schedule **only** if no other active recurring subscribers remain on the same `(market, interval)` pair (schedules are shared across users).
3. Publishes `recurring-analysis.cancelled` (Source: `tradewizard.analysis`) so `portfolio-analysis-consumer` pauses any portfolio session tied to that market.

The renewal Lambda also publishes trial-expiry, renewal-reminder/failure, and downgrade notices to the `system-notifications` SNS topic. The `system-email-delivery` Lambda consumes that topic and sends the transactional account email through the shared Resend/SES sender. These notices bypass quiet hours and plan restrictions, and are sent whenever the user has no saved preferences or has left the email channel enabled.

---

## Cognito Configuration

### User Pool

- **Sign-in**: Email only
- **Verification**: Email auto-verified
- **Custom auth**: Enabled (for Magic Link passwordless flow)
- **MFA**: Off in dev, optional in prod (TOTP)
- **Password policy**: 8+ chars, upper + lower + digits
- **Account recovery**: Email only

### App Clients

| Client | Name | Auth Flows | Secret | Purpose |
|--------|------|-----------|--------|---------|
| Frontend | `tw-{env}-frontend-client` | SRP + Custom | No | Browser-based auth |
| Backend | `tw-{env}-backend-client` | Admin + Custom | Yes | Server-side operations |

### OAuth Callback URLs

- **Development**: `http://localhost:3000/auth/callback`, `https://dev.tradewizard.io/auth/callback`
- **Production**: `https://tradewizard.io/auth/callback`

### Custom Auth (Magic Link) Flow

The Cognito user pool is configured with `custom: true` auth flow to support passwordless Magic Link. The custom auth Lambda triggers (Define, Create, Verify challenge) need to be deployed separately and attached to the user pool. These are not yet included in the CDK stacks.

---

## Wallet Payment Integration

### Architecture

```
Frontend → relayClient.execute(SafeTx: USDC.e.transfer(PlatformWallet, amount))
  → On-chain transfer confirmed → txHash returned
  → Frontend POSTs txHash to /subscriptions or /credits/purchase
  → Lambda (subscription-api) verifies on-chain transfer
  → On verification success: updates Aurora (plan + credits)
```

### Secrets (AWS Secrets Manager)

| Secret Name | Content | Created By |
|-------------|---------|-----------|
| `tw-{env}-db-credentials` | `{"username":"tradewizard","password":"..."}` | CDK (auto-generated) |
| `tw-{env}-platform-wallet-key` | Private key for Platform Wallet (for renewal `transferFrom`) | **deploy.sh** (Step 1) |
| `tw-{env}-magic-secret-key` | Magic SDK secret key for wallet auth | **deploy.sh** (Step 1) |
| `tw-{env}-clob-credentials` | `{"apiUrl","apiKey","apiSecret","apiPassphrase"}` for Polymarket CLOB | CDK creates the resource shell, **deploy.sh** (Step 3) populates the value from `CLOB_API_*` env vars |
| `tw-{env}-resend-api-key` | `{"apiKey":"re_..."}` for Resend transactional email | CDK creates the resource shell, **deploy.sh** (Step 3) populates the value from `RESEND_API_KEY` |
| `tw-{env}-nebius-api-key` | `{"apiKey":"..."}` for Nebius Token Factory | CDK creates the resource shell, **deploy.sh** (Step 3) populates the value from `NEBIUS_API_KEY` |

### Automatic Renewals

The Renewal Lambda uses the Platform Wallet private key to call `transferFrom` on the USDC.e contract when users have pre-approved an ERC-20 allowance. This is the only backend-initiated on-chain transaction.

### Polymarket CLOB Credentials

The five Portfolio Manager Lambdas (trade-executor, position-guard, risk-engine, lifecycle, dashboard-api) lazy-load CLOB credentials from `tw-{env}-clob-credentials` via `services/shared/clob-credentials.ts`. The handlers fail-safe: if the secret is empty, they log an error and refuse to place or cancel orders rather than shipping unsigned requests.

Populate the secret either by setting `CLOB_API_KEY`, `CLOB_API_SECRET`, `CLOB_API_PASSPHRASE` (and optionally `CLOB_API_URL`) in `.env.dev` / `.env.prod` and re-running `./deploy.sh up`, or manually:

```bash
aws secretsmanager put-secret-value \
  --secret-id tw-dev-clob-credentials \
  --secret-string '{"apiUrl":"https://clob.polymarket.com","apiKey":"...","apiSecret":"...","apiPassphrase":"..."}'
```

### Resend Email Delivery

Transactional email is sent through Resend by default. SES is retained for future use and can be selected explicitly with `EMAIL_PROVIDER=ses` (subject to SES sandbox restrictions). All three email senders (`email-delivery`, `system-email-delivery`, `portfolio-notification`) go through `services/shared/email.ts`, so there are no direct SES or Resend calls elsewhere.

One-time setup:

1. Add and verify your sending domain at https://resend.com/domains (DNS records for SPF/DKIM). `tradewizard.live` is the expected production domain.
2. Create an API key at https://resend.com/api-keys. "Sending access" is sufficient; a full-access key is only needed to manage domains via the API.
3. Add the key to `.env.dev` / `.env.prod` as `RESEND_API_KEY=re_...`, set `RESEND_FROM_EMAIL` (default `notifications@tradewizard.live`), and deploy with `./deploy.sh up dev`.
4. deploy.sh stores the key in `tw-{env}-resend-api-key`; the raw key is never injected into Lambda environment variables.

For a quick test without a verified domain, set `RESEND_FROM_EMAIL=onboarding@resend.dev`. Resend only delivers that sender to the email address on the Resend account.

Troubleshooting:

- `Resend send failed (403): ... domain is not verified` — verify the domain that matches `RESEND_FROM_EMAIL`.
- `Resend send failed (401)` — the key is invalid or was deleted/rotated; update `RESEND_API_KEY` and redeploy (the Lambda key cache expires after 5 minutes).
- `Resend API key is not configured` — the secret is empty or Step 3 was skipped; populate `tw-{env}-resend-api-key`.
- `Resend send failed (429)` — daily/monthly quota or rate limit reached; check the Resend usage dashboard.

### AI Provider (Bedrock / Nebius)

`AI_PROVIDER=bedrock` is the default and preserves the existing model routing. `AI_PROVIDER=nebius` routes every analysis and portfolio model call through Nebius Token Factory's OpenAI-compatible API. The switch covers inference only; Polymarket order execution stays in `portfolio-trade-executor` and the risk/lifecycle Lambdas.

Nebius setup:

1. Create an API key at https://tokenfactory.nebius.com/project/api-keys.
2. Add `NEBIUS_API_KEY=...` to `.env.dev` / `.env.prod`. deploy.sh stores it in `tw-{env}-nebius-api-key`.
3. Discover valid model IDs and verify function calling:

```bash
cd infra
set -a; source .env.dev; set +a
npx tsx scripts/validate-nebius.ts
```

4. The validated capability mapping is already set in `.env.example`, `.env.dev`, and `.env.prod`:

| Capability | Env var | Model | Used by | Tool calling |
|---|---|---|---|---|
| `fast` | `NEBIUS_MODEL_FAST` | `Qwen/Qwen3-30B-A3B-Instruct-2507` | market_microstructure, probability_baseline, momentum | Required |
| `analytical` | `NEBIUS_MODEL_ANALYTICAL` | `Qwen/Qwen3-235B-A22B-Instruct-2507` | risk_assessment, polling_intelligence, mean_reversion | Required |
| `agentic` | `NEBIUS_MODEL_AGENTIC` | `nvidia/nemotron-3-super-120b-a12b` | breaking_news, event_impact, historical_patterns, web_research | Required |
| `reasoning` | `NEBIUS_MODEL_REASONING` | `openai/gpt-oss-120b` | media_sentiment, social_sentiment, narrative_velocity | Required |
| `deep_reasoning` | `NEBIUS_MODEL_DEEP_REASONING` | `deepseek-ai/DeepSeek-V4-Pro` | catalyst_identification, tail_risk | Required |
| `non_tool` | `NEBIUS_MODEL_NON_TOOL` | `moonshotai/Kimi-K3` | thesis, cross-exam, risk philosophy, recommendation | Not used |
| `default` | `NEBIUS_MODEL_DEFAULT` | `MiniMaxAI/MiniMax-M3` | portfolio persona decisions | Required |

All tool-requiring capabilities were verified against the live catalog and returned `tool_calls`. Re-run the validator after catalog changes.

5. Set `AI_PROVIDER=nebius` and deploy. The analysis and portfolio Lambdas fail fast at cold start if a required `NEBIUS_MODEL_*` is missing.

The validation script checks that each configured ID exists in `/v1/models`, that every tool-using capability actually returns a `tool_calls` response, and that the model can emit JSON that `extractJson` can parse. Nebius rate limits are dynamic and account-level; if the 14 parallel agents trigger 429s, add a concurrency cap or stagger agent starts.

Rollback: set `AI_PROVIDER=bedrock` and redeploy (or update the Lambda environment variable in the console).

Note: this does not make the platform AWS-independent. Lambda, RDS, S3, SQS, EventBridge, and Polymarket execution still run in AWS; it only removes the Bedrock dependency for model inference.

---

## Post-Deployment

The `./deploy.sh up` script handles the full deployment automatically in 6 steps:

1. **Wallet & API Secrets** - Creates/verifies Secrets Manager entries for Platform Wallet private key and Magic SDK secret key
2. **CDK Deploy** - Deploys all CloudFormation stacks (Network, Database, Auth, Storage, Queue, Notification, Compute, Monitoring) - including the empty `tw-{env}-clob-credentials`, `tw-{env}-resend-api-key`, and `tw-{env}-nebius-api-key` secret resources
3. **API Credentials** - Populates the CLOB, Resend, and Nebius secrets from env vars; logs a warning with the manual command if env vars aren't provided
4. **Database Migration** - Runs all `sql/*.sql` files in order (001, 002, etc.) via `psql`
5. **SES Email Verification** - Initiates email identity verification for the retained SES fallback
6. **Amplify Frontend Build** - Triggers a frontend build so CDK-provisioned env vars take effect

---

## Deploy Script Reference

```
Usage: ./deploy.sh [up|down|status] [dev|prod] [flags]

Actions:
  up        Deploy all infrastructure
  down      Destroy all infrastructure
  status    Show current deployment status (stacks, secrets, endpoints)

Flags (for 'up' only):
  --skip-db         Skip database migration (Step 4)

Flags (for 'down' only):
  --force           Skip confirmation prompts (dangerous for prod!)

Legacy (backwards-compatible):
  ./deploy.sh dev   → same as ./deploy.sh up dev
  ./deploy.sh prod  → same as ./deploy.sh up prod

Examples:
  ./deploy.sh up dev                                    # Full first-time deploy
  ./deploy.sh up dev --skip-db                          # Skip DB migration
  ./deploy.sh up prod                                   # Full production deploy
  ./deploy.sh down dev                                  # Tear down dev (with confirmation)
  ./deploy.sh down dev --force                          # Tear down dev (no confirmation)
  ./deploy.sh status dev                                # Check what's deployed
```

---

## Deployment Steps (up)

The `./deploy.sh up` command runs 6 steps sequentially:

| Step | Name | What it does |
|------|------|-------------|
| 1 | `wallet-secrets` | Creates Platform Wallet private key and Magic SDK secret key in AWS Secrets Manager. Prompts for values if secrets don't already exist. The Platform Wallet key enables the Renewal Lambda to call `transferFrom` on the USDC.e contract for automatic subscription renewals. |
| 2 | `cdk` | Runs `cdk synth` then `cdk deploy --all`. Deploys all CloudFormation stacks (Network, Database, Auth, Storage, Queue, Notification, Compute, Monitoring) and creates the empty `tw-{env}-clob-credentials`, `tw-{env}-resend-api-key`, and `tw-{env}-nebius-api-key` secret resources. This is the longest step (~3-5 min first time, ~1-2 min on updates). |
| 3 | `api-credentials` | Populates the `tw-{env}-clob-credentials` secret from `CLOB_API_KEY`, `CLOB_API_SECRET`, `CLOB_API_PASSPHRASE`, the `tw-{env}-resend-api-key` secret from `RESEND_API_KEY`, and the `tw-{env}-nebius-api-key` secret from `NEBIUS_API_KEY` when present. Logs a manual `aws secretsmanager put-secret-value` command if env vars are missing. The Portfolio Manager Lambdas refuse to trade until CLOB is populated, email delivery fails until the Resend key is populated (when `EMAIL_PROVIDER=resend`), and `AI_PROVIDER=nebius` fails until its key/models are configured. |
| 4 | `db` | Runs all PostgreSQL schema migrations (`sql/*.sql` files in order: 001, 002, etc.) against the Aurora cluster. Uses `psql` if available, otherwise falls back to Node.js `pg` client. Safe to re-run (uses IF NOT EXISTS / IF EXISTS guards). |
| 5 | `ses` | Initiates SES email identity verification for the retained fallback sender. In development, also verifies the sender email for SES sandbox mode. |
| 6 | `amplify` | Triggers an Amplify frontend build so CDK-provisioned environment variables take effect. |

### Step Dependencies

- Step 1 must run before Step 2 (CDK needs wallet secrets to exist for the subscription and renewal Lambdas)
- Step 2 must run before Steps 3, 4, 5, 6 (they need stack outputs: secret ARN, DB endpoint, API URL)
- Steps 3, 4, 5 run independently after Step 2; Step 6 is last

### First-Time Deploy Order

```
./deploy.sh up dev          # Runs all 6 steps in order
```

### Subsequent Deploys (after code changes)

```
./deploy.sh up dev --skip-db --skip-agents  # CDK stacks only (fastest)
```

---

## Teardown Steps (down)

The `./deploy.sh down` command performs:

| Step | What it does |
|------|-------------|
| 1 | Runs `cdk destroy --all --force` (removes all CloudFormation stacks) |
| 2 | Optionally deletes Secrets Manager secrets (Platform Wallet key, Magic SDK key, CLOB credentials, DB credentials) with no recovery |

For production, you must type the environment name to confirm. Use `--force` to skip confirmation (not recommended for prod).

---

## Resource Naming Convention

All resources follow the pattern: `tw-{env}-{name}`

- Development: `tw-dev-analysis-request`, `tw-dev-postgres`, `tw-dev-dedup-cache`
- Production: `tw-prod-analysis-request`, `tw-prod-postgres`, `tw-prod-dedup-cache`

Defined in `lib/config.ts` via the `resourceName()` helper.

---

## Self-Hosted Agent Lambdas

The analysis and portfolio agent logic is implemented as TypeScript Lambda functions using the Strands Agents SDK (no external runtime dependency):

### Analysis Lambda (`services/analysis-lambda/`)
- `handler.ts` - 11-stage analysis workflow entry point
- `stages/intelligence-agents.ts` - 14 parallel agent definitions with system prompts
- `stages/` - All workflow stages (data-preparation, web-research, signal-fusion, thesis, consensus, etc.)
- `tools/` - Strands tools (news, search, shell, tool-factory)
- `lib/` - Utilities (model, multi-model, json-extractor, types)

### Portfolio Lambda (`services/portfolio-lambda/`)
- `handler.ts` - Portfolio manager entry point (persona agent + decision parsing)
- `personas.ts` - 6 persona system prompts + exit evaluation addendum
- `tools/` - 7 read-only Strands tools (market data, order book, analysis, history, performance, agent accuracy)
- `lib/` - Utilities (model, json-extractor, types)

Both Lambdas are bundled and deployed as CDK NodejsFunction resources. The `analysis-orchestrator` Lambda invokes `analysis-lambda` via `@aws-sdk/client-lambda`. Portfolio Lambdas (`portfolio-trade-executor`, `portfolio-position-guard`) invoke `portfolio-lambda` the same way.

---

## Security Notes

- **Aurora PostgreSQL** is publicly accessible but protected by:
  - SSL/TLS enforced at the database level (`rds.force_ssl = 1`)
  - Strong auto-generated password in Secrets Manager (32 chars, no punctuation)
  - Security group (can be tightened to specific IPs)
- **DynamoDB** tables use AWS-managed encryption at rest
- **S3** buckets block all public access
- **API Gateway** uses Cognito JWT authorization on all routes except `/health`
- **On-chain verification** ensures all payments are validated against the blockchain before activation
- **Bedrock IAM roles** follow least-privilege principle
- **Secrets** are never hardcoded - all sensitive values in Secrets Manager
- **Lambda** functions run outside VPC (no VPC attachment needed since Aurora is public)

---

## Troubleshooting

### CDK deploy fails with "bootstrap required"

```bash
npx cdk bootstrap -c env=development
```

### Database migration fails with "connection refused"

Check that your IP is allowed by the Aurora security group. By default, the security group allows all inbound on port 5432 (for Lambda access). If you've tightened it, add your IP.

### Payment verification fails

1. Check that the transaction hash is valid and confirmed on Polygon
2. Verify the sender address matches the user's registered Trading Wallet (Safe)
3. Check CloudWatch logs for the `tw-{env}-subscription-api` Lambda
4. Ensure the USDC.e contract address and Platform Wallet address are correctly configured

### Analysis Lambda timeout or errors

1. Check CloudWatch logs for the `tw-{env}-analysis-lambda` Lambda
2. Verify `BEDROCK_MODEL_ID` and `AWS_REGION` environment variables are set correctly
3. Check IAM permissions for Bedrock model invocation
4. Ensure `DB_SECRET_ARN` and `DB_HOST` environment variables are configured
5. Check Bedrock service quotas for the target region
6. If `AI_PROVIDER=nebius`, verify the `NEBIUS_MODEL_*` env vars, the `tw-{env}-nebius-api-key` secret, and run `npx tsx scripts/validate-nebius.ts`

### WebSocket connections not working

1. Verify the WebSocket URL from CDK outputs (`tw-{env}-ws-url`)
2. Check the `tw-{env}-ws-connect` Lambda logs for JWT validation errors
3. Ensure the Cognito token is passed as a query parameter: `?token=<jwt>`

### Credits not updating after payment

1. Check `tw-{env}-subscription-api` Lambda logs for payment verification
2. Verify the on-chain transfer was confirmed and matches expected amount
3. Check the `credit_transactions` table for the audit trail
