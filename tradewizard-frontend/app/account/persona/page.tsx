'use client';

import { useState } from 'react';
import { AppShell } from '@/components/shell/AppShell';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Slider } from '@/components/ui/Slider';
import { TierGate } from '@/components/ui/TierGate';
import { EmptyState } from '@/components/ui/EmptyState';
import { usePersonaSettings, useUpdatePersonaSelection, type PersonaCustomParams } from '@/hooks/usePersonaSettings';
import { useUpdatePersonaParams, PERSONA_PARAM_RANGES } from '@/hooks/usePersonaParams';
import { cn } from '@/utils/classNames';
import {
  Check,
  Crosshair,
  Crown,
  Radar,
  RefreshCw,
  SlidersHorizontal,
  Target,
  Waves,
  Zap,
  type LucideIcon,
} from 'lucide-react';

interface PersonaDef {
  id: string;
  icon: LucideIcon;
  name: string;
  riskLevel: 'aggressive' | 'moderate' | 'conservative';
  philosophy: string;
  stats: {
    frequency: string;
    positionSize: string;
    holdDuration: string;
  };
  iconBg: string;
  iconTone: string;
}

const PERSONAS: PersonaDef[] = [
  {
    id: 'sniper',
    icon: Crosshair,
    name: 'The Sniper',
    riskLevel: 'aggressive',
    philosophy:
      'Patient assassin. Only strikes on high-conviction setups with edge >10%. Rare trades, large positions, decisive exits.',
    stats: { frequency: '1–2/week', positionSize: '40–60%', holdDuration: 'Days–weeks' },
    iconBg: 'bg-no/10',
    iconTone: 'text-no',
  },
  {
    id: 'scalper',
    icon: Zap,
    name: 'The Scalper',
    riskLevel: 'moderate',
    philosophy:
      'Speed demon. Exploits small edges rapidly with tight stops. High frequency, small positions, quick in-and-out.',
    stats: { frequency: 'Daily', positionSize: '10–25%', holdDuration: 'Hours–1 day' },
    iconBg: 'bg-warning/10',
    iconTone: 'text-warning',
  },
  {
    id: 'contrarian',
    icon: RefreshCw,
    name: 'The Contrarian',
    riskLevel: 'aggressive',
    philosophy:
      'Rebel thinker. Fades crowd consensus when agents detect overreaction. Bets against the herd with conviction.',
    stats: { frequency: '2–4/week', positionSize: '30–50%', holdDuration: 'Days' },
    iconBg: 'bg-ai/10',
    iconTone: 'text-ai',
  },
  {
    id: 'catalyst-hunter',
    icon: Radar,
    name: 'The Catalyst Hunter',
    riskLevel: 'moderate',
    philosophy:
      'Event detective. Positions before scheduled catalysts (debates, rulings, data releases). Time-sensitive, focused entries.',
    stats: { frequency: 'Event-driven', positionSize: '20–40%', holdDuration: 'Hours–days' },
    iconBg: 'bg-accent/10',
    iconTone: 'text-accent',
  },
  {
    id: 'hedge-architect',
    icon: Crown,
    name: 'The Hedge Architect',
    riskLevel: 'conservative',
    philosophy:
      'Chess master. Builds multi-position spreads to reduce directional risk. Methodical, balanced, capital-preserving.',
    stats: { frequency: '2–3/week', positionSize: '15–30%', holdDuration: 'Days–weeks' },
    iconBg: 'bg-yes/10',
    iconTone: 'text-yes',
  },
  {
    id: 'momentum-rider',
    icon: Waves,
    name: 'The Momentum Rider',
    riskLevel: 'aggressive',
    philosophy:
      'Wave surfer. Follows strong trends with pyramiding. Adds to winners, cuts losers fast, rides until momentum breaks.',
    stats: { frequency: '3–5/week', positionSize: '25–50%', holdDuration: 'Days' },
    iconBg: 'bg-warning/10',
    iconTone: 'text-warning',
  },
];

const RISK_BADGE_TONE: Record<PersonaDef['riskLevel'], 'no' | 'warning' | 'yes'> = {
  aggressive: 'no',
  moderate: 'warning',
  conservative: 'yes',
};

