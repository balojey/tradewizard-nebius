/**
 * Seeded per-agent price calibration - a starting point, not a permanent truth.
 *
 * Source: production `agent_memory` (43 analyses across 9 markets, market price
 * range 0.16-0.91, std dev 0.21) captured 2026-10-29, immediately before the
 * analysis history was purged. Fitted with `calibrationFromMoments`, i.e. with
 * the same shrinkage toward the identity line that the live path applies.
 *
 * Why this file exists: de-biasing depends on history. Purging `agent_memory`
 * would silently revert every agent to the identity line, which restores the
 * cheap-token bias the calibration was added to remove. This seed keeps the
 * correction in place until fresh history accumulates.
 *
 * The measured slopes are the diagnosis in one number. 1.00 means an agent
 * tracks the market price; below 1.00 it regresses toward 0.5, and the
 * ensemble then reads as "bearish" on every expensive market:
 *
 *   mean_reversion       0.49   barely tracks the price at all
 *   momentum             0.61
 *   probability_baseline 0.64
 *   ...
 *   narrative_velocity   0.95   effectively anchored
 *
 * Replaced per-agent by the live fit as soon as an agent has at least
 * MIN_SAMPLES fresh observations (see `fetchAgentCalibration`). Delete this
 * file to start calibration completely from scratch.
 */

import type { CalibrationMap } from './calibration';

export const CALIBRATION_SEED: CalibrationMap = {
  breaking_news: { intercept: 0.053, slope: 0.755, samples: 43 },
  catalyst_identification: { intercept: 0.114, slope: 0.682, samples: 43 },
  event_impact: { intercept: 0.051, slope: 0.779, samples: 43 },
  historical_patterns: { intercept: 0.072, slope: 0.735, samples: 43 },
  market_microstructure: { intercept: 0.114, slope: 0.719, samples: 43 },
  mean_reversion: { intercept: 0.197, slope: 0.494, samples: 43 },
  media_sentiment: { intercept: 0.09, slope: 0.749, samples: 43 },
  momentum: { intercept: 0.133, slope: 0.614, samples: 43 },
  narrative_velocity: { intercept: -0.001, slope: 0.953, samples: 43 },
  polling_intelligence: { intercept: 0.15, slope: 0.644, samples: 43 },
  probability_baseline: { intercept: 0.147, slope: 0.64, samples: 43 },
  risk_assessment: { intercept: 0.119, slope: 0.637, samples: 43 },
  social_sentiment: { intercept: 0.071, slope: 0.839, samples: 43 },
  tail_risk: { intercept: 0.126, slope: 0.629, samples: 43 },
};
