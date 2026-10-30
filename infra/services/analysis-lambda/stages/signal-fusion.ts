/**
 * Deterministic signal fusion stage - no LLM calls, fully pure.
 *
 * The market price is the prior. Each directional agent contributes a
 * log-odds adjustment relative to that prior, weighted by type confidence
 * and historical calibration. The aggregate adjustment is then shrunk
 * toward the market so a loud but miscalibrated ensemble cannot manufacture
 * a large edge against a liquid market.
 *
 * Non-directional agents (risk assessment, tail risk) are used as an
 * uncertainty penalty rather than as probability votes.
 *
 * Validates: Requirements 9.1, 9.2, 9.3
 */

import type { AgentSignal, FusedSignal } from '../lib/types';
import { deBiasProbability, type CalibrationMap } from '../lib/calibration';

/**
 * Agent type weights - higher weight = more influence on fused probability.
 * Price/market-aware agents carry more weight than role-biased narrative
 * agents. Risk/tail agents are non-directional and do not vote on probability.
 */
export const TYPE_WEIGHTS: Record<string, number> = {
  polling_intelligence: 1.8,
  market_microstructure: 1.5,
  momentum: 1.2,
  probability_baseline: 1.0,
  breaking_news: 0.9,
  narrative_velocity: 0.9,
  historical_patterns: 0.8,
  historical_pattern: 0.8, // legacy alias
  event_impact: 0.8,
  catalyst_identification: 0.6,
  catalyst: 0.6, // legacy alias
  mean_reversion: 0.6,
  media_sentiment: 0.5,
  social_sentiment: 0.4,
};

/** Agents whose role is risk assessment, not directional forecasting. */
export const NON_DIRECTIONAL_AGENTS = new Set(['risk_assessment', 'tail_risk']);

/**
 * Maximum fraction of the ensemble's raw edge that is allowed through for a
 * moderate, aligned disagreement. 0 = ignore the ensemble, 1 = fully trust it.
 *
 * This is deliberately not a single fixed shrinkage factor:
 * - moderate raw edges (<= 15%) pass through at MAX_PASS_THROUGH
 * - larger raw edges (15-30%) pass through at half that rate
 * - extreme raw edges (> 30%) are treated as model error and blocked
 *
 * Prediction-market prices are efficient, but a genuinely aligned ensemble
 * often finds a real 5-12% edge. This gives it room without reviving the old
 * 40-50% contrarian bets. Override with FUSION_MAX_PASS_THROUGH.
 */
const DEFAULT_MAX_PASS_THROUGH = 0.6;
const EXTREME_EDGE_THRESHOLD = 0.15;
const MODEL_ERROR_EDGE_THRESHOLD = 0.30;
const EXTREME_PASS_THROUGH_FACTOR = 0.5;

function readMaxPassThrough(): number {
  const raw =
    process.env.FUSION_MAX_PASS_THROUGH ?? process.env.FUSION_SHRINKAGE;
  if (raw === undefined || raw.trim() === '') return DEFAULT_MAX_PASS_THROUGH;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) return DEFAULT_MAX_PASS_THROUGH;
  return Math.max(0, Math.min(1, parsed));
}

const MAX_PASS_THROUGH = readMaxPassThrough();

/** Signals this close to 0.5 with this little confidence are "no view". */
const NO_VIEW_CONFIDENCE_THRESHOLD = 0.4;
const NEAR_NEUTRAL_BAND = 0.05;

/** Log-odds distance used to normalize disagreement into 0..1. */
const DISAGREEMENT_SCALE = 2.5;

/** How much confident risk/tail signals reduce overall confidence. */
const RISK_CONFIDENCE_PENALTY = 0.15;

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function logit(probability: number): number {
  const p = clamp(probability, 0.01, 0.99);
  return Math.log(p / (1 - p));
}

function sigmoid(logOdds: number): number {
  return 1 / (1 + Math.exp(-logOdds));
}

