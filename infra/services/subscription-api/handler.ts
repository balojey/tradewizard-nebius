/**
 * Wallet Subscription Service - Lambda handler.
 *
 * Manages wallet-based subscriptions, credit purchases, and payment verification
 * using on-chain USDC.e transfers on Polygon. Replaces the previous Stripe-based handler.
 *
 * Routes:
 *   GET    /subscriptions                  → Current subscription + credits
 *   POST   /subscriptions                  → Verify tx hash and activate plan
 *   DELETE  /subscriptions/{subscriptionId} → Cancel subscription
 *   POST   /subscriptions/renew            → Manual renewal (verify tx hash)
 *   POST   /credits/purchase               → Verify tx hash and add credits
 *   GET    /wallet/balance                 → Read USDC.e balance from blockchain
 *   GET    /payments/history               → Paginated payment transaction history
 *
 * Environment variables:
 *   - DB_SECRET_ARN: Secrets Manager ARN for RDS credentials
 *   - DB_HOST: RDS endpoint hostname
 *   - PLATFORM_WALLET_ADDRESS: TradeWizard receiving wallet address
 *   - USDC_CONTRACT_ADDRESS: USDC.e contract on Polygon
 *   - POLYGON_RPC_URL: Polygon JSON-RPC endpoint
 *   - SAFE_FACTORY_ADDRESS: Safe factory contract for deterministic address derivation
 *   - DEDUP_TABLE: DynamoDB table for renewal deduplication
 *
 * Requirements: 5.1, 5.2, 5.4, 5.5
 */

import { APIGatewayProxyHandler, APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import {
  verifyTransaction,
  readBalance,
  readCollateralAllowances,
  deriveSafeAddress,
  type TransferVerification,
  type VerificationResult,
} from '../shared/chain-verification';
import {
  PLANS,
  CREDIT_PACKS,
  toUsdcUnits,
  isValidPlanId,
  isValidPackId,
  getPlan,
  getCreditPack,
  FREE_TRIAL_DURATION_DAYS,
  type PlanId,
  type CreditPackId,
} from '../shared/plans';
import { CREDIT_QUERIES, WALLET_QUERIES, TRIAL_QUERIES, encodeCursor, decodeCursor, resetFreePlanIfCycleExpired } from '../shared/credits';
import { getDbCredentials } from '../shared/db';

// ─── Error Codes ─────────────────────────────────────────────────────────────

export const ERROR_CODES = {
  UNAUTHORIZED: 'UNAUTHORIZED',
  NOT_FOUND: 'NOT_FOUND',
  METHOD_NOT_ALLOWED: 'METHOD_NOT_ALLOWED',
  INVALID_REQUEST: 'INVALID_REQUEST',
  INVALID_PLAN: 'INVALID_PLAN',
  INVALID_PACK: 'INVALID_PACK',
  SAME_PLAN: 'SAME_PLAN',
  ALREADY_CANCELLED: 'ALREADY_CANCELLED',
  NO_ACTIVE_SUBSCRIPTION: 'NO_ACTIVE_SUBSCRIPTION',
  CANNOT_CANCEL_FREE: 'CANNOT_CANCEL_FREE',
  VERIFICATION_FAILED: 'VERIFICATION_FAILED',
  SENDER_MISMATCH: 'SENDER_MISMATCH',
  RECIPIENT_MISMATCH: 'RECIPIENT_MISMATCH',
  AMOUNT_MISMATCH: 'AMOUNT_MISMATCH',
  TX_NOT_FOUND: 'TX_NOT_FOUND',
  TX_PENDING: 'TX_PENDING',
  TX_REVERTED: 'TX_REVERTED',
  DUPLICATE_TX: 'DUPLICATE_TX',
  INVALID_CURSOR: 'INVALID_CURSOR',
  TRIAL_NOT_ELIGIBLE: 'TRIAL_NOT_ELIGIBLE',
  TRIAL_PLAN_NOT_ALLOWED: 'TRIAL_PLAN_NOT_ALLOWED',
  INTERNAL_ERROR: 'INTERNAL_ERROR',
} as const;

// ─── CORS Headers ────────────────────────────────────────────────────────────

const CORS_HEADERS = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type,Authorization',
  'Access-Control-Allow-Methods': 'GET,POST,DELETE,OPTIONS',
};

// ─── Types ───────────────────────────────────────────────────────────────────

interface ErrorResponse {
  error: string;
  message: string;
  details?: Record<string, unknown>;
}

// ─── Handler ─────────────────────────────────────────────────────────────────

export const handler: APIGatewayProxyHandler = async (event): Promise<APIGatewayProxyResult> => {
  // Handle CORS preflight
  if (event.httpMethod === 'OPTIONS') {
    return respond(200, {});
  }

  try {
    // Extract userId from JWT claims
    const userId = extractUserId(event);
    if (!userId) {
      return respondError(401, ERROR_CODES.UNAUTHORIZED, 'Missing or invalid authentication');
    }

    // Route dispatcher
    const { httpMethod, path } = event;
    const route = resolveRoute(httpMethod, path, event.pathParameters as Record<string, string> | null);

    switch (route) {
      case 'GET /subscriptions':
        return await handleGetSubscription(userId);

      case 'POST /subscriptions':
        return await handleCreateSubscription(userId, event.body);

      case 'POST /subscriptions/trial':
        return await handleStartTrial(userId, event.body);

      case 'DELETE /subscriptions/{id}':
        return await handleCancelSubscription(
          userId,
          event.pathParameters?.subscriptionId || event.pathParameters?.id || extractPathParam(event.path, '/subscriptions/')
        );

      case 'POST /subscriptions/renew':
        return await handleRenewSubscription(userId, event.body);

      case 'POST /credits/purchase':
        return await handlePurchaseCredits(userId, event.body);

      case 'GET /wallet/balance':
        return await handleGetWalletBalance(userId);

      case 'GET /payments/history':
        return await handleGetPaymentHistory(userId, event.queryStringParameters as Record<string, string> | null);

      case 'NOT_FOUND':
        return respondError(404, ERROR_CODES.NOT_FOUND, 'Route not found');

      case 'METHOD_NOT_ALLOWED':
        return respondError(405, ERROR_CODES.METHOD_NOT_ALLOWED, 'Method not allowed for this route');

      default:
        return respondError(404, ERROR_CODES.NOT_FOUND, 'Route not found');
    }
  } catch (error) {
    console.error('Wallet service error:', error);
    return respondError(500, ERROR_CODES.INTERNAL_ERROR, 'An unexpected error occurred');
  }
};

// ─── Route Resolution ────────────────────────────────────────────────────────

type Route =
  | 'GET /subscriptions'
  | 'POST /subscriptions'
  | 'POST /subscriptions/trial'
  | 'DELETE /subscriptions/{id}'
  | 'POST /subscriptions/renew'
  | 'POST /credits/purchase'
  | 'GET /wallet/balance'
  | 'GET /payments/history'
  | 'NOT_FOUND'
  | 'METHOD_NOT_ALLOWED';

/**
 * Resolve the incoming request to a known route.
 * Handles path matching with support for path parameters.
 */
function resolveRoute(
  method: string,
  path: string,
  pathParameters: Record<string, string> | null | undefined
): Route {
  // Normalize path: remove trailing slash, handle stage prefix
  const normalizedPath = normalizePath(path);

  // Match routes
  if (normalizedPath === '/subscriptions/renew') {
    if (method === 'POST') return 'POST /subscriptions/renew';
    return 'METHOD_NOT_ALLOWED';
  }

  if (normalizedPath === '/subscriptions/trial') {
    if (method === 'POST') return 'POST /subscriptions/trial';
    return 'METHOD_NOT_ALLOWED';
  }

  if (normalizedPath === '/subscriptions') {
    if (method === 'GET') return 'GET /subscriptions';
    if (method === 'POST') return 'POST /subscriptions';
    return 'METHOD_NOT_ALLOWED';
  }

  // DELETE /subscriptions/{subscriptionId}
  if (normalizedPath.startsWith('/subscriptions/') && normalizedPath !== '/subscriptions/renew' && normalizedPath !== '/subscriptions/trial') {
    if (method === 'DELETE') return 'DELETE /subscriptions/{id}';
    return 'METHOD_NOT_ALLOWED';
  }

  if (normalizedPath === '/credits/purchase') {
    if (method === 'POST') return 'POST /credits/purchase';
    return 'METHOD_NOT_ALLOWED';
  }

  if (normalizedPath === '/wallet/balance') {
    if (method === 'GET') return 'GET /wallet/balance';
    return 'METHOD_NOT_ALLOWED';
  }

  if (normalizedPath === '/payments/history') {
    if (method === 'GET') return 'GET /payments/history';
    return 'METHOD_NOT_ALLOWED';
  }

  return 'NOT_FOUND';
}

/**
 * Normalize the request path by removing stage prefix and trailing slash.
 */
