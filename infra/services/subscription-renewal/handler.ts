/**
 * Subscription Renewal Handler
 *
 * Triggered by EventBridge Scheduler → SQS when a subscription's billing cycle ends.
 * Processes automatic renewals via USDC.e transferFrom with pre-approved allowance.
 *
 * Flow:
 * 1. Parse payload from SQS record body
 * 2. Check DynamoDB dedup key (subscription_id#billing_cycle_end) - idempotent no-op if exists
 * 3. Query subscription from DB (get plan, wallet_address, status)
 * 4. If subscription is cancelled or doesn't exist → skip
 * 5. Read USDC.e allowance and balance from chain
 * 6. If sufficient → execute transferFrom via Platform Wallet signer
 * 7. On success → atomic DB update, write dedup key with 7-day TTL, create new schedule
 * 8. If insufficient → set grace period, schedule retry in 24h, send notification
 *
 * Environment variables:
 *   - DB_SECRET_ARN: Secrets Manager ARN for RDS credentials
 *   - DB_HOST: RDS endpoint hostname
 *   - PLATFORM_WALLET_ADDRESS: TradeWizard receiving wallet address
 *   - USDC_CONTRACT_ADDRESS: USDC.e contract on Polygon
 *   - POLYGON_RPC_URL: Polygon JSON-RPC endpoint
 *   - SAFE_FACTORY_ADDRESS: Safe factory for deterministic address derivation
 *   - DEDUP_TABLE: DynamoDB table name for renewal deduplication
 *   - PLATFORM_WALLET_PRIVATE_KEY_ARN: Secrets Manager ARN for the platform wallet private key
 *   - RENEWAL_QUEUE_ARN: SQS queue ARN for scheduling next renewal
 *   - SCHEDULER_ROLE_ARN: IAM role ARN for EventBridge Scheduler
 *   - SNS_NOTIFICATION_TOPIC_ARN: SNS topic for user notifications (optional)
 *
 * Requirements: 2.2, 2.3, 2.4, 2.5, 2.6, 2.10, 8.1, 8.2, 8.3, 8.4, 8.5
 */

import { SQSEvent, SQSHandler } from 'aws-lambda';
import { DynamoDBClient, GetItemCommand, PutItemCommand } from '@aws-sdk/client-dynamodb';
import { SecretsManagerClient, GetSecretValueCommand } from '@aws-sdk/client-secrets-manager';
import { SchedulerClient, CreateScheduleCommand, DeleteScheduleCommand } from '@aws-sdk/client-scheduler';
import { SNSClient, PublishCommand } from '@aws-sdk/client-sns';
import {
  createPublicClient,
  createWalletClient,
  http,
  parseAbi,
  getAddress,
  type PublicClient,
  type Hash,
} from 'viem';
import { polygon } from 'viem/chains';
import { privateKeyToAccount } from 'viem/accounts';
import {
  readCollateralAllowances,
  readTokenBalance,
  getPublicClient,
  PUSD_CONTRACT_ADDRESS,
  USDC_CONTRACT_ADDRESS,
} from '../shared/chain-verification';
import { PLANS, toUsdcUnits, type PlanId } from '../shared/plans';
import { WALLET_QUERIES, TRIAL_QUERIES } from '../shared/credits';
import { getDbCredentials } from '../shared/db';

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const DEDUP_TABLE = process.env.DEDUP_TABLE || '';
const PLATFORM_WALLET_ADDRESS = process.env.PLATFORM_WALLET_ADDRESS || '';
const POLYGON_RPC_URL = process.env.POLYGON_RPC_URL || 'https://polygon-rpc.com';
const PLATFORM_WALLET_PRIVATE_KEY_ARN = process.env.PLATFORM_WALLET_PRIVATE_KEY_ARN || '';
const RENEWAL_QUEUE_ARN = process.env.RENEWAL_QUEUE_ARN || '';
const SCHEDULER_ROLE_ARN = process.env.SCHEDULER_ROLE_ARN || '';
const SNS_NOTIFICATION_TOPIC_ARN = process.env.SNS_NOTIFICATION_TOPIC_ARN || '';

// Grace period duration: 3 days
const GRACE_PERIOD_DAYS = 3;
// Retry interval during grace period: 24 hours
const RETRY_INTERVAL_HOURS = 24;
// Dedup key TTL: 7 days
const DEDUP_TTL_DAYS = 7;

// ---------------------------------------------------------------------------
// AWS Clients (cached for Lambda reuse)
// ---------------------------------------------------------------------------

const dynamoClient = new DynamoDBClient({});
const secretsClient = new SecretsManagerClient({});
const schedulerClient = new SchedulerClient({});
const snsClient = new SNSClient({});

// ---------------------------------------------------------------------------
// ERC-20 ABI for transferFrom
// ---------------------------------------------------------------------------

const ERC20_TRANSFER_FROM_ABI = parseAbi([
  'function transferFrom(address from, address to, uint256 amount) returns (bool)',
]);

// ---------------------------------------------------------------------------
// Cached platform wallet private key
// ---------------------------------------------------------------------------

