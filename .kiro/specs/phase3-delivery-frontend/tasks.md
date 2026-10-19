# Implementation Plan

## Overview

Phase 3 implements the delivery layer and frontend integration for TradeWizard V2. This connects the backend analysis pipeline (built in Phases 1-2) to end users through real-time WebSocket delivery, email/push/webhook notifications, REST APIs for subscriptions/history/preferences, and a complete Next.js frontend with Cognito auth, analysis request UI, results viewer, and subscription management.

## Tasks

- [x] 1. WebSocket Connect/Disconnect Lambda Handlers
  - [x] 1.1 Create infra/services/ws-connect/handler.ts with JWT validation from query string and DynamoDB PutItem (connectionId, userId, connectedAt, ttl=24h)
  - [x] 1.2 Create infra/services/ws-disconnect/handler.ts with DynamoDB DeleteItem to remove connectionId on disconnect
  - [x] 1.3 Create infra/services/shared/connections.ts with shared connection utilities (storeConnection, removeConnection, getConnectionsByUserId)
  - [x] 1.4 Add unit tests for connection handlers (valid JWT, missing JWT rejection, TTL correctness, disconnect cleanup)

- [x] 2. Analysis Delivery Lambda (WebSocket Push) [depends on: 1]
  - [x] 2.1 Create infra/services/analysis-delivery/handler.ts with SNS event parsing and ApiGatewayManagementApi PostToConnection
  - [x] 2.2 Implement stale connection cleanup (catch 410 Gone from PostToConnection and delete connectionId from DynamoDB)
  - [x] 2.3 Add unit tests for delivery logic (multi-connection fan-out, 410 cleanup, zero-connection graceful skip)

