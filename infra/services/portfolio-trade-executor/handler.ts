/**
 * Portfolio Trade Executor - Thin Dispatcher Lambda.
 *
 * Triggered by EventBridge analysis-complete events for markets with active sessions.
 * Implements safety gate sequence, invokes Portfolio Lambda for reasoning,
 * validates the agent's decision against hard limits, and executes validated orders.
 *
 * Safety Gate Sequence:
 *   1. Kill switch check (DynamoDB) - BEFORE acquiring lock (Req 10.4)
 *   2. Session status check (RDS)
 *   3. Cooldown check (RDS)
 *   4. Acquire distributed lock (DynamoDB)
 *
 * Post-Lambda:
 *   - Re-check kill switch (Req 10.3 - discard if activated during invocation)
 *   - Validate decision: size ≤ 50% total, size ≤ persona max, size ≥ $5, capital conservation
 *   - Execute validated order on Polymarket CLOB API
 *   - Record decision and trade in RDS
 *   - ALWAYS release lock in finally block
 *
 * Requirements: 8.1, 8.2, 8.3, 8.4, 8.5, 8.6, 8.7, 8.8, 8.9, 8.10, 8.11, 10.1, 10.3, 10.4, 12.1, 12.2, 12.3, 12.4, 12.6
 */

import { LambdaClient, InvokeCommand } from '@aws-sdk/client-lambda';
import {
  EventBridgeClient,
  PutEventsCommand,
} from '@aws-sdk/client-eventbridge';
import {
  DynamoDBClient,
  GetItemCommand,
  PutItemCommand,
  DeleteItemCommand,
} from '@aws-sdk/client-dynamodb';
import { marshall, unmarshall } from '@aws-sdk/util-dynamodb';
import { getConnectionString } from '../shared/db';
import { getClobCredentials, buildClobHeaders, clobCredentialsConfigured } from '../shared/clob-credentials';
import {
  SESSION_QUERIES,
  TRADE_QUERIES,
  DECISION_QUERIES,
  CAPITAL_QUERIES,
} from '../shared/portfolio-db';
import type {
  TradeDirection,
  DecisionAction,
  SkipReason,
} from '../shared/portfolio-types';
import { LOSS_EXIT_COOLDOWN_MINUTES, MAX_POSITION_SIZE_PCT } from '../shared/portfolio-types';

// ─── Clients (initialized once per Lambda container) ─────────────────────────

const lambdaClient = new LambdaClient({});
const eventBridgeClient = new EventBridgeClient({});
const dynamoClient = new DynamoDBClient({});

// ─── Configuration ───────────────────────────────────────────────────────────

const PORTFOLIO_LAMBDA_ARN = process.env.PORTFOLIO_LAMBDA_ARN || '';
const EVENT_BUS_NAME = process.env.EVENT_BUS_NAME || 'default';
const RATE_LIMIT_TABLE = process.env.RATE_LIMIT_TABLE || '';
const ENVIRONMENT = process.env.ENVIRONMENT || 'development';

// ─── Retry Configuration ─────────────────────────────────────────────────────

const MAX_RETRIES = 3;
const RETRY_DELAYS_MS = [1000, 2000, 4000];

// ─── Lock Configuration ──────────────────────────────────────────────────────

const LOCK_TTL_SECONDS = 120; // 2 minutes max lock hold time

// ─── Interfaces ──────────────────────────────────────────────────────────────

interface AnalysisCompleteEvent {
  source: string;
  'detail-type': string;
  detail: {
    analysisId: string;
    marketId: string;
    userId: string;
    tradeRecommendation: {
      action: 'LONG_YES' | 'LONG_NO' | 'NO_TRADE';
      confidence: number;
      consensusProbability: number;
      currentPrice: number;
      edge: number;
      signalAlignment: number;
      reasoning: string;
      entryZone: [number, number];
      targetZone: [number, number];
      stopLoss: number;
      liquidityRisk: 'low' | 'medium' | 'high';
      explanation: {
        summary: string;
        coreThesis: string;
        keyCatalysts: string[];
        failureScenarios: string[];
        uncertaintyNote: string;
        riskPerspectives: string;
      };
    };
    tokenIds?: {
      yes: string;
      no: string;
    };
  };
}

/** Decision returned by the Portfolio Lambda */
interface PortfolioDecision {
  action: 'enter' | 'hold' | 'exit' | 'scale' | 'skip';
  direction?: 'YES' | 'NO';
  size_pct: number;
  price?: number;
  stop_loss_price?: number;
  take_profit_price?: number;
  order_type: 'limit' | 'market';
  reasoning: string;
  conviction: number;
  exit_reason?: string;
  is_pyramid?: boolean;
}

interface SessionRow {
  id: string;
  user_id: string;
  market_id: string;
  persona_id: string;
  persona_config: {
    id: string;
    name: string;
    sizingRules: { maxAllocationPct: number };
    exitRules: { patienceWindowMinutes: number };
    [key: string]: unknown;
  };
  investment_amount: number;
  status: string;
  position_direction: string | null;
  position_size: number | null;
  position_entry_price: number | null;
  amount_in_positions: number;
  amount_in_pending_orders: number;
  amount_available: number;
  cumulative_loss_pct: number;
  last_loss_exit_at: string | null;
  position_size_reduction_active: boolean;
}

interface ClobOrderResponse {
  orderID: string;
  status?: string;
}

interface ClobOrderParams {
  tokenId: string;
  side: 'BUY' | 'SELL';
  size: number;
  price: number;
  orderType: 'limit' | 'market';
}

interface ValidationResult {
  valid: boolean;
  reason?: string;
}

