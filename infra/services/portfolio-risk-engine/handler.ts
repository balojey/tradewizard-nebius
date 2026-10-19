/**
 * Portfolio Risk Engine - Lambda handler.
 *
 * Enforces risk controls and guardrails for the Autonomous Portfolio Manager.
 * Two trigger modes:
 * 1. EventBridge trade events - validates risk after each trade execution
 * 2. REST API - POST /portfolio/kill-switch and DELETE /portfolio/kill-switch
 *
 * Risk controls enforced:
 * - Per-session loss limit (50% of investment, exit at 45% approach threshold)
 * - Cross-session total loss limit (40% of total invested, triggers kill switch)
 * - Position size cap (50% of available)
 * - 30-minute cooldown after loss exits
 * - At 30% session loss: warning notification + 50% position size reduction
 * - Kill switch: cancel all pending orders, exit all positions, suspend activity
 * - API unreachability (3 consecutive failures → pause all activity)
 * - Emergency exit fallback: aggressive limit order at 5% worse than best bid
 *
 * Requirements: 8.1, 8.2, 8.3, 8.4, 8.5, 8.6, 8.7, 8.8
 */

import {
  DynamoDBClient,
  GetItemCommand,
  PutItemCommand,
  DeleteItemCommand,
} from '@aws-sdk/client-dynamodb';
import {
  EventBridgeClient,
  PutEventsCommand,
} from '@aws-sdk/client-eventbridge';
import {
  SchedulerClient,
  DeleteScheduleCommand,
} from '@aws-sdk/client-scheduler';
import { marshall, unmarshall } from '@aws-sdk/util-dynamodb';
import { getConnectionString } from '../shared/db';
import { getClobCredentials, buildClobHeaders, clobCredentialsConfigured } from '../shared/clob-credentials';
import {
  LOSS_THRESHOLDS,
  LOSS_EXIT_COOLDOWN_MINUTES,
  MAX_POSITION_SIZE_PCT,
  KillSwitchRequestSchema,
} from '../shared/portfolio-types';
import { UTILITY_QUERIES, STATS_QUERIES, SESSION_QUERIES } from '../shared/portfolio-db';

// ─── Configuration ───────────────────────────────────────────────────────────

const RATE_LIMIT_TABLE = process.env.RATE_LIMIT_TABLE || '';
const EVENT_BUS_NAME = process.env.EVENT_BUS_NAME || 'default';
const ENVIRONMENT = process.env.ENVIRONMENT || 'development';

const dynamoClient = new DynamoDBClient({});
const eventBridgeClient = new EventBridgeClient({});
const schedulerClient = new SchedulerClient({});

// ─── CORS Headers ────────────────────────────────────────────────────────────

const CORS_HEADERS = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type,Authorization',
  'Access-Control-Allow-Methods': 'POST,DELETE,OPTIONS',
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
}

interface EventBridgeEvent {
  source: string;
  'detail-type': string;
  detail: {
    sessionId: string;
    userId: string;
    tradeId?: string;
    realizedPnl?: number;
    pnl?: number;
    exitReason?: string;
  };
}

interface ApiResponse {
  statusCode: number;
  headers: Record<string, string>;
  body: string;
}

/** Risk validation request from trade executor */
export interface RiskValidationRequest {
  sessionId: string;
  userId: string;
  proposedSize: number;
  availableAmount: number;
}

/** Risk validation result */
export interface RiskValidationResult {
  approved: boolean;
  reason?: string;
  adjustedSize?: number;
}

/** Kill switch state stored in DynamoDB */
interface KillSwitchState {
  active: boolean;
  triggeredAt?: string;
  reason?: string;
  ttl: number;
}

/** Consecutive API failure tracker (per-invocation, reset on success) */
let consecutiveApiFailures = 0;
const MAX_CONSECUTIVE_FAILURES = 3;

/** Emergency exit timeout in milliseconds */
const EMERGENCY_EXIT_TIMEOUT_MS = 60_000;

/** Aggressive limit order offset from best bid */
const EMERGENCY_LIMIT_OFFSET_PCT = 0.05;