function normalizePath(path: string): string {
  // API Gateway may include a stage prefix like /dev or /prod
  // The resource path is what we care about
  let normalized = path;

  // Remove common stage prefixes
  const stagePattern = /^\/(dev|prod|staging|v1)\//;
  if (stagePattern.test(normalized)) {
    normalized = normalized.replace(stagePattern, '/');
  }

  // Remove trailing slash (but keep root /)
  if (normalized.length > 1 && normalized.endsWith('/')) {
    normalized = normalized.slice(0, -1);
  }

  return normalized;
}

/**
 * Extract a path parameter value from the URL path.
 * Used as a fallback when API Gateway pathParameters are not available.
 * Example: extractPathParam('/subscriptions/abc-123', '/subscriptions/') → 'abc-123'
 */
function extractPathParam(path: string, prefix: string): string {
  const normalized = normalizePath(path);
  if (!normalized.startsWith(prefix)) return '';
  const param = normalized.slice(prefix.length).split('/')[0];
  return param || '';
}

// ─── Route Handlers (Stubs - implemented in tasks 3.2–3.8) ──────────────────

/**
 * GET /subscriptions
 * Returns current subscription + credits for the authenticated user.
 * Reads allowance from chain to determine allowanceStatus.
 * Returns free plan defaults if no subscription exists.
 *
 * Requirements: 1.9, 6.6, 6.7
 */
async function handleGetSubscription(userId: string): Promise<APIGatewayProxyResult> {
  const creds = await getDbCredentials();
  const pg = await import('pg');
  const client = new pg.Client({
    user: creds.username,
    password: creds.password,
    host: creds.host,
    port: creds.port,
    database: creds.dbname,
    ssl: { rejectUnauthorized: false },
  });

  await client.connect();

  try {
    // userId here is the Cognito sub - join through users table to find subscription
    const result = await client.query(
      `SELECT s.id, s.user_id, s.plan, s.status, s.credits_remaining, s.credits_monthly_limit,
              s.billing_cycle_start, s.billing_cycle_end, s.wallet_address,
              s.grace_period_start, s.grace_period_end, s.cancelled_at,
              s.is_trial, s.trial_end
       FROM subscriptions s
       JOIN users u ON u.id = s.user_id
       WHERE u.cognito_sub = $1 AND s.status IN ('active', 'cancelled', 'grace_period')
       LIMIT 1`,
      [userId]
    );

    // No subscription exists → return free plan defaults
    if (result.rows.length === 0) {
      // Check trial eligibility for the response
      const userResult = await client.query(
        `SELECT u.id, u.has_used_paid_plan,
                EXISTS (
                  SELECT 1 FROM payment_transactions WHERE user_id = u.id
                  AND transaction_type IN ('subscription_payment', 'renewal_payment')
                ) AS has_payment_history
         FROM users u WHERE u.cognito_sub = $1`,
        [userId]
      );
      const trialEligible = userResult.rows.length > 0
        ? !userResult.rows[0].has_used_paid_plan && !userResult.rows[0].has_payment_history
        : true; // New/unrecognized user - assume eligible (no prior paid plan)

      return respond(200, {
        plan: 'free',
        status: 'active',
        creditsRemaining: 20,
        creditsMonthlyLimit: 20,
        billingCycleStart: null,
        billingCycleEnd: null,
        walletAddress: null,
        renewalPrice: null,
        allowanceStatus: 'not_approved',
        isTrial: false,
        trialEnd: null,
        trialEligible,
      });
    }

    const row = result.rows[0];
    const plan = row.plan as PlanId;
    const planConfig = PLANS[plan];
    const walletAddress: string | null = row.wallet_address || null;
    const isTrial: boolean = row.is_trial || false;
    const trialEnd: string | null = row.trial_end || null;

    // Lazy monthly credit reset for free-plan users with an expired billing cycle.
    // Reflects the refreshed balance/cycle in the response so the UI shows the
    // correct credits and a valid future reset date.
    if (plan === 'free' && (row.status === 'active' || row.status === 'grace_period')) {
      const reset = await resetFreePlanIfCycleExpired(client, row.user_id);
      if (reset) {
        row.credits_remaining = reset.credits_remaining;
        row.credits_monthly_limit = reset.credits_monthly_limit;
        row.billing_cycle_start = reset.billing_cycle_start;
        row.billing_cycle_end = reset.billing_cycle_end;
      }
    }

    // Determine allowance status
    let allowanceStatus: 'approved' | 'not_approved' | 'insufficient' = 'not_approved';

    if (plan !== 'free' && walletAddress && !isTrial) {
      try {
        const allowances = await readCollateralAllowances(walletAddress);
        const allowance = allowances.pusd > allowances.usdce
          ? allowances.pusd
          : allowances.usdce;
        const planPriceUnits = toUsdcUnits(planConfig.price);

        if (allowance >= planPriceUnits) {
          allowanceStatus = 'approved';
        } else if (allowance > 0n) {
          allowanceStatus = 'insufficient';
        } else {
          allowanceStatus = 'not_approved';
        }
      } catch (error) {
        // If chain read fails, default to not_approved rather than failing the request
        console.warn('Failed to read allowance from chain:', error);
        allowanceStatus = 'not_approved';
      }
    }

    // Check trial eligibility (for showing "Start Trial" buttons on other plans)
    const internalUserId = row.user_id;
    const eligibilityResult = await client.query(TRIAL_QUERIES.checkTrialEligibility, [internalUserId]);
    const trialEligible = eligibilityResult.rows.length > 0
      ? !eligibilityResult.rows[0].has_used_paid_plan && !eligibilityResult.rows[0].has_payment_history
      : false;

    return respond(200, {
      id: row.id,
      plan: row.plan,
      status: row.status,
      creditsRemaining: row.credits_remaining,
      creditsMonthlyLimit: row.credits_monthly_limit,
      billingCycleStart: row.billing_cycle_start,
      billingCycleEnd: row.billing_cycle_end,
      walletAddress,
      renewalPrice: plan !== 'free' && !isTrial ? planConfig.price : null,
      allowanceStatus,
      isTrial,
      trialEnd,
      trialEligible,
    });
  } finally {
    await client.end();
  }
}

/**
 * POST /subscriptions
 * Verify tx hash and activate plan.
 * Accepts: { planId: string, txHash: string }
 *
 * Flow:
 * 1. Validate planId (reject free plan, reject invalid)
 * 2. Get user's current subscription from DB
 * 3. Reject same-plan subscription (Req 1.12)
 * 4. Get user's wallet address, derive Safe address
 * 5. Calculate expected payment amount (handle proration for plan changes, Req 1.10)
 * 6. Verify on-chain transfer
 * 7. Atomic DB transaction: activate subscription, record payment
 * 8. Create EventBridge schedule for billing_cycle_end (Req 8.1)
 *
 * Requirements: 1.3, 1.4, 1.7, 1.8, 1.9, 1.10, 1.12, 1.13, 8.1, 8.6
 */
