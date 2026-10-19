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
        market_probability_at_execution
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
      history.push({
        timestamp: meta.executed_at instanceof Date
          ? meta.executed_at.toISOString()
          : String(meta.executed_at),
        action: meta.recommendation || 'NO_TRADE',
        consensusProbability: parseFloat(String(meta.consensus_probability ?? '0.5')),
        marketProbability: parseFloat(String(meta.market_probability_at_execution ?? '0.5')),
        signals: signalsByResult.get(rid) || [],
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

/**
 * Fetches agent performance weights for signal fusion.
 *
 * Strategy:
 * 1. Try per-market accuracy (from scored recommendations on this specific market)
 * 2. Fall back to global accuracy (from all scored recommendations in last 30 days)
 * 3. Fall back to empty map (all agents get default weight 1.0)
 *
 * The returned map is agentName (snake_case) → performance score (0.5–2.0).
 * Accuracy is normalized: 50% accuracy → 1.0, 100% → 2.0, 0% → 0.5.
 * This means high-performing agents get up to 2x influence, low-performing agents
 * get down to 0.5x influence - gradual reweighting, not dramatic swings.
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

    // Step 1: Try per-market accuracy
    const marketResult = await client.query(
      `SELECT
         am.agent_name,
         COUNT(*) AS total_signals,
         SUM(CASE
           WHEN (am.direction = CASE WHEN ar.recommendation = 'LONG_YES' THEN 'YES' ELSE 'NO' END
                 AND ar.outcome_status = 'success')
             OR (am.direction != CASE WHEN ar.recommendation = 'LONG_YES' THEN 'YES' ELSE 'NO' END
                 AND ar.outcome_status = 'failure')
           THEN 1 ELSE 0
         END) AS correct_signals
       FROM agent_memory am
       JOIN analysis_results ar ON ar.id = am.result_id
       WHERE ar.market_id = $1
         AND ar.outcome_status IN ('success', 'failure')
         AND am.direction != 'NEUTRAL'
       GROUP BY am.agent_name
       HAVING COUNT(*) >= 2`,
      [marketId]
    );

    // If we have per-market data (at least 3 agents scored), use it
    if (marketResult.rows.length >= 3) {
      const weights = buildWeightsFromRows(marketResult.rows);
      console.log(
        `[AgentWeights] Using per-market weights for market=${marketId.slice(0, 16)} (${marketResult.rows.length} agents scored)`
      );
      return weights;
    }

    // Step 2: Fall back to global accuracy (last 30 days)
    const globalResult = await client.query(
      `SELECT
         am.agent_name,
         COUNT(*) AS total_signals,
         SUM(CASE
           WHEN (am.direction = CASE WHEN ar.recommendation = 'LONG_YES' THEN 'YES' ELSE 'NO' END
                 AND ar.outcome_status = 'success')
             OR (am.direction != CASE WHEN ar.recommendation = 'LONG_YES' THEN 'YES' ELSE 'NO' END
                 AND ar.outcome_status = 'failure')
           THEN 1 ELSE 0
         END) AS correct_signals
       FROM agent_memory am
       JOIN analysis_results ar ON ar.id = am.result_id
       WHERE ar.outcome_status IN ('success', 'failure')
         AND ar.outcome_resolved_at > NOW() - INTERVAL '30 days'
         AND am.direction != 'NEUTRAL'
       GROUP BY am.agent_name
       HAVING COUNT(*) >= 2`
    );

    if (globalResult.rows.length >= 3) {
      const weights = buildWeightsFromRows(globalResult.rows);
      console.log(
        `[AgentWeights] Using global weights (${globalResult.rows.length} agents scored in last 30d)`
      );
      return weights;
    }

    // Step 3: Not enough data - return empty map (all agents use default weight 1.0)
    console.log(
      `[AgentWeights] Insufficient performance data - using default weights (market: ${marketResult.rows.length}, global: ${globalResult.rows.length} agents)`
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

/**
 * Convert DB rows (agent_name, total_signals, correct_signals) into a
 * performance weight map. Normalizes accuracy to a 0.5–2.0 range:
 *   - 50% accuracy → 1.0 (neutral)
 *   - 100% accuracy → 2.0 (double influence)
 *   - 0% accuracy → 0.5 (half influence)
 */
function buildWeightsFromRows(
  rows: Array<{ agent_name: string; total_signals: string | number; correct_signals: string | number }>
): Record<string, number> {
  const weights: Record<string, number> = {};

  for (const row of rows) {
    const total = Number(row.total_signals);
    const correct = Number(row.correct_signals);
    if (total === 0) continue;

    const accuracy = correct / total; // 0.0–1.0
    // Normalize: 0% → 0.5, 50% → 1.0, 100% → 2.0
    const weight = 0.5 + accuracy * 1.5;
    weights[row.agent_name] = weight;
  }

  return weights;
}