let cachedPrivateKey: `0x${string}` | null = null;

async function getPlatformWalletPrivateKey(): Promise<`0x${string}`> {
  if (cachedPrivateKey) return cachedPrivateKey;

  if (!PLATFORM_WALLET_PRIVATE_KEY_ARN) {
    throw new Error('PLATFORM_WALLET_PRIVATE_KEY_ARN environment variable not set');
  }

  const response = await secretsClient.send(
    new GetSecretValueCommand({ SecretId: PLATFORM_WALLET_PRIVATE_KEY_ARN })
  );

  if (!response.SecretString) {
    throw new Error('Platform wallet private key secret has no string value');
  }

  // The secret may be stored as a raw hex string or as JSON { "privateKey": "0x..." }
  let privateKey: string;
  try {
    const parsed = JSON.parse(response.SecretString);
    privateKey = parsed.privateKey || parsed.private_key || response.SecretString;
  } catch {
    privateKey = response.SecretString.trim();
  }

  // Ensure it starts with 0x
  if (!privateKey.startsWith('0x')) {
    privateKey = `0x${privateKey}`;
  }

  cachedPrivateKey = privateKey as `0x${string}`;
  return cachedPrivateKey;
}

// ---------------------------------------------------------------------------
// Payload Interface
// ---------------------------------------------------------------------------

/**
 * Payload types for the renewal handler:
 * - 'renewal' (default): Process automatic renewal at billing_cycle_end
 * - 'reminder': Send pre-renewal reminder 3 days before billing_cycle_end
 *   when no allowance is set, prompting user to approve or manually renew
 * - 'trial_expiry': Downgrade trial subscription to free plan
 */
type RenewalEventType = 'renewal' | 'reminder' | 'trial_expiry';

interface RenewalPayload {
  type?: RenewalEventType;
  subscriptionId: string;
  billingCycleEnd?: string;
  trialEnd?: string;
}

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

export const handler: SQSHandler = async (event: SQSEvent) => {
  for (const record of event.Records) {
    let payload: RenewalPayload;

    try {
      payload = JSON.parse(record.body) as RenewalPayload;
    } catch (error) {
      console.error('Failed to parse SQS record body:', record.body, error);
      continue;
    }

    const { subscriptionId, billingCycleEnd, trialEnd } = payload;

    if (!subscriptionId) {
      console.error('Invalid renewal payload - missing subscriptionId:', payload);
      continue;
    }

    const eventType: RenewalEventType = payload.type || 'renewal';

    // For trial_expiry, billingCycleEnd is not required
    if (eventType !== 'trial_expiry' && !billingCycleEnd) {
      console.error('Invalid renewal payload - missing billingCycleEnd:', payload);
      continue;
    }

    console.log('Processing event:', { type: eventType, subscriptionId, billingCycleEnd, trialEnd });

    try {
      if (eventType === 'trial_expiry') {
        await processTrialExpiry(subscriptionId);
      } else if (eventType === 'reminder') {
        await processReminder(subscriptionId, billingCycleEnd!);
      } else {
        await processRenewal(subscriptionId, billingCycleEnd!);
      }
    } catch (error) {
      console.error('Event processing failed:', { type: eventType, subscriptionId, billingCycleEnd, error });
      // Re-throw to let SQS retry via DLQ
      throw error;
    }
  }
};

// ---------------------------------------------------------------------------
// Core Renewal Logic
// ---------------------------------------------------------------------------

