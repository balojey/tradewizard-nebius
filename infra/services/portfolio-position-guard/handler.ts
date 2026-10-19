/**
 * Portfolio Position Guard - Thin Dispatcher Lambda.
 *
 * Triggered by EventBridge Scheduler at persona-specific intervals (5–30 min).
 * Monitors active positions by invoking Portfolio Lambda for
 * exit reasoning, then validates and executes exit decisions.
 *
 * Safety gate sequence:
 * 1. Kill switch check (DynamoDB) - BEFORE acquiring lock
 * 2. Acquire distributed lock (DynamoDB)
 * 3. Invoke Portfolio Lambda with decision_type "exit_evaluation"
 * 4. Validate exit decision
 * 5. Execute exit order on CLOB if warranted
 * 6. ALWAYS release lock in finally block
 *
 * Requirements: 9.1, 9.2, 9.3, 9.4, 9.5, 9.6, 10.2, 12.5, 12.7
 */

import { LambdaClient, InvokeCommand } from '@aws-sdk/client-lambda';
import {
  EventBridgeClient,
  PutEventsCommand,
} from '@aws-sdk/client-eventbridge';
import {
  DynamoDBClient,
  PutItemCommand,
  DeleteItemCommand,
  GetItemCommand,
} from '@aws-sdk/client-dynamodb';
import { marshall, unmarshall } from '@aws-sdk/util-dynamodb';
import { getConnectionString } from '../shared/db';
import { getClobCredentials, clobCredentialsConfigured } from '../shared/clob-credentials';
import {
  SESSION_QUERIES,
  TRADE_QUERIES,
  CAPITAL_QUERIES,
} from '../shared/portfolio-db';
import type {
  TradeDirection,
  ExitReason,
} from '../shared/portfolio-types';

// ─── Clients (initialized once per Lambda container) ─────────────────────────

const lambdaClient = new LambdaClient({});
const eventBridgeClient = new EventBridgeClient({});
const dynamoClient = new DynamoDBClient({});

// ─── Environment Variables ───────────────────────────────────────────────────

const PORTFOLIO_LAMBDA_ARN = process.env.PORTFOLIO_LAMBDA_ARN || '';
const EVENT_BUS_NAME = process.env.EVENT_BUS_NAME || 'default';
const DEDUP_TABLE = process.env.DEDUP_CACHE_TABLE || '';
const RATE_LIMIT_TABLE = process.env.RATE_LIMIT_TABLE || '';

// ─── Constants ───────────────────────────────────────────────────────────────

const LOCK_TTL_SECONDS = 60;
const MAX_RETRIES = 3;
const RETRY_DELAYS_MS = [1000, 2000, 4000];

// ─── Interfaces ──────────────────────────────────────────────────────────────

interface PositionGuardEvent {
  sessionId: string;
  userId: string;
  marketId: string;
}

interface SessionRow {
  id: string;
  user_id: string;
  market_id: string;
  persona_id: string;
  investment_amount: number;
  status: string;
  position_direction: string | null;
  position_size: number | null;
  position_entry_price: number | null;
  position_entry_at: string | null;
  position_stop_loss_order_id: string | null;
  position_take_profit_order_id: string | null;
  amount_in_positions: number;
  amount_in_pending_orders: number;
  amount_available: number;
}

interface AgentExitDecision {
  action: 'exit' | 'hold' | 'skip';
  direction?: 'YES' | 'NO';
  size_pct: number;
  price?: number | null;
  order_type: 'limit' | 'market';
  reasoning: string;
  conviction: number;
  exit_reason?: string | null;
}

interface ClobOrderResponse {
  orderID: string;
  status?: string;
}

// ─── Main Handler ────────────────────────────────────────────────────────────

