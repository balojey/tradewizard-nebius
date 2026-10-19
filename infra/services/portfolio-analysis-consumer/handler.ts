/**
 * Portfolio Analysis Consumer - Lambda handler.
 *
 * Triggered by EventBridge events for recurring analysis subscription lifecycle changes.
 * Specifically handles subscription cancellation/pause detection:
 * - When a recurring analysis subscription is cancelled for a market with an active
 *   portfolio manager session, this handler pauses the session and notifies the user.
 *
 * This handler does NOT trigger any analysis - it exclusively reacts to subscription
 * lifecycle events to maintain the invariant that portfolio manager sessions require
 * an active recurring analysis subscription.
 *
 * Note: The trade executor (portfolio-trade-executor) handles consuming analysis-complete
 * events and recording decisions in portfolio_manager_decisions. This handler focuses
 * solely on subscription validation - detecting when recurring analysis is cancelled
 * and pausing the associated portfolio session.
 *
 * Requirements: 10.1, 10.2, 10.3, 10.4, 10.5, 10.6
 */

import {
  EventBridgeClient,
  PutEventsCommand,
} from '@aws-sdk/client-eventbridge';
import { getConnectionString } from '../shared/db';
import { SESSION_QUERIES } from '../shared/portfolio-db';

// ─── Configuration ───────────────────────────────────────────────────────────

const EVENT_BUS_NAME = process.env.EVENT_BUS_NAME || 'default';

const eventBridgeClient = new EventBridgeClient({});

// ─── Interfaces ──────────────────────────────────────────────────────────────

/**
 * EventBridge event for recurring analysis subscription changes.
 * Published by the analysis-request service when a subscription is cancelled or paused.
 */
interface RecurringAnalysisSubscriptionEvent {
  source: string;
  'detail-type': string;
  detail: {
    subscriptionId: string;
    userId: string;
    marketId: string;
    action: 'cancelled' | 'paused' | 'resumed' | 'created';
    previousInterval?: string;
    reason?: string;
  };
}

interface AffectedSession {
  id: string;
  userId: string;
  marketId: string;
  status: string;
}

// ─── Main Handler ────────────────────────────────────────────────────────────

/**
 * Handles recurring analysis subscription lifecycle events.
 *
 * When a recurring analysis subscription is cancelled or paused for a market
 * that has an active portfolio manager session:
 * 1. Pauses the portfolio session (no new trades will be placed)
 * 2. Publishes a notification event informing the user that the session
 *    requires an active recurring analysis to operate
 *
 * When a recurring analysis subscription is created on a market that has a
 * paused portfolio session (paused due to missing analysis):
 * 1. Resumes the portfolio session (status → 'active')
 * 2. Publishes a notification event informing the user that the session
 *    has been automatically resumed
 *
 * This handler does NOT:
 * - Trigger any analysis runs
 * - Consume analysis-complete events (that's the trade executor's job)
 * - Record decisions (that's the trade executor's job)
 */
export async function handler(event: RecurringAnalysisSubscriptionEvent): Promise<void> {
  const { subscriptionId, userId, marketId, action, reason } = event.detail;

  console.log(
    `Portfolio analysis consumer invoked: action=${action}, ` +
    `subscriptionId=${subscriptionId}, userId=${userId}, marketId=${marketId}`,
  );

  if (action === 'cancelled' || action === 'paused') {
    await handlePausePortfolioSessions(userId, marketId, subscriptionId, action, reason);
  } else if (action === 'created' || action === 'resumed') {
    await handleResumePortfolioSessions(userId, marketId, subscriptionId, action);
  } else {
    console.log(`Action '${action}' does not require portfolio session intervention, skipping.`);
  }
}

// ─── Pause Sessions (Analysis Cancelled/Paused) ─────────────────────────────

