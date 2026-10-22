"use client";

import {
  useState,
  useCallback,
  useMemo,
  forwardRef,
  useEffect,
  type ForwardedRef,
} from "react";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Tabs } from "@/components/ui/Tabs";
import { useTrading } from "@/providers/TradingProvider";
import { useWallet } from "@/providers/WalletContext";
import useClobOrder, { type OrderParams } from "@/hooks/useClobOrder";
import useTickSize from "@/hooks/useTickSize";
import { classifyTradeError, type TradeError } from "@/utils/trade-errors";
import { formatCurrency } from "@/utils/formatting";
import { isValidDecimalInput } from "@/utils/validation";
import { cn } from "@/utils/classNames";
import { AlertCircle, ArrowUpRight } from "lucide-react";
import { USDC_E_CONTRACT_ADDRESS, USDC_E_DECIMALS } from "@/constants/tokens";
import { erc20Abi, formatUnits } from "viem";

// --- Types ---

export type TradeSide = "yes" | "no";
type OrderType = "market" | "limit";

export interface TradeExecutionProps {
  /** Market slug for context */
  marketSlug: string;
  /** Pre-selected side from quick-buy (null = no pre-selection) */
  initialSide: TradeSide | null;
  /** Token IDs for YES and NO outcomes */
  tokenIds?: { yes: string; no: string };
  /** Current market price in decimal (0-1) for YES outcome */
  currentPrice?: number;
  /** Whether the market uses negative risk */
  negRisk?: boolean;
}

// --- Validation ---

const isValidPriceInput = (value: string, maxDecimals: number): boolean => {
  if (value === "" || value === "0" || value === "0.") return true;
  const regex = new RegExp(`^(0?\\.[0-9]{0,${maxDecimals}}|0)$`);
  return regex.test(value);
};

const QUICK_AMOUNTS = [10, 25, 50, 100];

// --- Component ---