// ─── Main Handler ────────────────────────────────────────────────────────────

export async function handler(
  event: ApiGatewayEvent | EventBridgeEvent
): Promise<ApiResponse | void> {
  // Determine trigger mode
  if (isApiGatewayEvent(event)) {
    return handleApiRequest(event);
  }

  // EventBridge trade event - validate risk after trade execution
  await handleTradeEvent(event);
}

// ─── Type Guard ──────────────────────────────────────────────────────────────

function isApiGatewayEvent(event: unknown): event is ApiGatewayEvent {
  return (
    typeof event === 'object' &&
    event !== null &&
    'httpMethod' in event &&
    'requestContext' in event
  );
}

// ─── API Gateway Handler (Kill Switch) ───────────────────────────────────────

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

      if (event.httpMethod === 'POST' && event.path.includes('kill-switch')) {
        return await handleKillSwitchActivation(event, userId, client);
      }

      if (event.httpMethod === 'DELETE' && event.path.includes('kill-switch')) {
        return await handleKillSwitchReset(userId);
      }

      return errorResponse(404, 'Not found');
    } finally {
      await client.end();
    }
  } catch (error) {
    console.error('Risk engine API request failed:', error);
    return errorResponse(500, 'Internal server error');
  }
}

// ─── Kill Switch Activation (POST /portfolio/kill-switch) ────────────────────

async function handleKillSwitchActivation(
  event: ApiGatewayEvent,
  userId: string,
  pgClient: import('pg').Client
): Promise<ApiResponse> {
  // Parse optional reason from body
  let reason = 'Manual kill switch activation';
  if (event.body) {
    try {
      const parsed = JSON.parse(event.body);
      const validation = KillSwitchRequestSchema.safeParse(parsed);
      if (validation.success && validation.data.reason) {
        reason = validation.data.reason;
      }
    } catch {
      // Use default reason
    }
  }

  const sessionsTerminated = await executeKillSwitch(userId, reason, pgClient);

  return {
    statusCode: 200,
    headers: CORS_HEADERS,
    body: JSON.stringify({ sessionsTerminated }),
  };
}

// ─── Kill Switch Reset (DELETE /portfolio/kill-switch) ────────────────────────

async function handleKillSwitchReset(userId: string): Promise<ApiResponse> {
  try {
    await dynamoClient.send(
      new DeleteItemCommand({
        TableName: RATE_LIMIT_TABLE,
        Key: marshall({ pk: `kill_switch#${userId}`, sk: 'state' }),
      })
    );

    return {
      statusCode: 200,
      headers: CORS_HEADERS,
      body: JSON.stringify({ message: 'Kill switch reset. Trading can resume.' }),
    };
  } catch (error) {
    console.error('Kill switch reset failed:', error);
    return errorResponse(500, 'Failed to reset kill switch');
  }
}

// ─── Kill Switch Execution ───────────────────────────────────────────────────

/**
 * Execute the kill switch: cancel all pending orders, exit all positions at market,
 * terminate all sessions, store state in DynamoDB, and publish event.
 * Requirement 8.3
 */