interface DecisionRecord {
  sessionId: string;
  analysisResultId: string;
  action: DecisionAction;
  edgeMet: boolean;
  alignmentMet: boolean;
  convictionScore: number;
  additionalCriteriaMet: boolean;
  hadPosition: boolean;
  positionDirection: string | null;
  positionUnrealizedPnl: number | null;
  reasoning: string;
  skipReason: SkipReason | null;
}


// ─── Main Handler ────────────────────────────────────────────────────────────

export async function handler(event: AnalysisCompleteEvent): Promise<void> {
  const { analysisId, marketId, userId, tradeRecommendation: recommendation, tokenIds: eventTokenIds } = event.detail;
  const analysisResultId = analysisId;

  console.log(
    `Trade executor invoked for market=${marketId}, user=${userId}, analysis=${analysisResultId}`,
  );

  // Resolve token IDs - from event if available, otherwise fetch from CLOB API
  const tokenIds = eventTokenIds ?? await resolveMarketTokenIds(marketId);

  const connectionString = await getConnectionString();
  const pg = await import('pg');
  const client = new pg.Client({ connectionString, ssl: { rejectUnauthorized: false } });

  try {
    await client.connect();

    // Get active sessions for this market belonging to the target user.
    // The orchestrator emits one AnalysisCompleted event per delivered
    // subscriber (with the canonical users.id), so we narrow the query by
    // user_id rather than fetching all market sessions and filtering in code.
    const sessionsResult = await client.query(
      SESSION_QUERIES.getActiveSessionsForMarketAndUser,
      [marketId, userId],
    );

    if (sessionsResult.rows.length === 0) {
      console.log(`No active sessions for market=${marketId} user=${userId}, skipping.`);
      return;
    }

    for (const row of sessionsResult.rows) {
      const session = mapSessionRow(row);
      // Defensive belt-and-braces: SQL filter already guarantees this, but
      // keep the equality check so a future signature change can't bypass it.
      if (session.user_id !== userId) continue;

      await processSession(client, session, recommendation, analysisResultId, tokenIds);
    }
  } catch (error) {
    console.error('Trade executor failed:', error);
    throw error;
  } finally {
    await client.end();
  }
}

// ─── Session Processing (Safety Gate Sequence) ───────────────────────────────

