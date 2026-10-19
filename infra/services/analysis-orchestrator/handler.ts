/**
 * Analysis Orchestrator - Thin Dispatcher Lambda.
 *
 * Triggered by SQS FIFO queue. Invokes Analysis_Lambda for the full
 * analysis workflow and handles pre/post-processing:
 *
 * 1. Receive analysis request from SQS
 * 2. Invoke Analysis_Lambda with marketId, userId, requestId payload
 * 3. Parse response directly as TradeRecommendation JSON (camelCase from TypeScript)
 * 4. Store result in S3, publish AnalysisCompleted to EventBridge
 * 5. On failure (FunctionError): refund credit, publish AnalysisFailed, re-throw
 *
 * Requirements: 11.1, 11.2, 11.3, 11.4, 11.5, 11.6, 11.7
 */

import { LambdaClient, InvokeCommand } from '@aws-sdk/client-lambda';
import { S3Client, PutObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3';
import {
  EventBridgeClient,
  PutEventsCommand,
} from '@aws-sdk/client-eventbridge';
import { putDedupCache, clearInFlight, checkDedupCache } from '../shared/dynamo';
import { getConnectionString } from '../shared/db';

// ─── Clients (initialized once per Lambda container) ────────────────────────────

const lambdaClient = new LambdaClient({});
const s3Client = new S3Client({});
const eventBridgeClient = new EventBridgeClient({});

// ─── Environment Variables ──────────────────────────────────────────────────────

const ANALYSIS_LAMBDA_ARN = process.env.ANALYSIS_LAMBDA_ARN || '';
const ANALYSIS_BUCKET = process.env.ANALYSIS_BUCKET || '';
const EVENT_BUS_NAME = process.env.EVENT_BUS_NAME || '';
const ENVIRONMENT = process.env.ENVIRONMENT || 'development';

// ─── Types ──────────────────────────────────────────────────────────────────────

interface SQSEvent {
  Records: Array<{
    body: string;
    messageId: string;
    receiptHandle: string;
  }>;
}

interface AnalysisMessage {
  requestId: string;
  marketId: string;
  userId: string;
  requestType: 'one_time' | 'recurring';
  isScheduledFire?: boolean; // true when triggered by EventBridge schedule (not user request)
  scheduledFireId?: string; // Unique per fire - set by EventBridge Scheduler context attribute
  timestamp?: string;
}

interface TradeRecommendation {
  marketId: string;
  action: 'LONG_YES' | 'LONG_NO' | 'NO_TRADE';
  entryZone: [number, number];
  targetZone: [number, number];
  stopLoss: number;
  expectedValue: number;
  winProbability: number;
  liquidityRisk: 'low' | 'medium' | 'high';
  explanation: {
    summary: string;
    coreThesis: string;
    keyCatalysts: string[];
    failureScenarios: string[];
    uncertaintyNote: string;
    riskPerspectives: string;
  };
  metadata: {
    consensusProbability: number;
    marketProbability: number;
    edge: number;
    confidenceBand: [number, number];
    totalLlmCalls: number;
    executionDurationMs: number;
    agentsUsed: string[];
    marketQuestion: string;
    disagreementIndex?: number;
  };
  // Full analysis detail attached by the Analysis_Lambda - persisted to
  // agent_memory (per-signal rows) and S3 (full detail JSON) by this Lambda.
  // Stripped from the public-facing result before delivery.
  // All fields are already in camelCase from the TypeScript Analysis_Lambda.
  _analysisDetail?: {
    agentSignals: Array<{
      agentName: string;
      direction: string;
      confidence: number;
      fairProbability: number;
      keyDrivers: string[];
      riskFactors: string[];
      timestamp: string;
    }>;
    fusedSignal: Record<string, unknown>;
    bullThesis: Record<string, unknown>;
    bearThesis: Record<string, unknown>;
    crossExamination: Record<string, unknown>;
    consensus: Record<string, unknown>;
    riskPerspectives: string;
    webResearchSummary: string;
  };
}

// ─── Main Handler ───────────────────────────────────────────────────────────────

// ─── Per-Request Idempotency Marker ─────────────────────────────────────────────
//
// SQS retries (visibility-timeout expiry, transient errors) re-deliver the
// same message body. Without a per-request guard, we'd re-invoke the Analysis_Lambda,
// re-insert into analysis_results (no UNIQUE constraint), and re-publish the
// AnalysisCompleted fan-out - duplicate notifications and duplicate spend.
//
// We mark each requestId as processed in the dedup cache (TTL = 1 hour) once
// the orchestrator finishes the publish step. Retries see the marker and skip.
// The marker is a synthetic entry in the existing dedup-cache DynamoDB table
// keyed by `request#{requestId}` so it shares the table's 1-hour TTL eviction
// and IAM grants - no new resource needed.

async function isRequestAlreadyProcessed(requestId: string): Promise<boolean> {
  // Best-effort: if the dedup cache is unavailable we fail OPEN (assume the
  // request hasn't been processed) so legitimate first-time invocations
  // aren't blocked by a transient DDB issue. The cost of a false-negative is
  // duplicate work on a retry; the cost of failing closed would be an
  // analysis the user paid for never running.
  try {
    const ttl = 60 * 60 * 1000; // 1 hour, same as dedup cache TTL
    const marker = await checkDedupCache(`request#${requestId}`, ttl);
    return marker !== null;
  } catch (error) {
    console.warn(
      `Idempotency marker check failed for request ${requestId} (failing open):`,
      error,
    );
    return false;
  }
}

async function markRequestProcessed(message: AnalysisMessage, resultId: string): Promise<void> {
  // Best-effort: failure to write the marker just means a potential SQS retry
  // re-does the work. We don't want a marker-write failure to flip a
  // successful run into the failure/refund path.
  try {
    const now = new Date().toISOString();
    await putDedupCache({
      marketId: `request#${message.requestId}`,
      executedAt: now,
      resultId,
      resultPayloadS3Key: `results/${message.marketId}/${message.requestId}.json`,
      consensusProbability: 0,
      recommendation: 'PROCESSED',
      ttl: Math.floor(Date.now() / 1000) + 3600,
    });
  } catch (error) {
    console.warn(
      `Failed to write idempotency marker for request ${message.requestId} - SQS retry may re-process:`,
      error,
    );
  }
}

/**
 * Check if the sweeper already marked this request as failed (and refunded the user).
 * If so, SQS retries should NOT re-run the analysis - that would be a free analysis.
 * Best-effort: fails open (returns false) on DB errors so legitimate first-time
 * invocations aren't blocked.
 */
async function isRequestAlreadyFailed(requestId: string): Promise<boolean> {
  try {
    const connectionString = await getConnectionString();
    const pg = await import('pg');
    const client = new pg.Client({ connectionString, ssl: { rejectUnauthorized: false } });
    try {
      await client.connect();
      const result = await client.query(
        `SELECT status FROM analysis_requests WHERE id = $1::uuid`,
        [requestId]
      );
      if (result.rows.length > 0 && result.rows[0].status === 'failed') {
        return true;
      }
      return false;
    } finally {
      await client.end();
    }
  } catch (error) {
    console.warn(`Failed to check request status for ${requestId} (failing open):`, error);
    return false;
  }
}

/**
 * Main Lambda handler - triggered by SQS.
 * Processes each record by invoking Analysis_Lambda and handling the result.
 */
export async function handler(event: SQSEvent): Promise<void> {
  for (const record of event.Records) {
    const rawMessage = JSON.parse(record.body);

    // For scheduled fires, the EventBridge Scheduler payload doesn't include
    // a requestId (the old static-UUID approach caused SQS FIFO content-based
    // dedup to silently drop repeated fires). Generate a fresh one per fire.
    const message: AnalysisMessage = {
      ...rawMessage,
      requestId: rawMessage.requestId || crypto.randomUUID(),
    };

    console.log(`Processing analysis request: ${message.requestId} for market: ${message.marketId} (scheduledFire=${!!message.isScheduledFire})`);

    // Idempotency: skip if this exact requestId was already processed.
    // Protects against SQS retries duplicating Analysis_Lambda invocations,
    // analysis_results inserts, and AnalysisCompleted fan-out events.
    if (await isRequestAlreadyProcessed(message.requestId)) {
      console.log(
        `Request ${message.requestId} already processed (per-request marker found); skipping retry.`,
      );
      continue;
    }

    // Skip if the sweeper already marked this request as failed and refunded.
    // This prevents SQS retries from producing a free analysis after the user
    // was already refunded.
    if (await isRequestAlreadyFailed(message.requestId)) {
      console.log(
        `Request ${message.requestId} already marked failed (sweeper refunded); skipping retry.`,
      );
      continue;
    }

    // For scheduled fires: enforce freshness minimum interval.
    // If a fresh result already exists, skip execution but still deliver
    // to subscribers who haven't received it yet. This handles the case where
    // a shorter-interval schedule (e.g., 1h) already produced a result that
    // longer-interval subscribers (e.g., 4h, 12h) haven't seen.
    //
    // The freshness window is set to 55 minutes (not 60) to avoid a race
    // condition with the 1-hour schedule: EventBridge FlexibleTimeWindow can
    // fire up to 5 minutes early, and the DynamoDB TTL + cutoff comparison
    // would otherwise cause the hourly fire to see its own previous result
    // as "still fresh" and skip execution every other cycle.
    if (message.isScheduledFire) {
      const FRESHNESS_WINDOW_MS = 55 * 60 * 1000; // 55 minutes
      const existingResult = await checkDedupCache(message.marketId, FRESHNESS_WINDOW_MS);
      if (existingResult) {
        console.log(`Fresh result exists for market ${message.marketId} (${existingResult.resultId}, executed at ${existingResult.executedAt}) - delivering to unserved subscribers`);

        // Deliver the cached result to subscribers who haven't received it yet
        const deliveredUserIds = await chargeAndDeliverCachedToUnservedSubscribers(
          message.marketId,
          existingResult.resultId,
          existingResult.resultPayloadS3Key,
          existingResult.recommendation,
          existingResult.consensusProbability,
          existingResult.executedAt,
        );

        if (deliveredUserIds.length > 0) {
          console.log(`Delivered cached result ${existingResult.resultId} to ${deliveredUserIds.length} previously-unserved subscriber(s)`);
        } else {
          console.log(`All subscribers on market ${message.marketId} already have the latest result - nothing to deliver`);
        }

        // Mark this scheduled-fire request as processed so a retry of
        // the same SQS message doesn't redo this branch on the next attempt.
        await markRequestProcessed(message, existingResult.resultId);
        continue;
      }
    }

    const startTime = Date.now();

    try {
      const result = await invokeOrchestrator(message.marketId, message.userId, message.requestId, startTime);

      // Store result in S3
      const s3Key = `results/${message.marketId}/${message.requestId}.json`;
      await storeResult(s3Key, result);

      const executedAt = new Date().toISOString();
      const durationMs = Date.now() - startTime;

      // Store result in RDS (analysis_results table) for per-user delivery tracking
      const resultId = await storeResultInRds(message, result, s3Key, executedAt, durationMs);

      // Persist per-agent signals to agent_memory and full detail to S3.
      // This is what feeds Stage 2 (historical context retrieval) in future runs.
      // Best-effort - failure here does not block delivery or refund.
      await storeAgentMemory(message.marketId, resultId, result, s3Key);

      // Update dedup cache (uses the RDS result ID for consistency)
      await putDedupCache({
        marketId: message.marketId,
        executedAt,
        resultId,
        resultPayloadS3Key: s3Key,
        consensusProbability: result.metadata.consensusProbability,
        recommendation: result.action,
        ttl: Math.floor(Date.now() / 1000) + 3600, // 1 hour TTL
      });

      // Record delivery for the requesting user and all market subscribers
      // For scheduled recurring fires: charge and deliver to ALL active subscribers
      // For user-initiated requests (one-time or initial recurring setup): only deliver to recently-charged users
      let deliveredUserIds: string[];
      if (message.isScheduledFire) {
        deliveredUserIds = await chargeAndDeliverToRecurringSubscribers(message.marketId, resultId);
      } else {
        deliveredUserIds = await recordDeliveriesForRecentSubscribers(message.marketId, resultId);
      }

      // Clear in-flight marker
      await clearInFlight(message.marketId);

      // Publish completion events - one per delivered subscriber so the SNS
      // fan-out (WebSocket / email / push / webhook) addresses each user
      // independently. All events carry the canonical internal `users.id`,
      // never the Cognito sub.
      await publishCompletionEventsForSubscribers(
        message,
        result,
        durationMs,
        resultId,
        deliveredUserIds,
      );

      // Mark this requestId as processed so SQS retries skip the work above.
      // Done last so a partial failure (e.g. RDS down after Analysis_Lambda success)
      // still allows the retry to attempt the steps that didn't complete.
      // The trade-off: a retry that fails AFTER publish but BEFORE marker
      // write will re-publish events. We accept this because the AnalysisFailed
      // refund path is the more critical correctness boundary.
      //
      // IMPORTANT: Do NOT mark recurring requests as completed - they must stay
      // 'active' so chargeAndDeliverToRecurringSubscribers can find subscribers
      // and GET /analysis/subscriptions can list them.
      if (message.requestType !== 'recurring') {
        await markRequestCompleted(message.requestId);
        // Unsubscribe one-time subscriber rows so they don't participate in
        // future recurring deliveries (prevents double-charging).
        await unsubscribeOneTimeSubscribers(message.marketId, message.requestId);
      }
      await markRequestProcessed(message, resultId);

      // For scheduled fires: update market_analysis_schedule with the next run time
      // so that getUpcomingSchedule() returns accurate info for user-facing status.
      if (message.isScheduledFire) {
        await updateScheduleAfterExecution(message.marketId, resultId);
      }

      console.log(`Analysis complete: ${resultId} (${durationMs}ms) → ${result.action}`);
    } catch (error) {
      console.error(`Analysis failed for ${message.requestId}:`, error);
      await clearInFlight(message.marketId);
      // Only mark the request as failed for one-time requests.
      // Recurring requests should stay 'active' - one failed execution
      // doesn't invalidate the subscription. The schedule will fire again.
      if (message.requestType !== 'recurring') {
        await markRequestFailed(message.requestId);
      }
      await refundSubscribers(message.marketId, message.requestId);
      await publishFailureEvent(message, error as Error);
      throw error; // Let SQS retry
    }
  }
}

// ─── Analysis Lambda Invocation ─────────────────────────────────────────────────

/**
 * Invoke Analysis_Lambda with marketId, userId, and requestId payload.
 * Uses synchronous RequestResponse invocation type.
 *
 * Requirements: 11.1, 11.2, 11.3, 11.6, 11.7
 */
async function invokeOrchestrator(
  marketId: string,
  userId: string,
  requestId: string,
  startTime: number
): Promise<TradeRecommendation> {
  const payload = JSON.stringify({ marketId, userId, requestId });

  const response = await lambdaClient.send(
    new InvokeCommand({
      FunctionName: ANALYSIS_LAMBDA_ARN,
      InvocationType: 'RequestResponse',
      Payload: Buffer.from(payload),
    })
  );

  // Requirement 11.5: If the Analysis_Lambda returned a FunctionError (unhandled exception),
  // treat as failure - credits will be refunded, AnalysisFailed published, and error re-thrown
  // by the caller's catch block for SQS retry.
  if (response.FunctionError) {
    const errorPayload = response.Payload
      ? new TextDecoder().decode(response.Payload)
      : 'Unknown error';
    throw new Error(
      `Analysis_Lambda invocation failed (FunctionError: ${response.FunctionError}): ${errorPayload}`
    );
  }

  // Parse response payload directly as TradeRecommendation (Requirement 11.3)
  // TypeScript Analysis_Lambda produces camelCase - no snake_case normalization needed.
  const responseBody = response.Payload
    ? new TextDecoder().decode(response.Payload)
    : '';

  return parseTradeRecommendation(responseBody, marketId, startTime);
}

// ─── Response Parsing ───────────────────────────────────────────────────────────

/**
 * Parse the Analysis_Lambda response as a TradeRecommendation.
 * The Analysis_Lambda is TypeScript and returns camelCase natively - no
 * snake_case normalization needed (Requirement 11.3).
 * Falls back to NO_TRADE if the response is unparseable.
 */
function parseTradeRecommendation(
  responseBody: string,
  marketId: string,
  startTime: number
): TradeRecommendation {
  try {
    const parsed = JSON.parse(responseBody);

    // Validate required fields exist
    if (!parsed.action || !parsed.marketId) {
      throw new Error(`Missing required fields in response: action=${parsed.action}, marketId=${parsed.marketId}`);
    }

    // TypeScript Analysis_Lambda returns camelCase directly - use as-is
    const recommendation: TradeRecommendation = {
      marketId: parsed.marketId,
      action: parsed.action,
      entryZone: parsed.entryZone || [0, 0],
      targetZone: parsed.targetZone || [0, 0],
      stopLoss: parsed.stopLoss ?? 0,
      expectedValue: parsed.expectedValue ?? 0,
      winProbability: parsed.winProbability ?? 0,
      liquidityRisk: parsed.liquidityRisk || 'medium',
      explanation: parsed.explanation || {
        summary: '',
        coreThesis: '',
        keyCatalysts: [],
        failureScenarios: [],
        uncertaintyNote: '',
        riskPerspectives: '',
      },
      metadata: {
        ...(parsed.metadata || {}),
        executionDurationMs: Date.now() - startTime,
        consensusProbability: parsed.metadata?.consensusProbability ?? 0.5,
        marketProbability: parsed.metadata?.marketProbability ?? 0.5,
        edge: parsed.metadata?.edge ?? 0,
        confidenceBand: parsed.metadata?.confidenceBand || [0, 1],
        totalLlmCalls: parsed.metadata?.totalLlmCalls ?? 0,
        agentsUsed: parsed.metadata?.agentsUsed || [],
        marketQuestion: parsed.metadata?.marketQuestion || `Market ${marketId}`,
      },
    };

    // Attach _analysisDetail if present (already camelCase from TypeScript Lambda)
    if (parsed._analysisDetail) {
      recommendation._analysisDetail = parsed._analysisDetail;
    }

    return recommendation;
  } catch (parseError) {
    console.warn('Failed to parse Analysis_Lambda response as TradeRecommendation, using NO_TRADE fallback:', parseError);
    console.warn('Raw response (first 1000 chars):', responseBody.slice(0, 1000));

    return buildNoTradeFallback(marketId, startTime);
  }
}

/**
 * Build a NO_TRADE fallback recommendation when the Analysis_Lambda response is unparseable.
 */
function buildNoTradeFallback(marketId: string, startTime: number): TradeRecommendation {
  return {
    marketId,
    action: 'NO_TRADE',
    entryZone: [0, 0],
    targetZone: [0, 0],
    stopLoss: 0,
    expectedValue: 0,
    winProbability: 0,
    liquidityRisk: 'high',
    explanation: {
      summary: 'Analysis could not be completed - agent response was unparseable.',
      coreThesis: '',
      keyCatalysts: [],
      failureScenarios: ['Agent response parsing failure'],
      uncertaintyNote: 'This recommendation was generated as a fallback due to a parsing error.',
      riskPerspectives: '',
    },
    metadata: {
      consensusProbability: 0.5,
      marketProbability: 0.5,
      edge: 0,
      confidenceBand: [0, 1],
      totalLlmCalls: 0,
      executionDurationMs: Date.now() - startTime,
      agentsUsed: [],
      marketQuestion: `Market ${marketId}`,
    },
  };
}

// ─── S3 Storage ─────────────────────────────────────────────────────────────────

/**
 * Store the trade recommendation in S3 (public-facing result).
 * Strips _analysisDetail before writing - that goes to a separate detail key.
 */
async function storeResult(s3Key: string, result: TradeRecommendation): Promise<void> {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { _analysisDetail, ...publicResult } = result;
  await s3Client.send(
    new PutObjectCommand({
      Bucket: ANALYSIS_BUCKET,
      Key: s3Key,
      Body: JSON.stringify(publicResult, null, 2),
      ContentType: 'application/json',
    })
  );
}

// ─── EventBridge Publishing ─────────────────────────────────────────────────────

/**
 * Publish AnalysisCompleted events to EventBridge - one per delivered subscriber.
 *
 * Why per-subscriber fan-out?
 * - The SNS-bound delivery handlers (WebSocket, email, push, webhook) target a
 *   specific user. The orchestrator may deliver one analysis result to many
 *   recurring subscribers; each must receive their own delivery event.
 * - The portfolio trade-executor filters sessions by event.userId, so per-user
 *   events also let it process exactly the right session for each subscriber.
 *
 * All emitted events carry the canonical internal `users.id` (NOT the Cognito sub).
 *
 * Requirement 3.4.
 */
async function publishCompletionEventsForSubscribers(
  message: AnalysisMessage,
  result: TradeRecommendation,
  durationMs: number,
  resultId: string,
  deliveredUserIds: string[],
): Promise<void> {
  // Always emit one event per delivered subscriber. For non-scheduled fires
  // (one-time / in-flight subscribe / fresh dispatch) we also include the
  // requesting user even if they're not in the delivered set yet (e.g. if
  // they were the only subscriber but `recordDeliveriesForRecentSubscribers`
  // missed them due to a timing edge). For scheduled fires, do NOT add the
  // original requester - they may have unsubscribed since setting up the
  // schedule, and `chargeAndDeliverToRecurringSubscribers` already returned
  // the authoritative active set.
  const targetUserIds = new Set<string>(deliveredUserIds);

  if (!message.isScheduledFire) {
    // message.userId is now the internal users.id (set by analysis-request handler via ensureUser).
    // Add it directly to the target set as a fallback if recordDeliveriesForRecentSubscribers missed it.
    if (message.userId) {
      targetUserIds.add(message.userId);
    }
  }

  if (targetUserIds.size === 0) {
    console.warn(
      `No delivered subscribers and no resolvable requester for market=${message.marketId}; ` +
      `skipping AnalysisCompleted publish.`,
    );
    return;
  }

  // EventBridge PutEvents accepts up to 10 entries per call.
  const userIds = Array.from(targetUserIds);
  for (let i = 0; i < userIds.length; i += 10) {
    const batch = userIds.slice(i, i + 10);
    await eventBridgeClient.send(
      new PutEventsCommand({
        Entries: batch.map((internalUserId) => ({
          Source: 'tradewizard.analysis',
          DetailType: 'AnalysisCompleted',
          EventBusName: EVENT_BUS_NAME,
          Detail: JSON.stringify(buildCompletionDetail(message, result, durationMs, resultId, internalUserId)),
        })),
      })
    );
  }

  console.log(
    `Published AnalysisCompleted to ${userIds.length} subscriber(s) on market=${message.marketId}, result=${resultId}`,
  );
}

/**
 * Build the AnalysisCompleted event detail for a specific subscriber.
 */
function buildCompletionDetail(
  message: AnalysisMessage,
  result: TradeRecommendation,
  durationMs: number,
  resultId: string,
  internalUserId: string,
): Record<string, unknown> {
  return {
    analysisId: resultId,
    analysisRequestId: message.requestId,
    resultId,
    marketId: message.marketId,
    userId: internalUserId, // canonical users.id (NOT cognito sub)
    marketQuestion: result.metadata?.marketQuestion || `Market ${message.marketId}`,
    // Flat fields for delivery handlers (WebSocket, email, push, webhook)
    recommendation: result.action,
    consensusProbability: result.metadata.consensusProbability,
    confidence: result.winProbability,
    edge: result.metadata.edge,
    // Full recommendation object for portfolio trade executor
    tradeRecommendation: {
      action: result.action,
      confidence: result.winProbability,
      consensusProbability: result.metadata.consensusProbability,
      currentPrice: result.metadata.marketProbability,
      edge: result.metadata.edge,
      signalAlignment: result.metadata.confidenceBand
        ? 1 - (result.metadata.confidenceBand[1] - result.metadata.confidenceBand[0])
        : 0.7,
      reasoning: result.explanation.summary,
      entryZone: result.entryZone,
      targetZone: result.targetZone,
      stopLoss: result.stopLoss,
      liquidityRisk: result.liquidityRisk,
      explanation: result.explanation,
    },
    resultPayloadS3Key: `results/${message.marketId}/${message.requestId}.json`,
    executedAt: new Date().toISOString(),
    wasCached: false,
    durationMs,
    environment: ENVIRONMENT,
  };
}

/**
 * Publish AnalysisFailed event to EventBridge (Requirement 3.5).
 * Carries the internal users.id when the requester is resolvable; otherwise
 * falls back to the cognito sub so failures are still observable.
 */
async function publishFailureEvent(message: AnalysisMessage, error: Error): Promise<void> {
  // message.userId is now the internal users.id (set by analysis-request handler)
  const internalUserId = message.userId;
  await eventBridgeClient.send(
    new PutEventsCommand({
      Entries: [
        {
          Source: 'tradewizard.analysis',
          DetailType: 'AnalysisFailed',
          EventBusName: EVENT_BUS_NAME,
          Detail: JSON.stringify({
            requestId: message.requestId,
            marketId: message.marketId,
            userId: internalUserId,
            cognitoSub: message.userId,
            error: error.message,
            environment: ENVIRONMENT,
          }),
        },
      ],
    })
  );
}

// ─── RDS Result Storage & Delivery Tracking ─────────────────────────────────────

/**
 * Store the analysis result in the RDS analysis_results table.
 * Returns the generated result UUID for use in delivery tracking and dedup cache.
 */
async function storeResultInRds(
  message: AnalysisMessage,
  result: TradeRecommendation,
  s3Key: string,
  executedAt: string,
  durationMs: number
): Promise<string> {
  const connectionString = await getConnectionString();
  const pg = await import('pg');
  const client = new pg.Client({ connectionString, ssl: { rejectUnauthorized: false } });

  try {
    await client.connect();
    // Calculate entry/target/stop prices for outcome tracking
    const entryPrice = result.action !== 'NO_TRADE'
      ? (result.entryZone[0] + result.entryZone[1]) / 2
      : null;
    const targetPrice = result.action !== 'NO_TRADE'
      ? (result.targetZone[0] + result.targetZone[1]) / 2
      : null;
    const stopLossPrice = result.action !== 'NO_TRADE'
      ? result.stopLoss
      : null;
    const outcomeStatus = result.action === 'NO_TRADE' ? 'no_trade' : 'pending';

    const res = await client.query(
      `INSERT INTO analysis_results (
         market_id, executed_at, execution_duration_ms, total_llm_calls,
         result_payload_s3_key, consensus_probability, recommendation,
         confidence_score, edge, market_probability_at_execution,
         entry_price, target_price, stop_loss_price, outcome_status
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
       RETURNING id`,
      [
        message.marketId,
        executedAt,
        durationMs,
        result.metadata.totalLlmCalls,
        s3Key,
        result.metadata.consensusProbability,
        result.action,
        result.winProbability,
        result.metadata.edge,
        result.metadata.marketProbability,
        entryPrice,
        targetPrice,
        stopLossPrice,
        outcomeStatus,
      ]
    );
    const resultId = res.rows[0].id;
    console.log(`Stored analysis result ${resultId} in RDS for market ${message.marketId}`);

    // Upsert market metadata so the history/insights pages can show the market name
    if (result.metadata.marketQuestion && result.metadata.marketQuestion !== `Market ${message.marketId}`) {
      try {
        await client.query(
          `INSERT INTO markets (condition_id, question)
           VALUES ($1, $2)
           ON CONFLICT (condition_id) DO UPDATE SET question = EXCLUDED.question`,
          [message.marketId, result.metadata.marketQuestion]
        );
      } catch (marketErr) {
        console.warn('Failed to upsert market metadata:', marketErr);
      }
    }

    return resultId;
  } catch (error) {
    console.error('Failed to store result in RDS:', error);
    // Fall back to using the requestId as resultId (dedup cache will still work)
    return message.requestId;
  } finally {
    await client.end();
  }
}

/**
 * Persist per-agent signals to the agent_memory table and store the full
 * analysis detail (signals + theses + consensus + risk) to S3.
 *
 * This is what feeds Stage 2 (historical context retrieval) in future runs.
 * Without this, fetch_market_history() always returns empty and agents have
 * no memory of their own past signals.
 *
 * Best-effort: failures are logged but do not block delivery or trigger refunds.
 */
async function storeAgentMemory(
  marketId: string,
  resultId: string,
  result: TradeRecommendation,
  tradeRecommendationS3Key: string,
): Promise<void> {
  const detail = result._analysisDetail;
  if (!detail || !detail.agentSignals || detail.agentSignals.length === 0) {
    console.warn(`No _analysisDetail in orchestrator response for market ${marketId} - agent_memory not written`);
    return;
  }

  // ── 1. Store full analysis detail to S3 ──────────────────────────────────
  // Key mirrors the trade recommendation key but under a detail/ prefix.
  // e.g. results/0x.../req-123.json → detail/0x.../req-123.json
  const detailS3Key = tradeRecommendationS3Key.replace(/^results\//, 'detail/');
  try {
    // Analysis_Lambda returns camelCase natively - store directly without normalization
    await s3Client.send(
      new PutObjectCommand({
        Bucket: ANALYSIS_BUCKET,
        Key: detailS3Key,
        Body: JSON.stringify({
          marketId,
          resultId,
          storedAt: new Date().toISOString(),
          agentSignals: detail.agentSignals,
          fusedSignal: detail.fusedSignal,
          bullThesis: detail.bullThesis,
          bearThesis: detail.bearThesis,
          crossExamination: detail.crossExamination,
          consensus: detail.consensus,
          riskPerspectives: detail.riskPerspectives,
          webResearchSummary: detail.webResearchSummary,
        }, null, 2),
        ContentType: 'application/json',
      })
    );
    console.log(`Stored full analysis detail to S3: ${detailS3Key}`);
  } catch (s3Error) {
    console.error(`Failed to store analysis detail to S3 (${detailS3Key}):`, s3Error);
    // Continue - RDS writes are more critical for memory retrieval
  }

  // ── 2. Write one agent_memory row per agent signal ────────────────────────
  const connectionString = await getConnectionString();
  const pg = await import('pg');
  const client = new pg.Client({ connectionString, ssl: { rejectUnauthorized: false } });

  try {
    await client.connect();

    let written = 0;
    for (const sig of detail.agentSignals) {
      try {
        await client.query(
          `INSERT INTO agent_memory (
             market_id, agent_name, result_id,
             direction, confidence, fair_probability,
             key_drivers, risk_factors, signal_timestamp
           ) VALUES ($1, $2, $3::uuid, $4, $5, $6, $7, $8, $9)
           ON CONFLICT DO NOTHING`,
          [
            marketId,
            sig.agentName,
            resultId,
            sig.direction,
            sig.confidence,
            sig.fairProbability,
            JSON.stringify(sig.keyDrivers),
            JSON.stringify(sig.riskFactors),
            sig.timestamp,
          ]
        );
        written++;
      } catch (rowError) {
        console.error(`Failed to insert agent_memory row for ${sig.agentName}:`, rowError);
      }
    }

    console.log(`Wrote ${written}/${detail.agentSignals.length} agent_memory rows for result ${resultId}`);
  } catch (error) {
    console.error('Failed to write agent_memory rows:', error);
  } finally {
    await client.end();
  }
}

/**
 * Record deliveries for users who were charged for this specific one-time/in-flight execution.
 *
 * Returns the list of internal users.id values that received the result.
 */
async function recordDeliveriesForRecentSubscribers(
  marketId: string,
  resultId: string
): Promise<string[]> {
  const connectionString = await getConnectionString();
  const pg = await import('pg');
  const client = new pg.Client({ connectionString, ssl: { rejectUnauthorized: false } });

  try {
    await client.connect();

    // Use DISTINCT ON to pick only one subscriber row per user (most recent),
    // preventing duplicate deliveries when a user has multiple subscriber rows
    // (e.g., stale one-time + active recurring) within the 5-minute window.
    const result = await client.query(
      `INSERT INTO analysis_deliveries (result_id, user_id, analysis_request_id, was_cached_delivery, delivery_channel)
       SELECT $1::uuid, sub.user_id, sub.analysis_request_id, false, 'in_app'
       FROM (
         SELECT DISTINCT ON (ms.user_id) ms.user_id, ms.analysis_request_id
         FROM market_subscribers ms
         WHERE ms.market_id = $2
           AND ms.unsubscribed_at IS NULL
           AND ms.subscribed_at > NOW() - INTERVAL '5 minutes'
         ORDER BY ms.user_id, ms.subscribed_at DESC
       ) sub
       ON CONFLICT (result_id, user_id, analysis_request_id) DO NOTHING
       RETURNING user_id`,
      [resultId, marketId]
    );

    const userIds = result.rows.map((row) => row.user_id as string);
    console.log(
      `Recorded ${userIds.length} deliveries for recently-charged subscribers on market ${marketId} (result: ${resultId})`,
    );
    return userIds;
  } catch (error) {
    console.error('Failed to record deliveries for recent subscribers:', error);
    return [];
  } finally {
    await client.end();
  }
}

/**
 * For recurring schedule executions: charge 1 credit to each active subscriber
 * and record delivery. This is the "fan-out" for recurring analysis.
 *
 * Subscribers who don't have credits are skipped (not charged, not delivered).
 *
 * IMPORTANT: A user may have multiple subscriber rows for the same market
 * (e.g., a stale one-time subscription + the active recurring subscription).
 * We deduplicate by user_id to ensure each user is only charged ONCE per result.
 * The delivery is recorded against the most recent (recurring) analysis_request_id.
 *
 * Returns the list of internal users.id values that received and were charged.
 */
async function chargeAndDeliverToRecurringSubscribers(
  marketId: string,
  resultId: string
): Promise<string[]> {
  const connectionString = await getConnectionString();
  const pg = await import('pg');
  const client = new pg.Client({ connectionString, ssl: { rejectUnauthorized: false } });
  const deliveredUserIds: string[] = [];

  try {
    await client.connect();

    // Get all active subscribers for this market, deduplicated by user_id.
    // When a user has multiple subscriber rows (e.g., stale one-time + recurring),
    // pick the most recently subscribed row (which will be the recurring one).
    const subscribers = await client.query(
      `SELECT DISTINCT ON (ms.user_id) ms.user_id, ms.analysis_request_id
       FROM market_subscribers ms
       WHERE ms.market_id = $1
         AND ms.unsubscribed_at IS NULL
       ORDER BY ms.user_id, ms.subscribed_at DESC`,
      [marketId]
    );

    for (const row of subscribers.rows) {
      const userId = row.user_id;
      const analysisRequestId = row.analysis_request_id;

      // Attempt to deduct 1 credit atomically
      const deductResult = await client.query(
        `UPDATE subscriptions
         SET credits_remaining = credits_remaining - 1
         WHERE user_id = $1 AND status IN ('active', 'grace_period') AND credits_remaining > 0
         RETURNING credits_remaining`,
        [userId]
      );

      if (deductResult.rows.length === 0) {
        // User has no credits - skip delivery (they won't receive this analysis)
        console.log(`Skipping delivery to user ${userId} - no credits remaining`);
        continue;
      }

      const newBalance = deductResult.rows[0].credits_remaining;

      // Record credit transaction
      await client.query(
        `INSERT INTO credit_transactions (user_id, amount, balance_after, reason, reference_id, reference_type, credit_source)
         VALUES ($1, -1, $2, 'recurring_analysis_delivery', $3, 'analysis', 'plan')`,
        [userId, newBalance, analysisRequestId]
      );

      // Record delivery
      await client.query(
        `INSERT INTO analysis_deliveries (result_id, user_id, analysis_request_id, was_cached_delivery, delivery_channel)
         VALUES ($1::uuid, $2, $3::uuid, false, 'in_app')
         ON CONFLICT (result_id, user_id, analysis_request_id) DO NOTHING`,
        [resultId, userId, analysisRequestId]
      );

      deliveredUserIds.push(userId);
    }

    console.log(`Charged and delivered to ${deliveredUserIds.length}/${subscribers.rows.length} recurring subscribers on market ${marketId}`);
    return deliveredUserIds;
  } catch (error) {
    console.error('Failed to charge/deliver to recurring subscribers:', error);
    return deliveredUserIds;
  } finally {
    await client.end();
  }
}

/**
 * Deliver a cached (already-existing) result to recurring subscribers who haven't
 * received it yet. This handles cross-interval delivery: when a shorter-interval
 * schedule (e.g., 1h) already produced a result, longer-interval schedules
 * (e.g., 4h, 12h, 1d) should still deliver it to their subscribers rather than
 * silently skipping.
 *
 * Only subscribers who haven't already received this specific result are charged
 * and delivered. Users who already have it (from the shorter-interval delivery)
 * are skipped.
 *
 * Also publishes AnalysisCompleted events for delivered users so multi-channel
 * delivery (WebSocket, email, push, webhook) fires for them.
 */
async function chargeAndDeliverCachedToUnservedSubscribers(
  marketId: string,
  resultId: string,
  resultPayloadS3Key: string,
  recommendation: string,
  consensusProbability: number,
  executedAt: string,
): Promise<string[]> {
  const connectionString = await getConnectionString();
  const pg = await import('pg');
  const client = new pg.Client({ connectionString, ssl: { rejectUnauthorized: false } });
  const deliveredUserIds: string[] = [];

  try {
    await client.connect();

    // Get all active subscribers who have NOT already received this result.
    // Deduplicate by user_id (pick the most recent subscription row).
    const subscribers = await client.query(
      `SELECT DISTINCT ON (ms.user_id) ms.user_id, ms.analysis_request_id
       FROM market_subscribers ms
       WHERE ms.market_id = $1
         AND ms.unsubscribed_at IS NULL
         AND NOT EXISTS (
           SELECT 1 FROM analysis_deliveries ad
           WHERE ad.result_id = $2::uuid AND ad.user_id = ms.user_id
         )
       ORDER BY ms.user_id, ms.subscribed_at DESC`,
      [marketId, resultId]
    );

    if (subscribers.rows.length === 0) {
      return [];
    }

    for (const row of subscribers.rows) {
      const userId = row.user_id;
      const analysisRequestId = row.analysis_request_id;

      // Attempt to deduct 1 credit atomically
      const deductResult = await client.query(
        `UPDATE subscriptions
         SET credits_remaining = credits_remaining - 1
         WHERE user_id = $1 AND status IN ('active', 'grace_period') AND credits_remaining > 0
         RETURNING credits_remaining`,
        [userId]
      );

      if (deductResult.rows.length === 0) {
        console.log(`Skipping cached delivery to user ${userId} - no credits remaining`);
        continue;
      }

      const newBalance = deductResult.rows[0].credits_remaining;

      // Record credit transaction
      await client.query(
        `INSERT INTO credit_transactions (user_id, amount, balance_after, reason, reference_id, reference_type, credit_source)
         VALUES ($1, -1, $2, 'recurring_analysis_delivery', $3, 'analysis', 'plan')`,
        [userId, newBalance, analysisRequestId]
      );

      // Record delivery (marked as cached since we're reusing an existing result)
      await client.query(
        `INSERT INTO analysis_deliveries (result_id, user_id, analysis_request_id, was_cached_delivery, delivery_channel)
         VALUES ($1::uuid, $2, $3::uuid, true, 'in_app')
         ON CONFLICT (result_id, user_id, analysis_request_id) DO NOTHING`,
        [resultId, userId, analysisRequestId]
      );

      deliveredUserIds.push(userId);
    }

    // Publish AnalysisCompleted events for each delivered user so they receive
    // notifications via WebSocket, email, push, and webhook channels.
    if (deliveredUserIds.length > 0) {
      await publishCachedDeliveryEvents(marketId, resultId, resultPayloadS3Key, recommendation, consensusProbability, executedAt, deliveredUserIds);
    }

    console.log(`Cached delivery: charged and delivered to ${deliveredUserIds.length}/${subscribers.rows.length} unserved subscribers on market ${marketId} (result: ${resultId})`);
    return deliveredUserIds;
  } catch (error) {
    console.error('Failed to deliver cached result to unserved subscribers:', error);
    return deliveredUserIds;
  } finally {
    await client.end();
  }
}

/**
 * Publish AnalysisCompleted events for users receiving a cached result via
 * cross-interval delivery. Loads the full result from S3 to include the
 * `tradeRecommendation` object needed by the Portfolio Trade Executor.
 * Enriches with market question from RDS if available.
 */
async function publishCachedDeliveryEvents(
  marketId: string,
  resultId: string,
  resultPayloadS3Key: string,
  recommendation: string,
  consensusProbability: number,
  executedAt: string,
  deliveredUserIds: string[],
): Promise<void> {
  try {
    // Load full result from S3 to extract tradeRecommendation fields
    let tradeRecommendation: Record<string, unknown> | undefined;
    let confidence = 0;
    let edge = 0;
    let marketQuestion = `Market ${marketId}`;

    try {
      const s3Response = await s3Client.send(
        new GetObjectCommand({
          Bucket: ANALYSIS_BUCKET,
          Key: resultPayloadS3Key,
        })
      );
      const body = await s3Response.Body?.transformToString();
      if (body) {
        const parsed = JSON.parse(body);
        confidence = parsed.winProbability ?? parsed.confidence ?? 0;
        edge = parsed.metadata?.edge ?? 0;
        marketQuestion = parsed.metadata?.marketQuestion || marketQuestion;

        // Build the same tradeRecommendation shape the orchestrator includes
        // in fresh AnalysisCompleted events
        tradeRecommendation = {
          action: parsed.action ?? recommendation,
          confidence: parsed.winProbability ?? 0,
          consensusProbability: parsed.metadata?.consensusProbability ?? consensusProbability,
          currentPrice: parsed.metadata?.marketProbability ?? 0,
          edge: parsed.metadata?.edge ?? 0,
          signalAlignment: parsed.metadata?.confidenceBand
            ? 1 - (parsed.metadata.confidenceBand[1] - parsed.metadata.confidenceBand[0])
            : 0.7,
          reasoning: parsed.explanation?.summary ?? '',
          entryZone: parsed.entryZone ?? [0, 0],
          targetZone: parsed.targetZone ?? [0, 0],
          stopLoss: parsed.stopLoss ?? 0,
          liquidityRisk: parsed.liquidityRisk ?? 'medium',
          explanation: parsed.explanation ?? {},
        };
      }
    } catch (s3Error) {
      console.warn(`Failed to load result from S3 (${resultPayloadS3Key}) for cached delivery events:`, s3Error);
      // Continue without tradeRecommendation - PM won't be able to act but
      // user notifications (WebSocket, email, push) will still fire.
    }

    // Fetch market question from RDS if not found in S3
    if (marketQuestion === `Market ${marketId}`) {
      try {
        const connectionString = await getConnectionString();
        const pg = await import('pg');
        const client = new pg.Client({ connectionString, ssl: { rejectUnauthorized: false } });
        await client.connect();
        const result = await client.query(
          `SELECT question FROM markets WHERE condition_id = $1 LIMIT 1`,
          [marketId]
        );
        if (result.rows.length > 0 && result.rows[0].question) {
          marketQuestion = result.rows[0].question;
        }
        await client.end();
      } catch {
        // Non-fatal: use fallback market question
      }
    }

    // Publish in batches of 10 (EventBridge limit)
    for (let i = 0; i < deliveredUserIds.length; i += 10) {
      const batch = deliveredUserIds.slice(i, i + 10);
      await eventBridgeClient.send(
        new PutEventsCommand({
          Entries: batch.map((userId) => ({
            Source: 'tradewizard.analysis',
            DetailType: 'AnalysisCompleted',
            EventBusName: EVENT_BUS_NAME,
            Detail: JSON.stringify({
              analysisId: resultId,
              resultId,
              marketId,
              userId,
              marketQuestion,
              recommendation,
              consensusProbability,
              confidence,
              edge,
              tradeRecommendation,
              resultPayloadS3Key,
              executedAt,
              wasCached: true,
              environment: ENVIRONMENT,
            }),
          })),
        })
      );
    }

    console.log(`Published cached AnalysisCompleted events for ${deliveredUserIds.length} user(s) on market ${marketId}`);
  } catch (error) {
    console.error('Failed to publish cached delivery events:', error);
    // Non-fatal: the delivery records are already written. Users will see
    // the result in their history even if push/email/webhook doesn't fire.
  }
}
async function refundSubscribers(marketId: string, requestId: string): Promise<void> {
  const connectionString = await getConnectionString();
  const pg = await import('pg');
  const client = new pg.Client({ connectionString, ssl: { rejectUnauthorized: false } });

  try {
    await client.connect();

    // Find all users charged for this specific request (by reference_id).
    // The analysis-request handler stores requestId as reference_id on deduction.
    // This is deterministic - no time window, no race conditions.
    const chargedUsers = await client.query(
      `SELECT DISTINCT ct.user_id
       FROM credit_transactions ct
       WHERE ct.reference_id = $1::uuid
         AND ct.reason = 'analysis_request'
         AND ct.amount = -1`,
      [requestId]
    );

    for (const row of chargedUsers.rows) {
      const userId = row.user_id;

      // Attempt to record the refund - ON CONFLICT DO NOTHING prevents double-refunds
      // The partial unique index (user_id, reference_id) WHERE reason = 'analysis_failure_refund'
      // guarantees at most one refund per user per failed request, even on Lambda retries.
      const insertResult = await client.query(
        `INSERT INTO credit_transactions (user_id, amount, balance_after, reason, reference_id, reference_type)
         VALUES ($1, 1, 0, 'analysis_failure_refund', $2::uuid, 'refund')
         ON CONFLICT (user_id, reference_id) WHERE reason = 'analysis_failure_refund' DO NOTHING
         RETURNING id`,
        [userId, requestId]
      );

      // Only bump the balance if the refund row was freshly inserted (not a duplicate)
      if (insertResult.rows.length > 0) {
        const balanceResult = await client.query(
          `UPDATE subscriptions
           SET credits_remaining = credits_remaining + 1
           WHERE user_id = $1 AND status IN ('active', 'grace_period')
           RETURNING credits_remaining`,
          [userId]
        );

        if (balanceResult.rows.length > 0) {
          await client.query(
            `UPDATE credit_transactions SET balance_after = $1 WHERE id = $2`,
            [balanceResult.rows[0].credits_remaining, insertResult.rows[0].id]
          );
          console.log(`Refunded 1 credit to user ${userId}, new balance: ${balanceResult.rows[0].credits_remaining}`);
        }
      } else {
        console.log(`Skipped duplicate refund for user ${userId} on request ${requestId}`);
      }
    }

    console.log(`Refunded ${chargedUsers.rows.length} user(s) for failed request ${requestId}`);
  } catch (refundError) {
    console.error(`Failed to refund for request ${requestId}:`, refundError);
  } finally {
    await client.end();
  }
}


/**
 * Mark an analysis request as 'failed' in RDS so the status endpoint
 * no longer reports it as pending/queued.
 *
 * Best-effort: failure to update the status doesn't block refunds or
 * error publishing. The 5-minute age filter in userHasPendingRequest
 * acts as a safety net if this write fails.
 */
async function markRequestFailed(requestId: string): Promise<void> {
  const connectionString = await getConnectionString();
  const pg = await import('pg');
  const client = new pg.Client({ connectionString, ssl: { rejectUnauthorized: false } });

  try {
    await client.connect();
    await client.query(
      `UPDATE analysis_requests SET status = 'failed', updated_at = now() WHERE id = $1::uuid`,
      [requestId]
    );
    console.log(`Marked analysis request ${requestId} as failed`);
  } catch (error) {
    console.error(`Failed to mark request ${requestId} as failed:`, error);
  } finally {
    await client.end();
  }
}

/**
 * Mark an analysis request as completed in the database.
 * Best-effort - if this fails, the request stays 'active' but the result
 * is still stored and delivered via EventBridge.
 */
async function markRequestCompleted(requestId: string): Promise<void> {
  const connectionString = await getConnectionString();
  const pg = await import('pg');
  const client = new pg.Client({ connectionString, ssl: { rejectUnauthorized: false } });

  try {
    await client.connect();
    await client.query(
      `UPDATE analysis_requests SET status = 'completed', updated_at = now() WHERE id = $1::uuid`,
      [requestId]
    );
    console.log(`Marked analysis request ${requestId} as completed`);
  } catch (error) {
    console.error(`Failed to mark request ${requestId} as completed:`, error);
  } finally {
    await client.end();
  }
}

/**
 * Mark one-time subscriber rows as unsubscribed after their analysis is delivered.
 * This prevents stale one-time subscription rows from causing double-charges
 * when a recurring schedule fires later (chargeAndDeliverToRecurringSubscribers
 * iterates all active subscribers).
 *
 * Unsubscribes ALL subscriber rows for this market that are tied to one-time
 * (non-recurring) analysis requests. This covers both the original dispatcher
 * and any users who joined via "subscribe to in-flight" (Step 3).
 */
async function unsubscribeOneTimeSubscribers(
  marketId: string,
  requestId: string
): Promise<void> {
  const connectionString = await getConnectionString();
  const pg = await import('pg');
  const client = new pg.Client({ connectionString, ssl: { rejectUnauthorized: false } });

  try {
    await client.connect();
    const result = await client.query(
      `UPDATE market_subscribers ms
       SET unsubscribed_at = now()
       FROM analysis_requests ar
       WHERE ms.analysis_request_id = ar.id
         AND ms.market_id = $1
         AND ms.unsubscribed_at IS NULL
         AND ar.request_type = 'one_time'`,
      [marketId]
    );
    const count = result.rowCount ?? 0;
    if (count > 0) {
      console.log(`Unsubscribed ${count} one-time subscriber(s) on market ${marketId} after delivery of request ${requestId}`);
    }
  } catch (error) {
    console.error(`Failed to unsubscribe one-time subscribers for request ${requestId}:`, error);
    // Non-fatal: the DISTINCT ON dedup in chargeAndDeliverToRecurringSubscribers
    // acts as a safety net even if this cleanup fails.
  } finally {
    await client.end();
  }
}

/**
 * Update market_analysis_schedule after a successful scheduled execution.
 * Sets last_completed_at, last_result_id, and advances next_scheduled_run
 * by the stored interval. Best-effort - failure doesn't block delivery.
 */
async function updateScheduleAfterExecution(
  marketId: string,
  resultId: string
): Promise<void> {
  const connectionString = await getConnectionString();
  const pg = await import('pg');
  const client = new pg.Client({ connectionString, ssl: { rejectUnauthorized: false } });

  try {
    await client.connect();
    await client.query(
      `UPDATE market_analysis_schedule
       SET last_completed_at = now(),
           last_result_id = $2::uuid,
           next_scheduled_run = now() + (shortest_interval_seconds * INTERVAL '1 second'),
           is_executing = false,
           updated_at = now()
       WHERE market_id = $1 AND status = 'active'`,
      [marketId, resultId]
    );
    console.log(`Updated market_analysis_schedule for market ${marketId} after execution`);
  } catch (error) {
    console.error(`Failed to update market_analysis_schedule for market ${marketId}:`, error);
  } finally {
    await client.end();
  }
}
