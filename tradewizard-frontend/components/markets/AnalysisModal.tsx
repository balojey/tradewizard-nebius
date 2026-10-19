'use client';

import { useMemo, useState, useCallback, useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { useAnalysisProgress } from '@/hooks/useAnalysisProgress';
import { useCurrentPlan } from '@/hooks/useCurrentPlan';
import { useSubscription, useOptimisticCreditDecrement } from '@/hooks/useSubscription';
import { useAnalysisSubscriptions, useCancelAnalysisSubscription } from '@/hooks/useAnalysisSubscriptions';
import { useAuth } from '@/hooks/useAuth';
import { apiClient, InsufficientCreditsError } from '@/lib/api-client';
import { cn } from '@/utils/classNames';
import type { Interval } from '@/constants/plans';

/** The 11 stages of the analysis pipeline, in order. */
const ANALYSIS_STAGES = [
  { id: 1, label: 'Market Ingestion' },
  { id: 2, label: 'Memory Retrieval' },
  { id: 3, label: 'Web Research' },
  { id: 4, label: 'Agent Selection' },
  { id: 5, label: 'Intelligence Agents' },
  { id: 6, label: 'Signal Fusion' },
  { id: 7, label: 'Thesis Construction' },
  { id: 8, label: 'Cross-Examination' },
  { id: 9, label: 'Consensus Engine' },
  { id: 10, label: 'Risk Philosophy' },
  { id: 11, label: 'Recommendation' },
] as const;

type StageStatus = 'pending' | 'active' | 'done';

type RequestType = 'one_time' | 'recurring';

type ModalPhase = 'request' | 'progress' | 'cooldown';

interface IntervalOption {
  label: string;
  seconds: number;
  interval: Interval;
}

const INTERVAL_OPTIONS: IntervalOption[] = [
  { label: '1 hour', seconds: 3600, interval: '1h' },
  { label: '4 hours', seconds: 14400, interval: '4h' },
  { label: '12 hours', seconds: 43200, interval: '12h' },
  { label: '1 day', seconds: 86400, interval: '1d' },
];

function formatIntervalDisplay(seconds: number | null): string {
  if (!seconds) return '-';
  const option = INTERVAL_OPTIONS.find((o) => o.seconds === seconds);
  return option?.label ?? `${seconds / 3600}h`;
}

interface AnalysisResponse {
  requestId?: string;
  resultId?: string;
  status?: string;
  recommendation?: string;
  consensusProbability?: number;
  resultPayloadS3Key?: string;
  executedAt?: string;
  nextAnalysisAt?: string;
  nextAvailableAt?: string;
  message?: string;
}

interface AnalysisModalProps {
  slug: string;
  open: boolean;
  onClose: () => void;
  hasExistingAnalysis?: boolean;
}

/**
 * Analysis Modal - two-phase:
 * 1. Request phase: user picks one-time or recurring, confirms the request
 * 2. Progress phase: 11-stage pipeline driven by WebSocket updates
 *
 * This component both triggers the POST /analysis call AND shows progress.
 */
export function AnalysisModal({
  slug,
  open,
  onClose,
  hasExistingAnalysis = false,
}: AnalysisModalProps) {
  const { isAuthenticated } = useAuth();
  const { plan, intervals } = useCurrentPlan();
  const { data: subscription } = useSubscription();
  const { data: existingSubscriptions } = useAnalysisSubscriptions();
  const { mutate: cancelSubscription, isPending: isCancellingSubscription } = useCancelAnalysisSubscription();
  const decrementCredits = useOptimisticCreditDecrement();
  const queryClient = useQueryClient();

  const [phase, setPhase] = useState<ModalPhase>('request');
  const [requestType, setRequestType] = useState<RequestType>('one_time');
  const [intervalSeconds, setIntervalSeconds] = useState<number | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [requestId, setRequestId] = useState<string | null>(null);
  const [cooldownMessage, setCooldownMessage] = useState<string | null>(null);
  const [nextAvailableAt, setNextAvailableAt] = useState<string | null>(null);

  // Progress tracking - match by marketId so we pick up progress even for shared pool
  const progress = useAnalysisProgress({ marketId: slug });

  const creditsRemaining = subscription?.creditsRemaining ?? null;
  const isElite = plan === 'elite';

  // Check if user already has an active recurring subscription on this market
  const existingMarketSubscription = useMemo(() => {
    if (!existingSubscriptions) return null;
    return existingSubscriptions.find(
      (sub) => sub.marketId === slug && sub.status === 'active'
    ) ?? null;
  }, [existingSubscriptions, slug]);

  // Available intervals based on plan
  const availableIntervals = useMemo(() => {
    return INTERVAL_OPTIONS.filter((opt) => intervals.includes(opt.interval));
  }, [intervals]);

  const canRecur = availableIntervals.length > 0;

  // Reset state when modal closes
  const handleClose = useCallback(() => {
    setPhase('request');
    setRequestType('one_time');
    setIntervalSeconds(null);
    setIsSubmitting(false);
    setError(null);
    setRequestId(null);
    setCooldownMessage(null);
    setNextAvailableAt(null);
    onClose();
  }, [onClose]);

  // Submit the analysis request
  const handleSubmit = useCallback(async () => {
    if (!isAuthenticated) {
      setError('Please sign in to request an analysis.');
      return;
    }

    if (requestType === 'recurring' && !intervalSeconds) {
      setError('Please select an interval for recurring analysis.');
      return;
    }

    setIsSubmitting(true);
    setError(null);

    try {
      const body: Record<string, unknown> = {
        marketId: slug,
        requestType,
      };

      if (requestType === 'recurring' && intervalSeconds) {
        body.intervalSeconds = intervalSeconds;
      }

      const response = await apiClient.post<AnalysisResponse>('/analysis', body);

      // If the backend says user already has the latest result (cooldown) - no credit charged
      if (
        response.status === 'already_delivered' ||
        response.status === 'subscribed_to_upcoming' ||
        response.status === 'recurring_scheduled'
      ) {
        setCooldownMessage(response.message || 'You already have the latest analysis.');
        setNextAvailableAt(response.nextAvailableAt || response.nextAnalysisAt || null);
        setPhase('cooldown');

        // If a recurring schedule was created, update the subscriptions list
        if (response.status === 'recurring_scheduled' || response.status === 'subscribed_to_upcoming') {
          queryClient.invalidateQueries({ queryKey: ['analysis-subscriptions'] });
        }
        return;
      }

      // Credit was charged - optimistic decrement in the UI
      decrementCredits();

      // If the backend returned a completed result immediately (cached), close modal
      if (response.status === 'completed' && response.resultId) {
        // Invalidate the analysis query so AIPanel picks up the new result
        queryClient.invalidateQueries({ queryKey: ['market-analysis', slug] });
        handleClose();
        return;
      }

      // Transition to progress phase
      setRequestId(response.requestId || null);
      setPhase('progress');

      // Invalidate the analysis-status query so the AIPanel banner updates immediately
      queryClient.invalidateQueries({ queryKey: ['analysis-status', slug] });

      // Invalidate subscriptions list if this was a recurring request
      if (requestType === 'recurring') {
        queryClient.invalidateQueries({ queryKey: ['analysis-subscriptions'] });
      }
    } catch (err) {
      if (err instanceof InsufficientCreditsError) {
        setError('Insufficient credits. Top up credits in your account settings.');
      } else if (err instanceof Error && 'body' in err) {
        // ApiError with body - extract the message from the response payload
        const apiErr = err as { status?: number; body?: { message?: string; code?: string; error?: string } };
        if (apiErr.status === 409 && apiErr.body?.code === 'DUPLICATE_RECURRING') {
          setError(apiErr.body.message || 'You already have a recurring analysis on this market.');
          // Refresh subscriptions in case state is stale
          queryClient.invalidateQueries({ queryKey: ['analysis-subscriptions'] });
        } else if (apiErr.status === 409 && apiErr.body?.code === 'RECURRING_ACTIVE') {
          setError(apiErr.body.message || 'Cancel your recurring analysis first to request a one-time analysis.');
          queryClient.invalidateQueries({ queryKey: ['analysis-subscriptions'] });
        } else {
          setError(apiErr.body?.message || apiErr.body?.error || err.message);
        }
      } else if (err instanceof Error) {
        setError(err.message);
      } else {
        setError('An unexpected error occurred. Please try again.');
      }
    } finally {
      setIsSubmitting(false);
    }
  }, [isAuthenticated, requestType, intervalSeconds, slug, decrementCredits, handleClose, queryClient]);

  // Stage status computation for progress phase
  const stageStatuses = useMemo((): StageStatus[] => {
    if (!progress) {
      return ANALYSIS_STAGES.map(() => 'pending');
    }

    const currentStage = progress.stage;
    const hookStatus = progress.status;

    return ANALYSIS_STAGES.map((_, index) => {
      const stageNumber = index + 1;

      if (stageNumber < currentStage) {
        return 'done';
      }
      if (stageNumber === currentStage) {
        if (hookStatus === 'completed') return 'done';
        return 'active';
      }
      return 'pending';
    });
  }, [progress]);

  const activeStageLabel = useMemo(() => {
    if (!progress) return null;
    const activeIndex = stageStatuses.findIndex((s) => s === 'active');
    if (activeIndex === -1) return null;
    return ANALYSIS_STAGES[activeIndex].label;
  }, [progress, stageStatuses]);

  const isComplete = progress?.status === 'completed';
  const isFailed = progress?.status === 'failed';

  const title = hasExistingAnalysis ? 'Refresh Analysis' : 'Get Analysis';

  return (
    <Modal open={open} onClose={handleClose} title={title} size="md">
      {phase === 'request' ? (
        <div className="space-y-5">
          {/* Credit Balance */}
          <div className="flex items-center justify-between rounded-lg bg-surface-2 px-4 py-3">
            <span className="text-sm text-muted">Credits remaining</span>
            <span
              className={cn(
                'text-sm font-semibold',
                creditsRemaining === 0 ? 'text-no' : 'text-fg'
              )}
            >
              {isElite ? '∞' : creditsRemaining === null ? '…' : creditsRemaining}
            </span>
          </div>

          {/* Request Type Toggle */}
          <div>
            <p className="mb-2 text-sm font-medium text-fg">Request type</p>
            <div className="flex gap-2">
              <Button
                variant={requestType === 'one_time' ? 'primary' : 'secondary'}
                size="sm"
                className="flex-1"
                onClick={() => {
                  setRequestType('one_time');
                  setIntervalSeconds(null);
                }}
                disabled={!!existingMarketSubscription}
              >
                One-time
              </Button>
              <Button
                variant={requestType === 'recurring' ? 'primary' : 'secondary'}
                size="sm"
                className="flex-1"
                onClick={() => setRequestType('recurring')}
                disabled={!canRecur || !!existingMarketSubscription}
              >
                Recurring
              </Button>
            </div>
            {!canRecur && !existingMarketSubscription && (
              <p className="mt-1.5 text-xs text-muted">
                Recurring analysis requires a paid plan.
              </p>
            )}
          </div>

          {/* Existing Recurring Subscription Warning */}
          {existingMarketSubscription && (
            <div className="rounded-lg border border-accent/30 bg-accent/5 px-4 py-3">
              <p className="text-sm text-fg font-medium mb-1">
                Active recurring analysis
              </p>
              <p className="text-xs text-muted mb-2">
                You already have a recurring analysis set to every{' '}
                <span className="font-mono font-semibold text-accent">
                  {formatIntervalDisplay(existingMarketSubscription.intervalSeconds)}
                </span>{' '}
                on this market. Cancel it first to request a one-time or different recurring analysis.
                {existingMarketSubscription.nextScheduledRun && (
                  (() => {
                    const nextRun = new Date(existingMarketSubscription.nextScheduledRun).getTime();
                    if (nextRun > Date.now()) {
                      return (
                        <> Next delivery:{' '}
                          <span className="font-mono text-fg">
                            {new Date(nextRun).toLocaleString()}
                          </span>
                        </>
                      );
                    }
                    // Stale nextScheduledRun - compute from interval
                    if (existingMarketSubscription.intervalSeconds) {
                      const createdMs = new Date(existingMarketSubscription.createdAt).getTime();
                      const intervalMs = existingMarketSubscription.intervalSeconds * 1000;
                      const elapsed = Date.now() - createdMs;
                      const computedNext = createdMs + Math.ceil(elapsed / intervalMs) * intervalMs;
                      return (
                        <> Next delivery:{' '}
                          <span className="font-mono text-fg">
                            {new Date(computedNext).toLocaleString()}
                          </span>
                        </>
                      );
                    }
                    return null;
                  })()
                )}
              </p>
              <Button
                variant="secondary"
                size="sm"
                onClick={() => {
                  cancelSubscription(existingMarketSubscription.id);
                }}
                disabled={isCancellingSubscription}
                className="text-xs"
              >
                {isCancellingSubscription ? 'Cancelling…' : 'Cancel recurring to unlock requests'}
              </Button>
            </div>
          )}

          {/* Interval Selection */}
          {requestType === 'recurring' && canRecur && (
            <div>
              <p className="mb-2 text-sm font-medium text-fg">Interval</p>
              <div className="grid grid-cols-2 gap-2">
                {availableIntervals.map((option) => (
                  <Button
                    key={option.seconds}
                    variant={intervalSeconds === option.seconds ? 'primary' : 'secondary'}
                    size="sm"
                    onClick={() => setIntervalSeconds(option.seconds)}
                  >
                    {option.label}
                  </Button>
                ))}
              </div>
            </div>
          )}

          {/* Error */}
          {error && (
            <div className="rounded-lg border border-no/30 bg-no/10 px-4 py-3">
              <p className="text-sm text-no">{error}</p>
            </div>
          )}

          {/* Actions */}
          <div className="flex gap-3 pt-2 border-t border-border">
            <Button variant="secondary" size="sm" className="flex-1" onClick={handleClose}>
              Cancel
            </Button>
            <Button
              variant="ai"
              size="sm"
              className="flex-1"
              onClick={handleSubmit}
              disabled={isSubmitting || !!existingMarketSubscription || (requestType === 'recurring' && !intervalSeconds)}
            >
              {isSubmitting ? 'Requesting…' : 'Request Analysis'}
            </Button>
          </div>
        </div>
      ) : phase === 'progress' ? (
        <div className="space-y-4">
          {/* Progress pipeline */}
          <div className="space-y-1" role="list" aria-label="Analysis progress stages">
            {ANALYSIS_STAGES.map((stage, index) => {
              const status = stageStatuses[index];
              return (
                <StageRow
                  key={stage.id}
                  number={stage.id}
                  label={stage.label}
                  status={status}
                />
              );
            })}
          </div>

          {/* aria-live region for screen reader announcements */}
          <div aria-live="polite" aria-atomic="true" className="sr-only">
            {activeStageLabel && `Currently processing: ${activeStageLabel}`}
            {isComplete && 'Analysis complete'}
            {isFailed && 'Analysis failed'}
          </div>

          {/* Status footer */}
          {isComplete && (
            <div className="pt-2 border-t border-border">
              <p className="text-sm text-yes font-medium">
                Analysis complete - results are ready.
              </p>
              <Button
                variant="primary"
                size="sm"
                className="mt-3 w-full"
                onClick={handleClose}
              >
                View Results
              </Button>
            </div>
          )}

          {isFailed && (
            <div className="pt-2 border-t border-border">
              <p className="text-sm text-no font-medium">
                Analysis failed. Please try again.
              </p>
              <Button
                variant="secondary"
                size="sm"
                className="mt-3 w-full"
                onClick={handleClose}
              >
                Close
              </Button>
            </div>
          )}

          {!progress && !isComplete && !isFailed && (
            <div className="pt-2 border-t border-border">
              <p className="text-sm text-muted">
                Waiting for analysis to start…
              </p>
            </div>
          )}
        </div>
      ) : (
        <CooldownPhase
          message={cooldownMessage}
          nextAvailableAt={nextAvailableAt}
          onClose={handleClose}
        />
      )}
    </Modal>
  );
}

/** Individual stage row in the progress pipeline. */
function StageRow({
  number,
  label,
  status,
}: {
  number: number;
  label: string;
  status: StageStatus;
}) {
  return (
    <div
      role="listitem"
      className={cn(
        'flex items-center gap-3 px-3 py-2 rounded-lg transition-colors',
        status === 'active' && 'bg-surface-2',
        status === 'done' && 'opacity-70'
      )}
    >
      {/* Status indicator */}
      <StageIndicator status={status} number={number} />

      {/* Label */}
      <span
        className={cn(
          'text-sm',
          status === 'pending' && 'text-muted',
          status === 'active' && 'text-fg font-medium',
          status === 'done' && 'text-muted line-through'
        )}
      >
        {label}
      </span>

      {/* Status text for accessibility */}
      <span className="sr-only">
        {status === 'pending' && '- pending'}
        {status === 'active' && '- in progress'}
        {status === 'done' && '- complete'}
      </span>
    </div>
  );
}

/** Visual indicator for each stage: gray dot (pending), pulsing accent (active), green check (done). */
function StageIndicator({
  status,
  number,
}: {
  status: StageStatus;
  number: number;
}) {
  if (status === 'done') {
    return (
      <div className="flex h-6 w-6 items-center justify-center rounded-full bg-yes/15">
        <svg
          className="h-3.5 w-3.5 text-yes"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={3}
          aria-hidden="true"
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
        </svg>
      </div>
    );
  }

  if (status === 'active') {
    return (
      <div className="relative flex h-6 w-6 items-center justify-center">
        {/* Pulsing ring */}
        <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-accent/30" />
        <span className="relative flex h-4 w-4 items-center justify-center rounded-full bg-accent text-[10px] font-bold text-white">
          {number}
        </span>
      </div>
    );
  }

  // Pending: gray dot with number
  return (
    <div className="flex h-6 w-6 items-center justify-center rounded-full bg-surface-2 border border-border">
      <span className="text-[10px] font-medium text-muted">{number}</span>
    </div>
  );
}

/** Button to trigger opening the analysis modal. */
export function GetAnalysisButton({
  hasExistingAnalysis = false,
  onClick,
  className,
}: {
  hasExistingAnalysis?: boolean;
  onClick: () => void;
  className?: string;
}) {
  return (
    <Button
      variant="ai"
      size="sm"
      className={cn('w-full', className)}
      onClick={onClick}
    >
      {hasExistingAnalysis ? 'Refresh Analysis' : 'Get Analysis'}
    </Button>
  );
}

/** Cooldown phase - shown when the user already has the latest result. */
function CooldownPhase({
  message,
  nextAvailableAt,
  onClose,
}: {
  message: string | null;
  nextAvailableAt: string | null;
  onClose: () => void;
}) {
  const [timeRemaining, setTimeRemaining] = useState<string>('');

  useEffect(() => {
    if (!nextAvailableAt) return;

    function updateCountdown() {
      const now = Date.now();
      const target = new Date(nextAvailableAt!).getTime();
      const diffMs = target - now;

      if (diffMs <= 0) {
        setTimeRemaining('Available now');
        return;
      }

      const minutes = Math.floor(diffMs / 60000);
      const seconds = Math.floor((diffMs % 60000) / 1000);
      setTimeRemaining(`${minutes}m ${seconds.toString().padStart(2, '0')}s`);
    }

    updateCountdown();
    const interval = setInterval(updateCountdown, 1000);
    return () => clearInterval(interval);
  }, [nextAvailableAt]);

  return (
    <div className="space-y-5">
      {/* Cooldown indicator */}
      <div className="flex flex-col items-center text-center py-4">
        <div className="w-14 h-14 rounded-full bg-ai/10 flex items-center justify-center mb-4">
          <svg
            className="w-7 h-7 text-ai"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={1.5}
            aria-hidden="true"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M12 6v6h4.5m4.5 0a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z"
            />
          </svg>
        </div>

        <p className="text-sm text-fg font-medium mb-2">
          {message || 'You already have the latest analysis.'}
        </p>

        {nextAvailableAt && timeRemaining && (
          <div className="rounded-lg bg-surface-2 px-4 py-3 w-full">
            <p className="text-xs text-muted mb-1">Next fresh analysis available in</p>
            <p className="text-lg font-mono font-semibold text-ai" aria-live="polite">
              {timeRemaining}
            </p>
          </div>
        )}
      </div>

      {/* Actions */}
      <div className="pt-2 border-t border-border">
        <Button variant="secondary" size="sm" className="w-full" onClick={onClose}>
          Got it
        </Button>
      </div>
    </div>
  );
}