async function processRenewal(subscriptionId: string, billingCycleEnd: string): Promise<void> {
  // Step 1: Check DynamoDB dedup key (Req 2.10)
  const dedupKey = `${subscriptionId}#${billingCycleEnd}`;
  const alreadyProcessed = await checkDedupKey(dedupKey);

  if (alreadyProcessed) {
    console.log('Renewal already processed (idempotent no-op):', dedupKey);
    return;
  }

  // Step 2: Query subscription from DB
  const subscription = await getSubscription(subscriptionId);

  if (!subscription) {
    console.log('Subscription not found, skipping:', subscriptionId);
    return;
  }

  // Step 3: Skip if cancelled or doesn't have a valid plan
  if (subscription.status === 'cancelled') {
    console.log('Subscription is cancelled, skipping renewal:', subscriptionId);
    return;
  }

  if (subscription.plan === 'free') {
    console.log('Subscription is on free plan, skipping renewal:', subscriptionId);
    return;
  }

  const planConfig = PLANS[subscription.plan as PlanId];
  if (!planConfig || planConfig.price === 0) {
    console.log('Plan has no price, skipping renewal:', subscription.plan);
    return;
  }

  const walletAddress = subscription.wallet_address;
  if (!walletAddress) {
    console.error('No wallet address on subscription, cannot process renewal:', subscriptionId);
    await handleInsufficientFunds(subscriptionId, subscription, 'no_wallet');
    return;
  }

  // Step 4: Read pUSD and legacy USDC.e allowance/balance (Req 8.2)
  const planPriceUnits = toUsdcUnits(planConfig.price);
  let candidates: Array<{ token: string; allowance: bigint; balance: bigint }>;

  try {
    const allowances = await readCollateralAllowances(
      walletAddress,
      PLATFORM_WALLET_ADDRESS
    );
    const [pusdBalance, usdceBalance] = await Promise.all([
      readTokenBalance(PUSD_CONTRACT_ADDRESS, walletAddress),
      readTokenBalance(USDC_CONTRACT_ADDRESS, walletAddress),
    ]);

    candidates = [
      { token: PUSD_CONTRACT_ADDRESS, allowance: allowances.pusd, balance: pusdBalance },
      { token: USDC_CONTRACT_ADDRESS, allowance: allowances.usdce, balance: usdceBalance },
    ];
  } catch (error) {
    console.error('Failed to read chain state:', error);
    throw error; // Let SQS retry
  }

  console.log('Chain state:', {
    planPriceUnits: planPriceUnits.toString(),
    candidates: candidates.map((candidate) => ({
      token: candidate.token,
      allowance: candidate.allowance.toString(),
      balance: candidate.balance.toString(),
    })),
  });

  // Step 5: Pick the token with sufficient allowance and balance.
  const usable = candidates.find(
    (candidate) =>
      candidate.allowance >= planPriceUnits && candidate.balance >= planPriceUnits
  );

  if (usable) {
    await executeRenewal(
      subscriptionId,
      subscription,
      walletAddress,
      planPriceUnits,
      billingCycleEnd,
      dedupKey,
      usable.token
    );
  } else {
    // Insufficient - enter grace period (Req 2.4, 8.4)
    const hasAllowance = candidates.some(
      (candidate) => candidate.allowance >= planPriceUnits
    );
    const reason = hasAllowance ? 'insufficient_balance' : 'insufficient_allowance';
    await handleInsufficientFunds(subscriptionId, subscription, reason);
  }
}

// ---------------------------------------------------------------------------
// Trial Expiry Logic
// ---------------------------------------------------------------------------

/**
 * Process trial expiry: downgrade the subscription to free plan.
 * Triggered by EventBridge Scheduler when trial_end is reached.
 *
 * Flow:
 * 1. Query subscription from DB
 * 2. Verify it's still a trial (is_trial=true)
 * 3. Downgrade to free plan (20 credits)
 * 4. Send notification to user
 */
async function processTrialExpiry(subscriptionId: string): Promise<void> {
  const subscription = await getSubscription(subscriptionId);

  if (!subscription) {
    console.log('Subscription not found for trial expiry, skipping:', subscriptionId);
    return;
  }

  // Verify this is actually a trial subscription
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
    // Check if still on trial
    const trialCheck = await client.query(
      `SELECT is_trial, trial_end FROM subscriptions WHERE id = $1`,
      [subscriptionId]
    );

    if (trialCheck.rows.length === 0 || !trialCheck.rows[0].is_trial) {
      console.log('Subscription is not on trial (may have been converted to paid), skipping:', subscriptionId);
      return;
    }

    // Downgrade to free plan with a fresh free billing cycle
    const now = new Date();
    const billingCycleEnd = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);
    await client.query(TRIAL_QUERIES.expireTrial, [
      subscriptionId,
      now.toISOString(),
      billingCycleEnd.toISOString(),
    ]);

    console.log('Trial expired, downgraded to free plan:', subscriptionId);

    // Send notification to user about trial expiry
    const notification = {
      userId: subscription.user_id,
      subscriptionId,
      type: 'trial_expired',
      message: `Your free trial of the ${subscription.plan} plan has ended. You've been moved to the Free plan (20 credits/month). Upgrade anytime to restore your previous plan's features.`,
      timestamp: new Date().toISOString(),
    };

    if (SNS_NOTIFICATION_TOPIC_ARN) {
      try {
        await snsClient.send(
          new PublishCommand({
            TopicArn: SNS_NOTIFICATION_TOPIC_ARN,
            Message: JSON.stringify(notification),
            MessageAttributes: {
              userId: { DataType: 'String', StringValue: subscription.user_id },
              notificationType: { DataType: 'String', StringValue: 'trial_expired' },
            },
          })
        );
      } catch (error) {
        console.error('Failed to send trial expiry notification:', error);
      }
    } else {
      console.log('Trial expiry notification (no SNS topic configured):', notification);
    }
  } finally {
    await client.end();
  }
}

// ---------------------------------------------------------------------------
// Pre-Renewal Reminder Logic (Req 2.8)
// ---------------------------------------------------------------------------

/**
 * Process a pre-renewal reminder event.
 * Sent 3 days before billing_cycle_end for subscriptions without sufficient allowance.
 *
 * Logic:
 * 1. Query the subscription from DB
 * 2. Skip if cancelled, free, or doesn't exist
 * 3. Read the USDC.e allowance from chain
 * 4. If allowance is 0 or insufficient for the plan price:
 *    - Send a reminder notification prompting the user to approve allowance or manually renew
 * 5. If allowance is already sufficient, no action needed (auto-renewal will work)
 */
