'use client';

import { useState, useEffect } from 'react';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Expandable } from '@/components/ui/Expandable';
import { InfoHint } from '@/components/ui/InfoHint';
import { ProbabilityBar } from '@/components/ui/ProbabilityBar';
import { useMarketAnalysis } from '@/hooks/useMarketAnalysis';
import { useAnalysisStatus, type AnalysisStatus } from '@/hooks/useAnalysisStatus';
import { useAnalysisSubscriptions, useCancelAnalysisSubscription } from '@/hooks/useAnalysisSubscriptions';
import { cn } from '@/utils/classNames';

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

  // Agent signals come from the analysis detail (merged by results-api from S3)
  const signals = analysis?.agentSignals ?? [];

  const action = analysis?.action;
  const edge = analysis?.metadata?.edge ?? 0;
  const confidence = analysis?.winProbability ?? 0;
  const consensusProb = analysis?.metadata?.consensusProbability ?? 0;
  const marketProb = analysis?.metadata?.marketProbability ?? 0;
  const summary = analysis?.explanation?.summary ?? '';
  const thesis = analysis?.explanation?.coreThesis ?? '';
  const keyCatalysts = analysis?.explanation?.keyCatalysts ?? [];
  const failureScenarios = analysis?.explanation?.failureScenarios ?? [];
  const riskPerspectives = analysis?.explanation?.riskPerspectives ?? '';
  const agentsUsed = analysis?.metadata?.agentsUsed ?? [];

  // Determine recommendation display
  const recLabel = action === 'LONG_YES' ? 'BUY YES' : action === 'LONG_NO' ? 'BUY NO' : 'NO TRADE';
  const recTone = action === 'LONG_YES' ? 'yes' : action === 'LONG_NO' ? 'no' : 'muted';

  // Edge from the traded token's perspective:
  // Backend edge = consensus - market (always YES-space).
  // For LONG_NO, the trader's edge is the inverse (NO is underpriced → positive edge).
  const displayEdge = action === 'LONG_NO' ? -edge : edge;

  // Token price in cents: prefer live Polymarket price, fallback to analysis snapshot
  const displayYesCents = liveYesCents ?? (marketProb > 0 && marketProb <= 1 ? Math.round(marketProb * 100) : 0);

  if (analysisLoading) {
    return (
      <Card variant="ai" className="p-6 animate-pulse">
        <div className="flex items-center gap-2 mb-5">
          <div className="w-6 h-6 rounded-md bg-ai/20" />
          <div className="h-4 w-32 bg-surface-2 rounded" />
        </div>
        <div className="h-12 bg-surface-2 rounded-lg mb-5" />
        <div className="h-4 bg-surface-2 rounded mb-3 w-3/4" />
        <div className="h-4 bg-surface-2 rounded mb-3 w-1/2" />
        <div className="h-20 bg-surface-2 rounded" />
      </Card>
    );
  }

  if (!analysis) {
    return (
      <Card variant="ai" className="p-6">
        <div className="flex items-center gap-2 mb-4">
          <span className="w-6 h-6 rounded-md bg-ai/20 flex items-center justify-center text-xs">
            🧠
          </span>
          <h3 className="text-sm font-semibold flex-1">AI Intelligence</h3>
        </div>

        {/* Quick Buy Buttons (always visible) */}
        <div className="grid grid-cols-2 gap-2 mb-5">
          <button
            type="button"
            onClick={() => onQuickBuy?.('yes')}
            disabled={disabled}
            aria-label="Buy YES"
            className={cn(
              'flex flex-col items-center gap-1 p-3 rounded-[10px] border-[1.5px] transition-colors',
              disabled
                ? 'bg-surface-2 border-border text-muted cursor-not-allowed opacity-50'
                : 'bg-yes/[0.15] border-yes text-yes hover:bg-yes/25'
            )}
          >
            <span className="text-[0.8125rem] font-bold">Buy YES</span>
            {displayYesCents > 0 && (
              <span className="font-mono text-xs opacity-80">
                {displayYesCents}¢
              </span>
            )}
          </button>
          <button
            type="button"
            onClick={() => onQuickBuy?.('no')}
            disabled={disabled}
            aria-label="Buy NO"
            className={cn(
              'flex flex-col items-center gap-1 p-3 rounded-[10px] border-[1.5px] transition-colors',
              disabled
                ? 'bg-surface-2 border-border text-muted cursor-not-allowed opacity-50'
                : 'bg-no/[0.15] border-no text-no hover:bg-no/25'
            )}
          >
            <span className="text-[0.8125rem] font-bold">Buy NO</span>
            {displayYesCents > 0 && (
              <span className="font-mono text-xs opacity-80">
                {100 - displayYesCents}¢
              </span>
            )}
          </button>
        </div>

        {/* Real-time progress banner */}
        {analysisStatus.state !== 'none' && (
          <AnalysisStatusBanner status={analysisStatus} />
        )}

        {analysisStatus.state === 'none' && (
          <div className="text-center py-6 border border-dashed border-border rounded-lg">
            <p className="text-sm text-muted mb-3">{disabled ? 'Market resolved' : 'No analysis available yet'}</p>
            {!disabled && (
              <p className="text-xs text-muted mb-4">
                Request an analysis to get AI-powered recommendations
              </p>
            )}
            <Button variant="ai" size="sm" onClick={onRequestAnalysis} disabled={disabled}>
              {disabled ? 'Market Resolved' : 'Get Analysis'}
            </Button>
          </div>
        )}
      </Card>
    );
  }

  return (
    <Card variant="ai" className="p-6">
      {/* Panel Header */}
      <div className="flex items-center gap-2 mb-5">
        <span className="w-6 h-6 rounded-md bg-ai/20 flex items-center justify-center text-xs">
          🧠
        </span>
        <h3 className="text-sm font-semibold flex-1">AI Intelligence</h3>
        {analysis?.executedAt && (
          <div className="flex items-center gap-1.5">
            <FreshnessBadge executedAt={analysis.executedAt} />
            <span className="text-[0.65rem] text-muted">
              {formatFreshness(analysis.executedAt)}
            </span>
          </div>
        )}
      </div>

      {/* Real-time progress banner (refresh in progress) */}
      {analysisStatus.state !== 'none' && (
        <div className="mb-5">
          <AnalysisStatusBanner status={analysisStatus} />
        </div>
      )}

      {/* Recommendation Badge */}
      <div
        className={cn(
          'flex items-center gap-3 rounded-lg p-3.5 mb-5 border',
          action === 'LONG_YES' && 'bg-yes/[0.08] border-yes/20',
          action === 'LONG_NO' && 'bg-no/[0.08] border-no/20',
          action === 'NO_TRADE' && 'bg-surface-2 border-border'
        )}
      >
        <Badge tone={recTone as 'yes' | 'no' | 'muted'} size="md">
          {recLabel}
        </Badge>
        {edge !== 0 && (
          <span
            className={cn(
              'font-mono text-sm',
              action === 'LONG_YES' && 'text-yes',
              action === 'LONG_NO' && 'text-no',
              action === 'NO_TRADE' && 'text-muted'
            )}
          >
            {displayEdge > 0 ? '+' : ''}{(displayEdge * 100).toFixed(1)}¢ edge
          </span>
        )}
      </div>

      {/* Quick Buy Buttons */}
      <div className="grid grid-cols-2 gap-2 mb-5">
        <button
          type="button"
          onClick={() => onQuickBuy?.('yes')}
          disabled={disabled}
          aria-label="Buy YES"
          className={cn(
            'flex flex-col items-center gap-1 p-3 rounded-[10px] border-[1.5px] transition-colors',
            disabled
              ? 'bg-surface-2 border-border text-muted cursor-not-allowed opacity-50'
              : 'bg-yes/[0.15] border-yes text-yes hover:bg-yes/25',
            !disabled && action === 'LONG_YES' && 'shadow-[0_0_0_2px_var(--yes),0_0_12px_oklch(72%_0.16_155_/_0.2)]'
          )}
        >
          <span className="text-[0.8125rem] font-bold">Buy YES</span>
          {displayYesCents > 0 && (
            <span className="font-mono text-xs opacity-80">
              {displayYesCents}¢
            </span>
          )}
        </button>
        <button
          type="button"
          onClick={() => onQuickBuy?.('no')}
          disabled={disabled}
          aria-label="Buy NO"
          className={cn(
            'flex flex-col items-center gap-1 p-3 rounded-[10px] border-[1.5px] transition-colors',
            disabled
              ? 'bg-surface-2 border-border text-muted cursor-not-allowed opacity-50'
              : 'bg-no/[0.15] border-no text-no hover:bg-no/25',
            !disabled && action === 'LONG_NO' && 'shadow-[0_0_0_2px_var(--no),0_0_12px_oklch(65%_0.18_25_/_0.2)]'
          )}
        >
          <span className="text-[0.8125rem] font-bold">Buy NO</span>
          {displayYesCents > 0 && (
            <span className="font-mono text-xs opacity-80">
              {100 - displayYesCents}¢
            </span>
          )}
        </button>
      </div>

      {/* Confidence Meter */}
      <div className="mb-5">
        <div className="flex justify-between text-[0.7rem] text-muted mb-1.5">
          <span>Confidence</span>
          <span className="font-mono">{(confidence * 100).toFixed(0)}%</span>
        </div>
        <div className="h-1 bg-surface-2 rounded-full overflow-hidden">
          <div
            className="h-full bg-ai rounded-full transition-all"
            style={{ width: `${Math.min(confidence * 100, 100)}%` }}
          />
        </div>
      </div>

      {/* Trade Summary */}
      {summary && (
        <div className="mb-5">
          <h4 className="text-xs text-muted uppercase tracking-wider mb-2">
            Trade Summary
          </h4>
          <p className="text-[0.8125rem] leading-relaxed text-fg/85 font-medium">
            {summary}
          </p>
        </div>
      )}

      {/* Thesis Section */}
      {thesis && (
        <div className="mb-5">
          <h4 className="text-xs text-muted uppercase tracking-wider mb-2">
            Core Thesis
          </h4>
          <p className="text-[0.8125rem] leading-relaxed text-fg/85">
            {thesis}
          </p>
        </div>
      )}

      {/* Edge Visualization */}
      {(marketProb > 0 || consensusProb > 0) && (
        <div className="mb-5 p-3.5 bg-surface-2 rounded-lg">
          <div className="flex justify-between text-[0.7rem] text-muted mb-2">
            <span>Edge Visualization</span>
            <span className={cn('font-mono font-semibold', displayEdge > 0 ? 'text-yes' : displayEdge < 0 ? 'text-no' : 'text-muted')}>
              {displayEdge > 0 ? '+' : ''}{(displayEdge * 100).toFixed(1)}¢
            </span>
          </div>
          {action === 'LONG_NO' ? (
            <>
              <ProbabilityBar cents={Math.round((1 - marketProb) * 100)} aiCents={Math.round((1 - consensusProb) * 100)} variant="thick" />
              <div className="flex justify-between text-[0.6rem] text-muted mt-1.5">
                <span>Market (NO): {Math.round((1 - marketProb) * 100)}¢</span>
                <span className="text-ai">AI (NO): {Math.round((1 - consensusProb) * 100)}¢</span>
              </div>
            </>
          ) : (
            <>
              <ProbabilityBar cents={Math.round(marketProb * 100)} aiCents={Math.round(consensusProb * 100)} variant="thick" />
              <div className="flex justify-between text-[0.6rem] text-muted mt-1.5">
                <span>Market: {Math.round(marketProb * 100)}¢</span>
                <span className="text-ai">AI: {Math.round(consensusProb * 100)}¢</span>
              </div>
            </>
          )}
        </div>
      )}

      {/* Trade Zones Slider */}
      {analysis && (analysis.entryZone[0] > 0 || analysis.targetZone[0] > 0) && (
        <TradeZonesSlider
          entryZone={analysis.entryZone}
          targetZone={analysis.targetZone}
          stopLoss={analysis.stopLoss}
          currentPrice={liveYesCents != null ? liveYesCents / 100 : analysis.metadata.marketProbability}
          action={action}
        />
      )}

      {/* Expandable Sections */}
      <div className="flex flex-col gap-3 mt-5">
        {/* Agent Signals */}
        {agentsUsed.length > 0 && (
          <Expandable
            summary={
              <span className="flex items-center gap-1.5">
                Agent Signals
                <InfoHint label="What agent signals mean">
                  ↑ means the agent leans YES, ↓ means it leans NO, → means it
                  has no strong view. The % is how confident the agent is in its
                  own call. Neutral agents are not counted toward the final
                  signal.
                </InfoHint>
              </span>
            }
            meta={`${agentsUsed.length} agents`}
          >
            <AgentSignalsGrid
              agents={agentsUsed}
              signals={signals}
            />
          </Expandable>
        )}

        {/* Bull vs Bear Debate */}
        {(analysis?.bullThesis || analysis?.bearThesis) && (
          <Expandable summary="Bull vs Bear Debate">
            <DebatePanel
              bullThesis={analysis.bullThesis}
              bearThesis={analysis.bearThesis}
              crossExamination={analysis.crossExamination}
            />
          </Expandable>
        )}

        {/* Consensus */}
        {consensusProb > 0 && (
          <Expandable summary="Consensus" meta={`${Math.round(consensusProb * 100)}¢`}>
            <ConsensusDetail
              consensusProb={consensusProb}
              marketProb={marketProb}
              edge={displayEdge}
              confidenceBand={analysis?.metadata?.confidenceBand}
              action={action}
            />
          </Expandable>
        )}

        {/* Position Sizing */}
        {riskPerspectives && (
          <Expandable summary="Position Sizing">
            <PositionSizingGrid riskPerspectives={riskPerspectives} />
          </Expandable>
        )}

        {/* Risk Factors */}
        {failureScenarios.length > 0 && (
          <Expandable summary="Risk Factors" meta={`${failureScenarios.length}`}>
            <RiskFactorsList risks={failureScenarios} />
          </Expandable>
        )}

        {/* Key Catalysts */}
        {keyCatalysts.length > 0 && (
          <Expandable summary="Key Catalysts" meta={`${keyCatalysts.length}`}>
            <CatalystsList catalysts={keyCatalysts} />
          </Expandable>
        )}
      </div>

      {/* Refresh Analysis Button */}
      <div className="mt-5">
        <RefreshButton executedAt={analysis?.executedAt} onRequestAnalysis={onRequestAnalysis} disabled={disabled} />
      </div>

      {/* Recurring Analysis Subscription Indicator */}
      <RecurringScheduleIndicator marketId={marketSlug} />
    </Card>
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
    <div className="mb-5 rounded-lg border border-border/50 overflow-hidden">
      {/* Header */}
      <div className="px-3.5 pt-3 pb-2 flex items-center justify-between">
        <span className="text-[0.7rem] text-muted font-medium uppercase tracking-wider">
          Trade Zones {isNo ? '(NO token)' : ''}
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

  // Elapsed time counter
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    const startTime = progress?.timestamp
      ? new Date(progress.timestamp).getTime()
      : Date.now();
    function tick() {
      setElapsed(Math.floor((Date.now() - startTime) / 1000));
    }
    tick();
    const interval = setInterval(tick, 1000);
    return () => clearInterval(interval);
  }, [progress?.timestamp]);

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

