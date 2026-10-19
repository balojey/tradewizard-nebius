/**
 * Push Notification Delivery Lambda - SNS Mobile Push.
 *
 * Triggered by the Analysis Complete SNS Topic. Sends push notifications
 * to users via Amazon SNS Mobile Push platform endpoints.
 *
 * Flow:
 * 1. Parse SNS message for userId, analysisId, marketQuestion, recommendation, consensusProbability
 * 2. Query notification_preferences and subscription from RDS for the user
 * 3. If channelPush disabled → skip
 * 4. If user is on free plan → skip (push requires Starter+ plan)
 * 5. If within quiet hours → skip
 * 6. Publish push notification via SNS Mobile Push (platform endpoint ARN)
 * 7. Record delivery in analysis_deliveries table
 *
 * Environment variables:
 * - DB_SECRET_ARN: Secrets Manager ARN for RDS credentials
 * - DB_HOST: RDS endpoint hostname
 * - APP_URL: Application base URL for deep links
 */

import { SNSHandler, SNSEvent } from 'aws-lambda';
import { SNSClient, PublishCommand } from '@aws-sdk/client-sns';
import { getDbCredentials } from '../shared/db';
import { isWithinQuietHours, formatTime, isBelowProbabilityShiftThreshold, PUSH_ALLOWED_PLANS, resolveMarketSlug } from '../shared/delivery-utils';

const snsClient = new SNSClient({});
const APP_URL = process.env.APP_URL || 'http://localhost:3000';

// ─── Types ──────────────────────────────────────────────────────────────────────

/**
 * SNS Analysis Complete message payload.
 */
interface AnalysisCompleteMessage {
  userId: string;
  analysisId: string;
  analysisRequestId?: string;
  resultId?: string;
  marketId: string;
  marketQuestion: string;
  recommendation: 'LONG_YES' | 'LONG_NO' | 'NO_TRADE';
  consensusProbability: number;
  confidence: number;
  resultPayloadS3Key: string;
  executedAt: string;
  wasCached: boolean;
}

interface PushNotificationPreferences {
  channelPush: boolean;
  quietHoursStart: string | null; // HH:MM format
  quietHoursEnd: string | null;   // HH:MM format
  plan: string;
  subscriptionStatus: string;
  minProbabilityShift: number | null;
}

/**
 * User device endpoint row from RDS.
 */
interface DeviceEndpoint {
  platformEndpointArn: string;
  platform: 'ios' | 'android';
}

// ─── Main Handler ───────────────────────────────────────────────────────────────

/**
 * Main Lambda handler - processes SNS events for push notification delivery.
 * Handles both AnalysisCompleted and AnalysisFailed events; failure events
 * trigger a short text-only push so users know their analysis didn't complete
 * (their credit was already refunded by the orchestrator).
 */
export const handler: SNSHandler = async (event: SNSEvent): Promise<void> => {
  for (const record of event.Records) {
    try {
      // EventBridge wraps the event in an envelope when routing to SNS
      const rawMessage = JSON.parse(record.Sns.Message);
      const detailType = rawMessage['detail-type'] as string | undefined;
      const detail = rawMessage.detail || rawMessage;

      if (detailType === 'AnalysisFailed') {
        await processFailurePush(detail as AnalysisFailedMessage);
      } else {
        const message: AnalysisCompleteMessage = detail;
        console.log(`Processing push delivery for user=${message.userId}, analysis=${message.analysisId}`);
        await processPushDelivery(message);
      }
    } catch (error) {
      // Log failures without throwing - graceful degradation
      console.error('Failed to process push notification:', error);
    }
  }
};

interface AnalysisFailedMessage {
  userId: string;
  marketId: string;
  requestId: string;
  error: string;
  environment?: string;
}

