import { useQuery } from "@tanstack/react-query";
import type { PolymarketMarket } from "@/hooks/useMarkets";

interface PublicPriceData {
  [tokenId: string]: {
    bidPrice: number;
    askPrice: number;
    midPrice: number;
    spread: number;
  };
}

// Hook to fetch public market prices for unauthenticated users
export default function usePublicMarketPrices(markets: PolymarketMarket[]) {
  // Extract all unique token IDs from open markets (closed markets have no order book)
  const tokenIds = markets.reduce<string[]>((acc, market) => {
    if (market.clobTokenIds && !market.closed) {
      try {
        const ids = JSON.parse(market.clobTokenIds);
        acc.push(...ids);
      } catch (error) {
        console.warn(`Failed to parse token IDs for market ${market.id}`);
      }
    }
    return acc;
  }, []);

  // Remove duplicates
  const uniqueTokenIds = [...new Set(tokenIds)];

  return useQuery({
    queryKey: ["public-market-prices", uniqueTokenIds],
    queryFn: async (): Promise<PublicPriceData> => {
      if (uniqueTokenIds.length === 0) {
        return {};
      }

      console.log("Fetching public prices for tokens:", uniqueTokenIds.slice(0, 5)); // Log first 5 for debugging

      const response = await fetch("/api/polymarket/public-prices", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ tokenIds: uniqueTokenIds }),
      });

      if (!response.ok) {
        console.error("Public prices API error:", response.status, response.statusText);
        throw new Error("Failed to fetch public prices");
      }

      const data = await response.json();
      console.log("Public prices response:", Object.keys(data).length, "prices fetched");
      return data;
    },
    enabled: uniqueTokenIds.length > 0,
    staleTime: 10_000, // 10 seconds
    refetchInterval: 30_000, // Refetch every 30 seconds
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: true,
    retry: 2, // Retry failed requests
    retryDelay: 1000, // Wait 1 second between retries
  });
}