export async function handler(event: PositionGuardEvent): Promise<void> {
  const { sessionId, userId, marketId } = event;

  console.log(
    `Position guard invoked for session=${sessionId}, user=${userId}, market=${marketId}`,
  );

  // ── Safety Gate 1: Kill switch check (Requirement 9.1, 9.2, 10.2) ──
  // Kill switch check happens BEFORE acquiring lock to minimize resource contention
  const killSwitchActive = await checkKillSwitch(userId);
  if (killSwitchActive) {
    console.log(`Kill switch active for user=${userId}, rejecting processing.`);
    return;
  }

  // ── Safety Gate 2: Acquire distributed lock (Requirement 9.3) ──
  const lockAcquired = await acquireLock(sessionId);
  if (!lockAcquired) {
    console.log(`Could not acquire lock for session=${sessionId}, skipping this cycle.`);
    return;
  }

  const connectionString = await getConnectionString();
  const pg = await import('pg');
  const client = new pg.Client({ connectionString, ssl: { rejectUnauthorized: false } });

  try {
    await client.connect();

    // Load session and current position from DB
    const sessionResult = await client.query(SESSION_QUERIES.getSessionById, [sessionId]);
    if (sessionResult.rows.length === 0) {
      console.log(`Session ${sessionId} not found, releasing lock.`);
      return;
    }

    const session = mapSessionRow(sessionResult.rows[0]);

    // If no position, nothing to evaluate
    if (!session.position_direction || !session.position_size || !session.position_entry_price) {
      console.log(`Session ${sessionId} has no open position, nothing to monitor.`);
      return;
    }

    // Only monitor active or exiting sessions
    if (session.status !== 'active' && session.status !== 'exiting') {
      console.log(`Session ${sessionId} status is '${session.status}', skipping monitoring.`);
      return;
    }

    // ── Invoke Portfolio Lambda with decision_type "exit_evaluation" (Requirement 9.4) ──
    const portfolioState = {
      session: {
        id: session.id,
        persona_id: session.persona_id,
        investment_amount: session.investment_amount,
        status: session.status,
      },
      positions: [{
        direction: session.position_direction,
        size: session.position_size,
        entry_price: session.position_entry_price,
        entry_at: session.position_entry_at,
      }],
      capital_breakdown: {
        available: session.amount_available,
        invested: session.amount_in_positions,
        pending: session.amount_in_pending_orders,
        total: session.investment_amount,
      },
    };

    const payload = JSON.stringify({
      persona: session.persona_id,
      portfolioState,
      marketData: {
        marketId: marketId,
        currentPrice: 0, // Not available from the scheduler - use get_market_data tool
        edge: 0,
        signalAlignment: 0,
      },
      decisionType: 'exit_evaluation',
      // Note: marketData values are placeholders. The agent MUST use the
      // get_market_data tool to fetch real-time prices before deciding.
    });

    let decision: AgentExitDecision;

    try {
      const response = await lambdaClient.send(
        new InvokeCommand({
          FunctionName: PORTFOLIO_LAMBDA_ARN,
          InvocationType: 'RequestResponse',
          Payload: Buffer.from(payload),
        }),
      );

      // Check for FunctionError (unhandled exception in target Lambda)
      if (response.FunctionError) {
        console.error(
          `Portfolio Lambda invocation returned FunctionError: ${response.FunctionError}`,
        );
        decision = {
          action: 'hold',
          size_pct: 0,
          order_type: 'market',
          reasoning: 'Portfolio Lambda invocation failed - defaulting to hold.',
          conviction: 0,
        };
      } else {
        // Parse the response payload
        const responseBody = response.Payload
          ? new TextDecoder().decode(response.Payload)
          : '';
        decision = parseExitDecision(responseBody);
      }
    } catch (invokeError) {
      console.error('Portfolio Lambda invocation failed:', invokeError);
      decision = {
        action: 'hold',
        size_pct: 0,
        order_type: 'market',
        reasoning: 'Portfolio Lambda invocation failed - defaulting to hold.',
        conviction: 0,
      };
    }

    // ── Re-check kill switch after agent invocation (Requirement 10.2) ──
    // Kill switch may have been activated while agent was reasoning
    const killSwitchAfter = await checkKillSwitch(userId);
    if (killSwitchAfter) {
      console.log(`Kill switch activated during agent invocation for user=${userId}, discarding decision.`);
      return;
    }

    // ── Validate exit decision (Requirement 9.5) ──
    if (decision.action !== 'exit') {
      console.log(
        `Agent decision for session=${sessionId}: action=${decision.action}. ` +
        `Reasoning: ${decision.reasoning.slice(0, 200)}`,
      );
      return;
    }

    // Validate the exit decision
    const validation = validateExitDecision(decision, session);
    if (!validation.valid) {
      console.log(
        `Exit decision rejected for session=${sessionId}: ${validation.reason}. ` +
        `Agent reasoning: ${decision.reasoning.slice(0, 200)}`,
      );
      return;
    }

    // ── Execute exit order on CLOB (Requirement 9.5) ──
    const exitPrice = decision.price ?? undefined;
    const orderType = decision.order_type || 'market';

    // Resolve token ID for the position direction from CLOB API
    const tokenId = await resolveTokenId(session.market_id, session.position_direction as string);

    const exitOrder = await placeClobOrder({
      tokenId,
      side: 'SELL',
      size: session.position_size,
      price: exitPrice ?? 0,
      orderType,
    });

    if (!exitOrder) {
      console.error(`Failed to place exit order for session=${sessionId} after retries.`);
      return;
    }

    // Cancel existing stop-loss and take-profit orders
    await cancelExistingOrders(session);

    // Record exit trade in RDS
    const exitReason = (decision.exit_reason || 'regime_shift') as ExitReason;
    await client.query(TRADE_QUERIES.createTrade, [
      session.id,
      null, // no specific analysis result
      session.position_direction,
      'SELL',
      orderType,
      session.position_size,
      exitPrice ?? 0,
      'pending',
      exitOrder.orderID,
      'exit',
      decision.reasoning.slice(0, 500),
      decision.conviction,
      null,
    ]);

    // Update session: clear position
    await client.query(SESSION_QUERIES.updateSessionPosition, [
      null, null, null, null, null, null, session.id,
    ]);

    // Update capital: move from positions to pending (use USDC value, not share count)
    await client.query(CAPITAL_QUERIES.updateCapitalBreakdown, [
      0, // amount_in_positions → cleared
      session.amount_in_pending_orders + session.amount_in_positions, // pending now includes the USDC value of the exiting position
      session.amount_available,
      session.id,
    ]);

    // Publish exit event
    await publishPositionExitEvent(session, exitReason, exitPrice ?? 0);

    console.log(
      `Exit order placed for session=${sessionId}: orderId=${exitOrder.orderID}, ` +
      `reason=${exitReason}, conviction=${decision.conviction}`,
    );
  } catch (error) {
    console.error(`Position guard failed for session=${sessionId}:`, error);
    throw error;
  } finally {
    // ── ALWAYS release lock (Requirement 9.6) ──
    await releaseLock(sessionId);
    await client.end();
  }
}

