'use client';

import { useState, useEffect } from 'react';
import { Bell, CheckCircle, AlertTriangle, Lock } from 'lucide-react';
import { useSubscription } from '@/hooks/useSubscription';
import {
  useNotificationPreferences,
  useUpdateNotificationPreferences,
  NotificationPreferences,
} from '@/hooks/useNotificationPreferences';
import { PlanRestrictionError } from '@/lib/api-client';

const CHANNEL_PLAN_REQUIREMENTS: Record<string, string[]> = {
  channelInApp: ['free', 'starter', 'pro', 'elite'],
  channelEmail: ['starter', 'pro', 'elite'],
  channelPush: ['starter', 'pro', 'elite'],
  channelWebhook: ['pro', 'elite'],
};

export default function NotificationSettings() {
  const { data: subscription } = useSubscription();
  const { data: preferences, isLoading } = useNotificationPreferences();
  const updatePreferences = useUpdateNotificationPreferences();

  const [form, setForm] = useState<NotificationPreferences>({
    channelInApp: true,
    channelEmail: false,
    channelPush: false,
    channelWebhook: false,
    webhookUrl: null,
    quietHoursStart: null,
    quietHoursEnd: null,
    minProbabilityShift: 0.05,
  });

  const [toast, setToast] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

  useEffect(() => {
    if (preferences) {
      setForm(preferences);
    }
  }, [preferences]);

  useEffect(() => {
    if (toast) {
      const timer = setTimeout(() => setToast(null), 5000);
      return () => clearTimeout(timer);
    }
  }, [toast]);

  const isChannelAvailable = (channel: string): boolean => {
    if (!subscription) return false;
    const allowedPlans = CHANNEL_PLAN_REQUIREMENTS[channel];
    return allowedPlans?.includes(subscription.plan) ?? false;
  };

  const getRequiredPlan = (channel: string): string => {
    const plans = CHANNEL_PLAN_REQUIREMENTS[channel];
    if (!plans || plans.length === 0) return 'elite';
    return plans[0];
  };

  const handleToggle = (channel: keyof NotificationPreferences) => {
    if (channel === 'channelInApp') return; // Always enabled
    setForm((prev) => ({ ...prev, [channel]: !prev[channel] }));
  };

  const handleSave = async () => {
    try {
      await updatePreferences.mutateAsync(form);
      setToast({ type: 'success', message: 'Notification preferences saved.' });
    } catch (error) {
      if (error instanceof PlanRestrictionError) {
        setToast({
          type: 'error',
          message: 'Your plan does not support some selected channels. Please upgrade.',
        });
      } else {
        setToast({ type: 'error', message: 'Failed to save preferences.' });
      }
    }
  };

  if (isLoading) {
    return (
      <div className="animate-pulse space-y-4">
        <div className="h-6 w-48 bg-white/10 rounded" />
        <div className="h-32 bg-white/5 rounded-xl" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Bell className="w-5 h-5 text-indigo-400" />
        <h2 className="text-xl font-bold text-white">Notification Settings</h2>
      </div>

      {/* Toast */}
      {toast && (
        <div
          className={`flex items-center gap-3 p-3 rounded-xl border text-sm ${
            toast.type === 'success'
              ? 'bg-green-500/10 border-green-500/30 text-green-300'
              : 'bg-red-500/10 border-red-500/30 text-red-300'
          }`}
        >
          {toast.type === 'success' ? (
            <CheckCircle className="w-4 h-4 shrink-0" />
          ) : (
            <AlertTriangle className="w-4 h-4 shrink-0" />
          )}
          {toast.message}
        </div>
      )}

      {/* Channel Toggles */}
      <div className="space-y-3">
        <p className="text-sm text-gray-400 font-medium">Delivery Channels</p>

        {/* In-App (always on) */}
        <div className="flex items-center justify-between p-3 rounded-xl bg-white/5 border border-white/10">
          <span className="text-sm text-white">In-App (WebSocket)</span>
          <div className="w-10 h-6 rounded-full bg-indigo-500 flex items-center justify-end px-0.5 cursor-not-allowed">
            <div className="w-5 h-5 rounded-full bg-white" />
          </div>
        </div>

        {/* Email */}
        <ChannelToggle
          label="Email"
          enabled={form.channelEmail}
          available={isChannelAvailable('channelEmail')}
          requiredPlan={getRequiredPlan('channelEmail')}
          onToggle={() => handleToggle('channelEmail')}
        />

        {/* Push */}
        <ChannelToggle
          label="Push Notifications"
          enabled={form.channelPush}
          available={isChannelAvailable('channelPush')}
          requiredPlan={getRequiredPlan('channelPush')}
          onToggle={() => handleToggle('channelPush')}
        />

        {/* Webhook */}
        <ChannelToggle
          label="Webhook"
          enabled={form.channelWebhook}
          available={isChannelAvailable('channelWebhook')}
          requiredPlan={getRequiredPlan('channelWebhook')}
          onToggle={() => handleToggle('channelWebhook')}
        />
      </div>

      {/* Webhook URL */}
      {form.channelWebhook && isChannelAvailable('channelWebhook') && (
        <div className="space-y-2">
          <label className="text-sm text-gray-400 font-medium">Webhook URL</label>
          <input
            type="url"
            value={form.webhookUrl ?? ''}
            onChange={(e) => setForm((prev) => ({ ...prev, webhookUrl: e.target.value || null }))}
            placeholder="https://your-server.com/webhook"
            className="w-full px-4 py-2.5 rounded-xl bg-white/5 border border-white/10 text-white text-sm placeholder-gray-500 focus:outline-none focus:border-indigo-500/50 focus:ring-1 focus:ring-indigo-500/30"
          />
        </div>
      )}

      {/* Quiet Hours */}
      <div className="space-y-3">
        <p className="text-sm text-gray-400 font-medium">Quiet Hours</p>
        <div className="flex items-center gap-4">
          <div className="space-y-1">
            <label className="text-xs text-gray-500">Start</label>
            <input
              type="time"
              value={form.quietHoursStart ?? ''}
              onChange={(e) =>
                setForm((prev) => ({ ...prev, quietHoursStart: e.target.value || null }))
              }
              className="px-3 py-2 rounded-xl bg-white/5 border border-white/10 text-white text-sm focus:outline-none focus:border-indigo-500/50"
            />
          </div>
          <div className="space-y-1">
            <label className="text-xs text-gray-500">End</label>
            <input
              type="time"
              value={form.quietHoursEnd ?? ''}
              onChange={(e) =>
                setForm((prev) => ({ ...prev, quietHoursEnd: e.target.value || null }))
              }
              className="px-3 py-2 rounded-xl bg-white/5 border border-white/10 text-white text-sm focus:outline-none focus:border-indigo-500/50"
            />
          </div>
        </div>
      </div>

      {/* Probability Shift Threshold */}
      <div className="space-y-2">
        <label className="text-sm text-gray-400 font-medium">
          Minimum Probability Shift Threshold
        </label>
        <p className="text-xs text-gray-500">
          Only notify when probability changes by at least this amount (0.01 - 1.00)
        </p>
        <input
          type="number"
          min={0.01}
          max={1.0}
          step={0.01}
          value={form.minProbabilityShift ?? ''}
          onChange={(e) => {
            const val = parseFloat(e.target.value);
            if (!isNaN(val) && val >= 0.01 && val <= 1.0) {
              setForm((prev) => ({ ...prev, minProbabilityShift: val }));
            }
          }}
          className="w-32 px-3 py-2 rounded-xl bg-white/5 border border-white/10 text-white text-sm focus:outline-none focus:border-indigo-500/50"
        />
      </div>

      {/* Save Button */}
      <button
        onClick={handleSave}
        disabled={updatePreferences.isPending}
        className="px-6 py-2.5 rounded-xl text-sm font-semibold bg-indigo-500 text-white hover:bg-indigo-600 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
      >
        {updatePreferences.isPending ? 'Saving...' : 'Save Preferences'}
      </button>
    </div>
  );
}

function ChannelToggle({
  label,
  enabled,
  available,
  requiredPlan,
  onToggle,
}: {
  label: string;
  enabled: boolean;
  available: boolean;
  requiredPlan: string;
  onToggle: () => void;
}) {
  return (
    <div
      className={`flex items-center justify-between p-3 rounded-xl border ${
        available ? 'bg-white/5 border-white/10' : 'bg-white/[0.02] border-white/5 opacity-60'
      }`}
    >
      <div className="flex items-center gap-2">
        <span className={`text-sm ${available ? 'text-white' : 'text-gray-500'}`}>{label}</span>
        {!available && (
          <span className="flex items-center gap-1 text-xs text-gray-500">
            <Lock className="w-3 h-3" />
            {requiredPlan}+ plan
          </span>
        )}
      </div>
      <button
        onClick={onToggle}
        disabled={!available}
        className={`w-10 h-6 rounded-full flex items-center px-0.5 transition-colors duration-200 ${
          !available
            ? 'bg-white/10 cursor-not-allowed'
            : enabled
            ? 'bg-indigo-500 justify-end'
            : 'bg-white/20 justify-start'
        }`}
      >
        <div className="w-5 h-5 rounded-full bg-white shadow-sm" />
      </button>
    </div>
  );
}