async function processReminder(subscriptionId: string, billingCycleEnd: string): Promise<void> {
  // Step 1: Query subscription from DB
  const subscription = await getSubscription(subscriptionId);

  if (!subscription) {
    console.log('Subscription not found for reminder, skipping:', subscriptionId);
    return;
  }

  // Step 2: Skip if cancelled or free plan
  if (subscription.status === 'cancelled') {
    console.log('Subscription is cancelled, skipping reminder:', subscriptionId);
    return;
  }

  if (subscription.plan === 'free') {
    console.log('Subscription is on free plan, skipping reminder:', subscriptionId);
    return;
  }

  const planConfig = PLANS[subscription.plan as PlanId];
  if (!planConfig || planConfig.price === 0) {
    console.log('Plan has no price, skipping reminder:', subscription.plan);
    return;
  }

  const walletAddress = subscription.wallet_address;
  if (!walletAddress) {
    console.log('No wallet address on subscription, skipping reminder:', subscriptionId);
    return;
  }

  // Step 3: Read pUSD and legacy USDC.e allowances from chain
  const planPriceUnits = toUsdcUnits(planConfig.price);
  let allowances: { pusd: bigint; usdce: bigint };

  try {
    allowances = await readCollateralAllowances(
      walletAddress,
      PLATFORM_WALLET_ADDRESS
    );
  } catch (error) {
    console.error('Failed to read allowance for reminder:', error);
    // Don't throw - reminder failure shouldn't block anything
    // Send the reminder anyway as a precaution
    await sendReminderNotification(subscription.user_id, subscriptionId, billingCycleEnd, planConfig.price);
    return;
  }

  const sufficient =
    allowances.pusd >= planPriceUnits || allowances.usdce >= planPriceUnits;

  console.log('Reminder check - allowance state:', {
    subscriptionId,
    pUSD: allowances.pusd.toString(),
    usdce: allowances.usdce.toString(),
    planPriceUnits: planPriceUnits.toString(),
    sufficient,
  });

  // Step 4: If neither allowance is sufficient, send reminder
  if (!sufficient) {
    console.log('Allowance insufficient, sending pre-renewal reminder:', subscriptionId);
    await sendReminderNotification(subscription.user_id, subscriptionId, billingCycleEnd, planConfig.price);
  } else {
    // Step 5: Allowance is sufficient - auto-renewal will work, no action needed
    console.log('Allowance sufficient for auto-renewal, no reminder needed:', subscriptionId);
  }
}

/**
 * Send a pre-renewal reminder notification to the user.
 * Prompts the user to either approve a USDC.e allowance for auto-renewal
 * or manually renew when the billing cycle ends.
 *
 * Requirement 2.8: Send renewal reminder 3 days before billing_cycle_end
 * when no allowance is set.
 */
async function sendReminderNotification(
  userId: string,
  subscriptionId: string,
  billingCycleEnd: string,
  planPrice: number
): Promise<void> {
  const billingEndDate = new Date(billingCycleEnd);
  const formattedDate = billingEndDate.toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });

  const notification = {
    userId,
    subscriptionId,
    type: 'renewal_reminder',
    message: `Your subscription renews on ${formattedDate} for $${planPrice}. ` +
      `You have not approved an allowance for automatic renewal. ` +
      `Please return to the app and either: ` +
      `(a) approve the auto-renewal allowance, or ` +
      `(b) manually renew when your billing cycle ends.`,
    billingCycleEnd,
    planPrice,
    timestamp: new Date().toISOString(),
  };

  if (SNS_NOTIFICATION_TOPIC_ARN) {
    try {
      await snsClient.send(
        new PublishCommand({
          TopicArn: SNS_NOTIFICATION_TOPIC_ARN,
          Message: JSON.stringify(notification),
          MessageAttributes: {
            userId: { DataType: 'String', StringValue: userId },
            notificationType: { DataType: 'String', StringValue: 'renewal_reminder' },
          },
        })
      );
      console.log('Reminder notification sent via SNS:', notification);
    } catch (error) {
      console.error('Failed to send reminder SNS notification:', error);
      // Don't throw - notification failure shouldn't block processing
    }
  } else {
    // Log the notification for now (no SNS topic configured)
    console.log('Reminder notification (no SNS topic configured):', notification);
  }
}

// ---------------------------------------------------------------------------
// Successful Renewal Flow
// ---------------------------------------------------------------------------

