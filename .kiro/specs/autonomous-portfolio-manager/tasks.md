# Implementation Plan: Autonomous Portfolio Manager

## Overview

This plan implements the Autonomous Portfolio Manager feature incrementally: database schema first, then shared utilities and core services (activation, trade execution, risk engine, position guard, lifecycle), then REST API and WebSocket integration, then frontend (dashboard, persona settings, activation modal), and finally advanced features like the full risk engine and position guard monitoring.

All Lambda handlers follow the existing pattern in `infra/services/` with shared utilities in `infra/services/shared/`. Frontend components follow the Next.js App Router pattern with hooks in `hooks/` and pages in `app/`.

## Tasks

- [x] 1. Database schema and shared utilities
  - [x] 1.1 Create PostgreSQL migration for portfolio manager tables
    - Create `infra/sql/003-portfolio-manager.sql` with the three new tables: `portfolio_manager_sessions`, `portfolio_manager_trades`, `portfolio_manager_decisions`
    - Include all indexes, constraints, triggers, and the partial unique constraint on `(user_id, market_id)` for active sessions
    - Add `portfolio_persona_id` and `portfolio_persona_params` columns to the `users` table
    - _Requirements: 1.7, 2.1, 4.9, 10.5_

  - [x] 1.2 Create shared portfolio manager types and interfaces
    - Create `infra/services/shared/portfolio-types.ts` with TypeScript interfaces: `Persona`, `PortfolioSession`, `PortfolioTrade`, `PortfolioDecision`, `ConvictionScore`, and all related types from the design document
    - Include Zod schemas for request/response validation
    - _Requirements: 2.1, 4.2, 10.5_

  - [x] 1.3 Create persona registry module
    - Create `infra/services/shared/persona-registry.ts` defining all 6 personas (Sniper, Scalper, Contrarian, Catalyst Hunter, Hedge Architect, Momentum Rider) with their entry rules, sizing rules, exit rules, and monitoring rules
    - Include risk level classification (Conservative, Moderate, Aggressive)
    - Include default parameter values and Elite customization ranges
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 3.3, 3.4_

  - [x] 1.4 Create shared database query helpers for portfolio manager
    - Create `infra/services/shared/portfolio-db.ts` with functions for: session CRUD, trade recording, decision logging, capital tracking updates, and session statistics aggregation
    - All queries must use parameterized SQL to prevent injection
    - _Requirements: 1.7, 4.9, 7.7, 10.5_

  - [ ]* 1.5 Write property test for capital conservation invariant
    - **Property 1: Capital Conservation**
    - Generate random sequences of trades (entries, exits, partial fills) and verify that `amount_in_positions + amount_in_pending_orders + amount_available` never exceeds `investment_amount` after each operation
    - **Validates: Requirements 6.5, 6.6, 6.7**

- [x] 2. Checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 3. Portfolio activation service
  - [x] 3.1 Implement portfolio-activation Lambda handler
    - Create `infra/services/portfolio-activation/handler.ts`
    - Implement all activation validations: subscription check (Pro/Elite), concurrent session limit (3 Pro / 10 Elite), wallet balance verification, recurring analysis subscription check, market not resolved, no existing active session for that market
    - On success: insert session record, snapshot persona config, create EventBridge Scheduler rule for position guard at persona's monitoring interval
    - Return 201 with session ID and status
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 1.7, 1.8, 1.9, 1.10, 1.11_

  - [ ]* 3.2 Write property test for session uniqueness
    - **Property 2: Session Uniqueness**
    - Generate random activation sequences for the same user/market and verify at most one active session exists per user per market at any time
    - **Validates: Requirements 1.10, 1.11**

  - [ ]* 3.3 Write property test for concurrent session limits
    - **Property 4: Concurrent Session Limits**
    - Generate random activation/termination sequences and verify Pro users never exceed 3 active sessions and Elite users never exceed 10
    - **Validates: Requirements 1.5, 1.6**

  - [ ]* 3.4 Write unit tests for activation validation logic
    - Test each rejection path: wrong plan, session limit exceeded, insufficient balance, no recurring analysis, resolved market, duplicate session
    - Test successful activation creates session with correct persona snapshot
    - _Requirements: 1.1–1.11_

