'use client';

import {
  useState,
  useCallback,
  useMemo,
  useEffect,
  forwardRef,
  type ForwardedRef,
} from 'react';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Tabs } from '@/components/ui/Tabs';
import { Toggle } from '@/components/ui/Toggle';
import { useTrading } from '@/providers/TradingProvider';
import { useWallet } from '@/providers/WalletContext';
import useClobOrder, { type OrderParams } from '@/hooks/useClobOrder';
import useTickSize from '@/hooks/useTickSize';
import useUserPositions from '@/hooks/useUserPositions';
import { useQuery } from '@tanstack/react-query';
import { useMarketAnalysis } from '@/hooks/useMarketAnalysis';
import { classifyTradeError, createSlTpFailedError, type TradeError } from '@/utils/trade-errors';
import { formatCurrency } from '@/utils/formatting';
import { isValidDecimalInput } from '@/utils/validation';
import { cn } from '@/utils/classNames';
import { AlertCircle, ArrowUpRight, Sparkles } from 'lucide-react';
import { USDC_E_CONTRACT_ADDRESS, USDC_E_DECIMALS } from '@/constants/tokens';
import { erc20Abi, formatUnits } from 'viem';

// --- Types ---

export type TradeSide = 'yes' | 'no';
type OrderType = 'market' | 'limit';
type TradeAction = 'buy' | 'sell';

export interface TradePanelProps {
  /** Market slug used to fetch token IDs and price data */
  slug: string;
  /** Pre-selected side from quick-buy (null = no pre-selection) */
  initialSide: TradeSide | null;
  /** When true, renders without the Card wrapper (for use inside modals) */
  embedded?: boolean;
}

// --- Validation ---

const isValidPriceInput = (value: string, maxDecimals: number): boolean => {
  if (value === '' || value === '0' || value === '0.') return true;
  const regex = new RegExp(`^(0?\\.[0-9]{0,${maxDecimals}}|0)$`);
  return regex.test(value);
};

const QUICK_AMOUNTS = [10, 25, 50, 100];

// --- Component ---

