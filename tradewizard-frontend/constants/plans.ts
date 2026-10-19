export type Plan = 'free' | 'starter' | 'pro' | 'elite';

export type Interval = 'once' | '1h' | '4h' | '12h' | '1d';

export type Channel = 'in_app' | 'email' | 'push' | 'webhook';

export interface PlanCapabilities {
  intervals: readonly Interval[];
  channels: readonly Channel[];
  pmSessionLimit: number;
  canCustomizePersona: boolean;
}

export const PLAN_CAPABILITIES: Record<Plan, PlanCapabilities> = {
  free: {
    intervals: ['once'],
    channels: ['in_app'],
    pmSessionLimit: 0,
    canCustomizePersona: false,
  },
  starter: {
    intervals: ['once', '1d'],
    channels: ['in_app', 'email', 'push'],
    pmSessionLimit: 0,
    canCustomizePersona: false,
  },
  pro: {
    intervals: ['once', '1h', '4h', '12h', '1d'],
    channels: ['in_app', 'email', 'push', 'webhook'],
    pmSessionLimit: 3,
    canCustomizePersona: false,
  },
  elite: {
    intervals: ['once', '1h', '4h', '12h', '1d'],
    channels: ['in_app', 'email', 'push', 'webhook'],
    pmSessionLimit: 10,
    canCustomizePersona: true,
  },
} as const;

/** Numeric rank for plan comparison. Higher = more capable. */
export const PLAN_RANK: Record<Plan, number> = {
  free: 0,
  starter: 1,
  pro: 2,
  elite: 3,
};

/** Returns true if `currentPlan` is at or above `requiredPlan`. */
export function planAtLeast(currentPlan: Plan, requiredPlan: Plan): boolean {
  return PLAN_RANK[currentPlan] >= PLAN_RANK[requiredPlan];
}
