/**
 * Portfolio Investment Service - Lambda handler.
 *
 * Manages investment amount updates and capital breakdown queries for
 * active portfolio manager sessions.
 *
 * Endpoints:
 * - PUT /portfolio/sessions/{sessionId}/investment - Update investment amount
 * - GET /portfolio/sessions/{sessionId}/investment - Get capital breakdown
 *
 * For increases: verifies wallet balance covers the additional amount,
 * then adds to investment_amount and amount_available.
 *
 * For decreases: only allows reduction of the uninvested portion
 * (amount_available). Rejects if the user tries to reduce below the
 * committed amount (in positions + in pending orders).
 *
 * Triggered by: API Gateway
 *
 * Requirements: 6.1, 6.2, 6.3, 6.4, 6.5, 6.6, 6.7
 */

import { getConnectionString } from '../shared/db';
import { readBalance } from '../shared/chain-verification';
import { UpdateInvestmentRequestSchema } from '../shared/portfolio-types';
import { CAPITAL_QUERIES, SESSION_QUERIES } from '../shared/portfolio-db';

// ─── Configuration ───────────────────────────────────────────────────────────

const USDC_DECIMALS = 6;

// ─── CORS Headers ────────────────────────────────────────────────────────────

const CORS_HEADERS = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type,Authorization',
  'Access-Control-Allow-Methods': 'GET,PUT,OPTIONS',
};

// ─── Interfaces ──────────────────────────────────────────────────────────────

interface ApiGatewayEvent {
  body: string | null;
  pathParameters: Record<string, string> | null;
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

    const sessionId = event.pathParameters?.sessionId;
    if (!sessionId) {
      return errorResponse(400, 'Session ID is required');
    }

    // Extract userId from Cognito authorizer
    const cognitoSub = event.requestContext.authorizer.claims.sub;

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
        `SELECT u.id, s.wallet_address
         FROM users u
         LEFT JOIN subscriptions s ON s.user_id = u.id AND s.status IN ('active', 'grace_period')
         WHERE u.cognito_sub = $1
         LIMIT 1`,
        [cognitoSub]
      );

      if (userResult.rows.length === 0) {
        return errorResponse(403, 'User not found');
      }

      const userId: string = userResult.rows[0].id;
      const walletAddress: string | null = userResult.rows[0].wallet_address;

      // Verify session exists and belongs to this user
      const sessionResult = await client.query(SESSION_QUERIES.getSessionById, [
        sessionId,
      ]);

      if (sessionResult.rows.length === 0) {
        return errorResponse(404, 'Session not found');
      }

      const session = sessionResult.rows[0];

      if (session.user_id !== userId) {
        return errorResponse(403, 'You do not have access to this session');
      }

      // Route based on HTTP method
      if (event.httpMethod === 'GET') {
        return handleGetCapitalBreakdown(client, sessionId);
      }

      if (event.httpMethod === 'PUT') {
        return handleUpdateInvestment(client, event, session, walletAddress, userId);
      }

      return errorResponse(405, 'Method not allowed');
    } finally {
      await client.end();
    }
  } catch (error) {
    console.error('Portfolio investment handler failed:', error);
    return errorResponse(500, 'Internal server error');
  }
}

// ─── GET: Capital Breakdown ──────────────────────────────────────────────────

async function handleGetCapitalBreakdown(
  client: import('pg').Client,
  sessionId: string
): Promise<ApiResponse> {
  const result = await client.query(CAPITAL_QUERIES.getCapitalBreakdown, [
    sessionId,
  ]);

  if (result.rows.length === 0) {
    return errorResponse(404, 'Capital breakdown not found for this session');
  }

  const row = result.rows[0];

  const breakdown = {
    investmentAmount: Number(row.investment_amount),
    amountInPositions: Number(row.amount_in_positions),
    amountInPendingOrders: Number(row.amount_in_pending_orders),
    amountAvailable: Number(row.amount_available),
    realizedPnl: Number(row.realized_pnl),
  };

  return {
    statusCode: 200,
    headers: CORS_HEADERS,
    body: JSON.stringify(breakdown),
  };
}

// ─── PUT: Update Investment Amount ───────────────────────────────────────────

async function handleUpdateInvestment(
  client: import('pg').Client,
  event: ApiGatewayEvent,
  session: Record<string, unknown>,
  walletAddress: string | null,
  userId: string
): Promise<ApiResponse> {
  // Validate session is in an active state
  const status = session.status as string;
  if (status !== 'active' && status !== 'paused') {
    return errorResponse(
      400,
      `Cannot update investment for a session with status "${status}". Only active or paused sessions can be updated.`
    );
  }

  // Parse and validate request body
  if (!event.body) {
    return errorResponse(400, 'Request body is required');
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(event.body);
  } catch {
    return errorResponse(400, 'Invalid JSON in request body');
  }

  const validation = UpdateInvestmentRequestSchema.safeParse(parsed);
  if (!validation.success) {
    const issues = validation.error.issues.map((i) => i.message).join('; ');
    return errorResponse(400, `Validation failed: ${issues}`);
  }

  const { amount, action } = validation.data;

  if (amount <= 0) {
    return errorResponse(400, 'Amount must be greater than zero');
  }

  const currentInvestmentAmount = Number(session.investment_amount);
  const amountInPositions = Number(session.amount_in_positions);
  const amountInPendingOrders = Number(session.amount_in_pending_orders);
  const amountAvailable = Number(session.amount_available);

  if (action === 'increase') {
    return handleIncrease(
      client,
      session.id as string,
      amount,
      currentInvestmentAmount,
      amountAvailable,
      walletAddress,
      userId
    );
  }

  if (action === 'decrease') {
    return handleDecrease(
      client,
      session.id as string,
      amount,
      currentInvestmentAmount,
      amountInPositions,
      amountInPendingOrders,
      amountAvailable
    );
  }

  return errorResponse(400, 'Invalid action. Must be "increase" or "decrease".');
}

