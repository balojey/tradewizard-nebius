/**
 * System Email Delivery Lambda - handler.
 *
 * Triggered by the `system-notifications` SNS topic. Sends transactional
 * account/billing emails that are produced by the subscription renewal flow:
 * - trial_expired
 * - renewal_reminder
 * - renewal_failed
 * - subscription_downgraded
 *
 * These notifications are account-critical, so they are not subject to quiet
 * hours or plan-based channel restrictions. They are sent when the user has no
 * saved notification preferences, and skipped only when the user has explicitly
 * saved `channel_email = false`.
 *
 * Delivery uses the shared email provider (Resend by default, SES retained).
 *
 * Environment variables:
 * - DB_SECRET_ARN: Secrets Manager ARN for RDS credentials
 * - DB_HOST: RDS endpoint hostname
 * - EMAIL_PROVIDER: "resend" (default) or "ses"
 * - RESEND_API_KEY_SECRET_ARN: Secrets Manager ARN for the Resend API key
 * - RESEND_FROM_EMAIL: Resend sender address
 * - RESEND_REPLY_TO: Optional Resend reply-to address
 * - SES_FROM_EMAIL: Sender address used by the retained SES fallback
 * - APP_URL: Application base URL for subscription links
 */

import { SNSHandler, SNSEvent } from 'aws-lambda';
import { sendEmail } from '../shared/email';
import { getDbCredentials } from '../shared/db';

const APP_URL = process.env.APP_URL || 'http://localhost:3000';

type SystemNotificationType =
  | 'trial_expired'
  | 'renewal_reminder'
  | 'renewal_failed'
  | 'subscription_downgraded';

interface SystemNotification {
  userId: string;
  subscriptionId?: string;
  type: SystemNotificationType | string;
  reason?: string;
  message: string;
  billingCycleEnd?: string;
  planPrice?: string;
  timestamp?: string;
}

interface EmailRecipient {
  email: string;
  channelEmail: boolean | null;
}

interface NotificationView {
  eyebrow: string;
  title: string;
  ctaLabel: string;
}

// ─── Main Handler ───────────────────────────────────────────────────────────────

export const handler: SNSHandler = async (event: SNSEvent): Promise<void> => {
  for (const record of event.Records) {
    try {
      const notification = JSON.parse(record.Sns.Message) as SystemNotification;
      await processNotification(notification, record.Sns.MessageId);
    } catch (error) {
      // Don't throw - a single bad notification shouldn't block SNS fan-out.
      console.error('system-email-delivery failed for record:', error);
    }
  }
};

async function processNotification(
  notification: SystemNotification,
  snsMessageId: string
): Promise<void> {
  const { userId, type, message } = notification;

  if (!userId || !type || !message) {
    console.warn(
      'system-email-delivery: message missing userId, type, or message body'
    );
    return;
  }

  const recipient = await getEmailRecipient(userId);

  if (!recipient || !recipient.email) {
    console.log(`No email address found for user=${userId}, skipping ${type}`);
    return;
  }

  // A missing preferences row means the user never opted out; send by default.
  // An explicit channel_email=false is treated as an opt-out.
  if (recipient.channelEmail === false) {
    console.log(
      `Email channel explicitly disabled for user=${userId}, skipping ${type}`
    );
    return;
  }

  const view = getNotificationView(type);
  const ctaUrl = `${APP_URL}/account/subscription`;
  const subject = `TradeWizard: ${view.title}`;
  const text = buildEmailText(notification, view, ctaUrl);
  const html = buildEmailHtml(notification, view, ctaUrl);

  const result = await sendEmail({
    to: recipient.email,
    subject,
    html,
    text,
    idempotencyKey: `system-email/${type}/${notification.subscriptionId || userId}/${notification.timestamp || snsMessageId}`,
  });

  console.log(
    `System email sent via ${result.provider}${result.messageId ? ` (${result.messageId})` : ''}: type=${type}, user=${userId}`
  );
}

// ─── Notification Content ───────────────────────────────────────────────────────

function getNotificationView(type: string): NotificationView {
  switch (type) {
    case 'trial_expired':
      return {
        eyebrow: 'Subscription update',
        title: 'Your free trial has ended',
        ctaLabel: 'View Plans',
      };
    case 'renewal_reminder':
      return {
        eyebrow: 'Renewal reminder',
        title: 'Upcoming subscription renewal',
        ctaLabel: 'Manage Subscription',
      };
    case 'renewal_failed':
      return {
        eyebrow: 'Action required',
        title: 'Subscription renewal failed',
        ctaLabel: 'Update Payment',
      };
    case 'subscription_downgraded':
      return {
        eyebrow: 'Subscription update',
        title: 'Subscription downgraded to Free',
        ctaLabel: 'View Plans',
      };
    default:
      return {
        eyebrow: 'Account notification',
        title: 'Subscription notification',
        ctaLabel: 'Open Account',
      };
  }
}

