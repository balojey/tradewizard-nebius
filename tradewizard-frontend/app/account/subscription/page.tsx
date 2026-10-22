'use client';

import { useState, useCallback, useRef } from 'react';
import {
  AlertTriangle,
  ArrowRight,
  CalendarClock,
  Check,
  CheckCircle2,
  CreditCard,
  Info,
  Loader2,
  RefreshCw,
  X,
  XCircle,
} from 'lucide-react';
import { AppShell } from '@/components/shell/AppShell';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';
import {
  useWalletSubscription,
  useSubscribePlan,
  usePurchaseCreditPack,
  useCancelSubscription as useWalletCancelSubscription,
  useStartTrial,
  useManualRenew,
} from '@/hooks/useWalletSubscription';
import { useCurrentPlan } from '@/hooks/useCurrentPlan';
import { cn } from '@/utils/classNames';
import { type Plan, planAtLeast } from '@/constants/plans';
import { usePaymentHistory } from './usePaymentHistory';
import {
  parseSubscriptionError,
  type ErrorSeverity,
} from '@/utils/subscription-errors';

// ---------------------------------------------------------------------------
// Plan & Credit Pack Configuration
// ---------------------------------------------------------------------------

interface PlanInfo {
  planId: Plan;
  name: string;
  price: number;
  credits: string;
  features: string[];
}

const PLANS: PlanInfo[] = [
  {
    planId: 'free',
    name: 'Free',
    price: 0,
    credits: '20 credits/month',
    features: [
      'One-time analysis only',
      'In-app notifications',
      'Basic market data',
    ],
  },
  {
    planId: 'starter',
    name: 'Starter',
    price: 19,
    credits: '100 credits/month',
    features: [
      'One-time + daily analysis',
      'In-app + email + push',
      'Full market data',
      'Credit pack purchases',
    ],
  },
  {
    planId: 'pro',
    name: 'Pro',
    price: 49,
    credits: '350 credits/month',
    features: [
      'All analysis intervals',
      'All notification channels',
      'Webhook delivery',
      'Portfolio Manager (3 markets)',
      'Priority processing',
    ],
  },
  {
    planId: 'elite',
    name: 'Elite',
    price: 149,
    credits: 'Unlimited credits',
    features: [
      'Unlimited analyses',
      'All channels + webhook',
      'Portfolio Manager (10 markets)',
      'Persona customization (full tuning)',
      'Fastest processing',
      'Dedicated support',
    ],
  },
];

