"use client";

import { useCallback, useMemo, useState } from "react";
import { AlertTriangle, ArrowUpRight, CheckCircle } from "lucide-react";
import { parseUnits } from "viem";
import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";
import { useTrading } from "@/providers/TradingProvider";
import usePolygonBalances from "@/hooks/usePolygonBalances";
import {
  useBridgeAssets,
  useBridgeQuote,
  useBridgeStatus,
  useBridgeWithdrawalAddresses,
} from "@/hooks/useBridge";
import { PUSD_CONTRACT_ADDRESS, PUSD_DECIMALS } from "@/constants/collateral";

interface BridgeWithdrawModalProps {
  open: boolean;
  onClose: () => void;
}

type Step = "form" | "confirm" | "success";

export function BridgeWithdrawModal({ open, onClose }: BridgeWithdrawModalProps) {
  const { safeAddress, secureClient } = useTrading();
  const { pusdBalance } = usePolygonBalances(safeAddress);
  const { data: assetsData, isLoading: assetsLoading } = useBridgeAssets();
  const {
    mutateAsync: createWithdrawalAddresses,
    isPending: isPreparing,
  } = useBridgeWithdrawalAddresses();
  const {
    mutateAsync: fetchQuote,
    isPending: isQuoting,
    data: quote,
  } = useBridgeQuote();

  const [step, setStep] = useState<Step>("form");
  const [amount, setAmount] = useState("");
  const [recipient, setRecipient] = useState("");
  const [assetIndex, setAssetIndex] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [isSending, setIsSending] = useState(false);
  const [bridgeAddress, setBridgeAddress] = useState<string | null>(null);

  const { data: bridgeStatus } = useBridgeStatus(bridgeAddress);
  const latestStatus = bridgeStatus?.transactions?.[0]?.status;

  const evmAssets = useMemo(
    () =>
      (assetsData?.supportedAssets ?? []).filter((asset) => {
        // EVM destinations use 0x token addresses. Solana/Bitcoin/Tron do not.
        return asset.token.address.startsWith("0x");
      }),
    [assetsData]
  );

  const selectedAsset = evmAssets[assetIndex];
  const amountNum = parseFloat(amount) || 0;
  const isValidRecipient = /^0x[a-fA-F0-9]{40}$/.test(recipient);
  const isValidAmount =
    amountNum > 0 && amountNum <= pusdBalance && !!selectedAsset;
  const canProceed = isValidAmount && isValidRecipient;

  const reset = useCallback(() => {
    setStep("form");
    setAmount("");
    setRecipient("");
    setError(null);
    setBridgeAddress(null);
  }, []);

  const handleClose = useCallback(() => {
    reset();
    onClose();
  }, [reset, onClose]);

  const handleReview = useCallback(async () => {
    if (!canProceed || !safeAddress || !selectedAsset) return;

    setError(null);
    try {
      await fetchQuote({
        fromAmountBaseUnit: parseUnits(
          amountNum.toFixed(PUSD_DECIMALS),
          PUSD_DECIMALS
        ).toString(),
        fromChainId: "137",
        fromTokenAddress: PUSD_CONTRACT_ADDRESS,
        recipientAddress: recipient,
        toChainId: selectedAsset.chainId,
        toTokenAddress: selectedAsset.token.address,
      });
      setStep("confirm");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load quote");
    }
  }, [
    canProceed,
    safeAddress,
    selectedAsset,
    fetchQuote,
    amountNum,
    recipient,
  ]);

  const handleConfirm = useCallback(async () => {
    if (!canProceed || !safeAddress || !secureClient || !selectedAsset) return;

    setError(null);
    setIsSending(true);

    try {
      const bridge = await createWithdrawalAddresses({
        address: safeAddress,
        toChainId: selectedAsset.chainId,
        toTokenAddress: selectedAsset.token.address,
        recipientAddr: recipient,
      });

      const evmBridgeAddress = bridge.address?.evm;
      if (!evmBridgeAddress) {
        throw new Error("No EVM withdrawal address was returned");
      }

      setBridgeAddress(evmBridgeAddress);

      const handle = await secureClient.transferErc20({
        tokenAddress: PUSD_CONTRACT_ADDRESS,
        recipientAddress: evmBridgeAddress,
        amount: parseUnits(amountNum.toFixed(PUSD_DECIMALS), PUSD_DECIMALS),
      });

      await handle.wait();
      setStep("success");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Withdrawal failed");
    } finally {
      setIsSending(false);
    }
  }, [
    canProceed,
    safeAddress,
    secureClient,
    selectedAsset,
    createWithdrawalAddresses,
    recipient,
    amountNum,
  ]);

  return (
    <Modal open={open} onClose={handleClose} title="Withdraw" size="sm" mobileSheet>
      {step === "form" && (
        <div className="flex flex-col gap-4">
          <div className="flex items-center justify-between p-3 rounded-lg bg-surface-2/50">
            <span className="text-xs text-muted">Available to withdraw</span>
            <span className="text-sm font-mono font-semibold text-yes">
              ${pusdBalance.toFixed(2)}
            </span>
          </div>

          <div className="flex flex-col gap-1.5">
            <label htmlFor="bridge-asset" className="text-xs font-medium text-muted">
              Destination
            </label>
            {assetsLoading ? (
              <div className="h-10 rounded-lg bg-surface-2 animate-pulse" />
            ) : (
              <select
                id="bridge-asset"
                value={assetIndex}
                onChange={(e) => setAssetIndex(Number(e.target.value))}
                className="w-full px-3 py-2.5 rounded-lg border border-border bg-surface text-fg text-sm focus:outline-none focus:ring-2 focus:ring-accent focus:border-transparent"
              >
                {evmAssets.map((asset, index) => (
                  <option key={`${asset.chainId}-${asset.token.address}`} value={index}>
                    {asset.token.symbol} on {asset.chainName}
                  </option>
                ))}
              </select>
            )}
            {selectedAsset && (
              <span className="text-xs text-muted">
                Minimum: ${selectedAsset.minCheckoutUsd}
              </span>
            )}
          </div>

          <div className="flex flex-col gap-1.5">
            <label htmlFor="bridge-amount" className="text-xs font-medium text-muted">
              Amount (USD)
            </label>
            <input
              id="bridge-amount"
              type="number"
              inputMode="decimal"
              step="0.01"
              min="0"
              max={pusdBalance}
              placeholder="0.00"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              className="w-full px-3 py-2.5 rounded-lg border border-border bg-surface text-fg font-mono text-sm focus:outline-none focus:ring-2 focus:ring-accent focus:border-transparent"
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <label htmlFor="bridge-recipient" className="text-xs font-medium text-muted">
              Recipient address
            </label>
            <input
              id="bridge-recipient"
              type="text"
              placeholder="0x..."
              value={recipient}
              onChange={(e) => setRecipient(e.target.value)}
              className="w-full px-3 py-2.5 rounded-lg border border-border bg-surface text-fg font-mono text-sm focus:outline-none focus:ring-2 focus:ring-accent focus:border-transparent"
            />
            {recipient.length > 0 && !isValidRecipient && (
              <span className="text-xs text-no">Invalid address</span>
            )}
          </div>

          {!secureClient && (
            <div className="flex items-start gap-2 p-3 rounded-lg bg-warning/10 border border-warning/20">
              <AlertTriangle className="w-4 h-4 text-warning shrink-0 mt-0.5" aria-hidden="true" />
              <p className="text-xs text-muted">
                Cross-chain withdrawals require the modern wallet. Please refresh or reconnect.
              </p>
            </div>
          )}

          {error && (
            <div className="p-3 rounded-lg bg-no/10 border border-no/20">
              <p className="text-xs text-no">{error}</p>
            </div>
          )}

          <Button
            variant="primary"
            size="lg"
            className="w-full mt-2"
            disabled={!canProceed || isPreparing}
            loading={isQuoting}
            onClick={handleReview}
          >
            <ArrowUpRight className="w-4 h-4 mr-2" aria-hidden="true" />
            Review Withdrawal
          </Button>
        </div>
      )}

      {step === "confirm" && selectedAsset && (
        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-2 p-4 rounded-lg border border-border bg-surface-2/30">
            <div className="flex items-center justify-between">
              <span className="text-xs text-muted">Amount</span>
              <span className="text-sm font-mono font-semibold text-fg">
                ${amountNum.toFixed(2)}
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-xs text-muted">You receive</span>
              <span className="text-sm text-fg">
                {selectedAsset.token.symbol} on {selectedAsset.chainName}
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-xs text-muted">To</span>
              <span className="text-xs font-mono text-fg truncate max-w-[180px]">
                {recipient}
              </span>
            </div>
            {quote && (
              <>
                <div className="flex items-center justify-between">
                  <span className="text-xs text-muted">Estimated received</span>
                  <span className="text-xs text-fg">
                    ${quote.estOutputUsd.toFixed(2)}
                  </span>
                </div>
                {quote.estFeeBreakdown?.minReceived !== undefined && (
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-muted">Minimum received</span>
                    <span className="text-xs text-fg">
                      ${quote.estFeeBreakdown.minReceived.toFixed(2)}
                    </span>
                  </div>
                )}
              </>
            )}
          </div>

          {error && (
            <div className="p-3 rounded-lg bg-no/10 border border-no/20">
              <p className="text-xs text-no">{error}</p>
            </div>
          )}

          <div className="flex gap-3">
            <Button
              variant="ghost"
              size="md"
              className="flex-1"
              onClick={() => setStep("form")}
              disabled={isSending}
            >
              Back
            </Button>
            <Button
              variant="primary"
              size="md"
              className="flex-1"
              loading={isSending}
              onClick={handleConfirm}
            >
              Confirm Withdrawal
            </Button>
          </div>
        </div>
      )}

      {step === "success" && (
        <div className="flex flex-col items-center gap-4 py-4">
          <div className="w-12 h-12 rounded-full bg-yes/15 flex items-center justify-center">
            <CheckCircle className="w-6 h-6 text-yes" aria-hidden="true" />
          </div>
          <div className="text-center">
            <h3 className="text-base font-semibold text-fg">Withdrawal sent</h3>
            <p className="text-sm text-muted mt-1">
              {latestStatus === "COMPLETED"
                ? "Funds have arrived."
                : latestStatus === "FAILED"
                  ? "The transfer failed. Please contact support."
                  : "Your withdrawal is on its way. Funds arrive shortly."}
            </p>
          </div>
          <Button variant="secondary" size="md" className="w-full mt-2" onClick={handleClose}>
            Done
          </Button>
        </div>
      )}
    </Modal>
  );
}