- [x] 4. Conviction score and trade execution service
  - [x] 4.1 Implement conviction score calculation module
    - Create `infra/services/shared/conviction-score.ts`
    - Implement weighted formula: consensusConfidence (0.4) + edgeMagnitude (0.35) + signalAlignment (0.25) producing a 0.0–1.0 score
    - Include position sizing calculation that maps conviction score to allocation within persona's min/max range
    - _Requirements: 4.2, 4.3_

  - [x] 4.2 Implement portfolio-trade-executor Lambda handler
    - Create `infra/services/portfolio-trade-executor/handler.ts`
    - Triggered by EventBridge analysis-complete events for markets with active sessions
    - Load session + persona config, check kill switch state (DynamoDB), evaluate persona entry criteria against analysis result
    - If criteria met: calculate conviction score, calculate position size, validate with risk engine, place order on Polymarket CLOB API
    - Place stop-loss and take-profit limit sell orders per persona rules
    - Record trade in `portfolio_manager_trades`, record decision in `portfolio_manager_decisions`
    - Handle order patience windows (cancel unfilled orders after persona-specific timeout)
    - Implement retry logic: 3 retries with exponential backoff (1s, 2s, 4s) for CLOB API failures
    - Publish trade notification event to EventBridge
    - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.5, 4.6, 4.7, 4.8, 4.9, 4.10, 4.11, 4.12, 10.3, 10.5_

  - [ ]* 4.3 Write property test for position size cap
    - **Property 7: Position Size Cap**
    - Generate random conviction scores and persona configs, verify no single trade exceeds 50% of the session's current available investment amount
    - **Validates: Requirements 8.4, 4.10**

  - [ ]* 4.4 Write unit tests for trade executor
    - Test entry criteria evaluation for each persona type
    - Test conviction score calculation with edge cases (0, 1, boundary values)
    - Test order type selection logic (market vs limit based on spread)
    - Test patience window cancellation
    - Test retry logic on CLOB API failures
    - _Requirements: 4.1–4.12_

- [x] 5. Risk engine service
  - [x] 5.1 Implement portfolio-risk-engine Lambda handler
    - Create `infra/services/portfolio-risk-engine/handler.ts`
    - Triggered by EventBridge trade events + REST API (kill switch)
    - Enforce per-session loss limit (50% of investment, exit at 45% approach threshold)
    - Enforce cross-session total loss limit (40% of total invested, triggers kill switch)
    - Enforce position size cap (50% of available)
    - Enforce 30-minute cooldown after loss exits
    - At 30% session loss: send warning notification, activate 50% position size reduction
    - Kill switch: cancel all pending orders, exit all positions at market, suspend all activity, store state in DynamoDB
    - Handle API unreachability (3 consecutive failures → pause all activity)
    - Emergency exit fallback: aggressive limit order at 5% worse than best bid if market order fails within 60s
    - _Requirements: 8.1, 8.2, 8.3, 8.4, 8.5, 8.6, 8.7, 8.8_

  - [ ]* 5.2 Write property test for loss limit enforcement
    - **Property 6: Loss Limit Enforcement**
    - Generate price movement sequences and verify exit triggers before cumulative loss reaches 50% of investment amount
    - **Validates: Requirements 8.1, 8.6**

  - [ ]* 5.3 Write property test for cooldown enforcement
    - **Property 8: Cooldown Enforcement**
    - Generate trade sequences with losses and verify no new entry trade is placed within 30 minutes of a loss exit
    - **Validates: Requirements 8.7**

  - [ ]* 5.4 Write property test for kill switch totality
    - **Property 5: Kill Switch Totality**
    - Generate scenarios with multiple active sessions, trigger kill switch, verify ALL sessions transition to terminated and ALL pending orders are cancelled
    - **Validates: Requirements 8.3, 9.7**