const CREDIT_PACKS = [
  { packId: 'pack_20', credits: 20, price: 4.99 },
  { packId: 'pack_45', credits: 45, price: 9.99 },
  { packId: 'pack_75', credits: 75, price: 14.99 },
] as const;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatDate(dateStr: string | null): string {
  if (!dateStr) return '-';
  return new Date(dateStr).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

function getPlanAction(
  currentPlan: Plan,
  targetPlan: Plan
): 'upgrade' | 'downgrade' | 'current' {
  if (currentPlan === targetPlan) return 'current';
  return planAtLeast(currentPlan, targetPlan) ? 'downgrade' : 'upgrade';
}

// ---------------------------------------------------------------------------
// Error Modal Component
// ---------------------------------------------------------------------------

type FeedbackSeverity = ErrorSeverity | 'success';

interface FeedbackData {
  severity: FeedbackSeverity;
  title: string;
  message: string;
  retryable?: boolean;
  onRetry?: () => void;
}

function ErrorModal({
  data,
  onClose,
}: {
  data: FeedbackData;
  onClose: () => void;
}) {
  const Icon = {
    error: XCircle,
    warning: AlertTriangle,
    info: Info,
    success: CheckCircle2,
  }[data.severity];

  const iconColor: Record<FeedbackSeverity, string> = {
    success: 'text-yes',
    error: 'text-no',
    warning: 'text-warning',
    info: 'text-accent',
  };

  const iconBg: Record<FeedbackSeverity, string> = {
    success: 'bg-yes/10',
    error: 'bg-no/10',
    warning: 'bg-warning/10',
    info: 'bg-accent/10',
  };

  return (
    <Modal open onClose={onClose} title="" size="sm">
      <div className="flex flex-col items-center text-center gap-4 py-2">
        <div className={`w-12 h-12 rounded-full flex items-center justify-center ${iconBg[data.severity]}`}>
          <Icon className={`w-6 h-6 ${iconColor[data.severity]}`} />
        </div>
        <div className="flex flex-col gap-1.5">
          <h3 className="text-base font-semibold">{data.title}</h3>
          <p className="text-sm text-muted">{data.message}</p>
        </div>
        <div className="flex gap-3 mt-2 w-full">
          {data.retryable && data.onRetry ? (
            <>
              <Button
                variant="secondary"
                size="md"
                className="flex-1"
                onClick={onClose}
              >
                Dismiss
              </Button>
              <Button
                variant="primary"
                size="md"
                className="flex-1"
                onClick={() => {
                  onClose();
                  data.onRetry?.();
                }}
              >
                <RefreshCw className="w-3.5 h-3.5 mr-1.5" />
                Try Again
              </Button>
            </>
          ) : (
            <Button
              variant="secondary"
              size="md"
              className="w-full"
              onClick={onClose}
            >
              Got it
            </Button>
          )}
        </div>
      </div>
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// Success Toast (inline, non-intrusive)
// ---------------------------------------------------------------------------

function SuccessToast({ message, onDismiss }: { message: string; onDismiss: () => void }) {
  return (
    <div
      className="flex items-center gap-3 p-3 sm:p-4 rounded-[12px] border bg-yes/10 border-yes/30 animate-in fade-in slide-in-from-top-2 duration-200"
      role="status"
      aria-live="polite"
    >
      <CheckCircle2 className="w-5 h-5 text-yes shrink-0" />
      <p className="text-sm text-yes flex-1">{message}</p>
      <button
        onClick={onDismiss}
        className="text-muted hover:text-fg text-xs transition-colors"
        aria-label="Dismiss"
      >
        <X className="h-4 w-4" aria-hidden="true" />
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Transaction Progress Component
// ---------------------------------------------------------------------------

type TxStep = 'idle' | 'sending' | 'confirming' | 'verifying' | 'done' | 'failed';

const TX_STEPS: Record<TxStep, string> = {
  idle: '',
  sending: 'Sending payment from wallet...',
  confirming: 'Waiting for blockchain confirmation...',
  verifying: 'Verifying payment on-chain...',
  done: 'Payment confirmed!',
  failed: 'Payment failed',
};

function TransactionProgress({ step }: { step: TxStep }) {
  if (step === 'idle' || step === 'done') return null;

  const stepIndex = ['sending', 'confirming', 'verifying'].indexOf(step);
  const isFailed = step === 'failed';

  return (
    <div className="flex items-center gap-2 mt-2">
      {isFailed ? (
        <XCircle className="w-3.5 h-3.5 text-no shrink-0" />
      ) : (
        <Loader2 className="w-3.5 h-3.5 animate-spin text-accent shrink-0" />
      )}
      <div className="flex flex-col gap-0.5">
        <span className={`text-xs font-medium ${isFailed ? 'text-no' : 'text-accent'}`}>
          {TX_STEPS[step]}
        </span>
        {!isFailed && stepIndex >= 0 && (
          <div className="flex gap-1">
            {[0, 1, 2].map((i) => (
              <div
                key={i}
                className={`h-1 w-6 rounded-full transition-colors ${
                  i <= stepIndex ? 'bg-accent' : 'bg-surface-2'
                }`}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Page Component
// ---------------------------------------------------------------------------

export default function SubscriptionPage() {
  const { plan: currentPlan } = useCurrentPlan();
  const { data: subscription, isLoading: isSubLoading } = useWalletSubscription();
  const subscribePlan = useSubscribePlan();
  const purchaseCreditPack = usePurchaseCreditPack();
  const cancelSubscription = useWalletCancelSubscription();
  const startTrial = useStartTrial();
  const manualRenew = useManualRenew();

  // Modal state
  const [downgradeTarget, setDowngradeTarget] = useState<PlanInfo | null>(null);
  const [showCancelModal, setShowCancelModal] = useState(false);
  const [purchasingPack, setPurchasingPack] = useState<string | null>(null);
  const [errorModal, setErrorModal] = useState<FeedbackData | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [planTxStep, setPlanTxStep] = useState<TxStep>('idle');
  const [packTxStep, setPackTxStep] = useState<TxStep>('idle');

  // Track success toast auto-dismiss timer
  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const showSuccessToast = useCallback(
    (message: string) => {
      if (toastTimerRef.current) {
        clearTimeout(toastTimerRef.current);
      }
      setSuccessMessage(message);
      toastTimerRef.current = setTimeout(() => setSuccessMessage(null), 5000);
    },
    []
  );

  const dismissSuccess = useCallback(() => {
    if (toastTimerRef.current) {
      clearTimeout(toastTimerRef.current);
    }
    setSuccessMessage(null);
  }, []);

  const showErrorToast = useCallback(
    (error: unknown, retryFn?: () => void) => {
      const parsed = parseSubscriptionError(error);
      setErrorModal({
        severity: parsed.severity,
        title: parsed.title,
        message: parsed.message,
        retryable: parsed.retryable,
        onRetry: parsed.retryable ? retryFn : undefined,
      });
    },
    []
  );

  // Trial eligibility
  const trialEligible =
    subscription?.trialEligible ??
    (subscription?.plan === 'free' && !subscription?.billingCycleEnd);
  const isOnTrial = subscription?.isTrial ?? false;

  // Handle starting a free trial
  const handleStartTrial = async (planId: string) => {
    try {
      await startTrial.mutateAsync({ planId });
      showSuccessToast(`Your 30-day free trial of the ${planId} plan has started!`);
    } catch (err) {
      showErrorToast(err, () => handleStartTrial(planId));
    }
  };

  // Handle plan change (upgrade or downgrade)
  const handlePlanAction = (planInfo: PlanInfo) => {
    const action = getPlanAction(currentPlan, planInfo.planId);
    if (action === 'current') return;

    if (action === 'downgrade') {
      setDowngradeTarget(planInfo);
    } else {
      handleChangePlan(planInfo.planId);
    }
  };

  const handleChangePlan = async (planId: string) => {
    setPlanTxStep('sending');
    try {
      await subscribePlan.mutateAsync({
        planId,
        onProgress: (step) => setPlanTxStep(step),
      });
      setPlanTxStep('idle');
      showSuccessToast(
        `Plan changed to ${planId} successfully! Your credits have been updated.`
      );
      setDowngradeTarget(null);
    } catch (err) {
      setPlanTxStep('failed');
      setTimeout(() => setPlanTxStep('idle'), 2000);
      showErrorToast(err, () => handleChangePlan(planId));
    }
  };

  const handleConfirmDowngrade = () => {
    if (!downgradeTarget) return;
    handleChangePlan(downgradeTarget.planId);
  };

  // Handle credit pack purchase
  const handlePurchasePack = async (packId: string) => {
    setPurchasingPack(packId);
    setPackTxStep('sending');
    try {
      await purchaseCreditPack.mutateAsync({
        packId,
        onProgress: (step) => setPackTxStep(step),
      });
      setPackTxStep('idle');
      const pack = CREDIT_PACKS.find((p) => p.packId === packId);
      showSuccessToast(
        `${pack?.credits ?? ''} credits added to your account!`
      );
    } catch (err) {
      setPackTxStep('failed');
      setTimeout(() => setPackTxStep('idle'), 2000);
      showErrorToast(err, () => handlePurchasePack(packId));
    } finally {
      setPurchasingPack(null);
    }
  };

  // Handle cancel subscription
  const handleCancelSubscription = async () => {
    try {
      await cancelSubscription.mutateAsync('current');
      setShowCancelModal(false);
      showSuccessToast(
        'Subscription will be cancelled at end of billing period.'
      );
    } catch (err) {
      showErrorToast(err);
    }
  };

  // Handle manual renewal (grace period)
  const handleManualRenew = async () => {
    if (!subscription?.renewalPrice) return;
    setPlanTxStep('sending');
    try {
      await manualRenew.mutateAsync({
        planPrice: subscription.renewalPrice,
        onProgress: (step) => setPlanTxStep(step),
      });
      setPlanTxStep('idle');
      showSuccessToast(
        'Subscription renewed successfully! Your credits have been restored.'
      );
    } catch (err) {
      setPlanTxStep('failed');
      setTimeout(() => setPlanTxStep('idle'), 2000);
      showErrorToast(err, handleManualRenew);
    }
  };

  const isPaidPlan = subscription?.plan && subscription.plan !== 'free';
  const usagePercent = subscription
    ? subscription.creditsMonthlyLimit > 0
      ? Math.min(
          100,
          ((subscription.creditsMonthlyLimit - subscription.creditsRemaining) /
            subscription.creditsMonthlyLimit) *
            100
        )
      : 0
    : 0;

  return (
    <AppShell>
      <div className="w-full">
        {successMessage && (
          <div className="mb-5">
            <SuccessToast message={successMessage} onDismiss={dismissSuccess} />
          </div>
        )}

        {errorModal && (
          <ErrorModal data={errorModal} onClose={() => setErrorModal(null)} />
        )}

        <header className="border-b border-border pb-6">
          <h1 className="font-display text-[clamp(1.9rem,3.8vw,2.75rem)] font-bold leading-none tracking-[-0.04em] text-fg">
            Subscription &amp; credits
          </h1>
          <p className="mt-2 text-sm text-muted">
            Plans, credit packs, and every payment in one place.
          </p>
        </header>

        {isSubLoading ? (
          <div className="mt-5 animate-pulse rounded-2xl border border-border bg-surface p-4 sm:p-5">
            <div className="h-6 w-48 rounded bg-surface-2" />
            <div className="mt-2 h-4 w-64 rounded bg-surface-2" />
            <div className="mt-4 h-2 w-full rounded-full bg-surface-2" />
          </div>
        ) : subscription ? (
          <section className="mt-5 overflow-hidden rounded-2xl border border-border bg-surface">
            <div className="flex flex-col gap-5 p-4 sm:p-5 lg:flex-row lg:items-center lg:justify-between">
              <div className="flex items-start gap-3">
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-accent/20 bg-accent/10 text-accent">
                  <CreditCard className="h-5 w-5" aria-hidden="true" />
                </span>
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-[0.62rem] text-muted">Current plan</span>
                    <Badge tone="accent" size="sm" className="capitalize">
                      {subscription.plan}
                    </Badge>
                    {isOnTrial && (
                      <Badge tone="accent" size="sm">
                        Free trial
                      </Badge>
                    )}
                    {subscription.status === 'active' && !isOnTrial && (
                      <Badge tone="yes" size="sm">
                        Active
                      </Badge>
                    )}
                    {subscription.status === 'cancelled' && (
                      <Badge tone="warning" size="sm">
                        Cancelled
                      </Badge>
                    )}
                    {subscription.status === 'grace_period' && (
                      <Badge tone="no" size="sm">
                        Grace period
                      </Badge>
                    )}
                  </div>
                  <h2 className="mt-1 font-display text-2xl font-bold capitalize leading-none text-fg">
                    {subscription.plan}
                  </h2>
                  <p className="mt-1.5 text-xs text-muted">
                    {isOnTrial && subscription.trialEnd
                      ? `Free trial ends ${formatDate(subscription.trialEnd)}`
                      : subscription.plan === 'elite'
                        ? 'Unlimited credits · all intervals · all notification channels'
                        : `${subscription.creditsMonthlyLimit} credits/month · ${
                            currentPlan === 'free'
                              ? 'one-time analysis only'
                              : currentPlan === 'starter'
                                ? 'daily recurring'
                                : 'all intervals'
                          }`}
                  </p>
                  {subscription.billingCycleEnd && (
                    <p className="mt-1.5 font-mono text-[0.6rem] text-muted">
                      Resets {formatDate(subscription.billingCycleEnd)}
                    </p>
                  )}
                </div>
              </div>

              <div className="w-full shrink-0 lg:w-64">
                <div className="flex items-baseline justify-between gap-2 lg:justify-end">
                  <span className="font-mono text-3xl font-bold leading-none tabular-nums text-fg">
                    {subscription.plan === 'elite' ? '∞' : subscription.creditsRemaining}
                  </span>
                  <span className="text-[0.6rem] text-muted">
                    {subscription.plan === 'elite'
                      ? 'unlimited credits'
                      : `of ${subscription.creditsMonthlyLimit} credits`}
                  </span>
                </div>
                {subscription.plan !== 'elite' && (
                  <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-surface-2">
                    <div
                      className="h-full rounded-full bg-gradient-to-r from-accent to-ai transition-all"
                      style={{ width: `${100 - usagePercent}%` }}
                    />
                  </div>
                )}
                {subscription.plan !== 'elite' && (
                  <p className="mt-1 text-right text-[0.58rem] text-muted">
                    {Math.round(100 - usagePercent)}% remaining
                  </p>
                )}
              </div>
            </div>
          </section>
        ) : null}

        {subscription?.status === 'grace_period' && (
          <div className="mt-4 flex flex-col gap-3 rounded-2xl border border-no/30 bg-no/[0.06] p-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-start gap-3">
              <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-no" aria-hidden="true" />
              <div>
                <p className="text-sm font-medium text-no">
                  Your subscription renewal failed
                </p>
                <p className="mt-1 text-xs leading-relaxed text-muted">
                  We couldn&apos;t automatically renew your {subscription.plan} plan.
                  {subscription.renewalPrice
                    ? ` Keep at least $${subscription.renewalPrice.toFixed(2)} in your Trading Wallet and renew manually.`
                    : ' Please renew manually to keep your plan active.'}{' '}
                  If not renewed during the grace period, your account moves to Free.
                </p>
              </div>
            </div>
            <div className="flex shrink-0 flex-col gap-2">
              <Button
                variant="primary"
                size="md"
                onClick={handleManualRenew}
                disabled={manualRenew.isPending}
                loading={manualRenew.isPending}
                aria-label="Renew subscription now"
              >
                Renew now
                {subscription.renewalPrice ? ` · $${subscription.renewalPrice}` : ''}
              </Button>
              {manualRenew.isPending && <TransactionProgress step={planTxStep} />}
            </div>
          </div>
        )}

        <section className="mt-5 overflow-hidden rounded-2xl border border-border bg-surface">
          <div className="flex items-center justify-between gap-3 border-b border-border/60 px-4 py-3.5 sm:px-5">
            <div>
              <h2 className="text-sm font-semibold text-fg">Plans</h2>
              <p className="text-[0.6rem] text-muted">
                Change your monthly allowance and features.
              </p>
            </div>
            <span className="hidden text-[0.6rem] text-muted sm:inline">Billed monthly</span>
          </div>

          <div className="grid grid-cols-1 gap-px bg-border/60 sm:grid-cols-2 xl:grid-cols-4">
            {PLANS.map((planInfo) => {
              const action = getPlanAction(currentPlan, planInfo.planId);
              const isCurrent = action === 'current';
              const canTrial =
                trialEligible &&
                planInfo.planId !== 'free' &&
                planInfo.planId !== 'elite' &&
                !isCurrent;

              return (
                <div
                  key={planInfo.planId}
                  className={cn(
                    'relative flex flex-col bg-surface p-4 sm:p-5',
                    isCurrent && 'bg-accent/[0.05]'
                  )}
                >
                  {isCurrent && (
                    <span
                      className="pointer-events-none absolute inset-0 ring-1 ring-inset ring-accent"
                      aria-hidden="true"
                    />
                  )}

                  <div className="flex min-h-5 flex-wrap items-center gap-2">
                    {isCurrent && (
                      <Badge tone="accent" size="sm">
                        {isOnTrial ? 'Trial active' : 'Current plan'}
                      </Badge>
                    )}
                    {planInfo.planId === 'elite' && !isCurrent && (
                      <Badge tone="warning" size="sm">
                        Most powerful
                      </Badge>
                    )}
                    {canTrial && (
                      <Badge tone="yes" size="sm">
                        30-day free trial
                      </Badge>
                    )}
                  </div>

                  <h3 className="mt-3 text-sm font-semibold text-fg">{planInfo.name}</h3>
                  <div className="mt-1 font-mono text-2xl font-bold tabular-nums text-fg">
                    ${planInfo.price}
                    <span className="text-sm font-normal text-muted">/mo</span>
                  </div>
                  <p className="mt-1 text-[0.65rem] text-accent">{planInfo.credits}</p>

                  <ul className="mt-3 flex-1 space-y-1.5">
                    {planInfo.features.map((feature) => (
                      <li
                        key={feature}
                        className="flex items-start gap-2 text-[0.7rem] leading-relaxed text-muted"
                      >
                        <Check className="mt-0.5 h-3 w-3 shrink-0 text-yes" aria-hidden="true" />
                        {feature}
                      </li>
                    ))}
                  </ul>

                  <div className="mt-4">
                    {canTrial ? (
                      <Button
                        variant="primary"
                        size="md"
                        className="w-full"
                        disabled={startTrial.isPending}
                        loading={startTrial.isPending}
                        onClick={() => handleStartTrial(planInfo.planId)}
                        aria-label={`Start 30-day free trial of ${planInfo.name}`}
                      >
                        Start free trial
                      </Button>
                    ) : (
                      <Button
                        variant={
                          isCurrent ? 'secondary' : action === 'upgrade' ? 'primary' : 'secondary'
                        }
                        size="md"
                        className="w-full"
                        disabled={isCurrent || subscribePlan.isPending}
                        loading={subscribePlan.isPending && !isCurrent}
                        onClick={() => handlePlanAction(planInfo)}
                        aria-label={
                          isCurrent
                            ? `Current plan: ${planInfo.name}`
                            : `${action === 'upgrade' ? 'Upgrade' : 'Downgrade'} to ${planInfo.name}`
                        }
                      >
                        {isCurrent
                          ? 'Current plan'
                          : action === 'upgrade'
                            ? 'Upgrade'
                            : 'Downgrade'}
                      </Button>
                    )}

                    {!isCurrent && subscribePlan.isPending && (
                      <TransactionProgress step={planTxStep} />
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </section>

        <div className="mt-4 grid grid-cols-1 items-start gap-4 lg:grid-cols-[minmax(0,1fr)_360px]">
          <section className="overflow-hidden rounded-2xl border border-border bg-surface">
            <div className="flex items-center justify-between gap-3 border-b border-border/60 px-4 py-3.5 sm:px-5">
              <div>
                <h2 className="text-sm font-semibold text-fg">Credit packs</h2>
                <p className="text-[0.6rem] text-muted">
                  Top up without changing your plan. Credits never expire.
                </p>
              </div>
            </div>

            <div className="grid grid-cols-1 gap-px bg-border/60 xs:grid-cols-3">
              {CREDIT_PACKS.map((pack) => {
                const isPurchasing = purchasingPack === pack.packId;

                return (
                  <button
                    key={pack.packId}
                    type="button"
                    onClick={() => handlePurchasePack(pack.packId)}
                    disabled={isPurchasing || purchaseCreditPack.isPending}
                    aria-label={`Purchase ${pack.credits} credits for $${pack.price}`}
                    className={cn(
                      'bg-surface p-4 text-left transition-colors hover:bg-surface-2/40 disabled:cursor-not-allowed disabled:opacity-60',
                      isPurchasing && 'bg-accent/[0.05]'
                    )}
                  >
                    <div className="flex items-baseline justify-between gap-2">
                      <span className="font-mono text-2xl font-bold text-accent">
                        {pack.credits}
                      </span>
                      <span className="text-sm font-semibold text-fg">${pack.price}</span>
                    </div>
                    <p className="mt-0.5 text-[0.6rem] text-muted">
                      credits · ${(pack.price / pack.credits).toFixed(2)} each
                    </p>
                    {isPurchasing ? (
                      <div className="mt-2">
                        <TransactionProgress step={packTxStep} />
                      </div>
                    ) : (
                      <span className="mt-2 inline-flex items-center gap-1 text-[0.65rem] font-medium text-accent">
                        Buy pack
                        <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          </section>

          <section className="overflow-hidden rounded-2xl border border-border bg-surface">
            <div className="flex items-center gap-2 border-b border-border/60 px-4 py-3.5">
              <CalendarClock className="h-4 w-4 text-muted" aria-hidden="true" />
              <div>
                <h2 className="text-sm font-semibold text-fg">Manage</h2>
                <p className="text-[0.6rem] text-muted">Billing and renewal</p>
              </div>
            </div>

            <div className="p-4">
              {subscription ? (
                <div className="space-y-2.5">
                  <div className="flex items-center justify-between gap-3 text-[0.65rem]">
                    <span className="text-muted">Next renewal</span>
                    <span className="font-mono text-fg">
                      {formatDate(subscription.billingCycleEnd)}
                    </span>
                  </div>
                  <div className="flex items-center justify-between gap-3 text-[0.65rem]">
                    <span className="text-muted">Payment</span>
                    <span className="text-fg">Trading wallet</span>
                  </div>
                  <div className="flex items-center justify-between gap-3 text-[0.65rem]">
                    <span className="text-muted">Plan</span>
                    <span className="capitalize text-fg">{subscription.plan}</span>
                  </div>

                  {isPaidPlan && subscription.status !== 'cancelled' ? (
                    <Button
                      variant="danger"
                      size="sm"
                      onClick={() => setShowCancelModal(true)}
                      aria-label="Cancel subscription"
                      className="mt-2 w-full"
                    >
                      Cancel subscription
                    </Button>
                  ) : (
                    <p className="mt-2 border-t border-border/60 pt-3 text-[0.6rem] leading-relaxed text-muted">
                      {subscription.status === 'cancelled'
                        ? `Your plan stays active until ${formatDate(subscription.billingCycleEnd)}.`
                        : 'No paid subscription is active.'}
                    </p>
                  )}
                </div>
              ) : (
                <p className="text-[0.65rem] leading-relaxed text-muted">
                  No active subscription. Choose a plan above to get started.
                </p>
              )}
            </div>
          </section>
        </div>

        <BillingHistorySection />

        <Modal
          open={!!downgradeTarget}
          onClose={() => setDowngradeTarget(null)}
          title={`Downgrade to ${downgradeTarget?.name}?`}
          size="sm"
        >
          <p className="mb-6 text-sm text-muted">
            You&apos;ll keep your current plan until the end of this billing
            cycle. After that, your credit allowance and features change to
            match the {downgradeTarget?.name} plan.
          </p>
          <div className="flex justify-end gap-3">
            <Button variant="secondary" size="md" onClick={() => setDowngradeTarget(null)}>
              Keep plan
            </Button>
            <Button
              variant="danger"
              size="md"
              onClick={handleConfirmDowngrade}
              loading={subscribePlan.isPending}
            >
              Confirm downgrade
            </Button>
          </div>
        </Modal>

        <Modal
          open={showCancelModal}
          onClose={() => setShowCancelModal(false)}
          title="Cancel your subscription?"
          size="sm"
        >
          <p className="mb-6 text-sm text-muted">
            Your plan remains active until the end of the current billing cycle.
            After that, you move to the Free plan (20 credits/month). Unused
            credits are lost.
          </p>
          <div className="flex justify-end gap-3">
            <Button variant="secondary" size="md" onClick={() => setShowCancelModal(false)}>
              Keep plan
            </Button>
            <Button
              variant="danger"
              size="md"
              onClick={handleCancelSubscription}
              loading={cancelSubscription.isPending}
            >
              Cancel subscription
            </Button>
          </div>
        </Modal>
      </div>
    </AppShell>
  );
}

// ---------------------------------------------------------------------------
// Billing History Section
// ---------------------------------------------------------------------------

function BillingHistorySection() {
  const { data, isLoading, error, fetchNextPage, hasNextPage, isFetchingNextPage } =
    usePaymentHistory();

  const transactions = data?.pages.flatMap((page) => page.transactions) ?? [];

  return (
    <section className="mt-4 overflow-hidden rounded-2xl border border-border bg-surface">
      <div className="flex items-center justify-between gap-3 border-b border-border/60 px-4 py-3.5 sm:px-5">
        <div>
          <h2 className="text-sm font-semibold text-fg">Billing history</h2>
          <p className="text-[0.6rem] text-muted">Payments from your Trading wallet.</p>
        </div>
        {transactions.length > 0 && (
          <span className="font-mono text-[0.6rem] text-muted">
            {transactions.length} records
          </span>
        )}
      </div>

      {isLoading && (
        <div className="animate-pulse divide-y divide-border/60" aria-hidden="true">
          {Array.from({ length: 3 }).map((_, index) => (
            <div key={index} className="flex items-center gap-4 px-4 py-3.5">
              <div className="h-3 w-24 rounded bg-surface-2" />
              <div className="h-3 w-40 rounded bg-surface-2" />
              <div className="ml-auto h-3 w-16 rounded bg-surface-2" />
            </div>
          ))}
        </div>
      )}

      {error && (
        <p className="px-4 py-6 text-center text-sm text-no">
          Failed to load billing history.
        </p>
      )}

      {!isLoading && transactions.length === 0 && (
        <p className="px-4 py-6 text-center text-sm text-muted">
          No billing history yet.
        </p>
      )}

      {transactions.length > 0 && (
        <>
          <div className="hidden overflow-x-auto sm:block">
            <table className="w-full min-w-[500px] text-sm">
              <thead>
                <tr className="border-b border-border/60 text-left text-[0.62rem] text-muted">
                  <th className="px-4 py-2.5 font-medium first:pl-5">Date</th>
                  <th className="px-4 py-2.5 font-medium">Description</th>
                  <th className="px-4 py-2.5 text-right font-medium">Amount</th>
                  <th className="px-4 py-2.5 text-right font-medium last:pr-5">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/60">
                {transactions.map((tx) => (
                  <tr key={tx.id} className="transition-colors hover:bg-surface-2/40">
                    <td className="px-4 py-3 font-mono text-xs tabular-nums text-muted first:pl-5">
                      {formatDate(tx.createdAt)}
                    </td>
                    <td className="px-4 py-3 text-xs text-fg">
                      {tx.transactionType.replace(/_/g, ' ')}
                    </td>
                    <td className="px-4 py-3 text-right font-mono text-xs tabular-nums text-fg">
                      ${tx.amountUsdc.toFixed(2)}
                    </td>
                    <td className="px-4 py-3 text-right last:pr-5">
                      <Badge tone="yes" size="sm">
                        Paid
                      </Badge>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="divide-y divide-border/60 sm:hidden">
            {transactions.map((tx) => (
              <div
                key={tx.id}
                className="flex items-center justify-between gap-3 px-4 py-3"
              >
                <div className="flex min-w-0 flex-col gap-0.5">
                  <span className="truncate text-sm text-fg">
                    {tx.transactionType.replace(/_/g, ' ')}
                  </span>
                  <span className="font-mono text-xs tabular-nums text-muted">
                    {formatDate(tx.createdAt)}
                  </span>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <span className="font-mono text-sm font-semibold tabular-nums text-fg">
                    ${tx.amountUsdc.toFixed(2)}
                  </span>
                  <Badge tone="yes" size="sm">
                    Paid
                  </Badge>
                </div>
              </div>
            ))}
          </div>

          {hasNextPage && (
            <div className="border-t border-border/60 px-4 py-3">
              <button
                onClick={() => fetchNextPage()}
                disabled={isFetchingNextPage}
                className="rounded text-sm text-accent transition-colors hover:text-fg disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-bg"
              >
                {isFetchingNextPage ? 'Loading…' : 'Load more'}
              </button>
            </div>
          )}
        </>
      )}
    </section>
  );
}
