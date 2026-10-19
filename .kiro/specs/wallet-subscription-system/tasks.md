# Implementation Plan: Wallet Subscription System

## Overview

Replace the existing Stripe-based subscription and billing system with a wallet-based payment model using on-chain USDC.e transfers on Polygon. The frontend initiates transfers via `relayClient.execute()` from the user's Trading Wallet (Safe), and the backend verifies completed on-chain transactions. A Renewal Lambda uses `transferFrom` with pre-approved ERC-20 allowances for automatic renewals.

## Tasks

- [x] 1. Database schema migration and shared utilities
  - [x] 1.1 Create wallet subscription SQL migration file
    - Create `infra/sql/002-wallet-subscription.sql` with: DROP stripe columns from subscriptions, ADD wallet_address/grace_period_start/grace_period_end/eventbridge_schedule_arn columns, CREATE payment_transactions table with indexes, ADD credit_source column to credit_transactions
    - _Requirements: 1.4, 1.8, 2.3, 4.4, 7.1, 7.2_

  - [x] 1.2 Create plan and credit pack configuration module
    - Create `infra/services/shared/plans.ts` with PLANS config (free/starter/pro/elite with USDC.e prices and creditsPerMonth), CREDIT_PACKS config (pack_20, pack_50), `toUsdcUnits(usdAmount)` helper converting to 6-decimal bigint, and plan validation functions
    - _Requirements: 1.9, 4.8_

  - [x] 1.3 Create on-chain verification module
    - Create `infra/services/shared/chain-verification.ts` using viem with: `createPublicClient` for Polygon, `verifyTransferEvent()` that parses Transfer logs from transaction receipt and checks sender/recipient/amount match, `readAllowance(safeAddress, platformWallet)`, `readBalance(address)`, `deriveSafeAddress(eoaAddress, factoryAddress)` for deterministic Safe derivation. Define `VerificationResult` interface with error codes (TX_NOT_FOUND, TX_PENDING, TX_REVERTED, SENDER_MISMATCH, RECIPIENT_MISMATCH, AMOUNT_MISMATCH)
    - _Requirements: 1.3, 1.7, 2.2, 4.3, 4.7, 8.2, 9.2, 9.3, 9.4_

  - [x]* 1.4 Write property tests for chain verification module
    - **Property 2: Transfer Verification Correctness** - For any (sender, recipient, amount) tuple, verify returns true iff all match expected values
    - **Property 14: Deterministic Safe Address Derivation** - For any EOA, deriveSafeAddress always returns same result; distinct EOAs yield distinct Safe addresses
    - **Validates: Requirements 1.3, 1.7, 4.3, 4.7, 9.2, 9.3, 9.4**

  - [x]* 1.5 Write property tests for plan configuration
    - **Property 3: Proration Calculation** - For any (remaining_days 0-30, current_price, new_price), prorated credit = floor((remaining_days/30) × current_price × 100)/100, charge is non-negative, prorated credit never exceeds current plan price
    - **Property 4: Billing Cycle Initialization** - For any activation date D and plan P, billing_cycle_end = D + 30 days, credits_remaining = P.creditsPerMonth
    - **Property 5: Credit Reset on Plan Change** - For any plan change, new credits_remaining = target plan's creditsPerMonth regardless of previous value
    - **Validates: Requirements 1.8, 1.10, 1.11, 1.13, 2.3**

  - [x] 1.6 Update shared credits.ts to remove Stripe references
    - Update `infra/services/shared/credits.ts`: remove Stripe-related queries, add WALLET_QUERIES object with SQL for activateSubscription, processRenewal, addCreditPackCredits, getPurchasedCreditsBalance, recordPaymentTransaction, getPaymentHistory (cursor-based pagination), getUserEoaAddress. Add `grace_period` to subscription status type
    - _Requirements: 1.4, 2.3, 4.4, 5.1, 5.3, 7.1, 7.3, 9.1_