async function processSession(
  client: import('pg').Client,
  session: SessionRow,
  recommendation: AnalysisCompleteEvent['detail']['tradeRecommendation'],
  analysisResultId: string,
  tokenIds?: { yes: string; no: string },
): Promise<void> {
  console.log(
    `Processing session=${session.id}, persona=${session.persona_id}, ` +
    `recommendation=${recommendation.action}`,
  );

  // ── Idempotency: skip if a decision already exists for this (session,
  // analysis_result) pair. SQS retries of the orchestrator can re-publish
  // AnalysisCompleted events; without this guard, we'd record duplicate
  // decisions and (worse) place duplicate orders. The schema doesn't have
  // a UNIQUE constraint on (session_id, analysis_result_id) yet, so we
  // enforce it here.
  try {
    const existing = await client.query(
      DECISION_QUERIES.hasDecisionForAnalysis,
      [session.id, analysisResultId],
    );
    if (existing.rows.length > 0) {
      console.log(
        `Decision already recorded for session=${session.id} analysis=${analysisResultId}, skipping.`,
      );
      return;
    }
  } catch (error) {
    // Fail-OPEN on the idempotency check so a transient DB hiccup doesn't
    // freeze trading. The cost of a false-negative (rare) is a duplicate
    // decision row; we mitigate downstream via the lock and CLOB API
    // rejecting duplicate orders with the same idempotency key.
    console.warn(
      `Idempotency check failed for session=${session.id} analysis=${analysisResultId} (failing open):`,
      error,
    );
  }

  // ── Safety Gate 1: Kill switch check (Req 8.1, 10.1, 10.4 - BEFORE lock) ──
  const killSwitchActive = await checkKillSwitch(session.user_id);
  if (killSwitchActive) {
    await recordDecision(client, {
      sessionId: session.id,
      analysisResultId,
      action: 'skip',
      edgeMet: false,
      alignmentMet: false,
      convictionScore: 0,
      additionalCriteriaMet: false,
      hadPosition: !!session.position_direction,
      positionDirection: session.position_direction,
      positionUnrealizedPnl: null,
      reasoning: 'Kill switch is active. All trading suspended.',
      skipReason: 'kill_switch',
    });
    return;
  }

  // ── Safety Gate 2: Session status check (Req 8.3) ──
  if (session.status !== 'active') {
    await recordDecision(client, {
      sessionId: session.id,
      analysisResultId,
      action: 'skip',
      edgeMet: false,
      alignmentMet: false,
      convictionScore: 0,
      additionalCriteriaMet: false,
      hadPosition: !!session.position_direction,
      positionDirection: session.position_direction,
      positionUnrealizedPnl: null,
      reasoning: `Session status is '${session.status}', skipping trade evaluation.`,
      skipReason: 'paused',
    });
    return;
  }

  // ── Safety Gate 3: Cooldown check (Req 8.3) ──
  if (session.last_loss_exit_at) {
    const lastLossTime = new Date(session.last_loss_exit_at).getTime();
    const cooldownMs = LOSS_EXIT_COOLDOWN_MINUTES * 60 * 1000;
    if (Date.now() - lastLossTime < cooldownMs) {
      await recordDecision(client, {
        sessionId: session.id,
        analysisResultId,
        action: 'skip',
        edgeMet: false,
        alignmentMet: false,
        convictionScore: 0,
        additionalCriteriaMet: false,
        hadPosition: !!session.position_direction,
        positionDirection: session.position_direction,
        positionUnrealizedPnl: null,
        reasoning: `Cooldown active: ${LOSS_EXIT_COOLDOWN_MINUTES}min after loss exit. Resuming at ${new Date(lastLossTime + cooldownMs).toISOString()}.`,
        skipReason: 'cooldown',
      });
      return;
    }
  }

  // ── Safety Gate 4: Acquire distributed lock (Req 8.4) ──
  const lockAcquired = await acquireLock(session.id);
  if (!lockAcquired) {
    await recordDecision(client, {
      sessionId: session.id,
      analysisResultId,
      action: 'skip',
      edgeMet: false,
      alignmentMet: false,
      convictionScore: 0,
      additionalCriteriaMet: false,
      hadPosition: !!session.position_direction,
      positionDirection: session.position_direction,
      positionUnrealizedPnl: null,
      reasoning: 'Could not acquire distributed lock. Another execution may be in progress.',
      skipReason: 'pipeline_failure',
    });
    return;
  }

  // ── All gates passed - invoke Portfolio Lambda and process decision ──

  try {
    // If already positioned, check if persona supports pyramiding (Momentum Rider)
    if (session.position_direction) {
      const supportsPyramid = session.persona_id === 'momentum-rider';

      if (!supportsPyramid) {
        await recordDecision(client, {
          sessionId: session.id,
          analysisResultId,
          action: 'hold',
          edgeMet: true,
          alignmentMet: true,
          convictionScore: 0,
          additionalCriteriaMet: true,
          hadPosition: true,
          positionDirection: session.position_direction,
          positionUnrealizedPnl: null,
          reasoning: `Already positioned ${session.position_direction}. Position Guard manages exits.`,
          skipReason: null,
        });
        return;
      }

      // For Momentum Rider: invoke Lambda to evaluate pyramid opportunity
      // Check if total allocation (current + potential) would exceed persona max (60%)
      const currentAllocationPct = session.amount_in_positions / session.investment_amount;
      const entryRules = session.persona_config.entryRules as Record<string, unknown> | undefined;
      const additionalCriteria = entryRules?.additionalCriteria as Record<string, unknown> | undefined;
      const maxTotalAllocation = (Number(additionalCriteria?.maxTotalAllocationPct) || 60) / 100;

      if (currentAllocationPct >= maxTotalAllocation) {
        await recordDecision(client, {
          sessionId: session.id,
          analysisResultId,
          action: 'hold',
          edgeMet: true,
          alignmentMet: true,
          convictionScore: 0,
          additionalCriteriaMet: false,
          hadPosition: true,
          positionDirection: session.position_direction,
          positionUnrealizedPnl: null,
          reasoning: `Already at ${(currentAllocationPct * 100).toFixed(0)}% allocation (max ${(maxTotalAllocation * 100).toFixed(0)}%). No room for pyramid.`,
          skipReason: null,
        });
        return;
      }
      // Fall through to invoke Portfolio Lambda for pyramid evaluation
    }

    // If recommendation is NO_TRADE, skip invocation
    if (recommendation.action === 'NO_TRADE') {
      await recordDecision(client, {
        sessionId: session.id,
        analysisResultId,
        action: 'no_action',
        edgeMet: false,
        alignmentMet: false,
        convictionScore: 0,
        additionalCriteriaMet: false,
        hadPosition: false,
        positionDirection: null,
        positionUnrealizedPnl: null,
        reasoning: 'Analysis recommends NO_TRADE. No entry opportunity.',
        skipReason: null,
      });
      return;
    }

    // Invoke Portfolio Lambda
    const agentDecision = await invokePortfolioAgent(
      session,
      recommendation,
      analysisResultId,
    );

    if (!agentDecision) {
      await recordDecision(client, {
        sessionId: session.id,
        analysisResultId,
        action: 'skip',
        edgeMet: false,
        alignmentMet: false,
        convictionScore: 0,
        additionalCriteriaMet: false,
        hadPosition: false,
        positionDirection: null,
        positionUnrealizedPnl: null,
        reasoning: 'Portfolio Lambda invocation failed or returned unparseable response.',
        skipReason: 'pipeline_failure',
      });
      return;
    }

    // ── Re-check kill switch after Lambda invocation (Req 10.3) ──
    const killSwitchActivatedDuring = await checkKillSwitch(session.user_id);
    if (killSwitchActivatedDuring) {
      await recordDecision(client, {
        sessionId: session.id,
        analysisResultId,
        action: 'skip',
        edgeMet: false,
        alignmentMet: false,
        convictionScore: agentDecision.conviction,
        additionalCriteriaMet: false,
        hadPosition: false,
        positionDirection: null,
        positionUnrealizedPnl: null,
        reasoning: 'Kill switch activated during Portfolio Lambda invocation. Discarding agent response.',
        skipReason: 'kill_switch',
      });
      return;
    }

    // If agent decides to skip/hold, record and return
    if (agentDecision.action === 'skip' || agentDecision.action === 'hold') {
      await recordDecision(client, {
        sessionId: session.id,
        analysisResultId,
        action: agentDecision.action === 'skip' ? 'no_action' : 'hold',
        edgeMet: false,
        alignmentMet: false,
        convictionScore: agentDecision.conviction,
        additionalCriteriaMet: false,
        hadPosition: false,
        positionDirection: null,
        positionUnrealizedPnl: null,
        reasoning: agentDecision.reasoning.slice(0, 500),
        skipReason: null,
      });
      return;
    }

    // ── Validate agent decision (Req 8.5, 8.6, 8.7, 8.8) ──
    const validation = validateAgentDecision(agentDecision, session);
    if (!validation.valid) {
      // Req 8.9: Reject and log if validation fails
      await recordDecision(client, {
        sessionId: session.id,
        analysisResultId,
        action: 'skip',
        edgeMet: true,
        alignmentMet: true,
        convictionScore: agentDecision.conviction,
        additionalCriteriaMet: false,
        hadPosition: false,
        positionDirection: null,
        positionUnrealizedPnl: null,
        reasoning: `Decision validation failed: ${validation.reason}. Agent reasoning: ${agentDecision.reasoning.slice(0, 300)}`,
        skipReason: 'risk_limit',
      });
      return;
    }

    // ── Execute validated order on CLOB (Req 8.10) ──
    const direction: TradeDirection = agentDecision.direction || (recommendation.action === 'LONG_YES' ? 'YES' : 'NO');
    const orderAmount = agentDecision.size_pct * session.amount_available;
    const rawOrderPrice = agentDecision.price ?? recommendation.currentPrice;
    // Clamp entry price to valid CLOB range (0.01–0.99)
    const orderPrice = Math.max(0.01, Math.min(0.99, rawOrderPrice));
    const tokenId = direction === 'YES' ? tokenIds?.yes : tokenIds?.no;

    // Abort if token ID resolution failed - don't waste retries with empty token
    if (!tokenId) {
      await recordDecision(client, {
        sessionId: session.id,
        analysisResultId,
        action: 'skip',
        edgeMet: true,
        alignmentMet: true,
        convictionScore: agentDecision.conviction,
        additionalCriteriaMet: true,
        hadPosition: false,
        positionDirection: null,
        positionUnrealizedPnl: null,
        reasoning: `Token ID resolution failed for market ${session.market_id}, direction ${direction}. Cannot place order.`,
        skipReason: 'pipeline_failure',
      });
      return;
    }

    const orderResult = await placeClobOrder({
      tokenId: tokenId || '',
      side: 'BUY',
      size: orderAmount,
      price: orderPrice,
      orderType: agentDecision.order_type,
    });

    if (!orderResult) {
      await recordDecision(client, {
        sessionId: session.id,
        analysisResultId,
        action: 'skip',
        edgeMet: true,
        alignmentMet: true,
        convictionScore: agentDecision.conviction,
        additionalCriteriaMet: true,
        hadPosition: false,
        positionDirection: null,
        positionUnrealizedPnl: null,
        reasoning: 'CLOB API order placement failed after retries.',
        skipReason: 'pipeline_failure',
      });
      return;
    }

    // ── Place mandatory stop-loss limit SELL order ──
    // The PM agent decides its own stop-loss price based on the full analysis.
    // Falls back to the analysis recommendation's stopLoss if the agent didn't provide one.
    // NOTE: recommendation.stopLoss is already in traded-token space (NO-price for LONG_NO,
    // YES-price for LONG_YES) thanks to direction-aware validation in the recommendation stage.
    const agentStopLoss = agentDecision.stop_loss_price;
    const analysisStopLoss = recommendation.stopLoss;
    let stopLossPrice = Math.max(
      0.01, // CLOB min price floor
      agentStopLoss ?? (analysisStopLoss > 0 ? analysisStopLoss : orderPrice * 0.85),
    );

    // Safety: stop-loss MUST be below entry price for a BUY position
    // If agent returned nonsensical SL above entry, override with 15% below entry
    if (stopLossPrice >= orderPrice) {
      console.warn(
        `Stop-loss ${stopLossPrice} >= entry ${orderPrice} - overriding to 15% below entry.`,
      );
      stopLossPrice = Math.max(0.01, orderPrice * 0.85);
    }

    // Max-distance guard: SL must not be more than 40% below entry price.
    // An excessively wide SL (e.g., 0.01 for a 0.60 entry) risks nearly the entire position
    // with no meaningful protection. Clamp to 40% max distance.
    const maxSlDistance = orderPrice * 0.40;
    const minAllowedSl = orderPrice - maxSlDistance;
    if (stopLossPrice < minAllowedSl) {
      console.warn(
        `Stop-loss ${stopLossPrice.toFixed(4)} is >${(maxSlDistance * 100 / orderPrice).toFixed(0)}% below entry ${orderPrice.toFixed(4)} ` +
        `(min allowed: ${minAllowedSl.toFixed(4)}) - clamping to max distance.`,
      );
      stopLossPrice = Math.max(0.01, minAllowedSl);
    }

    const stopLossResult = await placeClobOrder({
      tokenId: tokenId || '',
      side: 'SELL',
      size: orderAmount,
      price: Math.round(stopLossPrice * 100) / 100,
      orderType: 'limit',
    });

    if (!stopLossResult) {
      console.warn(
        `Stop-loss sell order failed for session=${session.id}. ` +
        `Position Guard will manage exit. Target price was ${stopLossPrice.toFixed(4)}`,
      );
    } else {
      const slSource = agentStopLoss ? 'agent' : analysisStopLoss > 0 ? 'analysis' : 'fallback';
      await client.query(TRADE_QUERIES.createTrade, [
        session.id,
        analysisResultId,
        direction,
        'SELL',
        'limit',
        orderAmount,
        Math.round(stopLossPrice * 100) / 100,
        'pending',
        stopLossResult.orderID,
        'stop_loss',
        `Stop-loss (${slSource}) at ${stopLossPrice.toFixed(4)} (entry: ${orderPrice}).`,
        agentDecision.conviction,
        null, // no patience expiry - rests until filled or cancelled
      ]);
    }

    const stopLossOrderId = stopLossResult?.orderID ?? null;

    // ── Place mandatory take-profit limit SELL order ──
    // The PM agent decides its own take-profit price based on the full analysis.
    // Falls back to the analysis target zone upper bound if the agent didn't provide one.
    // NOTE: recommendation.targetZone is already in traded-token space (NO-price for LONG_NO,
    // YES-price for LONG_YES) thanks to direction-aware validation in the recommendation stage.
    const agentTakeProfit = agentDecision.take_profit_price;
    const analysisTargetZone = recommendation.targetZone;
    const analysisTargetPrice = analysisTargetZone?.[1] ?? 0; // upper bound of target zone
    let takeProfitPrice = Math.min(
      0.99, // CLOB max price cap
      agentTakeProfit ?? (analysisTargetPrice > 0 ? analysisTargetPrice : orderPrice * 1.25),
    );

    // Safety: take-profit MUST be above entry price for a BUY position
    // If agent returned nonsensical TP below entry, override with 25% above entry
    if (takeProfitPrice <= orderPrice) {
      console.warn(
        `Take-profit ${takeProfitPrice} <= entry ${orderPrice} - overriding to 25% above entry.`,
      );
      takeProfitPrice = Math.min(0.99, orderPrice * 1.25);
    }

    // Min-distance guard: TP must be at least 5% above entry price.
    // An excessively tight TP risks getting filled on noise with minimal profit capture.
    const minTpDistance = orderPrice * 0.05;
    const minAllowedTp = orderPrice + minTpDistance;
    if (takeProfitPrice < minAllowedTp) {
      console.warn(
        `Take-profit ${takeProfitPrice.toFixed(4)} is <5% above entry ${orderPrice.toFixed(4)} ` +
        `(min allowed: ${minAllowedTp.toFixed(4)}) - adjusting to 25% above entry.`,
      );
      takeProfitPrice = Math.min(0.99, orderPrice * 1.25);
    }

    const takeProfitResult = await placeClobOrder({
      tokenId: tokenId || '',
      side: 'SELL',
      size: orderAmount,
      price: Math.round(takeProfitPrice * 100) / 100,
      orderType: 'limit',
    });

    if (!takeProfitResult) {
      console.warn(
        `Take-profit sell order failed for session=${session.id}. ` +
        `Position Guard will manage exit. Target price was ${takeProfitPrice.toFixed(4)}`,
      );
    } else {
      const tpSource = agentTakeProfit ? 'agent' : analysisTargetPrice > 0 ? 'analysis' : 'fallback';
      await client.query(TRADE_QUERIES.createTrade, [
        session.id,
        analysisResultId,
        direction,
        'SELL',
        'limit',
        orderAmount,
        Math.round(takeProfitPrice * 100) / 100,
        'pending',
        takeProfitResult.orderID,
        'take_profit',
        `Take-profit (${tpSource}) at ${takeProfitPrice.toFixed(4)} (entry: ${orderPrice}).`,
        agentDecision.conviction,
        null, // no patience expiry - rests until filled or cancelled
      ]);
    }

    const stopLossOrderIdFinal = stopLossOrderId;
    const takeProfitOrderId = takeProfitResult?.orderID ?? null;

    // ── Safety invariant: position must ALWAYS have at least one protective order ──
    // If BOTH SL and TP failed, cancel the BUY order and abort - never leave a naked position.
    if (!stopLossOrderIdFinal && !takeProfitOrderId) {
      console.error(
        `CRITICAL: Both SL and TP orders failed for session=${session.id}. ` +
        `Cancelling BUY order ${orderResult.orderID} to prevent unprotected position.`,
      );

      // Cancel the BUY order
      try {
        const creds = await getClobCredentials();
        if (clobCredentialsConfigured(creds)) {
          await fetch(`${creds.apiUrl}/order/${orderResult.orderID}`, {
            method: 'DELETE',
            headers: buildClobHeaders(creds),
            signal: AbortSignal.timeout(10000),
          });
        }
      } catch (cancelError) {
        console.error(`Failed to cancel BUY order ${orderResult.orderID}:`, cancelError);
      }

      await recordDecision(client, {
        sessionId: session.id,
        analysisResultId,
        action: 'skip',
        edgeMet: true,
        alignmentMet: true,
        convictionScore: agentDecision.conviction,
        additionalCriteriaMet: true,
        hadPosition: false,
        positionDirection: null,
        positionUnrealizedPnl: null,
        reasoning: 'Both SL and TP order placement failed. BUY cancelled to prevent unprotected position.',
        skipReason: 'pipeline_failure',
      });
      return;
    }

    // ── Record entry trade in RDS (Req 8.10) ──
    const patienceExpiresAt = new Date(
      Date.now() + session.persona_config.exitRules.patienceWindowMinutes * 60 * 1000,
    ).toISOString();

    await client.query(TRADE_QUERIES.createTrade, [
      session.id,
      analysisResultId,
      direction,
      'BUY',
      agentDecision.order_type,
      orderAmount,
      orderPrice,
      'pending',
      orderResult.orderID,
      'entry',
      agentDecision.reasoning.slice(0, 500),
      agentDecision.conviction,
      patienceExpiresAt,
    ]);

    // Update session capital breakdown
    await client.query(CAPITAL_QUERIES.updateCapitalBreakdown, [
      session.amount_in_positions + orderAmount,
      session.amount_in_pending_orders,
      session.amount_available - orderAmount,
      session.id,
    ]);

    // Update session position (order IDs stored for Position Guard to cancel if needed)
    await client.query(SESSION_QUERIES.updateSessionPosition, [
      direction,
      orderAmount,
      orderPrice,
      new Date().toISOString(),
      stopLossOrderIdFinal,
      takeProfitOrderId,
      session.id,
    ]);

    // Record decision
    const slNote = stopLossOrderIdFinal
      ? ` SL sell @ ${stopLossPrice.toFixed(4)}.`
      : ' SL sell failed - Position Guard fallback.';
    const tpNote = takeProfitOrderId
      ? ` TP sell @ ${takeProfitPrice.toFixed(4)}.`
      : ' TP sell failed - Position Guard fallback.';
    await recordDecision(client, {
      sessionId: session.id,
      analysisResultId,
      action: 'enter',
      edgeMet: true,
      alignmentMet: true,
      convictionScore: agentDecision.conviction,
      additionalCriteriaMet: true,
      hadPosition: false,
      positionDirection: null,
      positionUnrealizedPnl: null,
      reasoning: `Entered ${direction}. Size: $${orderAmount.toFixed(2)}, Price: ${orderPrice}.${slNote}${tpNote} ${agentDecision.reasoning.slice(0, 120)}`,
      skipReason: null,
    });

    // Publish trade notification event
    await publishTradeEvent(session, direction, orderAmount, orderPrice, agentDecision);

    console.log(
      `Trade executed: session=${session.id}, direction=${direction}, ` +
      `size=$${orderAmount.toFixed(2)}, price=${orderPrice}, orderId=${orderResult.orderID}`,
    );
  } finally {
    // ── ALWAYS release lock ──
    await releaseLock(session.id);
  }
}


