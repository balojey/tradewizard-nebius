/**
 * Analysis Request Service - Lambda handler.
 *
 * Implements the market-level analysis pool with per-user delivery tracking:
 *
 * 1. One fresh analysis per market per hour (hard minimum)
 * 2. Every user who receives an analysis pays 1 credit
 * 3. Users never pay for something they don't receive
 * 4. Users never receive the same analysis twice
 *
 * Flow:
 *   Request → Check latest result (1hr window) →
 *     Case 1: Fresh result exists, user hasn't received it → charge, deliver
 *     Case 2: Fresh result exists, user already has it → check upcoming schedule
 *       → Has schedule: subscribe user (free) → No schedule: "come back in X min"
 *     Case 3: No fresh result, analysis in-flight → charge, subscribe to pending
 *     Case 4: No fresh result, nothing in-flight → charge, dispatch new execution
 *
 * Triggered by: API Gateway POST /analysis
 */

import { SQSClient, SendMessageCommand } from '@aws-sdk/client-sqs';
import {
  SchedulerClient,
  CreateScheduleCommand,
  GetScheduleCommand,
  UpdateScheduleCommand,
} from '@aws-sdk/client-scheduler';
import {
  EventBridgeClient,
  PutEventsCommand,
} from '@aws-sdk/client-eventbridge';
import {
  checkDedupCache,
  checkInFlight,
  markInFlight,
} from '../shared/dynamo';
import { getConnectionString, getUserIdByCognitoSub, ensureUser } from '../shared/db';
import { resetFreePlanIfCycleExpired } from '../shared/credits';

const sqsClient = new SQSClient({});
const schedulerClient = new SchedulerClient({});
const eventBridgeClient = new EventBridgeClient({});

const ANALYSIS_QUEUE_URL = process.env.ANALYSIS_QUEUE_URL || '';
const SCHEDULER_ROLE_ARN = process.env.SCHEDULER_ROLE_ARN || '';
const SCHEDULER_TARGET_ARN = process.env.SCHEDULER_TARGET_ARN || '';
const EVENT_BUS_NAME = process.env.EVENT_BUS_NAME || 'default';
const ENVIRONMENT = process.env.ENVIRONMENT || 'development';

// Hard minimum: 1 hour between analyses on the same market
const MARKET_FRESHNESS_WINDOW_MS = 60 * 60 * 1000; // 1 hour

interface AnalysisRequestBody {
  marketId: string;
  requestType: 'one_time' | 'recurring';
  intervalSeconds?: number; // Required for recurring: 3600, 14400, 43200, 86400
}

interface ApiGatewayEvent {
  body: string | null;
  requestContext: {
    authorizer: {
      claims: {
        sub: string; // Cognito user ID
        email: string;
      };
    };
  };
  pathParameters?: Record<string, string>;
  queryStringParameters?: Record<string, string>;
  httpMethod: string;
  path: string;
}

interface ApiResponse {
  statusCode: number;
  headers: Record<string, string>;
  body: string;
}

/**
 * Main Lambda handler for POST /analysis and GET /analysis/status
 */
export async function handler(event: ApiGatewayEvent): Promise<ApiResponse> {
  const corsHeaders = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type,Authorization',
  };

  try {
    // Route: GET /analysis/status?marketId=X
    if (event.httpMethod === 'GET' && event.path?.endsWith('/status')) {
      const cognitoSub = event.requestContext.authorizer.claims.sub;
      const email = event.requestContext.authorizer.claims.email;
      const marketId = event.queryStringParameters?.marketId;

      if (!marketId) {
        return response(400, { error: 'marketId query parameter is required' }, corsHeaders);
      }

      // Ensure user exists (self-healing: creates if missing)
      const userId = await ensureUser(cognitoSub, email);
      const status = await getAnalysisStatusForUser(userId, marketId);
      return response(200, status, corsHeaders);
    }

    // Route: POST /analysis
    if (!event.body) {
      return response(400, { error: 'Request body is required' }, corsHeaders);
    }

    const body: AnalysisRequestBody = JSON.parse(event.body);
    const cognitoSub = event.requestContext.authorizer.claims.sub;
    const email = event.requestContext.authorizer.claims.email;

    const validation = validateRequest(body);
    if (validation) {
      return response(400, { error: validation }, corsHeaders);
    }

    // Ensure user exists (self-healing: creates if missing)
    const userId = await ensureUser(cognitoSub, email);

    const result = await processAnalysisRequest(userId, body);
    return response(result.statusCode, result.body, corsHeaders);
  } catch (error) {
    console.error('Analysis request failed:', error);
    return response(500, { error: 'Internal server error' }, corsHeaders);
  }
}

/**
 * Core request processing logic implementing the market-level analysis pool.
 */