async function handlePausePortfolioSessions(
  userId: string,
  marketId: string,
  subscriptionId: string,
  action: string,
  reason?: string,
): Promise<void> {
  const connectionString = await getConnectionString();
  const pg = await import('pg');
  const client = new pg.Client({ connectionString, ssl: { rejectUnauthorized: false } });

  try {
    await client.connect();

    // Find active portfolio sessions for this user + market combination.
    // Only 'active' sessions need to be paused - already paused/exiting sessions
    // don't need further intervention.
    const sessionsResult = await client.query(
      `SELECT id, user_id, market_id, status
       FROM portfolio_manager_sessions
       WHERE user_id = $1
         AND market_id = $2
         AND status = 'active'`,
      [userId, marketId],
    );

    if (sessionsResult.rows.length === 0) {
      console.log(
        `No active portfolio sessions found for user=${userId}, market=${marketId}. No action needed.`,
      );
      return;
    }

    // Pause each affected session and collect for notification
    const affectedSessions: AffectedSession[] = [];

    for (const row of sessionsResult.rows) {
      const sessionId = row.id as string;

      console.log(
        `Pausing portfolio session ${sessionId} due to recurring analysis ${action}.`,
      );

      // Update session status to 'paused' - this prevents the trade executor
      // from placing new trades even if stale analysis events arrive
      await client.query(SESSION_QUERIES.updateSessionStatus, ['paused', sessionId]);

      affectedSessions.push({
        id: sessionId,
        userId: row.user_id as string,
        marketId: row.market_id as string,
        status: 'paused',
      });
    }

    // Publish notification event for the user
    await publishSubscriptionPausedNotification(
      userId,
      marketId,
      subscriptionId,
      action,
      affectedSessions,
      reason,
    );

    console.log(
      `Paused ${affectedSessions.length} portfolio session(s) for user=${userId}, ` +
      `market=${marketId} due to recurring analysis ${action}.`,
    );
  } catch (error) {
    console.error('Portfolio analysis consumer (pause) failed:', error);
    throw error;
  } finally {
    await client.end();
  }
}

// ─── Resume Sessions (Analysis Re-enabled) ──────────────────────────────────

/**
 * Auto-resume portfolio sessions that were paused due to missing recurring analysis.
 * Only resumes sessions with status='paused' for this user+market combination.
 *
 * Requirements: 10.7, 10.8
 */
async function handleResumePortfolioSessions(
  userId: string,
  marketId: string,
  subscriptionId: string,
  action: string,
): Promise<void> {
  const connectionString = await getConnectionString();
  const pg = await import('pg');
  const client = new pg.Client({ connectionString, ssl: { rejectUnauthorized: false } });

  try {
    await client.connect();

    // Find paused portfolio sessions for this user + market combination.
    // Only resume sessions whose linked recurring_analysis_id points to a
    // cancelled/inactive analysis request - this ensures we don't resume
    // sessions that the user manually paused.
    const sessionsResult = await client.query(
      `SELECT pms.id, pms.user_id, pms.market_id, pms.status
       FROM portfolio_manager_sessions pms
       LEFT JOIN analysis_requests ar ON ar.id = pms.recurring_analysis_id
       WHERE pms.user_id = $1
         AND pms.market_id = $2
         AND pms.status = 'paused'
         AND (ar.status IS NULL OR ar.status = 'cancelled')`,
      [userId, marketId],
    );

    if (sessionsResult.rows.length === 0) {
      console.log(
        `No paused portfolio sessions found for user=${userId}, market=${marketId}. No action needed.`,
      );
      return;
    }

    // Resume each paused session
    const resumedSessions: AffectedSession[] = [];

    for (const row of sessionsResult.rows) {
      const sessionId = row.id as string;

      console.log(
        `Resuming portfolio session ${sessionId} due to recurring analysis ${action}.`,
      );

      await client.query(SESSION_QUERIES.updateSessionStatus, ['active', sessionId]);

      // Update the session's recurring_analysis_id to the new subscription
      // so future cancellations are correctly tracked
      await client.query(
        `UPDATE portfolio_manager_sessions SET recurring_analysis_id = $1::uuid WHERE id = $2`,
        [subscriptionId, sessionId],
      );

      resumedSessions.push({
        id: sessionId,
        userId: row.user_id as string,
        marketId: row.market_id as string,
        status: 'active',
      });
    }

    // Publish notification event for the user
    await publishSessionResumedNotification(userId, marketId, subscriptionId, resumedSessions);

    console.log(
      `Resumed ${resumedSessions.length} portfolio session(s) for user=${userId}, ` +
      `market=${marketId} due to recurring analysis ${action}.`,
    );
  } catch (error) {
    console.error('Portfolio analysis consumer (resume) failed:', error);
    throw error;
  } finally {
    await client.end();
  }
}

