/**
 * Portfolio Notification Lambda - Multi-channel delivery for portfolio events.
 *
 * Triggered by EventBridge events from portfolio manager sources:
 * - tradewizard.portfolio-manager
 * - tradewizard.portfolio.risk-engine
 * - tradewizard.portfolio.lifecycle
 *
 * Handles portfolio-specific notification types:
 * - portfolio.trade.executed → trade placed notification (within 10s)
 * - portfolio.position.exited → position exit notification (within 10s)
 * - portfolio.kill_switch.triggered → override quiet hours, all channels
 * - portfolio.session.paused → explain pause reason, required action
 * - portfolio.risk.alert (level=warning, 30% loss) → override quiet hours
 * - portfolio.daily_summary → daily summary at 00:00 UTC
 *
 * Delivery channels: WebSocket (in-app), Email (Resend by default, SES
 * retained), Push (SNS Mobile)
 * Respects user notification preferences for routine events.
 * Overrides quiet hours for kill switch and loss warning events.
 * Retry logic: 3 retries with exponential backoff (2s, 4s, 8s),
 * fallback to next available channel on failure.
 *
 * Requirements: 11.1, 11.2, 11.3, 11.4, 11.5, 11.6, 7.4
 *
 * Environment variables:
 * - DB_SECRET_ARN: Secrets Manager ARN for RDS credentials
 * - DB_HOST: RDS endpoint hostname
 * - CONNECTIONS_TABLE: DynamoDB table for WebSocket connections
 * - WEBSOCKET_ENDPOINT: API Gateway WebSocket management endpoint URL
 * - EMAIL_PROVIDER: "resend" (default) or "ses"
 * - RESEND_API_KEY_SECRET_ARN: Secrets Manager ARN for the Resend API key
 * - RESEND_FROM_EMAIL: Resend sender address
 * - RESEND_REPLY_TO: Optional Resend reply-to address
 * - SES_FROM_EMAIL: Sender address used by the retained SES fallback
 * - APP_URL: Application base URL for deep links
 */

import { EventBridgeHandler, EventBridgeEvent } from 'aws-lambda';
import {
  ApiGatewayManagementApiClient,
  PostToConnectionCommand,
  GoneException,
} from '@aws-sdk/client-apigatewaymanagementapi';
import { SNSClient, PublishCommand } from '@aws-sdk/client-sns';
import { sendEmail } from '../shared/email';
import { getDbCredentials } from '../shared/db';
import { getConnectionsByUserId, removeConnection } from '../shared/connections';

// ─── Clients ────────────────────────────────────────────────────────────────────

const WEBSOCKET_ENDPOINT = process.env.WEBSOCKET_ENDPOINT || '';
const APP_URL = process.env.APP_URL || 'http://localhost:3000';

const apiGwClient = new ApiGatewayManagementApiClient({
  endpoint: WEBSOCKET_ENDPOINT,
});
const snsClient = new SNSClient({});

// ─── Constants ──────────────────────────────────────────────────────────────────

/** Retry configuration: 3 retries with exponential backoff (2s, 4s, 8s) */
const RETRY_DELAYS_MS = [2000, 4000, 8000];

/** Event types that override quiet hours */
const QUIET_HOURS_OVERRIDE_EVENTS: Set<string> = new Set([
  'portfolio.kill_switch.triggered',
  'portfolio.risk.loss_warning',
]);

/** Plans that allow email notifications (Starter+) */
const EMAIL_ALLOWED_PLANS: string[] = ['starter', 'pro', 'elite'];

/** Plans that allow push notifications (Starter+) */
const PUSH_ALLOWED_PLANS: string[] = ['starter', 'pro', 'elite'];

// ─── Types ──────────────────────────────────────────────────────────────────────

/** Portfolio notification event types */
type PortfolioNotificationEventType =
  | 'portfolio.trade.executed'
  | 'portfolio.position.exited'
  | 'portfolio.kill_switch.triggered'
  | 'portfolio.session.paused'
  | 'portfolio.session.paused-no-analysis'
  | 'portfolio.session.terminated'
  | 'portfolio.risk.loss_warning'
  | 'portfolio.daily_summary';

/** EventBridge event detail for portfolio notifications */
interface PortfolioNotificationDetail {
  userId: string;
  eventType: PortfolioNotificationEventType;
  timestamp: string;
  payload: Record<string, unknown>;
}

/** Trade executed payload - accepts both flat and nested shapes from publishers */
interface TradeExecutedPayload {
  sessionId: string;
  marketName?: string;
  marketId?: string;
  direction: 'YES' | 'NO';
  orderType: 'limit' | 'market';
  size: number;
  price: number;
  reasoning: string;
}