async function handleCreateSubscription(userId: string, body: string | null): Promise<APIGatewayProxyResult> {
  // Parse and validate request body
  if (!body) {
    return respondError(400, ERROR_CODES.INVALID_REQUEST, 'Request body is required');
  }

  let parsed: { planId?: string; txHash?: string };
  try {
    parsed = JSON.parse(body);
  } catch {
    return respondError(400, ERROR_CODES.INVALID_REQUEST, 'Invalid JSON body');
  }

  const { planId, txHash } = parsed;

  if (!planId || !txHash) {
    return respondError(400, ERROR_CODES.INVALID_REQUEST, 'planId and txHash are required');
  }

  // Validate planId
  if (!isValidPlanId(planId)) {
    return respondError(400, ERROR_CODES.INVALID_PLAN, `Invalid plan ID. Must be one of: ${Object.keys(PLANS).join(', ')}`);
  }

  // Cannot "buy" the free plan
  if (planId === 'free') {
    return respondError(400, ERROR_CODES.INVALID_PLAN, 'Cannot purchase the free plan. Free plan is the default.');
  }

  const targetPlan = getPlan(planId)!;
  const platformWallet = process.env.PLATFORM_WALLET_ADDRESS || '0x0000000000000000000000000000000000000000';

  // Connect to database
  const creds = await getDbCredentials();
  const pg = await import('pg');
  const client = new pg.Client({
    user: creds.username,
    password: creds.password,
    host: creds.host,
    port: creds.port,
    database: creds.dbname,
    ssl: { rejectUnauthorized: false },
  });

  await client.connect();

  try {
    // Resolve Cognito sub → internal user ID for DB queries
    const internalIdResult = await client.query(
      `SELECT id FROM users WHERE cognito_sub = $1 LIMIT 1`,
      [userId]
    );
    if (internalIdResult.rows.length === 0) {
      return respondError(404, ERROR_CODES.NOT_FOUND, 'User not found');
    }
    const internalUserId = internalIdResult.rows[0].id;

    // Get user's current subscription
    const subResult = await client.query(CREDIT_QUERIES.getSubscription, [internalUserId]);
    const currentSubscription = subResult.rows.length > 0 ? subResult.rows[0] : null;

    // Reject same-plan subscription (Req 1.12)
    if (currentSubscription && currentSubscription.plan === planId && currentSubscription.status === 'active') {
      return respondError(400, ERROR_CODES.SAME_PLAN, 'You are already subscribed to this plan');
    }

    // Get user's wallet address from subscription or users table
    let userWalletAddress: string | null = currentSubscription?.wallet_address || null;

    if (!userWalletAddress) {
      // Try to get wallet address from the getUserEoaAddress query
      const eoaResult = await client.query(WALLET_QUERIES.getUserEoaAddress, [internalUserId]);
      if (eoaResult.rows.length === 0 || !eoaResult.rows[0].wallet_address) {
        return respondError(400, ERROR_CODES.INVALID_REQUEST, 'No wallet address registered. Please register a wallet first.');
      }
      userWalletAddress = eoaResult.rows[0].wallet_address as string;
    }

    // Derive Safe address from the user's wallet address (Req 9.1)
    const safeAddress = deriveSafeAddress(userWalletAddress);

    // Calculate expected payment amount (handle proration for plan changes, Req 1.10)
    let expectedAmount: bigint;
    let proratedCredit = 0;
    let isUpgrade = false;

    if (currentSubscription && currentSubscription.plan !== 'free' && currentSubscription.status === 'active') {
      // User is changing from one paid plan to another - calculate proration
      isUpgrade = true;
      const currentPlan = getPlan(currentSubscription.plan as string)!;
      const billingCycleEnd = new Date(currentSubscription.billing_cycle_end);
      const now = new Date();
      const remainingMs = billingCycleEnd.getTime() - now.getTime();
      const remainingDays = Math.max(0, Math.ceil(remainingMs / (24 * 60 * 60 * 1000)));

      // prorated_credit = floor((remaining_days / 30) * current_plan_price * 100) / 100
      proratedCredit = Math.floor((remainingDays / 30) * currentPlan.price * 100) / 100;

      // Expected payment = new_plan_price - prorated_credit
      const chargeAmount = Math.max(0, targetPlan.price - proratedCredit);
      expectedAmount = toUsdcUnits(chargeAmount);
    } else {
      // New subscription or upgrading from free - full price
      expectedAmount = toUsdcUnits(targetPlan.price);
    }

    // Verify on-chain transfer (Req 1.3, 1.7)
    const verification = await verifyTransaction({
      txHash,
      expectedSender: safeAddress,
      expectedRecipient: platformWallet,
      expectedAmount,
    });

    if (!verification.verified) {
      const errorCode = verification.error || 'VERIFICATION_FAILED';
      const errorMessages: Record<string, string> = {
        TX_NOT_FOUND: 'Transaction not found on-chain',
        TX_PENDING: 'Transaction is still pending confirmation',
        TX_REVERTED: 'Transaction was reverted on-chain',
        SENDER_MISMATCH: 'Transaction sender does not match registered Trading Wallet',
        RECIPIENT_MISMATCH: 'Transaction recipient does not match Platform Wallet',
        AMOUNT_MISMATCH: `Transaction amount does not match expected payment amount`,
      };

      const statusCode = errorCode === 'TX_PENDING' ? 202
        : errorCode === 'SENDER_MISMATCH' ? 403
        : 400;

      return respondError(statusCode, errorCode, errorMessages[errorCode] || 'Verification failed', {
        ...(verification.actualSender && { actualSender: verification.actualSender }),
        ...(verification.actualRecipient && { actualRecipient: verification.actualRecipient }),
        ...(verification.actualAmount !== undefined && { actualAmount: verification.actualAmount.toString() }),
      });
    }

    // Atomic DB transaction: activate subscription + record payment (Req 1.4)
    const now = new Date();
    const billingCycleStart = now.toISOString();
    const billingCycleEnd = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000).toISOString();

    await client.query('BEGIN');

    try {
      // SELECT FOR UPDATE to prevent concurrent plan changes
      if (currentSubscription) {
        await client.query(
          'SELECT id FROM subscriptions WHERE user_id = $1 FOR UPDATE',
          [internalUserId]
        );
      }

      // Activate subscription (Req 1.8, 1.13)
      const activateResult = await client.query(WALLET_QUERIES.activateSubscription, [
        internalUserId,
        planId,
        targetPlan.creditsPerMonth,
        billingCycleStart,
        billingCycleEnd,
        userWalletAddress,
      ]);

      const subscription = activateResult.rows[0];

      // Record payment transaction
      const paymentAmount = isUpgrade ? (targetPlan.price - proratedCredit) : targetPlan.price;
      const paymentResult = await client.query(WALLET_QUERIES.recordPaymentTransaction, [
        internalUserId,
        'subscription_payment',
        paymentAmount,
        txHash,
        safeAddress,
        planId,
        null, // credit_pack_id
        null, // credits_added
      ]);

      // If this is a plan change with proration, record the proration credit
      if (isUpgrade && proratedCredit > 0) {
        await client.query(WALLET_QUERIES.recordPaymentTransaction, [
          internalUserId,
          'proration_credit',
          proratedCredit,
          txHash + '_proration', // Unique tx_hash for proration record
          safeAddress,
          planId,
          null,
          null,
        ]);
      }

      // Mark user as having used a paid plan (disqualifies from future free trials)
      await client.query(TRIAL_QUERIES.markTrialUsed, [internalUserId]);

      await client.query('COMMIT');

      // Delete old EventBridge schedule if exists (Req 8.6)
      if (currentSubscription?.eventbridge_schedule_arn) {
        await deleteEventBridgeScheduleByArn(currentSubscription.eventbridge_schedule_arn);
      }

      // Delete old reminder schedule if this is a plan change
      if (isUpgrade) {
        try {
          const { SchedulerClient, DeleteScheduleCommand } = await import('@aws-sdk/client-scheduler');
          const schedulerClientLocal = new SchedulerClient({});
          await schedulerClientLocal.send(
            new DeleteScheduleCommand({ Name: `reminder-${currentSubscription.id}` })
          );
        } catch (err: unknown) {
          const e = err as { name?: string };
          if (e.name !== 'ResourceNotFoundException') {
            console.warn('Failed to delete old reminder schedule:', err);
          }
        }
      }

      // Create EventBridge schedule for billing_cycle_end (Req 8.1)
      let scheduleArn: string | null = null;
      try {
        scheduleArn = await createRenewalSchedule(subscription.id, billingCycleEnd);

        // Store the schedule ARN on the subscription
        if (scheduleArn) {
          await client.query(
            'UPDATE subscriptions SET eventbridge_schedule_arn = $1 WHERE id = $2',
            [scheduleArn, subscription.id]
          );
        }
      } catch (scheduleError) {
        // Log but don't fail the subscription activation
        console.error('Failed to create EventBridge schedule:', scheduleError);
      }

      // Create reminder schedule 3 days before billing_cycle_end (Req 2.8)
      try {
        await createReminderSchedule(subscription.id, billingCycleEnd);
      } catch (reminderError) {
        // Log but don't fail the subscription activation
        console.error('Failed to create reminder schedule:', reminderError);
      }

      return respond(200, {
        subscription: {
          id: subscription.id,
          plan: subscription.plan,
          status: subscription.status,
          creditsRemaining: subscription.credits_remaining,
          creditsMonthlyLimit: subscription.credits_monthly_limit,
          billingCycleStart: subscription.billing_cycle_start,
          billingCycleEnd: subscription.billing_cycle_end,
        },
        payment: {
          txHash,
          amount: paymentAmount,
          type: 'subscription_payment',
        },
      });
    } catch (txError: unknown) {
      await client.query('ROLLBACK');

      // Handle duplicate tx_hash (UNIQUE constraint violation)
      if (txError instanceof Error && 'code' in txError && (txError as { code: string }).code === '23505') {
        return respondError(409, ERROR_CODES.DUPLICATE_TX, 'This transaction hash has already been used for a payment');
      }

      throw txError;
    }
  } finally {
    await client.end();
  }
}

/**
 * POST /subscriptions/trial
 * Start a 30-day free trial for a paid plan.
 * Accepts: { planId: string }
 *
 * Rules:
 * - Only Starter and Pro plans are eligible for free trial
 * - Elite plan is NOT eligible
 * - Credit packs are NOT eligible
 * - User must have NEVER purchased a paid plan before
 * - Users currently on the free plan (who haven't paid before) ARE eligible
 * - Only one trial per user lifetime
 *
 * Flow:
 * 1. Validate planId (must be starter or pro)
 * 2. Check trial eligibility (has_used_paid_plan flag + payment history)
 * 3. Activate trial subscription with trial_end = now + 30 days
 * 4. Mark user as has_used_paid_plan = TRUE
 * 5. Create EventBridge schedule for trial expiry
 */
