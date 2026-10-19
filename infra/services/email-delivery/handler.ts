/**
 * Email Delivery Lambda - handler.
 *
 * Triggered by SNS Analysis Complete Topic.
 * Sends email notifications when an analysis completes or fails, respecting
 * user notification preferences and quiet hours.
 *
 * Flow:
 * 1. Parse SNS message for analysis result data
 * 2. Query notification_preferences from RDS for the user
 * 3. If channelEmail disabled → skip and record skipped delivery
 * 4. If within quiet hours → skip and log
 * 5. Send email via the configured provider (Resend by default, SES retained)
 * 6. Record delivery in analysis_deliveries table
 *
 * Environment variables:
 * - DB_SECRET_ARN: Secrets Manager ARN for RDS credentials
 * - DB_HOST: RDS endpoint
 * - EMAIL_PROVIDER: "resend" (default) or "ses"
 * - RESEND_API_KEY_SECRET_ARN: Secrets Manager ARN for the Resend API key
 * - RESEND_FROM_EMAIL: Resend sender address
 * - RESEND_REPLY_TO: Optional Resend reply-to address
 * - SES_FROM_EMAIL: Sender address used by the retained SES fallback
 * - APP_URL: Base URL for result links
 */

import { SNSHandler, SNSEvent } from 'aws-lambda';
import { sendEmail, type EmailSendResult } from '../shared/email';
import { getDbCredentials } from '../shared/db';
import { isWithinQuietHours, formatTime, isBelowProbabilityShiftThreshold, EMAIL_ALLOWED_PLANS, resolveMarketSlug } from '../shared/delivery-utils';

const APP_URL = process.env.APP_URL || 'http://localhost:3000';

// ─── Types ──────────────────────────────────────────────────────────────────────

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

interface NotificationPreferences {
  channelEmail: boolean;
  quietHoursStart: string | null; // HH:MM format
  quietHoursEnd: string | null;
  userEmail: string;
  plan: string;
  minProbabilityShift: number | null;
}

// ─── Main Handler ───────────────────────────────────────────────────────────────

