/**
 * Analysis Sweeper - catches orphaned analysis requests.
 *
 * Runs every 5 minutes via EventBridge Schedule. Finds `active` analysis
 * requests that have been running longer than the maximum expected duration
 * (15 minutes) and treats them as timed out:
 *
 * 1. Marks the request as 'failed'
 * 2. Refunds credits to all charged users
 * 3. Clears the in-flight marker
 * 4. Publishes AnalysisFailed event for user notification
 *
 * This ensures users are NEVER stuck with:
 * - A perpetual "In Progress" state on the frontend
 * - A deducted credit that was never refunded
 * - An in-flight marker blocking new analyses for that market
 *
 * Even if the Lambda times out, crashes, or the process is killed by AWS,
 * this sweeper will catch it within 5 minutes and restore system integrity.
 *
 * Environment variables:
 * - DB_SECRET_ARN: Secrets Manager ARN for RDS credentials
 * - DB_HOST: RDS endpoint hostname
 * - EVENT_BUS_NAME: EventBridge bus name for failure notifications
 * - ENVIRONMENT: deployment environment (development/production)
 * - STALE_THRESHOLD_MINUTES: how old a request must be to be considered stale (default: 15)
 */

import {
  EventBridgeClient,
  PutEventsCommand,
} from '@aws-sdk/client-eventbridge';
import { clearInFlight } from '../shared/dynamo';
import { getConnectionString } from '../shared/db';

const eventBridgeClient = new EventBridgeClient({});
const EVENT_BUS_NAME = process.env.EVENT_BUS_NAME || '';
const ENVIRONMENT = process.env.ENVIRONMENT || 'development';
const STALE_THRESHOLD_MINUTES = parseInt(process.env.STALE_THRESHOLD_MINUTES || '17', 17);

interface StaleRequest {
  id: string;
  market_id: string;
  user_id: string;
  created_at: string;
}

/**
 * Scheduled handler - runs every 5 minutes to clean up stale requests.
 */
export async function handler(): Promise<void> {
  const connectionString = await getConnectionString();
  const pg = await import('pg');
  const client = new pg.Client({ connectionString, ssl: { rejectUnauthorized: false } });

  try {
    await client.connect();

    // Find active ONE-TIME requests older than the stale threshold.
    // Recurring requests are long-lived (status='active' indefinitely) and must
    // NOT be swept - only the orchestrator manages their lifecycle.
    const result = await client.query<StaleRequest>(
      `SELECT ar.id, ar.market_id, ar.user_id
       FROM analysis_requests ar
       WHERE ar.status = 'active'
         AND ar.request_type = 'one_time'
         AND ar.created_at < now() - interval '${STALE_THRESHOLD_MINUTES} minutes'
       ORDER BY ar.created_at ASC
       LIMIT 50`,
    );

    if (result.rows.length === 0) {
      return; // Nothing to clean up
    }

    console.log(`Sweeper: Found ${result.rows.length} stale request(s) to clean up`);

    for (const request of result.rows) {
      try {
        await cleanupStaleRequest(client, request);
      } catch (error) {
        console.error(`Sweeper: Failed to clean up request ${request.id}:`, error);
        // Continue with other requests
      }
    }

    console.log(`Sweeper: Cleanup complete (${result.rows.length} requests processed)`);
  } finally {
    await client.end();
  }
}

/**
 * Clean up a single stale request: mark failed, refund, clear in-flight, notify.
 */
async function cleanupStaleRequest(
  client: import('pg').Client,
  request: StaleRequest,
): Promise<void> {
  const { id: requestId, market_id: marketId, user_id: userId } = request;

  // 1. Mark as failed (atomic - only if still active)
  const updateResult = await client.query(
    `UPDATE analysis_requests SET status = 'failed', updated_at = now()
     WHERE id = $1::uuid AND status = 'active'
     RETURNING id`,
    [requestId]
  );

  if (updateResult.rowCount === 0) {
    // Another process already handled it (race condition safe)
    return;
  }

  console.log(`Sweeper: Marked request ${requestId} as failed (stale > ${STALE_THRESHOLD_MINUTES}min)`);

  // 2. Refund all users who were charged for this request
  const chargedUsers = await client.query(
    `SELECT DISTINCT ct.user_id
     FROM credit_transactions ct
     WHERE ct.reference_id = $1::uuid
       AND ct.amount = -1
       AND ct.reason = 'analysis_request'
       AND NOT EXISTS (
         SELECT 1 FROM credit_transactions r
         WHERE r.user_id = ct.user_id
           AND r.reference_id = $1::uuid
           AND r.reason = 'analysis_failure_refund'
       )`,
    [requestId]
  );

  let refundCount = 0;
  for (const row of chargedUsers.rows) {
    try {
      await client.query(
        `UPDATE subscriptions SET credits_remaining = credits_remaining + 1
         WHERE user_id = $1 AND status IN ('active', 'grace_period')`,
        [row.user_id]
      );
      await client.query(
        `INSERT INTO credit_transactions (user_id, amount, balance_after, reason, reference_id, reference_type)
         SELECT $1, 1,
                (SELECT credits_remaining FROM subscriptions WHERE user_id = $1 AND status IN ('active', 'grace_period')),
                'analysis_failure_refund', $2::uuid, 'analysis_request'
         ON CONFLICT DO NOTHING`,
        [row.user_id, requestId]
      );
      refundCount++;
    } catch (refundErr) {
      console.warn(`Sweeper: Failed to refund user ${row.user_id}:`, refundErr);
    }
  }

  if (refundCount > 0) {
    console.log(`Sweeper: Refunded ${refundCount} user(s) for request ${requestId}`);
  }

  // 3. Clear in-flight marker so new analyses can be dispatched for this market
  try {
    await clearInFlight(marketId);
  } catch (error) {
    console.warn(`Sweeper: Failed to clear in-flight for market ${marketId}:`, error);
  }

  // 4. Publish failure event so the user gets notified via WebSocket
  if (EVENT_BUS_NAME && userId) {
    try {
      await eventBridgeClient.send(
        new PutEventsCommand({
          Entries: [
            {
              Source: 'tradewizard.analysis',
              DetailType: 'AnalysisFailed',
              EventBusName: EVENT_BUS_NAME,
              Detail: JSON.stringify({
                requestId,
                marketId,
                userId,
                error: 'Analysis timed out and was automatically cancelled',
                environment: ENVIRONMENT,
              }),
            },
          ],
        })
      );
    } catch (error) {
      console.warn(`Sweeper: Failed to publish failure event for ${requestId}:`, error);
    }
  }
}
