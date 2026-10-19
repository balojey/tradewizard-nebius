/**
 * Portfolio WebSocket Delivery Lambda - Real-time Portfolio Updates.
 *
 * Triggered by EventBridge events with sources:
 * - tradewizard.portfolio-manager
 * - tradewizard.portfolio.risk-engine
 * - tradewizard.portfolio.lifecycle
 *
 * Handles portfolio-specific event types:
 * - portfolio.session.updated → push session status, P&L updates
 * - portfolio.trade.executed → push trade details
 * - portfolio.position.exited → push exit details with P&L
 * - portfolio.risk.alert → push risk warning/critical alerts
 * - portfolio.kill_switch.triggered → push kill switch notification
 *
 * Queries DynamoDB for all active WebSocket connections for the target user
 * and pushes the portfolio event via ApiGatewayManagementApi PostToConnection.
 *
 * Stale connections (410 Gone) are automatically cleaned up from DynamoDB.
 * If no connections exist for the user, the handler skips silently.
 *
 * Requirements: 9.2, 11.1, 11.2, 11.3, 11.4
 *
 * Environment variables:
 * - CONNECTIONS_TABLE: DynamoDB table name for WebSocket connections
 * - WEBSOCKET_ENDPOINT: API Gateway WebSocket management endpoint URL
 */

import { EventBridgeHandler, EventBridgeEvent } from 'aws-lambda';
import {
  ApiGatewayManagementApiClient,
  PostToConnectionCommand,
  GoneException,
} from '@aws-sdk/client-apigatewaymanagementapi';
import { getConnectionsByUserId, removeConnection } from '../shared/connections';

const WEBSOCKET_ENDPOINT = process.env.WEBSOCKET_ENDPOINT || '';

const apiGwClient = new ApiGatewayManagementApiClient({
  endpoint: WEBSOCKET_ENDPOINT,
});

// ============================================================================
// EVENT DETAIL TYPES
// ============================================================================

/** Valid portfolio event types routed through EventBridge */
type PortfolioEventType =
  | 'portfolio.session.updated'
  | 'portfolio.trade.executed'
  | 'portfolio.position.exited'
  | 'portfolio.risk.alert'
  | 'portfolio.risk.loss_warning'
  | 'portfolio.kill_switch.triggered'
  | 'portfolio.session.paused'
  | 'portfolio.session.paused-no-analysis'
  | 'portfolio.session.terminated'
  | 'portfolio.daily_summary';

/** Base shape for all portfolio EventBridge event details */
interface PortfolioEventDetail {
  userId: string;
  eventType: PortfolioEventType;
  timestamp: string;
  payload: Record<string, unknown>;
}

// ============================================================================
// WEBSOCKET PAYLOAD TYPES
// ============================================================================

interface SessionUpdatedPayload {
  type: 'portfolio.session.updated';
  sessionId: string;
  status: string;
  unrealizedPnl: number;
  realizedPnl: number;
  timestamp: string;
}

interface TradeExecutedPayload {
  type: 'portfolio.trade.executed';
  sessionId: string;
  trade: {
    direction: string;
    orderType: string;
    size: number;
    price: number;
    reasoning: string;
  };
  timestamp: string;
}

interface PositionExitedPayload {
  type: 'portfolio.position.exited';
  sessionId: string;
  exitReason: string;
  pnl: number;
  holdDuration: number;
  timestamp: string;
}

interface RiskAlertPayload {
  type: 'portfolio.risk.alert';
  level: 'warning' | 'critical';
  message: string;
  sessionsAffected: string[];
  timestamp: string;
}

interface KillSwitchTriggeredPayload {
  type: 'portfolio.kill_switch.triggered';
  reason: string;
  sessionsAffected: string[];
  timestamp: string;
}

/**
 * Generic passthrough payload for events that don't have a dedicated WS shape.
 * Lets the frontend render an event-aware notification by reading detail keys
 * directly without us having to maintain a 1:1 mapping for every event type.
 */
interface GenericPortfolioPayload {
  type: PortfolioEventType;
  timestamp: string;
  detail: Record<string, unknown>;
}

type PortfolioWebSocketPayload =
  | SessionUpdatedPayload
  | TradeExecutedPayload
  | PositionExitedPayload
  | RiskAlertPayload
  | KillSwitchTriggeredPayload
  | GenericPortfolioPayload;

// ============================================================================
// HANDLER
// ============================================================================

/**
 * Portfolio WebSocket Delivery EventBridge Handler.
 *
 * Processes EventBridge events from portfolio manager components. The events
 * carry `Source: 'tradewizard.portfolio-manager'` (or risk-engine /
 * lifecycle subsources) and a `detail-type` matching the event name
 * (e.g. `portfolio.trade.executed`). The detail itself is a flat record
 * with `userId` plus event-specific fields.
 *
 * Fans out to all active WebSocket connections for the target user.
 */
