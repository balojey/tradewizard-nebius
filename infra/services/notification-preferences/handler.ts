/**
 * Notification Preferences API - Lambda handler.
 *
 * Manages user notification channel settings, quiet hours, and thresholds.
 *
 * Routes:
 *   GET  /user/notifications → return current preferences for authenticated user
 *   PUT  /user/notifications → validate & persist updated preferences
 *
 * Triggered by: API Gateway REST
 */

import { APIGatewayProxyHandler, APIGatewayProxyResult } from 'aws-lambda';
import { getDbCredentials } from '../shared/db';
import { PLAN_LIMITS } from '../shared/credits';

// ─── Types ───────────────────────────────────────────────────────────────────

interface NotificationPreferencesPayload {
  channelInApp: boolean;
  channelEmail: boolean;
  channelPush: boolean;
  channelWebhook: boolean;
  webhookUrl?: string | null;
  quietHoursStart?: string | null; // HH:MM
  quietHoursEnd?: string | null;   // HH:MM
  minProbabilityShift?: number | null; // 0.01 - 1.00
}

type Plan = 'free' | 'starter' | 'pro' | 'elite';

// ─── Plan-based channel restrictions ─────────────────────────────────────────

const PLAN_CHANNEL_RESTRICTIONS: Record<Plan, string[]> = {
  free: ['in_app'],
  starter: ['in_app', 'email', 'push'],
  pro: ['in_app', 'email', 'push', 'webhook'],
  elite: ['in_app', 'email', 'push', 'webhook'],
};

// ─── SQL Queries ─────────────────────────────────────────────────────────────

const QUERIES = {
  getPreferences: `
    SELECT
      np.id, np.user_id, np.market_id,
      np.channel_in_app, np.channel_email, np.channel_push, np.channel_webhook,
      np.webhook_url, np.quiet_hours_start, np.quiet_hours_end, np.min_probability_shift,
      np.created_at, np.updated_at
    FROM notification_preferences np
    JOIN users u ON u.id = np.user_id
    WHERE u.cognito_sub = $1 AND np.market_id IS NULL
    LIMIT 1
  `,

  getUserPlan: `
    SELECT s.plan
    FROM subscriptions s
    JOIN users u ON u.id = s.user_id
    WHERE u.cognito_sub = $1 AND s.status = 'active'
    LIMIT 1
  `,

  resolveUserId: `
    SELECT id FROM users WHERE cognito_sub = $1 LIMIT 1
  `,

  upsertPreferences: `
    INSERT INTO notification_preferences (
      user_id, market_id,
      channel_in_app, channel_email, channel_push, channel_webhook,
      webhook_url, quiet_hours_start, quiet_hours_end, min_probability_shift
    ) VALUES ($1, NULL, $2, $3, $4, $5, $6, $7, $8, $9)
    ON CONFLICT (user_id, market_id)
    DO UPDATE SET
      channel_in_app = EXCLUDED.channel_in_app,
      channel_email = EXCLUDED.channel_email,
      channel_push = EXCLUDED.channel_push,
      channel_webhook = EXCLUDED.channel_webhook,
      webhook_url = EXCLUDED.webhook_url,
      quiet_hours_start = EXCLUDED.quiet_hours_start,
      quiet_hours_end = EXCLUDED.quiet_hours_end,
      min_probability_shift = EXCLUDED.min_probability_shift,
      updated_at = now()
    RETURNING id
  `,
} as const;

// ─── CORS Headers ────────────────────────────────────────────────────────────

const CORS_HEADERS = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type,Authorization',
  'Access-Control-Allow-Methods': 'GET,PUT,OPTIONS',
};

// ─── Handler ─────────────────────────────────────────────────────────────────

export const handler: APIGatewayProxyHandler = async (event): Promise<APIGatewayProxyResult> => {
  // Handle CORS preflight
  if (event.httpMethod === 'OPTIONS') {
    return respond(200, {});
  }

  try {
    const userId = extractUserId(event);
    if (!userId) {
      return respond(401, { error: 'Unauthorized', message: 'Missing authentication' });
    }

    switch (event.httpMethod) {
      case 'GET':
        return await handleGetPreferences(userId);
      case 'PUT':
        return await handlePutPreferences(userId, event.body);
      default:
        return respond(405, { error: 'Method not allowed' });
    }
  } catch (error) {
    console.error('Notification preferences handler error:', error);
    return respond(500, { error: 'Internal server error' });
  }
};

// ─── Route Handlers ──────────────────────────────────────────────────────────

/**
 * GET /user/notifications
 * Returns current notification preferences for the authenticated user.
 */
