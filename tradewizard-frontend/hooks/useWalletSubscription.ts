'use client';

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@/lib/api-client';
import { useAuth } from '@/hooks/useAuth';
import { useTrading } from '@/providers/TradingProvider';
import { useWallet } from '@/providers/WalletContext';
import { createUsdcTransferTx } from '@/utils/transfer';
import { USDC_E_CONTRACT_ADDRESS, USDC_E_DECIMALS } from '@/constants/tokens';
import { PUSD_CONTRACT_ADDRESS } from '@/constants/collateral';
import { erc20Abi, type PublicClient } from 'viem';
import type { RelayClient } from '@polymarket/builder-relayer-client';
import type { TradeWizardSecureClient } from '@/lib/polymarket-client';

/**
 * Pay for a subscription or credit pack using pUSD when available, otherwise
 * fall back to the legacy USDC.e Safe transfer. Returns the transaction hash.
 */
async function transferCollateral(params: {
  secureClient: TradeWizardSecureClient | null;
  publicClient: PublicClient | null;
  safeAddress: string | undefined;
  relayClient: RelayClient | null;
  amount: bigint;
  description: string;
}): Promise<string> {
  const { secureClient, publicClient, safeAddress, relayClient, amount, description } = params;

  if (secureClient && publicClient && safeAddress) {
    const pusdBalance = await publicClient.readContract({
      address: PUSD_CONTRACT_ADDRESS,
      abi: erc20Abi,
      functionName: 'balanceOf',
      args: [safeAddress as `0x${string}`],
    });

    if (pusdBalance >= amount) {
      const handle = await secureClient.transferErc20({
        tokenAddress: PUSD_CONTRACT_ADDRESS,
        recipientAddress: PLATFORM_WALLET_ADDRESS,
        amount,
      });
      const outcome = await handle.wait();
      return String(outcome.transactionHash);
    }
  }

  if (!relayClient) {
    throw new Error('Trading session not initialized. Please connect your wallet first.');
  }

  const transferTx = createUsdcTransferTx({
    recipient: PLATFORM_WALLET_ADDRESS,
    amount,
  });
  const response = await relayClient.execute([transferTx], description);
  const result = await response.wait();
  if (!result?.transactionHash) {
    throw new Error('Transfer did not confirm');
  }
  return result.transactionHash;
}

/** Combined USD balance across pUSD and legacy USDC.e, in 6-decimal units. */
async function readCombinedBudget(
  publicClient: PublicClient | null,
  address: string | undefined
): Promise<bigint | null> {
  if (!publicClient || !address) return null;

  const [pusd, usdce] = await Promise.all([
    publicClient.readContract({
      address: PUSD_CONTRACT_ADDRESS,
      abi: erc20Abi,
      functionName: 'balanceOf',
      args: [address as `0x${string}`],
    }),
    publicClient.readContract({
      address: USDC_E_CONTRACT_ADDRESS,
      abi: erc20Abi,
      functionName: 'balanceOf',
      args: [address as `0x${string}`],
    }),
  ]);

  return pusd + usdce;
}

// ---------------------------------------------------------------------------
// Transaction Progress
// ---------------------------------------------------------------------------

/** Steps in the wallet transaction flow, emitted via onProgress callbacks. */
export type TxProgressStep = 'sending' | 'confirming' | 'verifying';

/**
 * Optional progress callback to track multi-step wallet transactions.
 * Called at each stage transition before the step begins.
 */
export type OnTxProgress = (step: TxProgressStep) => void;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface WalletSubscriptionData {
  plan: 'free' | 'starter' | 'pro' | 'elite';
  status: 'active' | 'cancelled' | 'grace_period';
  creditsRemaining: number;
  creditsMonthlyLimit: number;
  billingCycleEnd: string | null;
  renewalPrice: number | null;
  walletAddress: string;
  allowanceStatus: 'approved' | 'not_approved' | 'insufficient';
  isTrial: boolean;
  trialEnd: string | null;
  trialEligible: boolean;
}