/** Position exited payload - accepts both naming variants from publishers */
interface PositionExitedPayload {
  sessionId: string;
  marketName?: string;
  marketId?: string;
  exitReason: string;
  entryPrice: number;
  exitPrice: number;
  pnl: number;
  holdDurationMinutes?: number;
  holdDuration?: number;
}

/** Kill switch triggered payload */
interface KillSwitchPayload {
  reason: string;
  sessionsAffected: string[];
}

/** Session paused payload */
interface SessionPausedPayload {
  sessionId: string;
  marketName: string;
  pauseReason: string;
  requiredAction: string;
}

/** Loss warning payload */
interface LossWarningPayload {
  sessionId: string;
  marketName: string;
  cumulativeLossPct: number;
  investmentAmount: number;
  message: string;
}

/** Daily summary payload */
interface DailySummaryPayload {
  sessions: Array<{
    sessionId: string;
    marketName: string;
    tradesExecutedToday: number;
    currentPositionDirection: string | null;
    currentPositionSize: number | null;
    unrealizedPnl: number;
    realizedPnl: number;
  }>;
  aggregateTradesToday: number;
  aggregateUnrealizedPnl: number;
  aggregateRealizedPnl: number;
}

/** User notification preferences from RDS */
interface UserNotificationPreferences {
  channelWebsocket: boolean;
  channelEmail: boolean;
  channelPush: boolean;
  quietHoursStart: string | null;
  quietHoursEnd: string | null;
  userEmail: string;
  plan: string;
}

/** Device endpoint for push notifications */
interface DeviceEndpoint {
  platformEndpointArn: string;
  platform: 'ios' | 'android';
}

/** Delivery channel type */
type DeliveryChannel = 'websocket' | 'email' | 'push';

/** Formatted notification content */
interface NotificationContent {
  title: string;
  body: string;
  htmlBody?: string;
  deepLink?: string;
  /** Stable key used by Resend so retries don't duplicate emails. */
  idempotencyKey?: string;
}

// ─── Main Handler ───────────────────────────────────────────────────────────────

/**
 * Portfolio Notification EventBridge Handler.
 *
 * Processes portfolio events (which arrive with EventBridge `detail-type` set
 * to the event name and a flat `detail` object), loads user preferences,
 * formats content, and delivers via appropriate channels with retry logic.
 *
 * Publishers emit `Source: 'tradewizard.portfolio-manager'` (and analogous
 * subsources). The detail type carries the event name (e.g.
 * `portfolio.trade.executed`); the detail itself is a flat record with the
 * user ID and event-specific fields.
 */
export const handler: EventBridgeHandler<string, Record<string, unknown>, void> = async (
  event: EventBridgeEvent<string, Record<string, unknown>>
): Promise<void> => {
  const detail = event.detail || {};
  const eventType = (event['detail-type'] || (detail.eventType as string) || '') as PortfolioNotificationEventType;
  const userId = (detail.userId as string) || '';
  const timestamp = (detail.timestamp as string) || new Date().toISOString();

  if (!userId || !eventType) {
    console.error('Invalid portfolio notification event: missing userId or eventType', JSON.stringify(event));
    return;
  }

  // Some publishers nest event-specific fields under `payload`; others put them
  // directly on `detail`. Normalize so the formatters see a consistent shape.
  const payload =
    (detail.payload as Record<string, unknown> | undefined) ?? detail;

  console.log(`Processing portfolio notification: ${eventType} for user ${userId}`);

  try {
    // 1. Load user notification preferences
    const preferences = await getUserNotificationPreferences(userId);
    if (!preferences) {
      console.log(`No notification preferences found for user=${userId}, skipping notification`);
      return;
    }

    // 2. Determine if this event overrides quiet hours
    const overridesQuietHours = QUIET_HOURS_OVERRIDE_EVENTS.has(eventType);

    // 3. Format notification content based on event type
    const content = formatNotificationContent(eventType, payload, timestamp);
    if (!content) {
      console.error(`Failed to format notification content for event type: ${eventType}`);
      return;
    }

    // Stable across EventBridge redeliveries and channel retries.
    content.idempotencyKey = `portfolio-email/${event.id || `${eventType}-${timestamp}`}/${userId}`;

    // 4. Determine which channels to deliver on
    const channels = getDeliveryChannels(preferences, eventType, overridesQuietHours);

    if (channels.length === 0) {
      console.log(`No delivery channels available for user=${userId}, event=${eventType}`);
      return;
    }

    // 5. Deliver to each channel with retry and fallback
    await deliverWithRetryAndFallback(userId, channels, content, preferences, overridesQuietHours);

    console.log(`Portfolio notification delivered: event=${eventType}, user=${userId}`);
  } catch (error) {
    console.error(`Portfolio notification failed: event=${eventType}, user=${userId}`, error);
  }
};

