'use client';

import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/Button';
import { Markdown } from '@/components/ui/Markdown';
import { Modal } from '@/components/ui/Modal';
import { useMarketAnalysis } from '@/hooks/useMarketAnalysis';
import { useAnalysisStatus, type AnalysisStatus } from '@/hooks/useAnalysisStatus';
import { useAnalysisSubscriptions, useCancelAnalysisSubscription } from '@/hooks/useAnalysisSubscriptions';
import { cn } from '@/utils/classNames';
import { AlertTriangle, ArrowDown, ArrowUp, Brain, ChevronRight, Sparkles } from 'lucide-react';

interface AIPanelProps {
  marketSlug: string;
  /** Live YES token price in cents (0–100) from Polymarket API */
  yesCents?: number;
  onQuickBuy?: (side: 'yes' | 'no') => void;
  onRequestAnalysis?: () => void;
  /** When true, disables all trade/analysis actions (e.g. resolved markets) */
  disabled?: boolean;
}

export function AIPanel({ marketSlug, yesCents: liveYesCents, onQuickBuy, onRequestAnalysis, disabled = false }: AIPanelProps) {
  const { data: analysis, isLoading: analysisLoading } = useMarketAnalysis(marketSlug);
  const analysisStatus = useAnalysisStatus(marketSlug);
  const [webResearchOpen, setWebResearchOpen] = useState(false);

  // Agent signals come from the analysis detail (merged by results-api from S3)
  const signals = analysis?.agentSignals ?? [];
  const webResearch = analysis?.webResearchSummary?.trim() ?? '';

  const action = analysis?.action;
  const edge = analysis?.metadata?.edge ?? 0;
  const confidence = analysis?.winProbability ?? 0;
  const consensusProb = analysis?.metadata?.consensusProbability ?? 0;
  const marketProb = analysis?.metadata?.marketProbability ?? 0;
  const summary = analysis?.explanation?.summary ?? '';
  const thesis = analysis?.explanation?.coreThesis ?? '';
  const keyCatalysts = analysis?.explanation?.keyCatalysts ?? [];
  const failureScenarios = analysis?.explanation?.failureScenarios ?? [];

  const recLabel = action === 'LONG_YES' ? 'BUY YES' : action === 'LONG_NO' ? 'BUY NO' : 'NO TRADE';

  // Backend edge = consensus - market (always YES-space). For LONG_NO the
  // trader's edge is the inverse, since NO is the underpriced side.
  const displayEdge = action === 'LONG_NO' ? -edge : edge;

  // Token price in cents: prefer live Polymarket price, fallback to analysis snapshot
  const displayYesCents = liveYesCents ?? (marketProb > 0 && marketProb <= 1 ? Math.round(marketProb * 100) : 0);
  const marketCents =
    marketProb > 0 && marketProb <= 1 ? Math.round(marketProb * 100) : displayYesCents;
  const consensusCents =
    consensusProb > 0 && consensusProb <= 1 ? Math.round(consensusProb * 100) : null;
  const tradeYesCents = displayYesCents > 0 ? Math.round(displayYesCents) : null;
  const tradeNoCents = tradeYesCents != null ? 100 - tradeYesCents : null;
  const yesLean = signals.filter(
    (signal) => signal.direction === 'YES' || signal.direction === 'LONG_YES'
  ).length;
  const noLean = signals.filter(
    (signal) => signal.direction === 'NO' || signal.direction === 'LONG_NO'
  ).length;

  if (analysisLoading) {
    return (
      <section className="overflow-hidden rounded-2xl border border-ai/25 bg-surface">
        <div className="border-b border-ai/15 bg-gradient-to-br from-ai/[0.12] via-ai/[0.03] to-transparent px-4 py-4">
          <div className="flex animate-pulse items-center gap-2">
            <div className="h-7 w-7 rounded-lg bg-ai/20" />
            <div className="space-y-1.5">
              <div className="h-3.5 w-24 rounded bg-surface-2" />
              <div className="h-2.5 w-32 rounded bg-surface-2" />
            </div>
          </div>
        </div>
        <div className="animate-pulse space-y-3 p-4">
          <div className="h-8 w-2/3 rounded bg-surface-2" />
          <div className="h-2 rounded-full bg-surface-2" />
          <div className="h-16 rounded-xl bg-surface-2" />
          <div className="h-4 w-3/4 rounded bg-surface-2" />
          <div className="h-4 w-1/2 rounded bg-surface-2" />
        </div>
      </section>
    );
  }

  if (!analysis) {
    return (
      <section className="overflow-hidden rounded-2xl border border-ai/25 bg-surface">
        <div className="border-b border-ai/15 bg-gradient-to-br from-ai/[0.12] via-ai/[0.03] to-transparent px-4 py-4">
          <div className="flex items-center gap-2">
            <span className="flex h-7 w-7 items-center justify-center rounded-lg border border-ai/25 bg-ai/10 text-ai">
              <Brain className="h-3.5 w-3.5" aria-hidden="true" />
            </span>
            <div className="min-w-0 flex-1">
              <h2 className="text-sm font-semibold leading-tight text-fg">AI verdict</h2>
              <p className="text-[0.6rem] text-muted">14 agents · one consensus</p>
            </div>
            <span className="rounded-full border border-border bg-surface-2 px-2 py-0.5 font-mono text-[0.58rem] text-muted">
              no run
            </span>
          </div>

          <div className="mt-4">
            {analysisStatus.state !== 'none' ? (
              <AnalysisStatusBanner status={analysisStatus} />
            ) : (
              <div className="rounded-xl border border-dashed border-ai/25 bg-surface/50 p-4">
                <p className="text-sm font-medium text-fg">
                  {disabled ? 'This market is resolved' : 'No verdict yet'}
                </p>
                <p className="mt-1 text-xs leading-relaxed text-muted">
                  {disabled
                    ? 'Analysis is closed for this market.'
                    : 'Run the full agent panel once to get a consensus probability, confidence band, and trade plan.'}
                </p>
                {!disabled ? (
                  <>
                    <Button
                      variant="ai"
                      size="md"
                      className="mt-3 h-11 w-full"
                      onClick={onRequestAnalysis}
                    >
                      Run 14-agent analysis
                    </Button>
                    <div className="mt-2 flex items-center justify-between font-mono text-[0.58rem] text-muted">
                      <span>1 credit</span>
                      <span>~52 seconds</span>
                    </div>
                  </>
                ) : (
                  <Button variant="secondary" size="sm" className="mt-3 w-full" disabled>
                    Market resolved
                  </Button>
                )}
              </div>
            )}
          </div>
        </div>

        <div className="border-t border-border/60 p-4">
          <TradeActions
            yesCents={tradeYesCents}
            noCents={tradeNoCents}
            action={action}
            disabled={disabled}
            onQuickBuy={onQuickBuy}
          />
        </div>
      </section>
    );
  }

  const recColor =
    action === 'LONG_YES' ? 'text-yes' : action === 'LONG_NO' ? 'text-no' : 'text-fg';
  const edgeColor =
    displayEdge > 0 ? 'text-yes' : displayEdge < 0 ? 'text-no' : 'text-muted';
  const ev = analysis.expectedValue ?? 0;

  return (
    <section className="overflow-hidden rounded-2xl border border-ai/25 bg-surface">
      {/* Verdict header */}
      <div className="relative overflow-hidden border-b border-ai/15 bg-gradient-to-br from-ai/[0.14] via-ai/[0.04] to-transparent px-4 pb-4 pt-4">
        <div className="flex items-center gap-2">
          <span className="flex h-7 w-7 items-center justify-center rounded-lg border border-ai/25 bg-ai/10 text-ai">
            <Brain className="h-3.5 w-3.5" aria-hidden="true" />
          </span>
          <div className="min-w-0 flex-1">
            <h2 className="text-sm font-semibold leading-tight text-fg">AI verdict</h2>
            <p className="text-[0.6rem] text-muted">
              {analysis.metadata.agentsUsed?.length || 14} agents · one consensus
            </p>
          </div>
          {analysis.executedAt && (
            <div className="flex items-center gap-1.5">
              <FreshnessBadge executedAt={analysis.executedAt} />
              <span className="text-[0.6rem] text-muted">
                {formatFreshness(analysis.executedAt)}
              </span>
            </div>
          )}
        </div>

        <div className="mt-4 flex items-start justify-between gap-3">
          <div>
            <span className="text-[0.62rem] text-muted">Recommendation</span>
            <div
              className={cn(
                'mt-0.5 font-display text-2xl font-bold leading-none tracking-[-0.03em]',
                recColor
              )}
            >
              {recLabel}
            </div>
          </div>
          <div className="text-right">
            <span className="text-[0.62rem] text-muted">Edge</span>
            <div
              className={cn(
                'font-mono text-2xl font-bold leading-none tabular-nums',
                edgeColor
              )}
            >
              {displayEdge > 0 ? '+' : ''}
              {(displayEdge * 100).toFixed(1)}¢
            </div>
          </div>
        </div>

        <div className="mt-3.5">
          <AIEdgeRail
            marketCents={marketCents}
            consensusCents={consensusCents}
            displayEdge={displayEdge}
            action={action}
          />
        </div>
      </div>

      <div className="border-b border-border/60 p-4">
        <TradeActions
          yesCents={tradeYesCents}
          noCents={tradeNoCents}
          action={action}
          disabled={disabled}
          onQuickBuy={onQuickBuy}
        />
      </div>

      <div>
        {analysisStatus.state !== 'none' && (
          <div className="px-4 pt-4">
            <AnalysisStatusBanner status={analysisStatus} />
          </div>
        )}

        {summary && (
          <p className="px-4 py-4 text-[0.82rem] leading-6 text-fg/85">{summary}</p>
        )}

        <div className="grid grid-cols-3 divide-x divide-border/60 border-y border-border/60">
          <VerdictMetric
            label="Confidence"
            value={`${Math.round(confidence * 100)}%`}
          />
          <VerdictMetric
            label="Expected"
            value={`${ev > 0 ? '+' : ''}${(ev * 100).toFixed(1)}%`}
            tone={ev > 0 ? 'yes' : ev < 0 ? 'no' : 'muted'}
          />
          <VerdictMetric
            label="Liquidity"
            value={analysis.liquidityRisk}
            tone={
              analysis.liquidityRisk === 'low'
                ? 'yes'
                : analysis.liquidityRisk === 'high'
                  ? 'no'
                  : 'muted'
            }
          />
        </div>

        {analysis.entryZone[0] > 0 || analysis.targetZone[0] > 0 ? (
          <div className="px-4 pt-4">
            <TradeZonesSlider
              entryZone={analysis.entryZone}
              targetZone={analysis.targetZone}
              stopLoss={analysis.stopLoss}
              currentPrice={
                liveYesCents != null ? liveYesCents / 100 : analysis.metadata.marketProbability
              }
              action={action}
            />
          </div>
        ) : null}

        <div className="divide-y divide-border/60 border-t border-border/60">
          {thesis && (
            <PanelDisclosure label="Core thesis">
              <p className="text-xs leading-relaxed text-muted">{thesis}</p>
            </PanelDisclosure>
          )}

          {(analysis.bullThesis || analysis.bearThesis) && (
            <PanelDisclosure
              label="Bull vs bear"
              meta={
                analysis.crossExamination
                  ? `${analysis.crossExamination.bullScore}–${analysis.crossExamination.bearScore}`
                  : undefined
              }
            >
              <DebatePanel
                bullThesis={analysis.bullThesis}
                bearThesis={analysis.bearThesis}
                crossExamination={analysis.crossExamination}
              />
            </PanelDisclosure>
          )}

          {consensusCents != null && (
            <PanelDisclosure label="Model agreement" meta={`${consensusCents}¢`}>
              <ConsensusDetail
                consensusProb={consensusProb}
                marketProb={marketProb}
                edge={displayEdge}
                confidenceBand={analysis.metadata.confidenceBand}
                action={action}
              />
            </PanelDisclosure>
          )}

          {failureScenarios.length > 0 && (
            <PanelDisclosure label="Risks" meta={`${failureScenarios.length}`}>
              <RiskFactorsList risks={failureScenarios} />
            </PanelDisclosure>
          )}

          {keyCatalysts.length > 0 && (
            <PanelDisclosure label="Catalysts" meta={`${keyCatalysts.length}`}>
              <CatalystsList catalysts={keyCatalysts} />
            </PanelDisclosure>
          )}
        </div>

        {(signals.length > 0 || webResearch) && (
          <button
            type="button"
            onClick={() => webResearch && setWebResearchOpen(true)}
            disabled={!webResearch}
            className={cn(
              'flex w-full items-center justify-between gap-3 border-t border-border/60 px-4 py-3 text-left text-[0.65rem] text-muted transition-colors',
              webResearch ? 'hover:text-fg' : 'cursor-not-allowed opacity-70'
            )}
          >
            <span className="flex items-center gap-3">
              {signals.length > 0 && (
                <>
                  <span className="flex items-center gap-1.5">
                    <span className="h-1.5 w-1.5 rounded-full bg-yes" aria-hidden="true" />
                    {yesLean} lean YES
                  </span>
                  <span className="flex items-center gap-1.5">
                    <span className="h-1.5 w-1.5 rounded-full bg-no" aria-hidden="true" />
                    {noLean} lean NO
                  </span>
                </>
              )}
            </span>
            <span
              className={cn(
                'inline-flex items-center gap-1 font-medium',
                webResearch ? 'text-accent' : 'text-muted'
              )}
            >
              {webResearch ? 'Web research' : 'No web research'}
              <ChevronRight className="h-3.5 w-3.5" aria-hidden="true" />
            </span>
          </button>
        )}

        <Modal
          open={webResearchOpen}
          onClose={() => setWebResearchOpen(false)}
          title="Web research"
          size="lg"
          mobileSheet
        >
          <div className="max-h-[65vh] overflow-y-auto pr-1">
            <p className="mb-4 text-[0.65rem] text-muted">
              Compiled by the web research agent from sources available at run
              time.
            </p>
            {webResearch ? (
              <Markdown text={webResearch} />
            ) : (
              <p className="text-sm text-muted">
                No web research was saved with this analysis.
              </p>
            )}
          </div>
        </Modal>

        <div className="space-y-3 border-t border-border/60 p-4">
          <RefreshButton
            executedAt={analysis.executedAt}
            onRequestAnalysis={onRequestAnalysis}
            disabled={disabled}
          />
          <RecurringScheduleIndicator marketId={marketSlug} />
        </div>
      </div>
    </section>
  );
}