interface SubscribeResult {
  subscription: {
    id: string;
    plan: string;
    status: string;
    creditsRemaining: number;
    creditsMonthlyLimit: number;
    billingCycleStart: string;
    billingCycleEnd: string;
  };
  payment: {
    txHash: string;
    amount: number;
    type: string;
  };
}

interface PurchaseResult {
  creditsRemaining: number;
  creditsAdded: number;
  payment: {
    txHash: string;
    amount: number;
    type: string;
  };
}

interface CancelResult {
  message: string;
  expiresAt: string;
}

interface RenewResult {
  subscription: {
    id: string;
    plan: string;
    status: string;
    creditsRemaining: number;
    creditsMonthlyLimit: number;
    billingCycleStart: string;
    billingCycleEnd: string;
  };
  payment: {
    txHash: string;
    amount: number;
    type: string;
  };
}

// ---------------------------------------------------------------------------
// Plan pricing (mirrors backend PLANS config)
// ---------------------------------------------------------------------------

const PLAN_PRICES: Record<string, number> = {
  free: 0,
  starter: 19,
  pro: 49,
  elite: 149,
};

const CREDIT_PACK_PRICES: Record<string, number> = {
  pack_20: 4.99,
  pack_45: 9.99,
  pack_75: 14.99,
};

/**
 * Convert a USD amount to USDC.e contract units (6 decimals).
 */
function toUsdcUnits(usdAmount: number): bigint {
  return BigInt(Math.round(usdAmount * 10 ** USDC_E_DECIMALS));
}

// ---------------------------------------------------------------------------
// Platform Wallet Address (from environment)
// ---------------------------------------------------------------------------

const PLATFORM_WALLET_ADDRESS = (process.env.NEXT_PUBLIC_PLATFORM_WALLET_ADDRESS ||
  '0x0000000000000000000000000000000000000000') as `0x${string}`;

// ---------------------------------------------------------------------------
// Insufficient Balance Error
// ---------------------------------------------------------------------------

export class InsufficientBalanceError extends Error {
  public readonly required: number;
  public readonly available: number;

  constructor(required: number, available: number) {
    super(
      `Insufficient balance. You need $${required.toFixed(2)} but only have $${available.toFixed(2)} in your Trading Wallet.`
    );
    this.name = 'InsufficientBalanceError';
    this.required = required;
    this.available = available;
  }
}

// ---------------------------------------------------------------------------
// Query Hook: useWalletSubscription
// ---------------------------------------------------------------------------

/**
 * Fetches the current user's subscription data from GET /subscriptions.
 * Exposes plan, status, credits, billing info, wallet address, and allowance status.
 */
export function useWalletSubscription() {
  const { isAuthenticated } = useAuth();

  return useQuery<WalletSubscriptionData>({
    queryKey: ['subscription'],
    queryFn: () => apiClient.get<WalletSubscriptionData>('/subscriptions'),
    staleTime: 60_000, // 1 minute
    retry: 2,
    enabled: isAuthenticated,
  });
}

// ---------------------------------------------------------------------------
// Mutation Hook: useSubscribePlan
// ---------------------------------------------------------------------------

/**
 * Subscribes to a plan by:
 * 1. Creating a SafeTransaction for USDC.e transfer to Platform Wallet
 * 2. Executing via relayClient
 * 3. POSTing the txHash to the backend for verification
 *
 * Accepts an optional onProgress callback to report step transitions.
 *
 * Validates: Requirements 1.2, 6.3
 */
