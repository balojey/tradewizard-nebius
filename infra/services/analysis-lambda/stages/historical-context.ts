/**
 * Historical Context Retrieval Stage
 *
 * Retrieves the past N analysis results for a market from RDS (agent_memory table)
 * so agents can reference their own historical signals for consistency and drift
 * detection.
 *
 * This replaces the AgentCore Memory integration. RDS + S3 are the canonical
 * platform storage - agent signals are written to agent_memory by the
 * analysis-orchestrator Lambda after each run.
 *
 * Environment variables:
 *   DB_SECRET_ARN: ARN of the Secrets Manager secret containing DB credentials.
 *   DB_HOST:       RDS endpoint (used as fallback if not in the secret).
 *   ANALYSIS_HISTORY_DEPTH: Number of past analyses to fetch (default: 5, clamped 1–20).
 *
 * Requirements: 13.1, 13.2, 13.3, 13.4, 13.5, 13.6
 */

import {
  SecretsManagerClient,
  GetSecretValueCommand,
} from '@aws-sdk/client-secrets-manager';

// ─── Types ─────────────────────────────────────────────────────────────────────

export interface HistoricalSignal {
  agentName: string;
  direction: string;
  confidence: number;
  fairProbability: number;
  keyDrivers: string[];
}

export interface HistoricalEntry {
  timestamp: string;
  action: string;
  consensusProbability: number;
  marketProbability: number;
  signals: HistoricalSignal[];
  /** Realized outcome of the prior recommendation, when scored. */
  outcomeStatus?: string;
  outcomeHitPrice?: number | null;
  outcomeResolvedAt?: string | null;
  entryPrice?: number | null;
  targetPrice?: number | null;
  stopLossPrice?: number | null;
}

// ─── Module-scoped credential cache (reused across warm invocations) ───────────

interface DbCredentials {
  host: string;
  port: number;
  dbname: string;
  username: string;
  password: string;
}

let cachedCredentials: DbCredentials | null = null;

const secretsClient = new SecretsManagerClient({});

// ─── Credential Retrieval ──────────────────────────────────────────────────────

/**
 * Retrieve RDS credentials from Secrets Manager (cached on cold start).
 * Falls back to DB_HOST for the host if not present in the secret.
 *
 * Returns null if DB_SECRET_ARN is not configured, enabling graceful
 * degradation without historical context.
 */
async function getDbCredentials(): Promise<DbCredentials | null> {
  if (cachedCredentials) return cachedCredentials;

  const secretArn = process.env.DB_SECRET_ARN;
  if (!secretArn) {
    console.warn('[HistoricalContext] DB_SECRET_ARN not set - history fetch disabled');
    return null;
  }

  try {
    const response = await secretsClient.send(
      new GetSecretValueCommand({ SecretId: secretArn })
    );

    if (!response.SecretString) {
      console.warn('[HistoricalContext] Secret has no string value - history fetch disabled');
      return null;
    }

    const secret = JSON.parse(response.SecretString);

    cachedCredentials = {
      host: secret.host || process.env.DB_HOST || '',
      port: parseInt(secret.port || '5432', 10),
      dbname: secret.dbname || 'tradewizard',
      username: secret.username,
      password: secret.password,
    };

    return cachedCredentials;
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    console.warn(`[HistoricalContext] Failed to retrieve DB credentials: ${msg} - history disabled`);
    return null;
  }
}

// ─── Utility Functions ─────────────────────────────────────────────────────────

/**
 * Clamps the ANALYSIS_HISTORY_DEPTH env var to [1, 20].
 * Defaults to 5 if not set or not a valid number.
 */
export function clampHistoryDepth(envValue?: string): number {
  const raw = envValue ?? process.env.ANALYSIS_HISTORY_DEPTH ?? '5';
  const parsed = parseInt(raw, 10);

  if (isNaN(parsed)) return 5;

  return Math.max(1, Math.min(20, parsed));
}

/**
 * Filters memory entries to include only signals matching the target agent name.
 * Each agent receives only its own historical signals - no cross-agent anchoring.
 */
export function filterMemoryForAgent(
  entries: HistoricalEntry[],
  agentName: string
): HistoricalEntry[] {
  return entries
    .map((entry) => ({
      ...entry,
      signals: entry.signals.filter((s) => s.agentName === agentName),
    }))
    .filter((entry) => entry.signals.length > 0);
}

