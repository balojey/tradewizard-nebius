/**
 * get_agent_accuracy Strands tool - fetches agent accuracy leaderboard from RDS.
 *
 * Provides historical accuracy scores for the 14 intelligence agents, allowing
 * the portfolio persona to weight its reasoning based on which agents have been
 * most reliable.
 *
 * Strategy: first attempts per-market accuracy. If insufficient data (< 2 scored
 * signals per agent), falls back to global accuracy across all markets. If neither
 * has data, returns an empty array.
 *
 * Read-only tool: no state mutation or order placement.
 */

import { tool } from '@strands-agents/sdk';
import type { JSONValue } from '@strands-agents/sdk';
import { z } from 'zod';
import { getDbCredentials } from '../../shared/db';

const DB_TIMEOUT_MS = 10_000;

const ACCURACY_QUERY = `
  WITH scored_signals AS (
    SELECT
      am.agent_name,
      am.direction,
      am.confidence,
      ar.recommendation,
      ar.outcome_status
    FROM agent_memory am
    JOIN analysis_results ar ON ar.id = am.result_id
    WHERE ar.outcome_status IN ('success', 'failure')
      AND ar.outcome_resolved_at > NOW() - INTERVAL '30 days'
      AND am.direction != 'NEUTRAL'
      MARKET_FILTER
  ),
  agent_stats AS (
    SELECT
      agent_name,
      COUNT(*) AS total_signals,
      SUM(CASE
        WHEN (direction = CASE WHEN recommendation = 'LONG_YES' THEN 'YES' ELSE 'NO' END
              AND outcome_status = 'success')
          OR (direction != CASE WHEN recommendation = 'LONG_YES' THEN 'YES' ELSE 'NO' END
              AND outcome_status = 'failure')
        THEN 1 ELSE 0
      END) AS correct_signals,
      AVG(confidence) AS avg_confidence
    FROM scored_signals
    GROUP BY agent_name
    HAVING COUNT(*) >= MIN_SIGNALS
  )
  SELECT
    agent_name,
    total_signals,
    correct_signals,
    ROUND((correct_signals::NUMERIC / total_signals) * 100, 2) AS accuracy_pct,
    ROUND(avg_confidence::NUMERIC, 4) AS avg_confidence
  FROM agent_stats
  ORDER BY accuracy_pct DESC, total_signals DESC
  LIMIT 20
`;

/**
 * Strands tool: get_agent_accuracy
 *
 * Fetches the historical accuracy leaderboard for intelligence agents.
 * Tries per-market first, falls back to global if insufficient market-specific data.
 */
export const getAgentAccuracyTool = tool({
  name: 'get_agent_accuracy',
  description:
    'Fetch historical accuracy scores for the intelligence agents that produced the analysis. ' +
    'Returns each agent\'s accuracy percentage, total scored signals, and average confidence over the last 30 days. ' +
    'Use this to understand which agents have been most reliable on this market (or globally) ' +
    'and weight their signals accordingly in your decision-making. ' +
    'Higher accuracy agents should carry more weight in your reasoning.',
  inputSchema: z.object({
    marketId: z.string().describe('The market condition ID to fetch agent accuracy for'),
  }),
  callback: async (input): Promise<JSONValue> => {
    try {
      const creds = await getDbCredentials();
      const pg = await import('pg');

      const connectionString = `postgresql://${creds.username}:${encodeURIComponent(creds.password)}@${creds.host}:${creds.port}/${creds.dbname}?sslmode=no-verify`;
      const client = new pg.Client({
        connectionString,
        ssl: { rejectUnauthorized: false },
        statement_timeout: DB_TIMEOUT_MS,
      });

      try {
        await client.connect();

        // Try per-market accuracy first (minimum 2 signals per agent)
        const marketQuery = ACCURACY_QUERY
          .replace('MARKET_FILTER', 'AND ar.market_id = $1')
          .replace('MIN_SIGNALS', '2');

        const marketResult = await client.query(marketQuery, [input.marketId]);

        if (marketResult.rows.length > 0) {
          return {
            scope: 'market',
            marketId: input.marketId,
            agents: mapAgentRows(marketResult.rows),
            message: `Agent accuracy for this specific market (${marketResult.rows.length} agents with sufficient data).`,
          };
        }

        // Fallback: global accuracy across all markets (minimum 3 signals)
        const globalQuery = ACCURACY_QUERY
          .replace('MARKET_FILTER', '')
          .replace('MIN_SIGNALS', '3');

        const globalResult = await client.query(globalQuery, []);

        if (globalResult.rows.length > 0) {
          return {
            scope: 'global',
            marketId: input.marketId,
            agents: mapAgentRows(globalResult.rows),
            message: `No market-specific accuracy data available. Using global accuracy across all markets (${globalResult.rows.length} agents).`,
          };
        }

        // No data available at all
        return {
          scope: 'none',
          marketId: input.marketId,
          agents: [],
          message: 'No agent accuracy data available yet. Insufficient resolved outcomes in the last 30 days.',
        };
      } finally {
        await client.end();
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);

      return {
        error: true,
        toolName: 'get_agent_accuracy',
        message: `Failed to fetch agent accuracy: ${message}`,
      };
    }
  },
});

function mapAgentRows(rows: Record<string, unknown>[]): JSONValue {
  return rows.map((row) => ({
    name: row.agent_name as string,
    accuracyPct: parseFloat(String(row.accuracy_pct)),
    totalSignals: parseInt(String(row.total_signals), 10),
    correctSignals: parseInt(String(row.correct_signals), 10),
    avgConfidence: parseFloat(String(row.avg_confidence)),
  })) as JSONValue;
}