// ─── Channel Selection ──────────────────────────────────────────────────────────

/**
 * Determine which delivery channels to use based on user preferences,
 * event type, and quiet hours.
 *
 * Kill switch events deliver on ALL enabled channels regardless of quiet hours.
 * Loss warning events override quiet hours.
 * Routine events respect preferences and quiet hours.
 */
function getDeliveryChannels(
  preferences: UserNotificationPreferences,
  eventType: PortfolioNotificationEventType,
  overridesQuietHours: boolean
): DeliveryChannel[] {
  const channels: DeliveryChannel[] = [];
  const inQuietHours = isWithinQuietHours(preferences.quietHoursStart, preferences.quietHoursEnd);

  // For kill switch: deliver on ALL enabled channels regardless of quiet hours
  if (eventType === 'portfolio.kill_switch.triggered') {
    if (preferences.channelWebsocket) channels.push('websocket');
    if (preferences.channelEmail && EMAIL_ALLOWED_PLANS.includes(preferences.plan)) {
      channels.push('email');
    }
    if (preferences.channelPush && PUSH_ALLOWED_PLANS.includes(preferences.plan)) {
      channels.push('push');
    }
    return channels;
  }

  // For events that override quiet hours (loss warning): skip quiet hours check
  const shouldSkipQuietHours = overridesQuietHours;

  // WebSocket is always available (all plans)
  if (preferences.channelWebsocket) {
    if (shouldSkipQuietHours || !inQuietHours) {
      channels.push('websocket');
    }
  }

  // Email requires Starter+ plan
  if (preferences.channelEmail && EMAIL_ALLOWED_PLANS.includes(preferences.plan)) {
    if (shouldSkipQuietHours || !inQuietHours) {
      channels.push('email');
    }
  }

  // Push requires Starter+ plan
  if (preferences.channelPush && PUSH_ALLOWED_PLANS.includes(preferences.plan)) {
    if (shouldSkipQuietHours || !inQuietHours) {
      channels.push('push');
    }
  }

  return channels;
}

// ─── Delivery with Retry and Fallback ───────────────────────────────────────────

/**
 * Deliver notification to channels with retry logic.
 * If delivery fails on a channel after 3 retries, fall back to the next available channel.
 */
async function deliverWithRetryAndFallback(
  userId: string,
  channels: DeliveryChannel[],
  content: NotificationContent,
  preferences: UserNotificationPreferences,
  overridesQuietHours: boolean
): Promise<void> {
  let delivered = false;

  for (const channel of channels) {
    try {
      await deliverToChannelWithRetry(userId, channel, content, preferences);
      delivered = true;
      console.log(`Successfully delivered to channel=${channel} for user=${userId}`);
    } catch (error) {
      console.error(
        `All retries exhausted for channel=${channel}, user=${userId}. Falling back to next channel.`,
        error
      );
      // Continue to next channel as fallback
    }
  }

  if (!delivered) {
    console.error(`Failed to deliver notification on any channel for user=${userId}`);
  }
}

/**
 * Attempt delivery to a single channel with exponential backoff retries.
 * Throws if all retries are exhausted.
 */
async function deliverToChannelWithRetry(
  userId: string,
  channel: DeliveryChannel,
  content: NotificationContent,
  preferences: UserNotificationPreferences
): Promise<void> {
  let lastError: Error | undefined;

  for (let attempt = 0; attempt <= RETRY_DELAYS_MS.length; attempt++) {
    try {
      switch (channel) {
        case 'websocket':
          await deliverViaWebSocket(userId, content);
          return;
        case 'email':
          await deliverViaEmail(preferences.userEmail, content);
          return;
        case 'push':
          await deliverViaPush(userId, content);
          return;
      }
    } catch (error) {
      lastError = error as Error;
      console.warn(
        `Delivery attempt ${attempt + 1} failed for channel=${channel}, user=${userId}: ${lastError.message}`
      );

      // Wait before retry (skip wait on last attempt)
      if (attempt < RETRY_DELAYS_MS.length) {
        await sleep(RETRY_DELAYS_MS[attempt]);
      }
    }
  }

  throw lastError || new Error(`Delivery failed for channel=${channel}`);
}

// ─── Channel Delivery Implementations ───────────────────────────────────────────

/**
 * Deliver notification via WebSocket to all active connections for the user.
 * Throws if no connections exist or all connections fail.
 */