function TradeActions({
  yesCents,
  noCents,
  action,
  disabled,
  onQuickBuy,
}: {
  yesCents: number | null;
  noCents: number | null;
  action?: 'LONG_YES' | 'LONG_NO' | 'NO_TRADE';
  disabled: boolean;
  onQuickBuy?: (side: 'yes' | 'no') => void;
}) {
  const pickedYes = action === 'LONG_YES';
  const pickedNo = action === 'LONG_NO';

  return (
    <div>
      <div className="mb-2 flex items-center justify-between gap-2 text-[0.62rem] text-muted">
        <span>Trade this market</span>
        {pickedYes || pickedNo ? (
          <span className="inline-flex items-center gap-1 text-ai">
            <Sparkles className="h-3 w-3" aria-hidden="true" />
            AI pick
          </span>
        ) : (
          <span className="font-mono text-[0.58rem]">Polymarket</span>
        )}
      </div>

      <div className="flex flex-col gap-2.5">
        <PanelBuyButton
          side="yes"
          cents={yesCents}
          recommended={pickedYes}
          disabled={disabled}
          onClick={() => onQuickBuy?.('yes')}
          className={pickedNo ? 'order-2' : 'order-1'}
        />
        <PanelBuyButton
          side="no"
          cents={noCents}
          recommended={pickedNo}
          disabled={disabled}
          onClick={() => onQuickBuy?.('no')}
          className={pickedYes ? 'order-2' : 'order-1'}
        />
      </div>
    </div>
  );
}

