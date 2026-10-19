/**
 * Credit and subscription management for the wallet subscription system.
 * Handles credit checks, deductions, subscription lifecycle, and payment history
 * against RDS PostgreSQL.
 *
 * Requirements: 1.4, 2.3, 4.4, 5.1, 5.3, 7.1, 7.3, 9.1
 */

import type { Client } from 'pg';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface Subscription {
  id: string;
  userId: string;
  plan: 'free' | 'starter' | 'pro' | 'elite';
  status: 'active' | 'cancelled' | 'grace_period';
  creditsRemaining: number;
  creditsMonthlyLimit: number;
  billingCycleStart: string;
  billingCycleEnd: string;
  walletAddress: string | null;
  gracePeriodStart: string | null;
  gracePeriodEnd: string | null;
  cancelledAt: string | null;
}

export interface CreditTransaction {
  id: string;
  userId: string;
  amount: number;
  balanceAfter: number;
  reason: string;
  referenceId?: string;
  referenceType?: string;
  creditSource: 'plan' | 'credit_pack';
  createdAt: string;
}

export interface PaymentTransaction {
  id: string;
  userId: string;
  transactionType: 'subscription_payment' | 'credit_pack_purchase' | 'renewal_payment' | 'proration_credit';
  amountUsdc: number;
  txHash: string;
  sourceAddress: string;
  plan: string | null;
  creditPackId: string | null;
  creditsAdded: number | null;
  createdAt: string;
}

// ---------------------------------------------------------------------------
// SQL Queries - Credit Operations (kept for analysis request flow)
// ---------------------------------------------------------------------------

/**
 * SQL queries for credit operations used by the analysis request service.
 * These are parameterized queries to be executed with a PostgreSQL client.
 */
export const CREDIT_QUERIES = {
  /** Check if user has credits remaining */
  checkCredits: `
    SELECT credits_remaining
    FROM subscriptions
    WHERE user_id = $1 AND status IN ('active', 'grace_period')
    LIMIT 1
  `,

  /** Deduct 1 credit atomically (returns new balance) */
  deductCredit: `
    UPDATE subscriptions
    SET credits_remaining = credits_remaining - 1
    WHERE user_id = $1 AND status IN ('active', 'grace_period') AND credits_remaining > 0
    RETURNING credits_remaining
  `,

  /** Record a credit transaction */
  recordTransaction: `
    INSERT INTO credit_transactions (user_id, amount, balance_after, reason, reference_id, reference_type, credit_source)
    VALUES ($1, $2, $3, $4, $5, $6, $7)
    RETURNING id
  `,

  /** Get user subscription */
  getSubscription: `
    SELECT id, user_id, plan, status, credits_remaining, credits_monthly_limit,
           billing_cycle_start, billing_cycle_end, wallet_address,
           grace_period_start, grace_period_end, cancelled_at
    FROM subscriptions
    WHERE user_id = $1 AND status IN ('active', 'cancelled', 'grace_period')
    LIMIT 1
  `,

  /** Refund a credit (on analysis failure) */
  refundCredit: `
    UPDATE subscriptions
    SET credits_remaining = credits_remaining + 1
    WHERE user_id = $1 AND status IN ('active', 'grace_period')
    RETURNING credits_remaining
  `,
} as const;

// ---------------------------------------------------------------------------
// SQL Queries - Wallet Subscription Operations
// ---------------------------------------------------------------------------

/**
 * SQL queries for wallet-based subscription and payment operations.
 * Used by the Wallet Service Lambda and Renewal Handler.
 */
