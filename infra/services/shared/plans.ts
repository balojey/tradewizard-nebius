/**
 * Plan and credit pack configuration for the wallet subscription system.
 * All prices are in USDC.e (6 decimals on Polygon).
 *
 * Requirements: 1.9, 4.8
 */

// ---------------------------------------------------------------------------
// Plan Configuration
// ---------------------------------------------------------------------------

export interface Plan {
  price: number;
  creditsPerMonth: number;
  name: string;
  trialEligible: boolean;
}

export const PLANS = {
  free: { price: 0, creditsPerMonth: 20, name: 'Free', trialEligible: false },
  starter: { price: 19, creditsPerMonth: 100, name: 'Starter', trialEligible: true },
  pro: { price: 49, creditsPerMonth: 350, name: 'Pro', trialEligible: true },
  elite: { price: 149, creditsPerMonth: 999999, name: 'Elite', trialEligible: false },
} as const;

/** Duration of a free trial in days. */
export const FREE_TRIAL_DURATION_DAYS = 30;

export type PlanId = keyof typeof PLANS;

const PLAN_IDS = Object.keys(PLANS) as PlanId[];

// ---------------------------------------------------------------------------
// Credit Pack Configuration
// ---------------------------------------------------------------------------

export interface CreditPack {
  credits: number;
  price: number;
}

export const CREDIT_PACKS = {
  pack_20: { credits: 20, price: 4.99 },
  pack_45: { credits: 45, price: 9.99 },
  pack_75: { credits: 75, price: 14.99 },
} as const;

export type CreditPackId = keyof typeof CREDIT_PACKS;

const CREDIT_PACK_IDS = Object.keys(CREDIT_PACKS) as CreditPackId[];

// ---------------------------------------------------------------------------
// USDC.e Conversion Helper
// ---------------------------------------------------------------------------

/**
 * Convert a USD amount to USDC.e contract units (6 decimals).
 * Example: toUsdcUnits(19) => 19_000_000n
 */
export function toUsdcUnits(usdAmount: number): bigint {
  return BigInt(Math.round(usdAmount * 1_000_000));
}

// ---------------------------------------------------------------------------
// Validation Functions
// ---------------------------------------------------------------------------

/**
 * Type guard: returns true if the given string is a valid PlanId.
 */
export function isValidPlanId(id: string): id is PlanId {
  return PLAN_IDS.includes(id as PlanId);
}

/**
 * Type guard: returns true if the given string is a valid CreditPackId.
 */
export function isValidPackId(id: string): id is CreditPackId {
  return CREDIT_PACK_IDS.includes(id as CreditPackId);
}

/**
 * Get a plan by its ID. Returns undefined if the ID is invalid.
 */
export function getPlan(id: string): Plan | undefined {
  if (!isValidPlanId(id)) return undefined;
  return PLANS[id];
}

/**
 * Get a credit pack by its ID. Returns undefined if the ID is invalid.
 */
export function getCreditPack(id: string): CreditPack | undefined {
  if (!isValidPackId(id)) return undefined;
  return CREDIT_PACKS[id];
}

/**
 * Get all available plan IDs.
 */
export function getAllPlanIds(): PlanId[] {
  return [...PLAN_IDS];
}

/**
 * Get all available credit pack IDs.
 */
export function getAllCreditPackIds(): CreditPackId[] {
  return [...CREDIT_PACK_IDS];
}