- [x] 6. Checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 7. Position guard and lifecycle services
  - [x] 7.1 Implement portfolio-position-guard Lambda handler
    - Create `infra/services/portfolio-position-guard/handler.ts`
    - Triggered by EventBridge Scheduler at persona-specific intervals (5–30 min)
    - Acquire distributed lock (DynamoDB conditional write, 60s TTL) to prevent conflicts with trade executor
    - Fetch current market data from Polymarket CLOB (price, volume, spread, order book)
    - Detect regime shifts: probability swing > 15%, volume spike > 3x 24h average, new catalyst
    - Detect stale market: volume declining 3 consecutive cycles AND spread > 5%
    - On regime shift: re-evaluate position against latest analysis, exit if no longer justified
    - On contradicting analysis: cancel limit sells, place immediate exit within 1% of market price
    - On stale market: exit at market price
    - Persona-specific adjustments: Momentum Rider trailing stop, Contrarian scaling out
    - If exit order not filled within 2 monitoring cycles: cancel and re-attempt at market price
    - _Requirements: 5.1, 5.2, 5.3, 5.4, 5.5, 5.6, 5.7, 5.8_

  - [x] 7.2 Implement portfolio-lifecycle Lambda handler
    - Create `infra/services/portfolio-lifecycle/handler.ts`
    - Triggered by EventBridge Scheduler (market resolution check every 5 min) + REST API (manual stop)
    - Detect market resolution within 5 minutes, close session, record final P&L with redemption proceeds
    - Handle subscription downgrade: terminate sessions within 24h grace period
    - Handle capital depletion: mark session terminated when available < $5
    - Handle manual stop: exit all positions at market, cancel pending orders within 60s, generate session report
    - Send daily summary notification at 00:00 UTC for each active session
    - Allow multiple entry/exit cycles within a single session, maintaining cumulative stats
    - _Requirements: 7.1, 7.2, 7.3, 7.4, 7.5, 7.6, 7.7_

  - [ ]* 7.3 Write unit tests for position guard detection logic
    - Test regime shift detection with various price/volume/catalyst scenarios
    - Test stale market detection with declining volume patterns
    - Test persona-specific adjustments (Momentum Rider trailing stop, Contrarian scaling)
    - Test distributed lock acquisition and skip behavior
    - _Requirements: 5.1–5.8_

  - [ ]* 7.4 Write unit tests for lifecycle manager
    - Test market resolution detection and session closure
    - Test subscription downgrade grace period handling
    - Test capital depletion detection
    - Test manual stop with position exit and report generation
    - _Requirements: 7.1–7.7_

- [x] 8. Investment management and REST API
  - [x] 8.1 Implement portfolio-investment Lambda handler
    - Create `infra/services/portfolio-investment/handler.ts`
    - Handle investment amount increase: verify wallet balance, make additional funds available
    - Handle investment amount decrease: only allow reduction of uninvested portion (not in positions or pending orders)
    - Display breakdown: amount in positions, in pending orders, available, realized P&L
    - _Requirements: 6.1, 6.2, 6.3, 6.4, 6.5, 6.6, 6.7_

  - [x] 8.2 Implement portfolio-dashboard-api Lambda handler
    - Create `infra/services/portfolio-dashboard-api/handler.ts`
    - GET /portfolio/sessions: list all user sessions with status, persona, market, P&L, utilization
    - GET /portfolio/sessions/{id}: session detail with full stats
    - GET /portfolio/sessions/{id}/trades: paginated trade history (20 per page) with analysis reasoning
    - GET /portfolio/sessions/{id}/decisions: paginated decision log
    - GET /portfolio/stats: aggregate portfolio statistics (total invested, total P&L, active count)
    - PUT /portfolio/sessions/{id}/pause: halt new entries, cancel pending orders, keep position monitoring
    - PUT /portfolio/sessions/{id}/resume: restore to active status
    - DELETE /portfolio/sessions/{id}: stop session (confirmation handled by frontend)
    - PUT /portfolio/settings/persona: update persona selection (apply to future activations only)
    - GET /portfolio/settings/persona: get current persona config
    - POST /portfolio/kill-switch: trigger global kill switch
    - DELETE /portfolio/kill-switch: reset kill switch
    - _Requirements: 9.1, 9.3, 9.4, 9.5, 9.6, 9.7, 9.8, 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7, 3.8_

  - [ ]* 8.3 Write property test for analysis dependency
    - **Property 9: Analysis Dependency**
    - Generate scenarios where recurring analysis is active/cancelled and verify sessions can only be active when recurring analysis exists, and are paused when it's cancelled
    - **Validates: Requirements 10.1, 10.4**

