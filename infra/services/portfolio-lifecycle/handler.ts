/**
 * Portfolio Lifecycle Manager - Lambda handler.
 *
 * Manages session lifecycle events for the Autonomous Portfolio Manager.
 * Four trigger modes:
 * 1. EventBridge Scheduler (every 5 min) - check market resolution for all active sessions
 * 2. REST API DELETE /portfolio/sessions/{id} - manual stop
 * 3. EventBridge event - subscription downgrade notification
 * 4. EventBridge Scheduler (daily at 00:00 UTC) - daily summary
 *
 * Lifecycle responsibilities:
 * - Detect market resolution within 5 minutes, close session, record final P&L
 * - Handle subscription downgrade: terminate sessions within 24h grace period
 * - Handle capital depletion: mark session terminated when available < $5
 * - Handle manual stop: exit all positions at market, cancel pending orders within 60s
 * - Send daily summary notification at 00:00 UTC for each active session
 * - Allow multiple entry/exit cycles within a single session
 *
 * Requirements: 7.1, 7.2, 7.3, 7.4, 7.5, 7.6, 7.7
 */

import {
  EventBridgeClient,
  PutEventsCommand,
} from '@aws-sdk/client-eventbridge';
import {
  SchedulerClient,
  DeleteScheduleCommand,
} from '@aws-sdk/client-scheduler';
import { getConnectionString } from '../shared/db';
import { getClobCredentials, buildClobHeaders, clobCredentialsConfigured } from '../shared/clob-credentials';
import { SESSION_QUERIES, UTILITY_QUERIES, STATS_QUERIES } from '../shared/portfolio-db';
import { MIN_INVESTMENT_AMOUNT } from '../shared/portfolio-types';

// ─── Configuration ───────────────────────────────────────────────────────────

const EVENT_BUS_NAME = process.env.EVENT_BUS_NAME || 'default';
const ENVIRONMENT = process.env.ENVIRONMENT || 'development';

const eventBridgeClient = new EventBridgeClient({});
const schedulerClient = new SchedulerClient({});

// ─── CORS Headers ────────────────────────────────────────────────────────────

const CORS_HEADERS = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type,Authorization',
  'Access-Control-Allow-Methods': 'DELETE,OPTIONS',
};

// ─── Interfaces ──────────────────────────────────────────────────────────────

interface ApiGatewayEvent {
  body: string | null;
  requestContext: {
    authorizer?: {
      claims: {
        sub: string;
        email: string;
      };
    };
  };
  httpMethod: string;
  path: string;
  pathParameters?: Record<string, string> | null;
}

interface EventBridgeEvent {
  source: string;
  'detail-type': string;
  detail: Record<string, unknown>;
}

interface ScheduledEvent {
  source: string;
  'detail-type': string;
  detail: {
    type?: string;
  };
}

interface ApiResponse {
  statusCode: number;
  headers: Record<string, string>;
  body: string;
}

/** Market resolution data from Polymarket */
interface MarketResolution {
  resolved: boolean;
  outcome?: string;
  resolutionTimestamp?: string;
}

/** Session report generated on termination */
interface SessionReport {
  sessionId: string;
  marketId: string;
  totalPnl: number;
  totalTrades: number;
  winningTrades: number;
  winRate: number;
  avgHoldDurationMinutes: number;
  terminationReason: string;
  remainingBalance: number;
  redemptionAmount?: number;
  marketOutcome?: string;
}

// ─── Main Handler ────────────────────────────────────────────────────────────

export async function handler(
  event: ApiGatewayEvent | EventBridgeEvent | ScheduledEvent
): Promise<ApiResponse | void> {
  // Determine trigger mode
  if (isApiGatewayEvent(event)) {
    return handleApiRequest(event);
  }

  if (isScheduledEvent(event)) {
    const detailType = event['detail-type'];

    if (detailType === 'portfolio.lifecycle.resolution-check') {
      await handleMarketResolutionCheck();
      return;
    }

    if (detailType === 'portfolio.lifecycle.daily-summary') {
      await handleDailySummary();
      return;
    }

    if (detailType === 'portfolio.lifecycle.capital-check') {
      await handleCapitalDepletionCheck();
      return;
    }

    if (detailType === 'portfolio.lifecycle.profit-target-check') {
      await handleProfitTargetCheck();
      return;
    }

    // Default scheduled event: run resolution + capital check + profit target check
    await handleMarketResolutionCheck();
    await handleCapitalDepletionCheck();
    await handleProfitTargetCheck();
    return;
  }

  // EventBridge event - subscription downgrade
  if (isEventBridgeEvent(event)) {
    if (
      event['detail-type'] === 'subscription.downgraded' ||
      event['detail-type'] === 'subscription.cancelled'
    ) {
      await handleSubscriptionDowngrade(event);
      return;
    }
  }

  console.warn('Unrecognized event type:', JSON.stringify(event));
}

// ─── Type Guards ─────────────────────────────────────────────────────────────

function isApiGatewayEvent(event: unknown): event is ApiGatewayEvent {
  return (
    typeof event === 'object' &&
    event !== null &&
    'httpMethod' in event &&
    'requestContext' in event
  );
}

function isScheduledEvent(event: unknown): event is ScheduledEvent {
  return (
    typeof event === 'object' &&
    event !== null &&
    'source' in event &&
    (event as Record<string, unknown>).source === 'aws.scheduler'
  );
}