async function handleStartTrial(userId: string, body: string | null): Promise<APIGatewayProxyResult> {
  // Parse and validate request body
  if (!body) {
    return respondError(400, ERROR_CODES.INVALID_REQUEST, 'Request body is required');
  }

  let parsed: { planId?: string };
  try {
    parsed = JSON.parse(body);
  } catch {
    return respondError(400, ERROR_CODES.INVALID_REQUEST, 'Invalid JSON body');
  }

  const { planId } = parsed;

  if (!planId) {
    return respondError(400, ERROR_CODES.INVALID_REQUEST, 'planId is required');
  }

  // Validate planId
  if (!isValidPlanId(planId)) {
    return respondError(400, ERROR_CODES.INVALID_PLAN, `Invalid plan ID. Must be one of: ${Object.keys(PLANS).join(', ')}`);
  }

  // Only starter and pro are eligible for trial
  const targetPlan = getPlan(planId)!;
  if (!targetPlan.trialEligible) {
    return respondError(400, ERROR_CODES.TRIAL_PLAN_NOT_ALLOWED, 'Free trial is only available for Starter and Pro plans. Elite plan is not eligible for free trial.');
  }

  // Connect to database
  const creds = await getDbCredentials();
  const pg = await import('pg');
  const client = new pg.Client({
    user: creds.username,
    password: creds.password,
    host: creds.host,
    port: creds.port,
    database: creds.dbname,
    ssl: { rejectUnauthorized: false },
  });

  await client.connect();

  try {
    // Resolve Cognito sub → internal user ID
    const internalIdResult = await client.query(
      `SELECT id FROM users WHERE cognito_sub = $1 LIMIT 1`,
      [userId]
    );
    if (internalIdResult.rows.length === 0) {
      return respondError(404, ERROR_CODES.NOT_FOUND, 'User not found');
    }
    const internalUserId = internalIdResult.rows[0].id;

    // Check trial eligibility
    const eligibilityResult = await client.query(TRIAL_QUERIES.checkTrialEligibility, [internalUserId]);

    if (eligibilityResult.rows.length === 0) {
      return respondError(404, ERROR_CODES.NOT_FOUND, 'User not found');
    }

    const { has_used_paid_plan, has_payment_history } = eligibilityResult.rows[0];

    if (has_used_paid_plan || has_payment_history) {
      return respondError(403, ERROR_CODES.TRIAL_NOT_ELIGIBLE, 'Free trial is only available for users who have never purchased a paid plan before.');
    }

    // Check if user already has an active non-free subscription (e.g. already on trial)
    const existingSubResult = await client.query(CREDIT_QUERIES.getSubscription, [internalUserId]);
    if (existingSubResult.rows.length > 0 && existingSubResult.rows[0].plan !== 'free') {
      return respondError(403, ERROR_CODES.TRIAL_NOT_ELIGIBLE, 'You already have an active paid plan or trial. Free trial is only available once.');
    }

    // Calculate trial dates
    const now = new Date();
    const trialEnd = new Date(now.getTime() + FREE_TRIAL_DURATION_DAYS * 24 * 60 * 60 * 1000);
    const billingCycleStart = now.toISOString();
    const billingCycleEnd = trialEnd.toISOString();

    // Atomic transaction: activate trial + mark user
    await client.query('BEGIN');

    try {
      // Activate trial subscription
      const activateResult = await client.query(TRIAL_QUERIES.activateTrial, [
        internalUserId,
        planId,
        targetPlan.creditsPerMonth,
        trialEnd.toISOString(),
        billingCycleStart,
        billingCycleEnd,
      ]);

      const subscription = activateResult.rows[0];

      // Mark user as has_used_paid_plan to prevent future trials
      await client.query(TRIAL_QUERIES.markTrialUsed, [internalUserId]);

      await client.query('COMMIT');

      // Create EventBridge schedule for trial expiry (reuses renewal schedule logic)
      let scheduleArn: string | null = null;
      try {
        scheduleArn = await createTrialExpirySchedule(subscription.id, trialEnd.toISOString());

        if (scheduleArn) {
          await client.query(
            'UPDATE subscriptions SET eventbridge_schedule_arn = $1 WHERE id = $2',
            [scheduleArn, subscription.id]
          );
        }
      } catch (scheduleError) {
        console.error('Failed to create trial expiry schedule:', scheduleError);
      }

      return respond(200, {
        subscription: {
          id: subscription.id,
          plan: subscription.plan,
          status: subscription.status,
          creditsRemaining: subscription.credits_remaining,
          creditsMonthlyLimit: subscription.credits_monthly_limit,
          billingCycleStart: subscription.billing_cycle_start,
          billingCycleEnd: subscription.billing_cycle_end,
          isTrial: true,
          trialEnd: trialEnd.toISOString(),
        },
        message: `Your ${FREE_TRIAL_DURATION_DAYS}-day free trial of the ${targetPlan.name} plan has started!`,
      });
    } catch (txError) {
      await client.query('ROLLBACK');
      throw txError;
    }
  } finally {
    await client.end();
  }
}

/**
 * Create an EventBridge Scheduler schedule for trial expiry.
 * When the trial ends, the subscription is downgraded to free.
 */
async function createTrialExpirySchedule(subscriptionId: string, trialEnd: string): Promise<string | null> {
  try {
    const { SchedulerClient, CreateScheduleCommand } = await import('@aws-sdk/client-scheduler');
    const schedulerClient = new SchedulerClient({});

    const scheduleName = `trial-expiry-${subscriptionId}`;
    const scheduleDate = new Date(trialEnd);

    const scheduleExpression = `at(${scheduleDate.toISOString().replace(/\.\d{3}Z$/, '')})`;

    const renewalQueueArn = process.env.RENEWAL_QUEUE_ARN;
    const scheduleRoleArn = process.env.SCHEDULER_ROLE_ARN;

    if (!renewalQueueArn || !scheduleRoleArn) {
      console.warn('RENEWAL_QUEUE_ARN or SCHEDULER_ROLE_ARN not set, skipping trial expiry schedule');
      return null;
    }

    const result = await schedulerClient.send(
      new CreateScheduleCommand({
        Name: scheduleName,
        ScheduleExpression: scheduleExpression,
        ScheduleExpressionTimezone: 'UTC',
        FlexibleTimeWindow: { Mode: 'OFF' },
        Target: {
          Arn: renewalQueueArn,
          RoleArn: scheduleRoleArn,
          Input: JSON.stringify({
            type: 'trial_expiry',
            subscriptionId,
            trialEnd,
          }),
        },
        ActionAfterCompletion: 'DELETE',
      })
    );

    return result.ScheduleArn || null;
  } catch (error) {
    console.error('Failed to create trial expiry schedule:', error);
    return null;
  }
}

/**
 * Create an EventBridge Scheduler schedule for subscription renewal.
 * The schedule fires at billing_cycle_end and targets the renewal Lambda.
 *
 * Requirements: 8.1
 */
async function createRenewalSchedule(subscriptionId: string, billingCycleEnd: string): Promise<string | null> {
  try {
    const { SchedulerClient, CreateScheduleCommand } = await import('@aws-sdk/client-scheduler');
    const schedulerClient = new SchedulerClient({});

    const scheduleName = `renewal-${subscriptionId}`;
    const scheduleDate = new Date(billingCycleEnd);

    // EventBridge Scheduler uses at() expression for one-time schedules
    const scheduleExpression = `at(${scheduleDate.toISOString().replace(/\.\d{3}Z$/, '')})`;

    const renewalQueueArn = process.env.RENEWAL_QUEUE_ARN;
    const scheduleRoleArn = process.env.SCHEDULER_ROLE_ARN;

    if (!renewalQueueArn || !scheduleRoleArn) {
      console.warn('RENEWAL_QUEUE_ARN or SCHEDULER_ROLE_ARN not set, skipping schedule creation');
      return null;
    }

    const result = await schedulerClient.send(
      new CreateScheduleCommand({
        Name: scheduleName,
        ScheduleExpression: scheduleExpression,
        ScheduleExpressionTimezone: 'UTC',
        FlexibleTimeWindow: { Mode: 'OFF' },
        Target: {
          Arn: renewalQueueArn,
          RoleArn: scheduleRoleArn,
          Input: JSON.stringify({
            subscriptionId,
            billingCycleEnd,
          }),
        },
        ActionAfterCompletion: 'DELETE',
      })
    );

    return result.ScheduleArn || null;
  } catch (error) {
    console.error('Failed to create renewal schedule:', error);
    return null;
  }
}

/**
 * Create an EventBridge Scheduler schedule for a pre-renewal reminder.
 * Fires 3 days before billing_cycle_end to prompt users without allowance to
 * either approve an allowance or manually renew.
 *
 * Payload includes `{ type: 'reminder', subscriptionId, billingCycleEnd }` so the
 * renewal handler can distinguish reminder events from actual renewal events.
 *
 * Requirements: 2.8, 8.1
 */
