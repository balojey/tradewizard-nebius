/**
 * Persona Registry - defines all 6 trading personas with their rules and parameters.
 *
 * Requirements: 2.1, 2.2, 2.3, 2.4, 3.3, 3.4
 */

import type { Persona, RiskLevel, PersonaCustomParams } from './portfolio-types';

// ============================================================================
// PERSONA DEFINITIONS
// ============================================================================

/**
 * The Sniper: High-conviction, concentrated bets.
 * Only enters when edge > 10% and signal alignment > 0.8.
 * Allocates 30–50% per trade on rare, high-confidence opportunities.
 * Exits when Conviction_Score drops below 0.5 or edge narrows below 5%.
 */
const SNIPER: Persona = {
  id: 'sniper',
  name: 'The Sniper',
  riskLevel: 'aggressive',
  entryRules: {
    minEdge: 10,
    minSignalAlignment: 0.8,
    minConvictionScore: 0.7,
    additionalCriteria: {
      exitConvictionThreshold: 0.5,
      exitEdgeThreshold: 5,
    },
  },
  sizingRules: {
    minAllocationPct: 30,
    maxAllocationPct: 50,
    scalingFactor: 1.5,
  },
  exitRules: {
    patienceWindowMinutes: 240, // 4 hours
  },
  monitoringRules: {
    analysisIntervalMinutes: 30,
    positionGuardIntervalMinutes: 30,
  },
};

/**
 * The Scalper: Rapid, small-edge exploitation.
 * Enters on edges as low as 3% with signal alignment >= 0.5.
 * Allocates 5–15% per trade. Only enters markets with bid-ask spread <= 2%.
 * Exits when edge drops below 1% or signal alignment drops below 0.4.
 */
const SCALPER: Persona = {
  id: 'scalper',
  name: 'The Scalper',
  riskLevel: 'moderate',
  entryRules: {
    minEdge: 3,
    minSignalAlignment: 0.5,
    minConvictionScore: 0.4,
    additionalCriteria: {
      maxSpreadPct: 2,
      exitEdgeThreshold: 1,
      exitSignalAlignmentThreshold: 0.4,
    },
  },
  sizingRules: {
    minAllocationPct: 5,
    maxAllocationPct: 15,
    scalingFactor: 1.0,
  },
  exitRules: {
    patienceWindowMinutes: 15,
  },
  monitoringRules: {
    analysisIntervalMinutes: 5,
    positionGuardIntervalMinutes: 5,
  },
};

/**
 * The Contrarian: Fades crowd consensus.
 * Enters when social sentiment diverges from fundamental probability by > 20pp.
 * Allocates 20–35% per trade. Buys fear, sells euphoria.
 * Exits when sentiment-fundamental divergence narrows to within 5pp.
 */
const CONTRARIAN: Persona = {
  id: 'contrarian',
  name: 'The Contrarian',
  riskLevel: 'aggressive',
  entryRules: {
    minEdge: 5,
    minSignalAlignment: 0.4,
    minConvictionScore: 0.5,
    additionalCriteria: {
      minSentimentDivergencePp: 20,
      exitDivergenceThresholdPp: 5,
    },
  },
  sizingRules: {
    minAllocationPct: 20,
    maxAllocationPct: 35,
    scalingFactor: 1.2,
  },
  exitRules: {
    patienceWindowMinutes: 120, // 2 hours
  },
  monitoringRules: {
    analysisIntervalMinutes: 15,
    positionGuardIntervalMinutes: 15,
  },
};

/**
 * The Catalyst Hunter: Event-driven specialist.
 * Identifies upcoming catalysts and positions before the event.
 * Allocates 20–40% per trade. Exits immediately after catalyst resolution.
 * All positions are time-boxed to the catalyst event window.
 */
const CATALYST_HUNTER: Persona = {
  id: 'catalyst-hunter',
  name: 'The Catalyst Hunter',
  riskLevel: 'moderate',
  entryRules: {
    minEdge: 5,
    minSignalAlignment: 0.6,
    minConvictionScore: 0.6,
    additionalCriteria: {
      requiresCatalystEvent: true,
      exitOnCatalystResolution: true,
    },
  },
  sizingRules: {
    minAllocationPct: 20,
    maxAllocationPct: 40,
    scalingFactor: 1.3,
  },
  exitRules: {
    patienceWindowMinutes: 60, // 1 hour
  },
  monitoringRules: {
    analysisIntervalMinutes: 15,
    positionGuardIntervalMinutes: 15,
  },
};