// ─── Main Entry Point ──────────────────────────────────────────────────────────

/**
 * Fetches historical agent signals for a market from the RDS agent_memory table.
 *
 * Queries the most recent N analyses (ordered by executed_at DESC) and returns
 * per-agent signals grouped by analysis run. Each returned entry contains:
 * - timestamp (ISO 8601)
 * - action (recommendation from analysis_results)
 * - consensusProbability
 * - marketProbability
 * - signals (array of per-agent signals)
 *
 * On failure: returns empty array and logs a warning. Never throws.
 */
export async function fetchHistoricalContext(
  marketId: string,
  depth?: number
): Promise<HistoricalEntry[]> {
  const n = depth ?? clampHistoryDepth();

  const creds = await getDbCredentials();
  if (!creds) return [];

  let client: import('pg').Client | null = null;

  try {
    const pg = await import('pg');

    const connectionString = `postgresql://${creds.username}:${encodeURIComponent(creds.password)}@${creds.host}:${creds.port}/${creds.dbname}?sslmode=no-verify`;
    client = new pg.Client({
      connectionString,
      ssl: { rejectUnauthorized: false },
      statement_timeout: 15_000,
    });

    await client.connect();

    // Step 1: Get the N most recent result IDs for this market
    const resultQuery = await client.query(
      `SELECT
        id,
        executed_at,
        recommendation,
        consensus_probability,
        market_probability_at_execution,
        entry_price,
        target_price,
        stop_loss_price,
        outcome_status,
        outcome_hit_price,
        outcome_resolved_at
      FROM analysis_results
      WHERE market_id = $1
      ORDER BY executed_at DESC
      LIMIT $2`,
      [marketId, n]
    );

    if (resultQuery.rows.length === 0) {
      console.log(`[HistoricalContext] No historical analyses found for market=${marketId.slice(0, 16)}`);
      return [];
    }

    const resultRows = resultQuery.rows as Array<{
      id: string;
      executed_at: Date;
      recommendation: string | null;
      consensus_probability: string | null;
      market_probability_at_execution: string | null;
      entry_price: string | null;
      target_price: string | null;
      stop_loss_price: string | null;
      outcome_status: string | null;
      outcome_hit_price: string | null;
      outcome_resolved_at: Date | string | null;
    }>;

    const resultIds = resultRows.map((row) => row.id);
    const resultMeta = new Map(resultRows.map((row) => [row.id, row]));

    // Step 2: Fetch all agent signals for those result IDs
    const signalQuery = await client.query(
      `SELECT
        result_id,
        agent_name,
        direction,
        confidence,
        fair_probability,
        key_drivers
      FROM agent_memory
      WHERE result_id = ANY($1)
        AND market_id = $2
      ORDER BY result_id, agent_name`,
      [resultIds, marketId]
    );

    const signalRows = signalQuery.rows as Array<{
      result_id: string;
      agent_name: string;
      direction: string;
      confidence: string | number;
      fair_probability: string | number;
      key_drivers: string[] | string | null;
    }>;

    // Step 3: Group signals by result_id
    const signalsByResult = new Map<string, HistoricalSignal[]>();
    for (const rid of resultIds) {
      signalsByResult.set(rid, []);
    }

    for (const sig of signalRows) {
      const rid = sig.result_id;
      const signals = signalsByResult.get(rid);
      if (!signals) continue;

      // key_drivers is JSONB - may already be parsed or may be a string
      let keyDrivers: string[] = [];
      if (Array.isArray(sig.key_drivers)) {
        keyDrivers = sig.key_drivers.slice(0, 3);
      } else if (typeof sig.key_drivers === 'string') {
        try {
          const parsed = JSON.parse(sig.key_drivers);
          keyDrivers = Array.isArray(parsed) ? parsed.slice(0, 3) : [];
        } catch {
          keyDrivers = [];
        }
      }

      signals.push({
        agentName: sig.agent_name,
        direction: sig.direction,
        confidence: Number(sig.confidence),
        fairProbability: Number(sig.fair_probability),
        keyDrivers,
      });
    }

    // Step 4: Build the final list in result order (most recent first)
    const history: HistoricalEntry[] = [];
    for (const rid of resultIds) {
      const meta = resultMeta.get(rid)!;
      const toNumberOrNull = (value: unknown): number | null => {
        if (value === null || value === undefined) return null;
        const parsed = Number(value);
        return Number.isFinite(parsed) ? parsed : null;
      };
      const toIsoOrNull = (value: unknown): string | null => {
        if (value === null || value === undefined) return null;
        if (value instanceof Date) return value.toISOString();
        const parsed = new Date(String(value));
        return Number.isNaN(parsed.getTime()) ? String(value) : parsed.toISOString();
      };

      history.push({
        timestamp: meta.executed_at instanceof Date
          ? meta.executed_at.toISOString()
          : String(meta.executed_at),
        action: meta.recommendation || 'NO_TRADE',
        consensusProbability: parseFloat(String(meta.consensus_probability ?? '0.5')),
        marketProbability: parseFloat(String(meta.market_probability_at_execution ?? '0.5')),
        signals: signalsByResult.get(rid) || [],
        outcomeStatus: meta.outcome_status ?? undefined,
        outcomeHitPrice: toNumberOrNull(meta.outcome_hit_price),
        outcomeResolvedAt: toIsoOrNull(meta.outcome_resolved_at),
        entryPrice: toNumberOrNull(meta.entry_price),
        targetPrice: toNumberOrNull(meta.target_price),
        stopLossPrice: toNumberOrNull(meta.stop_loss_price),
      });
    }

    console.log(
      `[HistoricalContext] Fetched ${history.length} historical analyses (${signalRows.length} agent signals) for market=${marketId.slice(0, 16)}`
    );

    return history;
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    console.warn(
      `[HistoricalContext] History fetch failed for market=${marketId.slice(0, 16)}: ${msg} - continuing without context`
    );
    return [];
  } finally {
    if (client) {
      try {
        await client.end();
      } catch {
        // Ignore cleanup errors
      }
    }
  }
}