function isEventBridgeEvent(event: unknown): event is EventBridgeEvent {
  return (
    typeof event === 'object' &&
    event !== null &&
    'source' in event &&
    'detail-type' in event &&
    'detail' in event
  );
}

// ─── API Gateway Handler (Manual Stop) ───────────────────────────────────────

async function handleApiRequest(event: ApiGatewayEvent): Promise<ApiResponse> {
  try {
    // Handle OPTIONS preflight
    if (event.httpMethod === 'OPTIONS') {
      return { statusCode: 200, headers: CORS_HEADERS, body: '' };
    }

    const cognitoSub = event.requestContext.authorizer?.claims?.sub;
    if (!cognitoSub) {
      return errorResponse(401, 'Unauthorized');
    }

    // Only handle DELETE /portfolio/sessions/{id}
    if (event.httpMethod !== 'DELETE') {
      return errorResponse(405, 'Method not allowed');
    }

    // Extract session ID from path
    const sessionId = event.pathParameters?.id || extractSessionIdFromPath(event.path);
    if (!sessionId) {
      return errorResponse(400, 'Session ID is required');
    }

    const connectionString = await getConnectionString();
    const pg = await import('pg');
    const client = new pg.Client({
      connectionString,
      ssl: { rejectUnauthorized: false },
    });

    try {
      await client.connect();

      // Resolve userId from cognito sub
      const userResult = await client.query(
        `SELECT id FROM users WHERE cognito_sub = $1 LIMIT 1`,
        [cognitoSub]
      );

      if (userResult.rows.length === 0) {
        return errorResponse(403, 'User not found');
      }

      const userId: string = userResult.rows[0].id;

      // Load session and verify ownership
      const sessionResult = await client.query(SESSION_QUERIES.getSessionById, [sessionId]);
      if (sessionResult.rows.length === 0) {
        return errorResponse(404, 'Session not found');
      }

      const session = sessionResult.rows[0];
      if (session.user_id !== userId) {
        return errorResponse(403, 'Not authorized to stop this session');
      }

      if (session.status === 'completed' || session.status === 'terminated') {
        return errorResponse(409, 'Session is already terminated');
      }

      // Execute manual stop
      const report = await executeManualStop(sessionId, session, client);

      return {
        statusCode: 200,
        headers: CORS_HEADERS,
        body: JSON.stringify({
          message: 'Session stopped successfully',
          report,
        }),
      };
    } finally {
      await client.end();
    }
  } catch (error) {
    console.error('Lifecycle API request failed:', error);
    return errorResponse(500, 'Internal server error');
  }
}

/**
 * Extract session ID from path like /portfolio/sessions/{id}
 */
function extractSessionIdFromPath(path: string): string | null {
  const match = path.match(/\/portfolio\/sessions\/([^/]+)/);
  return match ? match[1] : null;
}

// ─── Manual Stop (Requirement 7.6) ───────────────────────────────────────────

/**
 * Execute a manual stop: exit all positions at market, cancel pending orders
 * within 60 seconds, and generate a session report.
 */
async function executeManualStop(
  sessionId: string,
  session: Record<string, unknown>,
  pgClient: import('pg').Client
): Promise<SessionReport> {
  const now = new Date().toISOString();

  console.log(`Manual stop initiated for session ${sessionId}`);

  // Step 1: Update session status to 'exiting'
  await pgClient.query(SESSION_QUERIES.updateSessionStatus, ['exiting', sessionId]);

  // Step 2: Cancel all pending orders within 60s
  const pendingResult = await pgClient.query(
    UTILITY_QUERIES.getPendingTradesBySession,
    [sessionId]
  );

  for (const trade of pendingResult.rows) {
    if (trade.clob_order_id) {
      await cancelClobOrder(trade.clob_order_id);
    }
    await pgClient.query(
      `UPDATE portfolio_manager_trades SET status = 'cancelled', cancelled_at = $1 WHERE id = $2`,
      [now, trade.id]
    );
  }

  // Step 3: Exit open position at market price
  let exitPnl = 0;
  if (session.position_direction && Number(session.amount_in_positions) > 0) {
    exitPnl = await exitPositionAtMarket(
      sessionId,
      session.market_id as string,
      session.position_direction as string,
      Number(session.position_size),
      Number(session.position_entry_price),
      pgClient
    );
  }

  // Step 4: Delete position guard schedule
  if (session.position_guard_schedule_arn) {
    await deleteScheduleSafe(session.position_guard_schedule_arn as string);
  }

  // Step 5: Terminate session
  await pgClient.query(SESSION_QUERIES.terminateSession, [
    'user_stopped',
    now,
    sessionId,
  ]);

  // Step 6: Generate session report
  const report = generateSessionReport(session, 'user_stopped', exitPnl);

  // Step 7: Publish lifecycle event
  await publishLifecycleEvent('portfolio.session.terminated', {
    sessionId,
    userId: session.user_id,
    terminationReason: 'user_stopped',
    report,
  });

  console.log(`Manual stop completed for session ${sessionId}. P&L: ${report.totalPnl}`);

  return report;
}

// ─── Market Resolution Check (Requirement 7.2) ──────────────────────────────

/**
 * Check all active sessions for market resolution.
 * Runs every 5 minutes via EventBridge Scheduler.
 * Detects resolution, closes session, records final P&L with redemption proceeds.
 */