async function deliverViaWebSocket(userId: string, content: NotificationContent): Promise<void> {
  const connectionIds = await getConnectionsByUserId(userId);

  if (connectionIds.length === 0) {
    throw new Error(`No active WebSocket connections for user=${userId}`);
  }

  const wsPayload = Buffer.from(
    JSON.stringify({
      type: 'portfolio.notification',
      title: content.title,
      body: content.body,
      deepLink: content.deepLink,
      timestamp: new Date().toISOString(),
    })
  );

  let successCount = 0;
  for (const connectionId of connectionIds) {
    try {
      await apiGwClient.send(
        new PostToConnectionCommand({
          ConnectionId: connectionId,
          Data: wsPayload,
        })
      );
      successCount++;
    } catch (error: unknown) {
      if (error instanceof GoneException || (error as { statusCode?: number })?.statusCode === 410) {
        console.log(`Connection ${connectionId} is stale (410 Gone), removing`);
        await removeConnection(connectionId);
      } else {
        console.error(`Failed to post to connection ${connectionId}:`, error);
      }
    }
  }

  if (successCount === 0) {
    throw new Error(`All WebSocket connections failed for user=${userId}`);
  }
}

/**
 * Deliver notification via email using the configured provider.
 * Throws on send failure so the caller can retry/fall back.
 */
async function deliverViaEmail(toEmail: string, content: NotificationContent): Promise<void> {
  const htmlBody = content.htmlBody || buildDefaultEmailHtml(content);
  const textBody = content.body;

  const result = await sendEmail({
    to: toEmail,
    subject: `TradeWizard: ${content.title}`,
    html: htmlBody,
    text: textBody,
    idempotencyKey: content.idempotencyKey,
  });

  console.log(
    `Email delivered via ${result.provider}${result.messageId ? ` (${result.messageId})` : ''}`
  );
}

/**
 * Deliver notification via push to all registered device endpoints.
 * Throws if no device endpoints exist or all fail.
 */
async function deliverViaPush(userId: string, content: NotificationContent): Promise<void> {
  const deviceEndpoints = await getDeviceEndpoints(userId);

  if (deviceEndpoints.length === 0) {
    throw new Error(`No device endpoints registered for user=${userId}`);
  }

  let successCount = 0;
  for (const endpoint of deviceEndpoints) {
    try {
      const message = buildPushMessage(endpoint.platform, content);
      await snsClient.send(
        new PublishCommand({
          TargetArn: endpoint.platformEndpointArn,
          Message: JSON.stringify(message),
          MessageStructure: 'json',
        })
      );
      successCount++;
    } catch (error) {
      console.error(`Push failed for endpoint ${endpoint.platformEndpointArn}:`, error);
    }
  }

  if (successCount === 0) {
    throw new Error(`All push endpoints failed for user=${userId}`);
  }
}

// ─── Notification Content Formatting ────────────────────────────────────────────

/**
 * Format notification content based on event type and payload.
 */
function formatNotificationContent(
  eventType: PortfolioNotificationEventType,
  payload: Record<string, unknown>,
  timestamp: string
): NotificationContent | null {
  switch (eventType) {
    case 'portfolio.trade.executed': {
      // The trade executor publishes with trade details nested under `payload.trade`
      const tradeData = (payload.trade as Record<string, unknown>) || {};
      const flatPayload: TradeExecutedPayload = {
        sessionId: payload.sessionId as string,
        marketName: (payload.marketName as string) || undefined,
        marketId: (payload.marketId as string) || undefined,
        direction: (tradeData.direction as 'YES' | 'NO') || (payload.direction as 'YES' | 'NO'),
        orderType: (tradeData.orderType as 'limit' | 'market') || (payload.orderType as 'limit' | 'market'),
        size: (tradeData.size as number) ?? (payload.size as number) ?? 0,
        price: (tradeData.price as number) ?? (payload.price as number) ?? 0,
        reasoning: (tradeData.reasoning as string) || (payload.reasoning as string) || '',
      };
      return formatTradeExecuted(flatPayload);
    }

    case 'portfolio.position.exited':
      return formatPositionExited(payload as unknown as PositionExitedPayload);

    case 'portfolio.kill_switch.triggered':
      return formatKillSwitch(payload as unknown as KillSwitchPayload);

    case 'portfolio.session.paused':
      return formatSessionPaused(payload as unknown as SessionPausedPayload);

    case 'portfolio.session.paused-no-analysis':
      return formatSessionPausedNoAnalysis(payload);

    case 'portfolio.session.terminated':
      return formatSessionTerminated(payload);

    case 'portfolio.risk.loss_warning':
      return formatLossWarning(payload as unknown as LossWarningPayload);

    case 'portfolio.daily_summary':
      return formatDailySummary(payload as unknown as DailySummaryPayload);

    default:
      return null;
  }
}