// ─── Dynamic Agent Performance Weights ─────────────────────────────────────────

interface SignalOutcomeRow {
  agent_name: string;
  direction: string;
  fair_probability: string | number;
  outcome: number; // 1 = YES, 0 = NO
}

const WEIGHTED_SIGNAL_QUERY = `
  SELECT
    am.agent_name,
    am.direction,
    am.fair_probability,
    CASE
      WHEN ar.recommendation = 'LONG_YES' AND ar.outcome_status = 'success' THEN 1
      WHEN ar.recommendation = 'LONG_YES' AND ar.outcome_status = 'failure' THEN 0
      WHEN ar.recommendation = 'LONG_NO'  AND ar.outcome_status = 'success' THEN 0
      WHEN ar.recommendation = 'LONG_NO'  AND ar.outcome_status = 'failure' THEN 1
    END AS outcome
  FROM agent_memory am
  JOIN analysis_results ar ON ar.id = am.result_id
  WHERE ar.outcome_status IN ('success', 'failure')
    AND ar.recommendation IN ('LONG_YES', 'LONG_NO')
    AND am.direction != 'NEUTRAL'
`;

/**
 * Fetches agent performance weights for signal fusion.
 *
 * Strategy:
 * 1. Try per-market calibration (from scored recommendations on this market)
 * 2. Fall back to global calibration (scored recommendations in last 30 days)
 * 3. Fall back to empty map (all agents get default weight 1.0)
 *
 * Weights are based on Brier calibration, blended with directional accuracy.
 * This is deliberately better than direction-only scoring: an agent that is
 * directionally right but badly overconfident still gets penalized.
 *
 * Minimum 2 signals required per agent to be included in the map.
 * Agents not in the map will use the default TYPE_WEIGHTS × 1.0 in fuseSignals.
 *
 * On failure: returns empty map and logs a warning. Never throws.
 */