async function executeKillSwitch(
  userId: string,
  reason: string,
  pgClient: import('pg').Client
): Promise<number> {
  const now = new Date().toISOString();

  // Step 1: Store kill switch state in DynamoDB (atomic)
  const killSwitchState: KillSwitchState = {
    active: true,
    triggeredAt: now,
    reason,
    ttl: Math.floor(Date.now() / 1000) + 86400 * 365, // 1 year TTL
  };

  await dynamoClient.send(
    new PutItemCommand({
      TableName: RATE_LIMIT_TABLE,
      Item: marshall({
        pk: `kill_switch#${userId}`,
        sk: 'state',
        ...killSwitchState,
      }),
    })
  );

  // Step 2: Get all active sessions for user
  const sessionsResult = await pgClient.query(
    UTILITY_QUERIES.getAllActiveSessionsForUser,
    [userId]
  );

  const sessions = sessionsResult.rows;
  const sessionIds: string[] = [];

  // Step 3: For each session - cancel pending orders, exit positions, terminate
  for (const session of sessions) {
    const sessionId: string = session.id;
    sessionIds.push(sessionId);

    // Cancel all pending orders via CLOB API
    const pendingResult = await pgClient.query(
      UTILITY_QUERIES.getPendingTradesBySession,
      [sessionId]
    );

    for (const trade of pendingResult.rows) {
      if (trade.clob_order_id) {
        await cancelClobOrder(trade.clob_order_id);
      }
      // Mark trade as cancelled in DB
      await pgClient.query(
        `UPDATE portfolio_manager_trades SET status = 'cancelled', cancelled_at = $1 WHERE id = $2`,
        [now, trade.id]
      );
    }

    // Exit open position at market price
    if (session.position_direction && Number(session.amount_in_positions) > 0) {
      await executeEmergencyExit(
        sessionId,
        session.market_id,
        session.position_direction,
        Number(session.amount_in_positions),
        pgClient
      );
    }

    // Delete position guard schedule
    if (session.position_guard_schedule_arn) {
      await deleteScheduleSafe(session.position_guard_schedule_arn);
    }

    // Terminate session
    await pgClient.query(SESSION_QUERIES.terminateSession, [
      'kill_switch',
      now,
      sessionId,
    ]);
  }

  // Step 4: Publish kill switch event to EventBridge
  await publishRiskEvent('portfolio.kill_switch.triggered', {
    userId,
    reason,
    sessionsAffected: sessionIds,
    triggeredAt: now,
  });

  console.log(
    `Kill switch executed for user=${userId}: ${sessions.length} sessions terminated. Reason: ${reason}`
  );

  return sessions.length;
}

// ─── EventBridge Trade Event Handler ─────────────────────────────────────────

/**
 * Handle trade events from EventBridge. After each trade, re-evaluate risk:
 * - Check per-session loss limits (30% warning, 45% approach, 50% max)
 * - Check cross-session total loss limit (40% triggers kill switch)
 * - Update risk state in DB
 */
async function handleTradeEvent(event: EventBridgeEvent): Promise<void> {
  const { sessionId, userId, tradeId, realizedPnl, pnl, exitReason } = event.detail;

  // Accept both 'realizedPnl' (from trade executor) and 'pnl' (from position guard)
  const eventPnl: number | undefined = realizedPnl ?? pnl;

  console.log(
    `Risk engine processing trade event: session=${sessionId}, user=${userId}, trade=${tradeId}`
  );

  const connectionString = await getConnectionString();
  const pg = await import('pg');
  const client = new pg.Client({
    connectionString,
    ssl: { rejectUnauthorized: false },
  });

  try {
    await client.connect();

    // Load session data
    const sessionResult = await client.query(SESSION_QUERIES.getSessionById, [sessionId]);
    if (sessionResult.rows.length === 0) {
      console.warn(`Session ${sessionId} not found, skipping risk check.`);
      return;
    }

    const session = sessionResult.rows[0];
    const investmentAmount = Number(session.investment_amount);
    const realizedPnlTotal = Number(session.realized_pnl);
    const unrealizedPnl = Number(session.unrealized_pnl);

    // Calculate cumulative loss as percentage of investment
    const totalLoss = Math.max(0, -(realizedPnlTotal + unrealizedPnl));
    const cumulativeLossPct = totalLoss / investmentAmount;

    // Track if this was a loss exit (for cooldown)
    const isLossExit =
      exitReason && eventPnl !== undefined && eventPnl < 0;
    const lastLossExitAt = isLossExit
      ? new Date().toISOString()
      : session.last_loss_exit_at || null;

    // ─── Check 30% Warning Threshold (Requirement 8.6) ──────────────────
    let positionSizeReductionActive = session.position_size_reduction_active;

    if (
      cumulativeLossPct >= LOSS_THRESHOLDS.warningPct &&
      !positionSizeReductionActive
    ) {
      positionSizeReductionActive = true;

      // Send warning notification
      await publishRiskEvent('portfolio.risk.alert', {
        level: 'warning',
        message: `Session loss has reached ${(cumulativeLossPct * 100).toFixed(1)}% of investment. Position sizes reduced by 50% for subsequent trades.`,
        sessionsAffected: [sessionId],
        userId,
      });

      console.log(
        `Session ${sessionId}: 30% loss threshold reached. Position size reduction activated.`
      );
    }

    // ─── Check 45% Approach Threshold (Requirement 8.1) ──────────────────
    if (cumulativeLossPct >= LOSS_THRESHOLDS.approachPct) {
      console.log(
        `Session ${sessionId}: 45% approach threshold reached (${(cumulativeLossPct * 100).toFixed(1)}%). Initiating exit sequence.`
      );

      // Initiate full exit for this session
      await initiateSessionExit(sessionId, session, client);

      await publishRiskEvent('portfolio.risk.alert', {
        level: 'critical',
        message: `Session loss approaching limit at ${(cumulativeLossPct * 100).toFixed(1)}%. Full exit sequence initiated.`,
        sessionsAffected: [sessionId],
        userId,
      });
    }

    // ─── Update risk state in DB ─────────────────────────────────────────
    await client.query(UTILITY_QUERIES.updateRiskState, [
      cumulativeLossPct,
      lastLossExitAt,
      positionSizeReductionActive,
      sessionId,
    ]);

    // ─── Check Cross-Session Total Loss (Requirement 8.2) ────────────────
    await checkCrossSessionLoss(userId, client);
  } catch (error) {
    console.error('Risk engine trade event processing failed:', error);
    throw error;
  } finally {
    await client.end();
  }
}