// ─── Notification Publishing ─────────────────────────────────────────────────

/**
 * Publish a notification event to EventBridge informing the user that their
 * portfolio session has been paused because the recurring analysis subscription
 * was cancelled or paused.
 *
 * The notification fan-out system (SNS → delivery Lambdas) handles actual delivery
 * to the user's enabled channels (WebSocket, email, push).
 */
async function publishSubscriptionPausedNotification(
  userId: string,
  marketId: string,
  subscriptionId: string,
  action: string,
  affectedSessions: AffectedSession[],
  reason?: string,
): Promise<void> {
  try {
    await eventBridgeClient.send(
      new PutEventsCommand({
        Entries: [
          {
            Source: 'tradewizard.portfolio-manager',
            DetailType: 'portfolio.session.paused-no-analysis',
            EventBusName: EVENT_BUS_NAME,
            Detail: JSON.stringify({
              userId,
              marketId,
              subscriptionId,
              subscriptionAction: action,
              reason: reason || `Recurring analysis subscription ${action}`,
              affectedSessionIds: affectedSessions.map((s) => s.id),
              message:
                'Your portfolio manager session has been paused because the recurring ' +
                'analysis subscription on this market is no longer active. The portfolio ' +
                'manager requires active recurring analysis to operate. Please resume your ' +
                'recurring analysis subscription to continue autonomous trading.',
              timestamp: new Date().toISOString(),
            }),
          },
        ],
      }),
    );

    console.log(
      `Published paused-no-analysis notification for user=${userId}, ` +
      `sessions=${affectedSessions.map((s) => s.id).join(', ')}`,
    );
  } catch (error) {
    console.error('Failed to publish subscription paused notification:', error);
    // Non-fatal: session was already paused successfully, notification is best-effort
  }
}

/**
 * Publish a notification event to EventBridge informing the user that their
 * portfolio session has been automatically resumed because a recurring analysis
 * subscription was re-enabled on the market.
 *
 * Best-effort - the session has already been resumed at this point.
 */
async function publishSessionResumedNotification(
  userId: string,
  marketId: string,
  subscriptionId: string,
  resumedSessions: AffectedSession[],
): Promise<void> {
  try {
    await eventBridgeClient.send(
      new PutEventsCommand({
        Entries: [
          {
            Source: 'tradewizard.portfolio-manager',
            DetailType: 'portfolio.session.resumed-analysis-restored',
            EventBusName: EVENT_BUS_NAME,
            Detail: JSON.stringify({
              userId,
              marketId,
              subscriptionId,
              resumedSessionIds: resumedSessions.map((s) => s.id),
              message:
                'Your portfolio manager session has been automatically resumed because ' +
                'a recurring analysis subscription is now active on this market. ' +
                'Autonomous trading will continue on the next analysis delivery.',
              timestamp: new Date().toISOString(),
            }),
          },
        ],
      }),
    );

    console.log(
      `Published session-resumed notification for user=${userId}, ` +
      `sessions=${resumedSessions.map((s) => s.id).join(', ')}`,
    );
  } catch (error) {
    console.error('Failed to publish session resumed notification:', error);
    // Non-fatal: session was already resumed successfully, notification is best-effort
  }
}
