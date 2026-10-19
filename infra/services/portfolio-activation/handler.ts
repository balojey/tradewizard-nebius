/**
 * Portfolio Activation Service - Lambda handler.
 *
 * Creates and validates portfolio manager sessions. Verifies:
 * 1. Request body (marketId, investmentAmount) via Zod
 * 2. User subscription tier (Pro or Elite required)
 * 3. Concurrent session limits (3 Pro / 10 Elite)
 * 4. No existing active session for this user+market
 * 5. Active recurring analysis subscription exists for the market
 * 6. Wallet balance >= investmentAmount
 * 7. Market is not resolved
 * 8. User's persona config (with Elite customization if applicable)
 *
 * On success: inserts session record, snapshots persona config,
 * creates EventBridge Scheduler rule for position guard monitoring.
 *
 * Triggered by: API Gateway POST /portfolio/sessions
 *
 * Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 1.7, 1.8, 1.9, 1.10, 1.11
 */

import {
  SchedulerClient,
  CreateScheduleCommand,
} from '@aws-sdk/client-scheduler';
import { getConnectionString } from '../shared/db';
import { readBalance } from '../shared/chain-verification';
import {
  ActivateSessionRequestSchema,
  SESSION_LIMITS,
} from '../shared/portfolio-types';
import { SESSION_QUERIES, UTILITY_QUERIES } from '../shared/portfolio-db';
import {
  getPersonaOrThrow,
  applyCustomParams,
} from '../shared/persona-registry';
import type { Persona, PersonaCustomParams } from '../shared/portfolio-types';

// ─── Configuration ───────────────────────────────────────────────────────────

const ENVIRONMENT = process.env.ENVIRONMENT || 'development';
const SCHEDULER_ROLE_ARN = process.env.SCHEDULER_ROLE_ARN || '';
const POSITION_GUARD_LAMBDA_ARN = process.env.POSITION_GUARD_LAMBDA_ARN || '';
const USDC_DECIMALS = 6;

const schedulerClient = new SchedulerClient({});

// ─── CORS Headers ────────────────────────────────────────────────────────────

const CORS_HEADERS = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type,Authorization',
};

// ─── Interfaces ──────────────────────────────────────────────────────────────

interface ApiGatewayEvent {
  body: string | null;
  requestContext: {
    authorizer: {
      claims: {
        sub: string;
        email: string;
      };
    };
  };
  httpMethod: string;
  path: string;
}

interface ApiResponse {
  statusCode: number;
  headers: Record<string, string>;
  body: string;
}

// ─── Main Handler ────────────────────────────────────────────────────────────