async function createReminderSchedule(subscriptionId: string, billingCycleEnd: string): Promise<string | null> {
  try {
    const { SchedulerClient, CreateScheduleCommand } = await import('@aws-sdk/client-scheduler');
    const schedulerClient = new SchedulerClient({});

    const scheduleName = `reminder-${subscriptionId}`;
    const billingEndDate = new Date(billingCycleEnd);

    // Fire 3 days before billing_cycle_end
    const reminderDate = new Date(billingEndDate.getTime() - 3 * 24 * 60 * 60 * 1000);

    // If the reminder date is already in the past, skip creation
    if (reminderDate.getTime() <= Date.now()) {
      console.log('Reminder date is in the past, skipping reminder schedule creation');
      return null;
    }

    const scheduleExpression = `at(${reminderDate.toISOString().replace(/\.\d{3}Z$/, '')})`;

    const renewalQueueArn = process.env.RENEWAL_QUEUE_ARN;
    const scheduleRoleArn = process.env.SCHEDULER_ROLE_ARN;

    if (!renewalQueueArn || !scheduleRoleArn) {
      console.warn('RENEWAL_QUEUE_ARN or SCHEDULER_ROLE_ARN not set, skipping reminder schedule creation');
      return null;
    }

    const result = await schedulerClient.send(
      new CreateScheduleCommand({
        Name: scheduleName,
        ScheduleExpression: scheduleExpression,
        ScheduleExpressionTimezone: 'UTC',
        FlexibleTimeWindow: { Mode: 'OFF' },
        Target: {
          Arn: renewalQueueArn,
          RoleArn: scheduleRoleArn,
          Input: JSON.stringify({
            type: 'reminder',
            subscriptionId,
            billingCycleEnd,
          }),
        },
        ActionAfterCompletion: 'DELETE',
      })
    );

    return result.ScheduleArn || null;
  } catch (error) {
    console.error('Failed to create reminder schedule:', error);
    return null;
  }
}

/**
 * DELETE /subscriptions/{subscriptionId}
 * Cancel subscription.
 * Verifies ownership, rejects if already cancelled or free plan.
 * If in grace period, immediately downgrades to free with 5 credits.
 * Otherwise marks as cancelled and retains access until billing_cycle_end.
 * Deletes EventBridge schedule in both cases.
 *
 * Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 8.6
 */
async function handleCancelSubscription(userId: string, subscriptionId: string): Promise<APIGatewayProxyResult> {
  if (!subscriptionId) {
    return respondError(400, ERROR_CODES.INVALID_REQUEST, 'Subscription ID is required');
  }

  const creds = await getDbCredentials();
  const pg = await import('pg');
  const client = new pg.Client({
    user: creds.username,
    password: creds.password,
    host: creds.host,
    port: creds.port,
    database: creds.dbname,
    ssl: { rejectUnauthorized: false },
  });

  await client.connect();

  try {
    // Resolve Cognito sub → internal user ID for ownership verification
    const internalIdResult = await client.query(
      `SELECT id FROM users WHERE cognito_sub = $1 LIMIT 1`,
      [userId]
    );
    if (internalIdResult.rows.length === 0) {
      return respondError(404, ERROR_CODES.NOT_FOUND, 'User not found');
    }
    const internalUserId = internalIdResult.rows[0].id;

    // Get subscription by ID (outside transaction for validation)
    const subResult = await client.query(
      `SELECT id, user_id, plan, status, credits_remaining, billing_cycle_end, eventbridge_schedule_arn, is_trial
       FROM subscriptions WHERE id = $1 LIMIT 1`,
      [subscriptionId]
    );

    if (subResult.rows.length === 0) {
      return respondError(404, ERROR_CODES.NOT_FOUND, 'Subscription not found');
    }

    const subscription = subResult.rows[0];

    // Verify ownership
    if (subscription.user_id !== internalUserId) {
      return respondError(404, ERROR_CODES.NOT_FOUND, 'Subscription not found');
    }

    // Reject if free plan (Req 3.5)
    if (subscription.plan === 'free') {
      return respondError(400, ERROR_CODES.CANNOT_CANCEL_FREE, 'Cannot cancel a free plan subscription');
    }

    // Reject if already cancelled (Req 3.5)
    if (subscription.status === 'cancelled') {
      return respondError(400, ERROR_CODES.ALREADY_CANCELLED, 'Subscription is already cancelled');
    }

    // Use DB transaction for atomicity
    await client.query('BEGIN');

    try {
      // If in grace period → immediately downgrade to free with 5 credits (Req 3.6)
      if (subscription.status === 'grace_period') {
        await client.query(
          `UPDATE subscriptions
           SET plan = 'free',
               status = 'active',
               credits_remaining = 20,
               credits_monthly_limit = 20,
               cancelled_at = now(),
               grace_period_start = NULL,
               grace_period_end = NULL,
               eventbridge_schedule_arn = NULL
           WHERE id = $1 AND user_id = $2`,
          [subscriptionId, internalUserId]
        );

        await client.query('COMMIT');

        // Delete EventBridge schedule (Req 8.6) - outside transaction since it's an external call
        await deleteEventBridgeScheduleForSubscription(subscriptionId, subscription.eventbridge_schedule_arn);

        // Delete reminder schedule as well
        try {
          const { SchedulerClient, DeleteScheduleCommand } = await import('@aws-sdk/client-scheduler');
          const schedulerClientLocal = new SchedulerClient({});
          await schedulerClientLocal.send(
            new DeleteScheduleCommand({ Name: `reminder-${subscriptionId}` })
          );
        } catch (err: unknown) {
          const e = err as { name?: string };
          if (e.name !== 'ResourceNotFoundException') {
            console.warn('Failed to delete reminder schedule on grace period cancel:', err);
          }
        }

        return respond(200, {
          message: 'Subscription cancelled',
          expiresAt: 'immediately',
          plan: subscription.plan,
          downgradedToFree: true,
        });
      }

      // If on a free trial → immediately downgrade to free (no billing cycle to honor)
      if (subscription.is_trial) {
        await client.query(
          `UPDATE subscriptions
           SET plan = 'free',
               status = 'active',
               credits_remaining = 20,
               credits_monthly_limit = 20,
               cancelled_at = now(),
               is_trial = FALSE,
               trial_end = NULL,
               eventbridge_schedule_arn = NULL
           WHERE id = $1 AND user_id = $2`,
          [subscriptionId, internalUserId]
        );

        await client.query('COMMIT');

        // Delete trial expiry schedule
        try {
          const { SchedulerClient, DeleteScheduleCommand } = await import('@aws-sdk/client-scheduler');
          const schedulerClientLocal = new SchedulerClient({});
          await schedulerClientLocal.send(
            new DeleteScheduleCommand({ Name: `trial-expiry-${subscriptionId}` })
          );
        } catch (err: unknown) {
          const e = err as { name?: string };
          if (e.name !== 'ResourceNotFoundException') {
            console.warn('Failed to delete trial expiry schedule on cancel:', err);
          }
        }

        return respond(200, {
          message: 'Free trial cancelled',
          expiresAt: 'immediately',
          plan: subscription.plan,
          downgradedToFree: true,
        });
      }

      // Active subscription: mark as cancelled, set cancelled_at (Req 3.1)
      // Subscription remains active until billing_cycle_end (Req 3.2)
      await client.query(
        `UPDATE subscriptions
         SET status = 'cancelled',
             cancelled_at = now(),
             eventbridge_schedule_arn = NULL
         WHERE id = $1 AND user_id = $2`,
        [subscriptionId, internalUserId]
      );

      await client.query('COMMIT');

      // Delete EventBridge schedule (Req 8.6, 3.4) - outside transaction since it's an external call
      await deleteEventBridgeScheduleForSubscription(subscriptionId, subscription.eventbridge_schedule_arn);

      // Delete reminder schedule as well
      try {
        const { SchedulerClient, DeleteScheduleCommand } = await import('@aws-sdk/client-scheduler');
        const schedulerClientLocal = new SchedulerClient({});
        await schedulerClientLocal.send(
          new DeleteScheduleCommand({ Name: `reminder-${subscriptionId}` })
        );
      } catch (err: unknown) {
        const e = err as { name?: string };
        if (e.name !== 'ResourceNotFoundException') {
          console.warn('Failed to delete reminder schedule on cancel:', err);
        }
      }

      return respond(200, {
        message: 'Subscription cancelled',
        expiresAt: subscription.billing_cycle_end,
        plan: subscription.plan,
        downgradedToFree: false,
      });
    } catch (txError) {
      await client.query('ROLLBACK');
      throw txError;
    }
  } finally {
    await client.end();
  }
}

/**
 * Delete an EventBridge Scheduler schedule for a subscription.
 * Tries by name pattern `renewal-${subscriptionId}` first, then falls back to ARN-based deletion.
 * Silently handles cases where the schedule doesn't exist.
 *
 * Requirements: 8.6
 */