async function executeRenewal(
  subscriptionId: string,
  subscription: SubscriptionRow,
  walletAddress: string,
  planPriceUnits: bigint,
  billingCycleEnd: string,
  dedupKey: string,
  tokenAddress: string
): Promise<void> {
  // Step 5a: Execute transferFrom via Platform Wallet signer (Req 2.2)
  const txHash = await executeTransferFrom(
    tokenAddress,
    walletAddress,
    planPriceUnits
  );
  console.log('transferFrom executed:', txHash);

  // Step 5b: Wait for transaction confirmation
  const publicClient = getPublicClient();
  const receipt = await publicClient.waitForTransactionReceipt({
    hash: txHash,
    confirmations: 1,
  });

  if (receipt.status === 'reverted') {
    console.error('transferFrom reverted:', txHash);
    // Treat as insufficient - enter grace period
    await handleInsufficientFunds(subscriptionId, subscription, 'transfer_reverted');
    return;
  }

  console.log('transferFrom confirmed in block:', receipt.blockNumber);

  // Step 5c: Atomic DB update (Req 2.3, 8.3)
  const planConfig = PLANS[subscription.plan as PlanId];
  const oldBillingCycleEnd = new Date(billingCycleEnd);
  const newBillingCycleStart = oldBillingCycleEnd.toISOString();
  const newBillingCycleEnd = new Date(oldBillingCycleEnd.getTime() + 30 * 24 * 60 * 60 * 1000).toISOString();

  await performAtomicRenewalUpdate(
    subscriptionId,
    subscription.user_id,
    planConfig.creditsPerMonth,
    newBillingCycleStart,
    newBillingCycleEnd,
    txHash,
    walletAddress,
    subscription.plan,
    planConfig.price
  );

  // Step 5d: Write dedup key to DynamoDB with 7-day TTL (Req 2.10)
  await writeDedupKey(dedupKey, txHash, 'success');

  // Step 5e: Create new EventBridge schedule for new billing_cycle_end (Req 8.1)
  const scheduleArn = await createRenewalSchedule(subscriptionId, newBillingCycleEnd);

  // Update the schedule ARN on the subscription
  if (scheduleArn) {
    await updateScheduleArn(subscriptionId, scheduleArn);
  }

  // Step 5f: Create reminder schedule 3 days before new billing_cycle_end (Req 2.8)
  await createReminderSchedule(subscriptionId, newBillingCycleEnd);

  console.log('Renewal completed successfully:', {
    subscriptionId,
    txHash,
    newBillingCycleEnd,
    scheduleArn,
  });
}

/**
 * Execute a collateral transferFrom using the Platform Wallet's private key.
 * Calls transferFrom(safeAddress, platformWallet, amount) on the chosen token.
 */
async function executeTransferFrom(
  tokenAddress: string,
  safeAddress: string,
  amount: bigint
): Promise<Hash> {
  const privateKey = await getPlatformWalletPrivateKey();
  const account = privateKeyToAccount(privateKey);

  const walletClient = createWalletClient({
    account,
    chain: polygon,
    transport: http(POLYGON_RPC_URL),
  });

  const hash = await walletClient.writeContract({
    address: getAddress(tokenAddress) as `0x${string}`,
    abi: ERC20_TRANSFER_FROM_ABI,
    functionName: 'transferFrom',
    args: [
      getAddress(safeAddress) as `0x${string}`,
      getAddress(PLATFORM_WALLET_ADDRESS) as `0x${string}`,
      amount,
    ],
  });

  return hash;
}

// ---------------------------------------------------------------------------
// Insufficient Funds / Grace Period Flow
// ---------------------------------------------------------------------------

async function handleInsufficientFunds(
  subscriptionId: string,
  subscription: SubscriptionRow,
  reason: string
): Promise<void> {
  const now = new Date();

  // Check if already in grace period
  if (subscription.grace_period_end) {
    const gracePeriodEnd = new Date(subscription.grace_period_end);

    if (now >= gracePeriodEnd) {
      // Grace period expired - downgrade to free plan (Req 2.7)
      console.log('Grace period expired, downgrading to free:', subscriptionId);
      await performGracePeriodDowngrade(subscriptionId, subscription);
      return;
    }

    // Still in grace period - schedule retry in 24h (Req 2.5)
    console.log('Still in grace period, scheduling retry:', subscriptionId);
    await scheduleRetry(subscriptionId, subscription.billing_cycle_end);
    await sendNotification(subscription.user_id, subscriptionId, reason);
    return;
  }

  // Enter grace period (Req 2.4)
  const gracePeriodStart = now.toISOString();
  const gracePeriodEnd = new Date(now.getTime() + GRACE_PERIOD_DAYS * 24 * 60 * 60 * 1000).toISOString();

  console.log('Entering grace period:', { subscriptionId, gracePeriodStart, gracePeriodEnd });

  await setGracePeriod(subscriptionId, gracePeriodStart, gracePeriodEnd);

  // Schedule retry in 24h (Req 2.5)
  await scheduleRetry(subscriptionId, subscription.billing_cycle_end);

  // Send notification (Req 2.6)
  await sendNotification(subscription.user_id, subscriptionId, reason);
}

/**
 * Perform grace period downgrade: move user to free plan, preserve credit_pack credits.
 *
 * When the grace period expires without successful renewal:
 * 1. Query credit_transactions for credit_pack credits (purchased credits to preserve)
 * 2. Calculate final credits: 5 (free plan allocation) + purchased_credits
 * 3. Downgrade subscription to free plan with calculated credits
 * 4. Delete EventBridge schedule if exists
 * 5. Send downgrade notification to user
 *
 * Requirements: 2.7, 8.4
 */