async function processAnalysisRequest(
  userId: string,
  request: AnalysisRequestBody
): Promise<{ statusCode: number; body: Record<string, unknown> }> {
  const { marketId, requestType, intervalSeconds } = request;
  const requestId = crypto.randomUUID();

  // ─── Prevent duplicate recurring subscriptions on the same market ───────────
  if (requestType === 'recurring') {
    const existingSub = await getExistingRecurringSubscription(userId, marketId);
    if (existingSub) {
      return {
        statusCode: 409,
        body: {
          error: 'You already have an active recurring analysis on this market.',
          code: 'DUPLICATE_RECURRING',
          existingSubscription: {
            requestId: existingSub.requestId,
            intervalSeconds: existingSub.intervalSeconds,
            createdAt: existingSub.createdAt,
          },
          message: `You already have a recurring analysis set to every ${formatIntervalLabel(existingSub.intervalSeconds)}. Cancel the existing one first to change the interval.`,
        },
      };
    }
  }

  // ─── Block one-time requests when a recurring subscription is active ────────
  // Users with an active recurring analysis on a market should not be able to
  // request a one-time analysis - the recurring schedule already covers it.
  // They must cancel the recurring subscription first.
  if (requestType === 'one_time') {
    const existingSub = await getExistingRecurringSubscription(userId, marketId);
    if (existingSub) {
      return {
        statusCode: 409,
        body: {
          error: 'You have an active recurring analysis on this market. Cancel it first to request a one-time analysis.',
          code: 'RECURRING_ACTIVE',
          existingSubscription: {
            requestId: existingSub.requestId,
            intervalSeconds: existingSub.intervalSeconds,
            createdAt: existingSub.createdAt,
          },
          message: `You already have a recurring analysis set to every ${formatIntervalLabel(existingSub.intervalSeconds)}. Cancel the recurring subscription first to request a one-time analysis.`,
        },
      };
    }
  }

  // Create the analysis_request record upfront (needed for FK in analysis_deliveries)
  // For recurring requests, the unique index enforces one-active-per-user-per-market.
  try {
    await createAnalysisRequest(userId, requestId, marketId, requestType, intervalSeconds || null);
  } catch (error) {
    if (error instanceof Error && error.name === 'DuplicateRecurringError') {
      return {
        statusCode: 409,
        body: {
          error: 'You already have an active recurring analysis on this market.',
          code: 'DUPLICATE_RECURRING',
          message: 'You already have an active recurring analysis on this market. Cancel the existing one first to change the interval.',
        },
      };
    }
    // For non-recurring, swallow - one-time requests don't need this constraint
    if (requestType === 'recurring') {
      return {
        statusCode: 500,
        body: { error: 'Failed to create recurring subscription. Please try again.' },
      };
    }
  }

  // Publish recurring-analysis.created event so the portfolio-analysis-consumer
  // can auto-resume any paused PM sessions on this market.
  if (requestType === 'recurring') {
    await publishRecurringAnalysisCreatedEvent(userId, requestId, marketId, intervalSeconds || 0);
  }

  // ─── Step 1: Check for a fresh result (< 1hr old) in the dedup cache ────────
  const latestResult = await checkDedupCache(marketId, MARKET_FRESHNESS_WINDOW_MS);

  if (latestResult) {
    // ─── Step 2: Fresh result exists - has this user already received it? ──────
    const alreadyDelivered = await hasUserReceivedResult(userId, latestResult.resultId);

    if (!alreadyDelivered) {
      // Case 1: User hasn't seen this result → charge and deliver
      const hasCredits = await checkUserCredits(userId);
      if (!hasCredits) {
        return {
          statusCode: 402,
          body: { error: 'Insufficient credits', code: 'NO_CREDITS' },
        };
      }

      await deductCredit(userId, requestId);
      await recordDelivery(userId, latestResult.resultId, requestId);

      // Publish AnalysisCompleted to EventBridge → SNS → email/push/webhook
      // delivery handlers. Without this, users on email/push/webhook plans
      // would never see cached deliveries through their preferred channels
      // (the API response covers in-app only).
      await publishCachedAnalysisCompletion(userId, requestId, marketId, latestResult);

      // Set up recurring schedule if requested
      if (requestType === 'recurring' && intervalSeconds) {
        await createOrUpdateSchedule(marketId, intervalSeconds, userId, requestId);
        await subscribeUserToMarket(userId, marketId, requestId);
      }

      return {
        statusCode: 200,
        body: {
          status: 'completed',
          requestId,
          resultId: latestResult.resultId,
          recommendation: latestResult.recommendation,
          consensusProbability: latestResult.consensusProbability,
          resultPayloadS3Key: latestResult.resultPayloadS3Key,
          executedAt: latestResult.executedAt,
        },
      };
    }

    // Case 2: User already has this result - don't charge, don't re-deliver
    // Check if there's an upcoming scheduled execution for this market
    const upcomingSchedule = await getUpcomingSchedule(marketId);

    if (upcomingSchedule) {
      // Subscribe user to the next scheduled delivery (they'll pay when it arrives)
      if (requestType === 'recurring' && intervalSeconds) {
        await createOrUpdateSchedule(marketId, intervalSeconds, userId, requestId);
      }
      await subscribeUserToMarket(userId, marketId, requestId);

      // Only mark one-time requests as completed - recurring requests must stay 'active'
      // so GET /analysis/subscriptions can find them.
      if (requestType !== 'recurring') {
        await markRequestCompleted(requestId);
      }

      return {
        statusCode: 200,
        body: {
          status: 'subscribed_to_upcoming',
          requestId,
          message: 'You already have the latest analysis. You are subscribed to the next scheduled analysis.',
          nextAnalysisAt: upcomingSchedule.nextScheduledRun,
        },
      };
    }

    // No upcoming schedule - tell user when next analysis will be available
    const executedAtMs = new Date(latestResult.executedAt).getTime();
    const nextAvailableAt = new Date(executedAtMs + MARKET_FRESHNESS_WINDOW_MS).toISOString();
    const minutesRemaining = Math.ceil(
      (executedAtMs + MARKET_FRESHNESS_WINDOW_MS - Date.now()) / 60000
    );

    // If they want recurring, set it up - it'll fire after the cooldown
    if (requestType === 'recurring' && intervalSeconds) {
      await createOrUpdateSchedule(marketId, intervalSeconds, userId, requestId);
      await subscribeUserToMarket(userId, marketId, requestId);
      // Do NOT mark recurring requests as completed - they must stay 'active'
      // so GET /analysis/subscriptions can find them and the schedule keeps delivering.

      return {
        statusCode: 200,
        body: {
          status: 'recurring_scheduled',
          requestId,
          message: `You already have the latest analysis. Your recurring schedule is set up - next analysis in approximately ${minutesRemaining} minutes.`,
          nextAvailableAt,
        },
      };
    }

    await markRequestCompleted(requestId);

    return {
      statusCode: 200,
      body: {
        status: 'already_delivered',
        requestId,
        message: `You already have the latest analysis for this market. The next analysis will be available in ${minutesRemaining} minutes.`,
        nextAvailableAt,
      },
    };
  }

  // ─── Step 3: No fresh result - check if analysis is in-flight ───────────────
  const inFlightRequestId = await checkInFlight(marketId);

  if (inFlightRequestId) {
    // Case 4: Analysis running - charge and subscribe to pending result
    const hasCredits = await checkUserCredits(userId);
    if (!hasCredits) {
      return {
        statusCode: 402,
        body: { error: 'Insufficient credits', code: 'NO_CREDITS' },
      };
    }

    await deductCredit(userId, requestId);
    await subscribeToInFlightResult(userId, marketId, inFlightRequestId, requestId);

    // Set up recurring schedule if requested
    if (requestType === 'recurring' && intervalSeconds) {
      await createOrUpdateSchedule(marketId, intervalSeconds, userId, requestId);
    }

    return {
      statusCode: 202,
      body: {
        status: 'pending',
        requestId,
        inFlightRequestId,
        message: 'Analysis in progress - you will be notified when complete.',
      },
    };
  }

  // ─── Step 4: No fresh result, nothing in-flight → dispatch new execution ────
  const hasCredits = await checkUserCredits(userId);
  if (!hasCredits) {
    return {
      statusCode: 402,
      body: { error: 'Insufficient credits', code: 'NO_CREDITS' },
    };
  }

  await deductCredit(userId, requestId);
  await markInFlight(marketId, requestId);
  await subscribeUserToMarket(userId, marketId, requestId); // Always subscribe so orchestrator can record delivery
  await dispatchToSqs(marketId, requestId, userId, requestType);

  // Set up recurring schedule if requested
  if (requestType === 'recurring' && intervalSeconds) {
    await createOrUpdateSchedule(marketId, intervalSeconds, userId, requestId);
  }

  return {
    statusCode: 202,
    body: {
      status: 'queued',
      requestId,
      message: 'Analysis queued - you will be notified when complete.',
      estimatedDuration: '30-90 seconds',
    },
  };
}