async function deleteEventBridgeScheduleForSubscription(subscriptionId: string, scheduleArn: string | null): Promise<void> {
  try {
    const { SchedulerClient, DeleteScheduleCommand } = await import('@aws-sdk/client-scheduler');
    const schedulerClient = new SchedulerClient({});

    // Use the standard naming pattern: renewal-${subscriptionId}
    const scheduleName = `renewal-${subscriptionId}`;

    await schedulerClient.send(
      new DeleteScheduleCommand({
        Name: scheduleName,
      })
    );
  } catch (error: unknown) {
    const err = error as { name?: string };
    if (err.name === 'ResourceNotFoundException') {
      // Schedule doesn't exist - try ARN-based deletion as fallback
      if (scheduleArn) {
        await deleteEventBridgeScheduleByArn(scheduleArn);
      }
      return;
    }
    console.error('Failed to delete EventBridge schedule:', error);
    // Don't throw - cancellation should succeed even if schedule deletion fails
  }
}

/**
 * Delete an EventBridge Scheduler schedule by its ARN (fallback method).
 * Extracts the schedule name from the ARN and deletes it.
 *
 * Requirements: 8.6
 */
async function deleteEventBridgeScheduleByArn(scheduleArn: string): Promise<void> {
  try {
    const { SchedulerClient, DeleteScheduleCommand } = await import('@aws-sdk/client-scheduler');
    const schedulerClient = new SchedulerClient({});

    // Extract schedule name from ARN: arn:aws:scheduler:region:account:schedule/group/name
    // or arn:aws:scheduler:region:account:schedule/name
    const arnParts = scheduleArn.split('/');
    const scheduleName = arnParts[arnParts.length - 1];

    // Determine group name if present
    let groupName: string | undefined;
    if (arnParts.length > 2) {
      // ARN format: .../group/name → group is second-to-last
      groupName = arnParts[arnParts.length - 2];
      // If groupName is "schedule" it's the default group
      if (groupName === 'schedule') {
        groupName = undefined;
      }
    }

    await schedulerClient.send(
      new DeleteScheduleCommand({
        Name: scheduleName,
        GroupName: groupName,
      })
    );
  } catch (error: unknown) {
    // If schedule doesn't exist, that's fine - it may have already been deleted
    const err = error as { name?: string };
    if (err.name === 'ResourceNotFoundException') {
      console.warn(`EventBridge schedule not found (already deleted): ${scheduleArn}`);
      return;
    }
    console.error('Failed to delete EventBridge schedule by ARN:', error);
    // Don't throw - cancellation should succeed even if schedule deletion fails
  }
}

/**
 * POST /subscriptions/renew
 * Manual renewal - verify tx hash.
 * Accepts: { txHash: string }
 *
 * Flow:
 * 1. Validate txHash is present
 * 2. Get user's current subscription from DB
 * 3. If no subscription or plan is 'free' → return error
 * 4. If subscription is cancelled → return error
 * 5. Derive Safe address from wallet address
 * 6. Verify on-chain transfer (sender=Safe, recipient=Platform, amount=plan price)
 * 7. On success:
 *    - Reset credits to plan monthly limit
 *    - Advance billing_cycle: start = previous end, end = previous end + 30 days
 *    - Record payment_transaction with type 'renewal_payment'
 *    - Delete old EventBridge schedule if exists
 *    - Create new EventBridge schedule for new billing_cycle_end
 * 8. Clear grace period fields if was in grace period
 * 9. Return success response with updated subscription data
 *
 * Requirements: 2.9, 2.3
 */
async function handleRenewSubscription(userId: string, body: string | null): Promise<APIGatewayProxyResult> {
  // Parse and validate request body
  if (!body) {
    return respondError(400, ERROR_CODES.INVALID_REQUEST, 'Request body is required');
  }

  let parsed: { txHash?: string };
  try {
    parsed = JSON.parse(body);
  } catch {
    return respondError(400, ERROR_CODES.INVALID_REQUEST, 'Invalid JSON body');
  }

  const { txHash } = parsed;

  if (!txHash) {
    return respondError(400, ERROR_CODES.INVALID_REQUEST, 'txHash is required');
  }

  const platformWallet = process.env.PLATFORM_WALLET_ADDRESS || '0x0000000000000000000000000000000000000000';

  // Connect to database
  const creds = await getDbCredentials();
  const pg = await import('pg');
  const client = new pg.Client({
    user: creds.username,
    password: creds.password,
    host: creds.host,
    port: creds.port,
    database: creds.dbname,
    ssl: { rejectUnauthorized: false },
  });

  await client.connect();

  try {
    // Resolve Cognito sub → internal user ID for DB queries
    const internalIdResult = await client.query(
      `SELECT id FROM users WHERE cognito_sub = $1 LIMIT 1`,
      [userId]
    );
    if (internalIdResult.rows.length === 0) {
      return respondError(404, ERROR_CODES.NOT_FOUND, 'User not found');
    }
    const internalUserId = internalIdResult.rows[0].id;

    // Get user's current subscription (including eventbridge_schedule_arn for renewal)
    const subResult = await client.query(
      `SELECT id, user_id, plan, status, credits_remaining, credits_monthly_limit,
              billing_cycle_start, billing_cycle_end, wallet_address,
              grace_period_start, grace_period_end, cancelled_at, eventbridge_schedule_arn
       FROM subscriptions
       WHERE user_id = $1 AND status IN ('active', 'cancelled', 'grace_period')
       LIMIT 1`,
      [internalUserId]
    );

    if (subResult.rows.length === 0) {
      return respondError(404, ERROR_CODES.NO_ACTIVE_SUBSCRIPTION, 'No subscription found. Please subscribe to a plan first.');
    }

    const subscription = subResult.rows[0];

    // Cannot renew a free plan
    if (subscription.plan === 'free') {
      return respondError(400, ERROR_CODES.INVALID_REQUEST, 'Cannot renew a free plan');
    }

    // Cannot renew a cancelled subscription
    if (subscription.status === 'cancelled') {
      return respondError(400, ERROR_CODES.ALREADY_CANCELLED, 'Cannot renew a cancelled subscription');
    }

    const walletAddress: string | null = subscription.wallet_address;

    if (!walletAddress) {
      return respondError(400, ERROR_CODES.INVALID_REQUEST, 'No wallet address registered for this subscription');
    }

    // Derive Safe address from the user's wallet address
    const safeAddress = deriveSafeAddress(walletAddress);

    // Get plan configuration for price verification
    const plan = subscription.plan as PlanId;
    const planConfig = PLANS[plan];

    // Verify on-chain transfer (sender=Safe, recipient=Platform, amount=plan price)
    const verification = await verifyTransaction({
      txHash,
      expectedSender: safeAddress,
      expectedRecipient: platformWallet,
      expectedAmount: toUsdcUnits(planConfig.price),
    });

    if (!verification.verified) {
      const errorCode = verification.error || 'VERIFICATION_FAILED';
      const errorMessages: Record<string, string> = {
        TX_NOT_FOUND: 'Transaction not found on-chain',
        TX_PENDING: 'Transaction is still pending confirmation',
        TX_REVERTED: 'Transaction was reverted on-chain',
        SENDER_MISMATCH: 'Transaction sender does not match registered Trading Wallet',
        RECIPIENT_MISMATCH: 'Transaction recipient does not match Platform Wallet',
        AMOUNT_MISMATCH: `Transaction amount does not match plan price (${planConfig.price} USDC.e)`,
      };

      const statusCode = errorCode === 'TX_PENDING' ? 202
        : errorCode === 'SENDER_MISMATCH' ? 403
        : 400;

      return respondError(statusCode, errorCode, errorMessages[errorCode] || 'Verification failed', {
        ...(verification.actualSender && { actualSender: verification.actualSender }),
        ...(verification.actualRecipient && { actualRecipient: verification.actualRecipient }),
        ...(verification.actualAmount !== undefined && { actualAmount: verification.actualAmount.toString() }),
      });
    }

    // Verification passed - process renewal in a transaction
    await client.query('BEGIN');

    try {
      // Lock the subscription row and get eventbridge_schedule_arn
      const lockResult = await client.query(
        `SELECT id, billing_cycle_end, eventbridge_schedule_arn
         FROM subscriptions
         WHERE user_id = $1 AND status IN ('active', 'grace_period')
         FOR UPDATE`,
        [internalUserId]
      );

      if (lockResult.rows.length === 0) {
        await client.query('ROLLBACK');
        return respondError(400, ERROR_CODES.NO_ACTIVE_SUBSCRIPTION, 'Subscription is no longer active');
      }

      const lockedSub = lockResult.rows[0];
      const oldScheduleArn: string | null = lockedSub.eventbridge_schedule_arn;

      // Advance billing cycle: new start = previous end, new end = previous end + 30 days
      const previousBillingCycleEnd = new Date(lockedSub.billing_cycle_end);
      const newBillingCycleStart = previousBillingCycleEnd.toISOString();
      const newBillingCycleEnd = new Date(previousBillingCycleEnd.getTime() + 30 * 24 * 60 * 60 * 1000).toISOString();

      // Reset credits and advance billing cycle (also clears grace period fields)
      const renewalResult = await client.query(WALLET_QUERIES.processRenewal, [
        planConfig.creditsPerMonth,
        newBillingCycleStart,
        newBillingCycleEnd,
        lockedSub.id,
      ]);

      if (renewalResult.rows.length === 0) {
        await client.query('ROLLBACK');
        return respondError(400, ERROR_CODES.NO_ACTIVE_SUBSCRIPTION, 'Subscription is no longer active');
      }

      const updatedSubscription = renewalResult.rows[0];

      // Record payment transaction with type='renewal_payment'
      await client.query(WALLET_QUERIES.recordPaymentTransaction, [
        internalUserId,
        'renewal_payment',
        planConfig.price,
        txHash,
        safeAddress,
        plan,
        null, // credit_pack_id
        null, // credits_added
      ]);

      await client.query('COMMIT');

      // Delete old EventBridge schedule if exists
      if (oldScheduleArn) {
        await deleteEventBridgeScheduleByArn(oldScheduleArn);
      }

      // Delete old reminder schedule (may not exist if already fired)
      try {
        const { SchedulerClient, DeleteScheduleCommand } = await import('@aws-sdk/client-scheduler');
        const schedulerClientLocal = new SchedulerClient({});
        await schedulerClientLocal.send(
          new DeleteScheduleCommand({ Name: `reminder-${lockedSub.id}` })
        );
      } catch (err: unknown) {
        const e = err as { name?: string };
        if (e.name !== 'ResourceNotFoundException') {
          console.warn('Failed to delete old reminder schedule on manual renewal:', err);
        }
      }

      // Create new EventBridge schedule for new billing_cycle_end
      const newScheduleArn = await createRenewalSchedule(lockedSub.id, newBillingCycleEnd);

      // Update the schedule ARN in the database
      if (newScheduleArn) {
        await client.query(
          'UPDATE subscriptions SET eventbridge_schedule_arn = $1 WHERE id = $2',
          [newScheduleArn, lockedSub.id]
        );
      }

      // Create reminder schedule 3 days before new billing_cycle_end (Req 2.8)
      try {
        await createReminderSchedule(lockedSub.id, newBillingCycleEnd);
      } catch (reminderError) {
        console.error('Failed to create reminder schedule on manual renewal:', reminderError);
      }

      return respond(200, {
        message: 'Subscription renewed successfully',
        subscription: {
          id: updatedSubscription.id,
          plan: updatedSubscription.plan,
          creditsRemaining: updatedSubscription.credits_remaining,
          billingCycleStart: updatedSubscription.billing_cycle_start,
          billingCycleEnd: updatedSubscription.billing_cycle_end,
        },
        payment: {
          txHash,
          amount: planConfig.price,
          type: 'renewal_payment',
        },
      });
    } catch (txError: unknown) {
      await client.query('ROLLBACK');

      // Handle duplicate tx_hash (UNIQUE constraint violation)
      if (txError instanceof Error && 'code' in txError && (txError as { code: string }).code === '23505') {
        return respondError(409, ERROR_CODES.DUPLICATE_TX, 'This transaction hash has already been used for a payment');
      }

      throw txError;
    }
  } finally {
    await client.end();
  }
}

