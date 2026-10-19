/**
 * get_trade_history Strands tool - fetches recent trade history from RDS.
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
 * Strands tool: get_trade_history
 *
 * Fetches recent trade history for a portfolio session from the database.
 * Includes entry/exit prices, P&L, timing, and reasoning for past trades.
 */
export const getTradeHistoryTool = tool({
  name: 'get_trade_history',
  description:
    'Fetch recent trade history for a portfolio session. Returns past trades with entry/exit prices, P&L, hold duration, exit reasons, and reasoning. Use this to understand past performance and avoid repeating mistakes.',
  inputSchema: z.object({
    sessionId: z.string().describe('The portfolio session ID to fetch trades for'),
    limit: z
      .number()
      .min(1)
      .max(50)
      .default(20)
      .describe('Maximum number of trades to return (1-50, default 20)'),
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
          `SELECT id, session_id, analysis_result_id, direction, side, order_type,
                  size_usdc, price, fill_price, shares, status, clob_order_id,
                  trade_purpose, reasoning, conviction_score, patience_expires_at,
                  created_at, filled_at, cancelled_at, realized_pnl,
                  hold_duration_minutes, exit_reason
           FROM portfolio_manager_trades
           WHERE session_id = $1
           ORDER BY created_at DESC
           LIMIT $2`,
          [input.sessionId, input.limit],
        );

        const trades = result.rows.map((row: { [key: string]: unknown }) => ({
          id: String(row.id ?? ''),
          direction: String(row.direction ?? ''),
          side: String(row.side ?? ''),
          orderType: String(row.order_type ?? ''),
          sizeUsdc: Number(row.size_usdc),
          price: Number(row.price),
          fillPrice: row.fill_price != null ? Number(row.fill_price) : null,
          status: String(row.status ?? ''),
          tradePurpose: String(row.trade_purpose ?? ''),
          reasoning: String(row.reasoning ?? ''),
          convictionScore: row.conviction_score != null ? Number(row.conviction_score) : null,
          createdAt: row.created_at
            ? (row.created_at as Date).toISOString()
            : null,
          filledAt: row.filled_at
            ? (row.filled_at as Date).toISOString()
            : null,
          realizedPnl: row.realized_pnl != null ? Number(row.realized_pnl) : null,
          holdDurationMinutes: row.hold_duration_minutes != null
            ? Number(row.hold_duration_minutes)
            : null,
          exitReason: row.exit_reason != null ? String(row.exit_reason) : null,
        }));

        return {
          sessionId: input.sessionId,
          tradeCount: trades.length,
          trades,
        };
      } finally {
        await client.end();
      }
    } catch (error) {
      const message =
        error instanceof Error ? error.message : String(error);

      return {
        error: true,
        toolName: 'get_trade_history',
        message: `Failed to fetch trade history: ${message}`,
      };
    }
  },
});
