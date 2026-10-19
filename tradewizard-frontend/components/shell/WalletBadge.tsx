'use client';

import { useState, useRef, useEffect, useMemo } from 'react';
import { Wallet, Check } from 'lucide-react';
import { useWallet } from '@/providers/WalletContext';
import usePolygonBalances from '@/hooks/usePolygonBalances';
import useSafeDeployment from '@/hooks/useSafeDeployment';
import useAddressCopy from '@/hooks/useAddressCopy';
import { usePortfolioSessions } from '@/hooks/usePortfolioSessions';
import { cn } from '@/utils/classNames';

/**
 * WalletBadge - shows abbreviated wallet address in the nav.
 * Hover reveals a detail panel with total balance, committed capital, and available.
 */
export function WalletBadge() {
  const { eoaAddress, isConnected } = useWallet();
  const { derivedSafeAddressFromEoa } = useSafeDeployment(eoaAddress);

  // Display the Safe (trading) wallet address - this is the user's actual Polymarket wallet
  const displayAddress = derivedSafeAddressFromEoa ?? eoaAddress;

  // Query balance for the Safe wallet (the trading wallet), not the EOA
  const { usdcBalance } = usePolygonBalances(displayAddress);
  const { data: sessionsData } = usePortfolioSessions();
  const { copied, copyAddress } = useAddressCopy(displayAddress ?? null);

  const [isHovered, setIsHovered] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Committed capital = sum of investmentAmount across active sessions
  const committedCapital = useMemo(() => {
    if (!sessionsData?.sessions) return 0;
    return sessionsData.sessions
      .filter((s) => s.status === 'active' || s.status === 'paused')
      .reduce((sum, s) => sum + s.investmentAmount, 0);
  }, [sessionsData]);

  const available = Math.max(0, usdcBalance - committedCapital);

  const handleMouseEnter = () => {
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    setIsHovered(true);
  };

  const handleMouseLeave = () => {
    timeoutRef.current = setTimeout(() => setIsHovered(false), 200);
  };

  useEffect(() => {
    return () => {
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
    };
  }, []);

  if (!isConnected || !eoaAddress) return null;

  const abbreviated = displayAddress
    ? `${displayAddress.slice(0, 6)}…${displayAddress.slice(-4)}`
    : `${eoaAddress.slice(0, 6)}…${eoaAddress.slice(-4)}`;

  return (
    <div
      className="relative"
      ref={panelRef}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
    >
      {/* Trigger */}
      <button
        onClick={copyAddress}
        className={cn(
          'flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-mono',
          'border transition-colors duration-150',
          'bg-surface-2 border-border text-muted hover:text-fg hover:border-accent/40',
          copied && 'border-yes/40 text-yes'
        )}
        aria-label={copied ? 'Address copied' : `Copy wallet address ${abbreviated}`}
      >
        {copied ? (
          <Check className="w-3.5 h-3.5" aria-hidden="true" />
        ) : (
          <Wallet className="w-3.5 h-3.5" aria-hidden="true" />
        )}
        <span>{copied ? 'Copied' : abbreviated}</span>
      </button>

      {/* Hover panel */}
      {isHovered && (
        <div
          className={cn(
            'absolute right-0 top-full mt-2 w-56 z-50',
            'bg-surface border border-border rounded-xl p-4 shadow-lg',
            'animate-in fade-in-0 slide-in-from-top-1 duration-150'
          )}
        >
          <h4 className="text-xs font-medium text-muted uppercase tracking-wider mb-3">
            Wallet
          </h4>
          <div className="space-y-2">
            <Row label="Total Balance" value={`$${usdcBalance.toFixed(2)}`} />
            <Row
              label="Committed"
              value={`$${committedCapital.toFixed(2)}`}
              tone="warning"
            />
            <Row
              label="Available"
              value={`$${available.toFixed(2)}`}
              tone="yes"
            />
          </div>
        </div>
      )}
    </div>
  );
}

function Row({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: 'yes' | 'warning';
}) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-xs text-muted">{label}</span>
      <span
        className={cn(
          'text-xs font-mono font-medium',
          tone === 'yes' && 'text-yes',
          tone === 'warning' && 'text-warning',
          !tone && 'text-fg'
        )}
      >
        {value}
      </span>
    </div>
  );
}
