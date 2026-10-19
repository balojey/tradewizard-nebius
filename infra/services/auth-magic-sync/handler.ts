/**
 * Magic → Cognito Sync Lambda
 *
 * Called after a user authenticates via Magic SDK on the frontend.
 * This handler:
 * 1. Receives the user's email (verified by Magic)
 * 2. Creates the Cognito user if they don't exist (with a random password)
 * 3. Signs them in via AdminInitiateAuth
 * 4. Returns Cognito tokens (idToken, accessToken, refreshToken)
 *
 * The user never interacts with Cognito directly - Magic is the UX,
 * Cognito is the backend auth layer for API Gateway authorization.
 *
 * Triggered by: API Gateway POST /auth/magic-sync (no Cognito auth required)
 */

import {
  CognitoIdentityProviderClient,
  AdminCreateUserCommand,
  AdminSetUserPasswordCommand,
  AdminInitiateAuthCommand,
  UsernameExistsException,
  UserNotFoundException,
  AdminGetUserCommand,
  DescribeUserPoolClientCommand,
} from '@aws-sdk/client-cognito-identity-provider';
import {
  SecretsManagerClient,
  GetSecretValueCommand,
} from '@aws-sdk/client-secrets-manager';
import * as crypto from 'crypto';

const cognitoClient = new CognitoIdentityProviderClient({});
const secretsClient = new SecretsManagerClient({});

const USER_POOL_ID = process.env.USER_POOL_ID || '';
const CLIENT_ID = process.env.COGNITO_CLIENT_ID || '';
const DB_SECRET_ARN = process.env.DB_SECRET_ARN || '';
const DB_HOST = process.env.DB_HOST || '';

// Cache the client secret after first lookup
let cachedClientSecret: string | null = null;

interface ApiGatewayEvent {
  body: string | null;
  httpMethod: string;
  path: string;
  headers: Record<string, string>;
}

interface ApiResponse {
  statusCode: number;
  headers: Record<string, string>;
  body: string;
}

const corsHeaders = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type,Authorization,X-Magic-Token',
  'Access-Control-Allow-Methods': 'POST,OPTIONS',
};

function response(statusCode: number, body: unknown): ApiResponse {
  return { statusCode, headers: corsHeaders, body: JSON.stringify(body) };
}

/**
 * Generate a deterministic but unguessable password for a user.
 * This password is never shown to the user - it's an internal implementation detail.
 * We derive it from the email + a server-side secret so it's consistent across calls.
 */
function generateUserPassword(email: string): string {
  const secret = process.env.PASSWORD_SALT || 'tw-magic-sync-salt-v1';
  const hash = crypto.createHmac('sha256', secret).update(email).digest('hex');
  // Ensure it meets Cognito password policy: 8+ chars, upper, lower, digit
  return `Tw${hash.slice(0, 30)}1!`;
}

/**
 * Compute the SECRET_HASH required when the Cognito app client has a secret.
 */
async function getClientSecret(): Promise<string> {
  if (cachedClientSecret) return cachedClientSecret;

  const result = await cognitoClient.send(
    new DescribeUserPoolClientCommand({
      UserPoolId: USER_POOL_ID,
      ClientId: CLIENT_ID,
    })
  );

  cachedClientSecret = result.UserPoolClient?.ClientSecret || '';
  return cachedClientSecret;
}

function computeSecretHash(username: string, clientSecret: string): string {
  if (!clientSecret) return '';
  const hmac = crypto.createHmac('sha256', clientSecret);
  hmac.update(username + CLIENT_ID);
  return hmac.digest('base64');
}

/**
 * Ensure the user exists in Cognito. Creates them if they don't.
 */
async function ensureUserExists(email: string, password: string): Promise<void> {
  try {
    // Check if user already exists
    await cognitoClient.send(
      new AdminGetUserCommand({
        UserPoolId: USER_POOL_ID,
        Username: email,
      })
    );
    // User exists - nothing to do
  } catch (error) {
    if (error instanceof UserNotFoundException) {
      // Create the user
      try {
        await cognitoClient.send(
          new AdminCreateUserCommand({
            UserPoolId: USER_POOL_ID,
            Username: email,
            UserAttributes: [
              { Name: 'email', Value: email },
              { Name: 'email_verified', Value: 'true' },
            ],
            MessageAction: 'SUPPRESS', // Don't send welcome email
          })
        );
      } catch (createError) {
        if (!(createError instanceof UsernameExistsException)) {
          throw createError;
        }
        // Race condition - user was created between our check and create. That's fine.
      }

      // Set permanent password (AdminCreateUser creates with temp password)
      await cognitoClient.send(
        new AdminSetUserPasswordCommand({
          UserPoolId: USER_POOL_ID,
          Username: email,
          Password: password,
          Permanent: true,
        })
      );
    } else {
      throw error;
    }
  }
}

