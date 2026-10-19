/**
 * Portfolio Dashboard API - Lambda handler.
 *
 * Unified REST interface for the Portfolio Manager dashboard.
 * Provides session listing, trade history, decision logs, aggregate stats,
 * session controls (pause/resume/stop), persona settings, and kill switch.
 *
 * Endpoints:
 * - GET    /portfolio/sessions                    - List all user sessions
 * - GET    /portfolio/sessions/{id}               - Session detail
 * - GET    /portfolio/sessions/{id}/trades        - Paginated trade history
 * - GET    /portfolio/sessions/{id}/decisions     - Paginated decision log
 * - GET    /portfolio/stats                       - Aggregate portfolio statistics
 * - PUT    /portfolio/sessions/{id}/pause         - Pause session
 * - PUT    /portfolio/sessions/{id}/resume        - Resume session
 * - DELETE /portfolio/sessions/{id}               - Stop session
 * - PUT    /portfolio/settings/persona            - Update persona selection
 * - GET    /portfolio/settings/persona            - Get current persona config
 * - POST   /portfolio/kill-switch                 - Trigger global kill switch
 * - DELETE /portfolio/kill-switch                 - Reset kill switch
 *
 * Triggered by: API Gateway
 *
 * Requirements: 9.1, 9.3, 9.4, 9.5, 9.6, 9.7, 9.8, 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7, 3.8
 */

import {
  DynamoDBClient,
  GetItemCommand,
  PutItemCommand,
  DeleteItemCommand,
} from '@aws-sdk/client-dynamodb';
import {
  SchedulerClient,
  DeleteScheduleCommand,
} from '@aws-sdk/client-scheduler';
import {
  EventBridgeClient,
  PutEventsCommand,
} from '@aws-sdk/client-eventbridge';
import { marshall, unmarshall } from '@aws-sdk/util-dynamodb';
import { getConnectionString } from '../shared/db';
import { getClobCredentials, buildClobHeaders, clobCredentialsConfigured } from '../shared/clob-credentials';
import {
  UpdatePersonaRequestSchema,
  KillSwitchRequestSchema,
} from '../shared/portfolio-types';
import {
  SESSION_QUERIES,
  TRADE_QUERIES,
  DECISION_QUERIES,
  STATS_QUERIES,
  UTILITY_QUERIES,
  buildPaginationMeta,
  mapRowToSession,
  mapRowToTrade,
  mapRowToDecision,
} from '../shared/portfolio-db';
import {
  getPersona,
  getPersonaOrThrow,
  isValidPersonaId,
  applyCustomParams,
  validateCustomParams,
  PERSONA_DESCRIPTIONS,
  DEFAULT_PERSONA_ID,
} from '../shared/persona-registry';


// ─── Configuration ───────────────────────────────────────────────────────────

const RATE_LIMIT_TABLE = process.env.RATE_LIMIT_TABLE || '';
const EVENT_BUS_NAME = process.env.EVENT_BUS_NAME || 'default';

const dynamoClient = new DynamoDBClient({});
const eventBridgeClient = new EventBridgeClient({});
const schedulerClient = new SchedulerClient({});

// ─── CORS Headers ────────────────────────────────────────────────────────────

const CORS_HEADERS = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type,Authorization',
  'Access-Control-Allow-Methods': 'GET,PUT,POST,DELETE,OPTIONS',
};

// ─── Interfaces ──────────────────────────────────────────────────────────────

interface ApiGatewayEvent {
  body: string | null;
  pathParameters: Record<string, string> | null;
  queryStringParameters: Record<string, string> | null;
  requestContext: {
    authorizer: {
      claims: {
        sub: string;
        email: string;
      };
    };
  };
  httpMethod: string;
  path: string;
}

interface ApiResponse {
  statusCode: number;
  headers: Record<string, string>;
  body: string;
}

// ─── Main Handler ────────────────────────────────────────────────────────────