async function handleMarketResolutionCheck(): Promise<void> {
  console.log('Running market resolution check for all active sessions');

  const connectionString = await getConnectionString();
  const pg = await import('pg');
  const client = new pg.Client({
    connectionString,
    ssl: { rejectUnauthorized: false },
  });

  try {
    await client.connect();

    // Get all active/paused sessions grouped by market
    const sessionsResult = await client.query(`
      SELECT id, user_id, market_id, position_direction, position_size,
             position_entry_price, amount_in_positions, amount_available,
             investment_amount, total_trades, winning_trades, realized_pnl,
             unrealized_pnl, total_hold_duration_minutes,
             position_guard_schedule_arn
      FROM portfolio_manager_sessions
      WHERE status IN ('active', 'paused', 'exiting')
    `);

    if (sessionsResult.rows.length === 0) {
      console.log('No active sessions to check for resolution');
      return;
    }

    // Get unique market IDs
    const marketIds = [...new Set(sessionsResult.rows.map((r) => r.market_id as string))];

    // Check resolution status for each market
    for (const marketId of marketIds) {
      const resolution = await checkMarketResolution(marketId);

      if (resolution.resolved) {
        console.log(`Market ${marketId} has resolved. Outcome: ${resolution.outcome}`);

        // Get all sessions for this market
        const marketSessions = sessionsResult.rows.filter(
          (r) => r.market_id === marketId
        );

        for (const session of marketSessions) {
          await handleResolvedMarketSession(
            session,
            resolution,
            client
          );
        }
      }
    }
  } catch (error) {
    console.error('Market resolution check failed:', error);
    throw error;
  } finally {
    await client.end();
  }
}

/**
 * Handle a session whose market has resolved.
 * Close the session, calculate redemption proceeds, record final P&L.
 */
async function handleResolvedMarketSession(
  session: Record<string, unknown>,
  resolution: MarketResolution,
  pgClient: import('pg').Client
): Promise<void> {
  const now = new Date().toISOString();
  const sessionId = session.id as string;

  console.log(`Closing session ${sessionId} due to market resolution`);

  // Calculate redemption proceeds if holding a position
  let redemptionAmount = 0;
  if (session.position_direction && Number(session.position_size) > 0) {
    // If position direction matches outcome, shares redeem at $1
    // If not, shares redeem at $0
    const positionDirection = session.position_direction as string;
    const outcome = resolution.outcome || '';

    if (positionDirection === outcome) {
      // Winning position: shares redeem at $1 each
      redemptionAmount = Number(session.position_size);
    }
    // Losing position: shares redeem at $0

    // Record the redemption as a trade
    const entryPrice = Number(session.position_entry_price);
    const exitPrice = positionDirection === outcome ? 1.0 : 0.0;
    const realizedPnl = (exitPrice - entryPrice) * Number(session.position_size);

    await pgClient.query(
      `INSERT INTO portfolio_manager_trades (
        session_id, direction, side, order_type, size_usdc, price,
        fill_price, status, trade_purpose, reasoning, realized_pnl,
        exit_reason, created_at, filled_at
      ) VALUES ($1, $2, 'SELL', 'market', $3, $4, $4, 'filled', 'exit',
        'Market resolved - position redeemed', $5, 'market_resolved', $6, $6)`,
      [
        sessionId,
        session.position_direction,
        Number(session.amount_in_positions),
        exitPrice,
        realizedPnl,
        now,
      ]
    );

    // Update session stats
    const newRealizedPnl = Number(session.realized_pnl) + realizedPnl;
    const newTotalTrades = Number(session.total_trades) + 1;
    const newWinningTrades = Number(session.winning_trades) + (realizedPnl > 0 ? 1 : 0);

    await pgClient.query(STATS_QUERIES.updateSessionStats, [
      newTotalTrades,
      newWinningTrades,
      newRealizedPnl,
      0, // unrealized P&L is 0 after resolution
      Number(session.total_hold_duration_minutes),
      sessionId,
    ]);
  }

  // Delete position guard schedule
  if (session.position_guard_schedule_arn) {
    await deleteScheduleSafe(session.position_guard_schedule_arn as string);
  }

  // Terminate session
  await pgClient.query(SESSION_QUERIES.terminateSession, [
    'market_resolved',
    now,
    sessionId,
  ]);

  // Generate and publish resolution report
  const report: SessionReport = {
    sessionId,
    marketId: session.market_id as string,
    totalPnl: Number(session.realized_pnl) + (redemptionAmount > 0
      ? (1.0 - Number(session.position_entry_price)) * Number(session.position_size)
      : session.position_size
        ? -Number(session.position_entry_price) * Number(session.position_size)
        : 0),
    totalTrades: Number(session.total_trades) + (session.position_direction ? 1 : 0),
    winningTrades: Number(session.winning_trades) + (redemptionAmount > 0 ? 1 : 0),
    winRate: 0,
    avgHoldDurationMinutes: Number(session.total_trades) > 0
      ? Number(session.total_hold_duration_minutes) / Number(session.total_trades)
      : 0,
    terminationReason: 'market_resolved',
    remainingBalance: Number(session.amount_available) + redemptionAmount,
    redemptionAmount,
    marketOutcome: resolution.outcome,
  };
  report.winRate = report.totalTrades > 0
    ? report.winningTrades / report.totalTrades
    : 0;

  await publishLifecycleEvent('portfolio.session.terminated', {
    sessionId,
    userId: session.user_id,
    terminationReason: 'market_resolved',
    report,
    marketOutcome: resolution.outcome,
  });

  console.log(
    `Session ${sessionId} closed due to market resolution. Redemption: $${redemptionAmount.toFixed(2)}, Final P&L: $${report.totalPnl.toFixed(2)}`
  );
}