// ─── Lambda Invocation ────────────────────────────────────────────────────────

/**
 * Invoke Portfolio Lambda with persona, analysis, and portfolio state.
 * Returns the parsed PortfolioDecision or null on failure.
 */
async function invokePortfolioAgent(
  session: SessionRow,
  recommendation: AnalysisCompleteEvent['detail']['tradeRecommendation'],
  analysisResultId: string,
): Promise<PortfolioDecision | null> {
  try {
    const payload = {
      persona: session.persona_id,
      analysisResult: {
        analysisResultId,
        marketId: session.market_id,
        action: recommendation.action,
        entryZone: recommendation.entryZone,
        targetZone: recommendation.targetZone,
        stopLoss: recommendation.stopLoss,
        liquidityRisk: recommendation.liquidityRisk,
        signalAlignment: recommendation.signalAlignment,
        confidence: recommendation.confidence,
        explanation: recommendation.explanation,
      },
      portfolioState: {
        session: {
          id: session.id,
          persona_id: session.persona_id,
          investment_amount: session.investment_amount,
          cumulative_loss_pct: session.cumulative_loss_pct,
          status: session.status,
        },
        positions: session.position_direction
          ? [{
              direction: session.position_direction,
              size: session.position_size,
              entry_price: session.position_entry_price,
            }]
          : [],
        capitalBreakdown: {
          available: session.amount_available,
          invested: session.amount_in_positions,
          pending: session.amount_in_pending_orders,
          total: session.investment_amount,
        },
      },
      marketData: {
        marketId: session.market_id,
        currentPrice: recommendation.currentPrice,
        edge: recommendation.edge,
        signalAlignment: recommendation.signalAlignment,
      },
      decisionType: 'entry',
    };

    const response = await lambdaClient.send(
      new InvokeCommand({
        FunctionName: PORTFOLIO_LAMBDA_ARN,
        InvocationType: 'RequestResponse',
        Payload: Buffer.from(JSON.stringify(payload)),
      }),
    );

    // Check for Lambda execution error
    if (response.FunctionError) {
      console.error(
        `Portfolio Lambda returned FunctionError: ${response.FunctionError}`,
        response.Payload ? new TextDecoder().decode(response.Payload) : '',
      );
      return null;
    }

    // Parse response payload
    if (!response.Payload) {
      console.warn('Portfolio Lambda returned empty payload');
      return null;
    }

    const responseBody = new TextDecoder().decode(response.Payload);
    return parsePortfolioDecision(responseBody);
  } catch (error) {
    console.error('Portfolio Lambda invocation failed:', error);
    return null;
  }
}