export async function handler(event: ApiGatewayEvent): Promise<ApiResponse> {
  try {
    // Handle CORS preflight
    if (event.httpMethod === 'OPTIONS') {
      return { statusCode: 200, headers: CORS_HEADERS, body: '' };
    }

    // Extract userId from Cognito authorizer
    const cognitoSub = event.requestContext.authorizer?.claims?.sub;
    if (!cognitoSub) {
      return errorResponse(401, 'Unauthorized');
    }

    // Connect to database
    const connectionString = await getConnectionString();
    const pg = await import('pg');
    const client = new pg.Client({
      connectionString,
      ssl: { rejectUnauthorized: false },
    });

    try {
      await client.connect();

      // Resolve internal user ID from Cognito sub
      const userResult = await client.query(
        `SELECT u.id, u.portfolio_persona_id, u.portfolio_persona_params,
                s.plan, s.status AS sub_status
         FROM users u
         LEFT JOIN subscriptions s ON s.user_id = u.id AND s.status IN ('active', 'grace_period')
         WHERE u.cognito_sub = $1
         LIMIT 1`,
        [cognitoSub]
      );

      if (userResult.rows.length === 0) {
        return errorResponse(403, 'User not found');
      }

      const user = userResult.rows[0];
      const userId: string = user.id;

      // Route based on httpMethod + path
      return await routeRequest(event, userId, user, client);
    } finally {
      await client.end();
    }
  } catch (error) {
    console.error('Portfolio dashboard API failed:', error);
    return errorResponse(500, 'Internal server error');
  }
}


// ─── Router ──────────────────────────────────────────────────────────────────

async function routeRequest(
  event: ApiGatewayEvent,
  userId: string,
  user: Record<string, unknown>,
  client: import('pg').Client
): Promise<ApiResponse> {
  const { httpMethod, path } = event;

  // Kill switch routes
  if (path.endsWith('/kill-switch')) {
    if (httpMethod === 'POST') {
      return handleKillSwitchActivation(event, userId, client);
    }
    if (httpMethod === 'DELETE') {
      return handleKillSwitchReset(userId);
    }
  }

  // Persona settings routes
  if (path.endsWith('/settings/persona')) {
    if (httpMethod === 'GET') {
      return handleGetPersonaSettings(user);
    }
    if (httpMethod === 'PUT') {
      return handleUpdatePersonaSettings(event, userId, user, client);
    }
  }

  // Aggregate stats
  if (path.endsWith('/portfolio/stats') && httpMethod === 'GET') {
    return handleGetAggregateStats(userId, client);
  }

  // Preflight: check recurring analysis exists for a market
  if (path.includes('/preflight/recurring-analysis') && httpMethod === 'GET') {
    return handlePreflightRecurringAnalysis(userId, event, client);
  }

  // Session-specific routes (with session ID in path)
  const sessionIdMatch = path.match(/\/portfolio\/sessions\/([^/]+)/);
  if (sessionIdMatch) {
    const sessionId = sessionIdMatch[1];

    // Sub-resource routes
    if (path.endsWith('/trades') && httpMethod === 'GET') {
      return handleGetSessionTrades(sessionId, userId, event, client);
    }
    if (path.endsWith('/decisions') && httpMethod === 'GET') {
      return handleGetSessionDecisions(sessionId, userId, event, client);
    }
    if (path.endsWith('/pause') && httpMethod === 'PUT') {
      return handlePauseSession(sessionId, userId, client);
    }
    if (path.endsWith('/resume') && httpMethod === 'PUT') {
      return handleResumeSession(sessionId, userId, client);
    }

    // DELETE /portfolio/sessions/{id} - Stop session
    if (httpMethod === 'DELETE') {
      return handleStopSession(sessionId, userId, client);
    }

    // GET /portfolio/sessions/{id} - Session detail
    if (httpMethod === 'GET') {
      return handleGetSessionDetail(sessionId, userId, client);
    }
  }

  // GET /portfolio/sessions - List all sessions
  if (path.endsWith('/sessions') && httpMethod === 'GET') {
    return handleListSessions(userId, client);
  }

  return errorResponse(404, 'Not found');
}