// ─── Cross-Session Loss Check (Requirement 8.2) ─────────────────────────────

/**
 * Check if total loss across all active sessions exceeds 40% of total invested.
 * If so, trigger the kill switch.
 */
async function checkCrossSessionLoss(
  userId: string,
  pgClient: import('pg').Client
): Promise<void> {
  const statsResult = await pgClient.query(STATS_QUERIES.getAggregateStats, [userId]);
  if (statsResult.rows.length === 0) return;

  const stats = statsResult.rows[0];
  const totalInvested = Number(stats.total_invested);
  const totalRealizedPnl = Number(stats.total_realized_pnl);
  const totalUnrealizedPnl = Number(stats.total_unrealized_pnl);

  if (totalInvested <= 0) return;

  const totalLoss = Math.max(0, -(totalRealizedPnl + totalUnrealizedPnl));
  const crossSessionLossPct = totalLoss / totalInvested;

  if (crossSessionLossPct >= LOSS_THRESHOLDS.crossSessionPct) {
    console.log(
      `User ${userId}: Cross-session loss at ${(crossSessionLossPct * 100).toFixed(1)}% (threshold: ${LOSS_THRESHOLDS.crossSessionPct * 100}%). Triggering kill switch.`
    );

    await executeKillSwitch(
      userId,
      `Cross-session total loss limit reached (${(crossSessionLossPct * 100).toFixed(1)}% of total invested)`,
      pgClient
    );
  }
}

// ─── Session Exit Initiation ─────────────────────────────────────────────────

/**
 * Initiate a full exit sequence for a session that has hit the approach threshold.
 * Cancel pending orders and exit position at market.
 */
async function initiateSessionExit(
  sessionId: string,
  session: Record<string, unknown>,
  pgClient: import('pg').Client
): Promise<void> {
  const now = new Date().toISOString();

  // Cancel all pending orders
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

  // Exit open position
  if (session.position_direction && Number(session.amount_in_positions) > 0) {
    await executeEmergencyExit(
      sessionId,
      session.market_id as string,
      session.position_direction as string,
      Number(session.amount_in_positions),
      pgClient
    );
  }

  // Update session status to 'exiting'
  await pgClient.query(SESSION_QUERIES.updateSessionStatus, ['exiting', sessionId]);
}

// ─── Risk Validation (called by Trade Executor) ──────────────────────────────

/**
 * Validate a proposed trade against risk limits.
 * Called synchronously by the trade executor before placing orders.
 *
 * Checks:
 * - Kill switch not active
 * - Position size cap (50% of available)
 * - 30-minute cooldown after loss exit
 * - Session not at/above loss limit
 * - API reachability
 *
 * Requirements: 8.4, 8.7
 */