- [x] 2. Checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 3. Wallet Service Lambda (backend API)
  - [x] 3.1 Implement wallet service handler with route scaffolding
    - Rewrite `infra/services/subscription-api/handler.ts` to remove all Stripe logic. Implement route dispatcher for: GET /subscriptions, POST /subscriptions, DELETE /subscriptions/{id}, POST /subscriptions/renew, POST /credits/purchase, GET /wallet/balance, GET /payments/history. Add CORS headers, userId extraction from JWT, error response format with error codes. Import chain-verification module and plans config
    - _Requirements: 5.1, 5.2, 5.4, 5.5_

  - [x] 3.2 Implement GET /subscriptions route
    - Query subscription by userId, return plan/status/creditsRemaining/creditsMonthlyLimit/billingCycleStart/billingCycleEnd/walletAddress/renewalPrice/allowanceStatus. Read allowance from chain via `readAllowance()` to determine allowanceStatus. Return free plan defaults if no subscription exists
    - _Requirements: 1.9, 6.6, 6.7_

  - [x] 3.3 Implement POST /subscriptions route (plan purchase verification)
    - Accept `{ planId, txHash }`. Validate planId. Get user's registered wallet address. Call `verifyTransferEvent()` with txHash, expectedSender=safeAddress, expectedRecipient=platformWallet, expectedAmount=planPrice. On success: atomic DB transaction to activate subscription (set plan, credits, billing_cycle_start/end = now + 30 days), record payment_transaction, create EventBridge schedule for billing_cycle_end. Handle same-plan rejection (Req 1.12), proration for plan changes (Req 1.10). Use SELECT FOR UPDATE for concurrency
    - _Requirements: 1.3, 1.4, 1.7, 1.8, 1.9, 1.10, 1.12, 1.13, 8.1, 8.6_

  - [x] 3.4 Implement DELETE /subscriptions/{id} route (cancellation)
    - Verify ownership. Reject if already cancelled or free plan (Req 3.5). Mark status='cancelled', record cancelled_at. If in grace period, immediately downgrade to free with 5 credits (Req 3.6). Delete EventBridge schedule (Req 8.6). Return confirmation with expiration date
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 8.6_

  - [x] 3.5 Implement POST /subscriptions/renew route (manual renewal)
    - Accept `{ txHash }`. Same verification flow as plan purchase but for existing plan renewal. Verify sender is registered Safe, amount matches current plan price. Reset credits_remaining to plan monthly limit, advance billing_cycle by 30 days from previous end date, record payment_transaction, create new EventBridge schedule
    - _Requirements: 2.9, 2.3_

  - [x] 3.6 Implement POST /credits/purchase route
    - Accept `{ packId, txHash }`. Validate packId against CREDIT_PACKS. Verify on-chain transfer (sender=Safe, recipient=Platform, amount=packPrice). Use SELECT FOR UPDATE on subscriptions row to serialize concurrent purchases. Add credits to credits_remaining, record in credit_transactions with credit_source='credit_pack', record in payment_transactions. Return updated balance
    - _Requirements: 4.3, 4.4, 4.7, 4.8, 4.9, 4.10_

  - [x] 3.7 Implement GET /wallet/balance route
    - Read USDC.e balance of user's registered Safe address via `readBalance()`. Return formatted balance (6 decimals → human-readable)
    - _Requirements: 5.4_

  - [x] 3.8 Implement GET /payments/history route
    - Accept optional query params: cursor (base64-encoded), limit (default 20, max 100), transaction_type filter. Query payment_transactions ordered by created_at DESC. Implement cursor-based pagination using (created_at, id) composite cursor. Return transactions array, next_cursor, has_more flag. Validate cursor format, return error for invalid/expired cursors
    - _Requirements: 7.1, 7.2, 7.3, 7.4, 7.5_

  - [x]* 3.9 Write property tests for payment history pagination
    - **Property 12: Payment History Pagination** - For any M transactions with page size P, has_more is true iff more exist; following all cursors yields exactly M transactions with no gaps/duplicates
    - **Property 13: Transaction Type Filter Correctness** - All returned transactions match filter; none with different type included
    - **Validates: Requirements 7.1, 7.3, 7.5**

  - [x]* 3.10 Write unit tests for wallet service routes
    - Test: same-plan rejection, invalid planId, invalid packId, invalid cursor, cancellation of free plan, cancellation of already-cancelled subscription, unauthorized source address rejection (EOA or mismatched Safe), duplicate tx_hash rejection
    - _Requirements: 1.7, 1.12, 3.5, 4.7, 4.9, 7.4, 9.2, 9.3_