// ─── Validation ─────────────────────────────────────────────────────────────────

function validateRequest(body: AnalysisRequestBody): string | null {
  if (!body.marketId) return 'marketId is required';
  // Reject characters reserved for internal namespacing in the dedup-cache
  // table (e.g. request#{requestId} idempotency markers in the orchestrator).
  // Real Polymarket condition IDs are 0x-prefixed hex; '#' never appears.
  if (body.marketId.includes('#')) return 'marketId contains a reserved character';
  if (!body.requestType) return 'requestType is required';
  if (!['one_time', 'recurring'].includes(body.requestType)) {
    return 'requestType must be "one_time" or "recurring"';
  }
  if (body.requestType === 'recurring') {
    if (!body.intervalSeconds) return 'intervalSeconds is required for recurring requests';
    if (![3600, 14400, 43200, 86400].includes(body.intervalSeconds)) {
      return 'intervalSeconds must be 3600 (1h), 14400 (4h), 43200 (12h), or 86400 (1d)';
    }
  }
  return null;
}

// ─── Duplicate Recurring Subscription Check (RDS) ───────────────────────────────

interface ExistingRecurringSub {
  requestId: string;
  intervalSeconds: number;
  createdAt: string;
}

/**
 * Check if this user already has an active recurring subscription on this market.
 * Returns the existing subscription details if one exists, null otherwise.
 *
 * A user may only have ONE active recurring analysis per market. To change the
 * interval they must cancel the existing one first. This prevents:
 * - Duplicate charges on every scheduled fire
 * - Confusing UI with multiple subscriptions per market
 * - Wasted EventBridge schedule clutter
 */
