/**
 * get_order_book Strands tool - fetches order book depth from Polymarket CLOB API.
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
 * Strands tool: get_order_book
 *
 * Fetches the order book (bids and asks) for a specific token from the
 * Polymarket CLOB API. Useful for understanding liquidity depth and spread.
 */
export const getOrderBookTool = tool({
  name: 'get_order_book',
  description:
    'Fetch order book depth (bids and asks) for a Polymarket token. Use this to assess liquidity, spread, and potential slippage before deciding on order type and size.',
  inputSchema: z.object({
    tokenId: z.string().describe('The token ID to fetch order book for (YES or NO token)'),
  }),
  callback: async (input): Promise<JSONValue> => {
    try {
      const creds = await getClobCredentials();
      if (!clobCredentialsConfigured(creds)) {
        return {
          error: true,
          toolName: 'get_order_book',
          message: 'CLOB credentials not configured',
        };
      }

      const headers = buildClobHeaders(creds);
      const url = `${creds.apiUrl}/book?token_id=${encodeURIComponent(input.tokenId)}`;

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
            toolName: 'get_order_book',
            message: `CLOB API returned status ${response.status}: ${response.statusText}`,
          };
        }

        const data = (await response.json()) as { [key: string]: JSONValue };

        const bids = (data.bids as Array<{ [key: string]: JSONValue }>) ?? [];
        const asks = (data.asks as Array<{ [key: string]: JSONValue }>) ?? [];

        // Calculate summary metrics
        const bestBid = bids.length > 0 ? Number(bids[0]?.price ?? 0) : null;
        const bestAsk = asks.length > 0 ? Number(asks[0]?.price ?? 0) : null;
        const spread =
          bestBid !== null && bestAsk !== null ? bestAsk - bestBid : null;
        const spreadPct =
          spread !== null && bestAsk !== null && bestAsk > 0
            ? (spread / bestAsk) * 100
            : null;

        const bidDepth = bids.reduce(
          (sum, b) => sum + Number(b.size ?? 0),
          0,
        );
        const askDepth = asks.reduce(
          (sum, a) => sum + Number(a.size ?? 0),
          0,
        );

        return {
          tokenId: input.tokenId,
          bestBid,
          bestAsk,
          spread,
          spreadPct: spreadPct !== null ? Math.round(spreadPct * 100) / 100 : null,
          bidDepth: Math.round(bidDepth * 100) / 100,
          askDepth: Math.round(askDepth * 100) / 100,
          bidLevels: bids.length,
          askLevels: asks.length,
          topBids: bids.slice(0, 5).map((b) => ({
            price: Number(b.price),
            size: Number(b.size),
          })),
          topAsks: asks.slice(0, 5).map((a) => ({
            price: Number(a.price),
            size: Number(a.size),
          })),
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
        toolName: 'get_order_book',
        message,
      };
    }
  },
});
