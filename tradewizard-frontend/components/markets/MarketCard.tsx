'use client';

import Link from 'next/link';
import Image from 'next/image';
import { Lock } from 'lucide-react';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { ProbabilityBar } from '@/components/ui/ProbabilityBar';
import { TierGate } from '@/components/ui/TierGate';
import { cn } from '@/utils/classNames';

export interface MarketCardMarket {
  slug: string;
  title: string;
  image?: string;
  category: string;
  volume: string;
  endDate: string;
  yesProbability: number; // cents 0–100
}

export interface MarketCardProps {
  market: MarketCardMarket;
  onBuyYes?: () => void;
  onBuyNo?: () => void;
  className?: string;
}

export function MarketCard({ market, onBuyYes, onBuyNo, className }: MarketCardProps) {
  const noProbability = 100 - market.yesProbability;

  return (
    <Card className={cn('group relative flex flex-col gap-3 p-5 transition-[border-color] duration-150 hover:border-muted', className)}>
      <Link
        href={`/markets/${market.slug}`}
        className="absolute inset-0 z-0 rounded-[12px]"
        aria-label={`View market: ${market.title}`}
      />

      {/* Header: thumbnail + title */}
      <div className="relative z-10 flex items-start gap-3">
        <div className="relative h-12 w-12 flex-shrink-0 overflow-hidden rounded-lg">
          {market.image ? (
            <Image
              src={market.image}
              alt=""
              fill
              className="object-cover"
              sizes="48px"
            />
          ) : (
            <div className="flex h-full w-full items-center justify-center bg-surface-2 text-muted text-lg">
              📊
            </div>
          )}
        </div>
        <h3 className="flex-1 text-[15px] font-semibold leading-snug text-fg line-clamp-2">
          {market.title}
        </h3>
      </div>

      {/* Meta: category, volume, end date */}
      <div className="relative z-10 flex gap-4 text-xs text-muted">
        <span>{market.category}</span>
        <span>{market.volume} vol</span>
        <span>Ends {market.endDate}</span>
      </div>

      {/* Probability bar + value */}
      <div className="relative z-10 flex items-center gap-3">
        <ProbabilityBar cents={market.yesProbability} variant="thick" className="flex-1" />
        <span className="min-w-[3.5rem] text-right font-mono text-lg font-bold text-yes tabular-nums">
          {market.yesProbability}¢
        </span>
      </div>

      {/* Buy YES / Buy NO buttons */}
      <div className="relative z-10 flex gap-2">
        <Button
          variant="yes"
          size="sm"
          className="flex-1 bg-yes/12 text-yes hover:bg-yes/20"
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            onBuyYes?.();
          }}
          aria-label={`Buy YES at ${market.yesProbability} cents for ${market.title}`}
        >
          Yes {market.yesProbability}¢
        </Button>
        <Button
          variant="no"
          size="sm"
          className="flex-1 bg-no/12 text-no hover:bg-no/20"
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            onBuyNo?.();
          }}
          aria-label={`Buy NO at ${noProbability} cents for ${market.title}`}
        >
          No {noProbability}¢
        </Button>
      </div>

      {/* TierGate: recurring analysis row */}
      <div className="relative z-10">
        <TierGate plan="starter" feature="Recurring analysis" showLocked={true}>
          <div className="flex items-center gap-2 pt-1 text-[11px] text-muted">
            <Lock className="h-3 w-3 opacity-60" />
            <span>Recurring analysis</span>
            <span>·</span>
            <Link
              href="/account/subscription"
              className="font-medium text-accent hover:underline"
              onClick={(e) => e.stopPropagation()}
            >
              Upgrade to Starter+
            </Link>
          </div>
        </TierGate>
      </div>
    </Card>
  );
}