/**
 * Format the "session paused - recurring analysis cancelled" notification.
 * Published by `portfolio-analysis-consumer` when a user cancels their
 * recurring analysis subscription on a market with an active portfolio
 * session. The detail carries `affectedSessionIds`, `marketId`, `message`,
 * `subscriptionAction`.
 */
function formatSessionPausedNoAnalysis(
  payload: Record<string, unknown>,
): NotificationContent {
  const sessionIds = (payload.affectedSessionIds as string[] | undefined) ?? [];
  const marketId = (payload.marketId as string | undefined) ?? 'unknown market';
  const action = (payload.subscriptionAction as string | undefined) ?? 'cancelled';
  const message =
    (payload.message as string | undefined) ??
    'Your portfolio manager session was paused because the recurring analysis subscription is no longer active.';

  const sessionDeepLink =
    sessionIds.length === 1
      ? `${APP_URL}/portfolio/sessions/${sessionIds[0]}`
      : `${APP_URL}/portfolio`;

  return {
    title: `Portfolio session paused - recurring analysis ${action}`,
    body: [
      `Market: ${marketId}`,
      message,
      'Resume your recurring analysis subscription, or stop the portfolio session manually if you no longer want it.',
    ].join('\n'),
    deepLink: sessionDeepLink,
  };
}

/**
 * Format the session-terminated notification.
 * Published by `portfolio-lifecycle` when a session ends (market resolved,
 * capital depleted, profit target reached, manual stop, kill switch, etc.).
 * The detail carries `terminationReason` and a `report` with totals.
 */
function formatSessionTerminated(
  payload: Record<string, unknown>,
): NotificationContent {
  const reason = (payload.terminationReason as string | undefined) ?? 'ended';
  const report = (payload.report as Record<string, unknown> | undefined) ?? {};
  const sessionId = (payload.sessionId as string | undefined) ?? '';
  const marketOutcome = (payload.marketOutcome as string | undefined) ?? null;

  const totalPnl = Number(report.totalPnl ?? 0);
  const totalTrades = Number(report.totalTrades ?? 0);
  const winRate = Number(report.winRate ?? 0);
  const remainingBalance = Number(report.remainingBalance ?? 0);

  const pnlSign = totalPnl >= 0 ? '+' : '';
  const lines = [
    `Reason: ${reason}`,
    `P&L: ${pnlSign}$${totalPnl.toFixed(2)}`,
    `Trades: ${totalTrades} (win rate: ${(winRate * 100).toFixed(1)}%)`,
    `Remaining balance: $${remainingBalance.toFixed(2)}`,
  ];
  if (marketOutcome) {
    lines.push(`Market outcome: ${marketOutcome}`);
  }

  return {
    title: `Portfolio session ended - ${pnlSign}$${totalPnl.toFixed(2)} on ${reason}`,
    body: lines.join('\n'),
    deepLink: sessionId
      ? `${APP_URL}/portfolio/sessions/${sessionId}`
      : `${APP_URL}/portfolio`,
  };
}

/**
 * Format trade executed notification.
 * Contains: market name, direction, order type, size, price, reasoning summary.
 * The payload arrives with trade details nested under `trade` key and `marketId` (not `marketName`).
 */
function formatTradeExecuted(payload: TradeExecutedPayload): NotificationContent {
  const directionLabel = payload.direction === 'YES' ? '📈 YES' : '📉 NO';
  const orderLabel = payload.orderType === 'market' ? 'Market' : 'Limit';
  const priceFormatted = payload.price != null ? `$${payload.price.toFixed(4)}` : 'market';
  const sizeFormatted = payload.size != null ? `$${payload.size.toFixed(2)}` : 'unknown';
  const marketLabel = payload.marketName || payload.marketId || 'Unknown Market';

  const body = [
    `${marketLabel}`,
    `${directionLabel} • ${orderLabel} Order`,
    `Size: ${sizeFormatted} @ ${priceFormatted}`,
    `Reason: ${truncate(payload.reasoning || 'No reasoning provided', 100)}`,
  ].join('\n');

  return {
    title: `Trade Placed: ${payload.direction || 'Unknown'} on ${truncate(marketLabel, 40)}`,
    body,
    deepLink: `${APP_URL}/portfolio/sessions/${payload.sessionId}`,
  };
}

/**
 * Format position exited notification.
 * Contains: exit reason, entry/exit price, P&L, hold duration.
 * Handles both `holdDurationMinutes` and `holdDuration` field names from publishers.
 */