// ─── Kill Switch Check ───────────────────────────────────────────────────────

/**
 * Check if the kill switch is active for a user via DynamoDB.
 * Kill switch state is stored in the rate-limits table.
 * Requirement 10.2: Kill switch check happens BEFORE acquiring lock.
 */
async function checkKillSwitch(userId: string): Promise<boolean> {
  try {
    const response = await dynamoClient.send(
      new GetItemCommand({
        TableName: RATE_LIMIT_TABLE,
        Key: marshall({ pk: `kill_switch#${userId}`, sk: 'state' }),
      }),
    );

    if (!response.Item) return false;

    const item = unmarshall(response.Item);
    return item.active === true;
  } catch (error) {
    console.error('Kill switch check failed:', error);
    // Fail-CLOSED: if we can't verify kill switch state, block trading to protect capital
    return true;
  }
}

// ─── Response Parsing ────────────────────────────────────────────────────────

/**
 * Parse the Portfolio Lambda response as an exit decision.
 * Validates that action, size_pct (or sizePct), and reasoning fields are present.
 * Falls back to "hold" with conviction 0 if the response is unparseable or invalid.
 */
function parseExitDecision(responseBody: string): AgentExitDecision {
  try {
    const parsed = JSON.parse(responseBody);

    // Support both camelCase (from Portfolio_Lambda) and snake_case field names
    const action = parsed.action;
    const sizePct = parsed.size_pct ?? parsed.sizePct;
    const reasoning = parsed.reasoning;

    // Validate required fields are present
    if (!action || typeof sizePct !== 'number' || !reasoning) {
      console.warn('Portfolio Lambda decision missing required fields (action, size_pct, reasoning):', Object.keys(parsed));
      return {
        action: 'hold',
        size_pct: 0,
        order_type: 'market',
        reasoning: 'Portfolio Lambda response missing required fields - defaulting to hold.',
        conviction: 0,
      };
    }

    return {
      action: action || 'hold',
      direction: parsed.direction || undefined,
      size_pct: Number(sizePct ?? 1.0),
      price: parsed.price ?? null,
      order_type: parsed.order_type || parsed.orderType || 'market',
      reasoning: reasoning || 'No reasoning provided.',
      conviction: Math.max(0, Math.min(1, Number(parsed.conviction ?? 0.5))),
      exit_reason: parsed.exit_reason || parsed.exitReason || null,
    };
  } catch (parseError) {
    console.warn('Failed to parse Portfolio Lambda exit decision, defaulting to hold:', parseError);
    console.warn('Raw response (first 500 chars):', responseBody.slice(0, 500));

    return {
      action: 'hold',
      size_pct: 0,
      order_type: 'market',
      reasoning: 'Portfolio Lambda response unparseable - defaulting to hold.',
      conviction: 0,
    };
  }
}