// ─── Subscription Downgrade (Requirement 7.3) ────────────────────────────────

/**
 * Handle subscription downgrade event.
 * Terminate all active sessions within a 24-hour grace period.
 * Exit positions at market price and cancel pending orders within 5 minutes.
 */
async function handleSubscriptionDowngrade(event: EventBridgeEvent): Promise<void> {
  const { userId, previousPlan, newPlan } = event.detail as {
    userId: string;
    previousPlan: string;
    newPlan: string;
  };

  console.log(
    `Subscription downgrade detected: user=${userId}, ${previousPlan} → ${newPlan}`
  );

  // Only act if downgrading from Pro/Elite to a lower tier
  const portfolioPlans = ['pro', 'elite'];
  if (!portfolioPlans.includes(previousPlan) || portfolioPlans.includes(newPlan)) {
    console.log('Downgrade does not affect portfolio manager eligibility, skipping');
    return;
  }

  const connectionString = await getConnectionString();
  const pg = await import('pg');
  const client = new pg.Client({
    connectionString,
    ssl: { rejectUnauthorized: false },
  });

  try {
    await client.connect();
    const now = new Date().toISOString();

    // Get all active sessions for this user
    const sessionsResult = await client.query(
      UTILITY_QUERIES.getAllActiveSessionsForUser,
      [userId]
    );

    if (sessionsResult.rows.length === 0) {
      console.log(`No active sessions for user ${userId} to terminate`);
      return;
    }

    console.log(
      `Terminating ${sessionsResult.rows.length} sessions for user ${userId} due to subscription downgrade`
    );

    for (const session of sessionsResult.rows) {
      const sessionId = session.id as string;

      // Cancel all pending orders
      const pendingResult = await client.query(
        UTILITY_QUERIES.getPendingTradesBySession,
        [sessionId]
      );

      for (const trade of pendingResult.rows) {
        if (trade.clob_order_id) {
          await cancelClobOrder(trade.clob_order_id);
        }
        await client.query(
          `UPDATE portfolio_manager_trades SET status = 'cancelled', cancelled_at = $1 WHERE id = $2`,
          [now, trade.id]
        );
      }

      // Exit open position at market price
      if (session.position_direction && Number(session.amount_in_positions) > 0) {
        await exitPositionAtMarket(
          sessionId,
          session.market_id as string,
          session.position_direction as string,
          Number(session.position_size || session.amount_in_positions),
          0, // entry price not needed for exit
          client
        );
      }

      // Delete position guard schedule
      if (session.position_guard_schedule_arn) {
        await deleteScheduleSafe(session.position_guard_schedule_arn as string);
      }

      // Terminate session
      await client.query(SESSION_QUERIES.terminateSession, [
        'subscription_downgrade',
        now,
        sessionId,
      ]);
    }

    // Publish notification event
    await publishLifecycleEvent('portfolio.subscription.downgrade', {
      userId,
      previousPlan,
      newPlan,
      sessionsTerminated: sessionsResult.rows.length,
      sessionIds: sessionsResult.rows.map((r) => r.id),
    });

    console.log(
      `Subscription downgrade handled: ${sessionsResult.rows.length} sessions terminated for user ${userId}`
    );
  } catch (error) {
    console.error('Subscription downgrade handling failed:', error);
    throw error;
  } finally {
    await client.end();
  }
}

// ─── Capital Depletion Check (Requirement 7.5) ───────────────────────────────

/**
 * Check all active sessions for capital depletion.
 * Mark session as terminated when available amount falls below $5.
 */
async function handleCapitalDepletionCheck(): Promise<void> {
  console.log('Running capital depletion check for all active sessions');

  const connectionString = await getConnectionString();
  const pg = await import('pg');
  const client = new pg.Client({
    connectionString,
    ssl: { rejectUnauthorized: false },
  });

  try {
    await client.connect();

    // Find sessions with depleted capital (no open position and available < $5)
    const depletedResult = await client.query(`
      SELECT id, user_id, market_id, investment_amount, amount_available,
             total_trades, winning_trades, realized_pnl, unrealized_pnl,
             total_hold_duration_minutes, position_guard_schedule_arn,
             position_direction, amount_in_positions
      FROM portfolio_manager_sessions
      WHERE status = 'active'
        AND position_direction IS NULL
        AND amount_available < $1
    `, [MIN_INVESTMENT_AMOUNT]);

    if (depletedResult.rows.length === 0) {
      console.log('No capital-depleted sessions found');
      return;
    }

    const now = new Date().toISOString();

    for (const session of depletedResult.rows) {
      const sessionId = session.id as string;

      console.log(
        `Session ${sessionId} capital depleted: available=$${Number(session.amount_available).toFixed(2)}`
      );

      // Delete position guard schedule
      if (session.position_guard_schedule_arn) {
        await deleteScheduleSafe(session.position_guard_schedule_arn as string);
      }

      // Terminate session
      await client.query(SESSION_QUERIES.terminateSession, [
        'capital_depleted',
        now,
        sessionId,
      ]);

      // Generate final report
      const report: SessionReport = {
        sessionId,
        marketId: session.market_id as string,
        totalPnl: Number(session.realized_pnl),
        totalTrades: Number(session.total_trades),
        winningTrades: Number(session.winning_trades),
        winRate: Number(session.total_trades) > 0
          ? Number(session.winning_trades) / Number(session.total_trades)
          : 0,
        avgHoldDurationMinutes: Number(session.total_trades) > 0
          ? Number(session.total_hold_duration_minutes) / Number(session.total_trades)
          : 0,
        terminationReason: 'capital_depleted',
        remainingBalance: Number(session.amount_available),
      };

      // Publish lifecycle event
      await publishLifecycleEvent('portfolio.session.terminated', {
        sessionId,
        userId: session.user_id,
        terminationReason: 'capital_depleted',
        report,
      });

      console.log(
        `Session ${sessionId} terminated due to capital depletion. Remaining: $${Number(session.amount_available).toFixed(2)}`
      );
    }
  } catch (error) {
    console.error('Capital depletion check failed:', error);
    throw error;
  } finally {
    await client.end();
  }
}