async function processFailurePush(message: AnalysisFailedMessage): Promise<void> {
  const { userId, marketId, requestId, error } = message;
  if (!userId) {
    console.warn('push-delivery: AnalysisFailed event missing userId');
    return;
  }

  const preferences = await getPushPreferences(userId);
  if (!preferences) {
    console.log(`No notification preferences for user=${userId}, skipping failure push`);
    return;
  }
  if (!preferences.channelPush) return;
  if (!PUSH_ALLOWED_PLANS.includes(preferences.plan)) return;
  if (isWithinQuietHours(preferences.quietHoursStart, preferences.quietHoursEnd)) return;

  const endpoints = await getDeviceEndpoints(userId);
  if (endpoints.length === 0) return;

  const title = 'Analysis didn\'t complete';
  const body = `We couldn\'t finish your analysis for ${marketId}. Your credit was refunded.`;
  const slug = await resolveMarketSlug(marketId);
  const deepLink = `${APP_URL}/markets/${slug}`;

  for (const endpoint of endpoints) {
    try {
      await publishPushNotification(endpoint, title, body, deepLink, requestId);
    } catch (err) {
      console.error(`Failure push failed for endpoint ${endpoint.platformEndpointArn}:`, err);
    }
  }
  console.log(`Failure push sent to user=${userId} for request=${requestId}: ${error}`);
}

// ─── Core Logic ─────────────────────────────────────────────────────────────────

/**
 * Process a single analysis complete notification for push delivery.
 */
async function processPushDelivery(message: AnalysisCompleteMessage): Promise<void> {
  const { userId, analysisId } = message;

  // 1. Query notification preferences and subscription plan in a single query
  const preferences = await getPushPreferences(userId);

  if (!preferences) {
    console.log(`No notification preferences found for user=${userId}, skipping push`);
    await recordDelivery(message, 'skipped', 'no_preferences');
    return;
  }

  // 2. Check if push channel is enabled
  if (!preferences.channelPush) {
    console.log(`Push channel disabled for user=${userId}, skipping`);
    await recordDelivery(message, 'skipped', 'channel_disabled');
    return;
  }

  // 3. Check user's subscription plan (push requires Starter+)
  if (!PUSH_ALLOWED_PLANS.includes(preferences.plan)) {
    console.log(`User ${userId} is on ${preferences.plan} plan - push requires Starter+, skipping`);
    await recordDelivery(message, 'skipped', 'plan_restriction');
    return;
  }

  // 4. Check quiet hours
  if (isWithinQuietHours(preferences.quietHoursStart, preferences.quietHoursEnd)) {
    console.log(`User ${userId} is within quiet hours (${preferences.quietHoursStart}-${preferences.quietHoursEnd}), skipping push`);
    await recordDelivery(message, 'skipped', 'quiet_hours');
    return;
  }

  // 5. Check probability shift threshold
  if (preferences.minProbabilityShift) {
    const previousProbability = await getPreviousProbabilityForPush(userId, message.marketId, message.analysisId);
    if (isBelowProbabilityShiftThreshold(message.consensusProbability, previousProbability, preferences.minProbabilityShift)) {
      console.log(`Probability shift below threshold for user=${userId}, market=${message.marketId}, skipping push`);
      await recordDelivery(message, 'skipped', 'below_shift_threshold');
      return;
    }
  }

  // 6. Get user's device endpoints
  const deviceEndpoints = await getDeviceEndpoints(userId);
  if (deviceEndpoints.length === 0) {
    console.log(`No device endpoints registered for user=${userId}, skipping push`);
    await recordDelivery(message, 'skipped', 'no_device_endpoints');
    return;
  }

  // 7. Build push payload and publish to each device endpoint
  const slug = await resolveMarketSlug(message.marketId);
  const deepLink = `${APP_URL}/markets/${slug}`;
  const title = 'Analysis Complete';
  const body = formatPushBody(message.marketQuestion, message.recommendation, message.consensusProbability);

  let successCount = 0;
  for (const endpoint of deviceEndpoints) {
    try {
      await publishPushNotification(endpoint, title, body, deepLink, analysisId);
      successCount++;
      console.log(`Push sent to endpoint ${endpoint.platformEndpointArn} for user=${userId}`);
    } catch (error) {
      // Log individual endpoint failures without stopping other deliveries
      console.error(
        `Failed to send push to endpoint ${endpoint.platformEndpointArn} for user=${userId}:`,
        error
      );
    }
  }

  // 7. Record delivery result
  if (successCount > 0) {
    console.log(`Push notification delivered to ${successCount}/${deviceEndpoints.length} endpoints for user=${userId}, analysis=${analysisId}`);
    await recordDelivery(message, 'success', null);
  } else {
    console.error(`All push endpoints failed for user=${userId}, analysis=${analysisId}`);
    await recordDelivery(message, 'failed', 'all_endpoints_failed');
  }
}