// ─── GET /portfolio/sessions - List all user sessions ────────────────────────

async function handleListSessions(
  userId: string,
  client: import('pg').Client
): Promise<ApiResponse> {
  const result = await client.query(SESSION_QUERIES.getSessionsByUser, [userId]);

  const sessions = result.rows.map((row) => {
    const session = mapRowToSession(row);
    const investmentAmount = session.investmentAmount;
    const amountInPositions = Number(row.amount_in_positions);
    const utilizationPct =
      investmentAmount > 0
        ? Math.round((amountInPositions / investmentAmount) * 10000) / 100
        : 0;

    return {
      id: session.id,
      marketId: session.marketId,
      personaId: session.personaId,
      personaName: session.personaConfig?.name ?? session.personaId,
      status: session.status,
      investmentAmount: session.investmentAmount,
      realizedPnl: session.stats.realizedPnl,
      unrealizedPnl: session.stats.unrealizedPnl,
      utilizationPct,
      amountInPositions,
      amountAvailable: Number(row.amount_available),
      totalTrades: session.stats.totalTrades,
      createdAt: session.createdAt,
      updatedAt: session.updatedAt,
    };
  });

  return {
    statusCode: 200,
    headers: CORS_HEADERS,
    body: JSON.stringify({ sessions }),
  };
}

// ─── GET /portfolio/sessions/{id} - Session detail ───────────────────────────

async function handleGetSessionDetail(
  sessionId: string,
  userId: string,
  client: import('pg').Client
): Promise<ApiResponse> {
  const result = await client.query(SESSION_QUERIES.getSessionById, [sessionId]);

  if (result.rows.length === 0) {
    return errorResponse(404, 'Session not found');
  }

  const row = result.rows[0];

  if (row.user_id !== userId) {
    return errorResponse(403, 'You do not have access to this session');
  }

  const session = mapRowToSession(row);
  const investmentAmount = session.investmentAmount;
  const amountInPositions = Number(row.amount_in_positions);
  const utilizationPct =
    investmentAmount > 0
      ? Math.round((amountInPositions / investmentAmount) * 10000) / 100
      : 0;

  return {
    statusCode: 200,
    headers: CORS_HEADERS,
    body: JSON.stringify({
      ...session,
      utilizationPct,
      capitalBreakdown: {
        investmentAmount,
        amountInPositions,
        amountInPendingOrders: Number(row.amount_in_pending_orders),
        amountAvailable: Number(row.amount_available),
        realizedPnl: session.stats.realizedPnl,
      },
      riskState: {
        cumulativeLossPct: Number(row.cumulative_loss_pct),
        lastLossExitAt: row.last_loss_exit_at
          ? (row.last_loss_exit_at as Date).toISOString()
          : null,
        positionSizeReductionActive: row.position_size_reduction_active,
      },
    }),
  };
}


// ─── GET /portfolio/sessions/{id}/trades - Paginated trade history ───────────

async function handleGetSessionTrades(
  sessionId: string,
  userId: string,
  event: ApiGatewayEvent,
  client: import('pg').Client
): Promise<ApiResponse> {
  // Verify session ownership
  const sessionResult = await client.query(SESSION_QUERIES.getSessionById, [sessionId]);
  if (sessionResult.rows.length === 0) {
    return errorResponse(404, 'Session not found');
  }
  if (sessionResult.rows[0].user_id !== userId) {
    return errorResponse(403, 'You do not have access to this session');
  }

  // Parse pagination params
  const page = Math.max(1, parseInt(event.queryStringParameters?.page || '1', 10));
  const pageSize = Math.min(100, Math.max(1, parseInt(event.queryStringParameters?.pageSize || '20', 10)));

  // Get total count
  const countResult = await client.query(TRADE_QUERIES.countTradesBySession, [sessionId]);
  const total: number = countResult.rows[0]?.total ?? 0;

  const { offset, hasMore } = buildPaginationMeta(total, page, pageSize);

  // Get paginated trades
  const tradesResult = await client.query(TRADE_QUERIES.getTradesBySession, [
    sessionId,
    pageSize,
    offset,
  ]);

  const trades = tradesResult.rows.map(mapRowToTrade);

  return {
    statusCode: 200,
    headers: CORS_HEADERS,
    body: JSON.stringify({
      items: trades,
      total,
      page,
      pageSize,
      hasMore,
    }),
  };
}