- [x] 3. Email Delivery Lambda (SES) [depends on: 1]
  - [x] 3.1 Create infra/services/email-delivery/handler.ts with SNS event parsing and SES SendTemplatedEmail
  - [x] 3.2 Implement quiet hours checking logic (compare current time against user's quietHoursStart/quietHoursEnd, skip delivery and log if within window)
  - [x] 3.3 Implement notification preferences lookup from RDS (query notification_preferences table, check channelEmail enabled)
  - [x] 3.4 Create SES email template (HTML) for analysis results with market question, recommendation, consensus probability, and result link
  - [x] 3.5 Add unit tests for email delivery logic (quiet hours skip and logging, disabled channel skip, SES failure logging)

- [x] 4. Push Notification Delivery Lambda (SNS Mobile Push) [depends on: 1]
  - [x] 4.1 Create infra/services/push-delivery/handler.ts with SNS event parsing and SNS Mobile Push publish
  - [x] 4.2 Implement notification preferences and plan check (push requires Starter+ plan)
  - [x] 4.3 Implement quiet hours checking logic (skip push during quiet hours)
  - [x] 4.4 Add unit tests for push delivery logic (plan restriction, quiet hours skip, disabled channel skip)

- [x] 5. Webhook Delivery Lambda (EventBridge HTTP Target) [depends on: 1]
  - [x] 5.1 Create infra/services/webhook-delivery/handler.ts with SNS event parsing and HTTP POST to user's webhook_url
  - [x] 5.2 Implement notification preferences and plan check (webhook requires Pro+ plan)
  - [x] 5.3 Implement retry logic (up to 3 retries with exponential backoff on non-2xx responses)
  - [x] 5.4 Record delivery attempts (success/failure) in analysis_deliveries table
  - [x] 5.5 Add unit tests for webhook delivery logic (plan restriction, retry behavior, failure recording)

- [x] 6. Notification Preferences API [depends on: 1]
  - [x] 6.1 Create infra/services/notification-preferences/handler.ts with GET and PUT route handling for /user/notifications
  - [x] 6.2 Implement plan-based channel restriction validation (free=in_app only, starter=in_app+email+push, pro/elite=all channels)
  - [x] 6.3 Implement webhook URL validation (must be HTTPS) and probability shift threshold validation (0.01-1.00)
  - [x] 6.4 Add unit tests for validation logic (plan restrictions return 403, invalid webhook URL rejected, threshold bounds enforced)

- [x] 7. Subscription and Billing API [depends on: 1]
  - [x] 7.1 Create infra/services/subscription-api/handler.ts with route handling (GET /subscriptions, POST /subscriptions, DELETE /subscriptions/{subscriptionId}, POST /credits/purchase, POST /webhooks/stripe)
  - [x] 7.2 Implement Stripe Checkout session creation for plan changes and credit pack purchases (20 credits for $9, 50 credits for $19)
  - [x] 7.3 Implement Stripe webhook signature verification and event processing (checkout.session.completed, customer.subscription.updated, invoice.paid)
  - [x] 7.4 Implement subscription cancellation logic (cancel at period end via Stripe API, update status in RDS)
  - [x] 7.5 Implement billing cycle credit reset logic (reset credits_remaining to plan limit, record credit_transaction)
  - [x] 7.6 Add unit tests for Stripe webhook processing (signature verification, event type routing, credit updates)

- [x] 8. Analysis Results API [depends on: 1]
  - [x] 8.1 Create infra/services/results-api/handler.ts with GET /analysis/history and GET /analysis/{analysisId} route handling
  - [x] 8.2 Implement cursor-based pagination with RDS queries (ordered by delivered_at DESC, limit + cursor token)
  - [x] 8.3 Implement S3 GetObject for full result payload retrieval using result_payload_s3_key
  - [x] 8.4 Implement ownership verification (user can only access their own results, return 404 for unauthorized access)
  - [x] 8.5 Add unit tests for pagination logic and access control (cursor encoding/decoding, ownership check, 404 on missing)

- [x] 9. CDK Infrastructure Updates [depends on: 1, 2, 3, 4, 5, 6, 7, 8]
  - [x] 9.1 Add all new Lambda function definitions to compute-stack.ts (ws-connect, ws-disconnect, analysis-delivery, email-delivery, push-delivery, webhook-delivery, notification-preferences, subscription-api, results-api)
  - [x] 9.2 Add SNS subscriptions (analysis-delivery, email-delivery, push-delivery, and webhook-delivery Lambda subscriptions to Analysis Complete topic)
  - [x] 9.3 Add WebSocket route integrations ($connect to ws-connect Lambda, $disconnect to ws-disconnect Lambda)
  - [x] 9.4 Add REST API route integrations (replace mock integrations with Lambda proxy integrations for notifications, subscriptions, results, credits, and webhook endpoints)
  - [x] 9.5 Add IAM permissions (DynamoDB read/write for connections, SES SendEmail, SNS Publish for mobile push, S3 GetObject for results bucket, API Gateway Management API for PostToConnection, Secrets Manager read for DB and Stripe secrets)
  - [x] 9.6 Add Stripe secret and webhook secret to Secrets Manager references in environment variables

- [x] 10. Frontend Auth Module (Cognito) [depends on: 9]
  - [x] 10.1 Create tradewizard-frontend/lib/cognito-auth.ts with CognitoIdentityProviderClient, InitiateAuth, and RespondToAuthChallenge flows
  - [x] 10.2 Create tradewizard-frontend/providers/AuthProvider.tsx with React context providing auth state and methods
  - [x] 10.3 Create tradewizard-frontend/hooks/useAuth.ts hook exposing user, isAuthenticated, signIn, verifyCode, signOut, getAccessToken
  - [x] 10.4 Update app/layout.tsx to wrap application with AuthProvider
  - [x] 10.5 Create login page/component with email input and Magic Link flow (initiate, check email message, verify code on return)
  - [x] 10.6 Implement token storage (encrypted localStorage or httpOnly cookie) and auto-refresh logic (refresh before expiry, redirect to login on refresh failure)

- [x] 11. Frontend API Client [depends on: 10]
  - [x] 11.1 Create tradewizard-frontend/lib/api-client.ts with typed HTTP methods (get, post, put, delete) and Bearer token injection from auth module
  - [x] 11.2 Implement error handling with typed errors (402 InsufficientCredits, 403 PlanRestriction, 404 NotFound)
  - [x] 11.3 Implement retry logic with exponential backoff for 5xx errors (max 3 retries)
  - [x] 11.4 Add environment configuration for API Gateway base URL (NEXT_PUBLIC_API_BASE_URL)

- [x] 12. Frontend WebSocket Client [depends on: 10, 11]
  - [x] 12.1 Create tradewizard-frontend/lib/websocket-client.ts with WebSocket connection management and exponential backoff reconnection (1s, 2s, 4s, 8s, max 30s)
  - [x] 12.2 Create tradewizard-frontend/hooks/useWebSocket.ts hook exposing isConnected and lastMessage state
  - [x] 12.3 Integrate with TanStack Query cache (invalidate analysis history queries and prepend new results on WebSocket message)
  - [x] 12.4 Add WebSocket provider to app layout (connect on auth, disconnect on logout)
  - [x] 12.5 Implement ping keepalive (send ping frame every 5 minutes to prevent idle timeout)

- [x] 13. Analysis Request Modal [depends on: 11]
  - [x] 13.1 Create tradewizard-frontend/components/analysis/AnalysisRequestModal.tsx with modal structure, market name display, and credit balance
  - [x] 13.2 Implement request type toggle (one-time vs recurring) with plan-aware interval selection (free: none, starter: 1d, pro/elite: 1h, 4h, 12h, 1d)
  - [x] 13.3 Implement API call to POST /v2/analysis with loading states and optimistic credit decrement
  - [x] 13.4 Handle 402 (insufficient credits) response with upgrade prompt linking to subscription page
  - [x] 13.5 Handle 200 cached response (navigate to result detail) and 202 queued response (close modal, show toast)
  - [x] 13.6 Add Get Analysis button to market page that opens the modal

- [x] 14. Analysis Results Viewer [depends on: 11, 12]
  - [x] 14.1 Create tradewizard-frontend/hooks/useAnalysisResults.ts with useInfiniteQuery for paginated history and useQuery for single result detail
  - [x] 14.2 Create tradewizard-frontend/app/analysis/page.tsx (history list page with layout and loading states)
  - [x] 14.3 Create tradewizard-frontend/components/analysis/AnalysisResultCard.tsx (list item with market name, recommendation, probability, confidence, date)
  - [x] 14.4 Create tradewizard-frontend/components/analysis/AnalysisDetail.tsx (full detail view with agent signals, thesis, cross-examination, position sizing)
  - [x] 14.5 Implement infinite scroll pagination using react-intersection-observer and fetchNextPage
  - [x] 14.6 Implement real-time prepend from WebSocket messages (new results appear at top without refresh)
  - [x] 14.7 Add visual indicator for cached vs fresh analyses (badge or icon distinction)

- [x] 15. Subscription Management Page [depends on: 11]
  - [x] 15.1 Create tradewizard-frontend/hooks/useSubscription.ts with useQuery for subscription data and useMutation hooks for plan change, credit purchase, and cancellation
  - [x] 15.2 Create tradewizard-frontend/app/account/subscription/page.tsx with page layout and data fetching
  - [x] 15.3 Create tradewizard-frontend/components/subscription/PlanCard.tsx with plan details, pricing, and selection button
  - [x] 15.4 Implement plan comparison display with all plans (Free, Starter, Pro, Elite) showing pricing, credits, intervals, and current plan highlight
  - [x] 15.5 Implement Stripe Checkout redirect for plan changes (POST /subscriptions then redirect to session URL)
  - [x] 15.6 Implement credit pack purchase flow (display pack options: 20 credits for $9, 50 credits for $19, POST /credits/purchase then redirect to Stripe)
  - [x] 15.7 Implement subscription cancellation with confirmation dialog (DELETE /subscriptions/{id}, show cancellation-at-period-end status)
  - [x] 15.8 Handle Stripe return URLs (parse success/cancel query parameters, refresh subscription data, show confirmation)

- [x] 16. Credit Balance Display [depends on: 11]
  - [x] 16.1 Create tradewizard-frontend/components/Header/CreditBalance.tsx with credit count display and icon
  - [x] 16.2 Integrate with useSubscription hook for credit data (creditsRemaining from subscription query)
  - [x] 16.3 Implement optimistic decrement on analysis request (decrement displayed balance immediately on successful POST)
  - [x] 16.4 Implement warning state when credits reach zero (amber/red visual indicator with link to purchase)
  - [x] 16.5 Add CreditBalance component to Header layout (visible on all authenticated pages)

- [x] 17. Notification Settings UI [depends on: 11]
  - [x] 17.1 Create tradewizard-frontend/hooks/useNotificationPreferences.ts with useQuery and useMutation for GET/PUT /user/notifications
  - [x] 17.2 Create tradewizard-frontend/components/account/NotificationSettings.tsx with form layout and save button
  - [x] 17.3 Implement channel toggle switches with plan-based disabling (gray out channels not available on user's plan)
  - [x] 17.4 Implement quiet hours time pickers (start and end time inputs in HH:MM format)
  - [x] 17.5 Implement probability shift threshold numeric input (0.01 to 1.00 with validation)
  - [x] 17.6 Handle 403 (plan restriction) response with upgrade message indicating required plan
  - [x] 17.7 Add NotificationSettings component to account settings page

## Task Dependency Graph

```json
{
  "waves": [
    {"tasks": [1], "description": "WebSocket connection handlers and shared utilities"},
    {"tasks": [2, 3, 4, 5, 6, 7, 8], "description": "Backend Lambda handlers (parallel)"},
    {"tasks": [9], "description": "CDK infrastructure wiring"},
    {"tasks": [10], "description": "Frontend Cognito auth module"},
    {"tasks": [11], "description": "Frontend API client"},
    {"tasks": [12, 13, 15, 16, 17], "description": "Frontend components (parallel)"},
    {"tasks": [14], "description": "Analysis results viewer (needs WebSocket + API client)"}
  ]
}
```

## Notes

- Tasks 2-8 can be executed in parallel since they all only depend on Task 1
- Tasks 13, 15, 16, 17 can be executed in parallel since they all only depend on Task 11
- Task 14 depends on both Task 11 and Task 12 (needs WebSocket for real-time updates)
- Backend tasks (1-9) should be completed before frontend tasks (10-17)
- The CDK task (9) wires everything together and must wait for all Lambda handlers to be written
- Push delivery (Task 4) uses SNS Mobile Push platform applications configured in notification-stack
- Webhook delivery (Task 5) posts directly to user's configured HTTPS webhook URL
- All delivery channels respect quiet hours and notification preferences from RDS
