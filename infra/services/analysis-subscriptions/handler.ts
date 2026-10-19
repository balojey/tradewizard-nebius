/**
 * Analysis Subscriptions API - Lambda handler.
 *
 * Manages a user's recurring-analysis subscriptions:
 *   GET    /analysis/subscriptions             → list active recurring subscriptions
 *   DELETE /analysis/subscriptions/{requestId} → cancel a recurring subscription
 *
 * Cancellation flow:
 *   1. Verify ownership (analysis_request belongs to caller, status = 'active')
 *   2. Mark `analysis_requests.status = 'cancelled'` and stamp `cancelled_at`
 *   3. Mark the matching `market_subscribers` row `unsubscribed_at = now()`
 *   4. If this user was the last active subscriber on this (market, interval),
 *      delete the EventBridge schedule (`tw-{env}-{marketId.slice(0,20)}-{interval}`).
 *      Otherwise leave the schedule running for the remaining subscribers.
 *   5. Publish a `recurring-analysis.cancelled` event to EventBridge so the
 *      `portfolio-analysis-consumer` Lambda can pause any portfolio session
 *      tied to this market.
 *
 * One-time analysis requests cannot be cancelled (they aren't recurring).
 *
 * Triggered by: API Gateway routes mounted in compute-stack.
 */

import {
  EventBridgeClient,
  PutEventsCommand,
} from '@aws-sdk/client-eventbridge';
import {
  SchedulerClient,
  DeleteScheduleCommand,
} from '@aws-sdk/client-scheduler';
import { getConnectionString, getUserIdByCognitoSub } from '../shared/db';

const eventBridgeClient = new EventBridgeClient({});
const schedulerClient = new SchedulerClient({});

const EVENT_BUS_NAME = process.env.EVENT_BUS_NAME || 'default';
const ENVIRONMENT = process.env.ENVIRONMENT || 'development';

// ─── Types ──────────────────────────────────────────────────────────────────

interface ApiGatewayEvent {
  body: string | null;
  requestContext: {
    authorizer: {
      claims: {
        sub: string;
        email: string;
      };
    };
  };
  pathParameters?: Record<string, string> | null;
  httpMethod: string;
  path: string;
  resource?: string;
}

interface ApiResponse {
  statusCode: number;
  headers: Record<string, string>;
  body: string;
}

interface SubscriptionRow {
  id: string;
  market_id: string;
  market_question: string | null;
  request_type: string;
  interval_seconds: number | null;
  status: string;
  created_at: string;
  cancelled_at: string | null;
  next_scheduled_run: string | null;
}

const CORS_HEADERS = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type,Authorization',
  'Access-Control-Allow-Methods': 'GET,DELETE,OPTIONS',
};

// ─── Main Handler ────────────────────────────────────────────────────────────

export async function handler(event: ApiGatewayEvent): Promise<ApiResponse> {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers: CORS_HEADERS, body: '' };
  }

  const cognitoSub = event.requestContext.authorizer?.claims?.sub;
  if (!cognitoSub) {
    return errorResponse(401, 'Unauthorized');
  }

  let userId: string | null;
  try {
    userId = await getUserIdByCognitoSub(cognitoSub);
  } catch (err) {
    console.error('Failed to resolve user from cognito sub:', err);
    return errorResponse(500, 'Internal server error');
  }
  if (!userId) {
    return errorResponse(403, 'User not found');
  }

  try {
    if (event.httpMethod === 'GET') {
      return await handleList(userId);
    }

    if (event.httpMethod === 'DELETE') {
      const requestId =
        event.pathParameters?.requestId ||
        event.pathParameters?.id ||
        extractRequestIdFromPath(event.path);
      if (!requestId) {
        return errorResponse(400, 'requestId is required');
      }
      return await handleCancel(userId, requestId);
    }

    return errorResponse(405, `Method ${event.httpMethod} not allowed`);
  } catch (error) {
    console.error('analysis-subscriptions handler failed:', error);
    return errorResponse(500, 'Internal server error');
  }
}

// ─── GET /analysis/subscriptions ─────────────────────────────────────────────