// ─── GET /portfolio/sessions/{id}/decisions - Paginated decision log ─────────

async function handleGetSessionDecisions(
  sessionId: string,
  userId: string,
  event: ApiGatewayEvent,
  client: import('pg').Client
): Promise<ApiResponse> {
  // Verify session ownership
  const sessionResult = await client.query(SESSION_QUERIES.getSessionById, [sessionId]);
  if (sessionResult.rows.length === 0) {
    return errorResponse(404, 'Session not found');
  }
  if (sessionResult.rows[0].user_id !== userId) {
    return errorResponse(403, 'You do not have access to this session');
  }

  // Parse pagination params
  const page = Math.max(1, parseInt(event.queryStringParameters?.page || '1', 10));
  const pageSize = Math.min(100, Math.max(1, parseInt(event.queryStringParameters?.pageSize || '20', 10)));

  // Get total count
  const countResult = await client.query(DECISION_QUERIES.countDecisionsBySession, [sessionId]);
  const total: number = countResult.rows[0]?.total ?? 0;

  const { offset, hasMore } = buildPaginationMeta(total, page, pageSize);

  // Get paginated decisions
  const decisionsResult = await client.query(DECISION_QUERIES.getDecisionsBySession, [
    sessionId,
    pageSize,
    offset,
  ]);

  const decisions = decisionsResult.rows.map(mapRowToDecision);

  return {
    statusCode: 200,
    headers: CORS_HEADERS,
    body: JSON.stringify({
      items: decisions,
      total,
      page,
      pageSize,
      hasMore,
    }),
  };
}


// ─── GET /portfolio/stats - Aggregate portfolio statistics ───────────────────

async function handleGetAggregateStats(
  userId: string,
  client: import('pg').Client
): Promise<ApiResponse> {
  const result = await client.query(STATS_QUERIES.getAggregateStats, [userId]);

  if (result.rows.length === 0) {
    return {
      statusCode: 200,
      headers: CORS_HEADERS,
      body: JSON.stringify({
        totalInvested: 0,
        totalCommittedCapital: 0,
        totalUnrealizedPnl: 0,
        totalRealizedPnl: 0,
        activeSessionCount: 0,
      }),
    };
  }

  const stats = result.rows[0];

  // total_invested from the aggregate query already sums active sessions
  const totalCommitted = Number(stats.total_invested);

  return {
    statusCode: 200,
    headers: CORS_HEADERS,
    body: JSON.stringify({
      totalInvested: totalCommitted,
      totalCommittedCapital: totalCommitted,
      totalUnrealizedPnl: Number(stats.total_unrealized_pnl),
      totalRealizedPnl: Number(stats.total_realized_pnl),
      activeSessionCount: Number(stats.active_session_count),
    }),
  };
}

// ─── PUT /portfolio/sessions/{id}/pause - Pause session ──────────────────────