- [x] 9. CDK infrastructure and EventBridge wiring
  - [x] 9.1 Add portfolio manager Lambda functions to compute stack
    - Update `infra/lib/compute-stack.ts` to define all 7 new Lambda functions with appropriate timeouts, memory, environment variables, and IAM permissions
    - Wire REST API routes (POST, GET, PUT, DELETE) to appropriate handlers via API Gateway
    - Configure EventBridge rules: analysis-complete events → trade-executor, trade events → risk-engine
    - Configure EventBridge Scheduler for position guard (created dynamically per session) and market resolution check (every 5 min for active markets)
    - Grant permissions: RDS access, DynamoDB access, S3 read, EventBridge publish, Secrets Manager read, SNS publish
    - _Requirements: All (infrastructure enablement)_

  - [x] 9.2 Add WebSocket event publishing for portfolio updates
    - Extend existing WebSocket delivery to handle portfolio-specific event types: `portfolio.session.updated`, `portfolio.trade.executed`, `portfolio.position.exited`, `portfolio.risk.alert`, `portfolio.kill_switch.triggered`
    - Publish state changes from trade executor, position guard, risk engine, and lifecycle manager to EventBridge for WebSocket fan-out
    - Ensure updates push within 5 seconds of state change
    - _Requirements: 9.2, 11.1, 11.2, 11.3, 11.4_

  - [ ]* 9.3 Write integration tests for activation → trade execution flow
    - Mock CLOB API, create session, deliver analysis event, verify trade executor evaluates and places order
    - Verify risk engine validates position before execution
    - Verify trade and decision records are created
    - _Requirements: 1.1–1.11, 4.1–4.12, 10.3_

- [x] 10. Checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 11. Frontend - Portfolio Dashboard page
  - [x] 11.1 Create portfolio dashboard hooks
    - Create `hooks/usePortfolioSessions.ts`: fetch all sessions with TanStack Query, real-time updates via WebSocket invalidation
    - Create `hooks/usePortfolioSession.ts`: fetch single session detail
    - Create `hooks/usePortfolioTrades.ts`: paginated trade history (20 per page)
    - Create `hooks/usePortfolioStats.ts`: aggregate portfolio statistics
    - Create `hooks/usePortfolioActions.ts`: mutations for pause, resume, stop, kill switch
    - Create `hooks/usePortfolioWebSocket.ts`: subscribe to portfolio WebSocket events and invalidate relevant queries
    - _Requirements: 9.1, 9.2, 9.3, 9.4, 9.5, 9.6, 9.7, 9.8_

  - [x] 11.2 Create Portfolio Dashboard page
    - Create `app/portfolio/page.tsx` with the portfolio dashboard
    - Display all active sessions: status badge, persona name, market name, unrealized P&L, realized P&L, investment utilization (% and absolute)
    - Aggregate stats bar: total invested, total unrealized P&L, total realized P&L, active session count
    - Per-session controls: Pause/Resume button, Stop button (with confirmation modal)
    - Global Kill Switch button (with confirmation modal requiring explicit approval)
    - Click session → expand to show trade history with entries, exits, P&L per trade, and analysis reasoning
    - Real-time updates via WebSocket (status, P&L, utilization update within 5 seconds)
    - _Requirements: 9.1, 9.2, 9.3, 9.4, 9.5, 9.6, 9.7, 9.8_

  - [ ]* 11.3 Write unit tests for portfolio dashboard hooks
    - Test query invalidation on WebSocket events
    - Test optimistic updates for pause/resume/stop actions
    - Test pagination for trade history
    - _Requirements: 9.1–9.8_

- [x] 12. Frontend - Persona Settings page
  - [x] 12.1 Create persona settings hooks
    - Create `hooks/usePersonaSettings.ts`: fetch current persona config, mutation to update selection
    - Create `hooks/usePersonaParams.ts`: mutation to update Elite customization params with validation
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7, 3.8_

  - [x] 12.2 Create Persona Settings page
    - Create `app/account/portfolio/page.tsx` (or integrate into existing account settings)
    - Display all 6 personas with name, risk level badge, description of entry philosophy, monitoring style, and exit behavior
    - Persona selection interface: radio/card selection, one active at a time
    - For Elite users: show customization controls (exit sensitivity 1-5, monitoring frequency 5-60 min in 5-min increments, position sizing 0.5x-2.0x in 0.1x increments)
    - For Pro users: show default parameters as read-only, indicate customization requires Elite
    - Validate all parameter ranges client-side before submission
    - Confirm save with active persona configuration display
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7, 3.8, 2.2, 2.3_