export async function validateRisk(
  request: RiskValidationRequest
): Promise<RiskValidationResult> {
  const { sessionId, userId, proposedSize, availableAmount } = request;

  // Check kill switch state
  const killSwitchActive = await isKillSwitchActive(userId);
  if (killSwitchActive) {
    return { approved: false, reason: 'Kill switch is active. All trading suspended.' };
  }

  // Check API reachability
  if (consecutiveApiFailures >= MAX_CONSECUTIVE_FAILURES) {
    return {
      approved: false,
      reason: `Trading paused: ${MAX_CONSECUTIVE_FAILURES} consecutive API failures detected.`,
    };
  }

  // Connect to DB for session-specific checks
  const connectionString = await getConnectionString();
  const pg = await import('pg');
  const client = new pg.Client({
    connectionString,
    ssl: { rejectUnauthorized: false },
  });

  try {
    await client.connect();

    const sessionResult = await client.query(SESSION_QUERIES.getSessionById, [sessionId]);
    if (sessionResult.rows.length === 0) {
      return { approved: false, reason: 'Session not found.' };
    }

    const session = sessionResult.rows[0];
    const cumulativeLossPct = Number(session.cumulative_loss_pct);
    const lastLossExitAt = session.last_loss_exit_at;
    const positionSizeReductionActive = session.position_size_reduction_active;

    // Check if session is at or above the approach threshold (45%)
    if (cumulativeLossPct >= LOSS_THRESHOLDS.approachPct) {
      return {
        approved: false,
        reason: `Session loss at ${(cumulativeLossPct * 100).toFixed(1)}% - at or above approach threshold. No new entries allowed.`,
      };
    }

    // Check 30-minute cooldown after loss exit (Requirement 8.7)
    if (lastLossExitAt) {
      const cooldownEnd = new Date(lastLossExitAt).getTime() + LOSS_EXIT_COOLDOWN_MINUTES * 60 * 1000;
      if (Date.now() < cooldownEnd) {
        const remainingMinutes = Math.ceil((cooldownEnd - Date.now()) / 60_000);
        return {
          approved: false,
          reason: `Cooldown active: ${remainingMinutes} minutes remaining after loss exit. No new entries until cooldown expires.`,
        };
      }
    }

    // Enforce position size cap (50% of available) - Requirement 8.4
    const maxAllowedSize = availableAmount * MAX_POSITION_SIZE_PCT;
    let adjustedSize = proposedSize;

    if (proposedSize > maxAllowedSize) {
      adjustedSize = maxAllowedSize;
    }

    // Apply 50% position size reduction if at 30% loss threshold (Requirement 8.6)
    if (positionSizeReductionActive) {
      adjustedSize = adjustedSize * 0.5;
    }

    // Ensure minimum trade size
    if (adjustedSize < 5) {
      return {
        approved: false,
        reason: 'Adjusted position size falls below minimum ($5 USDC.e) after risk adjustments.',
      };
    }

    return {
      approved: true,
      adjustedSize: Math.round(adjustedSize * 100) / 100,
    };
  } finally {
    await client.end();
  }
}

// ─── Kill Switch State Check ─────────────────────────────────────────────────

/**
 * Check if the kill switch is currently active for a user.
 */
async function isKillSwitchActive(userId: string): Promise<boolean> {
  try {
    const response = await dynamoClient.send(
      new GetItemCommand({
        TableName: RATE_LIMIT_TABLE,
        Key: marshall({ pk: `kill_switch#${userId}`, sk: 'state' }),
      })
    );

    if (!response.Item) return false;

    const item = unmarshall(response.Item) as KillSwitchState & { pk: string; sk: string };
    return item.active === true;
  } catch (error) {
    console.error('Failed to check kill switch state:', error);
    // Fail-safe: if we can't check, assume active to prevent trading
    return true;
  }
}

// ─── Emergency Exit ──────────────────────────────────────────────────────────

