/**
 * Post-Confirmation Lambda Trigger
 *
 * Triggered by Cognito after a user successfully confirms their account.
 * Creates the user record and free-tier subscription in RDS.
 *
 * This ensures every new user gets:
 * - A row in the `users` table
 * - A row in the `subscriptions` table with 5 free credits
 */

import { Client } from 'pg';
import {
  SecretsManagerClient,
  GetSecretValueCommand,
} from '@aws-sdk/client-secrets-manager';

const secretsClient = new SecretsManagerClient({});

const DB_SECRET_ARN = process.env.DB_SECRET_ARN || '';
const DB_HOST = process.env.DB_HOST || '';
const DB_NAME = process.env.DB_NAME || 'tradewizard';

interface DbCredentials {
  username: string;
  password: string;
}

let cachedCredentials: DbCredentials | null = null;

async function getDbCredentials(): Promise<DbCredentials> {
  if (cachedCredentials) return cachedCredentials;

  const response = await secretsClient.send(
    new GetSecretValueCommand({ SecretId: DB_SECRET_ARN })
  );

  if (!response.SecretString) {
    throw new Error('DB secret is empty');
  }

  cachedCredentials = JSON.parse(response.SecretString) as DbCredentials;
  return cachedCredentials;
}

async function getDbClient(): Promise<Client> {
  const creds = await getDbCredentials();
  const client = new Client({
    host: DB_HOST,
    port: 5432,
    database: DB_NAME,
    user: creds.username,
    password: creds.password,
    ssl: { rejectUnauthorized: false },
  });
  await client.connect();
  return client;
}

interface PostConfirmationEvent {
  version: string;
  triggerSource: string;
  region: string;
  userPoolId: string;
  userName: string;
  request: {
    userAttributes: {
      sub: string;
      email: string;
      email_verified?: string;
      [key: string]: string | undefined;
    };
  };
  response: Record<string, unknown>;
}

export async function handler(event: PostConfirmationEvent): Promise<PostConfirmationEvent> {
  console.log('Post-confirmation trigger:', JSON.stringify({
    triggerSource: event.triggerSource,
    userName: event.userName,
    sub: event.request.userAttributes.sub,
    email: event.request.userAttributes.email,
  }));

  // Only process actual sign-up confirmations (not admin-created users or forgot-password)
  if (event.triggerSource !== 'PostConfirmation_ConfirmSignUp') {
    return event;
  }

  const { sub, email } = event.request.userAttributes;

  if (!sub || !email) {
    console.error('Missing sub or email in user attributes');
    return event;
  }

  const client = await getDbClient();

  try {
    await client.query('BEGIN');

    // Insert user (ignore if already exists - idempotent)
    const userResult = await client.query(
      `INSERT INTO users (cognito_sub, email, status)
       VALUES ($1, $2, 'active')
       ON CONFLICT (cognito_sub) DO UPDATE SET updated_at = now()
       RETURNING id`,
      [sub, email]
    );

    const userId = userResult.rows[0].id;

    // Calculate billing cycle (30 days from now)
    const now = new Date();
    const billingEnd = new Date(now);
    billingEnd.setDate(billingEnd.getDate() + 30);

    // Insert free subscription (ignore if already exists - idempotent)
    await client.query(
      `INSERT INTO subscriptions (user_id, plan, status, credits_remaining, credits_monthly_limit, billing_cycle_start, billing_cycle_end)
       VALUES ($1, 'free', 'active', 20, 20, $2, $3)
       ON CONFLICT (user_id) DO NOTHING`,
      [userId, now.toISOString(), billingEnd.toISOString()]
    );

    // Record the initial credit grant
    await client.query(
      `INSERT INTO credit_transactions (user_id, amount, balance_after, reason, reference_type)
       VALUES ($1, 20, 20, 'Initial free plan credits', 'signup')
       ON CONFLICT DO NOTHING`,
      [userId]
    );

    await client.query('COMMIT');
    console.log(`Created user and subscription for ${email} (${sub})`);
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Failed to create user/subscription:', error);
    // Don't throw - we don't want to block the user from signing up
    // The user can be provisioned on first API call as a fallback
  } finally {
    await client.end();
  }

  return event;
}