export default function PersonaSelectionPage() {
  const { data: personaSettings, isLoading: personaLoading } = usePersonaSettings();
  const {
    mutate: updatePersona,
    isPending: isSaving,
    isSuccess: isSaved,
  } = useUpdatePersonaSelection();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const currentPersonaId = selectedId ?? personaSettings?.personaId ?? null;
  const currentPersona = PERSONAS.find((persona) => persona.id === currentPersonaId) ?? null;

  const handleSave = () => {
    if (!currentPersonaId) return;
    updatePersona({ personaId: currentPersonaId });
  };

  if (personaLoading) {
    return (
      <AppShell>
        <div className="w-full animate-pulse" aria-hidden="true">
          <div className="h-10 w-56 rounded bg-surface-2" />
          <div className="mt-2 h-4 w-96 max-w-full rounded bg-surface-2" />
          <div className="mt-6 grid gap-4 lg:grid-cols-[minmax(0,1fr)_360px]">
            <div className="h-[560px] rounded-2xl bg-surface-2" />
            <div className="space-y-4">
              <div className="h-56 rounded-2xl bg-surface-2" />
              <div className="h-64 rounded-2xl bg-surface-2" />
            </div>
          </div>
        </div>
      </AppShell>
    );
  }

  return (
    <AppShell>
      <div className="w-full">
        <header className="border-b border-border pb-6">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <h1 className="font-display text-[clamp(1.9rem,3.8vw,2.75rem)] font-bold leading-none tracking-[-0.04em] text-fg">
                  Trading persona
                </h1>
                {currentPersona && (
                  <Badge tone="accent" size="sm">
                    {currentPersona.name}
                  </Badge>
                )}
              </div>
              <p className="mt-2 text-sm text-muted">
                One strategy governs every new Autopilot session.
              </p>
            </div>

            <div className="flex items-center justify-between gap-3 sm:justify-end">
              {isSaved && (
                <span className="inline-flex items-center gap-1 text-[0.65rem] font-medium text-yes">
                  <Check className="h-3.5 w-3.5" aria-hidden="true" />
                  Persona saved
                </span>
              )}
              <Button
                variant="primary"
                size="md"
                onClick={handleSave}
                loading={isSaving}
                disabled={!currentPersonaId || currentPersonaId === personaSettings?.personaId}
                className="shrink-0"
              >
                Save persona
              </Button>
            </div>
          </div>
        </header>

        <div className="mt-5 grid grid-cols-1 items-start gap-4 lg:grid-cols-[minmax(0,1fr)_360px]">
          <section className="order-2 overflow-hidden rounded-2xl border border-border bg-surface lg:order-none">
            <div className="flex items-center justify-between gap-3 border-b border-border/60 px-4 py-3.5 sm:px-5">
              <div>
                <h2 className="text-sm font-semibold text-fg">Choose a strategy</h2>
                <p className="text-[0.6rem] text-muted">
                  Existing sessions keep their original persona.
                </p>
              </div>
              <span className="font-mono text-[0.6rem] text-muted">
                {PERSONAS.length} strategies
              </span>
            </div>

            <div
              role="radiogroup"
              aria-label="Trading persona"
              className="grid grid-cols-1 gap-px bg-border/60 sm:grid-cols-2 xl:grid-cols-3"
            >
              {PERSONAS.map((persona) => {
                const isSelected = currentPersonaId === persona.id;

                return (
                  <button
                    key={persona.id}
                    type="button"
                    role="radio"
                    aria-checked={isSelected}
                    aria-label={`Select ${persona.name}`}
                    onClick={() => setSelectedId(persona.id)}
                    className={cn(
                      'relative bg-surface p-4 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent',
                      isSelected ? 'bg-accent/[0.06]' : 'hover:bg-surface-2/40'
                    )}
                  >
                    {isSelected && (
                      <span
                        className="pointer-events-none absolute inset-0 ring-1 ring-inset ring-accent"
                        aria-hidden="true"
                      />
                    )}

                    <div className="flex items-start justify-between gap-2">
                      <div className="flex min-w-0 items-center gap-2.5">
                        <span
                          className={cn(
                            'flex h-9 w-9 shrink-0 items-center justify-center rounded-lg',
                            persona.iconBg,
                            persona.iconTone
                          )}
                        >
                          <persona.icon className="h-4 w-4" aria-hidden="true" />
                        </span>
                        <div className="min-w-0">
                          <div className="truncate text-sm font-semibold text-fg">
                            {persona.name}
                          </div>
                          <Badge
                            tone={RISK_BADGE_TONE[persona.riskLevel]}
                            size="sm"
                            className="mt-1 capitalize"
                          >
                            {persona.riskLevel}
                          </Badge>
                        </div>
                      </div>

                      <span
                        className={cn(
                          'flex h-5 w-5 shrink-0 items-center justify-center rounded-full border',
                          isSelected
                            ? 'border-accent bg-accent text-white'
                            : 'border-border bg-surface'
                        )}
                        aria-hidden="true"
                      >
                        {isSelected && <Check className="h-3 w-3" />}
                      </span>
                    </div>

                    <p className="mt-3 line-clamp-3 text-xs leading-relaxed text-muted">
                      {persona.philosophy}
                    </p>

                    <div className="mt-3 grid grid-cols-3 gap-2 border-t border-border/60 pt-3">
                      {[
                        ['Frequency', persona.stats.frequency],
                        ['Position', persona.stats.positionSize],
                        ['Hold', persona.stats.holdDuration],
                      ].map(([label, value]) => (
                        <div key={label} className="min-w-0">
                          <p className="text-[0.52rem] text-muted">{label}</p>
                          <p className="mt-0.5 truncate font-mono text-[0.62rem] text-fg">
                            {value}
                          </p>
                        </div>
                      ))}
                    </div>
                  </button>
                );
              })}
            </div>
          </section>

          <aside className="contents min-w-0 lg:sticky lg:top-[72px] lg:col-start-2 lg:row-start-1 lg:block lg:self-start lg:space-y-4">
            <div className="order-1 lg:order-none">
            <section className="overflow-hidden rounded-2xl border border-border bg-surface">
              <div className="flex items-center gap-2 border-b border-border/60 px-4 py-3.5">
                <span className="flex h-8 w-8 items-center justify-center rounded-lg border border-accent/20 bg-accent/10 text-accent">
                  <Target className="h-4 w-4" aria-hidden="true" />
                </span>
                <div>
                  <h2 className="text-sm font-semibold text-fg">Active strategy</h2>
                  <p className="text-[0.6rem] text-muted">Applied to new sessions</p>
                </div>
              </div>

              <div className="p-4">
                {currentPersona ? (
                  <>
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-sm font-semibold text-fg">
                        {currentPersona.name}
                      </span>
                      <Badge tone={RISK_BADGE_TONE[currentPersona.riskLevel]} size="sm">
                        {currentPersona.riskLevel}
                      </Badge>
                    </div>
                    <p className="mt-1 text-[0.65rem] leading-relaxed text-muted">
                      {currentPersona.philosophy}
                    </p>
                    <div className="mt-3 grid grid-cols-3 gap-2 border-t border-border/60 pt-3">
                      {[
                        ['Frequency', currentPersona.stats.frequency],
                        ['Position', currentPersona.stats.positionSize],
                        ['Hold', currentPersona.stats.holdDuration],
                      ].map(([label, value]) => (
                        <div key={label} className="min-w-0">
                          <p className="text-[0.52rem] text-muted">{label}</p>
                          <p className="mt-0.5 truncate font-mono text-[0.62rem] text-fg">
                            {value}
                          </p>
                        </div>
                      ))}
                    </div>
                    <p className="mt-3 border-t border-border/60 pt-3 text-[0.58rem] leading-relaxed text-muted">
                      Changes apply to new Autopilot sessions. Existing sessions
                      keep the persona they started with.
                    </p>
                  </>
                ) : (
                  <EmptyState
                    icon={Target}
                    title="No persona selected"
                    description="Pick a strategy from the grid to set the default."
                    className="py-4"
                  />
                )}
              </div>
            </section>
            </div>

            <div className="order-3 lg:order-none">
              <TierGate plan="elite" feature="Persona Customization">
                <PersonaFineTune customParams={personaSettings?.customParams} />
              </TierGate>
            </div>
          </aside>
        </div>
      </div>
    </AppShell>
  );
}

