/**
 * get_session_performance Strands tool - fetches session performance metrics from RDS.
 *
 * Read-only tool: no state mutation or order placement.
 *
 * Requirements: 2.4, 3.5
 */

import { tool } from '@strands-agents/sdk';
import type { JSONValue } from '@strands-agents/sdk';
import { z } from 'zod';
import { getDbCredentials } from '../../shared/db';

const DB_TIMEOUT_MS = 10_000;

/**
 * Strands tool: get_session_performance
 *
 * Fetches performance metrics for a portfolio session including win rate,
 * realized P&L, unrealized P&L, capital utilization, and trade statistics.
 */
export const getSessionPerformanceTool = tool({
  name: 'get_session_performance',
  description:
    'Fetch performance metrics for a portfolio session. Returns win rate, realized P&L, unrealized P&L, average hold duration, capital breakdown, and cumulative loss percentage. Use this to assess how the session is performing and whether risk limits are being approached.',
  inputSchema: z.object({
    sessionId: z.string().describe('The portfolio session ID to fetch performance for'),
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

        const result = await client.query(
          `SELECT id, user_id, market_id, persona_id, investment_amount, status,
                  position_direction, position_size, position_entry_price,
                  total_trades, winning_trades, realized_pnl, unrealized_pnl,
                  total_hold_duration_minutes,
                  amount_in_positions, amount_in_pending_orders, amount_available,
                  cumulative_loss_pct, last_loss_exit_at, position_size_reduction_active,
                  profit_target_pct, created_at, updated_at
           FROM portfolio_manager_sessions
           WHERE id = $1`,
          [input.sessionId],
        );

        if (result.rows.length === 0) {
          return {
            error: true,
            toolName: 'get_session_performance',
            message: `Session ${input.sessionId} not found`,
          };
        }

        const row = result.rows[0] as Record<string, unknown>;

        const totalTrades = Number(row.total_trades ?? 0);
        const winningTrades = Number(row.winning_trades ?? 0);
        const realizedPnl = Number(row.realized_pnl ?? 0);
        const unrealizedPnl = Number(row.unrealized_pnl ?? 0);
        const investmentAmount = Number(row.investment_amount ?? 0);
        const totalHoldMinutes = Number(row.total_hold_duration_minutes ?? 0);

        const winRate = totalTrades > 0 ? winningTrades / totalTrades : 0;
        const avgHoldMinutes = totalTrades > 0 ? totalHoldMinutes / totalTrades : 0;
        const returnPct =
          investmentAmount > 0
            ? ((realizedPnl + unrealizedPnl) / investmentAmount) * 100
            : 0;

        return {
          sessionId: input.sessionId,
          status: (row.status as string) ?? null,
          personaId: (row.persona_id as string) ?? null,
          investmentAmount,
          currentPosition: row.position_direction
            ? {
                direction: row.position_direction as string,
                size: Number(row.position_size),
                entryPrice: Number(row.position_entry_price),
              }
            : null,
          totalTrades,
          winningTrades,
          losingTrades: totalTrades - winningTrades,
          winRate: Math.round(winRate * 1000) / 1000,
          realizedPnl: Math.round(realizedPnl * 100) / 100,
          unrealizedPnl: Math.round(unrealizedPnl * 100) / 100,
          totalPnl: Math.round((realizedPnl + unrealizedPnl) * 100) / 100,
          returnPct: Math.round(returnPct * 100) / 100,
          avgHoldDurationMinutes: Math.round(avgHoldMinutes),
          capitalBreakdown: {
            amountInPositions: Number(row.amount_in_positions ?? 0),
            amountInPendingOrders: Number(row.amount_in_pending_orders ?? 0),
            amountAvailable: Number(row.amount_available ?? 0),
            utilizationPct:
              investmentAmount > 0
                ? Math.round(
                    ((Number(row.amount_in_positions ?? 0) +
                      Number(row.amount_in_pending_orders ?? 0)) /
                      investmentAmount) *
                      10000,
                  ) / 100
                : 0,
          },
          riskMetrics: {
            cumulativeLossPct: Number(row.cumulative_loss_pct ?? 0),
            lastLossExitAt: row.last_loss_exit_at
              ? (row.last_loss_exit_at as Date).toISOString()
              : null,
            positionSizeReductionActive: Boolean(row.position_size_reduction_active ?? false),
            profitTargetPct: row.profit_target_pct != null
              ? Number(row.profit_target_pct)
              : null,
          },
          createdAt: row.created_at
            ? (row.created_at as Date).toISOString()
            : null,
          updatedAt: row.updated_at
            ? (row.updated_at as Date).toISOString()
            : null,
        };
      } finally {
        await client.end();
      }
    } catch (error) {
      const message =
        error instanceof Error ? error.message : String(error);

      return {
        error: true,
        toolName: 'get_session_performance',
        message: `Failed to fetch session performance: ${message}`,
      };
    }
  },
});