async function handleList(userId: string): Promise<ApiResponse> {
  const connectionString = await getConnectionString();
  const pg = await import('pg');
  const client = new pg.Client({ connectionString, ssl: { rejectUnauthorized: false } });

  try {
    await client.connect();
    const result = await client.query(
      `SELECT ar.id, ar.market_id, ar.request_type, ar.interval_seconds, ar.status,
              ar.created_at, ar.cancelled_at,
              m.question AS market_question,
              mas.next_scheduled_run
       FROM analysis_requests ar
       LEFT JOIN markets m ON m.condition_id = ar.market_id
       LEFT JOIN market_analysis_schedule mas ON mas.market_id = ar.market_id AND mas.status = 'active'
       WHERE ar.user_id = $1
         AND ar.request_type = 'recurring'
         AND ar.status = 'active'
       ORDER BY mas.next_scheduled_run ASC NULLS LAST, ar.created_at DESC`,
      [userId],
    );

    const subscriptions = result.rows.map(mapSubscriptionRow);

    return {
      statusCode: 200,
      headers: CORS_HEADERS,
      body: JSON.stringify({ subscriptions }),
    };
  } finally {
    await client.end();
  }
}

// ─── DELETE /analysis/subscriptions/{requestId} ──────────────────────────────

async function handleCancel(userId: string, requestId: string): Promise<ApiResponse> {
  const connectionString = await getConnectionString();
  const pg = await import('pg');
  const client = new pg.Client({ connectionString, ssl: { rejectUnauthorized: false } });

  try {
    await client.connect();

    // Verify ownership and load the request
    const lookup = await client.query(
      `SELECT id, user_id, market_id, request_type, interval_seconds, status
       FROM analysis_requests
       WHERE id = $1::uuid
       LIMIT 1`,
      [requestId],
    );

    if (lookup.rows.length === 0) {
      return errorResponse(404, 'Subscription not found');
    }

    const row = lookup.rows[0];
    if (row.user_id !== userId) {
      // Don't leak existence - return 404 like a missing record
      return errorResponse(404, 'Subscription not found');
    }
    if (row.request_type !== 'recurring') {
      return errorResponse(400, 'Only recurring subscriptions can be cancelled');
    }
    if (row.status !== 'active') {
      return errorResponse(409, `Subscription is already ${row.status}`);
    }

    const marketId: string = row.market_id;
    const intervalSeconds: number = Number(row.interval_seconds);

    await client.query('BEGIN');
    try {
      // Mark request cancelled
      await client.query(
        `UPDATE analysis_requests
         SET status = 'cancelled', cancelled_at = now()
         WHERE id = $1::uuid AND user_id = $2`,
        [requestId, userId],
      );

      // Unsubscribe the user from market deliveries tied to this request
      await client.query(
        `UPDATE market_subscribers
         SET unsubscribed_at = now()
         WHERE analysis_request_id = $1::uuid AND user_id = $2 AND unsubscribed_at IS NULL`,
        [requestId, userId],
      );

      await client.query('COMMIT');
    } catch (txError) {
      await client.query('ROLLBACK');
      throw txError;
    }

    // Decide whether to delete the EventBridge schedule. The schedule is
    // shared across all subscribers on the same (market, interval); only
    // delete it when no other active recurring subscribers remain on that
    // (market, interval) combination.
    const remaining = await client.query(
      `SELECT COUNT(*)::int AS count
       FROM analysis_requests
       WHERE market_id = $1
         AND interval_seconds = $2
         AND request_type = 'recurring'
         AND status = 'active'`,
      [marketId, intervalSeconds],
    );

    const remainingCount: number = remaining.rows[0]?.count ?? 0;
    let scheduleDeleted = false;
    if (remainingCount === 0) {
      const scheduleName = buildScheduleName(marketId, intervalSeconds);
      try {
        await schedulerClient.send(new DeleteScheduleCommand({ Name: scheduleName }));
        scheduleDeleted = true;
        console.log(`Deleted schedule ${scheduleName} (last subscriber cancelled)`);
      } catch (err) {
        const e = err as { name?: string };
        if (e.name === 'ResourceNotFoundException') {
          console.warn(`Schedule ${scheduleName} not found - nothing to delete`);
        } else {
          console.error(`Failed to delete schedule ${scheduleName}:`, err);
          // Non-fatal: the cancellation itself succeeded; the schedule will
          // continue to fire and the orchestrator will no-op because there
          // are no remaining active subscribers.
        }
      }

      // Also check if there are ANY remaining active recurring subscribers on
      // this market (at any interval). If none, deactivate the market_analysis_schedule
      // row so getUpcomingSchedule() stops reporting a next run.
      const anyRemaining = await client.query(
        `SELECT COUNT(*)::int AS count
         FROM analysis_requests
         WHERE market_id = $1
           AND request_type = 'recurring'
           AND status = 'active'`,
        [marketId],
      );
      if ((anyRemaining.rows[0]?.count ?? 0) === 0) {
        await client.query(
          `UPDATE market_analysis_schedule SET status = 'inactive', updated_at = now() WHERE market_id = $1`,
          [marketId],
        );
        console.log(`Deactivated market_analysis_schedule for market ${marketId} (no remaining subscribers)`);
      }
    }

    // Publish lifecycle event so the portfolio-analysis-consumer can pause
    // any portfolio session tied to this market.
    await publishCancellationEvent({
      requestId,
      userId,
      marketId,
      intervalSeconds,
    });

    return {
      statusCode: 200,
      headers: CORS_HEADERS,
      body: JSON.stringify({
        message: 'Subscription cancelled',
        requestId,
        marketId,
        scheduleDeleted,
        remainingSubscribers: remainingCount,
      }),
    };
  } finally {
    await client.end();
  }
}