/**
 * The Hedge Architect: Multi-position strategist.
 * Builds positions across related markets to reduce directional exposure.
 * Max 20% per individual position. Targets consistent gains through spread trades.
 */
const HEDGE_ARCHITECT: Persona = {
  id: 'hedge-architect',
  name: 'The Hedge Architect',
  riskLevel: 'conservative',
  entryRules: {
    minEdge: 3,
    minSignalAlignment: 0.5,
    minConvictionScore: 0.5,
    additionalCriteria: {
      maxPositionPct: 20,
      prefersCorrelatedMarkets: true,
    },
  },
  sizingRules: {
    minAllocationPct: 10,
    maxAllocationPct: 20,
    scalingFactor: 0.8,
  },
  exitRules: {
    patienceWindowMinutes: 120, // 2 hours
  },
  monitoringRules: {
    analysisIntervalMinutes: 15,
    positionGuardIntervalMinutes: 15,
  },
};

/**
 * The Momentum Rider: Trend-following specialist.
 * Enters when price momentum confirms analysis direction (3 consecutive moves).
 * Allocates 15–25% initial entry, pyramids up to 60% max total.
 * Exits when price reverses > 10% from local peak or 2 consecutive weakening signals.
 */
const MOMENTUM_RIDER: Persona = {
  id: 'momentum-rider',
  name: 'The Momentum Rider',
  riskLevel: 'aggressive',
  entryRules: {
    minEdge: 5,
    minSignalAlignment: 0.6,
    minConvictionScore: 0.5,
    additionalCriteria: {
      requiredConsecutiveMoves: 3,
      maxTotalAllocationPct: 60,
      exitReversalPct: 10,
      exitWeakeningSignalCycles: 2,
    },
  },
  sizingRules: {
    minAllocationPct: 15,
    maxAllocationPct: 25,
    scalingFactor: 1.2,
  },
  exitRules: {
    patienceWindowMinutes: 120, // 2 hours
  },
  monitoringRules: {
    analysisIntervalMinutes: 15,
    positionGuardIntervalMinutes: 15,
  },
};

// ============================================================================
// PERSONA REGISTRY
// ============================================================================

/** All available personas indexed by ID */
export const PERSONA_REGISTRY: Record<string, Persona> = {
  sniper: SNIPER,
  scalper: SCALPER,
  contrarian: CONTRARIAN,
  'catalyst-hunter': CATALYST_HUNTER,
  'hedge-architect': HEDGE_ARCHITECT,
  'momentum-rider': MOMENTUM_RIDER,
};

/** Ordered list of all persona IDs */
export const PERSONA_IDS = [
  'sniper',
  'scalper',
  'contrarian',
  'catalyst-hunter',
  'hedge-architect',
  'momentum-rider',
] as const;

export type PersonaId = (typeof PERSONA_IDS)[number];

/** Default persona for new users (Requirement 3.3) */
export const DEFAULT_PERSONA_ID: PersonaId = 'scalper';

// ============================================================================
// RISK LEVEL CLASSIFICATION (Requirement 2.2)
// ============================================================================

/** Risk level groupings for display purposes */
export const RISK_LEVEL_GROUPS: Record<RiskLevel, PersonaId[]> = {
  conservative: ['hedge-architect'],
  moderate: ['scalper', 'catalyst-hunter'],
  aggressive: ['sniper', 'contrarian', 'momentum-rider'],
};

// ============================================================================
// ELITE CUSTOMIZATION RANGES (Requirement 3.4)
// ============================================================================

export interface CustomizationRange {
  min: number;
  max: number;
  step: number;
  defaultValue: number;
  unit: string;
}

/** Elite customization parameter ranges */
export const ELITE_CUSTOMIZATION_RANGES: Record<string, CustomizationRange> = {
  /** Exit sensitivity: 1 = most conservative, 5 = most aggressive */
  exitSensitivity: {
    min: 1,
    max: 5,
    step: 1,
    defaultValue: 3,
    unit: '',
  },
  /** Monitoring frequency in minutes (5-min increments) */
  monitoringFrequencyMinutes: {
    min: 5,
    max: 60,
    step: 5,
    defaultValue: 15,
    unit: 'minutes',
  },
  /** Position sizing multiplier (0.1x increments) */
  positionSizingMultiplier: {
    min: 0.5,
    max: 2.0,
    step: 0.1,
    defaultValue: 1.0,
    unit: 'x',
  },
};

