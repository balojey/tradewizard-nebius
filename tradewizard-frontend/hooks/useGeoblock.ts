import { useState, useEffect, useCallback } from "react";
import { GEOBLOCK_API_URL } from "@/constants/api";

export type GeoblockStatus = {
  blocked: boolean;
  ip: string;
  country: string;
  region: string;
};

type UseGeoblockReturn = {
  isBlocked: boolean;
  isLoading: boolean;
  error: Error | null;
  geoblockStatus: GeoblockStatus | null;
  recheckGeoblock: () => Promise<void>;
};

// This hook checks if the user is geoblocked from using Polymarket
// Integrators should use this to enforce the same geoblocking rules as Polymarket.com
// Can be disabled via NEXT_PUBLIC_ENABLE_GEOBLOCK environment variable

export default function useGeoblock(): UseGeoblockReturn {
  const [isBlocked, setIsBlocked] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);
  const [geoblockStatus, setGeoblockStatus] = useState<GeoblockStatus | null>(
    null
  );

  // Check if geoblock is enabled via environment variable
  const isGeoblockEnabled = process.env.NEXT_PUBLIC_ENABLE_GEOBLOCK !== 'false';

  const checkGeoblock = useCallback(async () => {
    setIsLoading(true);
    setError(null);

    // If geoblock is disabled via environment variable, skip the check
    if (!isGeoblockEnabled) {
      console.log("Geoblock disabled via NEXT_PUBLIC_ENABLE_GEOBLOCK environment variable");
      setIsBlocked(false);
      setGeoblockStatus({
        blocked: false,
        ip: "disabled",
        country: "disabled",
        region: "disabled",
      });
      setIsLoading(false);
      return;
    }

    try {
      // Create abort controller for timeout
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 5000); // 5 second timeout

      const response = await fetch(GEOBLOCK_API_URL, {
        method: "GET",
        headers: {
          Accept: "application/json",
        },
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        throw new Error(`Geoblock API error: ${response.status}`);
      }

      const data: GeoblockStatus = await response.json();

      setGeoblockStatus(data);
      setIsBlocked(data.blocked);
    } catch (err) {
      const error =
        err instanceof Error ? err : new Error("Failed to check geoblock");
      setError(error);
      console.warn("Geoblock check failed, defaulting to not blocked:", error.message);

      // On error, default to not blocked to avoid false positives
      // This ensures the app continues to work even if geoblock API is down
      setIsBlocked(false);
      setGeoblockStatus({
        blocked: false,
        ip: "unknown",
        country: "unknown",
        region: "unknown",
      });
    } finally {
      setIsLoading(false);
    }
  }, [isGeoblockEnabled]);

  // Check geoblock on mount
  useEffect(() => {
    checkGeoblock();
  }, [checkGeoblock]);

  return {
    isBlocked,
    isLoading,
    error,
    geoblockStatus,
    recheckGeoblock: checkGeoblock,
  };
}