/**
 * Execute an emergency exit for a position.
 * First attempts a market order. If not filled within 60s, places an aggressive
 * limit order at 5% worse than the best bid.
 * Requirement 8.8
 */
async function executeEmergencyExit(
  sessionId: string,
  marketId: string,
  positionDirection: string,
  positionAmount: number,
  pgClient: import('pg').Client
): Promise<void> {
  const now = new Date().toISOString();

  // Attempt market order first
  try {
    const marketOrderResult = await placeClobOrder({
      marketId,
      side: 'SELL',
      direction: positionDirection as 'YES' | 'NO',
      size: positionAmount,
      orderType: 'market',
    });

    if (marketOrderResult.success) {
      consecutiveApiFailures = 0;

      // Record the emergency exit trade
      await pgClient.query(
        `INSERT INTO portfolio_manager_trades (
          session_id, direction, side, order_type, size_usdc, price,
          status, clob_order_id, trade_purpose, reasoning, created_at
        ) VALUES ($1, $2, 'SELL', 'market', $3, $4, 'pending', $5, 'emergency_exit', 'Risk engine emergency exit', $6)`,
        [
          sessionId,
          positionDirection,
          positionAmount,
          marketOrderResult.price || 0,
          marketOrderResult.orderId || null,
          now,
        ]
      );

      return;
    }
  } catch (error) {
    consecutiveApiFailures++;
    console.error(`Emergency market order failed for session ${sessionId}:`, error);
  }

  // Market order failed - attempt aggressive limit order at 5% worse than best bid
  try {
    const bestBid = await fetchBestBid(marketId, positionDirection);
    if (bestBid === null) {
      console.error(`Cannot fetch best bid for market ${marketId}. Emergency exit pending.`);
      await handleApiUnreachable(sessionId, pgClient);
      return;
    }

    // Place limit order at 5% worse than best bid
    const aggressivePrice = Math.max(0.01, bestBid * (1 - EMERGENCY_LIMIT_OFFSET_PCT));

    const limitOrderResult = await placeClobOrder({
      marketId,
      side: 'SELL',
      direction: positionDirection as 'YES' | 'NO',
      size: positionAmount,
      orderType: 'limit',
      price: aggressivePrice,
    });

    if (limitOrderResult.success) {
      consecutiveApiFailures = 0;

      await pgClient.query(
        `INSERT INTO portfolio_manager_trades (
          session_id, direction, side, order_type, size_usdc, price,
          status, clob_order_id, trade_purpose, reasoning, created_at
        ) VALUES ($1, $2, 'SELL', 'limit', $3, $4, 'pending', $5, 'emergency_exit', 'Emergency exit fallback: aggressive limit at 5% below best bid', $6)`,
        [
          sessionId,
          positionDirection,
          positionAmount,
          aggressivePrice,
          limitOrderResult.orderId || null,
          now,
        ]
      );

      // Notify user that emergency exit is pending
      await publishRiskEvent('portfolio.risk.alert', {
        level: 'critical',
        message: `Emergency exit pending for session. Market order failed; aggressive limit order placed at ${(aggressivePrice * 100).toFixed(2)}¢.`,
        sessionsAffected: [sessionId],
      });
    } else {
      consecutiveApiFailures++;
      await handleApiUnreachable(sessionId, pgClient);
    }
  } catch (error) {
    consecutiveApiFailures++;
    console.error(`Emergency limit order failed for session ${sessionId}:`, error);
    await handleApiUnreachable(sessionId, pgClient);
  }
}

// ─── API Unreachability Handling (Requirement 8.5) ───────────────────────────

/**
 * Handle API unreachability: after 3 consecutive failures, pause all activity
 * and notify the user.
 */