// ─── Decision Validation ─────────────────────────────────────────────────────

/**
 * Validate the exit decision before executing.
 * Ensures the exit makes sense given the current position state.
 */
function validateExitDecision(
  decision: AgentExitDecision,
  session: SessionRow,
): { valid: boolean; reason?: string } {
  // Must have a valid exit reason (default to 'regime_shift' if agent output was coerced to null)
  if (!decision.exit_reason) {
    // Don't block the exit - assign a generic reason for auditability
    decision.exit_reason = 'regime_shift';
  }

  // size_pct must be positive
  if (decision.size_pct <= 0) {
    return { valid: false, reason: `Invalid size_pct: ${decision.size_pct}` };
  }

  // size_pct must not exceed 1.0 (100% of position)
  if (decision.size_pct > 1.0) {
    return { valid: false, reason: `size_pct ${decision.size_pct} exceeds 1.0 (100% of position)` };
  }

  // Conviction must be reasonable (agent should be somewhat confident about exit)
  if (decision.conviction < 0.1) {
    return { valid: false, reason: `Conviction ${decision.conviction} too low for exit action.` };
  }

  return { valid: true };
}

// ─── Distributed Lock ────────────────────────────────────────────────────────

/**
 * Acquire a distributed lock for a session using DynamoDB conditional write.
 * Lock has a 60-second TTL to prevent deadlocks from crashed Lambdas.
 * Uses RATE_LIMIT_TABLE with same key pattern as Trade Executor for mutual exclusion.
 */
async function acquireLock(sessionId: string): Promise<boolean> {
  const now = Math.floor(Date.now() / 1000);
  const ttl = now + LOCK_TTL_SECONDS;

  try {
    await dynamoClient.send(
      new PutItemCommand({
        TableName: RATE_LIMIT_TABLE,
        Item: marshall({
          pk: `session_lock#${sessionId}`,
          sk: 'lock',
          lockedBy: 'position-guard',
          lockedAt: new Date().toISOString(),
          ttl,
        }),
        ConditionExpression: 'attribute_not_exists(pk) OR #ttl < :now',
        ExpressionAttributeNames: { '#ttl': 'ttl' },
        ExpressionAttributeValues: marshall({ ':now': now }),
      }),
    );
    return true;
  } catch (error: unknown) {
    if (
      error instanceof Error &&
      error.name === 'ConditionalCheckFailedException'
    ) {
      return false;
    }
    console.error('Lock acquisition error:', error);
    return false;
  }
}