export const handler: EventBridgeHandler<string, Record<string, unknown>, void> = async (
  event: EventBridgeEvent<string, Record<string, unknown>>
): Promise<void> => {
  const detail = event.detail || {};
  const eventType = (event['detail-type'] || (detail.eventType as string) || '') as PortfolioEventType;
  const userId = (detail.userId as string) || '';
  const timestamp = (detail.timestamp as string) || new Date().toISOString();

  if (!userId || !eventType) {
    console.error('Invalid portfolio event: missing userId or eventType', JSON.stringify(event));
    return;
  }

  // Some publishers nest event-specific fields under `payload`; most put them
  // directly on `detail`. Normalize so the payload builder sees a consistent shape.
  const payload =
    (detail.payload as Record<string, unknown> | undefined) ?? detail;

  console.log(`Processing portfolio event: ${eventType} for user ${userId}`);

  // Query all active connections for this user
  const connectionIds = await getConnectionsByUserId(userId);

  if (connectionIds.length === 0) {
    console.log(`No active connections for user ${userId}, skipping WebSocket delivery`);
    return;
  }

  // Build the WebSocket message payload based on event type
  const wsPayload = buildWebSocketPayload(eventType, timestamp, payload);

  if (!wsPayload) {
    console.error(`Unknown portfolio event type: ${eventType}`);
    return;
  }

  const payloadBytes = Buffer.from(JSON.stringify(wsPayload));

  // Fan out to all connections
  const deliveryPromises = connectionIds.map((connectionId) =>
    postToConnection(connectionId, payloadBytes)
  );

  const results = await Promise.allSettled(deliveryPromises);

  const successCount = results.filter((r) => r.status === 'fulfilled').length;
  console.log(
    `Delivered portfolio event ${eventType} to ${successCount}/${connectionIds.length} connection(s) for user ${userId}`
  );
};

// ============================================================================
// PAYLOAD BUILDERS
// ============================================================================

/**
 * Build the WebSocket payload from the EventBridge event detail.
 * Maps each portfolio event type to its corresponding WebSocket message shape.
 */
function buildWebSocketPayload(
  eventType: PortfolioEventType,
  timestamp: string,
  payload: Record<string, unknown>
): PortfolioWebSocketPayload | null {
  switch (eventType) {
    case 'portfolio.session.updated':
      return {
        type: 'portfolio.session.updated',
        sessionId: payload.sessionId as string,
        status: payload.status as string,
        unrealizedPnl: payload.unrealizedPnl as number,
        realizedPnl: payload.realizedPnl as number,
        timestamp,
      };

    case 'portfolio.trade.executed':
      return {
        type: 'portfolio.trade.executed',
        sessionId: payload.sessionId as string,
        trade: {
          direction: (payload.trade as Record<string, unknown>)?.direction as string,
          orderType: (payload.trade as Record<string, unknown>)?.orderType as string,
          size: (payload.trade as Record<string, unknown>)?.size as number,
          price: (payload.trade as Record<string, unknown>)?.price as number,
          reasoning: (payload.trade as Record<string, unknown>)?.reasoning as string,
        },
        timestamp,
      };

    case 'portfolio.position.exited':
      return {
        type: 'portfolio.position.exited',
        sessionId: payload.sessionId as string,
        exitReason: payload.exitReason as string,
        pnl: payload.pnl as number,
        holdDuration: payload.holdDuration as number,
        timestamp,
      };

    case 'portfolio.risk.alert':
      return {
        type: 'portfolio.risk.alert',
        level: payload.level as 'warning' | 'critical',
        message: payload.message as string,
        sessionsAffected: payload.sessionsAffected as string[],
        timestamp,
      };

    case 'portfolio.kill_switch.triggered':
      return {
        type: 'portfolio.kill_switch.triggered',
        reason: payload.reason as string,
        sessionsAffected: payload.sessionsAffected as string[],
        timestamp,
      };

    case 'portfolio.session.paused':
    case 'portfolio.session.paused-no-analysis':
    case 'portfolio.session.terminated':
    case 'portfolio.risk.loss_warning':
    case 'portfolio.daily_summary':
      // Pass through with the full detail so the frontend can render the
      // event without us hard-coding a shape for every variant. The frontend
      // reads `detail.*` for event-specific fields (sessionId, reason, etc.).
      return {
        type: eventType,
        timestamp,
        detail: payload,
      };

    default:
      return null;
  }
}

// ============================================================================
// CONNECTION UTILITIES
// ============================================================================

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