function PanelBuyButton({
  side,
  cents,
  recommended,
  disabled,
  onClick,
  className,
}: {
  side: 'yes' | 'no';
  cents: number | null;
  recommended: boolean;
  disabled: boolean;
  onClick: () => void;
  className?: string;
}) {
  const isYes = side === 'yes';

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={`Buy ${isYes ? 'YES' : 'NO'}`}
      className={cn(
        'flex min-h-[60px] w-full items-center justify-between gap-4 rounded-xl border px-4 py-3 text-left transition-[background,border-color,box-shadow,filter]',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-bg',
        disabled
          ? 'cursor-not-allowed border-border bg-surface-2 text-muted opacity-60'
          : recommended
            ? isYes
              ? 'border-yes bg-yes text-bg shadow-[0_8px_22px_-10px_oklch(72%_0.16_155_/_0.65)] hover:brightness-105'
              : 'border-no bg-no text-bg shadow-[0_8px_22px_-10px_oklch(65%_0.18_25_/_0.6)] hover:brightness-105'
            : isYes
              ? 'border-yes/30 bg-yes/[0.05] text-yes hover:border-yes/55 hover:bg-yes/10'
              : 'border-no/30 bg-no/[0.04] text-no hover:border-no/55 hover:bg-no/10',
        className
      )}
    >
      <span className="flex flex-col">
        <span
          className={cn(
            'flex items-center gap-1.5 text-[0.58rem] font-semibold',
            recommended ? 'text-bg/70' : 'text-muted'
          )}
        >
          {recommended ? (
            <>
              <Sparkles className="h-3 w-3" aria-hidden="true" />
              AI pick
            </>
          ) : (
            'Buy'
          )}
        </span>
        <span
          className={cn(
            'mt-0.5 text-base font-bold leading-none',
            recommended ? 'text-bg' : isYes ? 'text-yes' : 'text-no'
          )}
        >
          {isYes ? 'YES' : 'NO'}
        </span>
      </span>
      {cents != null && (
        <span
          className={cn(
            'font-mono text-2xl font-bold leading-none tabular-nums',
            recommended ? 'text-bg' : isYes ? 'text-yes' : 'text-no'
          )}
        >
          {cents}
          <span className="text-sm">¢</span>
        </span>
      )}
    </button>
  );
}

