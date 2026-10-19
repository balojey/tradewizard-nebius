'use client';

import { useState } from 'react';
import { AppShell } from '@/components/shell/AppShell';
import { Card } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Slider } from '@/components/ui/Slider';
import { TierGate } from '@/components/ui/TierGate';
import { usePersonaSettings, useUpdatePersonaSelection } from '@/hooks/usePersonaSettings';
import { useUpdatePersonaParams, PERSONA_PARAM_RANGES } from '@/hooks/usePersonaParams';
import { useCurrentPlan } from '@/hooks/useCurrentPlan';
import { cn } from '@/utils/classNames';

/**
 * Persona definition for the six-card grid.
 */
interface PersonaDef {
  id: string;
  icon: string;
  name: string;
  riskLevel: 'aggressive' | 'moderate' | 'conservative';
  philosophy: string;
  stats: {
    frequency: string;
    positionSize: string;
    holdDuration: string;
  };
  iconBg: string;
}

const PERSONAS: PersonaDef[] = [
  {
    id: 'sniper',
    icon: '🎯',
    name: 'The Sniper',
    riskLevel: 'aggressive',
    philosophy:
      'Patient assassin. Only strikes on high-conviction setups with edge >10%. Rare trades, large positions, decisive exits.',
    stats: { frequency: '1–2/week', positionSize: '40–60%', holdDuration: 'Days–weeks' },
    iconBg: 'bg-no/10',
  },
  {
    id: 'scalper',
    icon: '⚡',
    name: 'The Scalper',
    riskLevel: 'moderate',
    philosophy:
      'Speed demon. Exploits small edges rapidly with tight stops. High frequency, small positions, quick in-and-out.',
    stats: { frequency: 'Daily', positionSize: '10–25%', holdDuration: 'Hours–1 day' },
    iconBg: 'bg-warning/10',
  },
  {
    id: 'contrarian',
    icon: '🔄',
    name: 'The Contrarian',
    riskLevel: 'aggressive',
    philosophy:
      'Rebel thinker. Fades crowd consensus when agents detect overreaction. Bets against the herd with conviction.',
    stats: { frequency: '2–4/week', positionSize: '30–50%', holdDuration: 'Days' },
    iconBg: 'bg-ai/10',
  },
  {
    id: 'catalyst-hunter',
    icon: '📡',
    name: 'The Catalyst Hunter',
    riskLevel: 'moderate',
    philosophy:
      'Event detective. Positions before scheduled catalysts (debates, rulings, data releases). Time-sensitive, focused entries.',
    stats: { frequency: 'Event-driven', positionSize: '20–40%', holdDuration: 'Hours–days' },
    iconBg: 'bg-accent/10',
  },
  {
    id: 'hedge-architect',
    icon: '♟️',
    name: 'The Hedge Architect',
    riskLevel: 'conservative',
    philosophy:
      'Chess master. Builds multi-position spreads to reduce directional risk. Methodical, balanced, capital-preserving.',
    stats: { frequency: '2–3/week', positionSize: '15–30%', holdDuration: 'Days–weeks' },
    iconBg: 'bg-yes/10',
  },
  {
    id: 'momentum-rider',
    icon: '🌊',
    name: 'The Momentum Rider',
    riskLevel: 'aggressive',
    philosophy:
      'Wave surfer. Follows strong trends with pyramiding. Adds to winners, cuts losers fast, rides until momentum breaks.',
    stats: { frequency: '3–5/week', positionSize: '25–50%', holdDuration: 'Days' },
    iconBg: 'bg-warning/10',
  },
];

const RISK_BADGE_TONE: Record<PersonaDef['riskLevel'], 'no' | 'warning' | 'yes'> = {
  aggressive: 'no',
  moderate: 'warning',
  conservative: 'yes',
};

