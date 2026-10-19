import { useState, useCallback } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Side, OrderType } from "@polymarket/clob-client";
import type { ClobClient, UserOrder, UserMarketOrder } from "@polymarket/clob-client";
import { OrderSide } from "@polymarket/client";
import type { TradeWizardSecureClient } from "@/lib/polymarket-client";

export type OrderParams = {
  tokenId: string;
  size: number;
  price?: number;
  side: "BUY" | "SELL";
  negRisk?: boolean;
  isMarketOrder?: boolean;
};

export default function useClobOrder(
  clobClient: ClobClient | null,
  walletAddress: string | undefined,
  secureClient?: TradeWizardSecureClient | null
) {
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const [orderId, setOrderId] = useState<string | null>(null);
  const queryClient = useQueryClient();

  const submitOrder = useCallback(
    async (params: OrderParams) => {
      if (!walletAddress) {
        throw new Error("Wallet not connected");
      }
      if (!secureClient && !clobClient) {
        throw new Error("Trading client not initialized");
      }

      setIsSubmitting(true);
      setError(null);
      setOrderId(null);

      try {
        const unifiedSide =
          params.side === "BUY" ? OrderSide.BUY : OrderSide.SELL;
        let orderId: string | undefined;

        if (secureClient) {
          if (params.isMarketOrder) {
            let marketAmount: number;

            if (params.side === "BUY") {
              const priceResponse = await secureClient.fetchPrice({
                assetId: params.tokenId,
                side: OrderSide.SELL, // ask price for buyers
              });
              const askPrice = parseFloat(priceResponse);

              if (isNaN(askPrice) || askPrice <= 0 || askPrice >= 1) {
                throw new Error("Unable to get valid market price");
              }

              marketAmount = params.size * askPrice;
            } else {
              marketAmount = params.size;
            }

            const response =
              params.side === "BUY"
                ? await secureClient.placeMarketOrder({
                    assetId: params.tokenId,
                    amount: marketAmount,
                    side: OrderSide.BUY,
                  })
                : await secureClient.placeMarketOrder({
                    assetId: params.tokenId,
                    shares: marketAmount,
                    side: OrderSide.SELL,
                  });

            if (!response.ok) {
              throw new Error(response.message || "Order submission failed");
            }
            orderId = response.orderId;
          } else {
            if (!params.price) {
              throw new Error("Price required for limit orders");
            }

            const response = await secureClient.placeLimitOrder({
              assetId: params.tokenId,
              price: params.price,
              size: params.size,
              side: unifiedSide,
            });

            if (!response.ok) {
              throw new Error(response.message || "Order submission failed");
            }
            orderId = response.orderId;
          }
        } else {
          // Legacy CLOB path (USDC.e) during the migration window.
          const side = params.side === "BUY" ? Side.BUY : Side.SELL;
          let response;

          if (params.isMarketOrder) {
            let marketAmount: number;

            if (side === Side.BUY) {
              const priceResponse = await clobClient!.getPrice(
                params.tokenId,
                Side.SELL
              );
              const askPrice = parseFloat(priceResponse.price);

              if (isNaN(askPrice) || askPrice <= 0 || askPrice >= 1) {
                throw new Error("Unable to get valid market price");
              }

              marketAmount = params.size * askPrice;
            } else {
              marketAmount = params.size;
            }

            const marketOrder: UserMarketOrder = {
              tokenID: params.tokenId,
              amount: marketAmount,
              side,
              feeRateBps: 0,
            };

            response = await clobClient!.createAndPostMarketOrder(
              marketOrder,
              { negRisk: params.negRisk },
              OrderType.FOK
            );
          } else {
            if (!params.price) {
              throw new Error("Price required for limit orders");
            }

            const limitOrder: UserOrder = {
              tokenID: params.tokenId,
              price: params.price,
              size: params.size,
              side,
              feeRateBps: 0,
              expiration: 0,
              taker: "0x0000000000000000000000000000000000000000",
            };

            response = await clobClient!.createAndPostOrder(
              limitOrder,
              { negRisk: params.negRisk },
              OrderType.GTC
            );
          }

          orderId = response.orderID;
        }

        if (orderId) {
          setOrderId(orderId);
          queryClient.invalidateQueries({ queryKey: ["active-orders"] });
          queryClient.invalidateQueries({ queryKey: ["polymarket-positions"] });
          return { success: true, orderId };
        } else {
          throw new Error("Order submission failed");
        }
      } catch (err: unknown) {
        const error =
          err instanceof Error ? err : new Error("Failed to submit order");
        setError(error);
        throw error;
      } finally {
        setIsSubmitting(false);
      }
    },
    [clobClient, secureClient, walletAddress, queryClient]
  );

  const cancelOrder = useCallback(
    async (orderId: string) => {
      if (!secureClient && !clobClient) {
        throw new Error("Trading client not initialized");
      }

      setIsSubmitting(true);
      setError(null);

      try {
        if (secureClient) {
          await secureClient.cancelOrder({ orderId });
        } else {
          await clobClient!.cancelOrder({ orderID: orderId });
        }
        queryClient.invalidateQueries({ queryKey: ["active-orders"] });
        return { success: true };
      } catch (err: unknown) {
        const error =
          err instanceof Error ? err : new Error("Failed to cancel order");
        setError(error);
        throw error;
      } finally {
        setIsSubmitting(false);
      }
    },
    [clobClient, secureClient, queryClient]
  );

  return {
    submitOrder,
    cancelOrder,
    isSubmitting,
    error,
    orderId,
  };
}