// ─── Profit Target Check ─────────────────────────────────────────────────────

/**
 * Check all active sessions with a profit target for goal completion.
 * When realized + unrealized P&L reaches the target percentage of investment,
 * exit positions and terminate the session with 'profit_target_reached'.
 */
async function handleProfitTargetCheck(): Promise<void> {
  console.log('Running profit target check for sessions with goals');

  const connectionString = await getConnectionString();
  const pg = await import('pg');
  const client = new pg.Client({
    connectionString,
    ssl: { rejectUnauthorized: false },
  });

  try {
    await client.connect();

    // Find active sessions that have a profit target set
    const sessionsResult = await client.query(`
      SELECT id, user_id, market_id, investment_amount, profit_target_pct,
             realized_pnl, unrealized_pnl, position_direction, position_size,
             position_entry_price, amount_in_positions, amount_available,
             total_trades, winning_trades, total_hold_duration_minutes,
             position_guard_schedule_arn
      FROM portfolio_manager_sessions
      WHERE status = 'active'
        AND profit_target_pct IS NOT NULL
    `);

    if (sessionsResult.rows.length === 0) {
      console.log('No sessions with profit targets to check');
      return;
    }

    const now = new Date().toISOString();

    for (const session of sessionsResult.rows) {
      const sessionId = session.id as string;
      const investmentAmount = Number(session.investment_amount);
      const profitTargetPct = Number(session.profit_target_pct);
      const realizedPnl = Number(session.realized_pnl);
      const unrealizedPnl = Number(session.unrealized_pnl);
      const totalPnl = realizedPnl + unrealizedPnl;
      const currentReturnPct = (totalPnl / investmentAmount) * 100;

      if (currentReturnPct >= profitTargetPct) {
        console.log(
          `Session ${sessionId} hit profit target: ${currentReturnPct.toFixed(1)}% >= ${profitTargetPct}% target`
        );

        // Exit open position at market price if any
        let exitPnl = 0;
        if (session.position_direction && Number(session.amount_in_positions) > 0) {
          exitPnl = await exitPositionAtMarket(
            sessionId,
            session.market_id as string,
            session.position_direction as string,
            Number(session.position_size || session.amount_in_positions),
            Number(session.position_entry_price),
            client
          );
        }

        // Cancel pending orders
        const pendingResult = await client.query(
          UTILITY_QUERIES.getPendingTradesBySession,
          [sessionId]
        );

        for (const trade of pendingResult.rows) {
          if (trade.clob_order_id) {
            await cancelClobOrder(trade.clob_order_id);
          }
          await client.query(
            `UPDATE portfolio_manager_trades SET status = 'cancelled', cancelled_at = $1 WHERE id = $2`,
            [now, trade.id]
          );
        }

        // Delete position guard schedule
        if (session.position_guard_schedule_arn) {
          await deleteScheduleSafe(session.position_guard_schedule_arn as string);
        }

        // Terminate session
        await client.query(SESSION_QUERIES.terminateSession, [
          'profit_target_reached',
          now,
          sessionId,
        ]);

        // Generate report
        const finalPnl = realizedPnl + exitPnl;
        const report: SessionReport = {
          sessionId,
          marketId: session.market_id as string,
          totalPnl: finalPnl,
          totalTrades: Number(session.total_trades) + (session.position_direction ? 1 : 0),
          winningTrades: Number(session.winning_trades) + (exitPnl > 0 ? 1 : 0),
          winRate: 0,
          avgHoldDurationMinutes: Number(session.total_trades) > 0
            ? Number(session.total_hold_duration_minutes) / Number(session.total_trades)
            : 0,
          terminationReason: 'profit_target_reached',
          remainingBalance: Number(session.amount_available) + Number(session.amount_in_positions) + exitPnl,
        };
        report.winRate = report.totalTrades > 0
          ? report.winningTrades / report.totalTrades
          : 0;

        // Publish lifecycle event
        await publishLifecycleEvent('portfolio.session.terminated', {
          sessionId,
          userId: session.user_id,
          terminationReason: 'profit_target_reached',
          profitTargetPct,
          actualReturnPct: currentReturnPct,
          report,
        });

        console.log(
          `Session ${sessionId} terminated - profit target reached. Target: ${profitTargetPct}%, Actual: ${currentReturnPct.toFixed(1)}%, P&L: $${finalPnl.toFixed(2)}`
        );
      }
    }
  } catch (error) {
    console.error('Profit target check failed:', error);
    throw error;
  } finally {
    await client.end();
  }
}