export const WALLET_QUERIES = {
  /**
   * Activate a subscription (new or plan change).
   * Uses SELECT FOR UPDATE to prevent concurrent plan changes.
   * Params: $1=userId, $2=plan, $3=creditsMonthlyLimit, $4=billingCycleStart,
   *         $5=billingCycleEnd, $6=walletAddress
   */
  activateSubscription: `
    INSERT INTO subscriptions (
      user_id, plan, status, credits_remaining, credits_monthly_limit,
      billing_cycle_start, billing_cycle_end, wallet_address
    )
    VALUES ($1, $2, 'active', $3, $3, $4, $5, $6)
    ON CONFLICT (user_id) DO UPDATE SET
      plan = EXCLUDED.plan,
      status = 'active',
      credits_remaining = EXCLUDED.credits_monthly_limit,
      credits_monthly_limit = EXCLUDED.credits_monthly_limit,
      billing_cycle_start = EXCLUDED.billing_cycle_start,
      billing_cycle_end = EXCLUDED.billing_cycle_end,
      wallet_address = EXCLUDED.wallet_address,
      grace_period_start = NULL,
      grace_period_end = NULL,
      cancelled_at = NULL,
      is_trial = FALSE,
      trial_end = NULL
    RETURNING id, plan, status, credits_remaining, credits_monthly_limit,
              billing_cycle_start, billing_cycle_end, wallet_address
  `,

  /**
   * Process a subscription renewal: reset credits and advance billing cycle.
   * Params: $1=creditsMonthlyLimit, $2=newBillingCycleStart, $3=newBillingCycleEnd, $4=subscriptionId
   */
  processRenewal: `
    UPDATE subscriptions
    SET credits_remaining = $1,
        billing_cycle_start = $2,
        billing_cycle_end = $3,
        status = 'active',
        grace_period_start = NULL,
        grace_period_end = NULL
    WHERE id = $4 AND status IN ('active', 'grace_period')
    RETURNING id, plan, credits_remaining, billing_cycle_start, billing_cycle_end
  `,

  /**
   * Add credit pack credits atomically with row-level locking.
   * Uses SELECT FOR UPDATE to serialize concurrent purchases.
   * Params: $1=credits, $2=userId
   */
  addCreditPackCredits: `
    UPDATE subscriptions
    SET credits_remaining = credits_remaining + $1
    WHERE user_id = $2 AND status IN ('active', 'grace_period')
    RETURNING credits_remaining
  `,

  /**
   * Get the sum of purchased (credit_pack) credits that haven't been consumed.
   * Used during grace period downgrade to preserve purchased credits.
   * Params: $1=userId
   */
  getPurchasedCreditsBalance: `
    SELECT COALESCE(SUM(amount), 0) AS purchased_credits
    FROM credit_transactions
    WHERE user_id = $1
      AND credit_source = 'credit_pack'
      AND amount > 0
  `,

  /**
   * Record a payment transaction (on-chain USDC.e transfer).
   * Params: $1=userId, $2=transactionType, $3=amountUsdc, $4=txHash,
   *         $5=sourceAddress, $6=plan, $7=creditPackId, $8=creditsAdded
   */
  recordPaymentTransaction: `
    INSERT INTO payment_transactions (
      user_id, transaction_type, amount_usdc, tx_hash,
      source_address, plan, credit_pack_id, credits_added
    )
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
    RETURNING id, created_at
  `,

  /**
   * Get payment history with cursor-based pagination.
   * Uses composite cursor (created_at, id) for stable ordering.
   * Params: $1=userId, $2=limit
   * Note: cursor filtering and transaction_type filter are appended dynamically.
   */
  getPaymentHistory: `
    SELECT id, transaction_type, amount_usdc, tx_hash,
           source_address, plan, credit_pack_id, credits_added, created_at
    FROM payment_transactions
    WHERE user_id = $1
    ORDER BY created_at DESC, id DESC
    LIMIT $2
  `,

  /**
   * Get payment history with cursor (for subsequent pages).
   * Params: $1=userId, $2=cursorCreatedAt, $3=cursorId, $4=limit
   */
  getPaymentHistoryWithCursor: `
    SELECT id, transaction_type, amount_usdc, tx_hash,
           source_address, plan, credit_pack_id, credits_added, created_at
    FROM payment_transactions
    WHERE user_id = $1
      AND (created_at, id) < ($2, $3)
    ORDER BY created_at DESC, id DESC
    LIMIT $4
  `,

  /**
   * Get payment history filtered by transaction type.
   * Params: $1=userId, $2=transactionType, $3=limit
   */
  getPaymentHistoryByType: `
    SELECT id, transaction_type, amount_usdc, tx_hash,
           source_address, plan, credit_pack_id, credits_added, created_at
    FROM payment_transactions
    WHERE user_id = $1
      AND transaction_type = $2
    ORDER BY created_at DESC, id DESC
    LIMIT $3
  `,

  /**
   * Get payment history filtered by type with cursor.
   * Params: $1=userId, $2=transactionType, $3=cursorCreatedAt, $4=cursorId, $5=limit
   */
  getPaymentHistoryByTypeWithCursor: `
    SELECT id, transaction_type, amount_usdc, tx_hash,
           source_address, plan, credit_pack_id, credits_added, created_at
    FROM payment_transactions
    WHERE user_id = $1
      AND transaction_type = $2
      AND (created_at, id) < ($3, $4)
    ORDER BY created_at DESC, id DESC
    LIMIT $5
  `,

  /**
   * Get the user's EOA address (Magic SDK wallet) for Safe address derivation.
   * The wallet_address on subscriptions stores the derived Safe address.
   * Params: $1=userId
   */
  getUserEoaAddress: `
    SELECT wallet_address
    FROM subscriptions
    WHERE user_id = $1
    LIMIT 1
  `,
} as const;