async function handleApiUnreachable(
  sessionId: string,
  pgClient: import('pg').Client
): Promise<void> {
  if (consecutiveApiFailures >= MAX_CONSECUTIVE_FAILURES) {
    console.error(
      `API unreachable: ${consecutiveApiFailures} consecutive failures. Pausing all portfolio activity.`
    );

    // Get the user for this session to notify
    const sessionResult = await pgClient.query(
      `SELECT user_id FROM portfolio_manager_sessions WHERE id = $1`,
      [sessionId]
    );

    if (sessionResult.rows.length > 0) {
      const userId = sessionResult.rows[0].user_id;

      // Pause all active sessions for this user
      await pgClient.query(
        `UPDATE portfolio_manager_sessions SET status = 'paused'
         WHERE user_id = $1 AND status = 'active'`,
        [userId]
      );

      await publishRiskEvent('portfolio.risk.alert', {
        level: 'critical',
        message: 'Polymarket API unreachable after 3 consecutive failures. All portfolio activity paused. Manual resume required after API recovery.',
        sessionsAffected: [sessionId],
        userId,
      });
    }
  }
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
 * Resolve the token ID for a given market + direction from the Polymarket CLOB API.
 * Matches by outcome field (never by array index - order is not guaranteed).
 */
async function resolveTokenId(marketId: string, direction: string): Promise<string | undefined> {
  try {
    const creds = await getClobCredentials();
    if (!clobCredentialsConfigured(creds)) return undefined;

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
 * Place an order on the Polymarket CLOB API with retry logic.
 * Resolves the token ID from the market+direction, then places the order.
 * Retries up to 3 times with exponential backoff (1s, 2s, 4s).
 */
async function placeClobOrder(request: ClobOrderRequest): Promise<ClobOrderResult> {
  const retryDelays = [1000, 2000, 4000];
  const creds = await getClobCredentials();
  if (!clobCredentialsConfigured(creds)) {
    consecutiveApiFailures++;
    return { success: false, error: 'CLOB credentials not configured' };
  }

  // Resolve token ID from market + direction before placing the order
  const tokenId = await resolveTokenId(request.marketId, request.direction);
  if (!tokenId) {
    consecutiveApiFailures++;
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
        signal: AbortSignal.timeout(10_000), // 10s timeout per Requirement 8.5
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`CLOB API error ${response.status}: ${errorText}`);
      }

      const data = (await response.json()) as Record<string, unknown>;
      consecutiveApiFailures = 0;

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

  consecutiveApiFailures++;
  return { success: false, error: 'All retry attempts exhausted' };
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
      consecutiveApiFailures = 0;
      return true;
    }

    console.warn(`Failed to cancel order ${orderId}: ${response.status}`);
    return false;
  } catch (error) {
    consecutiveApiFailures++;
    console.error(`Cancel order ${orderId} failed:`, error);
    return false;
  }
}

/**
 * Fetch the best bid price for a market/direction from the CLOB order book.
 */
async function fetchBestBid(
  marketId: string,
  direction: string
): Promise<number | null> {
  try {
    const creds = await getClobCredentials();
    const response = await fetch(
      `${creds.apiUrl}/book?token_id=${direction}&market=${marketId}`,
      {
        headers: buildClobHeaders(creds),
        signal: AbortSignal.timeout(10_000),
      }
    );

    if (!response.ok) {
      consecutiveApiFailures++;
      return null;
    }

    const data = (await response.json()) as Record<string, unknown>;
    consecutiveApiFailures = 0;

    // Extract best bid from order book
    const bids = data.bids as Array<Record<string, unknown>> | undefined;
    if (bids && bids.length > 0) {
      return Number(bids[0].price);
    }

    return null;
  } catch (error) {
    consecutiveApiFailures++;
    console.error(`Failed to fetch best bid for market ${marketId}:`, error);
    return null;
  }
}

// ─── EventBridge Publishing ──────────────────────────────────────────────────

/**
 * Publish a risk event to EventBridge for notification fan-out.
 */
async function publishRiskEvent(
  detailType: string,
  detail: Record<string, unknown>
): Promise<void> {
  try {
    await eventBridgeClient.send(
      new PutEventsCommand({
        Entries: [
          {
            Source: `tradewizard.portfolio.risk-engine`,
            DetailType: detailType,
            Detail: JSON.stringify(detail),
            EventBusName: EVENT_BUS_NAME,
          },
        ],
      })
    );
  } catch (error) {
    console.error(`Failed to publish risk event (${detailType}):`, error);
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