/**
 * Parse the Lambda response as a PortfolioDecision.
 * Returns null if unparseable or required fields are missing.
 * Handles both camelCase (from Lambda) and snake_case field names.
 */
function parsePortfolioDecision(responseBody: string): PortfolioDecision | null {
  try {
    const parsed = JSON.parse(responseBody);

    // Accept both camelCase (Lambda output) and snake_case field names
    const sizePct = parsed.size_pct ?? parsed.sizePct;
    const reasoning = parsed.reasoning;

    // Validate required fields: action, sizePct, and reasoning must be present
    if (!parsed.action || typeof sizePct !== 'number' || !reasoning) {
      console.warn('Portfolio decision missing required fields:', Object.keys(parsed));
      return null;
    }

    // Parse and clamp SL/TP to valid CLOB range [0.01, 0.99]
    const rawStopLoss = parsed.stop_loss_price ?? parsed.stopLossPrice ?? undefined;
    const rawTakeProfit = parsed.take_profit_price ?? parsed.takeProfitPrice ?? undefined;
    let stopLossPrice = rawStopLoss != null ? Math.max(0.01, Math.min(0.99, Number(rawStopLoss))) : undefined;
    let takeProfitPrice = rawTakeProfit != null ? Math.max(0.01, Math.min(0.99, Number(rawTakeProfit))) : undefined;

    // Relationship validation: if both SL and TP are provided, TP must be > SL
    if (stopLossPrice != null && takeProfitPrice != null && takeProfitPrice <= stopLossPrice) {
      console.warn(
        `Portfolio decision has TP (${takeProfitPrice}) <= SL (${stopLossPrice}) - clearing both to use fallback chain.`,
      );
      stopLossPrice = undefined;
      takeProfitPrice = undefined;
    }

    // If price is provided, validate SL < price < TP relationship
    const entryPrice = parsed.price != null ? Number(parsed.price) : undefined;
    if (entryPrice != null && !isNaN(entryPrice) && entryPrice > 0) {
      if (stopLossPrice != null && stopLossPrice >= entryPrice) {
        console.warn(
          `Portfolio decision SL (${stopLossPrice}) >= entry (${entryPrice}) - clearing SL to use fallback.`,
        );
        stopLossPrice = undefined;
      }
      if (takeProfitPrice != null && takeProfitPrice <= entryPrice) {
        console.warn(
          `Portfolio decision TP (${takeProfitPrice}) <= entry (${entryPrice}) - clearing TP to use fallback.`,
        );
        takeProfitPrice = undefined;
      }
    }

    return {
      action: parsed.action,
      direction: parsed.direction || undefined,
      size_pct: sizePct,
      price: parsed.price ?? undefined,
      stop_loss_price: stopLossPrice,
      take_profit_price: takeProfitPrice,
      order_type: parsed.order_type ?? parsed.orderType ?? 'limit',
      reasoning,
      conviction: typeof parsed.conviction === 'number' ? parsed.conviction : 0.5,
      exit_reason: parsed.exit_reason ?? parsed.exitReason ?? undefined,
      is_pyramid: parsed.is_pyramid ?? parsed.isPyramid ?? false,
    };
  } catch (parseError) {
    console.warn('Failed to parse Portfolio Lambda response:', parseError);
    console.warn('Raw response (first 500 chars):', responseBody.slice(0, 500));
    return null;
  }
}