function formatPositionExited(payload: PositionExitedPayload): NotificationContent {
  const pnlSign = payload.pnl >= 0 ? '+' : '';
  const pnlFormatted = `${pnlSign}$${payload.pnl.toFixed(2)}`;
  const holdMinutes = payload.holdDurationMinutes ?? payload.holdDuration ?? 0;
  const holdDuration = formatDuration(holdMinutes);
  const exitReasonLabel = formatExitReason(payload.exitReason);
  const marketLabel = payload.marketName || payload.marketId || 'Unknown Market';

  const body = [
    `${marketLabel}`,
    `Exit Reason: ${exitReasonLabel}`,
    `Entry: $${payload.entryPrice.toFixed(4)} → Exit: $${payload.exitPrice.toFixed(4)}`,
    `P&L: ${pnlFormatted} • Held: ${holdDuration}`,
  ].join('\n');

  return {
    title: `Position Exited: ${pnlFormatted} on ${truncate(marketLabel, 40)}`,
    body,
    deepLink: `${APP_URL}/portfolio/sessions/${payload.sessionId}`,
  };
}

/**
 * Format kill switch notification.
 * Contains: reason and sessions affected. Overrides quiet hours.
 */
function formatKillSwitch(payload: KillSwitchPayload): NotificationContent {
  const sessionsCount = payload.sessionsAffected.length;

  const body = [
    `⚠️ KILL SWITCH ACTIVATED`,
    `Reason: ${payload.reason}`,
    `${sessionsCount} session(s) terminated. All positions exited.`,
    `All pending orders cancelled.`,
  ].join('\n');

  return {
    title: `🚨 Kill Switch Triggered - ${sessionsCount} Session(s) Terminated`,
    body,
    deepLink: `${APP_URL}/portfolio`,
  };
}

/**
 * Format session paused notification.
 * Contains: pause reason, market name, required user action.
 */
function formatSessionPaused(payload: SessionPausedPayload): NotificationContent {
  const body = [
    `Session paused: ${payload.marketName}`,
    `Reason: ${payload.pauseReason}`,
    `Action required: ${payload.requiredAction}`,
  ].join('\n');

  return {
    title: `Session Paused: ${truncate(payload.marketName, 50)}`,
    body,
    deepLink: `${APP_URL}/portfolio/sessions/${payload.sessionId}`,
  };
}

/**
 * Format loss warning notification (30% threshold).
 * Overrides quiet hours.
 */
function formatLossWarning(payload: LossWarningPayload): NotificationContent {
  const lossPct = (payload.cumulativeLossPct * 100).toFixed(1);

  const body = [
    `⚠️ Loss Warning: ${payload.marketName}`,
    `Cumulative loss has reached ${lossPct}% of investment ($${payload.investmentAmount.toFixed(2)}).`,
    `Position sizing reduced by 50% for subsequent trades.`,
    payload.message,
  ].join('\n');

  return {
    title: `⚠️ Loss Warning: ${lossPct}% on ${truncate(payload.marketName, 40)}`,
    body,
    deepLink: `${APP_URL}/portfolio/sessions/${payload.sessionId}`,
  };
}

/**
 * Format daily summary notification (00:00 UTC).
 * Contains: trades executed, current positions, unrealized P&L, realized P&L.
 */
function formatDailySummary(payload: DailySummaryPayload): NotificationContent {
  const unrealizedSign = payload.aggregateUnrealizedPnl >= 0 ? '+' : '';
  const realizedSign = payload.aggregateRealizedPnl >= 0 ? '+' : '';

  const sessionLines = payload.sessions.map((s) => {
    const uPnl = s.unrealizedPnl >= 0 ? `+$${s.unrealizedPnl.toFixed(2)}` : `-$${Math.abs(s.unrealizedPnl).toFixed(2)}`;
    const posLabel = s.currentPositionDirection
      ? `${s.currentPositionDirection} ($${s.currentPositionSize?.toFixed(2) ?? '0.00'})`
      : 'No position';
    return `• ${truncate(s.marketName, 30)}: ${s.tradesExecutedToday} trades, ${posLabel}, ${uPnl} unrealized`;
  });

  const body = [
    `📊 Daily Portfolio Summary`,
    `Trades today: ${payload.aggregateTradesToday}`,
    `Unrealized P&L: ${unrealizedSign}$${payload.aggregateUnrealizedPnl.toFixed(2)}`,
    `Realized P&L: ${realizedSign}$${payload.aggregateRealizedPnl.toFixed(2)}`,
    '',
    ...sessionLines,
  ].join('\n');

  return {
    title: `📊 Daily Summary: ${payload.aggregateTradesToday} trades, ${unrealizedSign}$${payload.aggregateUnrealizedPnl.toFixed(2)} unrealized`,
    body,
    deepLink: `${APP_URL}/portfolio`,
  };
}

