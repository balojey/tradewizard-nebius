import { useState, useCallback } from "react";
import { RelayClient } from "@polymarket/builder-relayer-client";
import { createUsdcTransferTx, TransferParams } from "@/utils/transfer";
import { useTrading } from "@/providers/TradingProvider";
import {
  PUSD_CONTRACT_ADDRESS,
} from "@/constants/collateral";

export default function useUsdcTransfer() {
  const { secureClient } = useTrading();
  const [isTransferring, setIsTransferring] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  const transferUsdc = useCallback(
    async (
      relayClient: RelayClient | null,
      params: TransferParams
    ): Promise<string> => {
      setIsTransferring(true);
      setError(null);

      try {
        // Prefer pUSD through the modern client when available.
        if (secureClient) {
          const handle = await secureClient.transferErc20({
            tokenAddress: PUSD_CONTRACT_ADDRESS,
            recipientAddress: params.recipient,
            amount: params.amount,
          });
          const outcome = await handle.wait();
          return String(outcome.transactionHash);
        }

        if (!relayClient) {
          throw new Error("Trading session not initialized");
        }

        const transferTx = createUsdcTransferTx(params);
        const response = await relayClient.execute(
          [transferTx],
          `Transfer to ${params.recipient}`
        );
        const result = await response.wait();
        if (!result?.transactionHash) {
          throw new Error("Transfer did not confirm");
        }
        return result.transactionHash;
      } catch (err) {
        const transferError =
          err instanceof Error ? err : new Error("Failed to transfer");
        setError(transferError);
        throw transferError;
      } finally {
        setIsTransferring(false);
      }
    },
    [secureClient]
  );

  return {
    isTransferring,
    error,
    transferUsdc,
  };
}
