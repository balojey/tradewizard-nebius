import { useState, useCallback, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useDebounce } from "./useDebounce";
import type { PolymarketMarket } from "./useMarkets";

import { isMarketEndingSoon } from "@/utils/marketFilters";

interface SearchResult {
  markets: PolymarketMarket[];
  events: any[];
  profiles: any[];
}

interface UseMarketSearchOptions {
  enabled?: boolean;
  minQueryLength?: number;
  debounceMs?: number;
  status?: "all" | "active" | "closed" | "ending-soon";
  limit?: number;
}

export default function useMarketSearch(
  query: string,
  options: UseMarketSearchOptions = {}
) {
  const {
    enabled = true,
    minQueryLength = 2,
    debounceMs = 300,
    status = "all",
    limit = 20,
  } = options;

  const debouncedQuery = useDebounce(query, debounceMs);
  const shouldSearch = enabled && debouncedQuery.length >= minQueryLength;

  const searchQuery = useQuery({
    queryKey: ["market-search", debouncedQuery, status, limit],
    queryFn: async (): Promise<SearchResult> => {
      if (!shouldSearch) {
        return { markets: [], events: [], profiles: [] };
      }

      // Map "ending-soon" to "active" for the API call since the API might not support it directly
      const apiStatus = status === "ending-soon" ? "active" : status;

      const params = new URLSearchParams({
        q: debouncedQuery,
        status: apiStatus,
        limit: limit.toString(),
      });

      const response = await fetch(`/api/polymarket/search?${params}`);

      if (!response.ok) {
        throw new Error("Search failed");
      }

      return response.json();
    },
    enabled: shouldSearch,
    staleTime: 30_000, // 30 seconds
    refetchOnWindowFocus: false,
  });

  const results = useMemo(() => {
    if (!searchQuery.data) {
      return { markets: [], events: [], profiles: [] };
    }

    // Client-side filtering for "ending-soon"
    if (status === "ending-soon") {
      return {
        ...searchQuery.data,
        markets: searchQuery.data.markets.filter(isMarketEndingSoon)
      };
    }

    return searchQuery.data;
  }, [searchQuery.data, status]);

  const hasResults = useMemo(() => {
    return results.markets.length > 0 || results.events.length > 0 || results.profiles.length > 0;
  }, [results]);

  return {
    query: debouncedQuery,
    results,
    hasResults,
    isLoading: searchQuery.isLoading,
    error: searchQuery.error,
    isSearching: shouldSearch && searchQuery.isFetching,
  };
}