async function handleGetPreferences(userId: string): Promise<APIGatewayProxyResult> {
  const preferences = await queryPreferences(userId);

  if (!preferences) {
    // Return defaults if no preferences exist yet
    return respond(200, {
      channelInApp: true,
      channelEmail: false,
      channelPush: false,
      channelWebhook: false,
      webhookUrl: null,
      quietHoursStart: null,
      quietHoursEnd: null,
      minProbabilityShift: null,
    });
  }

  return respond(200, {
    channelInApp: preferences.channel_in_app,
    channelEmail: preferences.channel_email,
    channelPush: preferences.channel_push,
    channelWebhook: preferences.channel_webhook,
    webhookUrl: preferences.webhook_url,
    quietHoursStart: preferences.quiet_hours_start,
    quietHoursEnd: preferences.quiet_hours_end,
    minProbabilityShift: preferences.min_probability_shift,
  });
}

/**
 * PUT /user/notifications
 * Validates and persists updated notification preferences.
 */
async function handlePutPreferences(userId: string, body: string | null): Promise<APIGatewayProxyResult> {
  if (!body) {
    return respond(400, { error: 'Request body is required' });
  }

  let payload: NotificationPreferencesPayload;
  try {
    payload = JSON.parse(body);
  } catch {
    return respond(400, { error: 'Invalid JSON body' });
  }

  // Validate required boolean fields are present
  if (typeof payload.channelInApp !== 'boolean' ||
      typeof payload.channelEmail !== 'boolean' ||
      typeof payload.channelPush !== 'boolean' ||
      typeof payload.channelWebhook !== 'boolean') {
    return respond(400, {
      error: 'Validation failed',
      message: 'channelInApp, channelEmail, channelPush, and channelWebhook must be boolean values',
    });
  }

  // Validate webhook URL (must be HTTPS when webhook channel is enabled)
  const webhookValidation = validateWebhookUrl(payload);
  if (webhookValidation) {
    return respond(400, { error: 'Validation failed', message: webhookValidation });
  }

  // Validate probability shift threshold (0.01 - 1.00)
  const shiftValidation = validateProbabilityShift(payload.minProbabilityShift);
  if (shiftValidation) {
    return respond(400, { error: 'Validation failed', message: shiftValidation });
  }

  // Validate quiet hours (both must be set or both null)
  const quietHoursValidation = validateQuietHours(payload.quietHoursStart, payload.quietHoursEnd);
  if (quietHoursValidation) {
    return respond(400, { error: 'Validation failed', message: quietHoursValidation });
  }

  // Check plan-based channel restrictions
  const plan = await getUserPlan(userId);
  const planRestriction = validatePlanChannelAccess(plan, payload);
  if (planRestriction) {
    return respond(403, {
      error: 'Plan restriction',
      message: planRestriction.message,
      requiredPlan: planRestriction.requiredPlan,
      upgradeUrl: '/account/subscription',
    });
  }

  // Persist preferences
  await upsertPreferences(userId, payload);

  return respond(200, {
    message: 'Notification preferences updated successfully',
    channelInApp: payload.channelInApp,
    channelEmail: payload.channelEmail,
    channelPush: payload.channelPush,
    channelWebhook: payload.channelWebhook,
    webhookUrl: payload.webhookUrl || null,
    quietHoursStart: payload.quietHoursStart || null,
    quietHoursEnd: payload.quietHoursEnd || null,
    minProbabilityShift: payload.minProbabilityShift || null,
  });
}

// ─── Validation ──────────────────────────────────────────────────────────────

/**
 * Validate webhook URL - must be a valid HTTPS URL when channelWebhook is enabled.
 */
function validateWebhookUrl(payload: NotificationPreferencesPayload): string | null {
  if (!payload.channelWebhook) {
    return null; // No validation needed if webhook channel is disabled
  }

  if (!payload.webhookUrl) {
    return 'webhookUrl is required when channelWebhook is enabled';
  }

  try {
    const url = new URL(payload.webhookUrl);
    if (url.protocol !== 'https:') {
      return 'webhookUrl must use HTTPS protocol';
    }
  } catch {
    return 'webhookUrl must be a valid URL';
  }

  return null;
}

/**
 * Validate minProbabilityShift - must be between 0.01 and 1.00 (inclusive), or null/zero to disable.
 */
function validateProbabilityShift(shift: number | null | undefined): string | null {
  if (shift === null || shift === undefined || shift === 0) {
    return null; // Disabled - no validation needed
  }

  if (typeof shift !== 'number' || isNaN(shift)) {
    return 'minProbabilityShift must be a number';
  }

  if (shift < 0.01 || shift > 1.00) {
    return 'minProbabilityShift must be between 0.01 and 1.00';
  }

  return null;
}

/**
 * Validate quiet hours - both must be set or both must be null.
 * Format: HH:MM (24-hour).
 */
