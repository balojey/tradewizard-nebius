/**
 * Deterministic signal fusion stage - no LLM calls, fully pure.
 *
 * Accepts an array of 1–14 AgentSignals and an agent performance map,
 * producing a FusedSignal with weighted probability, confidence, alignment,
 * and conflict map.
 *
 * Validates: Requirements 9.1, 9.2, 9.3
 */

import type { AgentSignal, FusedSignal } from '../lib/types';

/**
 * Agent type weights - higher weight = more influence on fused probability.
 * Keys use snake_case to match agent_name values from the orchestrator.
 */
const TYPE_WEIGHTS: Record<string, number> = {
  polling_intelligence: 1.5,
  breaking_news: 1.3,
  event_impact: 1.2,
  market_microstructure: 1.2,
  probability_baseline: 1.1,
  risk_assessment: 1.0,
  historical_pattern: 1.0,
  catalyst: 1.0,
  momentum: 0.9,
  mean_reversion: 0.9,
  media_sentiment: 0.8,
  social_sentiment: 0.7,
  narrative_velocity: 0.7,
  tail_risk: 0.8,
};

/**
 * Compute a deterministic weighted fusion of agent signals.
 *
 * @param signals - Non-empty array of 1–14 valid AgentSignal objects.
 * @param agentPerformance - Map of agentName → historical performance score.
 *   Missing agents default to 1.0.
 * @returns FusedSignal with weighted probability, confidence, alignment,
 *   and conflict map.
 *
 * Preconditions:
 *   - signals is non-empty (1–14 elements).
 *   - Each signal has confidence in [0, 1] and fairProbability in [0, 1].
 *   - agentPerformance values are positive floats (default 1.0).
 *
 * Postconditions:
 *   - weightedFairProbability in [0, 1].
 *   - fusionConfidence in [0, 1].
 *   - signalAlignment in [0, 1] (1.0 = perfect agreement).
 *   - If max divergence > 0.70, fusionConfidence is reduced by 50%.
 *   - conflictMap contains all pairs with divergence > 0.30.
 */
export function fuseSignals(
  signals: AgentSignal[],
  agentPerformance: Record<string, number>,
): FusedSignal {
  let totalWeight = 0;
  let weightedProbSum = 0;
  let weightedConfSum = 0;

  for (const signal of signals) {
    const typeWeight = TYPE_WEIGHTS[signal.agentName] ?? 1.0;
    const performanceScore = agentPerformance[signal.agentName] ?? 1.0;

    // Certainty factor: a signal at P(YES)=0.5 carries no directional
    // information. Without this, NEUTRAL agents and failed-agent fallbacks
    // (both fairProbability=0.5) would pull the fused probability toward 0.5,
    // manufacturing an edge against cheap longshot markets.
    const certainty = Math.abs(signal.fairProbability - 0.5) * 2; // 0..1
    if (certainty <= 0) continue;

    const weight =
      typeWeight * signal.confidence * performanceScore * certainty;

    weightedProbSum += signal.fairProbability * weight;
    weightedConfSum += signal.confidence * weight;
    totalWeight += weight;
  }

  // Weighted fair probability. If every signal is neutral/uninformative,
  // fall back to an uninformative 0.5.
  const weightedFairProbability =
    totalWeight > 0 ? weightedProbSum / totalWeight : 0.5;

  // Fusion confidence (before divergence penalty)
  const rawFusionConfidence =
    totalWeight > 0 ? weightedConfSum / totalWeight : 0.0;

  // Alignment/divergence only consider signals that carry a directional view.
  const informativeSignals =
    signals.filter((s) => Math.abs(s.fairProbability - 0.5) > 0).length > 0
      ? signals.filter((s) => Math.abs(s.fairProbability - 0.5) > 0)
      : signals;

  // Signal alignment: 1 - stdDev / 0.5, clamped to [0, 1]
  const probabilities = informativeSignals.map((s) => s.fairProbability);
  const mean =
    probabilities.reduce((sum, p) => sum + p, 0) / probabilities.length;
  const variance =
    probabilities.reduce((sum, p) => sum + (p - mean) ** 2, 0) /
    probabilities.length;
  const stdDev = Math.sqrt(variance);
  const signalAlignment = Math.max(0, Math.min(1, 1 - stdDev / 0.5));

  // Conflict map: all pairs with divergence > 0.30
  const conflictMap: Array<{
    agent1: string;
    agent2: string;
    divergence: number;
  }> = [];

  for (let i = 0; i < informativeSignals.length; i++) {
    for (let j = i + 1; j < informativeSignals.length; j++) {
      const divergence = Math.abs(
        informativeSignals[i].fairProbability -
          informativeSignals[j].fairProbability,
      );
      if (divergence > 0.3) {
        conflictMap.push({
          agent1: informativeSignals[i].agentName,
          agent2: informativeSignals[j].agentName,
          divergence,
        });
      }
    }
  }

  // Divergence penalty: if max divergence between any two fair probabilities
  // exceeds 0.70, reduce fusion confidence by 50%
  const maxDivergence =
    probabilities.length > 0
      ? Math.max(...probabilities) - Math.min(...probabilities)
      : 0;

  const fusionConfidence =
    maxDivergence > 0.7 ? rawFusionConfidence * 0.5 : rawFusionConfidence;

  return {
    weightedFairProbability,
    fusionConfidence,
    signalAlignment,
    conflictMap,
  };
}
