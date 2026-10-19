# Requirements Document

## Introduction

This feature replaces the existing Stripe-based subscription and billing system with a wallet-based payment model using on-chain USDC.e transfers on Polygon. Users pay for subscription plans and credit packs by initiating a USDC.e transfer from their Trading_Wallet (Safe/proxy wallet) to the TradeWizard Platform_Wallet via the frontend relayClient. The backend verifies the on-chain transfer and activates the subscription or credits upon confirmation. This eliminates Stripe as a dependency, reduces payment processing fees, and aligns the platform with its crypto-native user base on Polymarket.

## Glossary

- **Wallet_Service**: The backend service (Lambda) that verifies on-chain USDC.e transfers, activates subscriptions, processes credit pack purchases, and manages payment verification. The Wallet_Service does NOT initiate transfers - it only verifies and records them.
- **Subscription_Engine**: The component within the Wallet_Service responsible for managing plan lifecycle (activation, renewal, cancellation, expiration).
- **Billing_Cycle**: A 30-day period starting from the date a user subscribes to a paid plan, during which credits are allocated and the plan remains active.
- **USDC.e**: Bridged USD Coin on Polygon, a stablecoin pegged 1:1 to the US dollar, used as the payment currency. Contract address defined in `constants/tokens.ts`.
- **Platform_Wallet**: The TradeWizard-controlled wallet address that receives USDC.e payments from users for subscriptions and credit packs.
- **Trading_Wallet**: The user's Safe/proxy wallet on Polygon, deterministically derived from the EOA address via `deriveSafe(eoaAddress, SafeFactory)`. This wallet holds the user's USDC.e balance and is the ONLY authorized source of subscription payments. Transfers are executed via `relayClient.execute()` on the frontend.
- **EOA_Address**: The user's Magic SDK wallet address used solely for authentication and signing. The EOA_Address does NOT hold trading funds and SHALL NOT be used as a payment source.
- **RelayClient**: The Polymarket builder-relayer-client instance initialized during the trading session, used by the frontend to execute SafeTransactions from the Trading_Wallet.
- **Frontend_Subscription_UI**: The Next.js subscription management page and associated components that allow users to view plans, initiate USDC.e transfers for purchases, and manage billing.
- **Payment_Transaction**: An on-chain USDC.e transfer from the Trading_Wallet to the Platform_Wallet, recorded with its transaction hash, amount, source address, and purpose.
- **USDC_Allowance**: An ERC-20 approval granted by the Trading_Wallet to the Platform_Wallet, permitting the Platform_Wallet to pull a specified amount of USDC.e without further user interaction. Used for automatic renewals.

## Requirements

### Requirement 1: Subscription Plan Purchase via USDC.e Transfer

**User Story:** As a user, I want to subscribe to a plan (Starter $19/mo, Pro $49/mo, Elite $149/mo) by transferring USDC.e from my Trading Wallet, so that I can access premium features without needing a credit card.

#### Acceptance Criteria