export default function PersonaSelectionPage() {
  const { data: personaSettings, isLoading } = usePersonaSettings();
  const { mutate: updatePersona, isPending: isSaving } = useUpdatePersonaSelection();
  const { mutate: updateParams } = useUpdatePersonaParams();
  const { canCustomizePersona } = useCurrentPlan();

  // Local selection state - not persisted until Save
  const [selectedId, setSelectedId] = useState<string | null>(null);

  // Derive the effective selected persona (local override or server value)
  const currentPersonaId = selectedId ?? personaSettings?.personaId ?? null;

  // Customization slider state
  const [exitSensitivity, setExitSensitivity] = useState<number>(
    personaSettings?.customParams?.exitSensitivity ?? 3
  );
  const [monitoringFreq, setMonitoringFreq] = useState<number>(
    personaSettings?.customParams?.monitoringFrequencyMinutes ?? 15
  );
  const [sizingAggression, setSizingAggression] = useState<number>(
    personaSettings?.customParams?.positionSizingMultiplier
      ? personaSettings.customParams.positionSizingMultiplier * 10
      : 10
  );

  // Sync slider state when server data loads
  const [lastSyncedId, setLastSyncedId] = useState<string | null>(null);
  if (personaSettings && personaSettings.personaId !== lastSyncedId) {
    setLastSyncedId(personaSettings.personaId);
    if (selectedId === null) {
      // Don't override user's local selection
    }
    if (personaSettings.customParams) {
      setExitSensitivity(personaSettings.customParams.exitSensitivity ?? 3);
      setMonitoringFreq(personaSettings.customParams.monitoringFrequencyMinutes ?? 15);
      setSizingAggression(
        personaSettings.customParams.positionSizingMultiplier
          ? personaSettings.customParams.positionSizingMultiplier * 10
          : 10
      );
    }
  }

  const handleSave = () => {
    if (!currentPersonaId) return;
    updatePersona({ personaId: currentPersonaId });
  };

  const handleParamChange = (
    param: 'exitSensitivity' | 'monitoringFrequencyMinutes' | 'positionSizingMultiplier',
    value: number
  ) => {
    updateParams({ [param]: value });
  };

  return (
    <AppShell>
      <div className="max-w-[900px] mx-auto">
        <h1 className="font-display text-xl sm:text-2xl font-bold tracking-tight mb-1">
          Trading Persona
        </h1>
        <p className="text-sm text-muted mb-6 sm:mb-8">
          Choose the strategy that governs all Portfolio Manager sessions. One persona applies
          globally.
        </p>

        {/* Six-card persona grid */}
        <div className="grid grid-cols-1 xs:grid-cols-2 lg:grid-cols-3 gap-3 sm:gap-4 mb-6 sm:mb-8">
          {PERSONAS.map((persona) => {
            const isSelected = currentPersonaId === persona.id;
            return (
              <Card
                key={persona.id}
                className={cn(
                  'p-4 sm:p-6 cursor-pointer transition-all relative border-2',
                  isSelected
                    ? 'border-ai shadow-[0_0_0_1px_var(--ai),0_4px_20px_oklch(58%_0.18_295_/_0.15)]'
                    : 'border-border hover:border-muted'
                )}
              >
                <button
                  type="button"
                  className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
                  onClick={() => setSelectedId(persona.id)}
                  aria-label={`Select ${persona.name}`}
                  aria-pressed={isSelected}
                />

                {/* Check mark for selected */}
                {isSelected && (
                  <span className="absolute top-4 right-4 w-[22px] h-[22px] rounded-full bg-ai flex items-center justify-center">
                    <svg
                      viewBox="0 0 24 24"
                      className="w-3 h-3 stroke-white fill-none"
                      strokeWidth={3}
                    >
                      <path d="M5 12l5 5L20 7" />
                    </svg>
                  </span>
                )}

                {/* Persona icon */}
                <div
                  className={cn(
                    'w-11 h-11 rounded-[10px] grid place-items-center text-xl mb-4',
                    persona.iconBg
                  )}
                >
                  {persona.icon}
                </div>

                {/* Name */}
                <div className="font-semibold text-sm mb-1">{persona.name}</div>

                {/* Risk badge */}
                <Badge tone={RISK_BADGE_TONE[persona.riskLevel]} size="sm" className="mb-3 uppercase tracking-wide">
                  {persona.riskLevel}
                </Badge>

                {/* Philosophy */}
                <p className="text-xs text-muted leading-relaxed mb-4">
                  {persona.philosophy}
                </p>

                {/* Stats */}
                <div className="flex flex-wrap gap-x-4 gap-y-2 text-[11px] text-muted">
                  <span className="flex flex-col gap-0.5">
                    <span className="text-[9px] uppercase tracking-wide">Frequency</span>
                    <span className="font-mono text-fg font-medium">
                      {persona.stats.frequency}
                    </span>
                  </span>
                  <span className="flex flex-col gap-0.5">
                    <span className="text-[9px] uppercase tracking-wide">Position</span>
                    <span className="font-mono text-fg font-medium">
                      {persona.stats.positionSize}
                    </span>
                  </span>
                  <span className="flex flex-col gap-0.5">
                    <span className="text-[9px] uppercase tracking-wide">Hold</span>
                    <span className="font-mono text-fg font-medium">
                      {persona.stats.holdDuration}
                    </span>
                  </span>
                </div>
              </Card>
            );
          })}
        </div>

        {/* Elite: Customize Parameters section */}
        <TierGate plan="elite" feature="Persona Customization">
          <Card className="p-4 sm:p-6 mb-6 sm:mb-8">
            <h3 className="text-sm font-semibold mb-1">Customize Parameters</h3>
            <p className="text-xs text-muted mb-4 sm:mb-5">
              Fine-tune your persona&apos;s behavior
            </p>

            <div className="space-y-0">
              {/* Exit Sensitivity */}
              <div className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-4 py-3 border-b border-border/40">
                <div className="sm:flex-[0_0_140px]">
                  <div className="text-xs font-medium">Exit Sensitivity</div>
                  <div className="text-[11px] text-muted mt-0.5">
                    How quickly to exit losing positions
                  </div>
                </div>
                <div className="flex-1">
                  <Slider
                    min={PERSONA_PARAM_RANGES.exitSensitivity.min}
                    max={PERSONA_PARAM_RANGES.exitSensitivity.max}
                    step={PERSONA_PARAM_RANGES.exitSensitivity.step}
                    value={exitSensitivity}
                    onChange={(v) => {
                      setExitSensitivity(v);
                      handleParamChange('exitSensitivity', v);
                    }}
                    format={(v) => `${v}/5`}
                  />
                </div>
              </div>

              {/* Monitoring Frequency */}
              <div className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-4 py-3 border-b border-border/40">
                <div className="sm:flex-[0_0_140px]">
                  <div className="text-xs font-medium">Monitoring Freq</div>
                  <div className="text-[11px] text-muted mt-0.5">
                    How often to check positions (minutes)
                  </div>
                </div>
                <div className="flex-1">
                  <Slider
                    min={PERSONA_PARAM_RANGES.monitoringFrequencyMinutes.min}
                    max={PERSONA_PARAM_RANGES.monitoringFrequencyMinutes.max}
                    step={PERSONA_PARAM_RANGES.monitoringFrequencyMinutes.step}
                    value={monitoringFreq}
                    onChange={(v) => {
                      setMonitoringFreq(v);
                      handleParamChange('monitoringFrequencyMinutes', v);
                    }}
                    format={(v) => `${v}m`}
                  />
                </div>
              </div>

              {/* Sizing Aggression */}
              <div className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-4 py-3">
                <div className="sm:flex-[0_0_140px]">
                  <div className="text-xs font-medium">Sizing Aggression</div>
                  <div className="text-[11px] text-muted mt-0.5">
                    Position size multiplier
                  </div>
                </div>
                <div className="flex-1">
                  <Slider
                    min={PERSONA_PARAM_RANGES.positionSizingMultiplier.min * 10}
                    max={PERSONA_PARAM_RANGES.positionSizingMultiplier.max * 10}
                    step={1}
                    value={sizingAggression}
                    onChange={(v) => {
                      setSizingAggression(v);
                      handleParamChange('positionSizingMultiplier', v / 10);
                    }}
                    format={(v) => `${(v / 10).toFixed(1)}x`}
                  />
                </div>
              </div>
            </div>
          </Card>
        </TierGate>

        {/* Save button */}
        <Button
          variant="ai"
          size="lg"
          onClick={handleSave}
          loading={isSaving}
          disabled={!currentPersonaId || currentPersonaId === personaSettings?.personaId}
        >
          Save Persona
        </Button>
      </div>
    </AppShell>
  );
}