/**
 * Release the distributed lock for a session.
 */
async function releaseLock(sessionId: string): Promise<void> {
  try {
    await dynamoClient.send(
      new DeleteItemCommand({
        TableName: RATE_LIMIT_TABLE,
        Key: marshall({
          pk: `session_lock#${sessionId}`,
          sk: 'lock',
        }),
      }),
    );
  } catch (error) {
    console.error('Lock release error:', error);
    // Non-fatal: TTL will clean up the lock
  }
}

// ─── CLOB API Helpers ────────────────────────────────────────────────────────

interface ClobOrderParams {
  tokenId: string;
  side: 'BUY' | 'SELL';
  size: number;
  price: number;
  orderType: 'limit' | 'market';
}

/**
 * Place an order on the Polymarket CLOB API with retry logic.
 */
async function placeClobOrder(params: ClobOrderParams): Promise<ClobOrderResponse | null> {
  const creds = await getClobCredentials();
  if (!clobCredentialsConfigured(creds)) {
    console.error('CLOB credentials are not configured; refusing to place order.');
    return null;
  }

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      const response = await fetch(`${creds.apiUrl}/order`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'POLY-API-KEY': creds.apiKey,
          'POLY-SECRET': creds.apiSecret,
          'POLY-PASSPHRASE': creds.apiPassphrase,
        },
        body: JSON.stringify({
          tokenID: params.tokenId,
          side: params.side,
          size: params.size,
          price: params.price,
          type: params.orderType,
        }),
        signal: AbortSignal.timeout(10000),
      });

      if (!response.ok) {
        const errorBody = await response.text().catch(() => 'unknown');
        throw new Error(`CLOB API error ${response.status}: ${errorBody}`);
      }

      const data = (await response.json()) as ClobOrderResponse;
      console.log(
        `CLOB order placed: orderId=${data.orderID}, side=${params.side}, ` +
        `size=${params.size}, price=${params.price}, type=${params.orderType}`,
      );
      return data;
    } catch (error) {
      console.error(
        `CLOB order attempt ${attempt + 1}/${MAX_RETRIES + 1} failed:`,
        error,
      );
      if (attempt < MAX_RETRIES) {
        await sleep(RETRY_DELAYS_MS[attempt]);
      }
    }
  }

  return null;
}

/**
 * Cancel an existing order on the Polymarket CLOB API.
 */
async function cancelClobOrder(orderId: string): Promise<boolean> {
  const creds = await getClobCredentials();
  if (!clobCredentialsConfigured(creds)) {
    console.error(`CLOB credentials are not configured; cannot cancel orderId=${orderId}.`);
    return false;
  }

  try {
    const response = await fetch(`${creds.apiUrl}/order/${orderId}`, {
      method: 'DELETE',
      headers: {
        'Content-Type': 'application/json',
        'POLY-API-KEY': creds.apiKey,
        'POLY-SECRET': creds.apiSecret,
        'POLY-PASSPHRASE': creds.apiPassphrase,
      },
      signal: AbortSignal.timeout(10000),
    });

    if (!response.ok) {
      throw new Error(`CLOB cancel error ${response.status}`);
    }

    console.log(`CLOB order cancelled: orderId=${orderId}`);
    return true;
  } catch (error) {
    console.error(`Cancel order failed for orderId=${orderId}:`, error);
    return false;
  }
}

/**
 * Cancel existing stop-loss and take-profit orders for a session.
 */
async function cancelExistingOrders(session: SessionRow): Promise<void> {
  const orderIds = [
    session.position_stop_loss_order_id,
    session.position_take_profit_order_id,
  ].filter(Boolean) as string[];

  for (const orderId of orderIds) {
    await cancelClobOrder(orderId);
  }
}

// ─── EventBridge Notification ────────────────────────────────────────────────

