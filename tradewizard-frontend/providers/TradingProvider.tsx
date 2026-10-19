"use client";

import { createContext, useContext, ReactNode, useCallback, useEffect, useRef, useState } from "react";
import type { ClobClient } from "@polymarket/clob-client";
import type { RelayClient } from "@polymarket/builder-relayer-client";
import { useWallet } from "./WalletContext";
import useClobClient from "@/hooks/useClobClient";
import useTradingSession from "@/hooks/useTradingSession";
import useSafeDeployment from "@/hooks/useSafeDeployment";
import type { TradeWizardSecureClient } from "@/lib/polymarket-client";
import useGeoblock, { GeoblockStatus } from "@/hooks/useGeoblock";
import { TradingSession, SessionStep } from "@/utils/session";

interface TradingContextType {
  tradingSession: TradingSession | null;
  currentStep: SessionStep;
  sessionError: Error | null;
  isTradingSessionComplete: boolean | undefined;
  initializeTradingSession: () => Promise<void>;
  endTradingSession: () => void;
  clobClient: ClobClient | null;
  relayClient: RelayClient | null;
  /** Modern @polymarket/client instance for pUSD trading. */
  secureClient: TradeWizardSecureClient | null;
  eoaAddress: string | undefined;
  safeAddress: string | undefined;
  isGeoblocked: boolean;
  isGeoblockLoading: boolean;
  geoblockStatus: GeoblockStatus | null;
  isAutoInitializing: boolean;
}

const TradingContext = createContext<TradingContextType | null>(null);

export function useTrading() {
  const ctx = useContext(TradingContext);
  if (!ctx) throw new Error("useTrading must be used within TradingProvider");
  return ctx;
}

export default function TradingProvider({ children }: { children: ReactNode }) {
  const { eoaAddress, isConnected } = useWallet();
  const { derivedSafeAddressFromEoa } = useSafeDeployment(eoaAddress);
  const autoInitRef = useRef<boolean>(false);
  const [isAutoInitializing, setIsAutoInitializing] = useState(false);

  const {
    isBlocked: isGeoblocked,
    isLoading: isGeoblockLoading,
    geoblockStatus,
  } = useGeoblock();

  const {
    tradingSession,
    currentStep,
    sessionError,
    isTradingSessionComplete,
    initializeTradingSession: initSession,
    endTradingSession,
    relayClient,
    secureClient,
  } = useTradingSession();

  const { clobClient } = useClobClient(
    tradingSession,
    isTradingSessionComplete
  );

  const initializeTradingSession = useCallback(async () => {
    if (isGeoblocked) {
      throw new Error(
        "Trading is not available in your region. Polymarket is geoblocked in your location."
      );
    }
    return initSession();
  }, [isGeoblocked, initSession]);

  // Automatic trading session initialization on wallet connection
  useEffect(() => {
    const shouldAutoInitialize = 
      isConnected && 
      eoaAddress && 
      !isGeoblocked && 
      !isGeoblockLoading &&
      !isTradingSessionComplete &&
      currentStep === "idle" &&
      !autoInitRef.current;

    if (shouldAutoInitialize) {
      autoInitRef.current = true;
      void Promise.resolve().then(() => setIsAutoInitializing(true));
      console.log("Auto-initializing trading session for authenticated user:", eoaAddress);

      initializeTradingSession()
        .then(() => {
          console.log("Trading session auto-initialized successfully");
        })
        .catch((error) => {
          console.error("Auto-initialization failed:", error);
          // Reset so the user can retry manually if needed
          autoInitRef.current = false;
        })
        .finally(() => {
          setIsAutoInitializing(false);
        });
    }

    // Reset auto-init flag when user disconnects
    if (!isConnected || !eoaAddress) {
      autoInitRef.current = false;
      void Promise.resolve().then(() => setIsAutoInitializing(false));
    }
  }, [
    isConnected,
    eoaAddress,
    isGeoblocked,
    isGeoblockLoading,
    isTradingSessionComplete,
    currentStep,
    initializeTradingSession,
  ]);

  return (
    <TradingContext.Provider
      value={{
        tradingSession,
        currentStep,
        sessionError,
        isTradingSessionComplete,
        initializeTradingSession,
        endTradingSession,
        clobClient,
        relayClient,
        secureClient,
        eoaAddress,
        safeAddress: tradingSession?.safeAddress ?? derivedSafeAddressFromEoa,
        isGeoblocked,
        isGeoblockLoading,
        geoblockStatus,
        isAutoInitializing,
      }}
    >
      {children}
    </TradingContext.Provider>
  );
}