async function getExistingRecurringSubscription(
  userId: string,
  marketId: string
): Promise<ExistingRecurringSub | null> {
  const connectionString = await getConnectionString();
  const pg = await import('pg');
  const client = new pg.Client({ connectionString, ssl: { rejectUnauthorized: false } });

  try {
    await client.connect();
    const result = await client.query(
      `SELECT ar.id, ar.interval_seconds, ar.created_at
       FROM analysis_requests ar
       WHERE ar.user_id = $1
         AND ar.market_id = $2
         AND ar.request_type = 'recurring'
         AND ar.status = 'active'
       ORDER BY ar.created_at DESC
       LIMIT 1`,
      [userId, marketId]
    );

    if (result.rows.length === 0) return null;

    const row = result.rows[0];
    return {
      requestId: row.id,
      intervalSeconds: Number(row.interval_seconds),
      createdAt: row.created_at,
    };
  } catch (error) {
    console.error('Existing recurring subscription check failed:', error);
    // Fail open: allow the request if the check fails (better UX than blocking)
    return null;
  } finally {
    await client.end();
  }
}

/**
 * Helper to format interval seconds into a human-readable label.
 */
function formatIntervalLabel(seconds: number): string {
  if (seconds >= 86400) return `${seconds / 86400} day(s)`;
  if (seconds >= 3600) return `${seconds / 3600} hour(s)`;
  return `${seconds / 60} minute(s)`;
}

// ─── Per-User Delivery Tracking (RDS) ───────────────────────────────────────────

/**
 * Create an analysis_request record in RDS.
 * This is needed as a FK target for analysis_deliveries and market_subscribers.
 *
 * For recurring requests, this will throw if the partial unique index
 * `idx_one_active_recurring_per_user_market` is violated (race condition safety net).
 */
async function createAnalysisRequest(
  userId: string,
  requestId: string,
  marketId: string,
  requestType: string,
  intervalSeconds: number | null
): Promise<void> {
  const connectionString = await getConnectionString();
  const pg = await import('pg');
  const client = new pg.Client({ connectionString, ssl: { rejectUnauthorized: false } });

  try {
    await client.connect();
    await client.query(
      `INSERT INTO analysis_requests (id, user_id, market_id, request_type, interval_seconds, status)
       VALUES ($1::uuid, $2, $3, $4, $5, 'active')
       ON CONFLICT (id) DO NOTHING`,
      [requestId, userId, marketId, requestType, intervalSeconds]
    );
  } catch (error) {
    // If the unique index fires, surface it as a typed error the caller can catch
    const pgErr = error as { code?: string; constraint?: string };
    if (pgErr.code === '23505' && pgErr.constraint === 'idx_one_active_recurring_per_user_market') {
      const duplicateError = new Error('DUPLICATE_RECURRING');
      duplicateError.name = 'DuplicateRecurringError';
      throw duplicateError;
    }
    console.error('Failed to create analysis request record:', error);
    // Non-fatal for non-recurring - delivery tracking may fail but the analysis flow continues
    if (requestType === 'recurring') throw error;
  } finally {
    await client.end();
  }
}

/**
 * Mark an analysis request as 'completed' - used for Case 2 responses where
 * no new analysis is dispatched (user already has the result, or is subscribed
 * to an upcoming schedule). Without this, the request stays 'active' forever
 * and the status endpoint incorrectly reports it as pending.
 */
async function markRequestCompleted(requestId: string): Promise<void> {
  const connectionString = await getConnectionString();
  const pg = await import('pg');
  const client = new pg.Client({ connectionString, ssl: { rejectUnauthorized: false } });

  try {
    await client.connect();
    await client.query(
      `UPDATE analysis_requests SET status = 'completed' WHERE id = $1::uuid`,
      [requestId]
    );
  } catch (error) {
    console.error(`Failed to mark request ${requestId} as completed:`, error);
  } finally {
    await client.end();
  }
}

/**
 * Check if a user has already received a specific analysis result.
 * Queries the analysis_deliveries table.
 */
async function hasUserReceivedResult(userId: string, resultId: string): Promise<boolean> {
  const connectionString = await getConnectionString();
  const pg = await import('pg');
  const client = new pg.Client({ connectionString, ssl: { rejectUnauthorized: false } });

  try {
    await client.connect();
    const result = await client.query(
      `SELECT 1
       FROM analysis_deliveries ad
       WHERE ad.user_id = $1 AND ad.result_id = $2::uuid
       LIMIT 1`,
      [userId, resultId]
    );
    return result.rows.length > 0;
  } catch (error) {
    console.error('Delivery check failed:', error);
    // Fail safe: assume not delivered (user will be charged and get the result)
    return false;
  } finally {
    await client.end();
  }
}

/**
 * Record that a user has received an analysis result.
 * Inserts into analysis_deliveries for per-user tracking.
 */