// ---------------------------------------------------------------------------
// Plan Limits (for analysis request validation)
// ---------------------------------------------------------------------------

/**
 * Plan limits for validation in the analysis request flow.
 */
export const PLAN_LIMITS = {
  free: {
    creditsPerMonth: 20,
    allowedIntervals: [] as number[], // One-time only
    allowedChannels: ['in_app'],
  },
  starter: {
    creditsPerMonth: 100,
    allowedIntervals: [86400], // 1 day only
    allowedChannels: ['in_app', 'email', 'push'],
  },
  pro: {
    creditsPerMonth: 350,
    allowedIntervals: [3600, 14400, 43200, 86400], // All intervals
    allowedChannels: ['in_app', 'email', 'push', 'webhook'],
  },
  elite: {
    creditsPerMonth: Infinity,
    allowedIntervals: [3600, 14400, 43200, 86400],
    allowedChannels: ['in_app', 'email', 'push', 'webhook'],
  },
} as const;

// ---------------------------------------------------------------------------
// SQL Queries - Free Trial Operations
// ---------------------------------------------------------------------------

/**
 * SQL queries for free trial eligibility checks and activation.
 */
export const TRIAL_QUERIES = {
  /**
   * Check if a user has ever used a paid plan (disqualifies from trial).
   * Checks both the `has_used_paid_plan` flag on the users table AND
   * the payment_transactions table for any subscription payments.
   * Params: $1=userId (internal)
   */
  checkTrialEligibility: `
    SELECT
      u.has_used_paid_plan,
      EXISTS (
        SELECT 1 FROM payment_transactions
        WHERE user_id = $1
          AND transaction_type IN ('subscription_payment', 'renewal_payment')
      ) AS has_payment_history
    FROM users u
    WHERE u.id = $1
  `,

  /**
   * Activate a free trial: UPSERT subscription with trial fields.
   * Params: $1=userId, $2=plan, $3=creditsMonthlyLimit, $4=trialEnd, $5=billingCycleStart, $6=billingCycleEnd
   */
  activateTrial: `
    INSERT INTO subscriptions (
      user_id, plan, status, credits_remaining, credits_monthly_limit,
      billing_cycle_start, billing_cycle_end, is_trial, trial_end
    )
    VALUES ($1, $2, 'active', $3, $3, $5, $6, TRUE, $4)
    ON CONFLICT (user_id) DO UPDATE SET
      plan = EXCLUDED.plan,
      status = 'active',
      credits_remaining = EXCLUDED.credits_monthly_limit,
      credits_monthly_limit = EXCLUDED.credits_monthly_limit,
      billing_cycle_start = EXCLUDED.billing_cycle_start,
      billing_cycle_end = EXCLUDED.billing_cycle_end,
      is_trial = TRUE,
      trial_end = EXCLUDED.trial_end,
      grace_period_start = NULL,
      grace_period_end = NULL,
      cancelled_at = NULL
    RETURNING id, plan, status, credits_remaining, credits_monthly_limit,
              billing_cycle_start, billing_cycle_end, is_trial, trial_end
  `,

  /**
   * Mark user as having used a paid plan (prevents future trials).
   * Called when a user activates any paid subscription (trial or paid).
   * Params: $1=userId (internal)
   */
  markTrialUsed: `
    UPDATE users SET has_used_paid_plan = TRUE WHERE id = $1
  `,

  /**
   * Get subscriptions with expired trials that need to be downgraded.
   * Used by the trial expiry handler.
   */
  getExpiredTrials: `
    SELECT s.id, s.user_id, s.plan, s.trial_end
    FROM subscriptions s
    WHERE s.is_trial = TRUE
      AND s.status = 'active'
      AND s.trial_end <= now()
  `,

  /**
   * Downgrade an expired trial to free plan and start a fresh free billing cycle.
   * Params: $1=subscriptionId, $2=billingCycleStart, $3=billingCycleEnd
   */
  expireTrial: `
    UPDATE subscriptions
    SET plan = 'free',
        status = 'active',
        credits_remaining = 20,
        credits_monthly_limit = 20,
        is_trial = FALSE,
        trial_end = NULL,
        eventbridge_schedule_arn = NULL,
        billing_cycle_start = $2,
        billing_cycle_end = $3
    WHERE id = $1
    RETURNING id, user_id, plan
  `,
} as const;