1. WHEN a user requests a plan subscription, THE Frontend_Subscription_UI SHALL query the Trading_Wallet USDC.e balance via `publicClient.readContract` on the USDC.e contract to verify the balance is greater than or equal to the plan price before initiating the transfer.
2. WHEN the Trading_Wallet balance is sufficient and the user confirms the purchase, THE Frontend_Subscription_UI SHALL create a SafeTransaction calling `USDC.e.transfer(Platform_Wallet, planPrice)` and execute it via `relayClient.execute()`, then submit the resulting transaction hash to the Wallet_Service for verification.
3. WHEN the Wallet_Service receives a transaction hash, THE Wallet_Service SHALL verify on-chain that the transfer was confirmed, that the sender is the user's registered Trading_Wallet address, that the recipient is the Platform_Wallet, and that the amount matches the plan price.
4. WHEN the on-chain transfer is verified, THE Subscription_Engine SHALL activate the subscription within a single database transaction, recording the transaction hash as the payment reference.
5. IF the Trading_Wallet USDC.e balance is insufficient for the requested plan, THEN THE Frontend_Subscription_UI SHALL disable the purchase button and display the shortfall amount (plan price minus current balance).
6. IF the on-chain USDC.e transfer fails or is reverted, THEN THE Frontend_Subscription_UI SHALL display an error indicating the transfer failure reason and the Wallet_Service SHALL not activate the subscription.
7. IF the Wallet_Service receives a transaction hash where the source address does not match the user's registered Trading_Wallet (Safe address), THEN THE Wallet_Service SHALL reject the payment and return an error indicating an unauthorized source address.
8. WHEN a subscription is activated, THE Subscription_Engine SHALL set the Billing_Cycle to 30 days from the activation date and allocate the plan's monthly credits to credits_remaining.
9. THE Subscription_Engine SHALL support the following plans: Free (0 USDC.e, 5 credits/month), Starter (19 USDC.e, 50 credits/month), Pro (49 USDC.e, 200 credits/month), Elite (149 USDC.e, unlimited credits/month).
10. WHEN a user changes from one paid plan to another paid plan, THE Subscription_Engine SHALL calculate a prorated credit as (remaining_days / 30) × current_plan_price rounded down to the nearest USDC.e cent, and THE Frontend_Subscription_UI SHALL initiate a transfer for only the difference (new plan price minus prorated credit) from the Trading_Wallet to the Platform_Wallet, and THE Wallet_Service SHALL activate the new plan upon verification.
11. IF a user requests a plan change and the Trading_Wallet balance is insufficient to cover the new plan price minus the prorated credit, THEN THE Frontend_Subscription_UI SHALL display an error indicating the shortfall amount and not initiate any transfer.
12. IF a user requests to subscribe to the plan they are already subscribed to, THEN THE Wallet_Service SHALL return an error indicating the user is already on the requested plan without requiring any transfer.
13. WHEN a user changes plans, THE Subscription_Engine SHALL forfeit any unused credits from the previous plan and allocate the full monthly credits of the new plan.

### Requirement 2: Subscription Renewal via USDC.e Allowance

**User Story:** As a user, I want my subscription to renew automatically using a pre-approved USDC.e allowance, so that I maintain uninterrupted access to premium features without manually confirming each renewal.

#### Acceptance Criteria

1. WHEN a user subscribes to a paid plan, THE Frontend_Subscription_UI SHALL prompt the user to approve a USDC.e allowance from the Trading_Wallet to the Platform_Wallet equal to the plan price, by creating a SafeTransaction calling `USDC.e.approve(Platform_Wallet, planPrice)` and executing it via `relayClient.execute()`.
2. WHEN a Billing_Cycle ends and the Trading_Wallet has granted sufficient USDC.e allowance to the Platform_Wallet, THE Subscription_Engine SHALL initiate a `transferFrom` call on the USDC.e contract to pull the plan price from the Trading_Wallet to the Platform_Wallet.
3. WHEN the renewal transfer is confirmed on-chain, THE Subscription_Engine SHALL reset the credits_remaining to the plan's monthly limit and start a new 30-day Billing_Cycle beginning from the original Billing_Cycle end date.
4. IF the Trading_Wallet USDC.e balance is insufficient at renewal time OR the remaining allowance is less than the plan price, THEN THE Subscription_Engine SHALL enter a 3-day grace period during which the subscription remains active and the user may continue consuming any credits_remaining from the prior cycle.
5. WHILE in the grace period, THE Subscription_Engine SHALL attempt renewal once every 24 hours from the start of the grace period.
6. WHILE in the grace period, THE Wallet_Service SHALL send a notification to the user via the platform's multi-channel delivery system indicating the renewal failed, the reason (insufficient balance or insufficient allowance), and the action required (fund wallet or re-approve allowance).
7. IF the grace period expires without successful renewal, THEN THE Subscription_Engine SHALL downgrade the user to the Free plan, set credits_remaining to 5, and forfeit any unused plan-allocated credits while preserving any credits previously purchased via credit packs.
8. IF the user has not approved a USDC.e allowance for the Platform_Wallet, THEN THE Subscription_Engine SHALL send a renewal reminder notification 3 days before the Billing_Cycle end date prompting the user to return to the app and either approve an allowance or manually renew.
9. WHEN a user manually renews (no allowance set), THE Frontend_Subscription_UI SHALL follow the same transfer flow as an initial subscription purchase: create a SafeTransaction, execute via relayClient, and submit the transaction hash to the Wallet_Service for verification.
10. THE Subscription_Engine SHALL process renewals idempotently by using the combination of subscription_id and billing_cycle_end as a deduplication key, so that duplicate event deliveries do not result in double charges or duplicate transfers.

