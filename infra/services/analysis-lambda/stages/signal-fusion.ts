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

/**
 * Agent type weights - higher weight = more influence on fused probability.
 * Price/market-aware agents carry more weight than role-biased narrative
 * agents. Risk/tail agents are non-directional and do not vote on probability.
 */
const TYPE_WEIGHTS: Record<string, number> = {
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
 * Fraction of the ensemble's log-odds deviation from market that is allowed
 * through. 0 = ignore the ensemble, 1 = fully trust it. Kept conservative:
 * prediction-market prices are efficient and LLM probability estimates are
 * noisy. Override with FUSION_SHRINKAGE for replay/backtesting.
 */
const DEFAULT_SHRINKAGE = 0.15;

function readShrinkage(): number {
  const raw = process.env.FUSION_SHRINKAGE;
  if (raw === undefined || raw.trim() === '') return DEFAULT_SHRINKAGE;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) return DEFAULT_SHRINKAGE;
  return Math.max(0, Math.min(1, parsed));
}

const SHRINKAGE = readShrinkage();

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
 *   - The ensemble's deviation from market is shrunk by SHRINKAGE.
 */
export function fuseSignals(
  signals: AgentSignal[],
  agentPerformance: Record<string, number>,
  marketProbability: number = 0.5,
): FusedSignal {
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

    const fairProbability = clamp(
      Number.isFinite(signal.fairProbability) ? signal.fairProbability : 0.5,
      0.01,
      0.99,
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
    directionalSignals.push(signal);
  }

  // No directional information: fall back to the market prior, not 0.5.
  if (totalWeight === 0) {
    return {
      weightedFairProbability: market,
      rawFairProbability: market,
      marketProbability: market,
      shrinkage: SHRINKAGE,
      fusionConfidence: 0,
      signalAlignment: 0,
      signalDisagreement: 1,
      conflictMap: [],
    };
  }

  const rawAdjustment = weightedAdjSum / totalWeight;

  // Shrink the ensemble's adjustment toward the market prior.
  const shrunkAdjustment = rawAdjustment * SHRINKAGE;
  const weightedFairProbability = sigmoid(marketLogOdds + shrunkAdjustment);
  const rawFairProbability = sigmoid(marketLogOdds + rawAdjustment);

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

  return {
    weightedFairProbability,
    rawFairProbability,
    marketProbability: market,
    shrinkage: SHRINKAGE,
    fusionConfidence,
    signalAlignment,
    signalDisagreement,
    conflictMap,
  };
}
