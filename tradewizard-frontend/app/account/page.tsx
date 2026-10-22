'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  Bell,
  Check,
  ChevronRight,
  Clock3,
  CreditCard,
  LogOut,
  SlidersHorizontal,
  Target,
  X,
} from 'lucide-react';
import { AppShell } from '@/components/shell/AppShell';
import { Toggle } from '@/components/ui/Toggle';
import { Slider } from '@/components/ui/Slider';
import { TierGate } from '@/components/ui/TierGate';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { EmptyState } from '@/components/ui/EmptyState';
import { Skeleton } from '@/components/ui/Skeleton';
import { UpgradePrompt } from '@/components/ui/UpgradePrompt';
import {
  useNotificationPreferences,
  useUpdateNotificationPreferences,
} from '@/hooks/useNotificationPreferences';
import { usePersonaSettings } from '@/hooks/usePersonaSettings';
import { useCurrentPlan } from '@/hooks/useCurrentPlan';
import { useSubscription } from '@/hooks/useSubscription';
import { useAuth } from '@/hooks/useAuth';

export default function SettingsPage() {
  const { plan, has } = useCurrentPlan();
  const { data: subscription } = useSubscription();
  const { data: preferences, isLoading: prefsLoading } = useNotificationPreferences();
  const updatePreferences = useUpdateNotificationPreferences();
  const { data: personaData, isLoading: personaLoading } = usePersonaSettings();
  const { signOut } = useAuth();
  const router = useRouter();

  const [channelInApp, setChannelInApp] = useState(true);
  const [channelEmail, setChannelEmail] = useState(false);
  const [channelPush, setChannelPush] = useState(false);
  const [channelWebhook, setChannelWebhook] = useState(false);
  const [webhookUrl, setWebhookUrl] = useState('');
  const [quietHoursEnabled, setQuietHoursEnabled] = useState(false);
  const [quietHoursStart, setQuietHoursStart] = useState('22:00');
  const [quietHoursEnd, setQuietHoursEnd] = useState('07:00');
  const [probShiftEnabled, setProbShiftEnabled] = useState(false);
  const [minProbabilityShift, setMinProbabilityShift] = useState(5);
  const [webhookTesting, setWebhookTesting] = useState(false);
  const [webhookTestResult, setWebhookTestResult] = useState<
    { ok: boolean; message: string } | null
  >(null);

  useEffect(() => {
    if (preferences) {
      setChannelInApp(preferences.channelInApp);
      setChannelEmail(preferences.channelEmail);
      setChannelPush(preferences.channelPush);
      setChannelWebhook(preferences.channelWebhook);
      setWebhookUrl(preferences.webhookUrl ?? '');
      setQuietHoursEnabled(
        preferences.quietHoursStart !== null && preferences.quietHoursEnd !== null
      );
      setQuietHoursStart(preferences.quietHoursStart ?? '22:00');
      setQuietHoursEnd(preferences.quietHoursEnd ?? '07:00');
      const shift = preferences.minProbabilityShift;
      const hasShift = shift !== null && shift !== undefined && shift > 0;
      setProbShiftEnabled(hasShift);
      setMinProbabilityShift(hasShift ? Math.round(shift * 100) : 5);
    }
  }, [preferences]);

  const handleSave = () => {
    updatePreferences.mutate({
      channelInApp,
      channelEmail,
      channelPush,
      channelWebhook,
      webhookUrl: channelWebhook ? webhookUrl || null : null,
      quietHoursStart: quietHoursEnabled ? quietHoursStart : null,
      quietHoursEnd: quietHoursEnabled ? quietHoursEnd : null,
      minProbabilityShift: probShiftEnabled ? minProbabilityShift / 100 : null,
    });
  };

  const handleWebhookTest = async () => {
    if (!webhookUrl) return;
    setWebhookTesting(true);
    setWebhookTestResult(null);
    try {
      await updatePreferences.mutateAsync({
        channelInApp,
        channelEmail,
        channelPush,
        channelWebhook: true,
        webhookUrl,
        quietHoursStart: quietHoursEnabled ? quietHoursStart : null,
        quietHoursEnd: quietHoursEnabled ? quietHoursEnd : null,
        minProbabilityShift: probShiftEnabled ? minProbabilityShift / 100 : null,
      });
      setWebhookTestResult({ ok: true, message: 'Webhook validated' });
    } catch (err) {
      setWebhookTestResult({
        ok: false,
        message: err instanceof Error ? err.message : 'Webhook test failed',
      });
    } finally {
      setWebhookTesting(false);
    }
  };

  if (prefsLoading) {
    return (
      <AppShell>
        <div className="w-full animate-pulse" aria-hidden="true">
          <div className="h-10 w-48 rounded bg-surface-2" />
          <div className="mt-2 h-4 w-96 max-w-full rounded bg-surface-2" />
          <div className="mt-6 grid gap-4 lg:grid-cols-[minmax(0,1fr)_360px]">
            <div className="h-[560px] rounded-2xl bg-surface-2" />
            <div className="space-y-4">
              <div className="h-40 rounded-2xl bg-surface-2" />
              <div className="h-48 rounded-2xl bg-surface-2" />
              <div className="h-32 rounded-2xl bg-surface-2" />
            </div>
          </div>
        </div>
      </AppShell>
    );
  }

  const canEmailPush = has('starter');
  const canWebhook = has('pro');
  const planLabel = plan.charAt(0).toUpperCase() + plan.slice(1);
  const creditsValue =
    plan === 'elite'
      ? '∞'
      : subscription?.creditsRemaining != null
        ? String(subscription.creditsRemaining)
        : '-';
  const creditsCaption =
    plan === 'elite'
      ? 'unlimited credits'
      : subscription?.creditsRemaining != null
        ? `of ${subscription.creditsMonthlyLimit} credits left`
        : 'manage plan and credits';
  const personaRisk = personaData?.persona.riskLevel;
  const personaRiskTone =
    personaRisk === 'aggressive'
      ? 'no'
      : personaRisk === 'conservative'
        ? 'yes'
        : 'warning';

  return (
    <AppShell>
      <div className="w-full">
        <header className="border-b border-border pb-6">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <h1 className="font-display text-[clamp(1.9rem,3.8vw,2.75rem)] font-bold leading-none tracking-[-0.04em] text-fg">
                Settings
              </h1>
              <p className="mt-2 text-sm text-muted">
                Delivery, alerts, and the defaults behind your trading.
              </p>
            </div>

            <div className="flex items-center justify-between gap-3 sm:justify-end">
              {updatePreferences.isSuccess && (
                <span className="inline-flex items-center gap-1 text-[0.65rem] font-medium text-yes">
                  <Check className="h-3.5 w-3.5" aria-hidden="true" />
                  Saved
                </span>
              )}
              {updatePreferences.isError && (
                <span className="text-[0.65rem] font-medium text-no">Save failed</span>
              )}
              <Button
                variant="primary"
                size="md"
                onClick={handleSave}
                loading={updatePreferences.isPending}
                className="shrink-0"
              >
                Save preferences
              </Button>
            </div>
          </div>
        </header>

        {plan === 'free' && (
          <div className="mt-5">
            <UpgradePrompt
              variant="free-to-starter"
              message={
                <>
                  You&apos;re on the <strong>Free plan</strong> - email, push, and
                  webhook delivery require Starter+.
                </>
              }
            />
          </div>
        )}

        {plan === 'starter' && (
          <div className="mt-5">
            <UpgradePrompt
              variant="starter-to-pro"
              message={
                <>
                  Upgrade to <strong>Pro</strong> to unlock webhook delivery and
                  Portfolio Manager.
                </>
              }
            />
          </div>
        )}

        <div className="mt-5 grid grid-cols-1 items-start gap-4 lg:grid-cols-[minmax(0,1fr)_360px]">
          {/* Notification preferences */}
          <section className="overflow-hidden rounded-2xl border border-border bg-surface">
            <div className="flex items-center gap-2.5 border-b border-border/60 px-4 py-4 sm:px-5">
              <span className="flex h-8 w-8 items-center justify-center rounded-lg border border-accent/20 bg-accent/10 text-accent">
                <Bell className="h-4 w-4" aria-hidden="true" />
              </span>
              <div>
                <h2 className="text-sm font-semibold text-fg">Notification preferences</h2>
                <p className="text-[0.6rem] text-muted">
                  Where results go and when we stay quiet.
                </p>
              </div>
            </div>

            <div className="divide-y divide-border/60">
              {/* Delivery channels */}
              <div className="p-4 sm:p-5">
                <div className="mb-3">
                  <h3 className="text-xs font-semibold text-fg">Delivery channels</h3>
                  <p className="mt-0.5 text-[0.65rem] text-muted">
                    Choose where analysis results are delivered.
                  </p>
                </div>

                <div className="divide-y divide-border/40">
                  <div className="py-3 first:pt-0">
                    <Toggle
                      layout="end"
                      checked={channelInApp}
                      onChange={() => { }}
                      disabled
                      label="In-app notifications"
                      description="Results appear in your notification center"
                    >
                      <span className="mt-1 inline-flex w-fit rounded border border-border bg-surface-2 px-1.5 py-0.5 text-[0.55rem] text-muted">
                        Always on
                      </span>
                    </Toggle>
                  </div>

                  <div className="py-3">
                    <Toggle
                      layout="end"
                      checked={channelEmail}
                      onChange={setChannelEmail}
                      disabled={!canEmailPush}
                      label="Email delivery"
                      description="Full analysis sent to your inbox"
                    >
                      {!canEmailPush && (
                        <span className="mt-1 inline-flex w-fit rounded border border-border bg-surface-2 px-1.5 py-0.5 text-[0.55rem] text-muted">
                          Starter+
                        </span>
                      )}
                    </Toggle>
                  </div>

                  <div className="py-3">
                    <Toggle
                      layout="end"
                      checked={channelPush}
                      onChange={setChannelPush}
                      disabled={!canEmailPush}
                      label="Push notifications"
                      description="Real-time alerts on mobile and desktop"
                    >
                      {!canEmailPush && (
                        <span className="mt-1 inline-flex w-fit rounded border border-border bg-surface-2 px-1.5 py-0.5 text-[0.55rem] text-muted">
                          Starter+
                        </span>
                      )}
                    </Toggle>
                  </div>

                  <div className="py-3 last:pb-0">
                    <Toggle
                      layout="end"
                      checked={channelWebhook}
                      onChange={setChannelWebhook}
                      disabled={!canWebhook}
                      label="Webhook delivery"
                      description="POST analysis JSON to your endpoint"
                    >
                      {!canWebhook && (
                        <span className="mt-1 inline-flex w-fit rounded border border-border bg-surface-2 px-1.5 py-0.5 text-[0.55rem] text-muted">
                          Pro
                        </span>
                      )}
                    </Toggle>
                  </div>
                </div>

                {channelWebhook && canWebhook && (
                  <div className="mt-4 rounded-xl border border-border/60 bg-bg/40 p-3">
                    <label
                      htmlFor="webhook-url"
                      className="mb-1.5 block text-[0.65rem] font-medium text-muted"
                    >
                      Webhook URL
                    </label>
                    <div className="flex flex-col gap-2 xs:flex-row">
                      <input
                        id="webhook-url"
                        type="url"
                        value={webhookUrl}
                        onChange={(event) => setWebhookUrl(event.target.value)}
                        placeholder="https://your-api.com/webhook/tradewizard"
                        className="min-w-0 flex-1 rounded-lg border border-border bg-bg px-3 py-2 font-mono text-xs text-fg placeholder:text-muted/60 focus:outline-none focus:ring-2 focus:ring-accent focus:ring-offset-2 focus:ring-offset-bg"
                      />
                      <Button
                        variant="secondary"
                        size="sm"
                        onClick={handleWebhookTest}
                        loading={webhookTesting}
                        disabled={!webhookUrl}
                        className="shrink-0"
                      >
                        Test
                      </Button>
                    </div>
                    {webhookTestResult && (
                      <p
                        className={`mt-2 flex items-center gap-1 text-[0.65rem] ${webhookTestResult.ok ? 'text-yes' : 'text-no'
                          }`}
                      >
                        {webhookTestResult.ok ? (
                          <Check className="h-3 w-3 shrink-0" aria-hidden="true" />
                        ) : (
                          <X className="h-3 w-3 shrink-0" aria-hidden="true" />
                        )}
                        {webhookTestResult.message}
                      </p>
                    )}
                  </div>
                )}
              </div>

              {/* Quiet hours */}
              <div className="p-4 sm:p-5">
                <div className="mb-3 flex items-center gap-2">
                  <Clock3 className="h-3.5 w-3.5 text-muted" aria-hidden="true" />
                  <h3 className="text-xs font-semibold text-fg">Quiet hours</h3>
                </div>
                <Toggle
                  layout="end"
                  checked={quietHoursEnabled}
                  onChange={setQuietHoursEnabled}
                  label="Enable quiet hours"
                  description="Only urgent alerts come through during this window"
                />

                {quietHoursEnabled && (
                  <div className="mt-4 flex flex-wrap items-center gap-3 rounded-xl border border-border/60 bg-bg/40 p-3">
                    <div className="flex items-center gap-2">
                      <label className="text-[0.65rem] text-muted" htmlFor="quiet-start">
                        From
                      </label>
                      <input
                        id="quiet-start"
                        type="time"
                        value={quietHoursStart}
                        onChange={(event) => setQuietHoursStart(event.target.value)}
                        className="rounded-lg border border-border bg-bg px-3 py-1.5 font-mono text-xs text-fg focus:outline-none focus:ring-2 focus:ring-accent focus:ring-offset-2 focus:ring-offset-bg"
                      />
                    </div>
                    <div className="flex items-center gap-2">
                      <label className="text-[0.65rem] text-muted" htmlFor="quiet-end">
                        To
                      </label>
                      <input
                        id="quiet-end"
                        type="time"
                        value={quietHoursEnd}
                        onChange={(event) => setQuietHoursEnd(event.target.value)}
                        className="rounded-lg border border-border bg-bg px-3 py-1.5 font-mono text-xs text-fg focus:outline-none focus:ring-2 focus:ring-accent focus:ring-offset-2 focus:ring-offset-bg"
                      />
                    </div>
                  </div>
                )}
              </div>

              {/* Alert thresholds */}
              <div className="p-4 sm:p-5">
                <div className="mb-3 flex items-center gap-2">
                  <SlidersHorizontal className="h-3.5 w-3.5 text-muted" aria-hidden="true" />
                  <h3 className="text-xs font-semibold text-fg">Alert thresholds</h3>
                </div>
                <Toggle
                  layout="end"
                  checked={probShiftEnabled}
                  onChange={setProbShiftEnabled}
                  label="Probability shift alerts"
                  description="Notify when a tracked market moves significantly"
                />

                {probShiftEnabled && (
                  <div className="mt-4 rounded-xl border border-border/60 bg-bg/40 p-3">
                    <Slider
                      min={1}
                      max={20}
                      step={1}
                      value={minProbabilityShift}
                      onChange={setMinProbabilityShift}
                      label="Minimum shift to trigger alert"
                      format={(value) => `±${value}% probability change`}
                    />
                  </div>
                )}
              </div>
            </div>
          </section>

          {/* Account rail */}
          <aside className="space-y-4 lg:sticky lg:top-[72px]">
            <Link
              href="/account/subscription"
              className="group block overflow-hidden rounded-2xl border border-border bg-surface transition-colors hover:border-accent/40"
            >
              <div className="p-4">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <CreditCard className="h-4 w-4 text-accent" aria-hidden="true" />
                    <h2 className="text-sm font-semibold text-fg">Subscription</h2>
                  </div>
                  <Badge tone="accent" size="sm">
                    {planLabel}
                  </Badge>
                </div>
                <p className="mt-3 font-mono text-2xl font-bold leading-none tabular-nums text-fg">
                  {creditsValue}
                </p>
                <p className="mt-1 text-[0.6rem] text-muted">{creditsCaption}</p>
                <p className="mt-2 text-[0.6rem] text-muted">
                  Manage your plan, credits, and payment method.
                </p>
                <span className="mt-3 inline-flex items-center gap-1 text-[0.65rem] font-medium text-accent">
                  Manage plan
                  <ChevronRight
                    className="h-3.5 w-3.5 transition-transform group-hover:translate-x-0.5"
                    aria-hidden="true"
                  />
                </span>
              </div>
            </Link>

            <TierGate plan="pro" feature="Trading Persona">
              <section className="overflow-hidden rounded-2xl border border-dashed border-accent/30 bg-surface">
                <div className="flex items-center gap-2 border-b border-dashed border-accent/15 px-4 py-3.5">
                  <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-accent text-white">
                    <Target className="h-4 w-4" aria-hidden="true" />
                  </span>
                  <div>
                    <h2 className="text-sm font-semibold text-fg">Trading persona</h2>
                    <p className="text-[0.6rem] text-muted">
                      Governs how Autopilot trades
                    </p>
                  </div>
                </div>

                <div className="p-4">
                  {personaLoading ? (
                    <div className="space-y-2" aria-hidden="true">
                      <Skeleton className="h-4 w-2/3" />
                      <Skeleton className="h-3 w-full" />
                      <Skeleton className="h-3 w-4/5" />
                    </div>
                  ) : personaData ? (
                    <>
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-sm font-semibold text-fg">
                          {personaData.persona.name}
                        </span>
                        <Badge tone={personaRiskTone} size="sm">
                          {personaRisk}
                        </Badge>
                      </div>
                      <p className="mt-1 text-[0.65rem] leading-relaxed text-muted">
                        {personaData.description?.tagline ??
                          'Your selected entry, sizing, monitoring, and exit rules.'}
                      </p>
                      <Link
                        href="/account/persona"
                        className="mt-3 inline-flex items-center gap-1 text-[0.65rem] font-medium text-accent transition-colors hover:text-fg"
                      >
                        Change persona
                        <ChevronRight className="h-3.5 w-3.5" aria-hidden="true" />
                      </Link>
                    </>
                  ) : (
                    <EmptyState
                      icon={Target}
                      title="No persona selected"
                      description="Pick a strategy to govern how Autopilot trades for you."
                      className="py-4"
                      action={
                        <Link
                          href="/account/persona"
                          className="inline-flex items-center gap-1.5 rounded-lg border border-accent/30 bg-accent/10 px-3 py-2 text-xs font-semibold text-accent transition-colors hover:bg-accent/15"
                        >
                          Select persona
                        </Link>
                      }
                    />
                  )}
                </div>
              </section>
            </TierGate>

            <section className="overflow-hidden rounded-2xl border border-border bg-surface">
              <div className="flex items-center gap-2 border-b border-border/60 px-4 py-3.5">
                <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-no/10 text-no">
                  <LogOut className="h-4 w-4" aria-hidden="true" />
                </span>
                <div>
                  <h2 className="text-sm font-semibold text-fg">Session</h2>
                  <p className="text-[0.6rem] text-muted">This device</p>
                </div>
              </div>
              <div className="p-4">
                <p className="text-[0.65rem] leading-relaxed text-muted">
                  Sign out of TradeWizard on this device. Your sessions and
                  preferences stay saved.
                </p>
                <Button
                  variant="danger"
                  size="sm"
                  onClick={() => {
                    signOut();
                    router.push('/login');
                  }}
                  className="mt-3 w-full"
                >
                  Sign out
                </Button>
              </div>
            </section>
          </aside>
        </div>
      </div>
    </AppShell>
  );
}