async function recordDelivery(
  userId: string,
  resultId: string,
  requestId: string
): Promise<void> {
  const connectionString = await getConnectionString();
  const pg = await import('pg');
  const client = new pg.Client({ connectionString, ssl: { rejectUnauthorized: false } });

  try {
    await client.connect();
    await client.query(
      `INSERT INTO analysis_deliveries (result_id, user_id, analysis_request_id, was_cached_delivery, delivery_channel)
       VALUES ($1::uuid, $2, $3::uuid, false, 'in_app')
       ON CONFLICT (result_id, user_id, analysis_request_id) DO NOTHING`,
      [resultId, userId, requestId]
    );
    console.log(`Recorded delivery of result ${resultId} to user ${userId}`);
  } catch (error) {
    console.error('Failed to record delivery:', error);
  } finally {
    await client.end();
  }
}

// ─── Upcoming Schedule Check (RDS) ──────────────────────────────────────────────

interface UpcomingSchedule {
  marketId: string;
  nextScheduledRun: string;
  shortestIntervalSeconds: number;
}

/**
 * Check if there's an upcoming scheduled analysis for this market.
 * Queries the market_analysis_schedule table.
 */
async function getUpcomingSchedule(marketId: string): Promise<UpcomingSchedule | null> {
  const connectionString = await getConnectionString();
  const pg = await import('pg');
  const client = new pg.Client({ connectionString, ssl: { rejectUnauthorized: false } });

  try {
    await client.connect();
    const result = await client.query(
      `SELECT market_id, next_scheduled_run, shortest_interval_seconds
       FROM market_analysis_schedule
       WHERE market_id = $1 AND status = 'active'
       LIMIT 1`,
      [marketId]
    );

    if (result.rows.length === 0) return null;

    const row = result.rows[0];
    return {
      marketId: row.market_id,
      nextScheduledRun: row.next_scheduled_run,
      shortestIntervalSeconds: row.shortest_interval_seconds,
    };
  } catch (error) {
    console.error('Schedule check failed:', error);
    return null;
  } finally {
    await client.end();
  }
}

// ─── Market Subscriber Management (RDS) ─────────────────────────────────────────

/**
 * Subscribe a user to a market's analysis deliveries.
 * They will receive (and be charged for) future analyses on this market.
 */
async function subscribeUserToMarket(
  userId: string,
  marketId: string,
  requestId: string
): Promise<void> {
  const connectionString = await getConnectionString();
  const pg = await import('pg');
  const client = new pg.Client({ connectionString, ssl: { rejectUnauthorized: false } });

  try {
    await client.connect();
    await client.query(
      `INSERT INTO market_subscribers (market_id, user_id, analysis_request_id)
       VALUES ($1, $2, $3::uuid)
       ON CONFLICT (market_id, user_id, analysis_request_id) DO NOTHING`,
      [marketId, userId, requestId]
    );
    console.log(`Subscribed user ${userId} to market ${marketId} deliveries`);
  } catch (error) {
    console.error('Failed to subscribe user to market:', error);
  } finally {
    await client.end();
  }
}

/**
 * Subscribe a user to receive the result of an in-flight analysis.
 */
async function subscribeToInFlightResult(
  userId: string,
  marketId: string,
  inFlightRequestId: string,
  userRequestId: string
): Promise<void> {
  const connectionString = await getConnectionString();
  const pg = await import('pg');
  const client = new pg.Client({ connectionString, ssl: { rejectUnauthorized: false } });

  try {
    await client.connect();
    await client.query(
      `INSERT INTO market_subscribers (market_id, user_id, analysis_request_id)
       VALUES ($1, $2, $3::uuid)
       ON CONFLICT (market_id, user_id, analysis_request_id) DO NOTHING`,
      [marketId, userId, userRequestId]
    );
    console.log(`Subscribed user ${userId} to in-flight result ${inFlightRequestId} for market ${marketId}`);
  } catch (error) {
    console.error('Failed to subscribe user to in-flight result:', error);
  } finally {
    await client.end();
  }
}

// ─── Credit Operations (RDS) ────────────────────────────────────────────────────

async function checkUserCredits(userId: string): Promise<boolean> {
  const connectionString = await getConnectionString();
  const pg = await import('pg');
  const client = new pg.Client({ connectionString, ssl: { rejectUnauthorized: false } });

  try {
    await client.connect();

    // Lazy monthly credit reset for free-plan users with an expired billing cycle
    await resetFreePlanIfCycleExpired(client, userId);

    const result = await client.query(
      `SELECT s.credits_remaining
       FROM subscriptions s
       WHERE s.user_id = $1 AND s.status IN ('active', 'grace_period')
       LIMIT 1`,
      [userId]
    );

    if (result.rows.length === 0) {
      // No subscription found - allow (free tier default)
      console.log(`No subscription found for user ${userId}, allowing request`);
      return true;
    }

    const credits = result.rows[0].credits_remaining;
    console.log(`User ${userId} has ${credits} credits remaining`);
    return credits > 0;
  } catch (error) {
    console.error('Credit check failed:', error);
    // Fail open - allow the request rather than blocking users due to DB issues
    return true;
  } finally {
    await client.end();
  }
}