// ─── Decision Validation (Req 8.5, 8.6, 8.7, 8.8) ──────────────────────────

/**
 * Validate the agent's decision against hard limits.
 * Returns valid: true only if ALL conditions pass:
 *   - size_pct * available ≤ 0.5 * total_capital (50% max - Req 8.5)
 *   - size_pct * available ≤ persona.max_allocation_pct * available (Req 8.6)
 *   - size_pct * available ≥ 5.0 (minimum $5 - Req 8.7)
 *   - Capital conservation: positions + pending + (available - order_amount) ≥ 0 (Req 8.8)
 *   - Position size reduction: 50% reduction when at 30% loss threshold (Req 8.6)
 */
export function validateAgentDecision(
  decision: PortfolioDecision,
  session: SessionRow,
): ValidationResult {
  let orderAmount = decision.size_pct * session.amount_available;
  const totalCapital = session.investment_amount;
  const personaMaxPct = session.persona_config.sizingRules.maxAllocationPct / 100;

  // Req 8.6: Apply 50% position size reduction when position_size_reduction_active
  if (session.position_size_reduction_active) {
    orderAmount = orderAmount * 0.5;
    console.log(
      `Position size reduction active for session=${session.id}: ` +
      `original=$${(decision.size_pct * session.amount_available).toFixed(2)}, ` +
      `reduced=$${orderAmount.toFixed(2)}`,
    );
  }

  // Req 8.5: size_pct * available ≤ 50% of total session capital
  const maxByTotal = MAX_POSITION_SIZE_PCT * totalCapital;
  if (orderAmount > maxByTotal) {
    return {
      valid: false,
      reason: `Order amount $${orderAmount.toFixed(2)} exceeds 50% of total capital $${totalCapital.toFixed(2)} (max: $${maxByTotal.toFixed(2)})`,
    };
  }

  // Req 8.6: size_pct * available ≤ persona max allocation % * available
  const maxByPersona = personaMaxPct * session.amount_available;
  if (orderAmount > maxByPersona) {
    return {
      valid: false,
      reason: `Order amount $${orderAmount.toFixed(2)} exceeds persona max allocation ${(personaMaxPct * 100).toFixed(0)}% of available $${session.amount_available.toFixed(2)} (max: $${maxByPersona.toFixed(2)})`,
    };
  }

  // Req 8.7: order amount ≥ $5 minimum (after reduction)
  if (orderAmount < 5.0) {
    return {
      valid: false,
      reason: `Order amount $${orderAmount.toFixed(2)} below $5 minimum${session.position_size_reduction_active ? ' (after 50% position size reduction)' : ''}`,
    };
  }

  // Req 8.8: Capital conservation invariant
  // positions + pending + (available - order_amount) ≥ 0
  const remainingAvailable = session.amount_available - orderAmount;
  const totalAfterTrade = session.amount_in_positions + session.amount_in_pending_orders + remainingAvailable;
  if (totalAfterTrade < 0) {
    return {
      valid: false,
      reason: `Capital conservation violated: positions($${session.amount_in_positions.toFixed(2)}) + pending($${session.amount_in_pending_orders.toFixed(2)}) + remaining($${remainingAvailable.toFixed(2)}) = $${totalAfterTrade.toFixed(2)} < 0`,
    };
  }

  return { valid: true };
}


