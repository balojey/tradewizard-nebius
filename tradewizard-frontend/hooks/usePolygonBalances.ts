import { erc20Abi, formatUnits } from "viem";
import { useQuery } from "@tanstack/react-query";
import { useWallet } from "@/providers/WalletContext";
import {
  PUSD_CONTRACT_ADDRESS,
  PUSD_DECIMALS,
  USDC_E_CONTRACT_ADDRESS,
  USDC_E_DECIMALS,
} from "@/constants/collateral";
import { QUERY_STALE_TIMES, QUERY_REFETCH_INTERVALS } from "@/constants/query";

/**
 * Read the user's USD balance.
 *
 * During the pUSD migration window we read both pUSD and legacy USDC.e and
 * display a single combined USD balance. Users never see token names.
 */
export default function usePolygonBalances(address: string | undefined) {
  const { publicClient } = useWallet();

  const { data, isLoading, error } = useQuery({
    queryKey: ["usdBalance", address],
    queryFn: async () => {
      if (!address || !publicClient) return null;

      const [pusdResult, usdceResult] = await Promise.allSettled([
        publicClient.readContract({
          address: PUSD_CONTRACT_ADDRESS,
          abi: erc20Abi,
          functionName: "balanceOf",
          args: [address as `0x${string}`],
        }),
        publicClient.readContract({
          address: USDC_E_CONTRACT_ADDRESS,
          abi: erc20Abi,
          functionName: "balanceOf",
          args: [address as `0x${string}`],
        }),
      ]);

      // Tolerate one token being unavailable (e.g. pUSD read failure on a
      // legacy RPC) so the user still sees their legacy balance.
      return {
        pusd: pusdResult.status === "fulfilled" ? pusdResult.value : BigInt(0),
        usdce: usdceResult.status === "fulfilled" ? usdceResult.value : BigInt(0),
      };
    },
    enabled: !!address,
    staleTime: QUERY_STALE_TIMES.BALANCE,
    refetchInterval: QUERY_REFETCH_INTERVALS.BALANCE,
    refetchIntervalInBackground: true,
    refetchOnWindowFocus: true,
  });

  const pusdBalance = data?.pusd
    ? parseFloat(formatUnits(data.pusd, PUSD_DECIMALS))
    : 0;
  const legacyUsdceBalance = data?.usdce
    ? parseFloat(formatUnits(data.usdce, USDC_E_DECIMALS))
    : 0;

  // One number for the user: pUSD + legacy USDC.e.
  const combinedUsdBalance = pusdBalance + legacyUsdceBalance;

  return {
    usdcBalance: combinedUsdBalance,
    formattedUsdcBalance: combinedUsdBalance.toFixed(2),
    rawUsdcBalance: data ? data.pusd + data.usdce : undefined,
    pusdBalance,
    legacyUsdceBalance,
    isLoading,
    isError: !!error,
  };
}