export function useSubscribePlan() {
  const queryClient = useQueryClient();
  const { relayClient, safeAddress, secureClient } = useTrading();
  const { publicClient } = useWallet();

  return useMutation<SubscribeResult, Error, { planId: string; onProgress?: OnTxProgress }>({
    mutationFn: async ({ planId, onProgress }) => {
      const price = PLAN_PRICES[planId];
      if (price === undefined) {
        throw new Error(`Invalid plan: ${planId}`);
      }

      if (price === 0) {
        throw new Error('Cannot purchase the free plan via transfer.');
      }

      const amount = toUsdcUnits(price);

      // Pre-flight: check combined pUSD + USDC.e balance before submitting
      try {
        const balance = await readCombinedBudget(publicClient, safeAddress);
        if (balance !== null && balance < amount) {
          const availableUsd = Number(balance) / 10 ** USDC_E_DECIMALS;
          throw new InsufficientBalanceError(price, availableUsd);
        }
      } catch (err) {
        if (err instanceof InsufficientBalanceError) throw err;
      }

      onProgress?.('sending');
      const txHash = await transferCollateral({
        secureClient,
        publicClient,
        safeAddress,
        relayClient,
        amount,
        description: `Subscribe to ${planId} plan`,
      });

      // Step 3: POST txHash to backend for verification
      onProgress?.('verifying');
      const result = await apiClient.post<SubscribeResult>('/subscriptions', {
        planId,
        txHash,
      });

      return result;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['subscription'] });
      queryClient.invalidateQueries({ queryKey: ['usdcBalance'] });
    },
  });
}

// ---------------------------------------------------------------------------
// Mutation Hook: usePurchaseCreditPack
// ---------------------------------------------------------------------------

/**
 * Purchases a credit pack by:
 * 1. Creating a SafeTransaction for USDC.e transfer
 * 2. Executing via relayClient
 * 3. POSTing the txHash to the backend
 *
 * Optimistically updates credits in the cache (Req 6.5).
 * Accepts an optional onProgress callback to report step transitions.
 *
 * Validates: Requirements 4.2, 6.5
 */
export function usePurchaseCreditPack() {
  const queryClient = useQueryClient();
  const { relayClient, safeAddress, secureClient } = useTrading();
  const { publicClient } = useWallet();

  return useMutation<PurchaseResult, Error, { packId: string; onProgress?: OnTxProgress }, { previousData: WalletSubscriptionData | undefined }>({
    mutationFn: async ({ packId, onProgress }) => {
      const price = CREDIT_PACK_PRICES[packId];
      if (price === undefined) {
        throw new Error(`Invalid credit pack: ${packId}`);
      }

      const amount = toUsdcUnits(price);

      // Pre-flight: check combined pUSD + USDC.e balance before submitting
      try {
        const balance = await readCombinedBudget(publicClient, safeAddress);
        if (balance !== null && balance < amount) {
          const availableUsd = Number(balance) / 10 ** USDC_E_DECIMALS;
          throw new InsufficientBalanceError(price, availableUsd);
        }
      } catch (err) {
        if (err instanceof InsufficientBalanceError) throw err;
      }

      onProgress?.('sending');
      const txHash = await transferCollateral({
        secureClient,
        publicClient,
        safeAddress,
        relayClient,
        amount,
        description: `Purchase credit pack: ${packId}`,
      });

      // Step 3: POST txHash to backend for verification
      onProgress?.('verifying');
      const result = await apiClient.post<PurchaseResult>('/credits/purchase', {
        packId,
        txHash,
      });

      return result;
    },
    onMutate: async ({ packId }) => {
      // Optimistic update: add credits immediately (Req 6.5)
      await queryClient.cancelQueries({ queryKey: ['subscription'] });

      const previousData = queryClient.getQueryData<WalletSubscriptionData>(['subscription']);

      const creditsToAdd = packId === 'pack_20' ? 20 : packId === 'pack_45' ? 45 : packId === 'pack_75' ? 75 : 0;

      if (previousData && creditsToAdd > 0) {
        queryClient.setQueryData<WalletSubscriptionData>(['subscription'], {
          ...previousData,
          creditsRemaining: previousData.creditsRemaining + creditsToAdd,
        });
      }

      return { previousData };
    },
    onError: (_error, _variables, context) => {
      // Revert optimistic update on error
      if (context?.previousData) {
        queryClient.setQueryData(['subscription'], context.previousData);
      }
    },
    onSettled: () => {
      // Refetch to get server-confirmed value
      queryClient.invalidateQueries({ queryKey: ['subscription'] });
      queryClient.invalidateQueries({ queryKey: ['usdcBalance'] });
    },
  });
}

