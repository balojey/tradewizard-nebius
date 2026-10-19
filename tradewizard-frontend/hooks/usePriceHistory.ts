import { useQuery } from "@tanstack/react-query";

export interface PriceHistoryPoint {
  timestamp: string;
  price: number;
  volume?: number;
  high?: number;
  low?: number;
}

export interface PriceHistoryResponse {
  conditionId: string;
  tokenId: string;
  timeRange: string;
  /** YES token price history */
  data: PriceHistoryPoint[];
  /** NO token price history */
  noData: PriceHistoryPoint[];
  dataSource: 'real' | 'synthetic';
  points: number;
}

export type TimeRange = '1H' | '4H' | '1D' | '7D' | '30D';

interface UsePriceHistoryOptions {
  enabled?: boolean;
  refetchInterval?: number;
  isClosedMarket?: boolean;
}

/**
 * Hook to fetch historical price data for both YES and NO tokens of a market.
 *
 * @param conditionId - The condition ID of the market
 * @param tokenId - The YES token ID
 * @param timeRange - Time range for price history (1H, 4H, 1D, 7D, 30D)
 * @param options - Optional configuration
 * @param noTokenId - Optional NO token ID for fetching real NO price data
 */
export default function usePriceHistory(
  conditionId: string | null,
  tokenId: string | null,
  timeRange: TimeRange = '1D',
  options: UsePriceHistoryOptions = {},
  noTokenId?: string | null
) {
  const { enabled = true, refetchInterval, isClosedMarket = false } = options;

  return useQuery({
    queryKey: ["price-history", conditionId, tokenId, noTokenId, timeRange],
    queryFn: async (): Promise<PriceHistoryResponse> => {
      if (!conditionId || !tokenId) {
        throw new Error("Missing conditionId or tokenId");
      }

      const body: Record<string, string> = {
        conditionId,
        tokenId,
        timeRange,
      };

      if (noTokenId) {
        body.noTokenId = noTokenId;
      }

      const response = await fetch("/api/polymarket/price-history", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || `HTTP ${response.status}: ${response.statusText}`);
      }

      return response.json();
    },
    enabled: enabled && !!conditionId && !!tokenId,
    staleTime: isClosedMarket ? 30 * 60 * 1000 : 30_000,
    gcTime: isClosedMarket ? 30 * 60 * 1000 : undefined,
    refetchInterval: isClosedMarket
      ? false
      : (refetchInterval || (timeRange === '1H' ? 30_000 : 60_000)),
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: !isClosedMarket,
    retry: 2,
    retryDelay: (attemptIndex) => Math.min(1000 * 2 ** attemptIndex, 30000),
  });
}