- [x] 4. Checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 5. Renewal Lambda and scheduling
  - [x] 5.1 Create renewal handler Lambda
    - Create `infra/services/subscription-renewal/handler.ts`. Triggered by EventBridge Scheduler with payload `{ subscriptionId, billingCycleEnd }`. Logic: check DynamoDB dedup key (subscription_id#billing_cycle_end), read allowance and balance from chain, if sufficient execute `transferFrom` via Platform Wallet signer (private key from Secrets Manager), on success: atomic DB update (reset credits, advance billing cycle, record payment), write dedup key with 7-day TTL, create new EventBridge schedule. On insufficient: set grace_period_start/end (+3 days), schedule retry in 24h, send notification via SNS
    - _Requirements: 2.2, 2.3, 2.4, 2.5, 2.6, 2.10, 8.1, 8.2, 8.3, 8.4, 8.5_

  - [x] 5.2 Implement grace period logic in renewal handler
    - On insufficient allowance/balance: check if already in grace period. If grace_period_end has passed → downgrade to free (5 credits), preserve credit_pack credits (query credit_transactions with credit_source='credit_pack'), delete EventBridge schedule, notify user. If still in grace period → retry in 24h. Send notification with reason (insufficient balance vs insufficient allowance) and required action
    - _Requirements: 2.4, 2.5, 2.6, 2.7, 2.8, 8.4_

  - [x] 5.3 Implement pre-renewal reminder notification
    - Add logic to check subscriptions 3 days before billing_cycle_end where no allowance is set. Send reminder notification prompting user to approve allowance or manually renew. This can be a separate scheduled Lambda or part of the renewal handler triggered by a "reminder" event type
    - _Requirements: 2.8_

  - [x]* 5.4 Write property tests for renewal logic
    - **Property 6: Renewal Decision Logic** - For any (allowance, balance, price), renewal proceeds iff allowance >= price AND balance >= price; otherwise enters grace period
    - **Property 7: Grace Period Downgrade Preserves Purchased Credits** - On downgrade, final credits = 5 + sum of unexpired credit_pack credits; plan credits forfeited
    - **Property 8: Renewal Idempotency** - For K deliveries of same (subscription_id, billing_cycle_end), system processes exactly once
    - **Property 9: Cancelled Subscription Access Retention** - Cancelled sub with future billing_cycle_end retains plan/credits; at expiry downgrades to free with 5 credits
    - **Validates: Requirements 2.2, 2.4, 2.7, 2.10, 3.2, 3.3**

  - [x]* 5.5 Write unit tests for renewal handler
    - Test: idempotent no-op on duplicate event, successful transferFrom flow, grace period entry, grace period expiry downgrade, DynamoDB conditional write failure handling, EventBridge schedule creation parameters
    - _Requirements: 2.2, 2.3, 2.4, 2.7, 8.1, 8.3_

- [x] 6. Checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 7. CDK infrastructure updates
  - [x] 7.1 Update compute-stack.ts for wallet subscription
    - Remove Stripe secret ARN env vars from subscription Lambda. Add env vars: PLATFORM_WALLET_ADDRESS, USDC_CONTRACT_ADDRESS, POLYGON_RPC_URL, SAFE_FACTORY_ADDRESS, DEDUP_TABLE. Add new subscription-renewal Lambda with env vars including PLATFORM_WALLET_PRIVATE_KEY_ARN. Add API Gateway routes: POST /subscriptions/renew, GET /wallet/balance, GET /payments/history. Grant renewal Lambda permissions for EventBridge Scheduler (create/delete schedules), DynamoDB dedup table, Secrets Manager (platform wallet key + DB creds). Add SQS DLQ for renewal failures with 3 retries and exponential backoff
    - _Requirements: 5.4, 8.1, 8.5, 8.6_

  - [x] 7.2 Add DynamoDB dedup table to database-stack.ts
    - Add DynamoDB table for renewal deduplication with: partition key `pk` (String), TTL attribute `ttl`, on-demand billing. Export table name for compute-stack reference
    - _Requirements: 2.10, 8.3_

  - [x] 7.3 Update deploy.sh for wallet-based deployment
    - Remove Stripe steps (Step 1 stripe-secrets, Step 4 stripe-products). Add step for Platform Wallet private key secret creation in Secrets Manager. Add Magic SDK secret if not present. Update DB migration step to run all `sql/*.sql` files in order (001, 002, etc.) instead of just 001. Update step numbering and help text. Remove stripe CLI prerequisite check
    - _Requirements: 5.1, 5.3_

- [x] 8. Frontend subscription hooks and utilities
  - [x] 8.1 Create useWalletSubscription hook
    - Create `tradewizard-frontend/hooks/useWalletSubscription.ts` replacing useSubscription.ts. Use TanStack Query to fetch GET /subscriptions. Expose: plan, status, creditsRemaining, creditsMonthlyLimit, billingCycleEnd, renewalPrice, walletAddress, allowanceStatus. Include `useSubscribePlan` mutation (creates SafeTx via existing `createUsdcTransferTx`, executes via relayClient, POSTs txHash to backend), `usePurchaseCreditPack` mutation, `useCancelSubscription` mutation, `useManualRenew` mutation
    - _Requirements: 1.2, 4.2, 6.3, 6.5_

  - [x] 8.2 Create useSubscriptionAllowance hook
    - Create `tradewizard-frontend/hooks/useSubscriptionAllowance.ts`. Read USDC.e allowance(safeAddress, platformWallet) via publicClient.readContract. Expose: allowance (bigint), isAutoRenewalEnabled (allowance >= planPrice), isLoading. Include `useApproveAllowance` mutation that creates SafeTx calling `USDC.e.approve(Platform_Wallet, planPrice)` and executes via relayClient. Include `useRevokeAllowance` for setting allowance to 0
    - _Requirements: 2.1, 3.7, 6.6, 6.10_

  - [x]* 8.3 Write property test for SafeTransaction encoding
    - **Property 1: SafeTransaction Encoding Round-Trip** - For any valid recipient address and USDC.e amount, `createUsdcTransferTx({ recipient, amount })` produces a SafeTransaction whose data field decodes back to original recipient and amount
    - **Validates: Requirements 1.2, 4.2**

- [x] 9. Frontend subscription UI components
  - [x] 9.1 Update PlanCard component for USDC.e pricing
    - Update `tradewizard-frontend/components/subscription/PlanCard.tsx` to show USDC.e prices instead of USD/Stripe. Display Trading Wallet balance alongside each plan. Disable purchase button and show shortfall when balance insufficient. Show current plan highlight
    - _Requirements: 1.5, 6.1, 6.4_

  - [x] 9.2 Create ConfirmPurchaseDialog component
    - Create `tradewizard-frontend/components/subscription/ConfirmPurchaseDialog.tsx`. Show plan price, current Trading Wallet balance, remaining balance after purchase. Disable confirm button during transfer, show loading indicator with "on-chain transfer in progress" message. On success show new plan name. On error show failure reason inline. Handle proration display for plan changes
    - _Requirements: 1.5, 1.6, 6.2, 6.3_

  - [x] 9.3 Create AllowanceApproval component
    - Create `tradewizard-frontend/components/subscription/AllowanceApproval.tsx`. Show current allowance status. Provide toggle/button to approve allowance (plan price) for auto-renewal with clear explanation. Provide revoke button to set allowance to 0. Show loading states during SafeTransaction execution
    - _Requirements: 2.1, 3.7, 6.10_

  - [x] 9.4 Update subscription page to wire new components
    - Update `tradewizard-frontend/app/account/subscription/page.tsx`. Display Trading Wallet (Safe) address clearly, distinguished from EOA. Show USDC.e balance (2 decimal places). Show renewal date and price for paid plans. Hide renewal section for free plan. Refresh balance within 2 seconds of successful purchase. Wire PlanCard, ConfirmPurchaseDialog, AllowanceApproval, and credit pack purchase flow. Show payment history section
    - _Requirements: 6.1, 6.6, 6.7, 6.8, 6.9_

  - [x]* 9.5 Write property test for credit pack addition
    - **Property 10: Credit Pack Addition is Additive** - For any current credits C and pack with N credits, after purchase credits_remaining = C + N
    - **Property 11: Concurrent Purchases Serialize Correctly** - For N concurrent purchases with sizes [p1..pN], final credits = initial + sum(p1..pN) with exactly N transaction records
    - **Validates: Requirements 4.4, 4.10**

- [x] 10. Checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 11. Integration wiring and final verification
  - [x] 11.1 Wire EventBridge schedule management into subscription lifecycle
    - Ensure POST /subscriptions creates schedule on activation, DELETE /subscriptions deletes schedule on cancellation, POST /subscriptions (plan change) deletes old schedule and creates new one, renewal handler creates next-cycle schedule on success. Verify schedule payload includes subscriptionId and billingCycleEnd
    - _Requirements: 8.1, 8.6_

  - [x]* 11.2 Write integration tests for full subscription flows
    - Test full plan purchase flow (mocked blockchain via viem test client, real DB queries). Test renewal flow with grace period transitions. Test credit pack purchase with concurrent requests (row-level locking). Test payment history pagination with cursor traversal. Test Safe address derivation and validation during payment verification
    - _Requirements: 1.3, 1.4, 2.2, 2.4, 4.4, 4.10, 7.1, 9.1_

- [x] 12. Final checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- Each task references specific requirements for traceability
- Checkpoints ensure incremental validation
- Property tests validate universal correctness properties from the design document
- Unit tests validate specific examples and edge cases
- The design uses TypeScript throughout (viem, AWS SDK, pg client)
- Existing hooks (`useUsdcTransfer`, `utils/transfer.ts`, `usePolygonBalances`, `useTradingSession`) are leveraged rather than rewritten
- USDC.e uses 6 decimals - all amount conversions use `toUsdcUnits()`
- Platform Wallet private key is only needed by the Renewal Lambda for `transferFrom`

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1", "1.2"] },
    { "id": 1, "tasks": ["1.3", "1.6"] },
    { "id": 2, "tasks": ["1.4", "1.5"] },
    { "id": 3, "tasks": ["3.1", "7.2"] },
    { "id": 4, "tasks": ["3.2", "3.7", "3.8", "7.1"] },
    { "id": 5, "tasks": ["3.3", "3.4", "3.5", "3.6", "7.3"] },
    { "id": 6, "tasks": ["3.9", "3.10", "5.1"] },
    { "id": 7, "tasks": ["5.2", "5.3"] },
    { "id": 8, "tasks": ["5.4", "5.5", "8.1"] },
    { "id": 9, "tasks": ["8.2", "8.3"] },
    { "id": 10, "tasks": ["9.1", "9.2", "9.3"] },
    { "id": 11, "tasks": ["9.4", "9.5"] },
    { "id": 12, "tasks": ["11.1"] },
    { "id": 13, "tasks": ["11.2"] }
  ]
}
```