// ---------------------------------------------------------------------------
// Utility Functions
// ---------------------------------------------------------------------------

/**
 * Validate that a user's plan allows the requested interval.
 */
export function validateInterval(plan: keyof typeof PLAN_LIMITS, intervalSeconds: number | null): boolean {
  if (intervalSeconds === null) return true; // One-time is always allowed
  return (PLAN_LIMITS[plan].allowedIntervals as readonly number[]).includes(intervalSeconds);
}

/**
 * Encode a cursor from a payment transaction row for pagination.
 * Cursor format: base64(JSON({ createdAt, id }))
 */
export function encodeCursor(createdAt: string, id: string): string {
  return Buffer.from(JSON.stringify({ createdAt, id })).toString('base64');
}

/**
 * Decode a pagination cursor. Returns null if invalid.
 */
export function decodeCursor(cursor: string): { createdAt: string; id: string } | null {
  try {
    const decoded = JSON.parse(Buffer.from(cursor, 'base64').toString('utf-8'));
    if (typeof decoded.createdAt === 'string' && typeof decoded.id === 'string') {
      return decoded;
    }
    return null;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Lazy Monthly Credit Reset (free plan)
// ---------------------------------------------------------------------------

const BILLING_CYCLE_DAYS = 30;

/**
 * Row shape returned by `resetFreePlanIfCycleExpired` when a reset occurs.
 */
export interface FreePlanReset {
  id: string;
  plan: string;
  status: string;
  credits_remaining: number;
  credits_monthly_limit: number;
  billing_cycle_start: string;
  billing_cycle_end: string;
}

/**
 * Lazily reset a free-plan subscription whose billing cycle has expired.
 *
 * Free-plan users have no EventBridge renewal schedule (paid-only), so their
 * credits and `billing_cycle_end` would otherwise go stale forever. This
 * self-healing check tops credits back up to the monthly limit and advances
 * the billing cycle forward in whole 30-day periods until the end is in the
 * future (so a user stuck for many months is fully caught up in one visit).
 *
 * Call with an already-connected pg client before reading credits or returning
 * the subscription. Runs its own transaction.
 *
 * @param client - Connected pg client (must not already be in a transaction)
 * @param userId - Internal `users.id`
 * @returns The refreshed subscription row if a reset occurred, otherwise null.
 */
export async function resetFreePlanIfCycleExpired(
  client: Client,
  userId: string
): Promise<FreePlanReset | null> {
  const result = await client.query(
    `SELECT id, plan, status, credits_remaining, credits_monthly_limit,
            billing_cycle_start, billing_cycle_end
     FROM subscriptions
     WHERE user_id = $1
       AND plan = 'free'
       AND status IN ('active', 'grace_period')
       AND billing_cycle_end IS NOT NULL
       AND billing_cycle_end < now()
     LIMIT 1`,
    [userId]
  );

  if (result.rows.length === 0) return null;

  const sub = result.rows[0];
  const oldEndMs = new Date(sub.billing_cycle_end).getTime();
  const cycleMs = BILLING_CYCLE_DAYS * 24 * 60 * 60 * 1000;

  // Advance in whole 30-day periods until the new cycle end is in the future.
  const periods = Math.max(1, Math.ceil((Date.now() - oldEndMs) / cycleMs));
  const newStart = new Date(oldEndMs + (periods - 1) * cycleMs);
  const newEnd = new Date(oldEndMs + periods * cycleMs);

  await client.query('BEGIN');
  try {
    const updated = await client.query(
      `UPDATE subscriptions
       SET credits_remaining = credits_monthly_limit,
           billing_cycle_start = $1,
           billing_cycle_end = $2
       WHERE id = $3
       RETURNING id, plan, status, credits_remaining, credits_monthly_limit,
                 billing_cycle_start, billing_cycle_end`,
      [newStart.toISOString(), newEnd.toISOString(), sub.id]
    );

    const row = updated.rows[0] as FreePlanReset;

    await client.query(
      `INSERT INTO credit_transactions (user_id, amount, balance_after, reason, reference_type, credit_source)
       VALUES ($1, $2, $2, 'free_plan_monthly_reset', 'system', 'plan')`,
      [userId, row.credits_remaining]
    );

    await client.query('COMMIT');
    console.log(
      `[resetFreePlanIfCycleExpired] Reset free credits for user ${userId} ` +
        `to ${row.credits_remaining}, new cycle end ${newEnd.toISOString()}`
    );
    return row;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  }
}