function AIEdgeRail({
  marketCents,
  consensusCents,
  displayEdge,
  action,
}: {
  marketCents: number;
  consensusCents: number | null;
  displayEdge: number;
  action?: 'LONG_YES' | 'LONG_NO' | 'NO_TRADE';
}) {
  const isNo = action === 'LONG_NO';
  const tokenLabel = isNo ? 'NO' : 'YES';
  const tokenMarketCents = isNo ? 100 - marketCents : marketCents;
  const tokenConsensusCents =
    consensusCents == null
      ? null
      : isNo
        ? 100 - consensusCents
        : consensusCents;
  const low =
    tokenConsensusCents == null
      ? tokenMarketCents
      : Math.min(tokenMarketCents, tokenConsensusCents);
  const high =
    tokenConsensusCents == null
      ? tokenMarketCents
      : Math.max(tokenMarketCents, tokenConsensusCents);

  return (
    <div>
      <div className="relative h-1.5 overflow-hidden rounded-full bg-surface-2">
        <div
          className={cn(
            'absolute inset-y-0 left-0',
            isNo ? 'bg-no/70' : 'bg-yes/70'
          )}
          style={{ width: `${tokenMarketCents}%` }}
        />
        {tokenConsensusCents != null && (
          <>
            <div
              className="absolute inset-y-0 bg-ai/45"
              style={{ left: `${low}%`, width: `${Math.max(high - low, 0.8)}%` }}
            />
            <div
              className="absolute inset-y-[-3px] w-px bg-ai"
              style={{ left: `${tokenConsensusCents}%` }}
            />
          </>
        )}
      </div>
      <div className="mt-1.5 flex items-center justify-between font-mono text-[0.6rem]">
        <span className="text-muted">
          {tokenLabel} market {tokenMarketCents}¢
        </span>
        {tokenConsensusCents != null && (
          <span
            className={cn(
              displayEdge > 0 ? 'text-yes' : displayEdge < 0 ? 'text-no' : 'text-muted'
            )}
          >
            AI {tokenLabel} fair {tokenConsensusCents}¢
          </span>
        )}
      </div>
    </div>
  );
}

function VerdictMetric({
  label,
  value,
  tone = 'fg',
}: {
  label: string;
  value: string;
  tone?: 'fg' | 'yes' | 'no' | 'muted';
}) {
  return (
    <div className="px-3 py-2.5">
      <div className="text-[0.58rem] text-muted">{label}</div>
      <div
        className={cn(
          'mt-0.5 font-mono text-xs font-semibold capitalize tabular-nums',
          tone === 'yes' && 'text-yes',
          tone === 'no' && 'text-no',
          tone === 'muted' && 'text-muted',
          tone === 'fg' && 'text-fg'
        )}
      >
        {value}
      </div>
    </div>
  );
}

function PanelDisclosure({
  label,
  meta,
  defaultOpen = false,
  children,
}: {
  label: string;
  meta?: string;
  defaultOpen?: boolean;
  children: React.ReactNode;
}) {
  return (
    <details open={defaultOpen || undefined} className="group">
      <summary className="flex cursor-pointer items-center justify-between gap-3 px-4 py-3 text-xs font-medium text-fg">
        <span>{label}</span>
        <span className="flex items-center gap-2 text-[0.6rem] text-muted">
          {meta}
          <ChevronRight
            className="h-3.5 w-3.5 transition-transform group-open:rotate-90"
            aria-hidden="true"
          />
        </span>
      </summary>
      <div className="px-4 pb-4">{children}</div>
    </details>
  );
}

/* ─── Sub-components ─── */