// ─── Database Queries ───────────────────────────────────────────────────────────

/**
 * Load user notification preferences and subscription plan from RDS.
 * Returns null if no preferences found.
 */
async function getUserNotificationPreferences(
  userId: string
): Promise<UserNotificationPreferences | null> {
  const creds = await getDbCredentials();
  const connectionString = `postgresql://${creds.username}:${encodeURIComponent(creds.password)}@${creds.host}:${creds.port}/${creds.dbname}?sslmode=no-verify`;

  const pg = await import('pg');
  const client = new pg.Client({ connectionString, ssl: { rejectUnauthorized: false } });

  try {
    await client.connect();

    const result = await client.query(
      `SELECT
        np.channel_in_app AS channel_websocket,
        np.channel_email,
        np.channel_push,
        np.quiet_hours_start,
        np.quiet_hours_end,
        u.email AS user_email,
        COALESCE(s.plan, 'free') AS plan
      FROM notification_preferences np
      JOIN users u ON u.id = np.user_id
      LEFT JOIN subscriptions s ON s.user_id = u.id AND s.status = 'active'
      WHERE np.user_id = $1
        AND np.market_id IS NULL
      LIMIT 1`,
      [userId]
    );

    if (result.rows.length === 0) {
      return null;
    }

    const row = result.rows[0];
    return {
      channelWebsocket: row.channel_websocket ?? true,
      channelEmail: row.channel_email ?? false,
      channelPush: row.channel_push ?? false,
      quietHoursStart: row.quiet_hours_start ? formatTime(row.quiet_hours_start) : null,
      quietHoursEnd: row.quiet_hours_end ? formatTime(row.quiet_hours_end) : null,
      userEmail: row.user_email,
      plan: row.plan,
    };
  } finally {
    await client.end();
  }
}

/**
 * Query user's registered device endpoints from RDS for push notifications.
 */
async function getDeviceEndpoints(userId: string): Promise<DeviceEndpoint[]> {
  const creds = await getDbCredentials();
  const connectionString = `postgresql://${creds.username}:${encodeURIComponent(creds.password)}@${creds.host}:${creds.port}/${creds.dbname}?sslmode=no-verify`;

  const pg = await import('pg');
  const client = new pg.Client({ connectionString, ssl: { rejectUnauthorized: false } });

  try {
    await client.connect();

    const result = await client.query(
      `SELECT platform_endpoint_arn, platform
       FROM device_endpoints
       WHERE user_id = $1
         AND is_active = true`,
      [userId]
    );

    return result.rows.map((row: { platform_endpoint_arn: string; platform: string }) => ({
      platformEndpointArn: row.platform_endpoint_arn,
      platform: row.platform as 'ios' | 'android',
    }));
  } finally {
    await client.end();
  }
}

// ─── Quiet Hours Logic ──────────────────────────────────────────────────────────

/**
 * Check if the current time falls within the user's quiet hours window.
 * Handles overnight ranges (e.g., 22:00 - 07:00).
 */
export function isWithinQuietHours(start: string | null, end: string | null): boolean {
  if (!start || !end) return false;

  const now = new Date();
  const currentMinutes = now.getUTCHours() * 60 + now.getUTCMinutes();

  const startMinutes = parseTimeToMinutes(start);
  const endMinutes = parseTimeToMinutes(end);

  if (startMinutes === null || endMinutes === null) return false;
  if (startMinutes === endMinutes) return false;

  // Handle overnight range (e.g., 22:00 - 07:00)
  if (startMinutes > endMinutes) {
    return currentMinutes >= startMinutes || currentMinutes < endMinutes;
  }

  // Normal range (e.g., 01:00 - 06:00)
  return currentMinutes >= startMinutes && currentMinutes < endMinutes;
}

/**
 * Parse a HH:MM time string into total minutes since midnight.
 * Returns null if the format is invalid.
 */
function parseTimeToMinutes(time: string): number | null {
  const match = time.match(/^(\d{1,2}):(\d{2})$/);
  if (!match) return null;

  const hours = parseInt(match[1], 10);
  const minutes = parseInt(match[2], 10);

  if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59) {
    return null;
  }

  return hours * 60 + minutes;
}

// ─── Push Notification Helpers ──────────────────────────────────────────────────

/**
 * Build platform-specific push notification message for SNS Mobile Push.
 */
