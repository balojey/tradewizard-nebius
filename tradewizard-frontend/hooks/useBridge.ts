"use client";

import { useMutation, useQuery } from "@tanstack/react-query";

export interface BridgeAsset {
  chainId: string;
  chainName: string;
  token: {
    name: string;
    symbol: string;
    address: string;
    decimals: number;
  };
  minCheckoutUsd: number;
}

interface SupportedAssetsResponse {
  supportedAssets: BridgeAsset[];
}

export interface BridgeAddresses {
  address: {
    evm?: string;
    svm?: string;
    btc?: string;
    tron?: string;
  };
  note?: string;
}

async function postJson<T>(path: string, payload: unknown): Promise<T> {
  const response = await fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  const data = await response.json();
  if (!response.ok) {
    throw new Error(data?.error || "Bridge request failed");
  }
  return data as T;
}

/** Supported chains/tokens and minimum deposit amounts. */
export function useBridgeAssets() {
  return useQuery<SupportedAssetsResponse>({
    queryKey: ["bridge-supported-assets"],
    queryFn: async () => {
      const response = await fetch("/api/polymarket/bridge/supported-assets");
      if (!response.ok) throw new Error("Failed to load supported assets");
      return response.json();
    },
    staleTime: 5 * 60_000,
  });
}

/** Generate deposit addresses for a trading wallet. */
export function useBridgeDepositAddresses() {
  return useMutation<BridgeAddresses, Error, { address: string }>({
    mutationFn: ({ address }) =>
      postJson<BridgeAddresses>("/api/polymarket/bridge/deposit", { address }),
  });
}

export interface BridgeWithdrawalParams {
  address: string;
  toChainId: string;
  toTokenAddress: string;
  recipientAddr: string;
}

/** Generate withdrawal addresses for a destination chain/token/recipient. */
export function useBridgeWithdrawalAddresses() {
  return useMutation<BridgeAddresses, Error, BridgeWithdrawalParams>({
    mutationFn: (params) =>
      postJson<BridgeAddresses>("/api/polymarket/bridge/withdraw", params),
  });
}

export interface BridgeQuoteParams {
  fromAmountBaseUnit: string;
  fromChainId: string;
  fromTokenAddress: string;
  recipientAddress: string;
  toChainId: string;
  toTokenAddress: string;
}

export interface BridgeQuote {
  estCheckoutTimeMs: number;
  estInputUsd: number;
  estOutputUsd: number;
  estToTokenBaseUnit: string;
  quoteId: string;
  estFeeBreakdown?: {
    gasUsd?: number;
    appFeeLabel?: string;
    appFeePercent?: number;
    appFeeUsd?: number;
    fillCostPercent?: number;
    fillCostUsd?: number;
    maxSlippage?: number;
    minReceived?: number;
    swapImpact?: number;
    swapImpactUsd?: number;
    totalImpact?: number;
    totalImpactUsd?: number;
  };
}

/** Preview fees and estimated output for a bridge transfer. */
export function useBridgeQuote() {
  return useMutation<BridgeQuote, Error, BridgeQuoteParams>({
    mutationFn: (params) =>
      postJson<BridgeQuote>("/api/polymarket/bridge/quote", params),
  });
}

export type BridgeTransactionStatus =
  | "DEPOSIT_DETECTED"
  | "PROCESSING"
  | "ORIGIN_TX_CONFIRMED"
  | "SUBMITTED"
  | "COMPLETED"
  | "FAILED";

export interface BridgeTransaction {
  fromChainId: string;
  fromTokenAddress: string;
  fromAmountBaseUnit: string;
  toChainId: string;
  toTokenAddress: string;
  status: BridgeTransactionStatus;
  txHash?: string;
  createdTimeMs?: number;
}

interface BridgeStatusResponse {
  transactions: BridgeTransaction[];
  nextCursor: string | null;
}

/** Poll the status of a bridge transfer by bridge address. */
export function useBridgeStatus(bridgeAddress: string | null) {
  return useQuery<BridgeStatusResponse>({
    queryKey: ["bridge-status", bridgeAddress],
    queryFn: async () => {
      const response = await fetch(
        `/api/polymarket/bridge/status/${bridgeAddress}?limit=10`
      );
      if (!response.ok) throw new Error("Failed to load bridge status");
      return response.json();
    },
    enabled: !!bridgeAddress,
    refetchInterval: (query) => {
      const status = query.state.data?.transactions?.[0]?.status;
      if (status === "COMPLETED" || status === "FAILED") return false;
      return 15_000;
    },
    refetchIntervalInBackground: true,
  });
}