### Requirement 3: Subscription Cancellation

**User Story:** As a user, I want to cancel my subscription and retain access until the end of my current billing cycle, so that I get the full value of what I already paid.

#### Acceptance Criteria

1. WHEN a user cancels their active paid subscription, THE Subscription_Engine SHALL mark the subscription status as "cancelled", record the cancellation timestamp, and return a confirmation response including the date when the plan will expire.
2. WHILE a cancelled subscription has not reached the Billing_Cycle end date, THE Subscription_Engine SHALL maintain the user's current plan features and remaining credits.
3. WHEN the Billing_Cycle ends for a cancelled subscription, THE Subscription_Engine SHALL downgrade the user to the Free plan with 5 credits per month and reset credits_remaining to 5.
4. THE Subscription_Engine SHALL NOT attempt renewal for a cancelled subscription.
5. IF a user attempts to cancel a subscription that is already cancelled or is on the Free plan, THEN THE Subscription_Engine SHALL return an error indicating that no active paid subscription exists.
6. IF a user cancels their subscription while in the grace period, THEN THE Subscription_Engine SHALL immediately downgrade the user to the Free plan with 5 credits per month and cancel any pending renewal attempts.
7. WHEN a subscription is cancelled, THE Subscription_Engine SHALL revoke any outstanding USDC.e allowance by prompting the Frontend_Subscription_UI to set the allowance to zero via a SafeTransaction calling `USDC.e.approve(Platform_Wallet, 0)`.

### Requirement 4: Credit Pack Purchase via USDC.e Transfer

**User Story:** As a user, I want to buy additional credit packs (20 for $9, 50 for $19) by transferring USDC.e from my Trading Wallet, so that I can get more analysis credits without changing my plan.

#### Acceptance Criteria

1. WHEN a user requests a credit pack purchase, THE Frontend_Subscription_UI SHALL query the Trading_Wallet USDC.e balance via `publicClient.readContract` to verify the balance is greater than or equal to the pack price.
2. WHEN the Trading_Wallet balance is sufficient and the user confirms, THE Frontend_Subscription_UI SHALL create a SafeTransaction calling `USDC.e.transfer(Platform_Wallet, packPrice)` and execute it via `relayClient.execute()`, then submit the resulting transaction hash to the Wallet_Service.
3. WHEN the Wallet_Service receives the transaction hash, THE Wallet_Service SHALL verify on-chain that the transfer was confirmed, that the sender is the user's registered Trading_Wallet address, that the recipient is the Platform_Wallet, and that the amount matches the pack price.
4. WHEN the on-chain transfer is verified, THE Wallet_Service SHALL add the credits to the user's credits_remaining and record the transaction hash and credit addition in the credit_transactions table within a single database transaction.
5. IF the Trading_Wallet USDC.e balance is insufficient for the requested credit pack, THEN THE Frontend_Subscription_UI SHALL disable the purchase button and display the shortfall amount.
6. IF the on-chain USDC.e transfer fails or is reverted, THEN THE Frontend_Subscription_UI SHALL display an error and the Wallet_Service SHALL not add credits.
7. IF the Wallet_Service receives a transaction hash where the source address does not match the user's registered Trading_Wallet, THEN THE Wallet_Service SHALL reject the purchase and return an error indicating an unauthorized source address.
8. THE Wallet_Service SHALL support the following credit packs: 20 credits for 9 USDC.e, 50 credits for 19 USDC.e.
9. IF a user requests a credit pack that does not match a supported pack option, THEN THE Wallet_Service SHALL return an error indicating the requested pack is invalid.
10. IF a concurrent credit pack purchase is attempted for the same user while another purchase is in progress, THEN THE Wallet_Service SHALL serialize the requests using row-level locking to prevent double-spend scenarios.