async function performGracePeriodDowngrade(
  subscriptionId: string,
  subscription: SubscriptionRow
): Promise<void> {
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
    await client.query('BEGIN');

    // Step 1: Query purchased (credit_pack) credits to preserve (Req 2.7)
    const purchasedResult = await client.query(WALLET_QUERIES.getPurchasedCreditsBalance, [
      subscription.user_id,
    ]);
    const purchasedCredits = parseInt(purchasedResult.rows[0]?.purchased_credits || '0', 10);

    // Step 2: Calculate final credits: 5 (free plan) + purchased credits
    const FREE_PLAN_CREDITS = 20;
    const finalCredits = FREE_PLAN_CREDITS + purchasedCredits;

    console.log('Grace period downgrade credits calculation:', {
      subscriptionId,
      purchasedCredits,
      freePlanCredits: FREE_PLAN_CREDITS,
      finalCredits,
    });

    // Step 3: Downgrade subscription to free plan
    await client.query(
      `UPDATE subscriptions
       SET plan = 'free',
           status = 'active',
           credits_remaining = $1,
           credits_monthly_limit = $2,
           grace_period_start = NULL,
           grace_period_end = NULL,
           eventbridge_schedule_arn = NULL
       WHERE id = $3`,
      [finalCredits, FREE_PLAN_CREDITS, subscriptionId]
    );

    await client.query('COMMIT');

    console.log('Subscription downgraded to free:', {
      subscriptionId,
      finalCredits,
    });
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    await client.end();
  }

  // Step 4: Delete EventBridge schedule if exists (Req 8.4)
  if (subscription.eventbridge_schedule_arn) {
    await deleteEventBridgeSchedule(subscriptionId, subscription.eventbridge_schedule_arn);
  }

  // Step 5: Send downgrade notification to user
  await sendDowngradeNotification(subscription.user_id, subscriptionId);
}

/**
 * Delete an EventBridge Scheduler schedule for a subscription.
 * Tries by name first, then falls back to ARN-based deletion.
 * Silently handles cases where the schedule doesn't exist.
 *
 * Requirements: 8.4, 8.6
 */
async function deleteEventBridgeSchedule(subscriptionId: string, scheduleArn: string | null): Promise<void> {
  try {
    const scheduleName = `renewal-${subscriptionId}`;

    await schedulerClient.send(
      new DeleteScheduleCommand({
        Name: scheduleName,
      })
    );

    console.log('EventBridge schedule deleted:', scheduleName);
  } catch (error: unknown) {
    const err = error as { name?: string };
    if (err.name === 'ResourceNotFoundException') {
      // Schedule doesn't exist - try ARN-based deletion as fallback
      if (scheduleArn) {
        try {
          // Extract schedule name from ARN
          const arnParts = scheduleArn.split('/');
          const scheduleName = arnParts[arnParts.length - 1];

          let groupName: string | undefined;
          if (arnParts.length > 2) {
            groupName = arnParts[arnParts.length - 2];
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
          console.log('EventBridge schedule deleted by ARN:', scheduleArn);
        } catch (arnError: unknown) {
          const arnErr = arnError as { name?: string };
          if (arnErr.name === 'ResourceNotFoundException') {
            console.warn('EventBridge schedule not found (already deleted):', scheduleArn);
          } else {
            console.error('Failed to delete EventBridge schedule by ARN:', arnError);
          }
        }
      }
      return;
    }
    console.error('Failed to delete EventBridge schedule:', error);
    // Don't throw - downgrade should succeed even if schedule deletion fails
  }
}

/**
 * Send a notification to the user about grace period expiry and downgrade to free plan.
 * Includes information about preserved purchased credits.
 *
 * Requirements: 2.7
 */
async function sendDowngradeNotification(userId: string, subscriptionId: string): Promise<void> {
  const notification = {
    userId,
    subscriptionId,
    type: 'subscription_downgraded',
    reason: 'grace_period_expired',
    message: 'Your subscription has been downgraded to the Free plan because the grace period expired without successful renewal. Your purchased credit pack credits have been preserved. Please subscribe again to restore your plan.',
    timestamp: new Date().toISOString(),
  };

  if (SNS_NOTIFICATION_TOPIC_ARN) {
    try {
      await snsClient.send(
        new PublishCommand({
          TopicArn: SNS_NOTIFICATION_TOPIC_ARN,
          Message: JSON.stringify(notification),
          MessageAttributes: {
            userId: { DataType: 'String', StringValue: userId },
            notificationType: { DataType: 'String', StringValue: 'subscription_downgraded' },
          },
        })
      );
      console.log('Downgrade notification sent via SNS:', notification);
    } catch (error) {
      console.error('Failed to send downgrade notification:', error);
      // Don't throw - notification failure shouldn't block downgrade processing
    }
  } else {
    console.log('Downgrade notification (no SNS topic configured):', notification);
  }
}

// ---------------------------------------------------------------------------
// Database Operations
// ---------------------------------------------------------------------------

interface SubscriptionRow {
  id: string;
  user_id: string;
  plan: string;
  status: string;
  credits_remaining: number;
  credits_monthly_limit: number;
  billing_cycle_start: string;
  billing_cycle_end: string;
  wallet_address: string | null;
  grace_period_start: string | null;
  grace_period_end: string | null;
  eventbridge_schedule_arn: string | null;
}

async function getSubscription(subscriptionId: string): Promise<SubscriptionRow | null> {
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
    const result = await client.query(
      `SELECT id, user_id, plan, status, credits_remaining, credits_monthly_limit,
              billing_cycle_start, billing_cycle_end, wallet_address,
              grace_period_start, grace_period_end, eventbridge_schedule_arn
       FROM subscriptions
       WHERE id = $1
       LIMIT 1`,
      [subscriptionId]
    );

    if (result.rows.length === 0) return null;
    return result.rows[0] as SubscriptionRow;
  } finally {
    await client.end();
  }
}

