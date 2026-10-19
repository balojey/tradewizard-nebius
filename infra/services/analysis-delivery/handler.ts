/**
 * Analysis Delivery Lambda - WebSocket Push.
 *
 * Triggered by SNS Analysis Complete Topic. EventBridge routes both
 * `AnalysisCompleted` and `AnalysisFailed` events to this topic, wrapping
 * the original event in `{detail, 'detail-type', source, ...}`. The handler
 * dispatches on `detail-type` to render the right WebSocket message.
 *
 * Stale connections (410 Gone) are automatically cleaned up from DynamoDB.
 * If no connections exist for the user, the handler skips silently.
 *
 * Environment variables:
 * - CONNECTIONS_TABLE: DynamoDB table name for WebSocket connections
 * - WEBSOCKET_ENDPOINT: API Gateway WebSocket management endpoint URL
 */

import { SNSHandler, SNSEvent } from 'aws-lambda';
import {
  ApiGatewayManagementApiClient,
  PostToConnectionCommand,
  GoneException,
} from '@aws-sdk/client-apigatewaymanagementapi';
import { getConnectionsByUserId, removeConnection } from '../shared/connections';
import { getUserIdByCognitoSub, getConnectionString } from '../shared/db';

const WEBSOCKET_ENDPOINT = process.env.WEBSOCKET_ENDPOINT || '';

const apiGwClient = new ApiGatewayManagementApiClient({
  endpoint: WEBSOCKET_ENDPOINT,
});

interface AnalysisCompleteEvent {
  userId: string;
  analysisId: string;
  analysisRequestId?: string;
  resultId?: string;
  marketId: string;
  marketQuestion: string;
  recommendation: string;
  consensusProbability: number;
  confidence: number;
  resultPayloadS3Key: string;
  executedAt: string;
  wasCached?: boolean;
}

interface AnalysisFailedEvent {
  userId: string;
  marketId: string;
  requestId: string;
  error: string;
  environment?: string;
}

interface AnalysisProgressEvent {
  userId: string;
  analysisId: string;
  marketId: string;
  stage: number;
  totalStages: number;
  stageName: string;
  status: string;
  progress: number;
  timestamp: string;
}

interface WebSocketCompletePayload {
  type: 'analysis_complete';
  data: {
    analysisId: string;
    marketId: string;
    marketQuestion: string;
    recommendation: string;
    consensusProbability: number;
    confidence: number;
    executedAt: string;
  };
}

interface WebSocketFailurePayload {
  type: 'analysis_failed';
  data: {
    requestId: string;
    marketId: string;
    error: string;
    timestamp: string;
  };
}

interface WebSocketProgressPayload {
  type: 'analysis_progress';
  payload: {
    analysisId: string;
    marketId: string;
    stage: number;
    totalStages: number;
    stageName: string;
    status: string;
    progress: number;
    timestamp: string;
  };
}

type WebSocketDeliveryPayload = WebSocketCompletePayload | WebSocketFailurePayload | WebSocketProgressPayload;

/**
 * Analysis Delivery SNS Handler - handles both completion and failure events.
 */
export const handler: SNSHandler = async (event: SNSEvent): Promise<void> => {
  for (const record of event.Records) {
    // EventBridge wraps the event in an envelope when routing to SNS.
    const rawMessage = JSON.parse(record.Sns.Message);
    const detailType = rawMessage['detail-type'] as string | undefined;
    const detail = rawMessage.detail || rawMessage;

    try {
      if (detailType === 'AnalysisFailed') {
        await deliverFailure(detail as AnalysisFailedEvent);
      } else if (detailType === 'AnalysisProgress') {
        await deliverProgress(detail as AnalysisProgressEvent);
      } else {
        // Default to completion for AnalysisCompleted or legacy raw messages.
        await deliverCompletion(detail as AnalysisCompleteEvent);
      }
    } catch (error) {
      console.error('analysis-delivery: failed to process record', error);
      // Swallow per-record errors so other records in the batch still process.
    }
  }
};

/**
 * Deliver a successful analysis completion to the user's WebSocket connections.
 */
async function deliverCompletion(message: AnalysisCompleteEvent): Promise<void> {
  const { userId, analysisId, marketId, marketQuestion, recommendation, consensusProbability, confidence, executedAt } = message;

  if (!userId) {
    console.warn('analysis-delivery: AnalysisCompleted event missing userId', message);
    return;
  }

  console.log(`Delivering analysis ${analysisId} to user ${userId}`);

  const connectionIds = await getConnectionsByUserId(userId);
  if (connectionIds.length === 0) {
    console.log(`No active connections for user ${userId}, skipping WebSocket delivery`);
    return;
  }

  const payload: WebSocketCompletePayload = {
    type: 'analysis_complete',
    data: {
      analysisId,
      marketId,
      marketQuestion,
      recommendation,
      consensusProbability,
      confidence,
      executedAt,
    },
  };

  await fanOut(connectionIds, payload);
  console.log(`Delivered analysis ${analysisId} to ${connectionIds.length} connection(s) for user ${userId}`);

  // Record successful WebSocket delivery in analysis_deliveries table
  await recordWebSocketDelivery(message);
}

/**
 * Deliver a failure notification to the user's WebSocket connections.
 */
