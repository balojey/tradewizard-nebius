'use client';

import { Check, Wallet, AlertCircle } from 'lucide-react';

interface PlanCardProps {
  planId: string;
  name: string;
  price: number;
  credits: string;
  intervals: string[];
  isCurrent: boolean;
  walletBalance: number;
  onSelect: (planId: string) => void;
}

export default function PlanCard({
  planId,
  name,
  price,
  credits,
  intervals,
  isCurrent,
  walletBalance,
  onSelect,
}: PlanCardProps) {
  const isFreePlan = price === 0;
  const isInsufficientBalance = !isFreePlan && walletBalance < price;
  const shortfall = isInsufficientBalance ? price - walletBalance : 0;
  const isDisabled = isCurrent || isInsufficientBalance;

  return (
    <div
      className={`relative rounded-2xl border p-6 flex flex-col gap-4 transition-all duration-200 ${
        isCurrent
          ? 'border-indigo-500 bg-indigo-500/10 ring-2 ring-indigo-500/30'
          : 'border-white/10 bg-white/5 hover:border-white/20'
      }`}
    >
      {isCurrent && (
        <span className="absolute -top-3 left-4 px-3 py-0.5 text-xs font-semibold bg-indigo-500 text-white rounded-full">
          Current Plan
        </span>
      )}

      <div>
        <h3 className="text-lg font-bold text-white">{name}</h3>
        <p className="text-3xl font-bold text-white mt-2">
          {isFreePlan ? (
            'Free'
          ) : (
            <>
              {price} <span className="text-base font-semibold text-indigo-300">USD</span>
              <span className="text-sm font-normal text-gray-400">/mo</span>
            </>
          )}
        </p>
      </div>

      {/* Wallet balance indicator */}
      {!isFreePlan && (
        <div className="flex items-center gap-2 text-xs text-gray-400 bg-white/5 rounded-lg px-3 py-2">
          <Wallet className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
          <span>
            Balance: <span className="text-white font-medium">{walletBalance.toFixed(2)} USD</span>
          </span>
        </div>
      )}

      <div className="flex-1 space-y-3">
        <div className="flex items-center gap-2 text-sm text-gray-300">
          <Check className="w-4 h-4 text-indigo-400 shrink-0" aria-hidden="true" />
          <span>{credits} credits/month</span>
        </div>
        {intervals.map((interval) => (
          <div key={interval} className="flex items-center gap-2 text-sm text-gray-300">
            <Check className="w-4 h-4 text-indigo-400 shrink-0" aria-hidden="true" />
            <span>{interval}</span>
          </div>
        ))}
      </div>

      {/* Shortfall warning with funding prompt (Req 6.4) */}
      {isInsufficientBalance && !isCurrent && (
        <div
          className="flex flex-col gap-1 text-xs text-amber-300 bg-amber-500/10 border border-amber-500/20 rounded-lg px-3 py-2"
          role="alert"
        >
          <div className="flex items-center gap-2">
            <AlertCircle className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
            <span>Need {shortfall.toFixed(2)} more USD</span>
          </div>
          <span className="text-amber-300/70 ml-5.5 pl-[22px]">
            Fund your Trading Wallet to subscribe
          </span>
        </div>
      )}

      <button
        onClick={() => onSelect(planId)}
        disabled={isDisabled}
        aria-label={
          isCurrent
            ? `${name} is your current plan`
            : isInsufficientBalance
              ? `Insufficient balance to subscribe to ${name}`
              : `Subscribe to ${name} plan`
        }
        className={`w-full py-2.5 px-4 rounded-xl text-sm font-semibold transition-all duration-200 ${
          isCurrent
            ? 'bg-white/10 text-gray-400 cursor-not-allowed'
            : isInsufficientBalance
              ? 'bg-white/5 text-gray-500 cursor-not-allowed border border-white/5'
              : 'bg-white text-black hover:bg-gray-200 active:scale-[0.98]'
        }`}
      >
        {isCurrent
          ? 'Current Plan'
          : isInsufficientBalance
            ? 'Insufficient Balance'
            : isFreePlan
              ? 'Downgrade'
              : 'Subscribe'}
      </button>
    </div>
  );
}
