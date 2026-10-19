'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { CreditCard, ChevronRight, LogOut } from 'lucide-react';
import { AppShell } from '@/components/shell/AppShell';
import { Card } from '@/components/ui/Card';
import { Toggle } from '@/components/ui/Toggle';
import { Slider } from '@/components/ui/Slider';
import { TierGate } from '@/components/ui/TierGate';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
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

  // Local form state
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
  const [webhookTestResult, setWebhookTestResult] = useState<string | null>(null);

  // Sync form state from server data
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
      // Convert from decimal (0.01-0.20) to percentage (1-20)
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
      setWebhookTestResult('✓ Webhook validated');
    } catch (err) {
      setWebhookTestResult(
        err instanceof Error ? err.message : 'Webhook test failed'
      );
    } finally {
      setWebhookTesting(false);
    }
  };

  if (prefsLoading) {
    return (
      <AppShell>
        <div className="animate-pulse space-y-4">
          <div className="h-8 w-64 rounded bg-surface-2" />
          <div className="h-4 w-96 rounded bg-surface-2" />
          <div className="h-48 rounded-[12px] bg-surface-2" />
          <div className="h-48 rounded-[12px] bg-surface-2" />
        </div>
      </AppShell>
    );
  }

  return (
    <AppShell>
      <div className="max-w-[720px] mx-auto space-y-5 sm:space-y-6">
        {/* Upgrade prompt for free users */}
        {plan === 'free' && (
          <UpgradePrompt
            variant="free-to-starter"
            message={
              <>
                You&apos;re on the <strong>Free plan</strong> - email, push, and
                webhook delivery require Starter+
              </>
            }
          />
        )}

        {plan === 'starter' && (
          <UpgradePrompt
            variant="starter-to-pro"
            message={
              <>
                Upgrade to <strong>Pro</strong> to unlock webhook delivery and
                Portfolio Manager
              </>
            }
          />
        )}

        {/* Page header */}
        <div>
          <h1 className="font-display text-xl sm:text-2xl font-bold tracking-tight">
            Settings
          </h1>
          <p className="text-sm text-muted mt-1">
            Manage your subscription, delivery preferences, and trading persona
          </p>
        </div>

        {/* Subscription & Plan */}
        <Link href="/account/subscription" className="block group">
          <Card className="p-5 transition-colors group-hover:border-accent/40">
            <div className="flex items-center gap-4">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[10px] bg-accent/10 text-accent">
                <CreditCard size={20} />
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-semibold">
                    Subscription &amp; Billing
                  </span>
                  <Badge tone="accent">
                    {plan.charAt(0).toUpperCase() + plan.slice(1)}
                  </Badge>
                </div>
                <p className="text-xs text-muted mt-0.5">
                  {plan === 'elite'
                    ? 'Unlimited credits · All features unlocked'
                    : subscription?.creditsRemaining != null
                    ? `${subscription.creditsRemaining} credits remaining this month`
                    : 'Manage your plan, credits, and payment method'}
                </p>
              </div>
              <ChevronRight
                size={18}
                className="shrink-0 text-muted group-hover:text-fg transition-colors"
              />
            </div>
          </Card>
        </Link>

        {/* Delivery Channels */}
        <Card className="p-4 sm:p-6">
          <h3 className="text-sm font-semibold mb-1">Delivery Channels</h3>
          <p className="text-xs text-muted mb-4 sm:mb-5">
            Choose where analysis results are delivered
          </p>

          <div className="space-y-1 divide-y divide-border/40">
            {/* In-app - always enabled */}
            <div className="py-3">
              <Toggle
                checked={channelInApp}
                onChange={() => {}}
                disabled
                label="In-app notifications"
                description="Results appear in your notification center"
              />
            </div>

            {/* Email */}
            <div className="py-3">
              <TierGate plan="starter" feature="Email delivery">
                <Toggle
                  checked={channelEmail}
                  onChange={setChannelEmail}
                  label="Email delivery"
                  description="Full analysis sent to your inbox"
                />
              </TierGate>
            </div>

            {/* Push */}
            <div className="py-3">
              <TierGate plan="starter" feature="Push notifications">
                <Toggle
                  checked={channelPush}
                  onChange={setChannelPush}
                  label="Push notifications"
                  description="Real-time alerts on mobile and desktop"
                />
              </TierGate>
            </div>

            {/* Webhook */}
            <div className="py-3">
              <TierGate plan="pro" feature="Webhook delivery">
                <Toggle
                  checked={channelWebhook}
                  onChange={setChannelWebhook}
                  label="Webhook delivery"
                  description="POST analysis JSON to your endpoint for programmatic use"
                />
              </TierGate>
            </div>
          </div>

          {/* Webhook URL input */}
          {channelWebhook && has('pro') && (
            <div className="mt-4 space-y-2">
              <label className="text-xs text-muted font-medium">
                Webhook URL
              </label>
              <div className="flex flex-col xs:flex-row gap-2">
                <input
                  type="url"
                  value={webhookUrl}
                  onChange={(e) => setWebhookUrl(e.target.value)}
                  placeholder="https://your-api.com/webhook/tradewizard"
                  className="flex-1 min-w-0 rounded-md border border-border bg-bg px-3 py-2 text-xs font-mono text-fg placeholder:text-muted/60 focus:outline-none focus:ring-2 focus:ring-accent focus:ring-offset-2 focus:ring-offset-bg"
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
                  className={`text-xs ${
                    webhookTestResult.startsWith('✓')
                      ? 'text-yes'
                      : 'text-no'
                  }`}
                >
                  {webhookTestResult}
                </p>
              )}
            </div>
          )}
        </Card>

        {/* Quiet Hours */}
        <Card className="p-4 sm:p-6">
          <h3 className="text-sm font-semibold mb-1">Quiet Hours</h3>
          <p className="text-xs text-muted mb-4 sm:mb-5">
            Pause non-critical notifications during these hours
          </p>

          <Toggle
            checked={quietHoursEnabled}
            onChange={setQuietHoursEnabled}
            label="Enable quiet hours"
            description="Only urgent alerts (large probability shifts) will come through"
          />

          {quietHoursEnabled && (
            <div className="flex flex-wrap items-center gap-3 mt-4">
              <div className="flex items-center gap-2">
                <label className="text-xs text-muted">From</label>
                <input
                  type="time"
                  value={quietHoursStart}
                  onChange={(e) => setQuietHoursStart(e.target.value)}
                  className="rounded-md border border-border bg-bg px-3 py-1.5 text-xs font-mono text-fg focus:outline-none focus:ring-2 focus:ring-accent focus:ring-offset-2 focus:ring-offset-bg"
                />
              </div>
              <div className="flex items-center gap-2">
                <label className="text-xs text-muted">To</label>
                <input
                  type="time"
                  value={quietHoursEnd}
                  onChange={(e) => setQuietHoursEnd(e.target.value)}
                  className="rounded-md border border-border bg-bg px-3 py-1.5 text-xs font-mono text-fg focus:outline-none focus:ring-2 focus:ring-accent focus:ring-offset-2 focus:ring-offset-bg"
                />
              </div>
            </div>
          )}
        </Card>

        {/* Alert Thresholds */}
        <Card className="p-4 sm:p-6">
          <h3 className="text-sm font-semibold mb-1">Alert Thresholds</h3>
          <p className="text-xs text-muted mb-4 sm:mb-5">
            Only notify when probability shifts exceed your threshold
          </p>

          <Toggle
            checked={probShiftEnabled}
            onChange={setProbShiftEnabled}
            label="Probability shift alerts"
            description="Get notified when a tracked market moves significantly"
          />

          {probShiftEnabled && (
            <div className="mt-4">
              <Slider
                min={1}
                max={20}
                step={1}
                value={minProbabilityShift}
                onChange={setMinProbabilityShift}
                label="Minimum shift to trigger alert"
                format={(v) => `±${v}% probability change`}
              />
            </div>
          )}
        </Card>

        {/* Trading Persona */}
        <TierGate plan="pro" feature="Trading Persona">
          <Card className="p-4 sm:p-6">
            <h3 className="text-sm font-semibold mb-1">Trading Persona</h3>
            <p className="text-xs text-muted mb-4 sm:mb-5">
              Your active persona governs how the Portfolio Manager trades on
              your behalf
            </p>

            {personaLoading ? (
              <div className="animate-pulse h-16 rounded-[12px] bg-surface-2" />
            ) : personaData ? (
              <div className="flex flex-col xs:flex-row items-start xs:items-center gap-3 xs:gap-4 rounded-[12px] border border-border bg-surface-2 p-4">
                <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-[10px] bg-ai/15 text-xl">
                  🎯
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-semibold">
                    {personaData.persona.name}
                  </div>
                  <div className="text-xs text-muted mt-0.5 truncate">
                    {personaData.persona.riskLevel.charAt(0).toUpperCase() +
                      personaData.persona.riskLevel.slice(1)}{' '}
                    · {personaData.description?.tagline ?? ''}
                  </div>
                </div>
                <Link
                  href="/account/persona"
                  className="shrink-0 rounded-md border border-ai/30 px-3 py-1.5 text-xs font-semibold text-ai transition-colors hover:bg-ai/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-bg"
                >
                  Change Persona
                </Link>
              </div>
            ) : (
              <div className="flex flex-col xs:flex-row items-start xs:items-center gap-3 xs:gap-4 rounded-[12px] border border-border bg-surface-2 p-4">
                <div className="flex-1 text-sm text-muted">
                  No persona selected yet.
                </div>
                <Link
                  href="/account/persona"
                  className="shrink-0 rounded-md border border-ai/30 px-3 py-1.5 text-xs font-semibold text-ai transition-colors hover:bg-ai/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-bg"
                >
                  Select Persona
                </Link>
              </div>
            )}
          </Card>
        </TierGate>

        {/* Save button */}
        <div className="flex justify-end">
          <Button
            variant="primary"
            size="md"
            onClick={handleSave}
            loading={updatePreferences.isPending}
          >
            Save Preferences
          </Button>
        </div>

        {/* Sign Out */}
        <Card className="p-4 sm:p-6">
          <div className="flex flex-col xs:flex-row items-start xs:items-center gap-3 xs:gap-4">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[10px] bg-no/10 text-no">
              <LogOut size={20} />
            </div>
            <div className="flex-1 min-w-0">
              <span className="text-sm font-semibold">Sign Out</span>
              <p className="text-xs text-muted mt-0.5">
                Sign out of your TradeWizard account on this device
              </p>
            </div>
            <Button
              variant="danger"
              size="sm"
              onClick={() => {
                signOut();
                router.push('/login');
              }}
              className="shrink-0"
            >
              Sign Out
            </Button>
          </div>
        </Card>
      </div>
    </AppShell>
  );
}