async function handlePauseSession(
  sessionId: string,
  userId: string,
  client: import('pg').Client
): Promise<ApiResponse> {
  // Verify session ownership and current status
  const sessionResult = await client.query(SESSION_QUERIES.getSessionById, [sessionId]);
  if (sessionResult.rows.length === 0) {
    return errorResponse(404, 'Session not found');
  }

  const session = sessionResult.rows[0];
  if (session.user_id !== userId) {
    return errorResponse(403, 'You do not have access to this session');
  }

  if (session.status !== 'active') {
    return errorResponse(
      400,
      `Cannot pause a session with status "${session.status}". Only active sessions can be paused.`
    );
  }

  // Cancel pending orders for this session
  const now = new Date().toISOString();
  const pendingResult = await client.query(UTILITY_QUERIES.getPendingTradesBySession, [sessionId]);

  for (const trade of pendingResult.rows) {
    if (trade.clob_order_id) {
      await cancelClobOrder(trade.clob_order_id);
    }
    await client.query(
      `UPDATE portfolio_manager_trades SET status = 'cancelled', cancelled_at = $1 WHERE id = $2`,
      [now, trade.id]
    );
  }

  // Update pending orders capital back to available
  const cancelledAmount = pendingResult.rows.reduce(
    (sum: number, t: Record<string, unknown>) => sum + Number(t.size_usdc),
    0
  );
  if (cancelledAmount > 0) {
    await client.query(
      `UPDATE portfolio_manager_sessions
       SET amount_in_pending_orders = amount_in_pending_orders - $1,
           amount_available = amount_available + $1
       WHERE id = $2`,
      [cancelledAmount, sessionId]
    );
  }

  // Update session status to paused
  await client.query(SESSION_QUERIES.updateSessionStatus, ['paused', sessionId]);

  return {
    statusCode: 200,
    headers: CORS_HEADERS,
    body: JSON.stringify({
      sessionId,
      status: 'paused',
      message: 'Session paused. New trade entries halted and pending orders cancelled. Position monitoring continues.',
    }),
  };
}

// ─── PUT /portfolio/sessions/{id}/resume - Resume session ────────────────────

async function handleResumeSession(
  sessionId: string,
  userId: string,
  client: import('pg').Client
): Promise<ApiResponse> {
  // Verify session ownership and current status
  const sessionResult = await client.query(SESSION_QUERIES.getSessionById, [sessionId]);
  if (sessionResult.rows.length === 0) {
    return errorResponse(404, 'Session not found');
  }

  const session = sessionResult.rows[0];
  if (session.user_id !== userId) {
    return errorResponse(403, 'You do not have access to this session');
  }

  if (session.status !== 'paused') {
    return errorResponse(
      400,
      `Cannot resume a session with status "${session.status}". Only paused sessions can be resumed.`
    );
  }

  // Check kill switch is not active
  const killSwitchActive = await isKillSwitchActive(userId);
  if (killSwitchActive) {
    return errorResponse(
      400,
      'Cannot resume session while the kill switch is active. Please reset the kill switch first.'
    );
  }

  // Update session status to active
  await client.query(SESSION_QUERIES.updateSessionStatus, ['active', sessionId]);

  return {
    statusCode: 200,
    headers: CORS_HEADERS,
    body: JSON.stringify({
      sessionId,
      status: 'active',
      message: 'Session resumed. Portfolio Manager will evaluate new trade entries on the next analysis cycle.',
    }),
  };
}


// ─── DELETE /portfolio/sessions/{id} - Stop session ──────────────────────────

async function handleStopSession(
  sessionId: string,
  userId: string,
  client: import('pg').Client
): Promise<ApiResponse> {
  // Verify session ownership and current status
  const sessionResult = await client.query(SESSION_QUERIES.getSessionById, [sessionId]);
  if (sessionResult.rows.length === 0) {
    return errorResponse(404, 'Session not found');
  }

  const session = sessionResult.rows[0];
  if (session.user_id !== userId) {
    return errorResponse(403, 'You do not have access to this session');
  }

  const status = session.status as string;
  if (status === 'completed' || status === 'terminated') {
    return errorResponse(
      400,
      `Session is already ${status}. No further action needed.`
    );
  }

  const now = new Date().toISOString();

  // Cancel all pending orders
  const pendingResult = await client.query(UTILITY_QUERIES.getPendingTradesBySession, [sessionId]);
  for (const trade of pendingResult.rows) {
    if (trade.clob_order_id) {
      await cancelClobOrder(trade.clob_order_id);
    }
    await client.query(
      `UPDATE portfolio_manager_trades SET status = 'cancelled', cancelled_at = $1 WHERE id = $2`,
      [now, trade.id]
    );
  }

  // Exit open position at market price if one exists
  if (session.position_direction && Number(session.amount_in_positions) > 0) {
    await placeMarketExit(
      sessionId,
      session.market_id,
      session.position_direction,
      Number(session.amount_in_positions),
      client
    );
  }

  // Delete position guard schedule
  if (session.position_guard_schedule_arn) {
    await deleteScheduleSafe(session.position_guard_schedule_arn);
  }

  // Terminate session
  await client.query(SESSION_QUERIES.terminateSession, [
    'user_stopped',
    now,
    sessionId,
  ]);

  return {
    statusCode: 200,
    headers: CORS_HEADERS,
    body: JSON.stringify({
      sessionId,
      status: 'terminated',
      terminationReason: 'user_stopped',
      message: 'Session stopped. All positions exited and pending orders cancelled.',
    }),
  };
}