// ─── Daily Summary (Requirement 7.4) ─────────────────────────────────────────

/**
 * Send daily summary notification at 00:00 UTC for each active session.
 * Includes: trades executed that day, current positions, unrealized P&L, total realized P&L.
 */
async function handleDailySummary(): Promise<void> {
  console.log('Generating daily summaries for all active sessions');

  const connectionString = await getConnectionString();
  const pg = await import('pg');
  const client = new pg.Client({
    connectionString,
    ssl: { rejectUnauthorized: false },
  });

  try {
    await client.connect();

    // Get all active sessions
    const sessionsResult = await client.query(`
      SELECT id, user_id, market_id, persona_id, investment_amount, status,
             position_direction, position_size, position_entry_price,
             total_trades, winning_trades, realized_pnl, unrealized_pnl,
             amount_in_positions, amount_available
      FROM portfolio_manager_sessions
      WHERE status IN ('active', 'paused')
    `);

    if (sessionsResult.rows.length === 0) {
      console.log('No active sessions for daily summary');
      return;
    }

    // Calculate the start of today (00:00 UTC)
    const todayStart = new Date();
    todayStart.setUTCHours(0, 0, 0, 0);
    const yesterdayStart = new Date(todayStart.getTime() - 24 * 60 * 60 * 1000);

    for (const session of sessionsResult.rows) {
      const sessionId = session.id as string;

      // Get trades executed in the last 24 hours
      const tradesResult = await client.query(`
        SELECT id, direction, side, order_type, size_usdc, price, fill_price,
               status, trade_purpose, realized_pnl, exit_reason, created_at
        FROM portfolio_manager_trades
        WHERE session_id = $1
          AND created_at >= $2
          AND status = 'filled'
        ORDER BY created_at DESC
      `, [sessionId, yesterdayStart.toISOString()]);

      const dailySummary = {
        sessionId,
        userId: session.user_id,
        marketId: session.market_id,
        personaId: session.persona_id,
        status: session.status,
        tradesExecutedToday: tradesResult.rows.length,
        trades: tradesResult.rows.map((t) => ({
          direction: t.direction,
          side: t.side,
          size: Number(t.size_usdc),
          price: Number(t.fill_price || t.price),
          purpose: t.trade_purpose,
          pnl: t.realized_pnl != null ? Number(t.realized_pnl) : undefined,
        })),
        currentPosition: session.position_direction
          ? {
              direction: session.position_direction,
              size: Number(session.position_size),
              entryPrice: Number(session.position_entry_price),
            }
          : null,
        unrealizedPnl: Number(session.unrealized_pnl),
        totalRealizedPnl: Number(session.realized_pnl),
        investmentAmount: Number(session.investment_amount),
        amountAvailable: Number(session.amount_available),
      };

      // Publish daily summary event for notification fan-out
      await publishLifecycleEvent('portfolio.daily_summary', dailySummary);
    }

    console.log(`Daily summaries generated for ${sessionsResult.rows.length} sessions`);
  } catch (error) {
    console.error('Daily summary generation failed:', error);
    throw error;
  } finally {
    await client.end();
  }
}

// ─── Market Resolution Check (CLOB API) ──────────────────────────────────────

/**
 * Check if a market has resolved by querying the Polymarket API.
 */
async function checkMarketResolution(marketId: string): Promise<MarketResolution> {
  try {
    const creds = await getClobCredentials();
    const response = await fetch(
      `${creds.apiUrl}/markets/${marketId}`,
      {
        headers: buildClobHeaders(creds),
        signal: AbortSignal.timeout(10_000),
      }
    );

    if (!response.ok) {
      console.warn(`Failed to check market ${marketId} resolution: ${response.status}`);
      return { resolved: false };
    }

    const data = (await response.json()) as Record<string, unknown>;

    // Polymarket market data includes resolution status
    if (data.closed || data.resolved || data.end_date_iso) {
      const isResolved = data.resolved === true || data.closed === true;

      if (isResolved) {
        // Determine outcome (YES or NO)
        let outcome: string | undefined;
        if (data.tokens && Array.isArray(data.tokens)) {
          // Find the winning token
          for (const token of data.tokens as Array<Record<string, unknown>>) {
            if (token.winner === true) {
              outcome = (token.outcome as string) || (token.token_id as string);
              break;
            }
          }
        } else if (data.outcome) {
          outcome = data.outcome as string;
        }

        return {
          resolved: true,
          outcome,
          resolutionTimestamp: (data.end_date_iso as string) || new Date().toISOString(),
        };
      }
    }

    return { resolved: false };
  } catch (error) {
    console.error(`Market resolution check failed for ${marketId}:`, error);
    return { resolved: false };
  }
}

// ─── Position Exit at Market ─────────────────────────────────────────────────

/**
 * Exit a position at market price. Places a market sell order on the CLOB.
 * Returns the realized P&L from the exit.
 */