function buildPushMessage(
  platform: 'ios' | 'android',
  content: NotificationContent
): Record<string, string> {
  // Truncate body for push notification limits
  const truncatedBody = content.body.length > 200
    ? `${content.body.slice(0, 197)}...`
    : content.body;

  if (platform === 'ios') {
    const apnsPayload = {
      aps: {
        alert: {
          title: content.title,
          body: truncatedBody,
        },
        sound: 'default',
        badge: 1,
        'mutable-content': 1,
      },
      deepLink: content.deepLink,
    };
    return {
      default: truncatedBody,
      APNS: JSON.stringify(apnsPayload),
      APNS_SANDBOX: JSON.stringify(apnsPayload),
    };
  }

  // FCM (Android) payload
  const gcmPayload = {
    notification: {
      title: content.title,
      body: truncatedBody,
      sound: 'default',
      click_action: 'OPEN_PORTFOLIO',
    },
    data: {
      deepLink: content.deepLink,
    },
  };
  return {
    default: truncatedBody,
    GCM: JSON.stringify(gcmPayload),
  };
}

// ─── Email Template ─────────────────────────────────────────────────────────────

/**
 * Build a default HTML email template for portfolio notifications.
 */
function buildDefaultEmailHtml(content: NotificationContent): string {
  const escapedTitle = escapeHtml(content.title);
  const escapedBody = escapeHtml(content.body).replace(/\n/g, '<br>');
  const ctaUrl = content.deepLink || `${APP_URL}/portfolio`;

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapedTitle}</title>
</head>
<body style="margin: 0; padding: 0; background-color: #f4f4f7; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color: #f4f4f7;">
    <tr>
      <td align="center" style="padding: 40px 20px;">
        <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="background-color: #ffffff; border-radius: 8px; overflow: hidden; box-shadow: 0 2px 8px rgba(0,0,0,0.08);">
          <tr>
            <td style="background-color: #1a1a2e; padding: 24px 32px;">
              <h1 style="margin: 0; color: #ffffff; font-size: 20px; font-weight: 600;">TradeWizard Portfolio</h1>
            </td>
          </tr>
          <tr>
            <td style="padding: 32px 32px 16px;">
              <h2 style="margin: 0 0 16px; color: #1f2937; font-size: 18px; font-weight: 600;">${escapedTitle}</h2>
              <p style="margin: 0; color: #374151; font-size: 14px; line-height: 1.6;">${escapedBody}</p>
            </td>
          </tr>
          <tr>
            <td style="padding: 24px 32px;">
              <table role="presentation" cellpadding="0" cellspacing="0" width="100%">
                <tr>
                  <td align="center">
                    <a href="${ctaUrl}" style="display: inline-block; background-color: #4f46e5; color: #ffffff; padding: 12px 32px; border-radius: 6px; text-decoration: none; font-size: 14px; font-weight: 600;">View in Dashboard</a>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
          <tr>
            <td style="padding: 24px 32px; border-top: 1px solid #e5e7eb;">
              <p style="margin: 0; color: #9ca3af; font-size: 12px; text-align: center;">
                You're receiving this because you have portfolio notifications enabled.
                <br>Manage preferences in your <a href="${APP_URL}/account" style="color: #4f46e5; text-decoration: none;">account settings</a>.
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

// ─── Utility Functions ──────────────────────────────────────────────────────────

/**
 * Format a TIME value from PostgreSQL to HH:MM string.
 */
function formatTime(timeValue: string): string {
  const parts = timeValue.toString().split(':');
  return `${parts[0].padStart(2, '0')}:${parts[1].padStart(2, '0')}`;
}

/**
 * Format exit reason enum to human-readable label.
 */
function formatExitReason(reason: string): string {
  const labels: Record<string, string> = {
    target_reached: 'Target Reached',
    stop_loss: 'Stop Loss Hit',
    regime_shift: 'Regime Shift Detected',
    stale_market: 'Stale Market',
    contradicting_analysis: 'Contradicting Analysis',
    risk_limit: 'Risk Limit Reached',
    user_stop: 'User Stopped',
    market_resolved: 'Market Resolved',
  };
  return labels[reason] || reason;
}

/**
 * Format duration in minutes to human-readable string.
 */
function formatDuration(minutes: number): string {
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  if (hours < 24) {
    return remainingMinutes > 0 ? `${hours}h ${remainingMinutes}m` : `${hours}h`;
  }
  const days = Math.floor(hours / 24);
  const remainingHours = hours % 24;
  return remainingHours > 0 ? `${days}d ${remainingHours}h` : `${days}d`;
}

/**
 * Truncate a string to a maximum length with ellipsis.
 */
function truncate(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text;
  return `${text.slice(0, maxLength - 3)}...`;
}

/**
 * Escape HTML special characters.
 */
function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

/**
 * Sleep for a specified number of milliseconds.
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