export const TradeExecution = forwardRef(function TradeExecution(
  {
    initialSide,
    tokenIds,
    currentPrice = 0.5,
    negRisk = false,
  }: TradeExecutionProps,
  ref: ForwardedRef<HTMLDivElement>
) {
  // --- State ---
  const [side, setSide] = useState<TradeSide>(initialSide ?? "yes");
  const [orderType, setOrderType] = useState<OrderType>("market");
  const [amount, setAmount] = useState("");
  const [limitPrice, setLimitPrice] = useState("");
  const [tradeError, setTradeError] = useState<TradeError | null>(null);

  // Sync side when initialSide changes (quick-buy)
  useEffect(() => {
    if (initialSide) {
      setSide(initialSide);
    }
  }, [initialSide]);

  // --- Hooks ---
  const { clobClient, secureClient, safeAddress, isTradingSessionComplete } = useTrading();
  const { publicClient } = useWallet();
  const { submitOrder, isSubmitting } = useClobOrder(clobClient, safeAddress, secureClient);

  const activeTokenId = side === "yes" ? tokenIds?.yes : tokenIds?.no;
  const { tickSize, isLoading: isLoadingTickSize } = useTickSize(
    activeTokenId ?? null
  );

  // --- Derived values ---
  const decimalPlaces = useMemo(() => {
    if (!tickSize || tickSize <= 0) return 2;
    const str = tickSize.toString();
    const dotIndex = str.indexOf(".");
    return dotIndex === -1 ? 0 : str.length - dotIndex - 1;
  }, [tickSize]);

  const parsedAmount = useMemo(() => {
    const n = parseFloat(amount);
    return isNaN(n) || n <= 0 ? 0 : n;
  }, [amount]);

  const effectivePrice = useMemo(() => {
    if (orderType === "limit" && limitPrice) {
      const p = parseFloat(limitPrice);
      return isNaN(p) || p <= 0 ? currentPrice : p;
    }
    // currentPrice prop is for YES - derive NO price as complement
    const sidePrice = side === "yes" ? currentPrice : (1 - currentPrice);
    return sidePrice;
  }, [orderType, limitPrice, currentPrice, side]);

  // Amount is now in dollars - derive shares from it
  const shares = useMemo(() => {
    if (parsedAmount <= 0 || effectivePrice <= 0) return 0;
    return parsedAmount / effectivePrice;
  }, [parsedAmount, effectivePrice]);

  const summary = useMemo(() => {
    if (parsedAmount <= 0) return null;

    const price = effectivePrice;
    const totalCost = parsedAmount; // User inputs dollars directly
    const maxPayout = shares; // Each share pays $1 if correct
    const potentialProfit = maxPayout - totalCost;

    return {
      price,
      shares,
      totalCost,
      maxPayout,
      potentialProfit,
    };
  }, [parsedAmount, effectivePrice, shares]);

  // --- Handlers ---
  const handleAmountChange = useCallback((value: string) => {
    if (isValidDecimalInput(value)) {
      setAmount(value);
      setTradeError(null);
    }
  }, []);

  const handleLimitPriceChange = useCallback(
    (value: string) => {
      if (isValidPriceInput(value, decimalPlaces)) {
        setLimitPrice(value);
        setTradeError(null);
      }
    },
    [decimalPlaces]
  );

  const handleQuickAmount = useCallback(
    (dollarAmount: number) => {
      setAmount(dollarAmount.toString());
      setTradeError(null);
    },
    []
  );

  const handleSubmit = useCallback(async () => {
    if (!activeTokenId || shares <= 0) return;

    setTradeError(null);

    // Pre-flight: check USDC.e balance before submitting
    if (publicClient && safeAddress && parsedAmount > 0) {
      try {
        const balance = await publicClient.readContract({
          address: USDC_E_CONTRACT_ADDRESS,
          abi: erc20Abi,
          functionName: "balanceOf",
          args: [safeAddress as `0x${string}`],
        });
        const availableUsd = parseFloat(formatUnits(balance, USDC_E_DECIMALS));
        if (availableUsd < parsedAmount) {
          setTradeError({
            type: "insufficient_balance",
            title: "Insufficient balance",
            message: `You need $${parsedAmount.toFixed(2)} but only have $${availableUsd.toFixed(2)} in your Trading Wallet. Please deposit more funds.`,
            retryable: false,
          });
          return;
        }
      } catch {
        // Balance check is best-effort - if it fails, let the order attempt proceed
      }
    }

    const params: OrderParams = {
      tokenId: activeTokenId,
      size: shares,
      side: "BUY",
      negRisk,
      isMarketOrder: orderType === "market",
      ...(orderType === "limit" && limitPrice
        ? { price: parseFloat(limitPrice) }
        : {}),
    };

    try {
      await submitOrder(params);
      // Reset form on success
      setAmount("");
      setLimitPrice("");
    } catch (err) {
      setTradeError(classifyTradeError(err));
    }
  }, [
    activeTokenId,
    shares,
    negRisk,
    orderType,
    limitPrice,
    submitOrder,
    publicClient,
    safeAddress,
    parsedAmount,
  ]);

  // --- Tab config ---
  const sideTabs = useMemo(
    () => [
      { id: "yes" as const, label: "Buy YES" },
      { id: "no" as const, label: "Buy NO" },
    ],
    []
  );

  // --- Render ---
  const canSubmit =
    parsedAmount > 0 &&
    shares > 0 &&
    !!activeTokenId &&
    isTradingSessionComplete &&
    !isSubmitting &&
    (orderType === "market" || (orderType === "limit" && !!limitPrice));

  return (
    <div
      ref={ref}
      className={cn(
        "w-full",
        // Mobile: pin to bottom with safe-area inset
        "max-md:fixed max-md:bottom-0 max-md:left-0 max-md:right-0 max-md:z-40",
        "max-md:pb-[env(safe-area-inset-bottom)]",
        "max-md:bg-bg max-md:border-t max-md:border-border max-md:shadow-lg"
      )}
    >
      <Card className="p-4 md:p-5">
        {/* Side Tabs */}
        <Tabs tabs={sideTabs} active={side} onChange={(id) => setSide(id as TradeSide)} />

        <div className="mt-4 space-y-4">
          {/* Order Type Buttons */}
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setOrderType("market")}
              className={cn(
                "flex-1 py-2 px-3 text-sm font-medium rounded-lg transition-colors",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-bg",
                orderType === "market"
                  ? "bg-surface-2 text-fg border border-border"
                  : "text-muted hover:text-fg hover:bg-surface-2/50"
              )}
            >
              Market
            </button>
            <button
              type="button"
              onClick={() => setOrderType("limit")}
              className={cn(
                "flex-1 py-2 px-3 text-sm font-medium rounded-lg transition-colors",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-bg",
                orderType === "limit"
                  ? "bg-surface-2 text-fg border border-border"
                  : "text-muted hover:text-fg hover:bg-surface-2/50"
              )}
            >
              Limit
            </button>
          </div>

          {/* Amount Input */}
          <div className="space-y-2">
            <label className="text-sm font-medium text-muted">Amount (USD)</label>
            <div className="relative">
              <span className="absolute left-4 top-1/2 -translate-y-1/2 text-muted font-mono text-lg">$</span>
              <input
                type="text"
                inputMode="decimal"
                value={amount}
                onChange={(e) => handleAmountChange(e.target.value)}
                placeholder="0.00"
                disabled={isSubmitting}
                className={cn(
                  "w-full pl-9 pr-4 py-3 rounded-lg font-mono text-lg",
                  "bg-surface-2 border border-border text-fg placeholder:text-muted",
                  "focus:outline-none focus:ring-2 focus:ring-accent focus:ring-offset-2 focus:ring-offset-bg",
                  "disabled:opacity-50 disabled:cursor-not-allowed"
                )}
                aria-label={`Dollar amount to invest in ${side.toUpperCase()}`}
              />
            </div>

            {/* Quick amount buttons */}
            <div className="flex gap-2">
              {QUICK_AMOUNTS.map((amt) => (
                <button
                  key={amt}
                  type="button"
                  onClick={() => handleQuickAmount(amt)}
                  disabled={isSubmitting}
                  className={cn(
                    "flex-1 py-1.5 text-xs font-medium rounded-md transition-colors",
                    "bg-surface-2 border border-border text-muted hover:text-fg hover:bg-surface-2/80",
                    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent",
                    "disabled:opacity-50 disabled:cursor-not-allowed"
                  )}
                >
                  ${amt}
                </button>
              ))}
            </div>
          </div>

          {/* Limit Price Input (conditional) */}
          {orderType === "limit" && (
            <div className="space-y-2">
              <label className="text-sm font-medium text-muted flex items-center justify-between">
                <span>Limit Price</span>
                {isLoadingTickSize && (
                  <span className="text-xs text-accent animate-pulse">
                    Syncing...
                  </span>
                )}
              </label>
              <input
                type="text"
                inputMode="decimal"
                value={limitPrice}
                onChange={(e) => handleLimitPriceChange(e.target.value)}
                placeholder={tickSize.toFixed(decimalPlaces)}
                disabled={isSubmitting || isLoadingTickSize}
                className={cn(
                  "w-full px-4 py-3 rounded-lg font-mono text-lg",
                  "bg-surface-2 border border-border text-fg placeholder:text-muted",
                  "focus:outline-none focus:ring-2 focus:ring-accent focus:ring-offset-2 focus:ring-offset-bg",
                  "disabled:opacity-50 disabled:cursor-not-allowed"
                )}
                aria-label="Limit price"
              />
              <div className="flex justify-between text-xs text-muted px-1">
                <span>Step: {tickSize.toFixed(decimalPlaces)}</span>
                <span>Max: {(1 - tickSize).toFixed(decimalPlaces)}</span>
              </div>
            </div>
          )}

          {/* Summary Row */}
          {summary && (
            <div className="space-y-2 p-3 rounded-lg bg-surface-2 border border-border">
              <div className="flex justify-between text-sm">
                <span className="text-muted">Price per share</span>
                <span className="text-fg font-mono">
                  {Math.round(summary.price * 100)}¢
                </span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-muted">Est. shares</span>
                <span className="text-fg font-mono">
                  {summary.shares.toFixed(2)}
                </span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-muted">You invest</span>
                <span className="text-fg font-mono">
                  {formatCurrency(summary.totalCost)}
                </span>
              </div>
              <div className="h-px bg-border" />
              <div className="flex justify-between text-sm font-medium">
                <span className="text-muted">Potential return</span>
                <span className="text-yes font-mono">
                  {formatCurrency(summary.maxPayout)} (+{formatCurrency(summary.potentialProfit)})
                </span>
              </div>
            </div>
          )}

          {/* Error UI */}
          {tradeError && <TradeErrorDisplay error={tradeError} />}

          {/* Submit Button */}
          <Button
            variant={side === "yes" ? "yes" : "no"}
            size="lg"
            className="w-full"
            loading={isSubmitting}
            disabled={!canSubmit}
            onClick={handleSubmit}
            aria-label={`Buy ${side.toUpperCase()} shares`}
          >
            {isSubmitting ? "Submitting..." : `Buy ${side.toUpperCase()}`}
          </Button>

          {/* Trading session not ready */}
          {!isTradingSessionComplete && (
            <p className="text-xs text-muted text-center">
              Initializing trading session...
            </p>
          )}
        </div>
      </Card>
    </div>
  );
});

// --- Error Display Component ---

function TradeErrorDisplay({ error }: { error: TradeError }) {
  return (
    <div
      className={cn(
        "flex items-start gap-3 p-3 rounded-lg border",
        error.type === "sl_tp_failed"
          ? "bg-warning/5 border-warning/20 text-warning"
          : "bg-no/5 border-no/20 text-no"
      )}
      role="alert"
    >
      <AlertCircle className="h-5 w-5 shrink-0 mt-0.5" aria-hidden="true" />
      <div className="flex-1 space-y-1">
        <p className="text-sm font-medium">{error.title}</p>
        <p className="text-xs text-muted">{error.message}</p>
        {error.action && (
          <a
            href={error.action.href}
            className="inline-flex items-center gap-1 text-xs font-medium text-accent hover:underline"
          >
            {error.action.label}
            <ArrowUpRight className="h-3 w-3" aria-hidden="true" />
          </a>
        )}
      </div>
    </div>
  );
}

export default TradeExecution;