export const TradePanel = forwardRef(function TradePanel(
  { slug, initialSide, embedded = false }: TradePanelProps,
  ref: ForwardedRef<HTMLDivElement>
) {
  // --- State ---
  const [side, setSide] = useState<TradeSide>(initialSide ?? 'yes');
  const [tradeAction, setTradeAction] = useState<TradeAction>('buy');
  const [orderType, setOrderType] = useState<OrderType>('market');
  const [amount, setAmount] = useState('');
  const [limitPrice, setLimitPrice] = useState('');
  const [tradeError, setTradeError] = useState<TradeError | null>(null);

  // Sync side when initialSide changes (quick-buy scroll)
  useEffect(() => {
    if (initialSide) {
      setSide(initialSide);
    }
  }, [initialSide]);

  // Clear amount when switching between buy/sell (units change: USD vs shares)
  useEffect(() => {
    setAmount('');
    setTradeError(null);
  }, [tradeAction]);

  // --- Hooks ---
  const { clobClient, secureClient, safeAddress, isTradingSessionComplete } = useTrading();
  const { publicClient } = useWallet();

  // Fetch market data to get token IDs and current price
  const { data: marketData } = useQuery({
    queryKey: ['market-trade-data', slug],
    queryFn: async () => {
      const res = await fetch(`/api/polymarket/market-by-slug?slug=${slug}`);
      if (!res.ok) return null;
      return res.json();
    },
    enabled: !!slug,
    staleTime: 30_000,
  });

  // Extract token IDs from market data
  const tokenIds = useMemo(() => {
    if (!marketData?.clobTokenIds) return { yes: '', no: '' };
    try {
      const ids = JSON.parse(marketData.clobTokenIds);
      return { yes: ids[0] ?? '', no: ids[1] ?? '' };
    } catch {
      return { yes: '', no: '' };
    }
  }, [marketData]);

  // Get current prices for both sides from market data
  const prices = useMemo(() => {
    if (!marketData?.outcomePrices) return { yes: 0.5, no: 0.5 };
    try {
      const parsed = JSON.parse(marketData.outcomePrices);
      const yesPrice = parseFloat(parsed[0]) || 0.5;
      const noPrice = parseFloat(parsed[1]) || (1 - yesPrice);
      return { yes: yesPrice, no: noPrice };
    } catch {
      return { yes: 0.5, no: 0.5 };
    }
  }, [marketData]);

  // Use the price for the currently selected side
  const currentPrice = side === 'yes' ? prices.yes : prices.no;

  const negRisk = marketData?.negRisk ?? false;

  const { submitOrder, isSubmitting } = useClobOrder(clobClient, safeAddress, secureClient);

  // Fetch user's positions to show token balance for sell mode
  const { data: positions } = useUserPositions(safeAddress ?? undefined);
  const conditionId = marketData?.conditionId || null;

  // Get the user's token balance for the currently selected side
  const tokenBalance = useMemo(() => {
    if (!positions || !conditionId) return 0;
    const position = positions.find(
      (p) => p.conditionId === conditionId && p.outcome.toLowerCase() === side
    );
    return position?.size ?? 0;
  }, [positions, conditionId, side]);

  // Fetch AI analysis for this market (provides SL/TP zones)
  const marketId = marketData?.conditionId || marketData?.id || null;
  const { data: analysis } = useMarketAnalysis(marketId);

  // AI Trade: available when analysis has a directional recommendation (regardless of selected side)
  const aiAvailable = useMemo(() => {
    if (!analysis) return null;
    if (analysis.action === 'NO_TRADE') return null;
    if (!analysis.entryZone || !analysis.targetZone || !analysis.stopLoss) return null;
    return {
      action: analysis.action,
      entryZone: analysis.entryZone,
      targetZone: analysis.targetZone,
      stopLoss: analysis.stopLoss,
    };
  }, [analysis]);

  const [aiTradeEnabled, setAiTradeEnabled] = useState(true);
  const [aiTakeProfit, setAiTakeProfit] = useState('');
  const [aiStopLoss, setAiStopLoss] = useState('');
  const [aiInitialized, setAiInitialized] = useState(false);

  // Initialize TP/SL from recommendation only once (not on every side switch)
  useEffect(() => {
    if (aiAvailable && !aiInitialized) {
      const tp = ((aiAvailable.targetZone[0] + aiAvailable.targetZone[1]) / 2) * 100;
      const sl = aiAvailable.stopLoss * 100;
      setAiTakeProfit(Math.round(tp).toString());
      setAiStopLoss(Math.round(sl).toString());
      setAiInitialized(true);
    }
  }, [aiAvailable, aiInitialized]);

  // When AI Trade is enabled AND user is on the recommended side, force market order type.
  // On the opposite side, allow limit orders freely.
  const isOnAiRecommendedSide = aiAvailable != null && (
    (aiAvailable.action === 'LONG_YES' && side === 'yes') ||
    (aiAvailable.action === 'LONG_NO' && side === 'no')
  );
  const limitDisabledByAi = aiTradeEnabled && isOnAiRecommendedSide;

  useEffect(() => {
    if (aiTradeEnabled && isOnAiRecommendedSide) {
      setOrderType('market');
    }
  }, [aiTradeEnabled, isOnAiRecommendedSide]);

  // Disable toggle only if no analysis at all
  useEffect(() => {
    if (!aiAvailable) setAiTradeEnabled(false);
  }, [aiAvailable]);

  // Validation: SL must be less than current price, TP must be greater than current price
  const aiSlError = useMemo(() => {
    if (!aiTradeEnabled || !aiStopLoss) return null;
    const sl = parseFloat(aiStopLoss) / 100;
    if (sl >= currentPrice) return 'SL must be below current price';
    return null;
  }, [aiTradeEnabled, aiStopLoss, currentPrice]);

  const aiTpError = useMemo(() => {
    if (!aiTradeEnabled || !aiTakeProfit) return null;
    const tp = parseFloat(aiTakeProfit) / 100;
    if (tp <= currentPrice) return 'TP must be above current price';
    return null;
  }, [aiTradeEnabled, aiTakeProfit, currentPrice]);

  const activeTokenId = side === 'yes' ? tokenIds.yes : tokenIds.no;
  const { tickSize, isLoading: isLoadingTickSize } = useTickSize(
    activeTokenId || null
  );

  // --- Derived values ---
  const decimalPlaces = useMemo(() => {
    if (!tickSize || tickSize <= 0) return 2;
    const str = tickSize.toString();
    const dotIndex = str.indexOf('.');
    return dotIndex === -1 ? 0 : str.length - dotIndex - 1;
  }, [tickSize]);

  const parsedAmount = useMemo(() => {
    const n = parseFloat(amount);
    return isNaN(n) || n <= 0 ? 0 : n;
  }, [amount]);

  const effectivePrice = useMemo(() => {
    if (orderType === 'limit' && limitPrice) {
      const p = parseFloat(limitPrice);
      return isNaN(p) || p <= 0 ? currentPrice : p;
    }
    return currentPrice;
  }, [orderType, limitPrice, currentPrice]);

  // Amount is in dollars for buy, shares for sell - derive the counterpart
  const shares = useMemo(() => {
    if (parsedAmount <= 0 || effectivePrice <= 0) return 0;
    if (tradeAction === 'sell') return parsedAmount; // User entered shares directly
    return parsedAmount / effectivePrice; // Buy: USD → shares
  }, [parsedAmount, effectivePrice, tradeAction]);

  // For sell: USD value the user will receive
  const sellValue = useMemo(() => {
    if (tradeAction !== 'sell' || parsedAmount <= 0 || effectivePrice <= 0) return 0;
    return parsedAmount * effectivePrice;
  }, [tradeAction, parsedAmount, effectivePrice]);

  const summary = useMemo(() => {
    if (parsedAmount <= 0) return null;

    const price = effectivePrice;

    if (tradeAction === 'sell') {
      const totalReceived = sellValue;
      return {
        price,
        shares: parsedAmount,
        totalCost: totalReceived, // repurposed as "total received" for sell
        maxPayout: 0,
        potentialProfit: 0,
        isSell: true,
        totalReceived,
      };
    }

    const totalCost = parsedAmount; // User inputs dollars directly
    const maxPayout = shares; // Each share pays $1 if correct
    const potentialProfit = maxPayout - totalCost;

    return {
      price,
      shares,
      totalCost,
      maxPayout,
      potentialProfit,
      isSell: false,
      totalReceived: 0,
    };
  }, [parsedAmount, effectivePrice, shares, tradeAction, sellValue]);

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

    // Pre-flight: check USDC.e balance before submitting (buy orders only)
    if (tradeAction === 'buy' && publicClient && safeAddress && parsedAmount > 0) {
      try {
        const balance = await publicClient.readContract({
          address: USDC_E_CONTRACT_ADDRESS,
          abi: erc20Abi,
          functionName: 'balanceOf',
          args: [safeAddress as `0x${string}`],
        });
        const availableUsd = parseFloat(formatUnits(balance, USDC_E_DECIMALS));
        if (availableUsd < parsedAmount) {
          setTradeError({
            type: 'insufficient_balance',
            title: 'Insufficient balance',
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
      side: tradeAction === 'buy' ? 'BUY' : 'SELL',
      negRisk,
      isMarketOrder: orderType === 'market',
      ...(orderType === 'limit' && limitPrice
        ? { price: parseFloat(limitPrice) }
        : {}),
    };

    try {
      await submitOrder(params);

      // If buying with AI Trade enabled and user is on the recommended side, place take-profit and stop-loss SELL limit orders
      if (tradeAction === 'buy' && aiTradeEnabled && aiAvailable && isOnAiRecommendedSide) {
        const targetPrice = parseFloat(aiTakeProfit) / 100;
        const stopPrice = parseFloat(aiStopLoss) / 100;
        let tpFailed = false;
        let slFailed = false;

        // Take-profit: SELL at target price
        if (targetPrice > 0 && targetPrice < 1) {
          try {
            await submitOrder({
              tokenId: activeTokenId,
              size: shares,
              price: targetPrice,
              side: 'SELL',
              negRisk,
              isMarketOrder: false,
            });
          } catch {
            tpFailed = true;
          }
        }

        // Stop-loss: SELL at stop-loss price
        if (stopPrice > 0 && stopPrice < 1) {
          try {
            await submitOrder({
              tokenId: activeTokenId,
              size: shares,
              price: stopPrice,
              side: 'SELL',
              negRisk,
              isMarketOrder: false,
            });
          } catch {
            slFailed = true;
          }
        }

        // Notify user if SL/TP orders failed (buy was successful)
        if (tpFailed || slFailed) {
          const failedType = tpFailed && slFailed ? 'both' : tpFailed ? 'take-profit' : 'stop-loss';
          setTradeError(createSlTpFailedError(failedType));
        }
      }

      // Reset form on success
      setAmount('');
      setLimitPrice('');
    } catch (err) {
      setTradeError(classifyTradeError(err));
    }
  }, [activeTokenId, shares, negRisk, orderType, limitPrice, submitOrder, tradeAction, aiTradeEnabled, aiAvailable, isOnAiRecommendedSide, publicClient, safeAddress, parsedAmount]);

  // --- Tab config ---
  const sideTabs = useMemo(
    () => tradeAction === 'buy'
      ? [
          { id: 'yes' as const, label: 'Buy YES' },
          { id: 'no' as const, label: 'Buy NO' },
        ]
      : [
          { id: 'yes' as const, label: 'Sell YES' },
          { id: 'no' as const, label: 'Sell NO' },
        ],
    [tradeAction]
  );

  // --- Render ---
  const canSubmit =
    parsedAmount > 0 &&
    shares > 0 &&
    !!activeTokenId &&
    isTradingSessionComplete &&
    !isSubmitting &&
    (orderType === 'market' || (orderType === 'limit' && !!limitPrice)) &&
    (tradeAction === 'buy' || (tradeAction === 'sell' && tokenBalance > 0 && parsedAmount <= tokenBalance)) &&
    (!aiTradeEnabled || !isOnAiRecommendedSide || (!aiSlError && !aiTpError));

  const tradeContent = (
    <>
      {/* Order Type Buttons: Market / Limit */}
      <div className="flex gap-2">
        <button
          type="button"
          onClick={() => setOrderType('market')}
          className={cn(
            'flex-1 py-1.5 px-3 text-sm font-medium rounded-lg transition-colors',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-bg',
            orderType === 'market'
              ? 'bg-surface-2 text-fg border border-border'
              : 'text-muted hover:text-fg hover:bg-surface-2/50'
          )}
        >
          Market
        </button>
        <button
          type="button"
          onClick={() => !limitDisabledByAi && setOrderType('limit')}
          disabled={limitDisabledByAi}
          className={cn(
            'flex-1 py-1.5 px-3 text-sm font-medium rounded-lg transition-colors',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-bg',
            limitDisabledByAi
              ? 'opacity-40 cursor-not-allowed text-muted'
              : orderType === 'limit'
                ? 'bg-surface-2 text-fg border border-border'
                : 'text-muted hover:text-fg hover:bg-surface-2/50'
          )}
        >
          Limit
        </button>
      </div>

      {/* Amount Input */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <label className="text-sm font-medium text-muted">
            {tradeAction === 'sell' ? 'Shares to sell' : 'Amount (USD)'}
          </label>
          {tradeAction === 'sell' && (
            <span className="text-xs text-muted">
              Balance:{' '}
              <span className={cn('font-mono font-medium', tokenBalance > 0 ? 'text-fg' : 'text-no')}>
                {tokenBalance > 0 ? tokenBalance.toFixed(2) : '0'}
              </span>
              {' '}shares
            </span>
          )}
        </div>
        <div className="relative">
          {tradeAction === 'buy' && (
            <span className="absolute left-4 top-1/2 -translate-y-1/2 text-muted font-mono text-lg">$</span>
          )}
          <input
            type="text"
            inputMode="decimal"
            value={amount}
            onChange={(e) => handleAmountChange(e.target.value)}
            placeholder={tradeAction === 'sell' ? '0' : '0.00'}
            disabled={isSubmitting || (tradeAction === 'sell' && tokenBalance <= 0)}
            className={cn(
              'w-full pr-4 py-2.5 rounded-lg font-mono text-lg',
              tradeAction === 'buy' ? 'pl-9' : 'pl-4',
              'bg-surface-2 border border-border text-fg placeholder:text-muted',
              'focus:outline-none focus:ring-2 focus:ring-accent focus:ring-offset-2 focus:ring-offset-bg',
              'disabled:opacity-50 disabled:cursor-not-allowed'
            )}
            aria-label={tradeAction === 'sell' ? `Number of ${side.toUpperCase()} shares to sell` : `Dollar amount to invest in ${side.toUpperCase()}`}
          />
        </div>

        {/* Sell: show estimated USD received */}
        {tradeAction === 'sell' && parsedAmount > 0 && (
          <p className="text-xs text-muted">
            ≈ <span className="font-mono text-fg">${sellValue.toFixed(2)}</span> at current price
          </p>
        )}

        {/* Quick amount buttons (buy) / Quick sell presets (sell) */}
        <div className="flex gap-2">
          {tradeAction === 'buy' ? (
            QUICK_AMOUNTS.map((amt) => (
              <button
                key={amt}
                type="button"
                onClick={() => handleQuickAmount(amt)}
                disabled={isSubmitting}
                className={cn(
                  'flex-1 py-1.5 text-xs font-medium rounded-md transition-colors',
                  'bg-surface-2 border border-border text-muted hover:text-fg hover:bg-surface-2/80',
                  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent',
                  'disabled:opacity-50 disabled:cursor-not-allowed'
                )}
              >
                ${amt}
              </button>
            ))
          ) : (
            // Sell mode: percentage quick-sell buttons (set shares directly)
            [25, 50, 75, 100].map((pct) => (
              <button
                key={pct}
                type="button"
                onClick={() => {
                  if (tokenBalance > 0) {
                    const sellShares = tokenBalance * (pct / 100);
                    // Round to 2 decimal places
                    const rounded = Math.round(sellShares * 100) / 100;
                    setAmount(rounded.toString());
                    setTradeError(null);
                  }
                }}
                disabled={isSubmitting || tokenBalance <= 0}
                className={cn(
                  'flex-1 py-1.5 text-xs font-medium rounded-md transition-colors',
                  'bg-surface-2 border border-border text-muted hover:text-fg hover:bg-surface-2/80',
                  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent',
                  'disabled:opacity-50 disabled:cursor-not-allowed'
                )}
              >
                {pct}%
              </button>
            ))
          )}
        </div>

        {/* No balance warning for sell mode */}
        {tradeAction === 'sell' && tokenBalance <= 0 && (
          <p className="text-xs text-no flex items-center gap-1.5">
            <AlertCircle className="h-3 w-3" />
            You don&apos;t hold any {side.toUpperCase()} tokens on this market
          </p>
        )}
        {tradeAction === 'sell' && tokenBalance > 0 && parsedAmount > tokenBalance && (
          <p className="text-xs text-no flex items-center gap-1.5">
            <AlertCircle className="h-3 w-3" />
            Exceeds your balance of {tokenBalance.toFixed(2)} shares
          </p>
        )}
      </div>

      {/* AI Trade Toggle - shown only when buying on the recommended side */}
      {tradeAction === 'buy' && aiAvailable && (
        (aiAvailable.action === 'LONG_YES' && side === 'yes') ||
        (aiAvailable.action === 'LONG_NO' && side === 'no')
      ) && (
        <div className={cn(
          'rounded-lg border p-3',
          aiTradeEnabled ? 'border-ai/40 bg-ai/[0.06]' : 'border-border bg-surface-2/50'
        )}>
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2 min-w-0">
              <Sparkles className="w-4 h-4 text-ai shrink-0" />
              <span className="text-[0.8125rem] font-medium truncate">AI Trade</span>
            </div>
            <Toggle
              checked={aiTradeEnabled}
              onChange={setAiTradeEnabled}
            />
          </div>
          {aiTradeEnabled && (
            <div className="mt-2.5 grid grid-cols-2 gap-2 text-[0.75rem]">
              <div className="rounded-md bg-yes/10 border border-yes/20 px-2.5 py-1.5">
                <label className="text-muted block text-[0.65rem] uppercase tracking-wide mb-1">Take Profit</label>
                <div className="flex items-center gap-1">
                  <input
                    type="text"
                    inputMode="numeric"
                    value={aiTakeProfit}
                    onChange={(e) => {
                      const v = e.target.value.replace(/[^0-9]/g, '');
                      if (v === '' || (parseInt(v) >= 0 && parseInt(v) <= 99)) setAiTakeProfit(v);
                    }}
                    className="w-full bg-transparent font-mono font-semibold text-yes text-sm outline-none placeholder:text-yes/40"
                    placeholder="0"
                  />
                  <span className="text-yes/60 font-mono text-xs shrink-0">¢</span>
                </div>
              </div>
              <div className="rounded-md bg-no/10 border border-no/20 px-2.5 py-1.5">
                <label className="text-muted block text-[0.65rem] uppercase tracking-wide mb-1">Stop Loss</label>
                <div className="flex items-center gap-1">
                  <input
                    type="text"
                    inputMode="numeric"
                    value={aiStopLoss}
                    onChange={(e) => {
                      const v = e.target.value.replace(/[^0-9]/g, '');
                      if (v === '' || (parseInt(v) >= 0 && parseInt(v) <= 99)) setAiStopLoss(v);
                    }}
                    className="w-full bg-transparent font-mono font-semibold text-no text-sm outline-none placeholder:text-no/40"
                    placeholder="0"
                  />
                  <span className="text-no/60 font-mono text-xs shrink-0">¢</span>
                </div>
              </div>
            </div>
          )}
          {(aiTpError || aiSlError) && (
            <p className="mt-2 text-[0.7rem] text-no">
              {aiTpError || aiSlError}
            </p>
          )}
        </div>
      )}

      {/* Limit Price Input (shown only when order type is Limit) */}
      {orderType === 'limit' && (
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
              'w-full px-4 py-2.5 rounded-lg font-mono text-lg',
              'bg-surface-2 border border-border text-fg placeholder:text-muted',
              'focus:outline-none focus:ring-2 focus:ring-accent focus:ring-offset-2 focus:ring-offset-bg',
              'disabled:opacity-50 disabled:cursor-not-allowed'
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
        <div className="space-y-1.5 p-2.5 rounded-lg bg-surface-2 border border-border text-[13px]">
          <div className="flex justify-between">
            <span className="text-muted">Price per share</span>
            <span className="text-fg font-mono">
              {Math.round(summary.price * 100)}¢
            </span>
          </div>
          {summary.isSell ? (
            <>
              <div className="flex justify-between">
                <span className="text-muted">Shares to sell</span>
                <span className="text-fg font-mono">
                  {summary.shares.toFixed(2)}
                </span>
              </div>
              <div className="h-px bg-border" />
              <div className="flex justify-between font-medium">
                <span className="text-muted">You receive</span>
                <span className="text-yes font-mono">
                  ≈ {formatCurrency(summary.totalReceived)}
                </span>
              </div>
            </>
          ) : (
            <>
              <div className="flex justify-between">
                <span className="text-muted">Est. shares</span>
                <span className="text-fg font-mono">
                  {summary.shares.toFixed(2)}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted">You invest</span>
                <span className="text-fg font-mono">
                  {formatCurrency(summary.totalCost)}
                </span>
              </div>
              <div className="h-px bg-border" />
              {aiTradeEnabled && aiTakeProfit && aiStopLoss && aiAvailable && (
                (aiAvailable.action === 'LONG_YES' && side === 'yes') ||
                (aiAvailable.action === 'LONG_NO' && side === 'no')
              ) ? (
                <>
                  <div className="flex justify-between font-medium">
                    <span className="text-muted">If TP hit</span>
                    <span className="text-yes font-mono">
                      +{formatCurrency(summary.shares * ((parseFloat(aiTakeProfit) / 100) - summary.price))}
                    </span>
                  </div>
                  <div className="flex justify-between font-medium">
                    <span className="text-muted">If SL hit</span>
                    <span className="text-no font-mono">
                      {formatCurrency(summary.shares * ((parseFloat(aiStopLoss) / 100) - summary.price))}
                    </span>
                  </div>
                </>
              ) : (
                <div className="flex justify-between font-medium">
                  <span className="text-muted">Potential return</span>
                  <span className="text-yes font-mono">
                    {formatCurrency(summary.maxPayout)} (+{formatCurrency(summary.potentialProfit)})
                  </span>
                </div>
              )}
            </>
          )}
        </div>
      )}

      {/* Error UI */}
      {tradeError && <TradeErrorDisplay error={tradeError} />}

      {/* Submit Button */}
      <Button
        variant={tradeAction === 'sell' ? 'danger' : side === 'yes' ? 'yes' : 'no'}
        size="lg"
        className="w-full"
        loading={isSubmitting}
        disabled={!canSubmit}
        onClick={handleSubmit}
        aria-label={`${tradeAction === 'buy' ? 'Buy' : 'Sell'} ${side.toUpperCase()} shares${tradeAction === 'buy' && aiTradeEnabled && ((aiAvailable?.action === 'LONG_YES' && side === 'yes') || (aiAvailable?.action === 'LONG_NO' && side === 'no')) ? ' with AI stop-loss and take-profit' : ''}`}
      >
        {isSubmitting
          ? 'Submitting...'
          : tradeAction === 'buy' && aiTradeEnabled && ((aiAvailable?.action === 'LONG_YES' && side === 'yes') || (aiAvailable?.action === 'LONG_NO' && side === 'no'))
            ? `Buy ${side.toUpperCase()} + SL/TP`
            : `${tradeAction === 'buy' ? 'Buy' : 'Sell'} ${side.toUpperCase()}`}
      </Button>

      {/* Trading session not ready */}
      {!isTradingSessionComplete && (
        <p className="text-xs text-muted text-center">
          Initializing trading session...
        </p>
      )}
    </>
  );

  return (
    <div
      ref={ref}
      id="trade-panel"
      className="w-full"
    >
      {embedded ? (
        <>
          {/* Buy / Sell Action Toggle */}
          <div className="flex gap-1 mb-3 p-1 bg-surface-2 rounded-lg">
            <button
              type="button"
              onClick={() => setTradeAction('buy')}
              className={cn(
                'flex-1 py-1.5 text-sm font-medium rounded-md transition-colors',
                tradeAction === 'buy'
                  ? 'bg-yes/15 text-yes border border-yes/30'
                  : 'text-muted hover:text-fg'
              )}
            >
              Buy
            </button>
            <button
              type="button"
              onClick={() => setTradeAction('sell')}
              className={cn(
                'flex-1 py-1.5 text-sm font-medium rounded-md transition-colors',
                tradeAction === 'sell'
                  ? 'bg-no/15 text-no border border-no/30'
                  : 'text-muted hover:text-fg'
              )}
            >
              Sell
            </button>
          </div>
          {/* Side Tabs */}
          <Tabs tabs={sideTabs} active={side} onChange={(id) => setSide(id as TradeSide)} />
          <div className="mt-3 space-y-3">
            {tradeContent}
          </div>
        </>
      ) : (
        <Card className="p-4 md:p-5">
          {/* Buy / Sell Action Toggle */}
          <div className="flex gap-1 mb-3 p-1 bg-surface-2 rounded-lg">
            <button
              type="button"
              onClick={() => setTradeAction('buy')}
              className={cn(
                'flex-1 py-1.5 text-sm font-medium rounded-md transition-colors',
                tradeAction === 'buy'
                  ? 'bg-yes/15 text-yes border border-yes/30'
                  : 'text-muted hover:text-fg'
              )}
            >
              Buy
            </button>
            <button
              type="button"
              onClick={() => setTradeAction('sell')}
              className={cn(
                'flex-1 py-1.5 text-sm font-medium rounded-md transition-colors',
                tradeAction === 'sell'
                  ? 'bg-no/15 text-no border border-no/30'
                  : 'text-muted hover:text-fg'
              )}
            >
              Sell
            </button>
          </div>
          {/* Side Tabs */}
          <Tabs tabs={sideTabs} active={side} onChange={(id) => setSide(id as TradeSide)} />
          <div className="mt-4 space-y-4">
            {tradeContent}
          </div>
        </Card>
      )}
    </div>
  );
});

// --- Error Display Component ---

function TradeErrorDisplay({ error }: { error: TradeError }) {
  return (
    <div
      className={cn(
        'flex items-start gap-3 p-3 rounded-lg border',
        error.type === 'sl_tp_failed'
          ? 'bg-warning/5 border-warning/20 text-warning'
          : 'bg-no/5 border-no/20 text-no'
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

export default TradePanel;