async function deductCredit(userId: string, requestId: string): Promise<void> {
  const connectionString = await getConnectionString();
  const pg = await import('pg');
  const client = new pg.Client({ connectionString, ssl: { rejectUnauthorized: false } });

  try {
    await client.connect();

    const result = await client.query(
      `UPDATE subscriptions
       SET credits_remaining = credits_remaining - 1
       WHERE user_id = $1
         AND status IN ('active', 'grace_period') AND credits_remaining > 0
       RETURNING credits_remaining`,
      [userId]
    );

    if (result.rows.length > 0) {
      const newBalance = result.rows[0].credits_remaining;
      await client.query(
        `INSERT INTO credit_transactions (user_id, amount, balance_after, reason, reference_id, reference_type)
         VALUES ($1, -1, $2, 'analysis_request', $3::uuid, 'analysis')`,
        [userId, newBalance, requestId]
      );
      console.log(`Deducted 1 credit from user ${userId}, new balance: ${newBalance}`);
    } else {
      console.warn(`Failed to deduct credit for user ${userId} - no active subscription or zero balance`);
    }
  } catch (error) {
    console.error('Credit deduction failed:', error);
  } finally {
    await client.end();
  }
}

// ─── SQS Dispatch ───────────────────────────────────────────────────────────────

async function dispatchToSqs(
  marketId: string,
  requestId: string,
  userId: string,
  requestType: string
): Promise<void> {
  await sqsClient.send(
    new SendMessageCommand({
      QueueUrl: ANALYSIS_QUEUE_URL,
      MessageBody: JSON.stringify({
        requestId,
        marketId,
        userId,
        requestType,
        timestamp: new Date().toISOString(),
      }),
      MessageGroupId: marketId, // Per-market ordering
      MessageDeduplicationId: requestId,
    })
  );
}

// ─── EventBridge Schedule Management ────────────────────────────────────────────

async function createOrUpdateSchedule(
  marketId: string,
  intervalSeconds: number,
  userId: string,
  requestId: string
): Promise<void> {
  const scheduleName = `tw-${ENVIRONMENT}-${marketId.slice(0, 20)}-${intervalSeconds}`;

  const rateExpression = intervalSeconds >= 86400
    ? intervalSeconds / 86400 === 1
      ? 'rate(1 day)'
      : `rate(${intervalSeconds / 86400} days)`
    : intervalSeconds / 3600 === 1
      ? 'rate(1 hour)'
      : `rate(${intervalSeconds / 3600} hours)`;

  let scheduleAlreadyExists = false;

  // Build the correct Input payload with context attribute for unique messages
  const scheduleInput = JSON.stringify({
    marketId,
    userId,
    requestType: 'recurring',
    isScheduledFire: true,
    // Use <aws.scheduler.execution-id> context attribute to make each
    // message body unique - prevents SQS FIFO content-based dedup from
    // silently dropping repeated fires with identical payloads.
    scheduledFireId: '<aws.scheduler.execution-id>',
  });

  try {
    const existingSchedule = await schedulerClient.send(new GetScheduleCommand({ Name: scheduleName }));
    scheduleAlreadyExists = true;

    // Migration: if existing schedule has a static requestId in its Input,
    // update it to use the context-attribute-based payload. This fixes schedules
    // created before the dedup bug was fixed.
    const existingInput = existingSchedule.Target?.Input || '';
    if (existingInput.includes('"requestId"')) {
      await schedulerClient.send(
        new UpdateScheduleCommand({
          Name: scheduleName,
          ScheduleExpression: rateExpression,
          FlexibleTimeWindow: { Mode: 'FLEXIBLE', MaximumWindowInMinutes: 5 },
          Target: {
            Arn: SCHEDULER_TARGET_ARN,
            RoleArn: SCHEDULER_ROLE_ARN,
            Input: scheduleInput,
            SqsParameters: {
              MessageGroupId: marketId,
            },
          },
          State: 'ENABLED',
        })
      );
      console.log(`Migrated schedule ${scheduleName} to use execution-id context attribute (was using static requestId)`);
    } else {
      console.log(`Schedule ${scheduleName} already exists and is healthy, user ${userId} will receive results via market subscription`);
    }
  } catch (getErr) {
    // Schedule doesn't exist - create it.
    try {
      await schedulerClient.send(
        new CreateScheduleCommand({
          Name: scheduleName,
          ScheduleExpression: rateExpression,
          FlexibleTimeWindow: { Mode: 'FLEXIBLE', MaximumWindowInMinutes: 5 },
          Target: {
            Arn: SCHEDULER_TARGET_ARN,
            RoleArn: SCHEDULER_ROLE_ARN,
            Input: scheduleInput,
            SqsParameters: {
              MessageGroupId: marketId,
            },
          },
          State: 'ENABLED',
        })
      );
      console.log(`Created schedule ${scheduleName} for market ${marketId}`);
    } catch (createErr) {
      console.error(`Failed to create schedule ${scheduleName} (expression: ${rateExpression}):`, createErr);
      throw createErr;
    }
  }

  // Upsert market_analysis_schedule in RDS so that getUpcomingSchedule()
  // can report the next run time and the subscriptions API can display it.
  await upsertMarketAnalysisSchedule(marketId, intervalSeconds, scheduleAlreadyExists);
}