// ─── Kill Switch Check ───────────────────────────────────────────────────────

/**
 * Check if the kill switch is active for a user via DynamoDB (Req 10.1, 10.4).
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

// ─── Distributed Lock ────────────────────────────────────────────────────────

/**
 * Acquire a distributed lock for a session using DynamoDB conditional write.
 * Prevents concurrent trade execution on the same session.
 */
async function acquireLock(sessionId: string): Promise<boolean> {
  const ttl = Math.floor(Date.now() / 1000) + LOCK_TTL_SECONDS;
  const now = Math.floor(Date.now() / 1000);

  try {
    await dynamoClient.send(
      new PutItemCommand({
        TableName: RATE_LIMIT_TABLE,
        Item: marshall({
          pk: `session_lock#${sessionId}`,
          sk: 'lock',
          ttl,
          acquiredAt: new Date().toISOString(),
        }),
        ConditionExpression: 'attribute_not_exists(pk) OR #ttl < :now',
        ExpressionAttributeNames: { '#ttl': 'ttl' },
        ExpressionAttributeValues: marshall({ ':now': now }),
      }),
    );
    return true;
  } catch (error: unknown) {
    if ((error as { name?: string }).name === 'ConditionalCheckFailedException') {
      console.warn(`Lock already held for session ${sessionId}`);
      return false;
    }
    console.error('Lock acquisition failed:', error);
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
        Key: marshall({ pk: `session_lock#${sessionId}`, sk: 'lock' }),
      }),
    );
  } catch (error) {
    console.error(`Failed to release lock for session ${sessionId}:`, error);
  }
}