// ============================================================================
// PERSONA DESCRIPTIONS (Requirement 2.3)
// ============================================================================

export interface PersonaDescription {
  id: PersonaId;
  name: string;
  riskLevel: RiskLevel;
  tagline: string;
  entryPhilosophy: string;
  monitoringStyle: string;
  exitBehavior: string;
}

export const PERSONA_DESCRIPTIONS: PersonaDescription[] = [
  {
    id: 'sniper',
    name: 'The Sniper',
    riskLevel: 'aggressive',
    tagline: 'High-conviction, concentrated bets on rare opportunities.',
    entryPhilosophy:
      'Only enters when edge exceeds 10% and signal alignment is above 0.8. May watch a market for multiple analysis cycles before acting.',
    monitoringStyle:
      'Monitors every 30 minutes. Patient and deliberate - waits for the perfect setup.',
    exitBehavior:
      'Exits when conviction score drops below 0.5 or edge narrows below 5%. Uses 4-hour patience window for limit orders.',
  },
  {
    id: 'scalper',
    name: 'The Scalper',
    riskLevel: 'moderate',
    tagline: 'Rapid, small-edge exploitation with high trade frequency.',
    entryPhilosophy:
      'Enters on edges as low as 3% with signal alignment at 0.5 or above. Only trades markets with tight spreads (≤ 2%).',
    monitoringStyle:
      'Monitors every 5 minutes. Fast-paced and opportunistic - always looking for the next small edge.',
    exitBehavior:
      'Exits when edge drops below 1% or signal alignment drops below 0.4. Uses 15-minute patience window for limit orders.',
  },
  {
    id: 'contrarian',
    name: 'The Contrarian',
    riskLevel: 'aggressive',
    tagline: 'Fades crowd consensus - buys fear, sells euphoria.',
    entryPhilosophy:
      'Enters when social sentiment diverges from fundamental probability by more than 20 percentage points. Targets mean-reversion opportunities.',
    monitoringStyle:
      'Monitors every 15 minutes. Watches for sentiment normalization and market overreactions.',
    exitBehavior:
      'Exits when sentiment-fundamental divergence narrows to within 5 percentage points. Uses dynamic exits managed by Position Guard.',
  },
  {
    id: 'catalyst-hunter',
    name: 'The Catalyst Hunter',
    riskLevel: 'moderate',
    tagline: 'Event-driven specialist - positions before catalysts.',
    entryPhilosophy:
      'Identifies upcoming catalysts (debates, rulings, data releases) and positions before the event. All positions are time-boxed.',
    monitoringStyle:
      'Monitors every 15 minutes. Focused on event timelines and catalyst resolution.',
    exitBehavior:
      'Exits immediately after catalyst resolution regardless of outcome. Uses 1-hour patience window for limit orders.',
  },
  {
    id: 'hedge-architect',
    name: 'The Hedge Architect',
    riskLevel: 'conservative',
    tagline: 'Multi-position strategist - reduces directional exposure.',
    entryPhilosophy:
      'Builds positions across related markets. Max 20% per individual position. Targets consistent gains through spread trades and relative value.',
    monitoringStyle:
      'Monitors every 15 minutes. Focuses on market inefficiencies between correlated outcomes.',
    exitBehavior:
      'Exits based on spread convergence or divergence targets. Uses 2-hour patience window for limit orders.',
  },
  {
    id: 'momentum-rider',
    name: 'The Momentum Rider',
    riskLevel: 'aggressive',
    tagline: 'Trend-following specialist - rides momentum with pyramiding.',
    entryPhilosophy:
      'Enters when 3 consecutive price moves confirm the analysis direction. Adds to winning positions (pyramiding) up to 60% max total allocation.',
    monitoringStyle:
      'Monitors every 15 minutes. Watches for trend continuation and reversal signals.',
    exitBehavior:
      'Exits when price reverses by more than 10% from local peak or when 2 consecutive analysis cycles show weakening signal alignment.',
  },
];

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

/**
 * Get a persona by ID. Returns undefined if not found.
 */
export function getPersona(personaId: string): Persona | undefined {
  return PERSONA_REGISTRY[personaId];
}

/**
 * Get a persona by ID, throwing if not found.
 */