/** Trade zones slider showing stop loss, entry zone, current price, and target zone. */
function TradeZonesSlider({
  entryZone,
  targetZone,
  stopLoss,
  currentPrice,
  action,
}: {
  entryZone: [number, number];
  targetZone: [number, number];
  stopLoss: number;
  currentPrice: number;
  action?: 'LONG_YES' | 'LONG_NO' | 'NO_TRADE';
}) {
  const isNo = action === 'LONG_NO';

  // All values are fractions (0-1). Convert to cents for display.
  // For LONG_NO, the analysis engine already expresses entryZone, targetZone,
  // and stopLoss in NO token terms - do NOT invert them.
  // Only currentPrice (which is always YES probability from metadata.marketProbability)
  // needs inversion to show the current NO token price.
  const slCents = Math.round(stopLoss * 100);
  const entryLow = Math.round(entryZone[0] * 100);
  const entryHigh = Math.round(entryZone[1] * 100);
  const targetLow = Math.round(targetZone[0] * 100);
  const targetHigh = Math.round(targetZone[1] * 100);
  const currentCents = isNo ? Math.round((1 - currentPrice) * 100) : Math.round(currentPrice * 100);

  // Calculate the range for positioning
  const allValues = [slCents, entryLow, entryHigh, targetLow, targetHigh, currentCents];
  const min = Math.max(0, Math.min(...allValues) - 2);
  const max = Math.min(100, Math.max(...allValues) + 2);
  const range = max - min || 1;

  const toPercent = (v: number) => ((v - min) / range) * 100;

  return (
    <div className="mb-1 overflow-hidden rounded-xl border border-border/60">
      {/* Header */}
      <div className="flex items-center justify-between px-3.5 pb-2 pt-3">
        <span className="text-[0.7rem] font-medium text-fg">
          Trade plan {isNo ? '(NO token)' : ''}
        </span>
        <span className="text-[0.6rem] font-mono text-muted">
          {min}¢ - {max}¢
        </span>
      </div>

      {/* Slider visualization */}
      <div className="px-3.5 pb-3">
        <div className="relative h-12">
          {/* Background gradient track */}
          <div className={cn(
            'absolute top-[22px] left-0 right-0 h-[6px] rounded-full bg-gradient-to-r',
            isNo
              ? 'from-yes/20 via-surface-2 to-no/20'
              : 'from-no/20 via-surface-2 to-yes/20'
          )} />

          {/* Stop Loss zone (danger area) */}
          <div
            className={cn(
              'absolute top-[20px] h-[10px] border-r-2',
              isNo
                ? 'rounded-r-full bg-yes/15 border-yes/40'
                : 'rounded-l-full bg-no/15 border-no/40'
            )}
            style={isNo
              ? { right: '0%', width: `${100 - toPercent(slCents)}%` }
              : { left: '0%', width: `${toPercent(slCents)}%` }
            }
          />

          {/* Entry Zone range */}
          <div
            className="absolute top-[19px] h-[12px] rounded-full bg-ai/25 border border-ai/40 backdrop-blur-sm"
            style={{
              left: `${toPercent(entryLow)}%`,
              width: `${Math.max(toPercent(entryHigh) - toPercent(entryLow), 2)}%`,
            }}
          />

          {/* Target Zone range */}
          <div
            className={cn(
              'absolute top-[19px] h-[12px] rounded-full backdrop-blur-sm border',
              isNo
                ? 'bg-no/25 border-no/40'
                : 'bg-yes/25 border-yes/40'
            )}
            style={{
              left: `${toPercent(targetLow)}%`,
              width: `${Math.max(toPercent(targetHigh) - toPercent(targetLow), 2)}%`,
            }}
          />

          {/* Stop Loss pin */}
          <div
            className="absolute flex flex-col items-center"
            style={{ left: `${toPercent(slCents)}%`, transform: 'translateX(-50%)' }}
          >
            <span className={cn('text-[0.55rem] font-mono font-bold mb-0.5', isNo ? 'text-yes' : 'text-no')}>{slCents}¢</span>
            <div className={cn('w-[3px] h-4 rounded-full', isNo ? 'bg-yes shadow-[0_0_4px_oklch(72%_0.16_155_/_0.5)]' : 'bg-no shadow-[0_0_4px_oklch(65%_0.18_25_/_0.5)]')} />
          </div>

          {/* Current price pin */}
          <div
            className="absolute flex flex-col items-center z-10"
            style={{ left: `${toPercent(currentCents)}%`, transform: 'translateX(-50%)' }}
          >
            <span className="text-[0.55rem] font-mono font-bold text-fg mb-0.5">{currentCents}¢</span>
            <div className="w-3.5 h-3.5 rounded-full bg-fg border-[2.5px] border-surface-2 shadow-[0_0_0_1px_var(--border),0_2px_6px_rgba(0,0,0,0.3)]" />
          </div>

          {/* Entry zone midpoint label */}
          <div
            className="absolute bottom-0 flex flex-col items-center"
            style={{ left: `${toPercent((entryLow + entryHigh) / 2)}%`, transform: 'translateX(-50%)' }}
          >
            <span className="text-[0.5rem] font-mono text-ai">{entryLow}–{entryHigh}¢</span>
          </div>

          {/* Target zone midpoint label */}
          <div
            className="absolute bottom-0 flex flex-col items-center"
            style={{ left: `${toPercent((targetLow + targetHigh) / 2)}%`, transform: 'translateX(-50%)' }}
          >
            <span className={cn('text-[0.5rem] font-mono', isNo ? 'text-no' : 'text-yes')}>{targetLow}–{targetHigh}¢</span>
          </div>
        </div>
      </div>

      {/* Legend footer */}
      <div className="flex items-center justify-between px-3.5 py-2 bg-surface-2/50 border-t border-border/30">
        <div className="flex items-center gap-1.5">
          <span className={cn('w-[3px] h-2.5 rounded-full', isNo ? 'bg-yes' : 'bg-no')} />
          <span className="text-[0.6rem] text-muted">Stop Loss</span>
        </div>
        <div className="flex items-center gap-1.5">
          <span className="w-2.5 h-2.5 rounded-full bg-fg border-2 border-surface-2" />
          <span className="text-[0.6rem] text-muted">Current</span>
        </div>
        <div className="flex items-center gap-1.5">
          <span className="w-3 h-2 rounded-sm bg-ai/40 border border-ai/60" />
          <span className="text-[0.6rem] text-muted">Entry</span>
        </div>
        <div className="flex items-center gap-1.5">
          <span className={cn('w-3 h-2 rounded-sm border', isNo ? 'bg-no/40 border-no/60' : 'bg-yes/40 border-yes/60')} />
          <span className="text-[0.6rem] text-muted">Target</span>
        </div>
      </div>
    </div>
  );
}