/**
 * Upsert the market_analysis_schedule row for a market. This table is the
 * source of truth for getUpcomingSchedule() lookups and for the subscriptions
 * list UI.
 *
 * - If the row doesn't exist: create it with next_scheduled_run = now + interval.
 * - If the row exists with a longer interval: update to the shorter one (coalescing).
 * - If the row exists with the same or shorter interval: no-op.
 */
async function upsertMarketAnalysisSchedule(
  marketId: string,
  intervalSeconds: number,
  scheduleAlreadyExists: boolean
): Promise<void> {
  const connectionString = await getConnectionString();
  const pg = await import('pg');
  const client = new pg.Client({ connectionString, ssl: { rejectUnauthorized: false } });

  try {
    await client.connect();

    const nextRun = new Date(Date.now() + intervalSeconds * 1000).toISOString();

    await client.query(
      `INSERT INTO market_analysis_schedule (market_id, shortest_interval_seconds, next_scheduled_run, status)
       VALUES ($1, $2, $3, 'active')
       ON CONFLICT (market_id) DO UPDATE SET
         shortest_interval_seconds = LEAST(market_analysis_schedule.shortest_interval_seconds, EXCLUDED.shortest_interval_seconds),
         next_scheduled_run = CASE
           WHEN EXCLUDED.shortest_interval_seconds < market_analysis_schedule.shortest_interval_seconds
           THEN EXCLUDED.next_scheduled_run
           ELSE market_analysis_schedule.next_scheduled_run
         END,
         status = 'active',
         updated_at = now()`,
      [marketId, intervalSeconds, nextRun]
    );

    console.log(
      `Upserted market_analysis_schedule for market ${marketId}: interval=${intervalSeconds}s, ` +
      `next_run=${nextRun}, schedule_existed=${scheduleAlreadyExists}`
    );
  } catch (error) {
    // Non-fatal: the EventBridge schedule is the actual execution mechanism.
    // This table is informational for user-facing status. Log and continue.
    console.error('Failed to upsert market_analysis_schedule:', error);
  } finally {
    await client.end();
  }
}

// ─── Cached-Delivery Event Publishing ───────────────────────────────────────────

/**
 * Publish an AnalysisCompleted event for a user receiving a cached result.
 * Mirrors the orchestrator's per-subscriber publish so SNS-bound delivery
 * handlers (email, push, webhook, in-app WebSocket) all fire for cached
 * deliveries - a user paid for it, they should get every channel they
 * subscribed to.
 *
 * Carries `wasCached: true` so handlers can render a "previously computed"
 * affordance if desired.
 *
 * Best-effort: failures are logged but don't break the request response -
 * the user already got the in-app result via the REST body.
 */
async function publishCachedAnalysisCompletion(
  cognitoSub: string,
  requestId: string,
  marketId: string,
  latestResult: { resultId: string; recommendation: string; consensusProbability: number; resultPayloadS3Key: string; executedAt: string },
): Promise<void> {
  try {
    const internalUserId = await getUserIdByCognitoSub(cognitoSub);
    if (!internalUserId) {
      console.warn(
        `Cannot publish cached AnalysisCompleted: no users.id resolvable for cognito sub ${cognitoSub}`,
      );
      return;
    }

    // Pull the full result row from RDS so the SNS payload carries the
    // fields the email/push templates expect (confidence, marketQuestion).
    const enrichment = await loadCachedResultEnrichment(latestResult.resultId, marketId);

    await eventBridgeClient.send(
      new PutEventsCommand({
        Entries: [
          {
            Source: 'tradewizard.analysis',
            DetailType: 'AnalysisCompleted',
            EventBusName: EVENT_BUS_NAME,
            Detail: JSON.stringify({
              analysisId: latestResult.resultId,
              analysisRequestId: requestId,
              resultId: latestResult.resultId,
              marketId,
              userId: internalUserId,
              marketQuestion: enrichment.marketQuestion,
              recommendation: latestResult.recommendation,
              consensusProbability: latestResult.consensusProbability,
              confidence: enrichment.confidence,
              edge: enrichment.edge,
              resultPayloadS3Key: latestResult.resultPayloadS3Key,
              executedAt: latestResult.executedAt,
              wasCached: true,
              environment: ENVIRONMENT,
            }),
          },
        ],
      }),
    );

    console.log(
      `Published cached AnalysisCompleted: user=${internalUserId} request=${requestId} result=${latestResult.resultId}`,
    );
  } catch (error) {
    console.error('Failed to publish cached AnalysisCompleted event:', error);
    // Non-fatal - REST response already delivered the result inline.
  }
}

/**
 * Publish a `recurring-analysis.created` event when a new recurring subscription
 * is successfully set up. This allows the portfolio-analysis-consumer to auto-resume
 * any paused portfolio manager sessions on this market for this user.
 *
 * Best-effort - the subscription creation itself has already succeeded.
 */