export function getPersonaOrThrow(personaId: string): Persona {
  const persona = PERSONA_REGISTRY[personaId];
  if (!persona) {
    throw new Error(`Unknown persona ID: ${personaId}`);
  }
  return persona;
}

/**
 * Get the default persona (Scalper) for new users.
 * Requirement 3.3: Default to "The Scalper" for users who have not made a selection.
 */
export function getDefaultPersona(): Persona {
  return PERSONA_REGISTRY[DEFAULT_PERSONA_ID];
}

/**
 * Get all personas grouped by risk level.
 */
export function getPersonasByRiskLevel(riskLevel: RiskLevel): Persona[] {
  const ids = RISK_LEVEL_GROUPS[riskLevel];
  return ids.map((id) => PERSONA_REGISTRY[id]);
}

/**
 * Apply Elite customization parameters to a persona, producing a modified copy.
 * Requirement 3.4: Elite users can modify exit sensitivity, monitoring frequency,
 * and position sizing aggressiveness.
 *
 * - exitSensitivity (1-5): Adjusts stop-loss percentage. 1 = tighter stops, 5 = wider stops.
 * - monitoringFrequencyMinutes (5-60): Overrides the position guard interval.
 * - positionSizingMultiplier (0.5x-2.0x): Scales the allocation percentages.
 */
export function applyCustomParams(
  persona: Persona,
  customParams: PersonaCustomParams,
): Persona {
  const modified = structuredClone(persona);

  if (customParams.exitSensitivity !== undefined) {
    // Scale patience window: sensitivity 1 = 60% of default, sensitivity 5 = 140% of default
    const factor = 0.6 + (customParams.exitSensitivity - 1) * 0.2;
    modified.exitRules.patienceWindowMinutes =
      Math.round(persona.exitRules.patienceWindowMinutes * factor);
  }

  if (customParams.monitoringFrequencyMinutes !== undefined) {
    modified.monitoringRules.positionGuardIntervalMinutes =
      customParams.monitoringFrequencyMinutes;
  }

  if (customParams.positionSizingMultiplier !== undefined) {
    const multiplier = customParams.positionSizingMultiplier;
    modified.sizingRules.minAllocationPct =
      Math.round(persona.sizingRules.minAllocationPct * multiplier * 10) / 10;
    modified.sizingRules.maxAllocationPct =
      Math.round(persona.sizingRules.maxAllocationPct * multiplier * 10) / 10;
  }

  return modified;
}

/**
 * Validate that custom params are within allowed ranges.
 * Returns an array of error messages (empty if valid).
 */
export function validateCustomParams(params: PersonaCustomParams): string[] {
  const errors: string[] = [];

  if (params.exitSensitivity !== undefined) {
    const range = ELITE_CUSTOMIZATION_RANGES.exitSensitivity;
    if (
      params.exitSensitivity < range.min ||
      params.exitSensitivity > range.max ||
      !Number.isInteger(params.exitSensitivity)
    ) {
      errors.push(
        `exitSensitivity must be an integer between ${range.min} and ${range.max}`,
      );
    }
  }

  if (params.monitoringFrequencyMinutes !== undefined) {
    const range = ELITE_CUSTOMIZATION_RANGES.monitoringFrequencyMinutes;
    if (
      params.monitoringFrequencyMinutes < range.min ||
      params.monitoringFrequencyMinutes > range.max ||
      params.monitoringFrequencyMinutes % range.step !== 0
    ) {
      errors.push(
        `monitoringFrequencyMinutes must be between ${range.min} and ${range.max} in ${range.step}-minute increments`,
      );
    }
  }

  if (params.positionSizingMultiplier !== undefined) {
    const range = ELITE_CUSTOMIZATION_RANGES.positionSizingMultiplier;
    if (
      params.positionSizingMultiplier < range.min ||
      params.positionSizingMultiplier > range.max
    ) {
      errors.push(
        `positionSizingMultiplier must be between ${range.min} and ${range.max}`,
      );
    }
    // Check 0.1x increments (allow floating point tolerance)
    const remainder = Math.round((params.positionSizingMultiplier * 10) % 1 * 100) / 100;
    if (remainder > 0.01) {
      errors.push(
        `positionSizingMultiplier must be in 0.1x increments`,
      );
    }
  }

  return errors;
}

/**
 * Check if a persona ID is valid.
 */
export function isValidPersonaId(personaId: string): personaId is PersonaId {
  return personaId in PERSONA_REGISTRY;
}
