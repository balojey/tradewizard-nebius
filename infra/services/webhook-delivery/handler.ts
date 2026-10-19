/**
 * Webhook Delivery Lambda - handler.
 *
 * Triggered by SNS Analysis Complete Topic.
 * Delivers the full analysis result payload as an HTTP POST to the user's
 * configured webhook_url. Requires Pro+ plan.
 *
 * Flow:
 * 1. Parse SNS message for userId, analysisId, result payload
 * 2. Query notification_preferences and subscription from RDS
 * 3. If channelWebhook disabled → skip
 * 4. If user is on free or starter plan → skip (webhook requires Pro+)
 * 5. If within quiet hours → skip
 * 6. POST full analysis result payload as JSON to webhook_url
 * 7. Retry up to 3 times with exponential backoff (1s, 2s, 4s) on non-2xx
 * 8. Record delivery attempt in analysis_deliveries table
 *
 * Environment variables:
 * - DB_SECRET_ARN: Secrets Manager ARN for RDS credentials
 * - DB_HOST: RDS endpoint hostname
 */

import type { SNSHandler, SNSEvent } from 'aws-lambda';
import { getConnectionString } from '../shared/db';
import { isWithinQuietHours, formatTime, isBelowProbabilityShiftThreshold, WEBHOOK_ALLOWED_PLANS } from '../shared/delivery-utils';

// ─── Constants ──────────────────────────────────────────────────────────────────

/** Maximum number of retry attempts for webhook delivery */
const MAX_RETRIES = 3;

/** Base delay in milliseconds for exponential backoff */
const BASE_DELAY_MS = 1000;

// ─── Types ──────────────────────────────────────────────────────────────────────

interface AnalysisCompleteMessage {
  userId: string;
  analysisId: string;
  analysisRequestId: string;
  resultId: string;
  marketId: string;
  marketQuestion: string;
  recommendation: 'LONG_YES' | 'LONG_NO' | 'NO_TRADE';
  consensusProbability: number;
  confidence: number;
  resultPayloadS3Key: string;
  executedAt: string;
  wasCached: boolean;
  /** Full analysis result payload to deliver (optional - if not present, summary is sent) */
  resultPayload?: Record<string, unknown>;
}

interface WebhookPreferences {
  channelWebhook: boolean;
  webhookUrl: string | null;
  quietHoursStart: string | null; // HH:MM format
  quietHoursEnd: string | null;   // HH:MM format
  plan: string;
  minProbabilityShift: number | null;
}

// ─── Main Handler ───────────────────────────────────────────────────────────────

/**
 * Main Lambda handler - triggered by SNS Analysis Complete Topic.
 * Processes each record independently with graceful degradation. Handles
 * both AnalysisCompleted and AnalysisFailed events; failure events POST a
 * dedicated `analysis_failed` payload to the configured webhook URL.
 */