/** Inline status banner showing analysis state on the market detail page. */
function AnalysisStatusBanner({ status }: { status: AnalysisStatus }) {
  const { state, progress } = status;
  const [elapsed, setElapsed] = useState(0);

  // Elapsed time counter (hooks must run before any early return)
  useEffect(() => {
    if (state !== 'in_progress' && state !== 'queued') return;
    const startTime = progress?.timestamp
      ? new Date(progress.timestamp).getTime()
      : Date.now();
    function tick() {
      setElapsed(Math.floor((Date.now() - startTime) / 1000));
    }
    tick();
    const interval = setInterval(tick, 1000);
    return () => clearInterval(interval);
  }, [progress?.timestamp, state]);

  if (state === 'completed') {
    return (
      <div
        className="rounded-lg border border-yes/30 bg-yes/[0.06] p-3.5"
        role="status"
        aria-live="polite"
      >
        <div className="flex items-center gap-2">
          <span className="flex h-2.5 w-2.5 rounded-full bg-yes" />
          <span className="text-xs font-medium text-yes">Analysis complete</span>
        </div>
        <p className="text-[0.7rem] text-muted mt-1">Results are ready below.</p>
      </div>
    );
  }

  if (state === 'failed') {
    return (
      <div
        className="rounded-lg border border-no/30 bg-no/[0.06] p-3.5"
        role="status"
        aria-live="polite"
      >
        <div className="flex items-center gap-2">
          <span className="flex h-2.5 w-2.5 rounded-full bg-no" />
          <span className="text-xs font-medium text-no">Analysis failed</span>
        </div>
        <p className="text-[0.7rem] text-muted mt-1">Your credit has been refunded. Try again.</p>
      </div>
    );
  }

  // Queued or in_progress
  const isInProgress = state === 'in_progress' && progress;
  const stageLabel = progress?.stageName || 'Waiting in queue…';
  const stageNum = progress?.stage ?? 0;
  const totalStages = progress?.totalStages ?? 11;

  return (
    <div
      className="rounded-lg border border-ai/30 bg-gradient-to-r from-ai/[0.06] to-transparent p-3.5"
      role="status"
      aria-live="polite"
      aria-label={`Analysis ${state}: ${stageLabel}`}
    >
      <div className="flex items-center justify-between mb-2">
        <span className="flex items-center gap-1.5 text-xs font-semibold text-ai">
          <span className="relative flex h-2 w-2">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-ai opacity-75" />
            <span className="relative inline-flex h-2 w-2 rounded-full bg-ai" />
          </span>
          {state === 'queued' ? 'Queued' : 'Analyzing…'}
        </span>
        <span className="text-[0.65rem] font-mono text-muted tabular-nums">
          {elapsed}s{isInProgress ? ` · ${stageNum}/${totalStages}` : ''}
        </span>
      </div>
      {/* Segmented pipeline bar */}
      <div className="flex gap-0.5 items-center mb-1.5">
        {Array.from({ length: totalStages }).map((_, i) => (
          <div
            key={i}
            className={cn(
              'h-1 flex-1 rounded-full',
              i < stageNum
                ? 'bg-ai'
                : i === stageNum && isInProgress
                  ? 'bg-ai animate-pulse'
                  : 'bg-surface-2'
            )}
          />
        ))}
      </div>
      <p className="text-[0.7rem] text-muted">{stageLabel}</p>
    </div>
  );
}