// ─── GET /portfolio/settings/persona - Get current persona config ────────────

async function handleGetPersonaSettings(
  user: Record<string, unknown>
): Promise<ApiResponse> {
  const personaId = (user.portfolio_persona_id as string) || DEFAULT_PERSONA_ID;
  const plan = (user.plan as string) || 'free';

  const persona = getPersona(personaId);
  if (!persona) {
    return errorResponse(500, 'Configured persona not found in registry');
  }

  // Get persona description
  const description = PERSONA_DESCRIPTIONS.find((d) => d.id === personaId);

  const response: Record<string, unknown> = {
    personaId,
    persona,
    description: description || null,
    customParams: null,
    canCustomize: plan === 'elite',
  };

  // Include custom params if Elite user has them
  if (plan === 'elite' && user.portfolio_persona_params) {
    const customParams =
      typeof user.portfolio_persona_params === 'string'
        ? JSON.parse(user.portfolio_persona_params as string)
        : user.portfolio_persona_params;
    response.customParams = customParams;

    // Show the effective persona config with customization applied
    response.effectivePersona = applyCustomParams(persona, customParams);
  }

  return {
    statusCode: 200,
    headers: CORS_HEADERS,
    body: JSON.stringify(response),
  };
}


// ─── PUT /portfolio/settings/persona - Update persona selection ──────────────

async function handleUpdatePersonaSettings(
  event: ApiGatewayEvent,
  userId: string,
  user: Record<string, unknown>,
  client: import('pg').Client
): Promise<ApiResponse> {
  if (!event.body) {
    return errorResponse(400, 'Request body is required');
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(event.body);
  } catch {
    return errorResponse(400, 'Invalid JSON in request body');
  }

  const validation = UpdatePersonaRequestSchema.safeParse(parsed);
  if (!validation.success) {
    const issues = validation.error.issues.map((i) => i.message).join('; ');
    return errorResponse(400, `Validation failed: ${issues}`);
  }

  const { personaId, customParams } = validation.data;
  const plan = (user.plan as string) || 'free';

  // Validate persona ID exists
  if (!isValidPersonaId(personaId)) {
    return errorResponse(
      400,
      `Invalid persona ID: "${personaId}". Valid options: sniper, scalper, contrarian, catalyst-hunter, hedge-architect, momentum-rider`
    );
  }

  // Validate custom params (Elite only)
  if (customParams) {
    if (plan !== 'elite') {
      return errorResponse(
        403,
        'Persona customization is only available for Elite subscribers. Upgrade to Elite to customize persona parameters.'
      );
    }

    const paramErrors = validateCustomParams(customParams);
    if (paramErrors.length > 0) {
      return errorResponse(400, `Invalid custom parameters: ${paramErrors.join('; ')}`);
    }
  }

  // Update user's persona selection
  if (customParams && plan === 'elite') {
    await client.query(
      `UPDATE users SET portfolio_persona_id = $1, portfolio_persona_params = $2 WHERE id = $3`,
      [personaId, JSON.stringify(customParams), userId]
    );
  } else {
    await client.query(
      `UPDATE users SET portfolio_persona_id = $1 WHERE id = $2`,
      [personaId, userId]
    );
  }

  // Build response with the new effective config
  const persona = getPersonaOrThrow(personaId);
  const effectivePersona =
    customParams && plan === 'elite'
      ? applyCustomParams(persona, customParams)
      : persona;

  const description = PERSONA_DESCRIPTIONS.find((d) => d.id === personaId);

  return {
    statusCode: 200,
    headers: CORS_HEADERS,
    body: JSON.stringify({
      message: 'Persona updated successfully. Changes apply to future activations only.',
      personaId,
      persona: effectivePersona,
      description: description || null,
      customParams: customParams || null,
    }),
  };
}