### Requirement 5: Stripe Removal

**User Story:** As a platform operator, I want to completely remove Stripe from the system, so that the platform operates entirely on USDC.e wallet-based payments with reduced operational complexity and fees.

#### Acceptance Criteria

1. THE Wallet_Service SHALL handle all subscription and credit pack operations without any dependency on Stripe APIs or Stripe webhook events.
2. THE Wallet_Service SHALL replace the existing subscription-api Lambda handler routes with USDC.e transfer verification-based equivalents that maintain the same API contract shape for the frontend.
3. WHEN the migration is complete, THE Subscription_Engine SHALL NOT store or reference stripe_customer_id or stripe_subscription_id in the subscriptions table.
4. THE Wallet_Service SHALL expose the following routes: GET /subscriptions, POST /subscriptions (plan purchase - accepts transaction hash for verification), DELETE /subscriptions/{subscriptionId} (cancel), POST /subscriptions/renew (manual renewal - accepts transaction hash), POST /credits/purchase (credit pack - accepts transaction hash), GET /wallet/balance (reads Trading_Wallet balance from blockchain via publicClient), GET /payments/history (paginated payment transaction history).
5. THE Wallet_Service SHALL NOT initiate USDC.e transfers from user wallets. All transfers are initiated by the frontend via relayClient and the backend only verifies completed on-chain transactions.

### Requirement 6: Frontend Subscription UI Update

**User Story:** As a user, I want to subscribe to plans and buy credits directly from the subscription page using my Trading Wallet balance, so that I have a seamless in-app payment experience without external redirects.

#### Acceptance Criteria

1. WHEN a user views the subscription page, THE Frontend_Subscription_UI SHALL display the current Trading_Wallet USDC.e balance (queried from the blockchain via `publicClient.readContract` on the Trading_Wallet Safe address) formatted with 2 decimal places alongside plan options.
2. WHEN a user selects a plan to subscribe, THE Frontend_Subscription_UI SHALL show a confirmation dialog with the plan price, current Trading_Wallet balance, and remaining balance after purchase.
3. WHEN a user confirms a plan purchase, THE Frontend_Subscription_UI SHALL disable the confirm button, display a loading indicator with a message indicating the on-chain transfer is in progress, execute the SafeTransaction via relayClient, submit the transaction hash to the Wallet_Service, and upon response display a success message with the new plan name or an error message indicating the failure reason inline without redirecting to an external page.
4. IF the Trading_Wallet balance is insufficient for a selected plan or credit pack, THEN THE Frontend_Subscription_UI SHALL disable the corresponding purchase button and display a prompt indicating the shortfall amount and directing the user to fund their Trading Wallet with more USDC.e.
5. WHEN a credit pack purchase succeeds, THE Frontend_Subscription_UI SHALL optimistically update the displayed credit balance in the header and revert to the server-confirmed value if a subsequent balance query returns a different amount.
6. WHILE the user is subscribed to a paid plan, THE Frontend_Subscription_UI SHALL display the next renewal date, the plan price that will be transferred at renewal, and the current USDC.e allowance status (whether auto-renewal is enabled).
7. WHILE the user is on the Free plan, THE Frontend_Subscription_UI SHALL hide the renewal date section and display a prompt to upgrade.
8. WHEN a plan purchase or credit pack purchase succeeds, THE Frontend_Subscription_UI SHALL refresh the displayed Trading_Wallet balance from the blockchain within 2 seconds of receiving the success response.
9. THE Frontend_Subscription_UI SHALL display the Trading_Wallet (Safe) address clearly, distinguishing it from the EOA_Address, so users understand which wallet funds are drawn from.
10. WHEN a user subscribes to a paid plan, THE Frontend_Subscription_UI SHALL present an option to enable auto-renewal by approving a USDC.e allowance, with a clear explanation that this permits the platform to pull the plan price at each renewal without further user action.