async function performAtomicRenewalUpdate(
  subscriptionId: string,
  userId: string,
  creditsPerMonth: number,
  newBillingCycleStart: string,
  newBillingCycleEnd: string,
  txHash: string,
  walletAddress: string,
  plan: string,
  planPrice: number
): Promise<void> {
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
    await client.query('BEGIN');

    // Reset credits, advance billing cycle (Req 2.3)
    await client.query(WALLET_QUERIES.processRenewal, [
      creditsPerMonth,
      newBillingCycleStart,
      newBillingCycleEnd,
      subscriptionId,
    ]);

    // Record payment transaction
    await client.query(WALLET_QUERIES.recordPaymentTransaction, [
      userId,
      'renewal_payment',
      planPrice,
      txHash,
      walletAddress,
      plan,
      null, // credit_pack_id
      null, // credits_added
    ]);

    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    await client.end();
  }
}

async function setGracePeriod(
  subscriptionId: string,
  gracePeriodStart: string,
  gracePeriodEnd: string
): Promise<void> {
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
    await client.query(
      `UPDATE subscriptions
       SET status = 'grace_period',
           grace_period_start = $1,
           grace_period_end = $2
       WHERE id = $3`,
      [gracePeriodStart, gracePeriodEnd, subscriptionId]
    );
  } finally {
    await client.end();
  }
}

async function updateScheduleArn(subscriptionId: string, scheduleArn: string): Promise<void> {
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
    await client.query(
      'UPDATE subscriptions SET eventbridge_schedule_arn = $1 WHERE id = $2',
      [scheduleArn, subscriptionId]
    );
  } finally {
    await client.end();
  }
}

// ---------------------------------------------------------------------------
// DynamoDB Dedup Operations (Req 2.10)
// ---------------------------------------------------------------------------

async function checkDedupKey(dedupKey: string): Promise<boolean> {
  if (!DEDUP_TABLE) {
    console.warn('DEDUP_TABLE not set, skipping dedup check');
    return false;
  }

  try {
    const result = await dynamoClient.send(
      new GetItemCommand({
        TableName: DEDUP_TABLE,
        Key: {
          pk: { S: dedupKey },
        },
      })
    );

    return !!result.Item;
  } catch (error) {
    console.error('DynamoDB dedup check failed:', error);
    // On failure, proceed with processing (better to risk a duplicate than miss a renewal)
    return false;
  }
}

async function writeDedupKey(dedupKey: string, txHash: string, status: string): Promise<void> {
  if (!DEDUP_TABLE) {
    console.warn('DEDUP_TABLE not set, skipping dedup write');
    return;
  }

  const now = new Date();
  const ttl = Math.floor(now.getTime() / 1000) + DEDUP_TTL_DAYS * 24 * 60 * 60;

  try {
    await dynamoClient.send(
      new PutItemCommand({
        TableName: DEDUP_TABLE,
        Item: {
          pk: { S: dedupKey },
          processed_at: { S: now.toISOString() },
          tx_hash: { S: txHash },
          status: { S: status },
          ttl: { N: ttl.toString() },
        },
        // Conditional write to ensure exactly-once processing
        ConditionExpression: 'attribute_not_exists(pk)',
      })
    );
  } catch (error: unknown) {
    const err = error as { name?: string };
    if (err.name === 'ConditionalCheckFailedException') {
      // Another invocation already wrote the dedup key - this is fine
      console.log('Dedup key already exists (concurrent write):', dedupKey);
      return;
    }
    console.error('DynamoDB dedup write failed:', error);
    // Don't throw - the renewal was already processed successfully
  }
}

// ---------------------------------------------------------------------------
// EventBridge Schedule Operations (Req 8.1)
// ---------------------------------------------------------------------------