async function exitPositionAtMarket(
  sessionId: string,
  marketId: string,
  positionDirection: string,
  positionSize: number,
  entryPrice: number,
  pgClient: import('pg').Client
): Promise<number> {
  const now = new Date().toISOString();

  try {
    const orderResult = await placeClobOrder({
      marketId,
      side: 'SELL',
      direction: positionDirection as 'YES' | 'NO',
      size: positionSize,
      orderType: 'market',
    });

    if (orderResult.success) {
      const fillPrice = orderResult.price || 0;
      const realizedPnl = (fillPrice - entryPrice) * positionSize;

      // Record exit trade
      await pgClient.query(
        `INSERT INTO portfolio_manager_trades (
          session_id, direction, side, order_type, size_usdc, price,
          fill_price, status, clob_order_id, trade_purpose, reasoning,
          realized_pnl, exit_reason, created_at, filled_at
        ) VALUES ($1, $2, 'SELL', 'market', $3, $4, $4, 'filled', $5,
          'exit', 'Manual stop - position exited at market', $6, 'user_stop', $7, $7)`,
        [
          sessionId,
          positionDirection,
          positionSize,
          fillPrice,
          orderResult.orderId || null,
          realizedPnl,
          now,
        ]
      );

      // Clear position from session
      await pgClient.query(SESSION_QUERIES.updateSessionPosition, [
        null, null, null, null, null, null, sessionId,
      ]);

      return realizedPnl;
    }

    console.warn(`Market exit order failed for session ${sessionId}, attempting limit fallback`);

    // Fallback: aggressive limit order at 5% below best bid
    const bestBid = await fetchBestBid(marketId, positionDirection);
    if (bestBid !== null) {
      const aggressivePrice = Math.max(0.01, bestBid * 0.95);

      const limitResult = await placeClobOrder({
        marketId,
        side: 'SELL',
        direction: positionDirection as 'YES' | 'NO',
        size: positionSize,
        orderType: 'limit',
        price: aggressivePrice,
      });

      if (limitResult.success) {
        await pgClient.query(
          `INSERT INTO portfolio_manager_trades (
            session_id, direction, side, order_type, size_usdc, price,
            status, clob_order_id, trade_purpose, reasoning,
            exit_reason, created_at
          ) VALUES ($1, $2, 'SELL', 'limit', $3, $4, 'pending', $5,
            'exit', 'Manual stop - aggressive limit exit', 'user_stop', $6)`,
          [
            sessionId,
            positionDirection,
            positionSize,
            aggressivePrice,
            limitResult.orderId || null,
            now,
          ]
        );
      }
    }

    return 0;
  } catch (error) {
    console.error(`Position exit failed for session ${sessionId}:`, error);
    return 0;
  }
}

// ─── Session Report Generation ───────────────────────────────────────────────

/**
 * Generate a comprehensive session report for termination.
 */
function generateSessionReport(
  session: Record<string, unknown>,
  terminationReason: string,
  additionalPnl: number = 0
): SessionReport {
  const totalTrades = Number(session.total_trades);
  const winningTrades = Number(session.winning_trades);
  const realizedPnl = Number(session.realized_pnl) + additionalPnl;
  const totalHoldDuration = Number(session.total_hold_duration_minutes);

  return {
    sessionId: session.id as string,
    marketId: session.market_id as string,
    totalPnl: realizedPnl,
    totalTrades,
    winningTrades,
    winRate: totalTrades > 0 ? winningTrades / totalTrades : 0,
    avgHoldDurationMinutes: totalTrades > 0 ? totalHoldDuration / totalTrades : 0,
    terminationReason,
    remainingBalance: Number(session.amount_available),
  };
}

// ─── CLOB API Interactions ───────────────────────────────────────────────────

interface ClobOrderRequest {
  marketId: string;
  side: 'BUY' | 'SELL';
  direction: 'YES' | 'NO';
  size: number;
  orderType: 'limit' | 'market';
  price?: number;
}

interface ClobOrderResult {
  success: boolean;
  orderId?: string;
  price?: number;
  error?: string;
}

/**
 * Place an order on the Polymarket CLOB API with retry logic.
 * Resolves token ID from market + direction before placing.
 * Retries up to 3 times with exponential backoff (1s, 2s, 4s).
 */
async function placeClobOrder(request: ClobOrderRequest): Promise<ClobOrderResult> {
  const retryDelays = [1000, 2000, 4000];
  const creds = await getClobCredentials();
  if (!clobCredentialsConfigured(creds)) {
    return { success: false, error: 'CLOB credentials not configured' };
  }

  // Resolve token ID from market + direction (match by outcome field, not array index)
  const tokenId = await resolveTokenIdForOrder(creds, request.marketId, request.direction);
  if (!tokenId) {
    return { success: false, error: `Failed to resolve token ID for ${request.direction} on market ${request.marketId}` };
  }

  for (let attempt = 0; attempt <= retryDelays.length; attempt++) {
    try {
      const endpoint = `${creds.apiUrl}/order`;
      const body = {
        tokenID: tokenId,
        side: request.side,
        size: request.size,
        type: request.orderType,
        ...(request.price !== undefined && { price: request.price }),
      };

      const response = await fetch(endpoint, {
        method: 'POST',
        headers: buildClobHeaders(creds),
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(10_000),
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`CLOB API error ${response.status}: ${errorText}`);
      }

      const data = (await response.json()) as Record<string, unknown>;

      return {
        success: true,
        orderId: (data.orderID as string) || (data.id as string),
        price: request.price || (data.price as number),
      };
    } catch (error) {
      console.warn(
        `CLOB order attempt ${attempt + 1} failed:`,
        error instanceof Error ? error.message : error
      );

      if (attempt < retryDelays.length) {
        await sleep(retryDelays[attempt]);
      }
    }
  }

  return { success: false, error: 'All retry attempts exhausted' };
}