/**
 * POST /credits/purchase
 * Verify tx hash and add credits.
 * Accepts: { packId: string, txHash: string }
 *
 * Flow:
 * 1. Validate packId against CREDIT_PACKS
 * 2. Get user's subscription and wallet address from DB
 * 3. Derive Safe address from wallet address
 * 4. Verify on-chain transfer (sender=Safe, recipient=Platform, amount=packPrice)
 * 5. BEGIN transaction:
 *    - SELECT FOR UPDATE on subscriptions row (serialize concurrent purchases, Req 4.10)
 *    - Add credits to credits_remaining
 *    - Record in credit_transactions with credit_source='credit_pack'
 *    - Record in payment_transactions with type 'credit_pack_purchase'
 * 6. Return updated balance
 *
 * Requirements: 4.3, 4.4, 4.7, 4.8, 4.9, 4.10
 */
async function handlePurchaseCredits(userId: string, body: string | null): Promise<APIGatewayProxyResult> {
  // Parse and validate request body
  if (!body) {
    return respondError(400, ERROR_CODES.INVALID_REQUEST, 'Request body is required');
  }

  let parsed: { packId?: string; txHash?: string };
  try {
    parsed = JSON.parse(body);
  } catch {
    return respondError(400, ERROR_CODES.INVALID_REQUEST, 'Invalid JSON body');
  }

  const { packId, txHash } = parsed;

  if (!packId || !txHash) {
    return respondError(400, ERROR_CODES.INVALID_REQUEST, 'packId and txHash are required');
  }

  // Validate packId against CREDIT_PACKS (Req 4.9)
  if (!isValidPackId(packId)) {
    return respondError(400, ERROR_CODES.INVALID_PACK, `Invalid pack ID. Must be one of: ${Object.keys(CREDIT_PACKS).join(', ')}`);
  }

  const pack = getCreditPack(packId)!;
  const platformWallet = process.env.PLATFORM_WALLET_ADDRESS || '0x0000000000000000000000000000000000000000';

  // Connect to database
  const creds = await getDbCredentials();
  const pg = await import('pg');
  const client = new pg.Client({
    user: creds.username,
    password: creds.password,
    host: creds.host,
    port: creds.port,
    database: creds.dbname,
    ssl: { rejectUnauthorized: false },
  });

  await client.connect();

  try {
    // Resolve Cognito sub → internal user ID for DB queries
    const internalIdResult = await client.query(
      `SELECT id FROM users WHERE cognito_sub = $1 LIMIT 1`,
      [userId]
    );
    if (internalIdResult.rows.length === 0) {
      return respondError(404, ERROR_CODES.NOT_FOUND, 'User not found');
    }
    const internalUserId = internalIdResult.rows[0].id;

    // Get user's subscription and wallet address
    const subResult = await client.query(CREDIT_QUERIES.getSubscription, [internalUserId]);

    if (subResult.rows.length === 0) {
      return respondError(404, ERROR_CODES.NO_ACTIVE_SUBSCRIPTION, 'No active subscription found. Please subscribe to a plan first.');
    }

    const subscription = subResult.rows[0];
    const walletAddress: string | null = subscription.wallet_address;

    if (!walletAddress) {
      return respondError(400, ERROR_CODES.INVALID_REQUEST, 'No wallet address registered for this subscription');
    }

    // Derive Safe address from the user's wallet address (Req 9.1)
    const safeAddress = deriveSafeAddress(walletAddress);

    // Verify on-chain transfer (Req 4.3, 4.7)
    const verification = await verifyTransaction({
      txHash,
      expectedSender: safeAddress,
      expectedRecipient: platformWallet,
      expectedAmount: toUsdcUnits(pack.price),
    });

    if (!verification.verified) {
      const errorCode = verification.error || 'VERIFICATION_FAILED';
      const errorMessages: Record<string, string> = {
        TX_NOT_FOUND: 'Transaction not found on-chain',
        TX_PENDING: 'Transaction is still pending confirmation',
        TX_REVERTED: 'Transaction was reverted on-chain',
        SENDER_MISMATCH: 'Transaction sender does not match registered Trading Wallet',
        RECIPIENT_MISMATCH: 'Transaction recipient does not match Platform Wallet',
        AMOUNT_MISMATCH: `Transaction amount does not match pack price (${pack.price} USDC.e)`,
      };

      const statusCode = errorCode === 'TX_PENDING' ? 202
        : errorCode === 'SENDER_MISMATCH' ? 403
        : 400;

      return respondError(statusCode, errorCode, errorMessages[errorCode] || 'Verification failed', {
        ...(verification.actualSender && { actualSender: verification.actualSender }),
        ...(verification.actualRecipient && { actualRecipient: verification.actualRecipient }),
        ...(verification.actualAmount !== undefined && { actualAmount: verification.actualAmount.toString() }),
      });
    }

    // BEGIN transaction with row-level locking (Req 4.10)
    await client.query('BEGIN');

    try {
      // SELECT FOR UPDATE to serialize concurrent purchases
      const lockResult = await client.query(
        'SELECT id, credits_remaining FROM subscriptions WHERE user_id = $1 AND status IN (\'active\', \'grace_period\') FOR UPDATE',
        [internalUserId]
      );

      if (lockResult.rows.length === 0) {
        await client.query('ROLLBACK');
        return respondError(404, ERROR_CODES.NO_ACTIVE_SUBSCRIPTION, 'No active subscription found');
      }

      const currentCredits = lockResult.rows[0].credits_remaining;
      const subscriptionId = lockResult.rows[0].id;

      // Add credits to credits_remaining (Req 4.4)
      const updateResult = await client.query(WALLET_QUERIES.addCreditPackCredits, [pack.credits, internalUserId]);
      const newBalance = updateResult.rows[0].credits_remaining;

      // Record in credit_transactions with credit_source='credit_pack'
      await client.query(CREDIT_QUERIES.recordTransaction, [
        internalUserId,
        pack.credits,
        newBalance,
        `Credit pack purchase: ${packId} (${pack.credits} credits)`,
        txHash,
        'credit_pack_purchase',
        'credit_pack',
      ]);

      // Record in payment_transactions
      await client.query(WALLET_QUERIES.recordPaymentTransaction, [
        internalUserId,
        'credit_pack_purchase',
        pack.price,
        txHash,
        safeAddress,
        null, // plan
        packId,
        pack.credits,
      ]);

      await client.query('COMMIT');

      return respond(200, {
        creditsRemaining: newBalance,
        creditsAdded: pack.credits,
        txHash,
        payment: {
          txHash,
          amount: pack.price,
          type: 'credit_pack_purchase',
        },
      });
    } catch (txError: unknown) {
      await client.query('ROLLBACK');

      // Handle duplicate tx_hash (UNIQUE constraint violation)
      if (txError instanceof Error && 'code' in txError && (txError as { code: string }).code === '23505') {
        return respondError(409, ERROR_CODES.DUPLICATE_TX, 'This transaction hash has already been used for a payment');
      }

      throw txError;
    }
  } finally {
    await client.end();
  }
}