// ---------------------------------------------------------------------------
// Mutation Hook: useStartTrial
// ---------------------------------------------------------------------------

interface TrialResult {
  subscription: {
    id: string;
    plan: string;
    status: string;
    creditsRemaining: number;
    creditsMonthlyLimit: number;
    billingCycleStart: string;
    billingCycleEnd: string;
    isTrial: boolean;
    trialEnd: string;
  };
  message: string;
}

/**
 * Starts a 30-day free trial for the specified plan.
 * No wallet transaction required - completely free.
 * Only available for Starter and Pro plans, only for users who have never had a paid plan.
 */
export function useStartTrial() {
  const queryClient = useQueryClient();

  return useMutation<TrialResult, Error, { planId: string }>({
    mutationFn: async ({ planId }) => {
      const result = await apiClient.post<TrialResult>('/subscriptions/trial', {
        planId,
      });
      return result;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['subscription'] });
    },
  });
}

// ---------------------------------------------------------------------------
// Mutation Hook: useCancelSubscription
// ---------------------------------------------------------------------------

/**
 * Cancels the user's active subscription.
 * Validates: Requirements 3.1, 3.2
 */
export function useCancelSubscription() {
  const queryClient = useQueryClient();

  return useMutation<CancelResult, Error, string>({
    mutationFn: (subscriptionId: string) =>
      apiClient.delete<CancelResult>(`/subscriptions/${subscriptionId}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['subscription'] });
    },
  });
}

// ---------------------------------------------------------------------------
// Mutation Hook: useManualRenew
// ---------------------------------------------------------------------------

/**
 * Manually renews the subscription by:
 * 1. Creating a SafeTransaction for USDC.e transfer (plan price)
 * 2. Executing via relayClient
 * 3. POSTing the txHash to the backend
 *
 * Used when no allowance is set for auto-renewal.
 * Accepts an optional onProgress callback to report step transitions.
 *
 * Validates: Requirements 2.9
 */
export function useManualRenew() {
  const queryClient = useQueryClient();
  const { relayClient, safeAddress, secureClient } = useTrading();
  const { publicClient } = useWallet();

  return useMutation<RenewResult, Error, { planPrice: number; onProgress?: OnTxProgress }>({
    mutationFn: async ({ planPrice, onProgress }) => {
      const amount = toUsdcUnits(planPrice);

      // Pre-flight: check combined pUSD + USDC.e balance before submitting
      try {
        const balance = await readCombinedBudget(publicClient, safeAddress);
        if (balance !== null && balance < amount) {
          const availableUsd = Number(balance) / 10 ** USDC_E_DECIMALS;
          throw new InsufficientBalanceError(planPrice, availableUsd);
        }
      } catch (err) {
        if (err instanceof InsufficientBalanceError) throw err;
      }

      onProgress?.('sending');
      const txHash = await transferCollateral({
        secureClient,
        publicClient,
        safeAddress,
        relayClient,
        amount,
        description: 'Manual subscription renewal',
      });

      // Step 3: POST txHash to backend for verification
      onProgress?.('verifying');
      const result = await apiClient.post<RenewResult>('/subscriptions/renew', {
        txHash,
      });

      return result;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['subscription'] });
      queryClient.invalidateQueries({ queryKey: ['usdcBalance'] });
    },
  });
}

// ---------------------------------------------------------------------------
// Utility: useOptimisticCreditDecrement (preserved from original)
// ---------------------------------------------------------------------------

/**
 * Returns a function that optimistically decrements the credit balance by 1.
 * Used when an analysis request is initiated.
 */
export function useOptimisticCreditDecrement() {
  const queryClient = useQueryClient();

  return () => {
    queryClient.setQueryData<WalletSubscriptionData>(['subscription'], (old) => {
      if (!old) return old;
      return {
        ...old,
        creditsRemaining: Math.max(0, old.creditsRemaining - 1),
      };
    });
  };
}