export const handler: SNSHandler = async (event: SNSEvent): Promise<void> => {
  for (const record of event.Records) {
    // EventBridge wraps the event in an envelope when routing to SNS
    const rawMessage = JSON.parse(record.Sns.Message);
    const detailType = rawMessage['detail-type'] as string | undefined;
    const detail = rawMessage.detail || rawMessage;

    try {
      if (detailType === 'AnalysisFailed') {
        await processFailureDelivery(detail as AnalysisFailedMessage);
      } else {
        const message: AnalysisCompleteMessage = detail;
        console.log(`Processing email delivery for user=${message.userId}, analysis=${message.analysisId}`);
        await processEmailDelivery(message);
      }
    } catch (error) {
      // Log failures without throwing - graceful degradation
      console.error('email-delivery failed for record:', error);
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
 * Send a failure notification email so users on email-enabled plans know
 * their requested analysis didn't complete (the orchestrator already
 * refunded their credit).
 */
async function processFailureDelivery(message: AnalysisFailedMessage): Promise<void> {
  const { userId } = message;

  if (!userId) {
    console.warn('email-delivery: AnalysisFailed event missing userId');
    return;
  }

  const preferences = await getNotificationPreferences(userId);
  if (!preferences) {
    console.log(`No notification preferences found for user=${userId}, skipping failure email`);
    return;
  }
  if (!preferences.channelEmail) {
    console.log(`Email channel disabled for user=${userId}, skipping failure email`);
    return;
  }
  // Check plan restriction (email requires Starter+)
  if (!EMAIL_ALLOWED_PLANS.includes(preferences.plan)) {
    console.log(`User ${userId} is on ${preferences.plan} plan - email requires Starter+, skipping failure email`);
    return;
  }
  // Failure emails respect quiet hours - analysis failures are non-critical
  // (the user was refunded). The frontend WS still surfaces the failure
  // immediately; email is the durable record.
  if (isWithinQuietHours(preferences.quietHoursStart, preferences.quietHoursEnd)) {
    console.log(`Within quiet hours for user=${userId}, skipping failure email`);
    return;
  }

  try {
    await sendFailureEmail(preferences.userEmail, message);
  } catch (error) {
    console.error(`Email failure send failed for user=${userId}:`, error);
  }
}

async function sendFailureEmail(toEmail: string, message: AnalysisFailedMessage): Promise<void> {
  const slug = await resolveMarketSlug(message.marketId);
  const marketUrl = `${APP_URL}/markets/${slug}`;
  const subject = `TradeWizard: Analysis didn't complete`;
  const text = [
    `We were unable to complete your analysis for market ${message.marketId}.`,
    '',
    `Reason: ${message.error}`,
    '',
    `Your credit has been refunded. You can request the analysis again at any time:`,
    marketUrl,
  ].join('\n');

  const html = `<!DOCTYPE html>
<html><head><meta charset="UTF-8"><title>Analysis Failed</title></head>
<body style="margin:0;padding:0;background-color:#f4f4f7;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#f4f4f7;">
  <tr><td align="center" style="padding:40px 20px;">
    <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="background-color:#ffffff;border-radius:8px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,0.08);">
      <tr><td style="background-color:#1a1a2e;padding:24px 32px;"><h1 style="margin:0;color:#ffffff;font-size:20px;font-weight:600;">TradeWizard</h1></td></tr>
      <tr><td style="padding:32px;">
        <h2 style="margin:0 0 16px;color:#1f2937;font-size:18px;">Analysis didn't complete</h2>
        <p style="margin:0 0 12px;color:#374151;font-size:14px;line-height:1.6;">
          We were unable to complete your analysis for market <code>${escapeHtml(message.marketId)}</code>.
        </p>
        <p style="margin:0 0 12px;color:#dc2626;font-size:14px;">${escapeHtml(message.error)}</p>
        <p style="margin:0;color:#374151;font-size:14px;">Your credit has been refunded. You can request the analysis again at any time.</p>
      </td></tr>
      <tr><td style="padding:24px 32px;">
        <a href="${marketUrl}" style="display:inline-block;background-color:#4f46e5;color:#ffffff;padding:12px 32px;border-radius:6px;text-decoration:none;font-size:14px;font-weight:600;">View Market</a>
      </td></tr>
    </table>
  </td></tr>
</table>
</body></html>`;

  const result = await sendEmail({
    to: toEmail,
    subject,
    html,
    text,
    idempotencyKey: `analysis-failed-email/${message.requestId || message.marketId}/${message.userId}`,
  });

  console.log(
    `Failure email sent via ${result.provider}${result.messageId ? ` (${result.messageId})` : ''} for user=${message.userId}`
  );
}

// ─── Core Logic ─────────────────────────────────────────────────────────────────

async function processEmailDelivery(message: AnalysisCompleteMessage): Promise<void> {
  const { userId, analysisId } = message;

  // 1. Look up notification preferences and user email
  const preferences = await getNotificationPreferences(userId);

  if (!preferences) {
    console.log(`No notification preferences found for user=${userId}, skipping email`);
    await recordDelivery(message, 'skipped', 'no_preferences');
    return;
  }

  // 2. Check if email channel is enabled
  if (!preferences.channelEmail) {
    console.log(`Email channel disabled for user=${userId}, skipping`);
    await recordDelivery(message, 'skipped', 'channel_disabled');
    return;
  }

  // 3. Check user's subscription plan (email requires Starter+)
  if (!EMAIL_ALLOWED_PLANS.includes(preferences.plan)) {
    console.log(`User ${userId} is on ${preferences.plan} plan - email requires Starter+, skipping`);
    await recordDelivery(message, 'skipped', 'plan_restriction');
    return;
  }

  // 4. Check quiet hours
  if (isWithinQuietHours(preferences.quietHoursStart, preferences.quietHoursEnd)) {
    console.log(`Within quiet hours for user=${userId} (${preferences.quietHoursStart}-${preferences.quietHoursEnd}), skipping email`);
    await recordDelivery(message, 'skipped', 'quiet_hours');
    return;
  }

  // 5. Check probability shift threshold
  if (preferences.minProbabilityShift) {
    const previousProbability = await getPreviousProbability(userId, message.marketId, analysisId);
    if (isBelowProbabilityShiftThreshold(message.consensusProbability, previousProbability, preferences.minProbabilityShift)) {
      console.log(`Probability shift below threshold for user=${userId}, market=${message.marketId}, skipping email`);
      await recordDelivery(message, 'skipped', 'below_shift_threshold');
      return;
    }
  }

  // 6. Send email via the configured provider
  try {
    const result = await sendAnalysisEmail(preferences.userEmail, message);
    console.log(
      `Email sent successfully via ${result.provider}${result.messageId ? ` (${result.messageId})` : ''} to user=${userId} for analysis=${analysisId}`
    );
    await recordDelivery(message, 'success', null);
  } catch (error) {
    console.error(`Email send failed for user=${userId}:`, error);
    await recordDelivery(message, 'failed', (error as Error).message);
  }
}

// ─── Notification Preferences Lookup ────────────────────────────────────────────

/**
 * Query notification_preferences and users table from RDS for the given user.
 * Returns null if no preferences found.
 */
async function getNotificationPreferences(userId: string): Promise<NotificationPreferences | null> {
  const creds = await getDbCredentials();
  const connectionString = `postgresql://${creds.username}:${encodeURIComponent(creds.password)}@${creds.host}:${creds.port}/${creds.dbname}?sslmode=no-verify`;

  const pg = await import('pg');
  const client = new pg.Client({ connectionString, ssl: { rejectUnauthorized: false } });

  try {
    await client.connect();

    const result = await client.query(
      `SELECT
        np.channel_email,
        np.quiet_hours_start,
        np.quiet_hours_end,
        np.min_probability_shift,
        u.email as user_email,
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
      channelEmail: row.channel_email,
      quietHoursStart: row.quiet_hours_start ? formatTime(row.quiet_hours_start) : null,
      quietHoursEnd: row.quiet_hours_end ? formatTime(row.quiet_hours_end) : null,
      userEmail: row.user_email,
      plan: row.plan,
      minProbabilityShift: row.min_probability_shift ? parseFloat(row.min_probability_shift) : null,
    };
  } finally {
    await client.end();
  }
}

// ─── Quiet Hours Logic ──────────────────────────────────────────────────────────
// Imported from ../shared/delivery-utils.ts

// ─── Previous Probability Lookup ────────────────────────────────────────────────

/**
 * Get the previous analysis consensus probability for this market and user.
 * Used for probability shift threshold comparison.
 * Returns null if no previous analysis exists.
 */
async function getPreviousProbability(
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

    // Get the most recent delivered analysis result for this market+user that isn't the current one
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

// ─── Email Sending ──────────────────────────────────────────────────────────────

async function sendAnalysisEmail(
  toEmail: string,
  message: AnalysisCompleteMessage
): Promise<EmailSendResult> {
  const slug = await resolveMarketSlug(message.marketId);
  const resultUrl = `${APP_URL}/markets/${slug}`;
  const htmlBody = buildEmailHtml(message, resultUrl);
  const textBody = buildEmailText(message, resultUrl);

  return sendEmail({
    to: toEmail,
    subject: `TradeWizard: ${formatRecommendation(message.recommendation)} - ${message.marketQuestion}`,
    html: htmlBody,
    text: textBody,
    idempotencyKey: `analysis-email/${message.resultId || message.analysisId}/${message.userId}`,
  });
}

// ─── Email Template ─────────────────────────────────────────────────────────────

function buildEmailHtml(message: AnalysisCompleteMessage, resultUrl: string): string {
  const recommendationColor = getRecommendationColor(message.recommendation);
  const recommendationLabel = formatRecommendation(message.recommendation);
  const probabilityPct = (message.consensusProbability * 100).toFixed(1);
  const confidencePct = (message.confidence * 100).toFixed(1);

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>TradeWizard Analysis Result</title>
</head>
<body style="margin: 0; padding: 0; background-color: #f4f4f7; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color: #f4f4f7;">
    <tr>
      <td align="center" style="padding: 40px 20px;">
        <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="background-color: #ffffff; border-radius: 8px; overflow: hidden; box-shadow: 0 2px 8px rgba(0,0,0,0.08);">
          <!-- Header -->
          <tr>
            <td style="background-color: #1a1a2e; padding: 24px 32px;">
              <h1 style="margin: 0; color: #ffffff; font-size: 20px; font-weight: 600;">TradeWizard</h1>
            </td>
          </tr>

          <!-- Market Question -->
          <tr>
            <td style="padding: 32px 32px 16px;">
              <p style="margin: 0 0 8px; color: #6b7280; font-size: 12px; text-transform: uppercase; letter-spacing: 0.5px;">Market Analysis Complete</p>
              <h2 style="margin: 0; color: #1f2937; font-size: 18px; font-weight: 600; line-height: 1.4;">${escapeHtml(message.marketQuestion)}</h2>
            </td>
          </tr>

          <!-- Recommendation Badge -->
          <tr>
            <td style="padding: 16px 32px;">
              <table role="presentation" cellpadding="0" cellspacing="0">
                <tr>
                  <td style="background-color: ${recommendationColor}; color: #ffffff; padding: 8px 16px; border-radius: 4px; font-size: 14px; font-weight: 600;">
                    ${recommendationLabel}
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- Stats -->
          <tr>
            <td style="padding: 16px 32px;">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border: 1px solid #e5e7eb; border-radius: 6px;">
                <tr>
                  <td style="padding: 16px; border-right: 1px solid #e5e7eb; text-align: center; width: 50%;">
                    <p style="margin: 0 0 4px; color: #6b7280; font-size: 12px;">Consensus Probability</p>
                    <p style="margin: 0; color: #1f2937; font-size: 24px; font-weight: 700;">${probabilityPct}%</p>
                  </td>
                  <td style="padding: 16px; text-align: center; width: 50%;">
                    <p style="margin: 0 0 4px; color: #6b7280; font-size: 12px;">Confidence</p>
                    <p style="margin: 0; color: #1f2937; font-size: 24px; font-weight: 700;">${confidencePct}%</p>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- CTA Button -->
          <tr>
            <td style="padding: 24px 32px;">
              <table role="presentation" cellpadding="0" cellspacing="0" width="100%">
                <tr>
                  <td align="center">
                    <a href="${resultUrl}" style="display: inline-block; background-color: #4f46e5; color: #ffffff; padding: 12px 32px; border-radius: 6px; text-decoration: none; font-size: 14px; font-weight: 600;">View Full Analysis</a>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="padding: 24px 32px; border-top: 1px solid #e5e7eb;">
              <p style="margin: 0; color: #9ca3af; font-size: 12px; text-align: center;">
                You're receiving this because you have email notifications enabled on TradeWizard.
                <br>Manage your notification preferences in your <a href="${APP_URL}/account" style="color: #4f46e5; text-decoration: none;">account settings</a>.
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

function buildEmailText(message: AnalysisCompleteMessage, resultUrl: string): string {
  const recommendationLabel = formatRecommendation(message.recommendation);
  const probabilityPct = (message.consensusProbability * 100).toFixed(1);
  const confidencePct = (message.confidence * 100).toFixed(1);

  return `TradeWizard - Analysis Complete

Market: ${message.marketQuestion}

Recommendation: ${recommendationLabel}
Consensus Probability: ${probabilityPct}%
Confidence: ${confidencePct}%

View full analysis: ${resultUrl}

---
You're receiving this because you have email notifications enabled on TradeWizard.
Manage preferences: ${APP_URL}/account`;
}

// ─── Delivery Recording ─────────────────────────────────────────────────────────

/**
 * Record the delivery attempt in the analysis_deliveries table.
 * Logs failures without throwing.
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
      // Only record successful deliveries in analysis_deliveries table.
      // Use the resultId / analysisRequestId from the SNS message when present
      // (they're the canonical RDS UUIDs the orchestrator already wrote),
      // otherwise fall back to a subquery lookup.
      if (status === 'success') {
        const resultId = message.resultId || message.analysisId;
        if (message.analysisRequestId) {
          await client.query(
            `INSERT INTO analysis_deliveries (result_id, user_id, analysis_request_id, delivery_channel, was_cached_delivery)
             VALUES ($1::uuid, $2::uuid, $3::uuid, 'email', $4)
             ON CONFLICT (result_id, user_id, analysis_request_id) DO NOTHING`,
            [resultId, message.userId, message.analysisRequestId, message.wasCached]
          );
        } else {
          // Legacy path: look up the latest active analysis request for this market+user.
          await client.query(
            `INSERT INTO analysis_deliveries (result_id, user_id, analysis_request_id, delivery_channel, was_cached_delivery)
             SELECT $1::uuid, $2::uuid, areq.id, 'email', $3
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
      console.log(`Delivery recorded: user=${message.userId}, analysis=${message.analysisId}, channel=email, status=${status}, reason=${reason || 'none'}`);
    } finally {
      await client.end();
    }
  } catch (error) {
    // Don't throw - recording failures shouldn't break the delivery flow
    console.error(`Failed to record delivery for analysis=${message.analysisId}:`, error);
  }
}

// ─── Utility Functions ──────────────────────────────────────────────────────────

function formatRecommendation(recommendation: string): string {
  switch (recommendation) {
    case 'LONG_YES': return 'Long YES';
    case 'LONG_NO': return 'Long NO';
    case 'NO_TRADE': return 'No Trade';
    default: return recommendation;
  }
}

function getRecommendationColor(recommendation: string): string {
  switch (recommendation) {
    case 'LONG_YES': return '#059669'; // green
    case 'LONG_NO': return '#dc2626'; // red
    case 'NO_TRADE': return '#6b7280'; // gray
    default: return '#6b7280';
  }
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}