// ─── Notification Preferences + Plan Lookup ─────────────────────────────────────

/**
 * Query notification_preferences and subscription plan from RDS in a single query.
 * Returns null if no preferences found.
 */
async function getPushPreferences(userId: string): Promise<PushNotificationPreferences | null> {
  const creds = await getDbCredentials();
  const connectionString = `postgresql://${creds.username}:${encodeURIComponent(creds.password)}@${creds.host}:${creds.port}/${creds.dbname}?sslmode=no-verify`;

  const pg = await import('pg');
  const client = new pg.Client({ connectionString, ssl: { rejectUnauthorized: false } });

  try {
    await client.connect();

    const result = await client.query(
      `SELECT
        np.channel_push,
        np.quiet_hours_start,
        np.quiet_hours_end,
        np.min_probability_shift,
        COALESCE(s.plan, 'free') AS plan,
        COALESCE(s.status, 'active') AS subscription_status
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
      channelPush: row.channel_push,
      quietHoursStart: row.quiet_hours_start ? formatTime(row.quiet_hours_start) : null,
      quietHoursEnd: row.quiet_hours_end ? formatTime(row.quiet_hours_end) : null,
      plan: row.plan,
      subscriptionStatus: row.subscription_status,
      minProbabilityShift: row.min_probability_shift ? parseFloat(row.min_probability_shift) : null,
    };
  } finally {
    await client.end();
  }
}

/**
 * Query user's registered device endpoints from RDS.
 * Device endpoints are stored when users register for push notifications
 * via the mobile app or browser push subscription.
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

// ─── Quiet Hours & Delivery Utils ────────────────────────────────────────────────
// Imported from ../shared/delivery-utils.ts

// ─── Previous Probability Lookup ────────────────────────────────────────────────

/**
 * Get the previous analysis consensus probability for this market and user.
 * Used for probability shift threshold comparison.
 */
async function getPreviousProbabilityForPush(
  userId: string,
  marketId: string,
  currentAnalysisId: string
): Promise<number | null> {
  const creds = await getDbCredentials();
  const connectionString = `postgresql://${creds.username}:${encodeURIComponent(creds.password)}@${creds.host}:${creds.port}/${creds.dbname}?sslmode=no-verify`;

  const pg = await import('pg');
  const client = new pg.Client({ connectionString, ssl: { rejectUnauthorized: false } });

  try {
    await client.connect();

    const result = await client.query(
      `SELECT ar.consensus_probability
       FROM analysis_deliveries ad
       JOIN analysis_results ar ON ar.id = ad.result_id
       WHERE ad.user_id = $1
         AND ar.market_id = $2
         AND ar.id != $3::uuid
       ORDER BY ar.executed_at DESC
       LIMIT 1`,
      [userId, marketId, currentAnalysisId]
    );

    if (result.rows.length === 0) return null;
    const prob = result.rows[0].consensus_probability;
    return prob !== null ? parseFloat(prob) : null;
  } finally {
    await client.end();
  }
}

// ─── Push Notification Publishing ───────────────────────────────────────────────

/**
 * Publish a push notification to a specific device endpoint via SNS Mobile Push.
 */
async function publishPushNotification(
  endpoint: DeviceEndpoint,
  title: string,
  body: string,
  deepLink: string,
  analysisId: string
): Promise<void> {
  const message = buildPlatformMessage(endpoint.platform, title, body, deepLink, analysisId);

  await snsClient.send(
    new PublishCommand({
      TargetArn: endpoint.platformEndpointArn,
      Message: JSON.stringify(message),
      MessageStructure: 'json',
    })
  );
}

/**
 * Build platform-specific push notification message for SNS.
 * SNS Mobile Push requires a JSON structure with platform-specific keys.
 *
 * - iOS: APNs payload with alert, sound, badge, and custom data
 * - Android: FCM payload with notification and data sections
 */
function buildPlatformMessage(
  platform: 'ios' | 'android',
  title: string,
  body: string,
  deepLink: string,
  analysisId: string
): Record<string, string> {
  if (platform === 'ios') {
    const apnsPayload = {
      aps: {
        alert: {
          title,
          body,
        },
        sound: 'default',
        badge: 1,
        'mutable-content': 1,
      },
      deepLink,
      analysisId,
    };
    return {
      default: body,
      APNS: JSON.stringify(apnsPayload),
      APNS_SANDBOX: JSON.stringify(apnsPayload),
    };
  }

  // FCM (Android) payload
  const gcmPayload = {
    notification: {
      title,
      body,
      sound: 'default',
      click_action: 'OPEN_ANALYSIS',
    },
    data: {
      deepLink,
      analysisId,
    },
  };
  return {
    default: body,
    GCM: JSON.stringify(gcmPayload),
  };
}

// ─── Push Body Formatting ───────────────────────────────────────────────────────

/**
 * Format the push notification body text.
 * Truncates market question to fit push notification character limits.
 */
function formatPushBody(
  marketQuestion: string,
  recommendation: string,
  consensusProbability: number
): string {
  const recLabel = formatRecommendation(recommendation);
  const probPct = (consensusProbability * 100).toFixed(1);
  // Truncate market question if too long for push notification
  const truncatedQuestion = marketQuestion.length > 80
    ? `${marketQuestion.slice(0, 77)}...`
    : marketQuestion;
  return `${truncatedQuestion}\n${recLabel} • ${probPct}% probability`;
}

/**
 * Format recommendation enum to human-readable label with emoji.
 */
function formatRecommendation(recommendation: string): string {
  switch (recommendation) {
    case 'LONG_YES':
      return '📈 Buy YES';
    case 'LONG_NO':
      return '📉 Buy NO';
    case 'NO_TRADE':
      return '⏸️ No Trade';
    default:
      return recommendation;
  }
}

// ─── Delivery Recording ─────────────────────────────────────────────────────────

/**
 * Record the delivery attempt in the analysis_deliveries table.
 * Logs failures without throwing - recording should never break the delivery flow.
 */
async function recordDelivery(
  message: AnalysisCompleteMessage,
  status: 'success' | 'failed' | 'skipped',
  reason: string | null
): Promise<void> {
  try {
    const creds = await getDbCredentials();
    const connectionString = `postgresql://${creds.username}:${encodeURIComponent(creds.password)}@${creds.host}:${creds.port}/${creds.dbname}?sslmode=no-verify`;

    const pg = await import('pg');
    const client = new pg.Client({ connectionString, ssl: { rejectUnauthorized: false } });

    await client.connect();

    try {
      // Only record successful deliveries in analysis_deliveries table
      if (status === 'success') {
        const resultId = message.resultId || message.analysisId;
        if (message.analysisRequestId) {
          await client.query(
            `INSERT INTO analysis_deliveries (result_id, user_id, analysis_request_id, delivery_channel, was_cached_delivery)
             VALUES ($1::uuid, $2::uuid, $3::uuid, 'push', $4)
             ON CONFLICT (result_id, user_id, analysis_request_id) DO NOTHING`,
            [resultId, message.userId, message.analysisRequestId, message.wasCached]
          );
        } else {
          await client.query(
            `INSERT INTO analysis_deliveries (result_id, user_id, analysis_request_id, delivery_channel, was_cached_delivery)
             SELECT $1::uuid, $2::uuid, areq.id, 'push', $3
             FROM (
               SELECT id FROM analysis_requests
               WHERE user_id = $2::uuid AND market_id = $4 AND status = 'active'
               ORDER BY created_at DESC
               LIMIT 1
             ) areq
             ON CONFLICT (result_id, user_id, analysis_request_id) DO NOTHING`,
            [resultId, message.userId, message.wasCached, message.marketId]
          );
        }
      }

      // Log all delivery attempts for observability
      console.log(`Delivery recorded: user=${message.userId}, analysis=${message.analysisId}, channel=push, status=${status}, reason=${reason || 'none'}`);
    } finally {
      await client.end();
    }
  } catch (error) {
    // Don't throw - recording failures shouldn't break the delivery flow
    console.error(`Failed to record delivery for analysis=${message.analysisId}:`, error);
  }
}