// ─── POST /portfolio/kill-switch - Trigger global kill switch ────────────────

async function handleKillSwitchActivation(
  event: ApiGatewayEvent,
  userId: string,
  client: import('pg').Client
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

  const now = new Date().toISOString();

  // Store kill switch state in DynamoDB (atomic)
  await dynamoClient.send(
    new PutItemCommand({
      TableName: RATE_LIMIT_TABLE,
      Item: marshall({
        pk: `kill_switch#${userId}`,
        sk: 'state',
        active: true,
        triggeredAt: now,
        reason,
        ttl: Math.floor(Date.now() / 1000) + 86400 * 365, // 1 year TTL
      }),
    })
  );

  // Get all active sessions for user
  const sessionsResult = await client.query(
    UTILITY_QUERIES.getAllActiveSessionsForUser,
    [userId]
  );

  const sessions = sessionsResult.rows;
  let sessionsTerminated = 0;

  // For each session - cancel pending orders, exit positions, terminate
  for (const session of sessions) {
    const sessionId: string = session.id;

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
      await placeMarketExit(
        sessionId,
        session.market_id,
        session.position_direction,
        Number(session.amount_in_positions),
        client
      );
    }

    // Delete position guard schedule
    if (session.position_guard_schedule_arn) {
      await deleteScheduleSafe(session.position_guard_schedule_arn);
    }

    // Terminate session
    await client.query(SESSION_QUERIES.terminateSession, [
      'kill_switch',
      now,
      sessionId,
    ]);

    sessionsTerminated++;
  }

  console.log(
    `Kill switch executed for user=${userId}: ${sessionsTerminated} sessions terminated. Reason: ${reason}`
  );

  // Publish kill switch event to EventBridge for notification fan-out
  try {
    await eventBridgeClient.send(
      new PutEventsCommand({
        Entries: [
          {
            Source: 'tradewizard.portfolio.risk-engine',
            DetailType: 'portfolio.kill_switch.triggered',
            EventBusName: EVENT_BUS_NAME,
            Detail: JSON.stringify({
              userId,
              reason,
              sessionsAffected: sessions.map((s: Record<string, unknown>) => s.id),
              timestamp: now,
            }),
          },
        ],
      })
    );
  } catch (error) {
    console.error('Failed to publish kill switch event:', error);
    // Non-fatal: kill switch was already executed successfully
  }

  return {
    statusCode: 200,
    headers: CORS_HEADERS,
    body: JSON.stringify({ sessionsTerminated }),
  };
}


// ─── DELETE /portfolio/kill-switch - Reset kill switch ────────────────────────

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

// ─── Helper: Check Kill Switch State ─────────────────────────────────────────

async function isKillSwitchActive(userId: string): Promise<boolean> {
  try {
    const response = await dynamoClient.send(
      new GetItemCommand({
        TableName: RATE_LIMIT_TABLE,
        Key: marshall({ pk: `kill_switch#${userId}`, sk: 'state' }),
      })
    );

    if (!response.Item) return false;

    const item = unmarshall(response.Item) as Record<string, unknown>;
    return item.active === true;
  } catch (error) {
    console.error('Failed to check kill switch state:', error);
    return false;
  }
}

// ─── Helper: Place Market Exit Order ─────────────────────────────────────────

