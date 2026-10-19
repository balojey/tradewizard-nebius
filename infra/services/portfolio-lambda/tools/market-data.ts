/**
 * get_market_data Strands tool - fetches current market data from Polymarket CLOB API.
 *
 * Read-only tool: no state mutation or order placement.
 *
 * Requirements: 2.4, 3.5
 */

import { tool } from '@strands-agents/sdk';
import type { JSONValue } from '@strands-agents/sdk';
import { z } from 'zod';
import {
  getClobCredentials,
  buildClobHeaders,
  clobCredentialsConfigured,
} from '../../shared/clob-credentials';

const CLOB_TIMEOUT_MS = 15_000;

/**
 * Strands tool: get_market_data
 *
 * Fetches the current market state from the Polymarket CLOB API including
 * token prices, volume, liquidity, and spread information.
 */
export const getMarketDataTool = tool({
  name: 'get_market_data',
  description:
    'Fetch current market data from Polymarket CLOB API including token prices, volume, liquidity, and spread. Use this to understand the current state of the market before making a decision.',
  inputSchema: z.object({
    marketId: z.string().describe('The condition ID (market ID) to fetch data for'),
  }),
  callback: async (input): Promise<JSONValue> => {
    try {
      const creds = await getClobCredentials();
      if (!clobCredentialsConfigured(creds)) {
        return {
          error: true,
          toolName: 'get_market_data',
          message: 'CLOB credentials not configured',
        };
      }

      const headers = buildClobHeaders(creds);
      const url = `${creds.apiUrl}/markets/${input.marketId}`;

      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), CLOB_TIMEOUT_MS);

      try {
        const response = await fetch(url, {
          method: 'GET',
          headers,
          signal: controller.signal,
        });

        if (!response.ok) {
          return {
            error: true,
            toolName: 'get_market_data',
            message: `CLOB API returned status ${response.status}: ${response.statusText}`,
          };
        }

        const data = (await response.json()) as { [key: string]: JSONValue };

        // Extract relevant market fields
        const tokens = data.tokens as Array<{ [key: string]: JSONValue }> | undefined;
        const yesToken = tokens?.find(
          (t) => (t.outcome as string)?.toUpperCase() === 'YES',
        );
        const noToken = tokens?.find(
          (t) => (t.outcome as string)?.toUpperCase() === 'NO',
        );

        return {
          marketId: input.marketId,
          question: data.question ?? data.description ?? '',
          active: data.active ?? data.closed === false,
          closed: data.closed ?? false,
          yesPrice: yesToken?.price ?? data.yes_price ?? null,
          noPrice: noToken?.price ?? data.no_price ?? null,
          volume: data.volume ?? data.volume_num ?? 0,
          liquidity: data.liquidity ?? data.spread_liquidity ?? 0,
          bestBid: data.best_bid ?? null,
          bestAsk: data.best_ask ?? null,
          spread: data.spread ?? null,
          lastTradePrice: data.last_trade_price ?? null,
          endDate: data.end_date_iso ?? data.end_date ?? null,
        };
      } finally {
        clearTimeout(timeout);
      }
    } catch (error) {
      const message =
        error instanceof Error
          ? error.name === 'AbortError'
            ? 'Request timed out after 15 seconds'
            : error.message
          : String(error);

      return {
        error: true,
        toolName: 'get_market_data',
        message,
      };
    }
  },
});