export async function handler(event: ApiGatewayEvent): Promise<ApiResponse> {
  try {
    // Parse and validate request body
    if (!event.body) {
      return errorResponse(400, 'Request body is required');
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(event.body);
    } catch {
      return errorResponse(400, 'Invalid JSON in request body');
    }

    const validation = ActivateSessionRequestSchema.safeParse(parsed);
    if (!validation.success) {
      const issues = validation.error.issues.map((i) => i.message).join('; ');
      return errorResponse(400, `Validation failed: ${issues}`);
    }

    const { marketId, investmentAmount, profitTargetPct } = validation.data;

    // Extract userId from Cognito authorizer
    const cognitoSub = event.requestContext.authorizer.claims.sub;

    // Connect to database
    const connectionString = await getConnectionString();
    const pg = await import('pg');
    const client = new pg.Client({
      connectionString,
      ssl: { rejectUnauthorized: false },
    });

    try {
      await client.connect();

      // Step 1: Get user record and subscription info
      const userResult = await client.query(
        `SELECT u.id, u.portfolio_persona_id, u.portfolio_persona_params,
                s.plan, s.status AS sub_status, s.wallet_address
         FROM users u
         LEFT JOIN subscriptions s ON s.user_id = u.id AND s.status IN ('active', 'grace_period')
         WHERE u.cognito_sub = $1
         LIMIT 1`,
        [cognitoSub]
      );

      if (userResult.rows.length === 0) {
        return errorResponse(403, 'User not found');
      }

      const user = userResult.rows[0];
      const userId: string = user.id;
      const plan: string = user.plan || 'free';
      const walletAddress: string | null = user.wallet_address;

      // Step 2: Check subscription tier (Pro or Elite required)
      if (plan !== 'pro' && plan !== 'elite') {
        return errorResponse(
          403,
          'Portfolio Manager requires a Pro or Elite subscription. Please upgrade your plan to activate autonomous trading.'
        );
      }

      // Step 3: Count active sessions and enforce limits
      const sessionCountResult = await client.query(
        UTILITY_QUERIES.countActiveSessionsByUser,
        [userId]
      );
      const activeCount: number = sessionCountResult.rows[0]?.active_count ?? 0;
      const sessionLimit = SESSION_LIMITS[plan as 'pro' | 'elite'];

      if (activeCount >= sessionLimit) {
        return errorResponse(
          403,
          `Concurrent session limit reached. You have ${activeCount} active session(s) and your ${plan} plan allows a maximum of ${sessionLimit}.`
        );
      }

      // Step 4: Check no existing active session for this user+market
      const existingSessionResult = await client.query(
        UTILITY_QUERIES.checkExistingActiveSession,
        [userId, marketId]
      );

      if (existingSessionResult.rows.length > 0) {
        return errorResponse(
          400,
          `An active Portfolio Manager session already exists for this market. Session ID: ${existingSessionResult.rows[0].id}`
        );
      }

      // Step 5: Verify recurring analysis subscription exists for this market
      const recurringAnalysisResult = await client.query(
        `SELECT id FROM analysis_requests
         WHERE user_id = $1 AND market_id = $2
           AND request_type = 'recurring' AND status = 'active'
         LIMIT 1`,
        [userId, marketId]
      );

      if (recurringAnalysisResult.rows.length === 0) {
        return errorResponse(
          400,
          'An active recurring analysis subscription is required on this market before activating the Portfolio Manager. Please set up recurring analysis first.'
        );
      }

      const recurringAnalysisId: string = recurringAnalysisResult.rows[0].id;

      // Step 6: Verify wallet balance >= investmentAmount (accounting for committed capital)
      if (!walletAddress) {
        return errorResponse(
          400,
          'No wallet address found. Please connect your wallet before activating the Portfolio Manager.'
        );
      }

      // Calculate total capital already committed to other active sessions
      const committedResult = await client.query(
        `SELECT COALESCE(SUM(investment_amount), 0)::numeric AS total_committed
         FROM portfolio_manager_sessions
         WHERE user_id = $1 AND status IN ('active', 'paused', 'exiting')`,
        [userId]
      );
      const totalCommitted = Number(committedResult.rows[0]?.total_committed ?? 0);

      try {
        const balanceRaw = await readBalance(walletAddress);
        const balanceUsdc = Number(balanceRaw) / 10 ** USDC_DECIMALS;
        const availableBalance = balanceUsdc - totalCommitted;

        if (availableBalance < investmentAmount) {
          return errorResponse(
            400,
            `Insufficient available balance. Your wallet holds $${balanceUsdc.toFixed(2)} USDC.e but $${totalCommitted.toFixed(2)} is already committed to active Portfolio Manager sessions. Available: $${availableBalance.toFixed(2)}, requested: $${investmentAmount.toFixed(2)}.`
          );
        }
      } catch (error) {
        console.error('Wallet balance verification failed:', error);
        return errorResponse(
          400,
          'Unable to verify wallet balance. Please try again later.'
        );
      }

      // Step 7: Check market is not resolved
      const marketResult = await client.query(
        `SELECT id, resolved FROM markets WHERE condition_id = $1 LIMIT 1`,
        [marketId]
      );

      if (marketResult.rows.length > 0 && marketResult.rows[0].resolved) {
        return errorResponse(
          400,
          'This market has already resolved. Portfolio Manager cannot be activated on resolved markets.'
        );
      }

      // Step 8: Get user's persona config (with Elite customization if applicable)
      const personaId: string = user.portfolio_persona_id || 'scalper';
      let personaConfig: Persona = getPersonaOrThrow(personaId);

      // Apply Elite customization if user has custom params
      if (plan === 'elite' && user.portfolio_persona_params) {
        const customParams: PersonaCustomParams =
          typeof user.portfolio_persona_params === 'string'
            ? JSON.parse(user.portfolio_persona_params)
            : user.portfolio_persona_params;

        personaConfig = applyCustomParams(personaConfig, customParams);
      }

      // Step 9: Insert session record with persona snapshot and optional profit target
      const sessionResult = await client.query(SESSION_QUERIES.createSession, [
        userId,
        marketId,
        recurringAnalysisId,
        personaId,
        JSON.stringify(personaConfig),
        investmentAmount,
        investmentAmount, // amount_available = investmentAmount initially
        profitTargetPct ?? null, // optional profit target
      ]);

      const session = sessionResult.rows[0];
      const sessionId: string = session.id;

      // Step 10: Create EventBridge Scheduler rule for position guard monitoring
      const monitoringIntervalMinutes =
        personaConfig.monitoringRules.positionGuardIntervalMinutes;
      const scheduleName = `tw-${ENVIRONMENT}-pg-${sessionId.slice(0, 8)}`;

      try {
        await schedulerClient.send(
          new CreateScheduleCommand({
            Name: scheduleName,
            ScheduleExpression: `rate(${monitoringIntervalMinutes} minutes)`,
            FlexibleTimeWindow: { Mode: 'FLEXIBLE', MaximumWindowInMinutes: 1 },
            Target: {
              Arn: POSITION_GUARD_LAMBDA_ARN,
              RoleArn: SCHEDULER_ROLE_ARN,
              Input: JSON.stringify({
                sessionId,
                userId,
                marketId,
              }),
            },
            State: 'ENABLED',
          })
        );

        // Store the schedule ARN in the session record
        const scheduleArn = `arn:aws:scheduler:${process.env.AWS_REGION || 'us-east-1'}:${process.env.AWS_ACCOUNT_ID || ''}:schedule/default/${scheduleName}`;
        await client.query(UTILITY_QUERIES.updateScheduleArn, [
          scheduleArn,
          sessionId,
        ]);
      } catch (error) {
        console.error('Failed to create position guard schedule:', error);
        // Session is still created - schedule can be retried
      }

      // Step 11: Return 201 with session ID and status
      return {
        statusCode: 201,
        headers: CORS_HEADERS,
        body: JSON.stringify({
          sessionId,
          status: 'active',
          profitTargetPct: profitTargetPct ?? null,
          committedCapital: totalCommitted + investmentAmount,
        }),
      };
    } finally {
      await client.end();
    }
  } catch (error) {
    console.error('Portfolio activation failed:', error);
    return errorResponse(500, 'Internal server error');
  }
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function errorResponse(statusCode: number, message: string): ApiResponse {
  return {
    statusCode,
    headers: CORS_HEADERS,
    body: JSON.stringify({ error: message }),
  };
}