async function publishRecurringAnalysisCreatedEvent(
  userId: string,
  requestId: string,
  marketId: string,
  intervalSeconds: number,
): Promise<void> {
  try {
    const internalUserId = await getUserIdByCognitoSub(userId);
    if (!internalUserId) {
      console.warn('Cannot publish recurring-analysis.created: no internal user ID for', userId);
      return;
    }

    await eventBridgeClient.send(
      new PutEventsCommand({
        Entries: [
          {
            Source: 'tradewizard.analysis',
            DetailType: 'recurring-analysis.created',
            EventBusName: EVENT_BUS_NAME,
            Detail: JSON.stringify({
              subscriptionId: requestId,
              userId: internalUserId,
              marketId,
              action: 'created',
              intervalSeconds,
              timestamp: new Date().toISOString(),
            }),
          },
        ],
      }),
    );

    console.log(
      `Published recurring-analysis.created: user=${internalUserId} market=${marketId} interval=${intervalSeconds}`,
    );
  } catch (error) {
    console.error('Failed to publish recurring-analysis.created event:', error);
    // Non-fatal: subscription is already created. PM auto-resume is best-effort.
  }
}

interface CachedResultEnrichment {
  marketQuestion: string;
  confidence: number;
  edge: number;
}

/**
 * Pull confidence + marketQuestion from RDS for a cached result so the
 * delivery templates have the same fields as a fresh result.
 *
 * Falls back to safe defaults so the publish always succeeds even if the
 * markets table doesn't have the question cached yet.
 */
async function loadCachedResultEnrichment(
  resultId: string,
  marketId: string,
): Promise<CachedResultEnrichment> {
  const fallback: CachedResultEnrichment = {
    marketQuestion: `Market ${marketId}`,
    confidence: 0,
    edge: 0,
  };

  const connectionString = await getConnectionString();
  const pg = await import('pg');
  const client = new pg.Client({ connectionString, ssl: { rejectUnauthorized: false } });

  try {
    await client.connect();
    const result = await client.query(
      `SELECT ar.confidence_score, ar.edge, COALESCE(m.question, '') AS market_question
       FROM analysis_results ar
       LEFT JOIN markets m ON m.condition_id = ar.market_id
       WHERE ar.id = $1::uuid
       LIMIT 1`,
      [resultId],
    );

    if (result.rows.length === 0) return fallback;
    const row = result.rows[0];
    return {
      marketQuestion: row.market_question || fallback.marketQuestion,
      confidence: row.confidence_score != null ? Number(row.confidence_score) : 0,
      edge: row.edge != null ? Number(row.edge) : 0,
    };
  } catch (error) {
    console.warn('Failed to enrich cached result for publish:', error);
    return fallback;
  } finally {
    await client.end();
  }
}

// ─── Analysis Status (per-user, per-market) ─────────────────────────────────────

/**
 * Returns the in-flight analysis status for a market, but ONLY if the user
 * has a pending (undelivered) request for that market. This prevents users
 * from seeing progress for analyses they didn't request.
 */
async function getAnalysisStatusForUser(
  cognitoSub: string,
  marketId: string
): Promise<Record<string, unknown>> {
  // Step 1: Check if this user has a pending request for this market
  const hasPending = await userHasPendingRequest(cognitoSub, marketId);
  if (!hasPending) {
    return { status: 'none', message: 'No pending analysis for this market.' };
  }

  // Step 2: Check if analysis is in-flight in DynamoDB
  const inFlightRequestId = await checkInFlight(marketId);
  if (!inFlightRequestId) {
    // User has a pending request but nothing is in-flight - it may be queued
    return { status: 'queued', message: 'Analysis is queued and will start shortly.' };
  }

  // Step 3: Return in-flight status
  return {
    status: 'in_progress',
    requestId: inFlightRequestId,
    marketId,
    message: 'Analysis is in progress.',
  };
}

/**
 * Check if a user has a pending (active, undelivered) analysis request for a market.
 * A request is "pending" if:
 * - It exists in analysis_requests with status='active'
 * - It has NOT been delivered to this user yet (no matching row in analysis_deliveries)
 *
 * Failed requests are excluded because the orchestrator marks them status='failed'
 * on error. The DynamoDB in-flight marker (5-min TTL) acts as a secondary guard
 * for edge cases where the orchestrator crashes before writing the failure status.
 */
async function userHasPendingRequest(userId: string, marketId: string): Promise<boolean> {
  const connectionString = await getConnectionString();
  const pg = await import('pg');
  const client = new pg.Client({ connectionString, ssl: { rejectUnauthorized: false } });

  try {
    await client.connect();
    const result = await client.query(
      `SELECT 1
       FROM analysis_requests ar
       WHERE ar.user_id = $1
         AND ar.market_id = $2
         AND ar.status = 'active'
         AND NOT EXISTS (
           SELECT 1 FROM analysis_deliveries ad
           WHERE ad.analysis_request_id = ar.id
             AND ad.user_id = ar.user_id
         )
       LIMIT 1`,
      [userId, marketId]
    );
    return result.rows.length > 0;
  } catch (error) {
    console.error('Pending request check failed:', error);
    return false;
  } finally {
    await client.end();
  }
}

// ─── Response Helper ────────────────────────────────────────────────────────────

function response(
  statusCode: number,
  body: Record<string, unknown>,
  headers: Record<string, string>
): ApiResponse {
  return { statusCode, headers, body: JSON.stringify(body) };
}