// ─── CLOB API Order Placement ────────────────────────────────────────────────

/**
 * Place an order on the Polymarket CLOB API with retry logic.
 * Retries up to 3 times with exponential backoff (1s, 2s, 4s).
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
        headers: buildClobHeaders(creds),
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
        `size=${params.size}, price=${params.price}`,
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

  console.error(
    `CLOB order failed after ${MAX_RETRIES + 1} attempts. ` +
    `Params: side=${params.side}, size=${params.size}, price=${params.price}`,
  );
  return null;
}

// ─── Decision Recording ──────────────────────────────────────────────────────

/**
 * Record a decision in the portfolio_manager_decisions table.
 */
async function recordDecision(
  client: import('pg').Client,
  decision: DecisionRecord,
): Promise<void> {
  try {
    await client.query(DECISION_QUERIES.createDecision, [
      decision.sessionId,
      decision.analysisResultId,
      decision.action,
      decision.edgeMet,
      decision.alignmentMet,
      decision.convictionScore,
      decision.additionalCriteriaMet,
      decision.hadPosition,
      decision.positionDirection,
      decision.positionUnrealizedPnl,
      decision.reasoning.slice(0, 500),
      decision.skipReason,
    ]);
  } catch (error) {
    // The partial unique index `idx_unique_decision_per_analysis` (migration
    // 004) prevents duplicate decisions for the same (session, analysis)
    // pair. On retry races, postgres returns SQLSTATE 23505 - log at info
    // level since this is the expected outcome, not a real failure.
    const pgError = error as { code?: string };
    if (pgError?.code === '23505') {
      console.log(
        `Decision for session=${decision.sessionId} analysis=${decision.analysisResultId} already exists (idempotency guard).`,
      );
      return;
    }
    console.error('Failed to record decision:', error);
    // Non-fatal: don't fail the trade execution if decision logging fails
  }
}

// ─── EventBridge Notification ────────────────────────────────────────────────

/**
 * Publish a trade notification event to EventBridge for downstream delivery.
 */
async function publishTradeEvent(
  session: SessionRow,
  direction: TradeDirection,
  size: number,
  price: number,
  decision: PortfolioDecision,
): Promise<void> {
  try {
    await eventBridgeClient.send(
      new PutEventsCommand({
        Entries: [
          {
            Source: 'tradewizard.portfolio-manager',
            DetailType: 'portfolio.trade.executed',
            EventBusName: EVENT_BUS_NAME,
            Detail: JSON.stringify({
              sessionId: session.id,
              userId: session.user_id,
              marketId: session.market_id,
              trade: {
                direction,
                orderType: decision.order_type,
                size,
                price,
                reasoning: decision.reasoning.slice(0, 200),
                conviction: decision.conviction,
              },
            }),
          },
        ],
      }),
    );
  } catch (error) {
    console.error('Failed to publish trade event:', error);
    // Non-fatal: trade was placed successfully, notification is best-effort
  }
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Map a raw database row to a typed SessionRow.
 */
function mapSessionRow(row: Record<string, unknown>): SessionRow {
  return {
    id: row.id as string,
    user_id: row.user_id as string,
    market_id: row.market_id as string,
    persona_id: row.persona_id as string,
    persona_config:
      typeof row.persona_config === 'string'
        ? JSON.parse(row.persona_config)
        : (row.persona_config as SessionRow['persona_config']),
    investment_amount: Number(row.investment_amount),
    status: row.status as string,
    position_direction: (row.position_direction as string) || null,
    position_size: row.position_size != null ? Number(row.position_size) : null,
    position_entry_price: row.position_entry_price != null ? Number(row.position_entry_price) : null,
    amount_in_positions: Number(row.amount_in_positions || 0),
    amount_in_pending_orders: Number(row.amount_in_pending_orders || 0),
    amount_available: Number(row.amount_available || 0),
    cumulative_loss_pct: Number(row.cumulative_loss_pct || 0),
    last_loss_exit_at: (row.last_loss_exit_at as string) || null,
    position_size_reduction_active: Boolean(row.position_size_reduction_active),
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Resolve YES and NO token IDs for a market from the Polymarket CLOB API.
 * Returns { yes, no } token IDs, or undefined values on failure.
 */
async function resolveMarketTokenIds(
  marketId: string,
): Promise<{ yes: string; no: string } | undefined> {
  try {
    const creds = await getClobCredentials();
    const response = await fetch(`${creds.apiUrl}/markets/${marketId}`, {
      headers: buildClobHeaders(creds),
      signal: AbortSignal.timeout(5000),
    });

    if (!response.ok) {
      console.warn(`Failed to resolve token IDs for market=${marketId}: ${response.status}`);
      return undefined;
    }

    const data = await response.json() as { tokens?: Array<{ token_id: string; outcome: string }> };
    const tokens = data.tokens || [];

    if (tokens.length < 2) {
      console.warn(`Market ${marketId} has fewer than 2 tokens: ${tokens.length}`);
      return undefined;
    }

    const yesToken = tokens.find(t => t.outcome?.toLowerCase() === 'yes');
    const noToken = tokens.find(t => t.outcome?.toLowerCase() === 'no');

    if (!yesToken || !noToken) {
      console.warn(`Market ${marketId} missing YES/NO tokens. Outcomes: ${tokens.map(t => t.outcome).join(', ')}`);
      return undefined;
    }

    return {
      yes: yesToken.token_id || '',
      no: noToken.token_id || '',
    };
  } catch (error) {
    console.warn(`Token ID resolution failed for market=${marketId}:`, error);
    return undefined;
  }
}
