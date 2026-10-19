'use client';

import { useState, useCallback, useRef } from 'react';
import { Loader2, AlertTriangle, Info, CheckCircle2, XCircle, RefreshCw } from 'lucide-react';
import { AppShell } from '@/components/shell/AppShell';
import { Card } from '@/components/ui/Card';
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
        ✕
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
      <div className="flex flex-col gap-6 sm:gap-8">
        {/* Success toast (inline, auto-dismiss) */}
        {successMessage && (
          <SuccessToast message={successMessage} onDismiss={dismissSuccess} />
        )}

        {/* Error/warning/info modal */}
        {errorModal && (
          <ErrorModal data={errorModal} onClose={() => setErrorModal(null)} />
        )}

        {/* Page header */}
        <div>
          <h1 className="text-xl sm:text-2xl font-bold font-display tracking-tight">
            Subscription &amp; Credits
          </h1>
          <p className="text-sm text-muted mt-1">
            Manage your plan, buy credit packs, and view billing history
          </p>
        </div>

        {/* Current plan summary card */}
        {isSubLoading ? (
          <Card className="p-4 sm:p-6 animate-pulse">
            <div className="h-6 w-48 bg-surface-2 rounded" />
            <div className="h-4 w-64 bg-surface-2 rounded mt-2" />
          </Card>
        ) : subscription ? (
          <Card className="p-4 sm:p-6">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
              <div className="flex flex-col gap-1">
                <div className="flex items-center gap-2 flex-wrap">
                  <h2 className="text-base font-semibold">Current plan:</h2>
                  <span className="text-ai font-bold capitalize">
                    {subscription.plan}
                  </span>
                  {isOnTrial && (
                    <Badge tone="accent" size="sm">
                      Free Trial
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
                      Grace Period
                    </Badge>
                  )}
                </div>
                <p className="text-xs text-muted">
                  {isOnTrial && subscription.trialEnd
                    ? `Free trial ends ${formatDate(subscription.trialEnd)}`
                    : subscription.plan === 'elite'
                    ? 'Unlimited credits · All intervals · All notification channels'
                    : `${subscription.creditsMonthlyLimit} credits/month · ${
                        currentPlan === 'free'
                          ? 'One-time analysis only'
                          : currentPlan === 'starter'
                          ? 'Daily recurring'
                          : 'All intervals'
                      }`}
                </p>
              </div>
              <div className="flex flex-col items-start sm:items-end gap-1">
                <div className="font-mono text-2xl font-bold tabular-nums">
                  {subscription.plan === 'elite'
                    ? '∞'
                    : subscription.creditsRemaining}
                </div>
                <div className="text-xs text-muted">
                  {subscription.plan === 'elite'
                    ? 'unlimited credits'
                    : `of ${subscription.creditsMonthlyLimit} credits remaining`}
                </div>
                {subscription.plan !== 'elite' && (
                  <div className="w-full sm:w-48 h-1.5 bg-surface-2 rounded-full overflow-hidden mt-1">
                    <div
                      className="h-full bg-gradient-to-r from-accent to-ai rounded-full transition-all"
                      style={{ width: `${100 - usagePercent}%` }}
                    />
                  </div>
                )}
                {subscription.billingCycleEnd && (
                  <span className="text-[11px] text-muted mt-0.5">
                    Resets {formatDate(subscription.billingCycleEnd)}
                  </span>
                )}
              </div>
            </div>
          </Card>
        ) : null}

        {/* Grace period renewal banner */}
        {subscription?.status === 'grace_period' && (
          <Card className="p-4 sm:p-5 border-no/40 bg-no/5">
            <div className="flex flex-col sm:flex-row sm:items-center gap-4">
              <div className="flex items-start gap-3 flex-1">
                <AlertTriangle className="w-5 h-5 text-no shrink-0 mt-0.5" />
                <div>
                  <p className="text-sm font-medium text-no">
                    Your subscription renewal failed
                  </p>
                  <p className="text-xs text-muted mt-1">
                    We couldn&apos;t automatically renew your {subscription.plan} plan.
                    {subscription.renewalPrice
                      ? ` Please ensure you have at least $${subscription.renewalPrice.toFixed(2)} USD in your Trading Wallet and renew manually.`
                      : ' Please renew manually to keep your plan active.'}
                    {' '}If not renewed during the grace period, your account will be downgraded to the Free plan.
                  </p>
                </div>
              </div>
              <div className="flex flex-col gap-2 shrink-0">
                <Button
                  variant="primary"
                  size="md"
                  onClick={handleManualRenew}
                  disabled={manualRenew.isPending}
                  loading={manualRenew.isPending}
                  aria-label="Renew subscription now"
                >
                  Renew Now
                  {subscription.renewalPrice ? ` · $${subscription.renewalPrice}` : ''}
                </Button>
                {manualRenew.isPending && (
                  <TransactionProgress step={planTxStep} />
                )}
              </div>
            </div>
          </Card>
        )}

        {/* Plan cards grid */}
        <section>
          <h2 className="text-lg font-bold font-display mb-4">Plans</h2>
          <div className="grid grid-cols-1 xs:grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
            {PLANS.map((planInfo) => {
              const action = getPlanAction(currentPlan, planInfo.planId);
              const isCurrent = action === 'current';
              const canTrial =
                trialEligible &&
                planInfo.planId !== 'free' &&
                planInfo.planId !== 'elite' &&
                !isCurrent;

              return (
                <Card
                  key={planInfo.planId}
                  className={`p-4 sm:p-5 flex flex-col ${
                    isCurrent ? 'border-ai' : ''
                  } ${planInfo.planId === 'elite' ? 'border-accent' : ''}`}
                >
                  {/* Badge */}
                  <div className="h-5 mb-3">
                    {isCurrent && isOnTrial && (
                      <Badge tone="accent" size="sm">
                        Trial active
                      </Badge>
                    )}
                    {isCurrent && !isOnTrial && (
                      <Badge tone="ai" size="sm">
                        Current plan
                      </Badge>
                    )}
                    {planInfo.planId === 'elite' && !isCurrent && (
                      <Badge tone="accent" size="sm">
                        Most powerful
                      </Badge>
                    )}
                    {canTrial && !isCurrent && planInfo.planId !== 'elite' && (
                      <Badge tone="yes" size="sm">
                        30-day free trial
                      </Badge>
                    )}
                  </div>

                  {/* Plan name */}
                  <h3 className="text-base font-semibold">{planInfo.name}</h3>

                  {/* Price */}
                  <div className="font-mono text-2xl font-bold mt-1 tabular-nums">
                    ${planInfo.price}
                    <span className="text-sm font-normal text-muted">/mo</span>
                  </div>

                  {/* Credits */}
                  <p className="text-xs text-ai mt-1 mb-4">{planInfo.credits}</p>

                  {/* Features */}
                  <ul className="flex-1 space-y-1.5 mb-5">
                    {planInfo.features.map((feature) => (
                      <li
                        key={feature}
                        className="text-xs text-muted flex items-center gap-2"
                      >
                        <span className="text-yes text-[10px] font-bold">✓</span>
                        {feature}
                      </li>
                    ))}
                  </ul>

                  {/* Action buttons */}
                  <div className="flex flex-col gap-2">
                    {canTrial ? (
                      <Button
                        variant="ai"
                        size="md"
                        className="w-full"
                        disabled={startTrial.isPending}
                        loading={startTrial.isPending}
                        onClick={() => handleStartTrial(planInfo.planId)}
                        aria-label={`Start 30-day free trial of ${planInfo.name}`}
                      >
                        Start Free Trial
                      </Button>
                    ) : (
                      <Button
                        variant={
                          isCurrent
                            ? 'ai'
                            : action === 'upgrade'
                            ? 'primary'
                            : 'secondary'
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
                          ? 'Current Plan'
                          : action === 'upgrade'
                          ? 'Upgrade'
                          : 'Downgrade'}
                      </Button>
                    )}
                    {/* Transaction progress for plan change */}
                    {!isCurrent && subscribePlan.isPending && (
                      <TransactionProgress step={planTxStep} />
                    )}
                  </div>
                </Card>
              );
            })}
          </div>
        </section>

        {/* Credit packs section */}
        <section>
          <h2 className="text-lg font-bold font-display mb-1">Credit Packs</h2>
          <p className="text-sm text-muted mb-4">
            Top up without changing your plan. Credits never expire.
          </p>
          <div className="grid grid-cols-1 xs:grid-cols-3 gap-3 sm:gap-4 max-w-md">
            {CREDIT_PACKS.map((pack) => {
              const isPurchasing = purchasingPack === pack.packId;
              return (
                <Card
                  key={pack.packId}
                  className={`p-4 sm:p-5 text-center cursor-pointer hover:border-accent transition-colors ${
                    isPurchasing ? 'border-accent' : ''
                  }`}
                >
                  <button
                    className="w-full flex flex-col items-center gap-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-bg rounded"
                    onClick={() => handlePurchasePack(pack.packId)}
                    disabled={isPurchasing || purchaseCreditPack.isPending}
                    aria-label={`Purchase ${pack.credits} credits for $${pack.price}`}
                  >
                    <span className="font-mono text-2xl font-bold text-accent">
                      {pack.credits}
                    </span>
                    <span className="text-xs text-muted">credits</span>
                    <span className="text-base font-semibold mt-2">
                      ${pack.price}
                    </span>
                    <span className="text-[11px] text-muted">
                      ${(pack.price / pack.credits).toFixed(2)} / credit
                    </span>
                    {isPurchasing && (
                      <TransactionProgress step={packTxStep} />
                    )}
                  </button>
                </Card>
              );
            })}
          </div>
        </section>

        {/* Billing history */}
        <BillingHistorySection />

        {/* Cancel subscription */}
        {subscription &&
          isPaidPlan &&
          subscription.status !== 'cancelled' && (
            <section className="pt-4 border-t border-border">
              <Button
                variant="danger"
                size="sm"
                onClick={() => setShowCancelModal(true)}
                aria-label="Cancel subscription"
              >
                Cancel Subscription
              </Button>
            </section>
          )}

        {/* Downgrade confirmation modal */}
        <Modal
          open={!!downgradeTarget}
          onClose={() => setDowngradeTarget(null)}
          title={`Downgrade to ${downgradeTarget?.name}?`}
          size="sm"
        >
          <p className="text-sm text-muted mb-6">
            You&apos;ll keep your current plan until the end of this billing
            cycle. After that, your credit allowance and features will change to
            match the {downgradeTarget?.name} plan.
          </p>
          <div className="flex gap-3 justify-end">
            <Button
              variant="secondary"
              size="md"
              onClick={() => setDowngradeTarget(null)}
            >
              Keep Plan
            </Button>
            <Button
              variant="danger"
              size="md"
              onClick={handleConfirmDowngrade}
              loading={subscribePlan.isPending}
            >
              Confirm Downgrade
            </Button>
          </div>
        </Modal>

        {/* Cancel subscription confirmation modal */}
        <Modal
          open={showCancelModal}
          onClose={() => setShowCancelModal(false)}
          title="Cancel your subscription?"
          size="sm"
        >
          <p className="text-sm text-muted mb-6">
            Your plan will remain active until the end of the current billing
            cycle. After that, you&apos;ll be moved to the Free plan (20
            credits/month). Unused credits will be lost.
          </p>
          <div className="flex gap-3 justify-end">
            <Button
              variant="secondary"
              size="md"
              onClick={() => setShowCancelModal(false)}
            >
              Keep Plan
            </Button>
            <Button
              variant="danger"
              size="md"
              onClick={handleCancelSubscription}
              loading={cancelSubscription.isPending}
            >
              Cancel Subscription
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
    <section>
      <h2 className="text-lg font-bold font-display mb-4">Billing History</h2>

      {isLoading && (
        <div className="flex items-center gap-2 text-sm text-muted py-4">
          <Loader2 className="w-4 h-4 animate-spin" />
          Loading billing history...
        </div>
      )}

      {error && (
        <Card className="p-4">
          <p className="text-sm text-no">Failed to load billing history.</p>
        </Card>
      )}

      {!isLoading && transactions.length === 0 && (
        <p className="text-sm text-muted py-4">No billing history yet.</p>
      )}

      {transactions.length > 0 && (
        <div className="overflow-x-auto -mx-4 px-4 sm:mx-0 sm:px-0">
          <Card className="overflow-hidden">
            {/* Desktop table */}
            <table className="w-full text-sm hidden sm:table min-w-[500px]">
              <thead>
                <tr className="border-b border-border">
                  <th className="text-left px-4 py-3 text-xs font-medium text-muted uppercase tracking-wide">
                    Date
                  </th>
                  <th className="text-left px-4 py-3 text-xs font-medium text-muted uppercase tracking-wide">
                    Description
                  </th>
                  <th className="text-left px-4 py-3 text-xs font-medium text-muted uppercase tracking-wide">
                    Amount
                  </th>
                  <th className="text-left px-4 py-3 text-xs font-medium text-muted uppercase tracking-wide">
                    Status
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/40">
                {transactions.map((tx) => (
                  <tr key={tx.id} className="hover:bg-surface-2/50 transition-colors">
                    <td className="px-4 py-3 font-mono text-xs tabular-nums">
                      {formatDate(tx.createdAt)}
                    </td>
                    <td className="px-4 py-3 text-fg">
                      {tx.transactionType.replace(/_/g, ' ')}
                    </td>
                    <td className="px-4 py-3 font-mono text-xs tabular-nums">
                      ${tx.amountUsdc.toFixed(2)}
                    </td>
                    <td className="px-4 py-3">
                      <Badge tone="yes" size="sm">
                        Paid
                      </Badge>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>

            {/* Mobile stacked layout */}
            <div className="sm:hidden divide-y divide-border/40">
              {transactions.map((tx) => (
                <div
                  key={tx.id}
                  className="px-4 py-3 flex items-center justify-between gap-3"
                >
                  <div className="flex flex-col gap-0.5 min-w-0">
                    <span className="text-sm text-fg truncate">
                      {tx.transactionType.replace(/_/g, ' ')}
                    </span>
                    <span className="text-xs text-muted font-mono tabular-nums">
                      {formatDate(tx.createdAt)}
                    </span>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <span className="font-mono text-sm font-semibold tabular-nums">
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
              <div className="px-4 py-3 border-t border-border">
                <button
                  onClick={() => fetchNextPage()}
                  disabled={isFetchingNextPage}
                  className="text-sm text-accent hover:text-accent/80 transition-colors disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-bg rounded"
                >
                  {isFetchingNextPage ? 'Loading...' : 'Load more'}
                </button>
              </div>
            )}
          </Card>
        </div>
      )}
    </section>
  );
}