/**
 * Resolve token ID for a market + direction from the Polymarket CLOB API.
 * Matches by outcome field (never by array index - order is not guaranteed).
 */
async function resolveTokenIdForOrder(
  creds: { apiUrl: string; apiKey: string; apiSecret: string; apiPassphrase: string },
  marketId: string,
  direction: string
): Promise<string | undefined> {
  try {
    const response = await fetch(`${creds.apiUrl}/markets/${marketId}`, {
      headers: buildClobHeaders(creds),
      signal: AbortSignal.timeout(5000),
    });

    if (!response.ok) {
      console.warn(`Failed to resolve token ID for market=${marketId}: ${response.status}`);
      return undefined;
    }

    const data = await response.json() as { tokens?: Array<{ token_id: string; outcome: string }> };
    const tokens = data.tokens || [];
    const target = tokens.find(t => t.outcome?.toLowerCase() === direction.toLowerCase());

    if (!target) {
      console.warn(`Market ${marketId} missing ${direction} token. Outcomes: ${tokens.map(t => t.outcome).join(', ')}`);
      return undefined;
    }

    return target.token_id || undefined;
  } catch (error) {
    console.warn(`Token ID resolution failed for market=${marketId}:`, error);
    return undefined;
  }
}

/**
 * Cancel an order on the Polymarket CLOB API.
 */
async function cancelClobOrder(orderId: string): Promise<boolean> {
  try {
    const creds = await getClobCredentials();
    if (!clobCredentialsConfigured(creds)) {
      console.error(`CLOB credentials not configured; cannot cancel orderId=${orderId}.`);
      return false;
    }

    const response = await fetch(`${creds.apiUrl}/order/${orderId}`, {
      method: 'DELETE',
      headers: buildClobHeaders(creds),
      signal: AbortSignal.timeout(10_000),
    });

    if (response.ok) {
      return true;
    }

    console.warn(`Failed to cancel order ${orderId}: ${response.status}`);
    return false;
  } catch (error) {
    console.error(`Cancel order ${orderId} failed:`, error);
    return false;
  }
}

/**
 * Fetch the best bid price for a market/direction from the CLOB order book.
 * Resolves the token ID first, then queries the order book.
 */
async function fetchBestBid(
  marketId: string,
  direction: string
): Promise<number | null> {
  try {
    const creds = await getClobCredentials();

    // Resolve token ID for this direction
    const tokenId = await resolveTokenIdForOrder(creds, marketId, direction);
    if (!tokenId) {
      console.warn(`Cannot fetch best bid: token ID resolution failed for market=${marketId}, direction=${direction}`);
      return null;
    }

    const response = await fetch(
      `${creds.apiUrl}/book?token_id=${tokenId}`,
      {
        headers: buildClobHeaders(creds),
        signal: AbortSignal.timeout(10_000),
      }
    );

    if (!response.ok) {
      return null;
    }

    const data = (await response.json()) as Record<string, unknown>;

    if (data.bids && Array.isArray(data.bids) && data.bids.length > 0) {
      return Number((data.bids as Array<Record<string, unknown>>)[0].price);
    }

    return null;
  } catch (error) {
    console.error(`Failed to fetch best bid for market ${marketId}:`, error);
    return null;
  }
}

// ─── EventBridge Publishing ──────────────────────────────────────────────────

/**
 * Publish a lifecycle event to EventBridge for notification fan-out.
 */
async function publishLifecycleEvent(
  detailType: string,
  detail: Record<string, unknown>
): Promise<void> {
  try {
    await eventBridgeClient.send(
      new PutEventsCommand({
        Entries: [
          {
            Source: `tradewizard.portfolio.lifecycle`,
            DetailType: detailType,
            Detail: JSON.stringify(detail),
            EventBusName: EVENT_BUS_NAME,
          },
        ],
      })
    );
  } catch (error) {
    console.error(`Failed to publish lifecycle event (${detailType}):`, error);
    // Non-fatal: notifications are best-effort for routine events
  }
}

// ─── Schedule Deletion ───────────────────────────────────────────────────────

/**
 * Safely delete an EventBridge Scheduler schedule.
 */
async function deleteScheduleSafe(scheduleArn: string): Promise<void> {
  try {
    // Extract schedule name from ARN
    // ARN format: arn:aws:scheduler:region:account:schedule/group/name
    const parts = scheduleArn.split('/');
    const scheduleName = parts[parts.length - 1];

    await schedulerClient.send(
      new DeleteScheduleCommand({
        Name: scheduleName,
      })
    );
  } catch (error) {
    // Schedule may already be deleted or not exist
    console.warn(`Failed to delete schedule ${scheduleArn}:`, error);
  }
}

// ─── Utility Functions ───────────────────────────────────────────────────────

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function errorResponse(statusCode: number, message: string): ApiResponse {
  return {
    statusCode,
    headers: CORS_HEADERS,
    body: JSON.stringify({ error: message }),
  };
}