function validateQuietHours(start: string | null | undefined, end: string | null | undefined): string | null {
  const hasStart = start !== null && start !== undefined;
  const hasEnd = end !== null && end !== undefined;

  if (hasStart !== hasEnd) {
    return 'quietHoursStart and quietHoursEnd must both be set or both be null';
  }

  if (!hasStart && !hasEnd) {
    return null; // Both null is valid
  }

  // Validate HH:MM format
  const timeRegex = /^([01]\d|2[0-3]):([0-5]\d)$/;

  if (!timeRegex.test(start!)) {
    return 'quietHoursStart must be in HH:MM format (24-hour)';
  }

  if (!timeRegex.test(end!)) {
    return 'quietHoursEnd must be in HH:MM format (24-hour)';
  }

  return null;
}

/**
 * Validate that the user's plan allows the requested channels.
 * Returns null if valid, or an error object with message and required plan.
 */
function validatePlanChannelAccess(
  plan: Plan,
  payload: NotificationPreferencesPayload
): { message: string; requiredPlan: string } | null {
  const allowedChannels = PLAN_CHANNEL_RESTRICTIONS[plan];

  // Check each enabled channel against plan restrictions
  if (payload.channelEmail && !allowedChannels.includes('email')) {
    return {
      message: 'Email notifications require a Starter plan or higher. Please upgrade to enable this channel.',
      requiredPlan: 'starter',
    };
  }

  if (payload.channelPush && !allowedChannels.includes('push')) {
    return {
      message: 'Push notifications require a Starter plan or higher. Please upgrade to enable this channel.',
      requiredPlan: 'starter',
    };
  }

  if (payload.channelWebhook && !allowedChannels.includes('webhook')) {
    return {
      message: 'Webhook notifications require a Pro plan or higher. Please upgrade to enable this channel.',
      requiredPlan: 'pro',
    };
  }

  return null;
}

// ─── Database Operations ─────────────────────────────────────────────────────

/**
 * Query notification preferences for a user (global preferences where market_id IS NULL).
 */
async function queryPreferences(userId: string): Promise<Record<string, any> | null> {
  const creds = await getDbCredentials();
  const connectionString = `postgresql://${creds.username}:${encodeURIComponent(creds.password)}@${creds.host}:${creds.port}/${creds.dbname}?sslmode=no-verify`;

  const pg = await import('pg');
  const client = new pg.Client({ connectionString, ssl: { rejectUnauthorized: false } });

  try {
    await client.connect();

    const result = await client.query(QUERIES.getPreferences, [userId]);

    if (result.rows.length === 0) return null;
    return result.rows[0];
  } finally {
    await client.end();
  }
}

/**
 * Get the user's current subscription plan.
 * Defaults to 'free' if no active subscription found.
 */
async function getUserPlan(userId: string): Promise<Plan> {
  const creds = await getDbCredentials();
  const connectionString = `postgresql://${creds.username}:${encodeURIComponent(creds.password)}@${creds.host}:${creds.port}/${creds.dbname}?sslmode=no-verify`;

  const pg = await import('pg');
  const client = new pg.Client({ connectionString, ssl: { rejectUnauthorized: false } });

  try {
    await client.connect();

    const result = await client.query(QUERIES.getUserPlan, [userId]);

    if (result.rows.length === 0) return 'free';
    return result.rows[0].plan as Plan;
  } finally {
    await client.end();
  }
}

/**
 * Upsert notification preferences for a user.
 * Uses ON CONFLICT to update if preferences already exist.
 */
async function upsertPreferences(userId: string, payload: NotificationPreferencesPayload): Promise<void> {
  const creds = await getDbCredentials();
  const connectionString = `postgresql://${creds.username}:${encodeURIComponent(creds.password)}@${creds.host}:${creds.port}/${creds.dbname}?sslmode=no-verify`;

  const pg = await import('pg');
  const client = new pg.Client({ connectionString, ssl: { rejectUnauthorized: false } });

  try {
    await client.connect();

    // Resolve Cognito sub → internal user ID
    const userResult = await client.query(QUERIES.resolveUserId, [userId]);
    if (userResult.rows.length === 0) {
      console.warn(`upsertPreferences: user not found for cognito sub ${userId}`);
      return;
    }
    const internalUserId = userResult.rows[0].id;

    await client.query(QUERIES.upsertPreferences, [
      internalUserId,
      payload.channelInApp,
      payload.channelEmail,
      payload.channelPush,
      payload.channelWebhook,
      payload.webhookUrl || null,
      payload.quietHoursStart || null,
      payload.quietHoursEnd || null,
      payload.minProbabilityShift || null,
    ]);

    console.log(`Preferences upserted for user: ${userId}`);
  } finally {
    await client.end();
  }
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Extract userId from API Gateway authorizer context (JWT claims).
 */
function extractUserId(event: any): string | null {
  try {
    return event.requestContext?.authorizer?.claims?.sub || null;
  } catch {
    return null;
  }
}

/**
 * Build a standard API Gateway response.
 */
function respond(statusCode: number, body: Record<string, unknown>): APIGatewayProxyResult {
  return {
    statusCode,
    headers: CORS_HEADERS,
    body: JSON.stringify(body),
  };
}