// ─── EventBridge Publishing ──────────────────────────────────────────────────

/**
 * Publish a `recurring-analysis.cancelled` event so the portfolio Lambdas can
 * pause associated sessions. Best-effort - the cancellation itself has
 * already succeeded if we reach this point.
 */
async function publishCancellationEvent(detail: {
  requestId: string;
  userId: string;
  marketId: string;
  intervalSeconds: number;
}): Promise<void> {
  try {
    await eventBridgeClient.send(
      new PutEventsCommand({
        Entries: [
          {
            Source: 'tradewizard.analysis',
            DetailType: 'recurring-analysis.cancelled',
            EventBusName: EVENT_BUS_NAME,
            Detail: JSON.stringify({
              subscriptionId: detail.requestId,
              userId: detail.userId,
              marketId: detail.marketId,
              action: 'cancelled',
              previousInterval: String(detail.intervalSeconds),
              reason: 'user_cancelled',
              timestamp: new Date().toISOString(),
            }),
          },
        ],
      }),
    );
  } catch (error) {
    console.error('Failed to publish recurring-analysis.cancelled event:', error);
    // Non-fatal: the API caller already saw success. The portfolio consumer
    // missing this event means a portfolio session may keep running until
    // the next subscription-validation tick or the user manually pauses it.
  }
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function buildScheduleName(marketId: string, intervalSeconds: number): string {
  // Mirror the naming pattern in analysis-request/handler.ts so we can target
  // the same EventBridge Scheduler resource for deletion.
  return `tw-${ENVIRONMENT}-${marketId.slice(0, 20)}-${intervalSeconds}`;
}

function extractRequestIdFromPath(path: string): string | null {
  const match = path.match(/\/analysis\/subscriptions\/([^/]+)/);
  return match ? match[1] : null;
}

function mapSubscriptionRow(row: Record<string, unknown>): SubscriptionRow {
  return {
    id: row.id as string,
    market_id: row.market_id as string,
    market_question: (row.market_question as string) || null,
    request_type: row.request_type as string,
    interval_seconds: row.interval_seconds != null ? Number(row.interval_seconds) : null,
    status: row.status as string,
    created_at: (row.created_at as Date).toISOString
      ? (row.created_at as Date).toISOString()
      : (row.created_at as string),
    cancelled_at: row.cancelled_at
      ? (row.cancelled_at as Date).toISOString
        ? (row.cancelled_at as Date).toISOString()
        : (row.cancelled_at as string)
      : null,
    next_scheduled_run: row.next_scheduled_run
      ? (row.next_scheduled_run as Date).toISOString
        ? (row.next_scheduled_run as Date).toISOString()
        : (row.next_scheduled_run as string)
      : null,
  };
}

function errorResponse(statusCode: number, message: string): ApiResponse {
  return {
    statusCode,
    headers: CORS_HEADERS,
    body: JSON.stringify({ error: message }),
  };
}