export async function fetchAgentPerformanceWeights(
  marketId: string
): Promise<Record<string, number>> {
  const creds = await getDbCredentials();
  if (!creds) return {};

  let client: import('pg').Client | null = null;

  try {
    const pg = await import('pg');

    const connectionString = `postgresql://${creds.username}:${encodeURIComponent(creds.password)}@${creds.host}:${creds.port}/${creds.dbname}?sslmode=no-verify`;
    client = new pg.Client({
      connectionString,
      ssl: { rejectUnauthorized: false },
      statement_timeout: 10_000,
    });

    await client.connect();

    // Step 1: Try per-market calibration.
    const marketResult = await client.query<SignalOutcomeRow>(
      `${WEIGHTED_SIGNAL_QUERY} AND ar.market_id = $1`,
      [marketId]
    );

    const marketWeights = buildWeightsFromSignalRows(marketResult.rows);
    if (Object.keys(marketWeights).length >= 3) {
      console.log(
        `[AgentWeights] Using per-market Brier weights for market=${marketId.slice(0, 16)} ` +
        `(${Object.keys(marketWeights).length} agents calibrated)`
      );
      return marketWeights;
    }

    // Step 2: Fall back to global calibration (last 30 days).
    const globalResult = await client.query<SignalOutcomeRow>(
      `${WEIGHTED_SIGNAL_QUERY} AND ar.outcome_resolved_at > NOW() - INTERVAL '30 days'`
    );

    const globalWeights = buildWeightsFromSignalRows(globalResult.rows);
    if (Object.keys(globalWeights).length >= 3) {
      console.log(
        `[AgentWeights] Using global Brier weights (${Object.keys(globalWeights).length} agents calibrated in last 30d)`
      );
      return globalWeights;
    }

    // Step 3: Not enough data - return empty map (all agents use default weight 1.0)
    console.log(
      `[AgentWeights] Insufficient calibration data - using default weights ` +
      `(market: ${Object.keys(marketWeights).length}, global: ${Object.keys(globalWeights).length} agents)`
    );
    return {};
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    console.warn(
      `[AgentWeights] Failed to fetch performance weights: ${msg} - using defaults`
    );
    return {};
  } finally {
    if (client) {
      try {
        await client.end();
      } catch {
        // Ignore cleanup errors
      }
    }
  }
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

/**
 * Convert per-signal rows into Brier-calibrated weights.
 *
 * Brier score = mean((P(YES) - realized_outcome)^2).
 * A coin-flip forecaster has a Brier score of 0.25. Skill is normalized
 * against that baseline:
 *   - perfect (Brier 0)      → 2.0x influence
 *   - coin flip (Brier 0.25) → 1.0x influence
 *   - worse than coin flip   → down to 0.4x influence
 *
 * The final weight blends 70% Brier skill and 30% directional accuracy so a
 * well-calibrated but unlucky agent is not punished as harshly as a
 * confidently wrong one.
 */
export function buildWeightsFromSignalRows(
  rows: SignalOutcomeRow[]
): Record<string, number> {
  const byAgent = new Map<
    string,
    { brierSum: number; correctDirections: number; count: number }
  >();

  for (const row of rows) {
    const outcome = Number(row.outcome);
    const probability = Number(row.fair_probability);
    if (!Number.isFinite(outcome) || !Number.isFinite(probability)) continue;

    const p = clamp(probability, 0.001, 0.999);
    const brier = (p - outcome) ** 2;
    const predictedYes = row.direction === 'YES' || (row.direction !== 'NO' && p >= 0.5);
    const correctDirection = (predictedYes ? 1 : 0) === outcome ? 1 : 0;

    const existing = byAgent.get(row.agent_name) ?? {
      brierSum: 0,
      correctDirections: 0,
      count: 0,
    };
    existing.brierSum += brier;
    existing.correctDirections += correctDirection;
    existing.count += 1;
    byAgent.set(row.agent_name, existing);
  }

  const weights: Record<string, number> = {};

  for (const [agentName, stats] of byAgent) {
    if (stats.count < 2) continue;

    const brier = stats.brierSum / stats.count;
    const accuracy = stats.correctDirections / stats.count;

    // 0.25 is the coin-flip Brier baseline.
    const brierSkill = 1 - brier / 0.25; // perfect=1, coinflip=0, worse<0
    const brierWeight = clamp(1 + brierSkill, 0.4, 2.0);
    const accuracyWeight = clamp(0.5 + accuracy * 1.5, 0.5, 2.0);

    weights[agentName] = Number(
      (0.7 * brierWeight + 0.3 * accuracyWeight).toFixed(3)
    );
  }

  return weights;
}