function PersonaFineTune({
  customParams,
}: {
  customParams?: PersonaCustomParams | null;
}) {
  const { mutate: updateParams } = useUpdatePersonaParams();
  const [exitSensitivity, setExitSensitivity] = useState(
    customParams?.exitSensitivity ?? 3
  );
  const [monitoringFreq, setMonitoringFreq] = useState(
    customParams?.monitoringFrequencyMinutes ?? 15
  );
  const [sizingAggression, setSizingAggression] = useState(
    customParams?.positionSizingMultiplier
      ? customParams.positionSizingMultiplier * 10
      : 10
  );

  const handleParamChange = (
    param: 'exitSensitivity' | 'monitoringFrequencyMinutes' | 'positionSizingMultiplier',
    value: number
  ) => {
    updateParams({ [param]: value });
  };

  return (
    <section className="overflow-hidden rounded-2xl border border-dashed border-warning/30 bg-surface">
      <div className="flex items-center gap-2 border-b border-dashed border-warning/20 px-4 py-3.5">
        <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-warning/10 text-warning">
          <SlidersHorizontal className="h-4 w-4" aria-hidden="true" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h2 className="text-sm font-semibold text-fg">Fine-tune</h2>
            <span className="rounded-full border border-warning/30 bg-warning/10 px-1.5 py-0.5 text-[0.55rem] font-medium text-warning">
              Elite
            </span>
          </div>
          <p className="text-[0.6rem] text-muted">Tune the persona&apos;s behavior</p>
        </div>
      </div>

      <div className="divide-y divide-border/60 p-4">
        <div className="pb-3">
          <div className="mb-2 flex items-baseline justify-between gap-2">
            <span className="text-xs font-medium text-fg">Exit sensitivity</span>
            <span className="font-mono text-[0.6rem] text-muted">
              {exitSensitivity}/5
            </span>
          </div>
          <Slider
            min={PERSONA_PARAM_RANGES.exitSensitivity.min}
            max={PERSONA_PARAM_RANGES.exitSensitivity.max}
            step={PERSONA_PARAM_RANGES.exitSensitivity.step}
            value={exitSensitivity}
            onChange={(value) => {
              setExitSensitivity(value);
              handleParamChange('exitSensitivity', value);
            }}
            format={(value) => `${value}/5`}
          />
          <p className="mt-1 text-[0.58rem] text-muted">
            How quickly to exit losing positions
          </p>
        </div>

        <div className="py-3">
          <div className="mb-2 flex items-baseline justify-between gap-2">
            <span className="text-xs font-medium text-fg">Monitoring frequency</span>
            <span className="font-mono text-[0.6rem] text-muted">{monitoringFreq}m</span>
          </div>
          <Slider
            min={PERSONA_PARAM_RANGES.monitoringFrequencyMinutes.min}
            max={PERSONA_PARAM_RANGES.monitoringFrequencyMinutes.max}
            step={PERSONA_PARAM_RANGES.monitoringFrequencyMinutes.step}
            value={monitoringFreq}
            onChange={(value) => {
              setMonitoringFreq(value);
              handleParamChange('monitoringFrequencyMinutes', value);
            }}
            format={(value) => `${value}m`}
          />
          <p className="mt-1 text-[0.58rem] text-muted">
            How often positions are checked
          </p>
        </div>

        <div className="pt-3">
          <div className="mb-2 flex items-baseline justify-between gap-2">
            <span className="text-xs font-medium text-fg">Sizing aggression</span>
            <span className="font-mono text-[0.6rem] text-muted">
              {(sizingAggression / 10).toFixed(1)}x
            </span>
          </div>
          <Slider
            min={PERSONA_PARAM_RANGES.positionSizingMultiplier.min * 10}
            max={PERSONA_PARAM_RANGES.positionSizingMultiplier.max * 10}
            step={1}
            value={sizingAggression}
            onChange={(value) => {
              setSizingAggression(value);
              handleParamChange('positionSizingMultiplier', value / 10);
            }}
            format={(value) => `${(value / 10).toFixed(1)}x`}
          />
          <p className="mt-1 text-[0.58rem] text-muted">
            Multiplier applied to position sizes
          </p>
        </div>
      </div>
    </section>
  );
}