async function deliverFailure(message: AnalysisFailedEvent): Promise<void> {
  const { userId, marketId, requestId, error } = message;

  if (!userId) {
    console.warn('analysis-delivery: AnalysisFailed event missing userId', message);
    return;
  }

  console.log(`Delivering failure ${requestId} to user ${userId}: ${error}`);

  const connectionIds = await getConnectionsByUserId(userId);
  if (connectionIds.length === 0) {
    console.log(`No active connections for user ${userId}, skipping failure WebSocket delivery`);
    return;
  }

  const payload: WebSocketFailurePayload = {
    type: 'analysis_failed',
    data: {
      requestId,
      marketId,
      error,
      timestamp: new Date().toISOString(),
    },
  };

  await fanOut(connectionIds, payload);
  console.log(`Delivered failure ${requestId} to ${connectionIds.length} connection(s) for user ${userId}`);
}

/**
 * Deliver a stage progress update to the user's WebSocket connections.
 */
async function deliverProgress(message: AnalysisProgressEvent): Promise<void> {
  const { userId, analysisId, marketId, stage, totalStages, stageName, status, progress, timestamp } = message;

  if (!userId) {
    return; // Can't deliver without userId
  }

  // The userId from Python orchestrator is the Cognito sub (passed through
  // from the Lambda payload). WebSocket connections are stored by internal
  // users.id. Try to resolve; fall back to raw userId if lookup fails.
  let resolvedUserId = userId;
  try {
    const internalId = await getUserIdByCognitoSub(userId);
    if (internalId) {
      resolvedUserId = internalId;
    }
  } catch {
    // Fall through with original userId
  }

  const connectionIds = await getConnectionsByUserId(resolvedUserId);
  if (connectionIds.length === 0) {
    return; // No active connections, skip silently
  }

  const payload: WebSocketProgressPayload = {
    type: 'analysis_progress',
    payload: {
      analysisId,
      marketId,
      stage,
      totalStages,
      stageName,
      status,
      progress,
      timestamp,
    },
  };

  await fanOut(connectionIds, payload);
}

/**
 * Fan out a payload to a list of WebSocket connection IDs.
 */
async function fanOut(connectionIds: string[], payload: WebSocketDeliveryPayload): Promise<void> {
  const payloadBytes = Buffer.from(JSON.stringify(payload));
  await Promise.all(
    connectionIds.map((connectionId) => postToConnection(connectionId, payloadBytes))
  );
}

/**
 * Post a message to a single WebSocket connection.
 * If the connection is stale (410 Gone), remove it from DynamoDB.
 */
async function postToConnection(connectionId: string, data: Uint8Array): Promise<void> {
  try {
    await apiGwClient.send(
      new PostToConnectionCommand({
        ConnectionId: connectionId,
        Data: data,
      })
    );
  } catch (error: unknown) {
    if (error instanceof GoneException || (error as { statusCode?: number })?.statusCode === 410) {
      console.log(`Connection ${connectionId} is stale (410 Gone), removing from DynamoDB`);
      await removeConnection(connectionId);
    } else {
      console.error(`Failed to post to connection ${connectionId}:`, error);
    }
  }
}

// ─── Delivery Recording ─────────────────────────────────────────────────────────

/**
 * Record WebSocket delivery in the analysis_deliveries table.
 * This ensures per-user delivery tracking is consistent across all channels
 * and prevents duplicate billing when other channels also deliver.
 *
 * Logs failures without throwing - recording should never break the delivery flow.
 */
async function recordWebSocketDelivery(message: AnalysisCompleteEvent): Promise<void> {
  try {
    const connectionString = await getConnectionString();
    const pg = await import('pg');
    const client = new pg.Client({ connectionString, ssl: { rejectUnauthorized: false } });

    await client.connect();

    try {
      const resultId = message.resultId || message.analysisId;
      if (message.analysisRequestId) {
        await client.query(
          `INSERT INTO analysis_deliveries (result_id, user_id, analysis_request_id, delivery_channel, was_cached_delivery)
           VALUES ($1::uuid, $2::uuid, $3::uuid, 'websocket', $4)
           ON CONFLICT (result_id, user_id, analysis_request_id) DO NOTHING`,
          [resultId, message.userId, message.analysisRequestId, message.wasCached || false]
        );
      } else {
        // Fallback: look up the latest active analysis request for this market+user
        await client.query(
          `INSERT INTO analysis_deliveries (result_id, user_id, analysis_request_id, delivery_channel, was_cached_delivery)
           SELECT $1::uuid, $2::uuid, areq.id, 'websocket', $3
           FROM (
             SELECT id FROM analysis_requests
             WHERE user_id = $2::uuid AND market_id = $4 AND status = 'active'
             ORDER BY created_at DESC
             LIMIT 1
           ) areq
           ON CONFLICT (result_id, user_id, analysis_request_id) DO NOTHING`,
          [resultId, message.userId, message.wasCached || false, message.marketId]
        );
      }

      console.log(`Delivery recorded: user=${message.userId}, analysis=${message.analysisId}, channel=websocket`);
    } finally {
      await client.end();
    }
  } catch (error) {
    // Don't throw - recording failures shouldn't break the delivery flow
    console.error(`Failed to record WebSocket delivery for analysis=${message.analysisId}:`, error);
  }
}