/**
 * GET /wallet/balance
 * Read USDC.e balance from blockchain for the user's Trading Wallet.
 * Derives the Safe address from the user's registered EOA and reads on-chain balance.
 *
 * Requirements: 5.4
 */
async function handleGetWalletBalance(userId: string): Promise<APIGatewayProxyResult> {
  // Get the user's wallet address (EOA) from the database
  const creds = await getDbCredentials();
  const connectionString = `postgresql://${creds.username}:${encodeURIComponent(creds.password)}@${creds.host}:${creds.port}/${creds.dbname}?sslmode=no-verify`;

  const pg = await import('pg');
  const client = new pg.Client({ connectionString, ssl: { rejectUnauthorized: false } });

  try {
    await client.connect();

    // Resolve Cognito sub → internal user ID for DB queries
    const internalIdResult = await client.query(
      `SELECT id FROM users WHERE cognito_sub = $1 LIMIT 1`,
      [userId]
    );
    if (internalIdResult.rows.length === 0) {
      return respond(200, { balance: 0, balanceRaw: '0', walletAddress: null });
    }
    const internalUserId = internalIdResult.rows[0].id;

    const result = await client.query(WALLET_QUERIES.getUserEoaAddress, [internalUserId]);

    const walletAddress = result.rows.length > 0 ? result.rows[0].wallet_address : null;

    // If user has no wallet address registered, return zero balance
    if (!walletAddress) {
      return respond(200, { balance: 0, balanceRaw: '0', walletAddress: null });
    }

    // Derive the Safe address from the EOA
    const safeAddress = deriveSafeAddress(walletAddress);

    // Read USDC.e balance from the blockchain
    const balanceRaw = await readBalance(safeAddress);

    // Convert bigint balance (6 decimals) to human-readable number
    const balance = Number(balanceRaw) / 1_000_000;

    return respond(200, {
      balance,
      balanceRaw: balanceRaw.toString(),
      walletAddress: safeAddress,
    });
  } catch (error) {
    console.error('Error reading wallet balance:', error);
    return respondError(500, ERROR_CODES.INTERNAL_ERROR, 'Failed to read wallet balance');
  } finally {
    await client.end();
  }
}

/**
 * GET /payments/history
 * Paginated payment transaction history.
 * Query params: cursor, limit, transaction_type
 *
 * Requirements: 7.1, 7.2, 7.3, 7.4, 7.5
 */
async function handleGetPaymentHistory(
  userId: string,
  queryParams: Record<string, string> | null | undefined
): Promise<APIGatewayProxyResult> {
  // Parse and validate limit
  const VALID_TRANSACTION_TYPES = [
    'subscription_payment',
    'credit_pack_purchase',
    'renewal_payment',
    'proration_credit',
  ];

  const rawLimit = queryParams?.limit;
  let limit = 20;
  if (rawLimit !== undefined) {
    const parsed = parseInt(rawLimit, 10);
    if (isNaN(parsed) || parsed < 1) {
      limit = 20;
    } else if (parsed > 100) {
      limit = 100;
    } else {
      limit = parsed;
    }
  }

  // Validate transaction_type filter
  const transactionType = queryParams?.transaction_type || null;
  if (transactionType && !VALID_TRANSACTION_TYPES.includes(transactionType)) {
    return respondError(400, ERROR_CODES.INVALID_REQUEST, `Invalid transaction_type. Must be one of: ${VALID_TRANSACTION_TYPES.join(', ')}`);
  }

  // Validate cursor if provided
  const cursorParam = queryParams?.cursor || null;
  let cursorData: { createdAt: string; id: string } | null = null;
  if (cursorParam) {
    cursorData = decodeCursor(cursorParam);
    if (!cursorData) {
      return respondError(400, ERROR_CODES.INVALID_CURSOR, 'Invalid cursor. Please restart from the first page.');
    }
  }

  // Connect to database
  const creds = await getDbCredentials();
  const connectionString = `postgresql://${creds.username}:${encodeURIComponent(creds.password)}@${creds.host}:${creds.port}/${creds.dbname}?sslmode=no-verify`;
  const pg = await import('pg');
  const client = new pg.Client({ connectionString, ssl: { rejectUnauthorized: false } });

  try {
    await client.connect();

    // Resolve Cognito sub → internal user ID for DB queries
    const internalIdResult = await client.query(
      `SELECT id FROM users WHERE cognito_sub = $1 LIMIT 1`,
      [userId]
    );
    if (internalIdResult.rows.length === 0) {
      return respond(200, { transactions: [], nextCursor: null, hasMore: false });
    }
    const internalUserId = internalIdResult.rows[0].id;

    // Fetch limit + 1 rows to determine has_more
    const fetchLimit = limit + 1;
    let result;

    if (transactionType && cursorData) {
      // Filtered + cursor
      result = await client.query(WALLET_QUERIES.getPaymentHistoryByTypeWithCursor, [
        internalUserId,
        transactionType,
        cursorData.createdAt,
        cursorData.id,
        fetchLimit,
      ]);
    } else if (transactionType) {
      // Filtered, no cursor
      result = await client.query(WALLET_QUERIES.getPaymentHistoryByType, [
        internalUserId,
        transactionType,
        fetchLimit,
      ]);
    } else if (cursorData) {
      // No filter, with cursor
      result = await client.query(WALLET_QUERIES.getPaymentHistoryWithCursor, [
        internalUserId,
        cursorData.createdAt,
        cursorData.id,
        fetchLimit,
      ]);
    } else {
      // No filter, no cursor
      result = await client.query(WALLET_QUERIES.getPaymentHistory, [
        internalUserId,
        fetchLimit,
      ]);
    }

    const rows = result.rows;
    const hasMore = rows.length > limit;
    const transactions = rows.slice(0, limit);

    // Build next_cursor from the last item in the page
    let nextCursor: string | null = null;
    if (hasMore && transactions.length > 0) {
      const lastRow = transactions[transactions.length - 1];
      nextCursor = encodeCursor(lastRow.created_at, lastRow.id);
    }

    // Map rows to response format
    const mappedTransactions = transactions.map((row: Record<string, unknown>) => ({
      id: row.id,
      transactionType: row.transaction_type,
      amountUsdc: parseFloat(row.amount_usdc as string),
      txHash: row.tx_hash,
      sourceAddress: row.source_address,
      plan: row.plan || null,
      creditPackId: row.credit_pack_id || null,
      creditsAdded: row.credits_added || null,
      createdAt: row.created_at,
    }));

    return respond(200, {
      transactions: mappedTransactions,
      nextCursor,
      hasMore,
    });
  } finally {
    await client.end();
  }
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Extract userId from API Gateway Cognito authorizer JWT claims.
 */
function extractUserId(event: APIGatewayProxyEvent): string | null {
  try {
    // API Gateway REST API with Cognito authorizer
    const claims = event.requestContext?.authorizer?.claims;
    if (claims?.sub) return claims.sub;

    // Fallback: custom authorizer with principalId
    const principalId = event.requestContext?.authorizer?.principalId;
    if (principalId) return principalId;

    return null;
  } catch {
    return null;
  }
}

/**
 * Build a standard success response with CORS headers.
 */
function respond(statusCode: number, body: Record<string, unknown>): APIGatewayProxyResult {
  return {
    statusCode,
    headers: CORS_HEADERS,
    body: JSON.stringify(body),
  };
}

/**
 * Build a standard error response with CORS headers and error code.
 */
function respondError(
  statusCode: number,
  error: string,
  message: string,
  details?: Record<string, unknown>
): APIGatewayProxyResult {
  const body: ErrorResponse = { error, message };
  if (details) {
    body.details = details;
  }
  return {
    statusCode,
    headers: CORS_HEADERS,
    body: JSON.stringify(body),
  };
}

// ─── Exported for testing ────────────────────────────────────────────────────

export {
  extractUserId,
  respond,
  respondError,
  resolveRoute,
  normalizePath,
  extractPathParam,
  CORS_HEADERS,
};