function AgentSignalsGrid({
  agents,
  signals,
}: {
  agents: string[];
  signals: Array<{
    agentName: string;
    direction: string;
    confidence: number;
  }>;
}) {
  return (
    <div className="grid grid-cols-2 gap-2">
      {agents.map((agent) => {
        const signal = signals.find((s) => s.agentName === agent);
        const isUp = signal?.direction === 'LONG_YES' || signal?.direction === 'YES';
        const isDown = signal?.direction === 'LONG_NO' || signal?.direction === 'NO';

        return (
          <div
            key={agent}
            className="flex items-center gap-1.5 bg-surface-2 rounded-md px-2.5 py-2"
          >
            <span
              className={cn(
                'text-[0.7rem]',
                isUp && 'text-yes',
                isDown && 'text-no',
                !isUp && !isDown && 'text-muted'
              )}
            >
              {isUp ? '↑' : isDown ? '↓' : '→'}
            </span>
            <span className="text-[0.65rem] text-muted flex-1 truncate">
              {formatAgentName(agent)}
            </span>
            {signal && (
              <span className="font-mono text-[0.6rem] text-fg">
                {(signal.confidence * 100).toFixed(0)}%
              </span>
            )}
          </div>
        );
      })}
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
            <div className="text-[0.7rem] font-semibold text-yes flex items-center gap-1.5">
              <span>↑</span> Bull Case
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
            <div className="text-[0.7rem] font-semibold text-no flex items-center gap-1.5">
              <span>↓</span> Bear Case
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

function PositionSizingGrid({
  riskPerspectives,
}: {
  riskPerspectives: string;
}) {
  // Parse risk perspectives text into sizing cards
  // The backend returns a string with aggressive/conservative/neutral guidance
  const perspectives = parseRiskPerspectives(riskPerspectives);

  return (
    <div className="grid grid-cols-3 gap-2">
      {perspectives.map((p) => (
        <div
          key={p.label}
          className={cn(
            'text-center p-3 rounded-md bg-bg border border-border',
            p.active && 'border-ai bg-ai/[0.06]'
          )}
        >
          <div className="text-[0.65rem] text-muted uppercase tracking-wider mb-1">
            {p.label}
          </div>
          <div
            className={cn(
              'font-mono text-base font-bold mb-1',
              p.active && 'text-ai'
            )}
          >
            {p.size}
          </div>
          <div className="text-[0.6rem] text-muted leading-snug">
            {p.note}
          </div>
        </div>
      ))}
    </div>
  );
}

function RiskFactorsList({ risks }: { risks: string[] }) {
  return (
    <div className="flex flex-col gap-2">
      {risks.map((risk, i) => (
        <div key={i} className="flex gap-2 text-xs leading-relaxed text-fg/80">
          <span className="text-warning shrink-0">⚠</span>
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
      size="sm"
      className="w-full"
      onClick={onRequestAnalysis}
      disabled={disabled}
    >
      {cooldownText
        ? `Refresh Analysis (${cooldownText})`
        : 'Refresh Analysis'}
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

function formatAgentName(name: string): string {
  return name
    .replace(/_/g, ' ')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

interface SizingPerspective {
  label: string;
  size: string;
  note: string;
  active: boolean;
}

function parseRiskPerspectives(text: string): SizingPerspective[] {
  // Default sizing cards if we can't parse the text
  const defaults: SizingPerspective[] = [
    { label: 'Aggressive', size: '15%', note: 'Max EV', active: false },
    { label: 'Neutral', size: '8%', note: 'Balanced', active: true },
    { label: 'Conservative', size: '3%', note: 'Capital pres.', active: false },
  ];

  if (!text) return defaults;

  // Parse labeled sections: [aggressive] ```json {...} ```, [conservative] ..., [neutral] ...
  const extractSize = (label: string): string | null => {
    // Find the section for this label
    const sectionRegex = new RegExp(`\\[${label}\\].*?\\{([^}]*"position_size_pct"\\s*:\\s*([\\d.]+)[^}]*)\\}`, 's');
    const match = text.match(sectionRegex);
    if (match && match[2]) {
      const pct = parseFloat(match[2]);
      // position_size_pct can be 0.35 (meaning 35%) or 2.5 (meaning 2.5%) - both are percentages
      // Values > 1 are already in percent, values <= 1 need to be multiplied by 100
      const displayPct = pct > 1 ? pct : Math.round(pct * 100);
      return `${displayPct}%`;
    }
    return null;
  };

  const aggressive = extractSize('aggressive');
  const conservative = extractSize('conservative');
  const neutral = extractSize('neutral');

  if (aggressive || conservative || neutral) {
    return [
      { label: 'Aggressive', size: aggressive || '15%', note: 'Max EV', active: false },
      { label: 'Neutral', size: neutral || '8%', note: 'Balanced', active: true },
      { label: 'Conservative', size: conservative || '3%', note: 'Capital pres.', active: false },
    ];
  }

  return defaults;
}
