/**
 * Shared database client for Lambda functions.
 * Connects to RDS PostgreSQL using credentials from Secrets Manager.
 */

import {
  SecretsManagerClient,
  GetSecretValueCommand,
} from '@aws-sdk/client-secrets-manager';

const secretsClient = new SecretsManagerClient({});

interface DbCredentials {
  username: string;
  password: string;
  host: string;
  port: number;
  dbname: string;
}

let cachedCredentials: DbCredentials | null = null;

/**
 * Retrieve database credentials from Secrets Manager (cached for Lambda reuse).
 */
export async function getDbCredentials(): Promise<DbCredentials> {
  if (cachedCredentials) return cachedCredentials;

  const secretArn = process.env.DB_SECRET_ARN;
  if (!secretArn) throw new Error('DB_SECRET_ARN environment variable not set');

  const response = await secretsClient.send(
    new GetSecretValueCommand({ SecretId: secretArn })
  );

  if (!response.SecretString) throw new Error('Secret has no string value');

  const secret = JSON.parse(response.SecretString);
  cachedCredentials = {
    username: secret.username,
    password: secret.password,
    host: secret.host || process.env.DB_HOST || '',
    port: secret.port || 5432,
    dbname: secret.dbname || 'tradewizard',
  };

  return cachedCredentials;
}

/**
 * Build a PostgreSQL connection string from credentials.
 */
export async function getConnectionString(): Promise<string> {
  const creds = await getDbCredentials();
  return `postgresql://${creds.username}:${encodeURIComponent(creds.password)}@${creds.host}:${creds.port}/${creds.dbname}?sslmode=no-verify`;
}

// ─── Cognito Sub → Internal User ID Translation ────────────────────────────────
//
// The platform stores users with a UUID `users.id` (internal) and a TEXT
// `users.cognito_sub` (Cognito's user identifier). Most cross-service
// boundaries (SNS payloads, EventBridge events, WebSocket connection records)
// MUST carry the internal `users.id` so RDS lookups via FK (e.g.
// `notification_preferences.user_id`, `subscriptions.user_id`) work without
// translation in every handler.
//
// Use these helpers at the *first* boundary that receives a Cognito sub from
// API Gateway / WebSocket / Cognito triggers, then propagate the internal id
// through SQS, SNS, and EventBridge payloads.

const subToIdCache = new Map<string, string>();

/**
 * Resolve a Cognito sub to the internal `users.id` UUID.
 *
 * Cached per Lambda container to avoid hitting RDS on every request.
 * Returns `null` if the user does not exist (e.g. signup race condition).
 */
export async function getUserIdByCognitoSub(cognitoSub: string): Promise<string | null> {
  if (!cognitoSub) return null;

  const cached = subToIdCache.get(cognitoSub);
  if (cached) return cached;

  const connectionString = await getConnectionString();
  const pg = await import('pg');
  const client = new pg.Client({ connectionString, ssl: { rejectUnauthorized: false } });

  try {
    await client.connect();
    const result = await client.query(
      `SELECT id FROM users WHERE cognito_sub = $1 LIMIT 1`,
      [cognitoSub]
    );

    if (result.rows.length === 0) return null;

    const internalId = result.rows[0].id as string;
    subToIdCache.set(cognitoSub, internalId);
    return internalId;
  } finally {
    await client.end();
  }
}

/**
 * Determine whether a string looks like an internal `users.id` UUID
 * (vs. a Cognito sub, which is also UUID-shaped but always sourced from
 * the IdP). Returns true if the string is a UUID.
 *
 * Used as a defensive guard - the canonical answer is "use the helpers".
 */
export function isLikelyUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}

// ─── Just-In-Time User Provisioning (Self-Healing) ──────────────────────────────
//
// If a request arrives with a valid Cognito/Magic JWT but no corresponding
// `users` row (e.g., post-confirmation trigger failure, DB wipe during dev,
// race condition on first request), this function creates the user on the fly.
//
// This makes the system self-healing: Magic auth is the source of truth for
// identity - if the JWT is valid, the backend accommodates.

/**
 * Ensure a user exists in the `users` table. If missing, creates one with
 * free plan defaults (20 credits). Returns the internal `users.id`.
 *
 * This is the primary entry point for all authenticated Lambda handlers.
 * Call this early in request processing instead of raw `getUserIdByCognitoSub`.
 *
 * @param cognitoSub - The Cognito user sub from the JWT claims
 * @param email - The user's email from JWT claims (used for creation if needed)
 * @returns The internal `users.id` UUID (never null - creates if missing)
 */
export async function ensureUser(cognitoSub: string, email?: string): Promise<string> {
  if (!cognitoSub) {
    throw new Error('ensureUser: cognitoSub is required');
  }

  // Fast path: check cache first
  const cached = subToIdCache.get(cognitoSub);
  if (cached) return cached;

  const connectionString = await getConnectionString();
  const pg = await import('pg');
  const client = new pg.Client({ connectionString, ssl: { rejectUnauthorized: false } });

  try {
    await client.connect();

    // Try to find existing user
    const existing = await client.query(
      `SELECT id FROM users WHERE cognito_sub = $1 LIMIT 1`,
      [cognitoSub]
    );

    if (existing.rows.length > 0) {
      const internalId = existing.rows[0].id as string;
      subToIdCache.set(cognitoSub, internalId);
      return internalId;
    }

    // User doesn't exist - create with free plan defaults
    console.log(`[ensureUser] User not found for cognito_sub=${cognitoSub}, creating with free plan defaults`);

    const userEmail = email || `${cognitoSub}@unknown.local`;

    // Insert user
    const insertResult = await client.query(
      `INSERT INTO users (cognito_sub, email)
       VALUES ($1, $2)
       ON CONFLICT (cognito_sub) DO UPDATE SET cognito_sub = EXCLUDED.cognito_sub
       RETURNING id`,
      [cognitoSub, userEmail]
    );

    const newUserId = insertResult.rows[0].id as string;

    // Create free subscription with 20 credits
    await client.query(
      `INSERT INTO subscriptions (user_id, plan, status, credits_remaining, credits_monthly_limit)
       VALUES ($1, 'free', 'active', 20, 20)
       ON CONFLICT (user_id) DO NOTHING`,
      [newUserId]
    );

    // Record initial credit transaction
    await client.query(
      `INSERT INTO credit_transactions (user_id, amount, balance_after, reason, reference_type, credit_source)
       VALUES ($1, 20, 20, 'free_plan_signup', 'system', 'plan')
       ON CONFLICT DO NOTHING`,
      [newUserId]
    );

    console.log(`[ensureUser] Created user ${newUserId} (email: ${userEmail}, plan: free, credits: 20)`);

    subToIdCache.set(cognitoSub, newUserId);
    return newUserId;
  } finally {
    await client.end();
  }
}
