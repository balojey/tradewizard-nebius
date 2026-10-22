'use client';

import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import type { MarketAnalysisResult } from '@/hooks/useMarketAnalysis';

interface AIIntelligencePanelProps {
  marketId: string | null;
  analysis: MarketAnalysisResult | null | undefined;
  onRequestAnalysis: () => void;
  onQuickBuy: (side: 'yes' | 'no') => void;
}

/**
 * AI Intelligence Panel - placeholder.
 * Full implementation in task 6.2: recommendation badge, quick-buy buttons,
 * confidence meter, thesis, edge viz, expandable sections.
 */
export function AIIntelligencePanel({
  analysis,
  onRequestAnalysis,
  onQuickBuy,
}: AIIntelligencePanelProps) {
  return (
    <Card variant="ai" className="p-5">
      <h2 className="text-sm font-semibold uppercase tracking-wider text-ai mb-3">
        AI Intelligence
      </h2>

      {analysis ? (
        <div className="space-y-3">
          {/* Recommendation badge */}
          <div className="flex items-center gap-2">
            <span
              className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-semibold ${
                analysis.action === 'LONG_YES'
                  ? 'bg-yes/15 text-yes'
                  : analysis.action === 'LONG_NO'
                  ? 'bg-no/15 text-no'
                  : 'bg-surface-2 text-muted'
              }`}
            >
              {analysis.action === 'LONG_YES'
                ? 'BUY YES'
                : analysis.action === 'LONG_NO'
                ? 'BUY NO'
                : 'NO TRADE'}
            </span>
            {analysis.metadata?.edge !== undefined && (
              <span className="text-xs text-muted">
                {(() => {
                  const displayEdge = analysis.action === 'LONG_NO'
                    ? -analysis.metadata.edge
                    : analysis.metadata.edge;
                  return `${displayEdge > 0 ? '+' : ''}${(displayEdge * 100).toFixed(1)}¢ edge`;
                })()}
              </span>
            )}
          </div>

          {/* Quick buy buttons */}
          <div className="flex gap-2">
            <Button
              variant="yes"
              size="sm"
              className="flex-1"
              onClick={() => onQuickBuy('yes')}
              aria-label="Buy YES"
            >
              Buy Yes
            </Button>
            <Button
              variant="no"
              size="sm"
              className="flex-1"
              onClick={() => onQuickBuy('no')}
              aria-label="Buy NO"
            >
              Buy No
            </Button>
          </div>

          {/* Refresh analysis */}
          <Button
            variant="ai"
            size="sm"
            className="w-full"
            onClick={onRequestAnalysis}
          >
            Refresh Analysis
          </Button>
        </div>
      ) : (
        <div className="space-y-3">
          <p className="text-sm text-muted leading-relaxed">
            Get AI-powered analysis from our 14-agent intelligence system.
          </p>
          <Button
            variant="ai"
            size="sm"
            className="w-full"
            onClick={onRequestAnalysis}
          >
            Get Analysis
          </Button>
        </div>
      )}
    </Card>
  );
}