/**
 * Publish a position exit event to EventBridge for downstream notifications.
 */
async function publishPositionExitEvent(
  session: SessionRow,
  exitReason: ExitReason,
  exitPrice: number,
): Promise<void> {
  const entryPrice = session.position_entry_price || 0;
  const positionSize = session.position_size || 0;
  const pnl = (exitPrice - entryPrice) * positionSize;

  const entryAt = session.position_entry_at ? new Date(session.position_entry_at) : new Date();
  const holdDurationMinutes = Math.round(
    (Date.now() - entryAt.getTime()) / (1000 * 60),
  );

  try {
    await eventBridgeClient.send(
      new PutEventsCommand({
        Entries: [
          {
            Source: 'tradewizard.portfolio-manager',
            DetailType: 'portfolio.position.exited',
            EventBusName: EVENT_BUS_NAME,
            Detail: JSON.stringify({
              sessionId: session.id,
              userId: session.user_id,
              marketId: session.market_id,
              exitReason,
              entryPrice,
              exitPrice,
              pnl,
              holdDuration: holdDurationMinutes,
              direction: session.position_direction,
              size: positionSize,
            }),
          },
        ],
      }),
    );
  } catch (error) {
    console.error('Failed to publish position exit event:', error);
    // Non-fatal: exit was executed, notification is best-effort
  }
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Resolve the CLOB token ID for a given market and direction (YES/NO).
 * Fetches from the Polymarket CLOB API and matches by the `outcome` field
 * (never by array index - token order is not guaranteed).
 * Returns empty string on failure.
 */
async function resolveTokenId(marketId: string, direction: string): Promise<string> {
  try {
    const creds = await getClobCredentials();
    const response = await fetch(`${creds.apiUrl}/markets/${marketId}`, {
      headers: {
        'Content-Type': 'application/json',
        'POLY-API-KEY': creds.apiKey,
        'POLY-SECRET': creds.apiSecret,
        'POLY-PASSPHRASE': creds.apiPassphrase,
      },
      signal: AbortSignal.timeout(5000),
    });

    if (!response.ok) {
      console.warn(`Failed to resolve token ID for market=${marketId}: ${response.status}`);
      return '';
    }

    const data = await response.json() as { tokens?: Array<{ token_id: string; outcome: string }> };
    const tokens = data.tokens || [];

    if (tokens.length < 2) {
      console.warn(`Market ${marketId} has fewer than 2 tokens: ${tokens.length}`);
      return '';
    }

    // Match by outcome field - never assume array order
    const targetToken = tokens.find(t => t.outcome?.toLowerCase() === direction.toLowerCase());

    if (!targetToken) {
      console.warn(
        `Market ${marketId} missing ${direction} token. Available outcomes: ${tokens.map(t => t.outcome).join(', ')}`,
      );
      return '';
    }

    return targetToken.token_id || '';
  } catch (error) {
    console.warn(`Token ID resolution failed for market=${marketId}:`, error);
    return '';
  }
}

/**
 * Map a raw database row to a typed SessionRow.
 */
function mapSessionRow(row: Record<string, unknown>): SessionRow {
  return {
    id: row.id as string,
    user_id: row.user_id as string,
    market_id: row.market_id as string,
    persona_id: row.persona_id as string,
    investment_amount: Number(row.investment_amount),
    status: row.status as string,
    position_direction: (row.position_direction as string) || null,
    position_size: row.position_size != null ? Number(row.position_size) : null,
    position_entry_price: row.position_entry_price != null ? Number(row.position_entry_price) : null,
    position_entry_at: (row.position_entry_at as string) || null,
    position_stop_loss_order_id: (row.position_stop_loss_order_id as string) || null,
    position_take_profit_order_id: (row.position_take_profit_order_id as string) || null,
    amount_in_positions: Number(row.amount_in_positions || 0),
    amount_in_pending_orders: Number(row.amount_in_pending_orders || 0),
    amount_available: Number(row.amount_available || 0),
  };
}

/**
 * Sleep for a given number of milliseconds.
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