/**
 * Compute a deterministic, market-anchored fusion of agent signals.
 *
 * @param signals - Non-empty array of 1–14 valid AgentSignal objects.
 * @param agentPerformance - Map of agentName → historical performance score.
 *   Missing agents default to 1.0.
 * @param marketProbability - Current market P(YES) used as the prior. Defaults
 *   to 0.5 for callers without market data (e.g. tests).
 * @returns FusedSignal with anchored probability, confidence, alignment,
 *   disagreement, and conflict map.
 *
 * Postconditions:
 *   - weightedFairProbability in [0, 1].
 *   - fusionConfidence in [0, 1].
 *   - signalAlignment in [0, 1] (1.0 = perfect agreement).
 *   - The ensemble's raw edge is passed through according to its magnitude:
 *     60% for moderate edges, 30% for large edges, 0% for model-error edges.
 */
export function fuseSignals(
  signals: AgentSignal[],
  agentPerformance: Record<string, number>,
  marketProbability: number = 0.5,
  options: {
    /** Overrides FUSION_MAX_PASS_THROUGH for this run. */
    maxPassThrough?: number;
    /**
     * Per-agent price calibration. Each forecast is re-centred on the current
     * market price before contributing, so an agent's habitual drift toward 0.5
     * is not mistaken for a directional view. Missing agents fall back to the
     * identity line, which is a no-op.
     */
    calibration?: CalibrationMap;
  } = {},
): FusedSignal {
  const maxPassThrough =
    options.maxPassThrough === undefined
      ? MAX_PASS_THROUGH
      : clamp(options.maxPassThrough, 0, 1);
  const market = clamp(
    Number.isFinite(marketProbability) ? marketProbability : 0.5,
    0.01,
    0.99,
  );
  const marketLogOdds = logit(market);

  let totalWeight = 0;
  let weightedAdjSum = 0;
  let weightedAdjSqSum = 0;
  let weightedConfSum = 0;
  let weightSqSum = 0;

  const directionalSignals: AgentSignal[] = [];
  const riskConfidences: number[] = [];

  for (const signal of signals) {
    const confidence = clamp(
      Number.isFinite(signal.confidence) ? signal.confidence : 0,
      0,
      1,
    );

    if (NON_DIRECTIONAL_AGENTS.has(signal.agentName)) {
      // Risk/tail agents inform uncertainty, not direction.
      riskConfidences.push(confidence);
      continue;
    }

    const rawFairProbability = clamp(
      Number.isFinite(signal.fairProbability) ? signal.fairProbability : 0.5,
      0.01,
      0.99,
    );

    // A neutral probability with low confidence is a fallback/no-view, not a
    // directional forecast. Treating it as a vote makes a 0.50 output look
    // bearish in a 0.67 market and invents fake edges.
    if (
      confidence < NO_VIEW_CONFIDENCE_THRESHOLD &&
      Math.abs(rawFairProbability - 0.5) < NEAR_NEUTRAL_BAND
    ) {
      continue;
    }

    // Remove the agent's habitual drift from the price before the forecast is
    // turned into an edge. Without this, "no view" (a 0.50 output on an 0.85
    // market) is read as a strong bearish vote and the ensemble can only ever
    // point at the cheaper token. Identity calibration leaves this untouched.
    const fairProbability = deBiasProbability(
      rawFairProbability,
      market,
      options.calibration?.[signal.agentName],
    );

    const typeWeight = TYPE_WEIGHTS[signal.agentName] ?? 1.0;
    const performanceScore =
      agentPerformance[signal.agentName] !== undefined &&
      Number.isFinite(agentPerformance[signal.agentName]) &&
      agentPerformance[signal.agentName] > 0
        ? agentPerformance[signal.agentName]
        : 1.0;

    const weight = typeWeight * confidence * performanceScore;
    if (weight <= 0) continue;

    const adjustment = logit(fairProbability) - marketLogOdds;

    totalWeight += weight;
    weightedAdjSum += adjustment * weight;
    weightedAdjSqSum += adjustment * adjustment * weight;
    weightedConfSum += confidence * weight;
    weightSqSum += weight * weight;
    directionalSignals.push(signal);
  }

  // No directional information: fall back to the market prior, not 0.5.
  if (totalWeight === 0) {
    return {
      weightedFairProbability: market,
      rawFairProbability: market,
      marketProbability: market,
      shrinkage: 0,
      passThrough: 0,
      fusionConfidence: 0,
      signalAlignment: 0,
      signalDisagreement: 1,
      fairValueStandardError: 0,
      effectiveSampleSize: 0,
      conflictMap: [],
    };
  }

  const rawAdjustment = weightedAdjSum / totalWeight;
  const rawFairProbability = sigmoid(marketLogOdds + rawAdjustment);

  // Evidence-scaled pass-through. Moderate disagreements keep more of the
  // ensemble's edge; extreme disagreements are treated as model error.
  const rawEdge = rawFairProbability - market;
  const absRawEdge = Math.abs(rawEdge);
  const passThrough =
    absRawEdge > MODEL_ERROR_EDGE_THRESHOLD
      ? 0
      : absRawEdge > EXTREME_EDGE_THRESHOLD
        ? maxPassThrough * EXTREME_PASS_THROUGH_FACTOR
        : maxPassThrough;

  const weightedFairProbability = clamp(
    market + rawEdge * passThrough,
    0.01,
    0.99,
  );

  // Weighted dispersion of log-odds adjustments.
  const variance = Math.max(
    0,
    weightedAdjSqSum / totalWeight - rawAdjustment * rawAdjustment,
  );
  const stdDev = Math.sqrt(variance);
  const signalDisagreement = clamp(stdDev / DISAGREEMENT_SCALE, 0, 1);
  const signalAlignment = 1 - signalDisagreement;

  // Confidence: average agent confidence, reduced by disagreement and by
  // confident risk/tail signals (which indicate unpriced downside).
  const weightedConfidence = weightedConfSum / totalWeight;
  const alignmentFactor = 0.5 + 0.5 * signalAlignment;
  const avgRiskConfidence =
    riskConfidences.length > 0
      ? riskConfidences.reduce((sum, c) => sum + c, 0) / riskConfidences.length
      : 0;
  const riskPenalty = 1 - RISK_CONFIDENCE_PENALTY * avgRiskConfidence;

  // Conflict map: all pairs with divergence > 0.30 in probability space.
  const conflictMap: Array<{
    agent1: string;
    agent2: string;
    divergence: number;
  }> = [];

  for (let i = 0; i < directionalSignals.length; i++) {
    for (let j = i + 1; j < directionalSignals.length; j++) {
      const divergence = Math.abs(
        directionalSignals[i].fairProbability -
          directionalSignals[j].fairProbability,
      );
      if (divergence > 0.3) {
        conflictMap.push({
          agent1: directionalSignals[i].agentName,
          agent2: directionalSignals[j].agentName,
          divergence,
        });
      }
    }
  }

  // If any two directional agents are extremely far apart, confidence halves.
  const probabilities = directionalSignals.map((s) =>
    clamp(s.fairProbability, 0.01, 0.99),
  );
  const maxDivergence =
    probabilities.length > 0
      ? Math.max(...probabilities) - Math.min(...probabilities)
      : 0;
  const divergencePenalty = maxDivergence > 0.7 ? 0.5 : 1;

  const fusionConfidence = clamp(
    weightedConfidence * alignmentFactor * riskPenalty * divergencePenalty,
    0,
    1,
  );

  // Noise floor of the fused estimate.
  //
  // Agents are not independent (shared models, shared inputs), so the naive
  // n is optimistic; the Kish effective sample size at least accounts for
  // uneven weighting. The standard error is computed in log-odds space and
  // mapped to probability points with the delta method around the estimate,
  // which is the scale the edge and the spread are both measured in.
  const effectiveSampleSize =
    weightSqSum > 0 ? (totalWeight * totalWeight) / weightSqSum : 0;
  const seLogOdds =
    effectiveSampleSize > 1 ? Math.sqrt(variance / effectiveSampleSize) : 0;
  const slope = weightedFairProbability * (1 - weightedFairProbability);
  const fairValueStandardError = clamp(slope * seLogOdds, 0, 0.5);

  return {
    weightedFairProbability,
    rawFairProbability,
    marketProbability: market,
    shrinkage: passThrough,
    passThrough,
    fusionConfidence,
    signalAlignment,
    signalDisagreement,
    fairValueStandardError,
    effectiveSampleSize,
    conflictMap,
  };
}
