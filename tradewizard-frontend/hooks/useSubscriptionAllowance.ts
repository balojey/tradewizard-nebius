'use client';

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { encodeFunctionData, erc20Abi } from 'viem';
import { OperationType } from '@polymarket/builder-relayer-client';
import { useWallet } from '@/providers/WalletContext';
import { useTrading } from '@/providers/TradingProvider';
import { useWalletSubscription } from '@/hooks/useWalletSubscription';
import { USDC_E_CONTRACT_ADDRESS, USDC_E_DECIMALS } from '@/constants/tokens';
import { PUSD_CONTRACT_ADDRESS } from '@/constants/collateral';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const PLATFORM_WALLET_ADDRESS = (process.env.NEXT_PUBLIC_PLATFORM_WALLET_ADDRESS ||
  '0x0000000000000000000000000000000000000000') as `0x${string}`;

const ZERO = BigInt(0);

const PLAN_PRICES_USDC: Record<string, bigint> = {
  free: ZERO,
  starter: BigInt(19 * 10 ** USDC_E_DECIMALS),
  pro: BigInt(49 * 10 ** USDC_E_DECIMALS),
  elite: BigInt(149 * 10 ** USDC_E_DECIMALS),
};

// ---------------------------------------------------------------------------
// Hook: useSubscriptionAllowance
// ---------------------------------------------------------------------------

/**
 * Reads the current USDC.e allowance granted by the user's Safe (Trading Wallet)
 * to the Platform Wallet. Exposes whether auto-renewal is enabled based on
 * whether the allowance covers the current plan price.
 *
 * Also provides mutations to approve or revoke the allowance.
 *
 * Validates: Requirements 2.1, 3.7, 6.6, 6.10
 */
export function useSubscriptionAllowance() {
  const { publicClient } = useWallet();
  const { safeAddress, relayClient, secureClient } = useTrading();
  const { data: subscription } = useWalletSubscription();
  const queryClient = useQueryClient();

  const plan = subscription?.plan ?? 'free';
  const planPrice = PLAN_PRICES_USDC[plan] ?? ZERO;

  // Query: read pUSD + legacy USDC.e allowances to the Platform Wallet
  const {
    data: allowance = ZERO,
    isLoading,
    error,
  } = useQuery<bigint>({
    queryKey: ['subscriptionAllowance', safeAddress, PLATFORM_WALLET_ADDRESS],
    queryFn: async () => {
      if (!publicClient || !safeAddress) return ZERO;

      const [pusd, usdce] = await Promise.all([
        publicClient.readContract({
          address: PUSD_CONTRACT_ADDRESS,
          abi: erc20Abi,
          functionName: 'allowance',
          args: [safeAddress as `0x${string}`, PLATFORM_WALLET_ADDRESS],
        }),
        publicClient.readContract({
          address: USDC_E_CONTRACT_ADDRESS,
          abi: erc20Abi,
          functionName: 'allowance',
          args: [safeAddress as `0x${string}`, PLATFORM_WALLET_ADDRESS],
        }),
      ]);

      return pusd > usdce ? pusd : usdce;
    },
    enabled: !!publicClient && !!safeAddress,
    staleTime: 10_000, // 10 seconds
    refetchInterval: 15_000, // Refetch every 15 seconds
    refetchOnWindowFocus: true,
  });

  const isAutoRenewalEnabled = planPrice > ZERO && allowance >= planPrice;

  // Mutation: approve allowance for auto-renewal
  const approveAllowance = useMutation({
    mutationFn: async ({ amount }: { amount?: bigint }) => {
      const approveAmount = amount ?? planPrice;

      if (approveAmount <= ZERO) {
        throw new Error('Cannot approve zero allowance. Use revoke instead.');
      }

      // Prefer pUSD when the unified client is active and the wallet holds it.
      if (secureClient && publicClient && safeAddress) {
        const pusdBalance = await publicClient.readContract({
          address: PUSD_CONTRACT_ADDRESS,
          abi: erc20Abi,
          functionName: 'balanceOf',
          args: [safeAddress as `0x${string}`],
        });

        if (pusdBalance > ZERO) {
          const handle = await secureClient.approveErc20({
            tokenAddress: PUSD_CONTRACT_ADDRESS,
            spenderAddress: PLATFORM_WALLET_ADDRESS,
            amount: 'max',
          });
          const outcome = await handle.wait();
          return outcome.transactionHash;
        }
      }

      if (!relayClient) {
        throw new Error('Trading session not initialized. Please connect your wallet first.');
      }

      // Encode the approve function call
      const data = encodeFunctionData({
        abi: erc20Abi,
        functionName: 'approve',
        args: [PLATFORM_WALLET_ADDRESS, approveAmount],
      });

      // Create SafeTransaction for the approve call
      const approveTx = {
        to: USDC_E_CONTRACT_ADDRESS as `0x${string}`,
        operation: OperationType.Call,
        data,
        value: '0',
      };

      // Execute via relayClient
      const response = await relayClient.execute(
        [approveTx],
        'Approve allowance for subscription auto-renewal'
      );

      const result = await response.wait();
      if (!result?.transactionHash) {
        throw new Error('Approval did not confirm');
      }
      return result.transactionHash;
    },
    onSuccess: () => {
      // Invalidate the allowance query to refetch the new value
      queryClient.invalidateQueries({
        queryKey: ['subscriptionAllowance', safeAddress, PLATFORM_WALLET_ADDRESS],
      });
    },
  });

  // Mutation: revoke allowance
  const revokeAllowance = useMutation({
    mutationFn: async () => {
      if (secureClient) {
        const handle = await secureClient.approveErc20({
          tokenAddress: PUSD_CONTRACT_ADDRESS,
          spenderAddress: PLATFORM_WALLET_ADDRESS,
          amount: BigInt(0),
        });
        const outcome = await handle.wait();
        return outcome.transactionHash;
      }

      if (!relayClient) {
        throw new Error('Trading session not initialized. Please connect your wallet first.');
      }

      // Encode the approve function call with amount = 0
      const data = encodeFunctionData({
        abi: erc20Abi,
        functionName: 'approve',
        args: [PLATFORM_WALLET_ADDRESS, ZERO],
      });

      // Create SafeTransaction for the revoke call
      const revokeTx = {
        to: USDC_E_CONTRACT_ADDRESS as `0x${string}`,
        operation: OperationType.Call,
        data,
        value: '0',
      };

      // Execute via relayClient
      const response = await relayClient.execute(
        [revokeTx],
        'Revoke allowance for subscription'
      );

      const result = await response.wait();
      if (!result?.transactionHash) {
        throw new Error('Revocation did not confirm');
      }
      return result.transactionHash;
    },
    onSuccess: () => {
      // Invalidate the allowance query to refetch the new value
      queryClient.invalidateQueries({
        queryKey: ['subscriptionAllowance', safeAddress, PLATFORM_WALLET_ADDRESS],
      });
    },
  });

  return {
    // State
    allowance,
    isAutoRenewalEnabled,
    isLoading,
    error,
    planPrice,

    // Mutations
    approveAllowance,
    revokeAllowance,
  };
}