async function placeMarketExit(
  sessionId: string,
  marketId: string,
  positionDirection: string,
  positionAmount: number,
  pgClient: import('pg').Client
): Promise<void> {
  const now = new Date().toISOString();

  try {
    const creds = await getClobCredentials();
    if (!clobCredentialsConfigured(creds)) {
      console.error(`CLOB credentials not configured; cannot exit session ${sessionId} at market.`);
      await pgClient.query(
        `INSERT INTO portfolio_manager_trades (
          session_id, direction, side, order_type, size_usdc, price,
          status, trade_purpose, reasoning, exit_reason, created_at
        ) VALUES ($1, $2, 'SELL', 'market', $3, 0, 'failed', 'exit', 'User-initiated session stop (CLOB credentials unavailable)', 'user_stop', $4)`,
        [sessionId, positionDirection, positionAmount, now]
      );
      return;
    }

    const endpoint = `${creds.apiUrl}/order`;
    const body = {
      market: marketId,
      side: 'SELL',
      asset_id: positionDirection,
      size: positionAmount,
      type: 'market',
    };

    const response = await fetch(endpoint, {
      method: 'POST',
      headers: buildClobHeaders(creds),
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(10_000),
    });

    let orderId: string | null = null;
    if (response.ok) {
      const data = (await response.json()) as Record<string, unknown>;
      orderId = (data.orderID as string) || (data.id as string) || null;
    }

    // Record the exit trade
    await pgClient.query(
      `INSERT INTO portfolio_manager_trades (
        session_id, direction, side, order_type, size_usdc, price,
        status, clob_order_id, trade_purpose, reasoning, exit_reason, created_at
      ) VALUES ($1, $2, 'SELL', 'market', $3, 0, 'pending', $4, 'exit', 'User-initiated session stop', 'user_stop', $5)`,
      [sessionId, positionDirection, positionAmount, orderId, now]
    );
  } catch (error) {
    console.error(`Market exit failed for session ${sessionId}:`, error);
    // Record the attempted exit even on failure
    await pgClient.query(
      `INSERT INTO portfolio_manager_trades (
        session_id, direction, side, order_type, size_usdc, price,
        status, trade_purpose, reasoning, exit_reason, created_at
      ) VALUES ($1, $2, 'SELL', 'market', $3, 0, 'failed', 'exit', 'User-initiated session stop (API failure)', 'user_stop', $4)`,
      [sessionId, positionDirection, positionAmount, now]
    );
  }
}

// ─── Helper: Cancel CLOB Order ───────────────────────────────────────────────

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

    return response.ok;
  } catch (error) {
    console.error(`Cancel order ${orderId} failed:`, error);
    return false;
  }
}

// ─── Helper: Delete EventBridge Schedule ─────────────────────────────────────

async function deleteScheduleSafe(scheduleArn: string): Promise<void> {
  try {
    // Extract schedule name from ARN
    const scheduleName = scheduleArn.split('/').pop();
    if (!scheduleName) return;

    await schedulerClient.send(
      new DeleteScheduleCommand({ Name: scheduleName })
    );
  } catch (error) {
    console.error(`Failed to delete schedule ${scheduleArn}:`, error);
    // Non-fatal - schedule may already be deleted
  }
}

// ─── GET /portfolio/preflight/recurring-analysis - Check recurring analysis ──

async function handlePreflightRecurringAnalysis(
  userId: string,
  event: ApiGatewayEvent,
  client: import('pg').Client
): Promise<ApiResponse> {
  const marketId = event.queryStringParameters?.marketId;
  if (!marketId) {
    return errorResponse(400, 'marketId query parameter is required');
  }

  const result = await client.query(
    `SELECT id FROM analysis_requests
     WHERE user_id = $1 AND market_id = $2
       AND request_type = 'recurring' AND status = 'active'
     LIMIT 1`,
    [userId, marketId]
  );

  return {
    statusCode: 200,
    headers: CORS_HEADERS,
    body: JSON.stringify({ exists: result.rows.length > 0 }),
  };
}

// ─── Helper: Error Response ──────────────────────────────────────────────────

function errorResponse(statusCode: number, message: string): ApiResponse {
  return {
    statusCode,
    headers: CORS_HEADERS,
    body: JSON.stringify({ error: message }),
  };
}