function DebatePanel({
  bullThesis,
  bearThesis,
  crossExamination,
}: {
  bullThesis?: { direction: string; fairProbability: number; keyArguments: string[]; confidence: number };
  bearThesis?: { direction: string; fairProbability: number; keyArguments: string[]; confidence: number };
  crossExamination?: { bullScore: number; bearScore: number };
}) {
  return (
    <div className="flex flex-col gap-3">
      {/* Bull Case */}
      {bullThesis && (
        <div className="rounded-md p-3 bg-bg border-l-[3px] border-l-yes">
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-1.5 text-[0.7rem] font-semibold text-yes">
              <ArrowUp className="h-3 w-3" aria-hidden="true" /> Bull Case
            </div>
            <div className="flex items-center gap-2">
              <span className="text-[0.6rem] font-mono text-muted">
                YES fair: {Math.round(bullThesis.fairProbability * 100)}¢
              </span>
              <span className="text-[0.6rem] font-mono text-yes">
                {Math.round(bullThesis.confidence * 100)}% conf
              </span>
            </div>
          </div>
          {bullThesis.keyArguments.length > 0 && (
            <ul className="space-y-1.5">
              {bullThesis.keyArguments.map((arg, i) => (
                <li key={i} className="flex gap-2 text-xs leading-relaxed text-fg/80">
                  <span className="text-yes shrink-0">•</span>
                  <span>{arg}</span>
                </li>
              ))}
            </ul>
          )}
          {crossExamination && (
            <div className="mt-2 pt-2 border-t border-border/30 text-[0.6rem] text-muted">
              Cross-exam score: <span className="font-mono font-medium text-yes">{crossExamination.bullScore}/10</span>
            </div>
          )}
        </div>
      )}

      {/* Bear Case */}
      {bearThesis && (
        <div className="rounded-md p-3 bg-bg border-l-[3px] border-l-no">
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-1.5 text-[0.7rem] font-semibold text-no">
              <ArrowDown className="h-3 w-3" aria-hidden="true" /> Bear Case
            </div>
            <div className="flex items-center gap-2">
              <span className="text-[0.6rem] font-mono text-muted">
                NO fair: {Math.round((1 - bearThesis.fairProbability) * 100)}¢
              </span>
              <span className="text-[0.6rem] font-mono text-no">
                {Math.round(bearThesis.confidence * 100)}% conf
              </span>
            </div>
          </div>
          {bearThesis.keyArguments.length > 0 && (
            <ul className="space-y-1.5">
              {bearThesis.keyArguments.map((arg, i) => (
                <li key={i} className="flex gap-2 text-xs leading-relaxed text-fg/80">
                  <span className="text-no shrink-0">•</span>
                  <span>{arg}</span>
                </li>
              ))}
            </ul>
          )}
          {crossExamination && (
            <div className="mt-2 pt-2 border-t border-border/30 text-[0.6rem] text-muted">
              Cross-exam score: <span className="font-mono font-medium text-no">{crossExamination.bearScore}/10</span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function ConsensusDetail({
  consensusProb,
  marketProb,
  edge,
  confidenceBand,
  action,
}: {
  consensusProb: number;
  marketProb: number;
  edge: number;
  confidenceBand?: [number, number];
  action?: 'LONG_YES' | 'LONG_NO' | 'NO_TRADE';
}) {
  const isNo = action === 'LONG_NO';
  // Display consensus and market in the traded token's perspective
  const displayConsensus = isNo ? Math.round((1 - consensusProb) * 100) : Math.round(consensusProb * 100);
  const displayMarket = isNo ? Math.round((1 - marketProb) * 100) : Math.round(marketProb * 100);
  const tokenLabel = isNo ? ' (NO)' : '';

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex justify-between text-xs py-1">
        <span className="text-muted">AI Consensus{tokenLabel}</span>
        <span className="font-mono">{displayConsensus}¢</span>
      </div>
      <div className="flex justify-between text-xs py-1">
        <span className="text-muted">Market Price{tokenLabel}</span>
        <span className="font-mono">{displayMarket}¢</span>
      </div>
      <div className="flex justify-between text-xs py-1">
        <span className="text-muted">Edge</span>
        <span className={cn('font-mono', edge > 0 ? 'text-yes' : 'text-no')}>
          {edge > 0 ? '+' : ''}{(edge * 100).toFixed(1)}¢
        </span>
      </div>
      {confidenceBand && (
        <div className="flex justify-between text-xs py-1">
          <span className="text-muted">Confidence Band{tokenLabel}</span>
          <span className="font-mono">
            {isNo
              ? `${Math.round((1 - confidenceBand[1]) * 100)}¢ – ${Math.round((1 - confidenceBand[0]) * 100)}¢`
              : `${Math.round(confidenceBand[0] * 100)}¢ – ${Math.round(confidenceBand[1] * 100)}¢`
            }
          </span>
        </div>
      )}
    </div>
  );
}

function RiskFactorsList({ risks }: { risks: string[] }) {
  return (
    <div className="flex flex-col gap-2">
      {risks.map((risk, i) => (
        <div key={i} className="flex gap-2 text-xs leading-relaxed text-fg/80">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-warning" aria-hidden="true" />
          <span>{risk}</span>
        </div>
      ))}
    </div>
  );
}

function CatalystsList({ catalysts }: { catalysts: string[] }) {
  return (
    <div className="flex flex-col">
      {catalysts.map((catalyst, i) => (
        <div
          key={i}
          className={cn(
            'flex gap-2 text-xs text-fg/80 py-1.5',
            i < catalysts.length - 1 && 'border-b border-border/50'
          )}
        >
          <span className="text-warning font-mono text-[0.65rem] whitespace-nowrap shrink-0">
            •
          </span>
          <span className="leading-relaxed">{catalyst}</span>
        </div>
      ))}
    </div>
  );
}

/* ─── Recurring Schedule Indicator ─── */

function RecurringScheduleIndicator({ marketId }: { marketId: string }) {
  const { data: subscriptions } = useAnalysisSubscriptions();
  const { mutate: cancelSubscription, isPending: isCancelling } = useCancelAnalysisSubscription();
  const [confirmCancel, setConfirmCancel] = useState(false);
  const [countdown, setCountdown] = useState<string>('');

  const subscription = subscriptions?.find(
    (s) => s.marketId === marketId && s.status === 'active'
  );

  useEffect(() => {
    if (!subscription) return;

    function update() {
      const intervalMs = (subscription!.intervalSeconds || 3600) * 1000;

      // Compute the next expected fire time. If nextScheduledRun is available
      // and in the future, use it directly. Otherwise, derive from the interval:
      // find the next multiple of the interval after the subscription was created
      // that is still in the future.
      let nextMs: number;
      const nextRun = subscription!.nextScheduledRun;

      if (nextRun && new Date(nextRun).getTime() > Date.now()) {
        nextMs = new Date(nextRun).getTime();
      } else {
        // nextScheduledRun is stale or missing - compute from interval cadence
        const createdMs = new Date(subscription!.createdAt).getTime();
        const elapsed = Date.now() - createdMs;
        nextMs = createdMs + Math.ceil(elapsed / intervalMs) * intervalMs;
      }

      const diff = nextMs - Date.now();
      setCountdown(diff > 0 ? formatCountdownShort(diff) : formatCountdownShort(intervalMs));
    }

    update();
    const interval = setInterval(update, 30_000);
    return () => clearInterval(interval);
  }, [subscription]);

  if (!subscription) return null;

  const intervalLabel = subscription.intervalSeconds
    ? formatIntervalShort(subscription.intervalSeconds)
    : '';

  return (
    <div className="mt-3 p-3 rounded-lg border border-ai/20 bg-ai/[0.04]">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 min-w-0">
          <span className="w-1.5 h-1.5 rounded-full bg-ai animate-pulse shrink-0" />
          <span className="text-[0.7rem] text-fg/80 truncate">
            Recurring every <span className="font-medium text-ai">{intervalLabel}</span>
          </span>
        </div>
        <span className="text-[0.65rem] font-mono text-ai shrink-0 ml-2">
          {countdown}
        </span>
      </div>

      {/* Cancel row */}
      <div className="mt-2 flex items-center justify-end">
        {confirmCancel ? (
          <div className="flex items-center gap-2">
            <span className="text-[0.6rem] text-muted">Cancel schedule?</span>
            <button
              type="button"
              onClick={() => {
                cancelSubscription(subscription.id);
                setConfirmCancel(false);
              }}
              disabled={isCancelling}
              className="text-[0.6rem] font-medium text-no hover:text-no/80 transition-colors"
            >
              {isCancelling ? 'Cancelling…' : 'Yes, cancel'}
            </button>
            <button
              type="button"
              onClick={() => setConfirmCancel(false)}
              className="text-[0.6rem] text-muted hover:text-fg transition-colors"
            >
              Keep
            </button>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setConfirmCancel(true)}
            className="text-[0.6rem] text-muted hover:text-no transition-colors"
          >
            Cancel schedule
          </button>
        )}
      </div>
    </div>
  );
}

function formatCountdownShort(diffMs: number): string {
  const totalMinutes = Math.floor(diffMs / 60_000);
  if (totalMinutes < 60) return `in ${totalMinutes}m`;
  const hours = Math.floor(totalMinutes / 60);
  const mins = totalMinutes % 60;
  if (hours < 24) return mins > 0 ? `in ${hours}h ${mins}m` : `in ${hours}h`;
  const days = Math.floor(hours / 24);
  return `in ${days}d`;
}

function formatIntervalShort(seconds: number): string {
  if (seconds >= 86400) return `${seconds / 86400}d`;
  if (seconds >= 3600) return `${seconds / 3600}h`;
  return `${seconds / 60}m`;
}

/* ─── Freshness & Cooldown Components ─── */

/** Shows "Fresh" (green) if < 1hr old, "Cached" (muted) otherwise. */
function FreshnessBadge({ executedAt }: { executedAt: string }) {
  const [isFresh, setIsFresh] = useState(() => isWithinCooldown(executedAt));

  useEffect(() => {
    // Re-check every 30s to flip from "Fresh" to "Cached" without page reload
    const interval = setInterval(() => {
      setIsFresh(isWithinCooldown(executedAt));
    }, 30_000);
    return () => clearInterval(interval);
  }, [executedAt]);

  if (isFresh) {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-yes/10 border border-yes/20 px-1.5 py-0.5 text-[0.6rem] font-medium text-yes">
        <span className="w-1.5 h-1.5 rounded-full bg-yes" />
        Fresh
      </span>
    );
  }

  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-surface-2 border border-border px-1.5 py-0.5 text-[0.6rem] font-medium text-muted">
      Cached
    </span>
  );
}

/** Refresh button with cooldown countdown. While within the 1-hour window, shows remaining time. */
function RefreshButton({
  executedAt,
  onRequestAnalysis,
  disabled = false,
}: {
  executedAt?: string;
  onRequestAnalysis?: () => void;
  disabled?: boolean;
}) {
  const [cooldownText, setCooldownText] = useState<string | null>(null);

  useEffect(() => {
    if (!executedAt) {
      setCooldownText(null);
      return;
    }

    function update() {
      const executedMs = new Date(executedAt!).getTime();
      const cooldownEnds = executedMs + 60 * 60 * 1000; // 1 hour
      const remaining = cooldownEnds - Date.now();

      if (remaining <= 0) {
        setCooldownText(null);
      } else {
        const min = Math.floor(remaining / 60000);
        setCooldownText(`${min}m`);
      }
    }

    update();
    const interval = setInterval(update, 30_000);
    return () => clearInterval(interval);
  }, [executedAt]);

  return (
    <Button
      variant="ai"
      size="md"
      className="h-12 w-full gap-2 text-sm"
      onClick={onRequestAnalysis}
      disabled={disabled}
    >
      <Sparkles className="h-4 w-4" aria-hidden="true" />
      {cooldownText
        ? `Refresh analysis · ${cooldownText}`
        : 'Refresh AI analysis'}
    </Button>
  );
}

/* ─── Utilities ─── */

function formatFreshness(dateStr: string): string {
  const date = new Date(dateStr);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMin = Math.floor(diffMs / 60000);

  if (diffMin < 1) return 'Just now';
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  const diffDays = Math.floor(diffHr / 24);
  return `${diffDays}d ago`;
}

/** Returns true if the analysis is within the 1-hour dedup cooldown window. */
function isWithinCooldown(executedAt: string): boolean {
  const executedMs = new Date(executedAt).getTime();
  return Date.now() - executedMs < 60 * 60 * 1000;
}