async function createRenewalSchedule(subscriptionId: string, billingCycleEnd: string): Promise<string | null> {
  if (!RENEWAL_QUEUE_ARN || !SCHEDULER_ROLE_ARN) {
    console.warn('RENEWAL_QUEUE_ARN or SCHEDULER_ROLE_ARN not set, skipping schedule creation');
    return null;
  }

  try {
    const scheduleName = `renewal-${subscriptionId}`;
    const scheduleDate = new Date(billingCycleEnd);

    // EventBridge Scheduler uses at() expression for one-time schedules
    const scheduleExpression = `at(${scheduleDate.toISOString().replace(/\.\d{3}Z$/, '')})`;

    const result = await schedulerClient.send(
      new CreateScheduleCommand({
        Name: scheduleName,
        ScheduleExpression: scheduleExpression,
        ScheduleExpressionTimezone: 'UTC',
        FlexibleTimeWindow: { Mode: 'OFF' },
        Target: {
          Arn: RENEWAL_QUEUE_ARN,
          RoleArn: SCHEDULER_ROLE_ARN,
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
 * handler can distinguish reminder events from actual renewal events.
 *
 * Requirements: 2.8, 8.1
 */
async function createReminderSchedule(subscriptionId: string, billingCycleEnd: string): Promise<string | null> {
  if (!RENEWAL_QUEUE_ARN || !SCHEDULER_ROLE_ARN) {
    console.warn('RENEWAL_QUEUE_ARN or SCHEDULER_ROLE_ARN not set, skipping reminder schedule creation');
    return null;
  }

  try {
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

    const result = await schedulerClient.send(
      new CreateScheduleCommand({
        Name: scheduleName,
        ScheduleExpression: scheduleExpression,
        ScheduleExpressionTimezone: 'UTC',
        FlexibleTimeWindow: { Mode: 'OFF' },
        Target: {
          Arn: RENEWAL_QUEUE_ARN,
          RoleArn: SCHEDULER_ROLE_ARN,
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
 * Schedule a retry in 24 hours during grace period (Req 2.5).
 * Creates a new EventBridge schedule targeting the renewal queue.
 */
async function scheduleRetry(subscriptionId: string, billingCycleEnd: string): Promise<void> {
  if (!RENEWAL_QUEUE_ARN || !SCHEDULER_ROLE_ARN) {
    console.warn('RENEWAL_QUEUE_ARN or SCHEDULER_ROLE_ARN not set, skipping retry schedule');
    return;
  }

  try {
    const retryTime = new Date(Date.now() + RETRY_INTERVAL_HOURS * 60 * 60 * 1000);
    const scheduleName = `renewal-retry-${subscriptionId}-${retryTime.getTime()}`;
    const scheduleExpression = `at(${retryTime.toISOString().replace(/\.\d{3}Z$/, '')})`;

    await schedulerClient.send(
      new CreateScheduleCommand({
        Name: scheduleName,
        ScheduleExpression: scheduleExpression,
        ScheduleExpressionTimezone: 'UTC',
        FlexibleTimeWindow: { Mode: 'OFF' },
        Target: {
          Arn: RENEWAL_QUEUE_ARN,
          RoleArn: SCHEDULER_ROLE_ARN,
          Input: JSON.stringify({
            subscriptionId,
            billingCycleEnd,
          }),
        },
        ActionAfterCompletion: 'DELETE',
      })
    );

    console.log('Retry scheduled for:', retryTime.toISOString());
  } catch (error) {
    console.error('Failed to schedule retry:', error);
    // Don't throw - grace period was already set
  }
}

// ---------------------------------------------------------------------------
// Notification (Req 2.6)
// ---------------------------------------------------------------------------

/**
 * Send a notification to the user about renewal failure.
 * Uses SNS topic if configured, otherwise logs the notification.
 */
async function sendNotification(userId: string, subscriptionId: string, reason: string): Promise<void> {
  const reasonMessages: Record<string, string> = {
    insufficient_allowance: 'Your auto-renewal allowance is insufficient. Please return to the app and re-approve it.',
    insufficient_balance: 'Your Trading Wallet balance is insufficient for renewal. Please add funds and try again.',
    no_wallet: 'No wallet address is associated with your subscription. Please contact support.',
    transfer_reverted: 'The renewal transfer was reverted on-chain. Please check your wallet and try again.',
  };

  const message = reasonMessages[reason] || 'Subscription renewal failed. Please check your wallet.';

  const notification = {
    userId,
    subscriptionId,
    type: 'renewal_failed',
    reason,
    message,
    timestamp: new Date().toISOString(),
  };

  if (SNS_NOTIFICATION_TOPIC_ARN) {
    try {
      await snsClient.send(
        new PublishCommand({
          TopicArn: SNS_NOTIFICATION_TOPIC_ARN,
          Message: JSON.stringify(notification),
          MessageAttributes: {
            userId: { DataType: 'String', StringValue: userId },
            notificationType: { DataType: 'String', StringValue: 'renewal_failed' },
          },
        })
      );
      console.log('Notification sent via SNS:', notification);
    } catch (error) {
      console.error('Failed to send SNS notification:', error);
      // Don't throw - notification failure shouldn't block renewal processing
    }
  } else {
    // Log the notification for now (no SNS topic configured)
    console.log('Notification (no SNS topic configured):', notification);
  }
}
