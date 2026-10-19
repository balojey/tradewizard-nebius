'use client';

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useCallback } from "react";

export interface OrderBookLevel {
  price: string;
  size: string;
}

export interface OrderBookData {
  market: string;
  asset_id: string;
  timestamp: string;
  bids: OrderBookLevel[];
  asks: OrderBookLevel[];
  min_order_size: string;
  tick_size: string;
  hash: string;
}

const WS_URL = "wss://ws-subscriptions-clob.polymarket.com/ws/market";

/**
 * Hook to fetch real order book data from the Polymarket CLOB API
 * with WebSocket real-time updates.
 *
 * @param yesTokenId - The YES token ID
 * @param noTokenId - The NO token ID (optional)
 */
export default function useOrderBook(
  yesTokenId: string | null,
  noTokenId?: string | null
) {
  const queryClient = useQueryClient();
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reconnectAttemptsRef = useRef(0);

  // Fetch YES token order book
  const yesBook = useQuery<OrderBookData | null>({
    queryKey: ["orderbook", yesTokenId],
    queryFn: async () => {
      if (!yesTokenId) return null;
      const response = await fetch(`/api/polymarket/orderbook?token_id=${yesTokenId}`);
      if (!response.ok) {
        throw new Error(`Failed to fetch order book: ${response.status}`);
      }
      return response.json();
    },
    enabled: !!yesTokenId,
    staleTime: 5_000,
    refetchInterval: 10_000, // Fallback polling every 10s
    refetchIntervalInBackground: false,
    retry: 2,
  });

  // Fetch NO token order book
  const noBook = useQuery<OrderBookData | null>({
    queryKey: ["orderbook", noTokenId],
    queryFn: async () => {
      if (!noTokenId) return null;
      const response = await fetch(`/api/polymarket/orderbook?token_id=${noTokenId}`);
      if (!response.ok) {
        throw new Error(`Failed to fetch order book: ${response.status}`);
      }
      return response.json();
    },
    enabled: !!noTokenId,
    staleTime: 5_000,
    refetchInterval: 10_000,
    refetchIntervalInBackground: false,
    retry: 2,
  });

  // WebSocket connection for real-time updates
  const connectWebSocket = useCallback(() => {
    const tokenIds = [yesTokenId, noTokenId].filter(Boolean) as string[];
    if (tokenIds.length === 0) return;

    // Clean up existing connection
    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }

    try {
      const ws = new WebSocket(WS_URL);
      wsRef.current = ws;

      ws.onopen = () => {
        reconnectAttemptsRef.current = 0;
        // Subscribe to market data for both tokens
        ws.send(JSON.stringify({
          type: "market",
          assets_ids: tokenIds,
          custom_feature_enabled: true,
        }));
      };

      ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);

          switch (data.event_type) {
            case "book":
              // Full orderbook snapshot - update the relevant query cache
              if (data.asset_id === yesTokenId) {
                queryClient.setQueryData(["orderbook", yesTokenId], data);
              } else if (data.asset_id === noTokenId) {
                queryClient.setQueryData(["orderbook", noTokenId], data);
              }
              break;

            case "price_change":
            case "best_bid_ask":
              // Invalidate to trigger a refetch with fresh data
              if (data.asset_id === yesTokenId || tokenIds.includes(data.asset_id)) {
                queryClient.invalidateQueries({ queryKey: ["orderbook", yesTokenId] });
              }
              if (data.asset_id === noTokenId || tokenIds.includes(data.asset_id)) {
                queryClient.invalidateQueries({ queryKey: ["orderbook", noTokenId] });
              }
              break;

            case "last_trade_price":
              // A trade happened - invalidate price history too
              queryClient.invalidateQueries({ queryKey: ["orderbook"] });
              break;
          }
        } catch {
          // Ignore malformed messages
        }
      };

      ws.onclose = () => {
        wsRef.current = null;
        // Exponential backoff reconnection
        const delay = Math.min(1000 * 2 ** reconnectAttemptsRef.current, 30000);
        reconnectAttemptsRef.current += 1;
        reconnectTimeoutRef.current = setTimeout(connectWebSocket, delay);
      };

      ws.onerror = () => {
        ws.close();
      };
    } catch {
      // WebSocket construction failed - retry
      const delay = Math.min(1000 * 2 ** reconnectAttemptsRef.current, 30000);
      reconnectAttemptsRef.current += 1;
      reconnectTimeoutRef.current = setTimeout(connectWebSocket, delay);
    }
  }, [yesTokenId, noTokenId, queryClient]);

  useEffect(() => {
    connectWebSocket();

    return () => {
      if (wsRef.current) {
        wsRef.current.close();
        wsRef.current = null;
      }
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
        reconnectTimeoutRef.current = null;
      }
    };
  }, [connectWebSocket]);

  return {
    yesBook: yesBook.data,
    noBook: noBook.data,
    isLoading: yesBook.isLoading || noBook.isLoading,
    error: yesBook.error || noBook.error,
  };
}