### Requirement 7: Payment Transaction History

**User Story:** As a user, I want to see a history of all subscription payments and credit pack purchases (on-chain USDC.e transfers), so that I can track my spending.

#### Acceptance Criteria

1. WHEN a user requests their payment history, THE Wallet_Service SHALL return a paginated list of Payment_Transactions ordered by creation date descending with a default page size of 20 entries and a maximum page size of 100 entries.
2. THE Wallet_Service SHALL include the transaction_type (one of: subscription_payment, credit_pack_purchase, renewal_payment, proration_credit), amount in USDC.e, on-chain transaction hash, source Trading_Wallet address, and created_at timestamp for each transaction entry.
3. THE Wallet_Service SHALL support cursor-based pagination and return a next_cursor value and a has_more boolean flag with each response to indicate whether additional pages exist.
4. IF a user provides an invalid or expired cursor, THEN THE Wallet_Service SHALL return an error indicating the cursor is invalid and the client should restart from the first page.
5. WHEN a user requests their payment history with an optional transaction_type filter, THE Wallet_Service SHALL return only transactions matching the specified type.

### Requirement 8: Renewal Scheduling

**User Story:** As a platform operator, I want subscription renewals to be processed automatically and reliably, so that users maintain uninterrupted service without manual intervention.

#### Acceptance Criteria

1. WHEN a subscription is activated or renewed, THE Subscription_Engine SHALL create an Amazon EventBridge Scheduler schedule targeting the subscription's billing_cycle_end timestamp, with the subscription_id and billing_cycle_end included in the event payload.
2. WHEN a renewal event fires, THE Subscription_Engine SHALL check the USDC.e allowance granted by the Trading_Wallet to the Platform_Wallet via `publicClient.readContract` on the USDC.e contract's `allowance` function, and if sufficient, initiate a `transferFrom` transaction to pull the plan price from the Trading_Wallet.
3. WHEN the renewal transfer is confirmed on-chain, THE Subscription_Engine SHALL process the renewal within a single atomic database transaction (reset credits, update billing cycle, record transaction hash) and complete processing within 30 seconds of event receipt.
4. IF the allowance is insufficient or the Trading_Wallet balance is insufficient, THEN THE Subscription_Engine SHALL enter the grace period as defined in Requirement 2 and send a notification to the user.
5. IF a renewal Lambda invocation fails due to an unhandled exception, timeout, or non-2xx response from the database, THEN THE Subscription_Engine SHALL retry via SQS dead-letter queue with exponential backoff (1 minute, 2 minutes, 4 minutes) up to 3 attempts.
6. WHEN a subscription is cancelled or the user changes plans, THE Subscription_Engine SHALL delete the existing EventBridge Scheduler schedule associated with that subscription.

### Requirement 9: Trading Wallet Address Validation

**User Story:** As a platform operator, I want to ensure that only the user's legitimate Trading Wallet (Safe address) can be used for subscription payments, so that payments are traceable and secure.

#### Acceptance Criteria

1. WHEN the Wallet_Service processes a payment verification request, THE Wallet_Service SHALL derive the user's expected Trading_Wallet address from their EOA_Address (stored in the users table from Cognito/Magic auth) using the deterministic derivation (`deriveSafe(eoaAddress, SafeFactory)`) and verify the transaction sender matches the derived address.
2. IF a payment verification request references a transaction where the source address does not match the user's derived Trading_Wallet address, THEN THE Wallet_Service SHALL reject the payment with an error code indicating address mismatch.
3. THE Wallet_Service SHALL NOT accept payments originating from the user's EOA_Address, as the EOA is used solely for authentication and does not hold trading funds.
4. THE Wallet_Service SHALL cache the derived Trading_Wallet address for the duration of the Lambda invocation to avoid redundant derivation calls within the same request.