- [x] 13. Frontend - Activation Modal
  - [x] 13.1 Create activation hooks
    - Create `hooks/usePortfolioActivation.ts`: mutation to activate portfolio manager with validation
    - Include pre-flight checks: subscription tier, session count, recurring analysis existence
    - _Requirements: 1.1, 1.2, 1.5, 1.8_

  - [x] 13.2 Create Activation Modal component
    - Create `components/portfolio/ActivationModal.tsx`
    - Investment amount input with min $5 validation and max = wallet balance
    - Display current persona that will be used
    - Display active session count vs limit (3 Pro / 10 Elite)
    - Pre-activation checks: verify recurring analysis exists on market, show instructional message if not
    - Error states: insufficient balance, session limit reached, no recurring analysis, market resolved, duplicate session
    - Success state: show session created confirmation with link to dashboard
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 1.8, 1.9, 1.10, 1.11_

- [x] 14. Notification integration
  - [x] 14.1 Implement portfolio notification events
    - Extend existing notification fan-out to handle portfolio-specific events
    - Trade placed notification: market name, direction, order type, size, price, reasoning summary (within 10s)
    - Position exited notification: exit reason, entry/exit price, P&L, hold duration (within 10s)
    - Kill switch notification: override quiet hours, deliver on all enabled channels, include reason and sessions affected
    - Session paused notification: explain pause reason, market name, required user action
    - Loss warning notification (30% threshold): override quiet hours
    - Daily summary at 00:00 UTC: trades executed, current positions, unrealized P&L, realized P&L
    - Respect user notification preferences for routine events
    - Retry logic: 3 retries with exponential backoff (2s, 4s, 8s), fallback to next available channel
    - _Requirements: 11.1, 11.2, 11.3, 11.4, 11.5, 11.6, 7.4_

  - [ ]* 14.2 Write property test for notification completeness
    - **Property 10: Notification Completeness**
    - Generate trade execution sequences and verify every filled trade produces at least one notification, and kill switch events produce notifications on all enabled channels
    - **Validates: Requirements 11.1, 11.2, 11.3**

- [ ] 15. Analysis pipeline integration
  - [x] 15.1 Implement analysis consumption and subscription validation
    - Wire the trade executor to receive analysis-complete events via EventBridge for markets with active portfolio manager sessions
    - Implement subscription cancellation detection: when recurring analysis is cancelled, pause the associated portfolio manager session and notify user
    - Ensure portfolio manager does NOT trigger its own analysis - exclusively consumes delivered results
    - Store each analysis-to-action decision in `portfolio_manager_decisions` with all required fields (analysis ID, action, evaluation outcome, position state, conviction score, reasoning ≤ 500 chars)
    - _Requirements: 10.1, 10.2, 10.3, 10.4, 10.5, 10.6_

  - [ ]* 15.2 Write unit tests for analysis integration
    - Test that analysis-complete events are correctly routed to sessions on the same market
    - Test subscription cancellation pauses the session
    - Test decision record contains all required fields
    - _Requirements: 10.1–10.6_

- [x] 16. Final checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- Each task references specific requirements for traceability
- Checkpoints ensure incremental validation
- Property tests validate universal correctness properties from the design document
- Unit tests validate specific examples and edge cases
- The implementation language is TypeScript throughout (matching the design document and existing codebase)
- All Lambda handlers follow the existing pattern in `infra/services/` with shared utilities in `infra/services/shared/`
- Frontend follows existing Next.js App Router patterns with TanStack Query hooks
- EventBridge Scheduler rules for position guard are created dynamically per session (not statically in CDK)

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1", "1.2"] },
    { "id": 1, "tasks": ["1.3", "1.4"] },
    { "id": 2, "tasks": ["1.5", "3.1"] },
    { "id": 3, "tasks": ["3.2", "3.3", "3.4", "4.1"] },
    { "id": 4, "tasks": ["4.2", "5.1"] },
    { "id": 5, "tasks": ["4.3", "4.4", "5.2", "5.3", "5.4"] },
    { "id": 6, "tasks": ["7.1", "7.2", "8.1"] },
    { "id": 7, "tasks": ["7.3", "7.4", "8.2"] },
    { "id": 8, "tasks": ["8.3", "9.1"] },
    { "id": 9, "tasks": ["9.2", "9.3"] },
    { "id": 10, "tasks": ["11.1", "12.1", "13.1"] },
    { "id": 11, "tasks": ["11.2", "12.2", "13.2"] },
    { "id": 12, "tasks": ["11.3", "14.1", "15.1"] },
    { "id": 13, "tasks": ["14.2", "15.2"] }
  ]
}
```