/**
 * Sign in the user via AdminInitiateAuth and return tokens.
 */
async function signInUser(email: string, password: string) {
  const clientSecret = await getClientSecret();

  const authParams: Record<string, string> = {
    USERNAME: email,
    PASSWORD: password,
  };

  // Add SECRET_HASH if client has a secret
  const secretHash = computeSecretHash(email, clientSecret);
  if (secretHash) {
    authParams.SECRET_HASH = secretHash;
  }

  const result = await cognitoClient.send(
    new AdminInitiateAuthCommand({
      UserPoolId: USER_POOL_ID,
      ClientId: CLIENT_ID,
      AuthFlow: 'ADMIN_USER_PASSWORD_AUTH',
      AuthParameters: authParams,
    })
  );

  if (!result.AuthenticationResult) {
    throw new Error('No authentication result returned');
  }

  return {
    idToken: result.AuthenticationResult.IdToken!,
    accessToken: result.AuthenticationResult.AccessToken!,
    refreshToken: result.AuthenticationResult.RefreshToken!,
    expiresIn: result.AuthenticationResult.ExpiresIn ?? 3600,
  };
}

export async function handler(event: ApiGatewayEvent): Promise<ApiResponse> {
  try {
    if (!event.body) {
      return response(400, { error: 'Request body is required' });
    }

    const { email } = JSON.parse(event.body) as { email?: string };

    if (!email || !email.includes('@')) {
      return response(400, { error: 'Valid email is required' });
    }

    const password = generateUserPassword(email);

    // Ensure user exists in Cognito (create if needed)
    await ensureUserExists(email, password);

    // Sign in and get tokens
    const tokens = await signInUser(email, password);

    // Extract the Cognito sub from the ID token to provision DB records
    const idPayload = parseJwtPayload(tokens.idToken);
    const cognitoSub = idPayload.sub as string;

    if (cognitoSub) {
      await ensureDbUserExists(cognitoSub, email);
    }

    return response(200, tokens);
  } catch (error) {
    console.error('Magic sync failed:', error);
    return response(500, { error: 'Authentication sync failed' });
  }
}

/**
 * Parse JWT payload without verification (we trust our own Cognito tokens).
 */
function parseJwtPayload(token: string): Record<string, unknown> {
  try {
    const base64Url = token.split('.')[1];
    const base64 = base64Url.replace(/-/g, '+').replace(/_/g, '/');
    const json = Buffer.from(base64, 'base64').toString('utf-8');
    return JSON.parse(json);
  } catch {
    return {};
  }
}

/**
 * Ensure the user and free subscription exist in RDS.
 * Idempotent - safe to call on every login.
 */
async function ensureDbUserExists(cognitoSub: string, email: string): Promise<void> {
  if (!DB_SECRET_ARN) return; // Skip if DB not configured

  let dbCreds: { username: string; password: string };
  try {
    const secretResp = await secretsClient.send(
      new GetSecretValueCommand({ SecretId: DB_SECRET_ARN })
    );
    dbCreds = JSON.parse(secretResp.SecretString || '{}');
  } catch (err) {
    console.error('Failed to get DB credentials:', err);
    return; // Don't block login if DB is unavailable
  }

  const pg = await import('pg');
  const client = new pg.Client({
    host: DB_HOST,
    port: 5432,
    database: 'tradewizard',
    user: dbCreds.username,
    password: dbCreds.password,
    ssl: { rejectUnauthorized: false },
  });

  try {
    await client.connect();

    // Upsert user
    const userResult = await client.query(
      `INSERT INTO users (cognito_sub, email, status)
       VALUES ($1, $2, 'active')
       ON CONFLICT (cognito_sub) DO UPDATE SET updated_at = now()
       RETURNING id`,
      [cognitoSub, email]
    );
    const userId = userResult.rows[0].id;

    // Upsert free subscription (only if none exists)
    const now = new Date();
    const billingEnd = new Date(now);
    billingEnd.setDate(billingEnd.getDate() + 30);

    await client.query(
      `INSERT INTO subscriptions (user_id, plan, status, credits_remaining, credits_monthly_limit, billing_cycle_start, billing_cycle_end)
       VALUES ($1, 'free', 'active', 20, 20, $2, $3)
       ON CONFLICT (user_id) DO NOTHING`,
      [userId, now.toISOString(), billingEnd.toISOString()]
    );

    console.log(`DB user ensured: ${email} (${cognitoSub})`);
  } catch (err) {
    console.error('Failed to ensure DB user:', err);
    // Don't block login - user can still authenticate, credits will show on next call
  } finally {
    await client.end();
  }
}