function buildEmailText(
  notification: SystemNotification,
  view: NotificationView,
  ctaUrl: string
): string {
  return [
    view.title,
    '',
    notification.message,
    '',
    `${view.ctaLabel}: ${ctaUrl}`,
    '',
    '---',
    "You're receiving this because it affects your TradeWizard subscription.",
    `Manage account settings: ${APP_URL}/account`,
  ].join('\n');
}

function buildEmailHtml(
  notification: SystemNotification,
  view: NotificationView,
  ctaUrl: string
): string {
  const title = escapeHtml(view.title);
  const eyebrow = escapeHtml(view.eyebrow);
  const body = escapeHtml(notification.message).replace(/\n/g, '<br>');
  const ctaLabel = escapeHtml(view.ctaLabel);

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${title}</title>
</head>
<body style="margin: 0; padding: 0; background-color: #f4f4f7; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color: #f4f4f7;">
    <tr>
      <td align="center" style="padding: 40px 20px;">
        <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="background-color: #ffffff; border-radius: 8px; overflow: hidden; box-shadow: 0 2px 8px rgba(0,0,0,0.08);">
          <tr>
            <td style="background-color: #1a1a2e; padding: 24px 32px;">
              <h1 style="margin: 0; color: #ffffff; font-size: 20px; font-weight: 600;">TradeWizard</h1>
            </td>
          </tr>
          <tr>
            <td style="padding: 32px 32px 16px;">
              <p style="margin: 0 0 8px; color: #6b7280; font-size: 12px; text-transform: uppercase; letter-spacing: 0.5px;">${eyebrow}</p>
              <h2 style="margin: 0 0 16px; color: #1f2937; font-size: 18px; font-weight: 600; line-height: 1.4;">${title}</h2>
              <p style="margin: 0; color: #374151; font-size: 14px; line-height: 1.6;">${body}</p>
            </td>
          </tr>
          <tr>
            <td style="padding: 24px 32px;">
              <table role="presentation" cellpadding="0" cellspacing="0" width="100%">
                <tr>
                  <td align="center">
                    <a href="${ctaUrl}" style="display: inline-block; background-color: #4f46e5; color: #ffffff; padding: 12px 32px; border-radius: 6px; text-decoration: none; font-size: 14px; font-weight: 600;">${ctaLabel}</a>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
          <tr>
            <td style="padding: 24px 32px; border-top: 1px solid #e5e7eb;">
              <p style="margin: 0; color: #9ca3af; font-size: 12px; text-align: center;">
                You're receiving this because it affects your TradeWizard subscription.
                <br>Manage account settings in your <a href="${APP_URL}/account" style="color: #4f46e5; text-decoration: none;">account settings</a>.
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

// ─── Database Lookup ────────────────────────────────────────────────────────────

/**
 * Load the user's email and email-channel preference.
 *
 * LEFT JOIN is intentional: users without a notification_preferences row have
 * never opted out, so channelEmail is null and the transactional email is sent.
 */
async function getEmailRecipient(
  userId: string
): Promise<EmailRecipient | null> {
  const creds = await getDbCredentials();
  const connectionString = `postgresql://${creds.username}:${encodeURIComponent(creds.password)}@${creds.host}:${creds.port}/${creds.dbname}?sslmode=no-verify`;

  const pg = await import('pg');
  const client = new pg.Client({
    connectionString,
    ssl: { rejectUnauthorized: false },
  });

  try {
    await client.connect();

    const result = await client.query(
      `SELECT
        u.email,
        np.channel_email
      FROM users u
      LEFT JOIN notification_preferences np
        ON np.user_id = u.id
       AND np.market_id IS NULL
      WHERE u.id = $1
      LIMIT 1`,
      [userId]
    );

    if (result.rows.length === 0) {
      return null;
    }

    const row = result.rows[0];
    return {
      email: row.email,
      channelEmail: row.channel_email ?? null,
    };
  } finally {
    await client.end();
  }
}

// ─── Utilities ──────────────────────────────────────────────────────────────────

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}