export const handler: SNSHandler = async (event: SNSEvent): Promise<void> => {
  for (const record of event.Records) {
    // EventBridge wraps the event in an envelope when routing to SNS
    const rawMessage = JSON.parse(record.Sns.Message);
    const detailType = rawMessage['detail-type'] as string | undefined;
    const detail = rawMessage.detail || rawMessage;

    try {
      if (detailType === 'AnalysisFailed') {
        await processFailureWebhook(detail as AnalysisFailedMessage);
      } else {
        const message: AnalysisCompleteMessage = detail;
        const { userId, analysisId } = message;
        console.log(`[webhook-delivery] Processing delivery for user=${userId}, analysis=${analysisId}`);
        await processWebhookDelivery(message);
      }
    } catch (error) {
      // Log but don't throw - graceful degradation
      console.error('[webhook-delivery] Failed for record:', error);
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

/**
 * POST a failure payload to the user's webhook URL. Same plan/preferences
 * gating as success deliveries.
 */
async function processFailureWebhook(message: AnalysisFailedMessage): Promise<void> {
  const { userId, marketId, requestId, error } = message;
  if (!userId) {
    console.warn('[webhook-delivery] AnalysisFailed event missing userId');
    return;
  }

  const preferences = await getWebhookPreferences(userId);
  if (!preferences) return;
  if (!preferences.channelWebhook || !preferences.webhookUrl) return;
  if (!WEBHOOK_ALLOWED_PLANS.includes(preferences.plan)) return;
  if (isWithinQuietHours(preferences.quietHoursStart, preferences.quietHoursEnd)) return;

  const payload = {
    event: 'analysis_failed',
    requestId,
    marketId,
    error,
    timestamp: new Date().toISOString(),
  };

  const { success, statusCode, error: deliveryError } = await deliverWithRetry(preferences.webhookUrl, payload);

  if (success) {
    console.log(`[webhook-delivery] Failure webhook delivered for user=${userId}, request=${requestId}`);
  } else {
    console.error(
      `[webhook-delivery] Failure webhook delivery failed for user=${userId}, request=${requestId}, ` +
      `lastStatus=${statusCode}, error=${deliveryError}`
    );
  }
}

// ─── Core Logic ─────────────────────────────────────────────────────────────────

/**
 * Process a single webhook delivery for a user.
 * Checks preferences, plan eligibility, quiet hours, then delivers with retry.
 */
async function processWebhookDelivery(message: AnalysisCompleteMessage): Promise<void> {
  const { userId, analysisId } = message;

  // Step 1: Query notification preferences and subscription plan in a single query
  const preferences = await getWebhookPreferences(userId);

  if (!preferences) {
    console.log(`[webhook-delivery] No notification preferences found for user=${userId}, skipping`);
    await recordDeliveryAttempt(message, 'skipped', 'no_preferences');
    return;
  }

  // Step 2: Check if webhook channel is enabled
  if (!preferences.channelWebhook) {
    console.log(`[webhook-delivery] Webhook channel disabled for user=${userId}, skipping`);
    await recordDeliveryAttempt(message, 'skipped', 'channel_disabled');
    return;
  }

  // Step 3: Check webhook URL is configured
  if (!preferences.webhookUrl) {
    console.log(`[webhook-delivery] No webhook_url configured for user=${userId}, skipping`);
    await recordDeliveryAttempt(message, 'skipped', 'no_webhook_url');
    return;
  }

  // Step 4: Check subscription plan (webhook requires Pro+)
  if (!WEBHOOK_ALLOWED_PLANS.includes(preferences.plan)) {
    console.log(`[webhook-delivery] User=${userId} on plan=${preferences.plan}, webhook requires Pro+, skipping`);
    await recordDeliveryAttempt(message, 'skipped', 'plan_restriction');
    return;
  }

  // Step 5: Check quiet hours
  if (isWithinQuietHours(preferences.quietHoursStart, preferences.quietHoursEnd)) {
    console.log(
      `[webhook-delivery] User=${userId} is within quiet hours ` +
      `(${preferences.quietHoursStart}-${preferences.quietHoursEnd}), skipping`
    );
    await recordDeliveryAttempt(message, 'skipped', 'quiet_hours');
    return;
  }

  // Step 6: Check probability shift threshold
  if (preferences.minProbabilityShift) {
    const previousProbability = await getPreviousProbabilityForWebhook(userId, message.marketId, message.analysisId);
    if (isBelowProbabilityShiftThreshold(message.consensusProbability, previousProbability, preferences.minProbabilityShift)) {
      console.log(`[webhook-delivery] Probability shift below threshold for user=${userId}, market=${message.marketId}, skipping`);
      await recordDeliveryAttempt(message, 'skipped', 'below_shift_threshold');
      return;
    }
  }

  // Step 7: Deliver webhook with retry logic
  const payload = buildWebhookPayload(message);
  const { success, statusCode, error } = await deliverWithRetry(preferences.webhookUrl, payload);

  // Step 8: Record delivery attempt
  if (success) {
    console.log(`[webhook-delivery] Successfully delivered to webhook for user=${userId}, analysis=${analysisId}`);
    await recordDeliveryAttempt(message, 'success', null);
  } else {
    console.error(
      `[webhook-delivery] Failed to deliver webhook for user=${userId}, analysis=${analysisId}, ` +
      `lastStatus=${statusCode}, error=${error}`
    );
    await recordDeliveryAttempt(message, 'failed', error || 'unknown_error');
  }
}

// ─── Notification Preferences + Plan Lookup ─────────────────────────────────────

/**
 * Query notification_preferences and subscription plan from RDS in a single query.
 * Returns null if no preferences found.
 */
async function getWebhookPreferences(userId: string): Promise<WebhookPreferences | null> {
  const connectionString = await getConnectionString();

  const pg = await import('pg');
  const client = new pg.Client({ connectionString, ssl: { rejectUnauthorized: false } });

  try {
    await client.connect();

    const result = await client.query(
      `SELECT
        np.channel_webhook,
        np.webhook_url,
        np.quiet_hours_start,
        np.quiet_hours_end,
        np.min_probability_shift,
        COALESCE(s.plan, 'free') AS plan
      FROM notification_preferences np
      JOIN users u ON u.id = np.user_id
      LEFT JOIN subscriptions s ON s.user_id = u.id AND s.status = 'active'
      WHERE np.user_id = $1
        AND np.market_id IS NULL
      LIMIT 1`,
      [userId]
    );

    if (result.rows.length === 0) return null;

    const row = result.rows[0];
    return {
      channelWebhook: row.channel_webhook,
      webhookUrl: row.webhook_url,
      quietHoursStart: row.quiet_hours_start ? formatTime(row.quiet_hours_start) : null,
      quietHoursEnd: row.quiet_hours_end ? formatTime(row.quiet_hours_end) : null,
      plan: row.plan,
      minProbabilityShift: row.min_probability_shift ? parseFloat(row.min_probability_shift) : null,
    };
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
async function getPreviousProbabilityForWebhook(
  userId: string,
  marketId: string,
  currentAnalysisId: string
): Promise<number | null> {
  const connectionString = await getConnectionString();

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

// ─── Webhook Payload ────────────────────────────────────────────────────────────

/**
 * Build the webhook payload from the SNS message.
 * If a full result payload is included in the SNS message, it's embedded.
 * Otherwise, a summary payload with the S3 key is sent.
 */
function buildWebhookPayload(message: AnalysisCompleteMessage): Record<string, unknown> {
  // If a full result payload is included in the SNS message, use it
  if (message.resultPayload) {
    return {
      event: 'analysis_complete',
      analysisId: message.analysisId,
      marketId: message.marketId,
      marketQuestion: message.marketQuestion,
      recommendation: message.recommendation,
      consensusProbability: message.consensusProbability,
      confidence: message.confidence,
      executedAt: message.executedAt,
      wasCached: message.wasCached,
      result: message.resultPayload,
    };
  }

  // Otherwise, send the summary payload with S3 key for full retrieval
  return {
    event: 'analysis_complete',
    analysisId: message.analysisId,
    marketId: message.marketId,
    marketQuestion: message.marketQuestion,
    recommendation: message.recommendation,
    consensusProbability: message.consensusProbability,
    confidence: message.confidence,
    executedAt: message.executedAt,
    wasCached: message.wasCached,
    resultPayloadS3Key: message.resultPayloadS3Key,
  };
}

// ─── Retry Logic ────────────────────────────────────────────────────────────────

/**
 * Deliver the webhook payload with retry logic.
 * Retries up to MAX_RETRIES times with exponential backoff (1s, 2s, 4s) on non-2xx responses.
 *
 * @param webhookUrl - The user's configured webhook URL
 * @param payload - The JSON payload to POST
 * @returns Result object with success status, HTTP status code, and error message
 */
async function deliverWithRetry(
  webhookUrl: string,
  payload: Record<string, unknown>
): Promise<{ success: boolean; statusCode?: number; error?: string }> {
  const body = JSON.stringify(payload);

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      // Wait before retry (no wait on first attempt)
      if (attempt > 0) {
        const delayMs = BASE_DELAY_MS * Math.pow(2, attempt - 1); // 1s, 2s, 4s
        console.log(`[webhook-delivery] Retry attempt ${attempt}/${MAX_RETRIES}, waiting ${delayMs}ms`);
        await sleep(delayMs);
      }

      const response = await fetch(webhookUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'User-Agent': 'TradeWizard-Webhook/1.0',
          'X-TradeWizard-Event': 'analysis_complete',
        },
        body,
        signal: AbortSignal.timeout(10000), // 10s timeout per request
      });

      if (response.ok) {
        return { success: true, statusCode: response.status };
      }

      console.warn(
        `[webhook-delivery] Non-2xx response: status=${response.status}, attempt=${attempt + 1}/${MAX_RETRIES + 1}`
      );

      // If this was the last attempt, return failure
      if (attempt === MAX_RETRIES) {
        return {
          success: false,
          statusCode: response.status,
          error: `HTTP ${response.status} after ${MAX_RETRIES + 1} attempts`,
        };
      }
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      console.warn(
        `[webhook-delivery] Request error: ${errorMessage}, attempt=${attempt + 1}/${MAX_RETRIES + 1}`
      );

      // If this was the last attempt, return failure
      if (attempt === MAX_RETRIES) {
        return {
          success: false,
          error: `${errorMessage} after ${MAX_RETRIES + 1} attempts`,
        };
      }
    }
  }

  // Should not reach here, but just in case
  return { success: false, error: 'Unexpected retry loop exit' };
}

// ─── Delivery Recording ─────────────────────────────────────────────────────────

/**
 * Record the delivery attempt in the analysis_deliveries table.
 * Logs failures without throwing - recording should never break the delivery flow.
 *
 * @param message - The original SNS message
 * @param status - Delivery status: success, failed, or skipped
 * @param reason - Reason for failure/skip (null for success)
 */
async function recordDeliveryAttempt(
  message: AnalysisCompleteMessage,
  status: 'success' | 'failed' | 'skipped',
  reason: string | null
): Promise<void> {
  try {
    const connectionString = await getConnectionString();

    const pg = await import('pg');
    const client = new pg.Client({ connectionString, ssl: { rejectUnauthorized: false } });

    await client.connect();

    try {
      // Record successful deliveries in analysis_deliveries table
      if (status === 'success') {
        await client.query(
          `INSERT INTO analysis_deliveries (
            result_id, user_id, analysis_request_id, was_cached_delivery, delivery_channel, delivered_at
          ) VALUES ($1::uuid, $2::uuid, $3::uuid, $4, 'webhook', NOW())
          ON CONFLICT (result_id, user_id, analysis_request_id) DO NOTHING`,
          [message.resultId, message.userId, message.analysisRequestId, message.wasCached || false]
        );
      } else if (status === 'failed') {
        // Record failed deliveries with a distinct channel marker for audit
        await client.query(
          `INSERT INTO analysis_deliveries (
            result_id, user_id, analysis_request_id, was_cached_delivery, delivery_channel, delivered_at
          ) VALUES ($1::uuid, $2::uuid, $3::uuid, $4, 'webhook_failed', NOW())
          ON CONFLICT (result_id, user_id, analysis_request_id) DO NOTHING`,
          [message.resultId, message.userId, message.analysisRequestId, message.wasCached || false]
        );
      }

      // Log all delivery attempts for observability
      console.log(
        `[webhook-delivery] Delivery recorded: user=${message.userId}, analysis=${message.analysisId}, ` +
        `channel=webhook, status=${status}, reason=${reason || 'none'}`
      );
    } finally {
      await client.end();
    }
  } catch (error) {
    // Don't throw - recording failures shouldn't break the delivery flow
    console.error(`[webhook-delivery] Failed to record delivery for analysis=${message.analysisId}:`, error);
  }
}

// ─── Utility Functions ──────────────────────────────────────────────────────────

/**
 * Sleep for the specified number of milliseconds.
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