// ─── Increase Investment ─────────────────────────────────────────────────────

async function handleIncrease(
  client: import('pg').Client,
  sessionId: string,
  additionalAmount: number,
  currentInvestmentAmount: number,
  currentAmountAvailable: number,
  walletAddress: string | null,
  userId: string
): Promise<ApiResponse> {
  // Verify wallet balance covers the additional amount (accounting for committed capital)
  if (!walletAddress) {
    return errorResponse(
      400,
      'No wallet address found. Please connect your wallet before increasing investment.'
    );
  }

  // Calculate total capital already committed to all active sessions
  const committedResult = await client.query(
    `SELECT COALESCE(SUM(investment_amount), 0)::numeric AS total_committed
     FROM portfolio_manager_sessions
     WHERE user_id = $1 AND status IN ('active', 'paused', 'exiting')`,
    [userId]
  );
  const totalCommitted = Number(committedResult.rows[0]?.total_committed ?? 0);

  try {
    const balanceRaw = await readBalance(walletAddress);
    const balanceUsdc = Number(balanceRaw) / 10 ** USDC_DECIMALS;
    const availableBalance = balanceUsdc - totalCommitted;

    if (availableBalance < additionalAmount) {
      return errorResponse(
        400,
        `Insufficient available balance. Your wallet holds $${balanceUsdc.toFixed(2)} USDC.e but $${totalCommitted.toFixed(2)} is already committed to active sessions. Available: $${availableBalance.toFixed(2)}, requested increase: $${additionalAmount.toFixed(2)}.`
      );
    }
  } catch (error) {
    console.error('Wallet balance verification failed:', error);
    return errorResponse(
      400,
      'Unable to verify wallet balance. Please try again later.'
    );
  }

  // Apply the increase: add to investment_amount and amount_available
  const newInvestmentAmount = currentInvestmentAmount + additionalAmount;
  const newAmountAvailable = currentAmountAvailable + additionalAmount;

  await client.query(
    `UPDATE portfolio_manager_sessions
     SET investment_amount = $1, amount_available = $2
     WHERE id = $3`,
    [newInvestmentAmount, newAmountAvailable, sessionId]
  );

  // Return updated capital breakdown
  const breakdownResult = await client.query(
    CAPITAL_QUERIES.getCapitalBreakdown,
    [sessionId]
  );
  const row = breakdownResult.rows[0];

  return {
    statusCode: 200,
    headers: CORS_HEADERS,
    body: JSON.stringify({
      message: `Investment increased by $${additionalAmount.toFixed(2)}. Additional funds are now available for trading.`,
      investmentAmount: Number(row.investment_amount),
      amountInPositions: Number(row.amount_in_positions),
      amountInPendingOrders: Number(row.amount_in_pending_orders),
      amountAvailable: Number(row.amount_available),
      realizedPnl: Number(row.realized_pnl),
    }),
  };
}

// ─── Decrease Investment ─────────────────────────────────────────────────────

async function handleDecrease(
  client: import('pg').Client,
  sessionId: string,
  reductionAmount: number,
  currentInvestmentAmount: number,
  amountInPositions: number,
  amountInPendingOrders: number,
  amountAvailable: number
): Promise<ApiResponse> {
  // Only allow reduction of the uninvested portion (amount_available)
  const committedAmount = amountInPositions + amountInPendingOrders;

  if (reductionAmount > amountAvailable) {
    return errorResponse(
      400,
      `Cannot reduce investment by $${reductionAmount.toFixed(2)}. Only $${amountAvailable.toFixed(2)} is available for withdrawal. ` +
        `Committed capital breakdown: $${amountInPositions.toFixed(2)} in open positions, ` +
        `$${amountInPendingOrders.toFixed(2)} in pending orders.`
    );
  }

  // Ensure the resulting investment amount doesn't go below the minimum ($5)
  const newInvestmentAmount = currentInvestmentAmount - reductionAmount;
  const newAmountAvailable = amountAvailable - reductionAmount;

  if (newInvestmentAmount < 5) {
    return errorResponse(
      400,
      `Cannot reduce investment below the minimum of $5.00. Current investment is $${currentInvestmentAmount.toFixed(2)} and requested reduction is $${reductionAmount.toFixed(2)}.`
    );
  }

  // Apply the decrease: reduce investment_amount and amount_available
  await client.query(
    `UPDATE portfolio_manager_sessions
     SET investment_amount = $1, amount_available = $2
     WHERE id = $3`,
    [newInvestmentAmount, newAmountAvailable, sessionId]
  );

  // Return updated capital breakdown
  const breakdownResult = await client.query(
    CAPITAL_QUERIES.getCapitalBreakdown,
    [sessionId]
  );
  const row = breakdownResult.rows[0];

  return {
    statusCode: 200,
    headers: CORS_HEADERS,
    body: JSON.stringify({
      message: `Investment decreased by $${reductionAmount.toFixed(2)}. Funds have been released.`,
      investmentAmount: Number(row.investment_amount),
      amountInPositions: Number(row.amount_in_positions),
      amountInPendingOrders: Number(row.amount_in_pending_orders),
      amountAvailable: Number(row.amount_available),
      realizedPnl: Number(row.realized_pnl),
    }),
  };
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function errorResponse(statusCode: number, message: string): ApiResponse {
  return {
    statusCode,
    headers: CORS_HEADERS,
    body: JSON.stringify({ error: message }),
  };
}
