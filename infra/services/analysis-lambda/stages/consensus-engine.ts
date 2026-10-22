/**
 * Deterministic consensus engine stage - no LLM calls, fully pure.
 *
 * Consensus probability comes from the market-anchored fused signal. The
 * bull/bear theses are role-play, not independent forecasts, so they are NOT
 * averaged into the probability. Cross-examination is used only as a
 * confidence modifier.
 *
 * A divergence circuit breaker refuses to act when the model disagrees with
 * the market by more than MAX_ACTIONABLE_DIVERGENCE. In liquid prediction
 * markets, an extreme disagreement is more often model error than a tradable
 * mispricing.
 *
 * Validates: Requirements 9.4, 9.5, 9.6, 9.7, 9.8
 */

import type {
  ConsensusResult,
  CrossExamResult,
  FusedSignal,
  Thesis,
} from '../lib/types';

/** Trade actions produced by the consensus engine */
export type TradeAction = 'LONG_YES' | 'LONG_NO' | 'NO_TRADE';

/** Full output of the consensus engine stage */
export interface ConsensusEngineOutput {
  action: TradeAction;
  consensusResult: ConsensusResult;
  edge: number;
  /** True when the edge was too large to be credible and action was blocked. */
  divergenceGuardTriggered?: boolean;
}

/** Minimum edge threshold for low/medium liquidity markets. */
const MIN_EDGE_THRESHOLD = 0.07;

/** Multiplier applied to edge threshold when liquidity risk is high */
const HIGH_LIQUIDITY_MULTIPLIER = 1.5;

/** Disagreement index threshold above which consensus fails */
const DISAGREEMENT_THRESHOLD = 0.30;

/** Minimum fusion confidence required to act. */
const MIN_CONSENSUS_CONFIDENCE = 0.20;

/**
 * Maximum credible disagreement with the market. A larger edge is treated as
 * model risk, not opportunity. This is the single most important guardrail:
 * the previous pipeline recommended LONG_NO at a 0.48 edge on a 0.81 market.
 */
export const MAX_ACTIONABLE_DIVERGENCE = 0.15;

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

/**
 * Compute deterministic consensus from the market-anchored fused signal.
 *
 * Postconditions:
 *   - probability is in [0, 1].
 *   - failed = true if disagreement > 0.30 or confidence < 0.20.
 *   - probability equals the fused signal's anchored probability.
 *   - confidence is reduced by thesis divergence and cross-exam imbalance.
 */
export function calculateConsensus(
  bullThesis: Thesis,
  bearThesis: Thesis,
  crossExam: CrossExamResult,
  fusedSignal: FusedSignal,
): ConsensusResult {
  const consensusProbability = clamp(
    fusedSignal.weightedFairProbability,
    0,
    1,
  );

  // Prefer the engine's native disagreement measure. Fall back to alignment
  // for older fused-signal objects.
  const disagreementIndex = clamp(
    fusedSignal.signalDisagreement !== undefined
      ? fusedSignal.signalDisagreement
      : 1 - fusedSignal.signalAlignment,
    0,
    1,
  );

  // The stronger thesis is the one that survived cross-examination better.
  // It is still a role-play estimate, so it only affects confidence.
  const strongerThesis =
    crossExam.bearScore > crossExam.bullScore ? bearThesis : bullThesis;
  const thesisDivergence = clamp(
    Math.abs(strongerThesis.fairProbability - consensusProbability),
    0,
    1,
  );
  const thesisConfidenceFactor = 1 - 0.3 * thesisDivergence;

  // Balanced cross-examination means both cases were tested equally well;
  // a lopsided result is less trustworthy as a confidence signal.
  const crossExamBalance = 1 - Math.abs(crossExam.bullScore - crossExam.bearScore) / 10;
  const crossExamFactor = 0.85 + 0.15 * clamp(crossExamBalance, 0, 1);

  const confidence = clamp(
    fusedSignal.fusionConfidence * thesisConfidenceFactor * crossExamFactor,
    0,
    1,
  );

  // Fail when the ensemble disagrees too much or is simply not confident.
  const failed =
    disagreementIndex > DISAGREEMENT_THRESHOLD ||
    confidence < MIN_CONSENSUS_CONFIDENCE;

  return {
    probability: consensusProbability,
    confidence,
    disagreementIndex,
    failed,
  };
}

/**
 * Determine trade action from consensus probability and market state.
 *
 * Purely deterministic with no randomness.
 *
 * @param consensusProbability - Consensus probability in [0, 1].
 * @param marketProbability - Current market probability in [0, 1].
 * @param consensusFailed - Whether consensus engine marked failure.
 * @param liquidityRisk - Liquidity risk level.
 * @returns Trade action: LONG_YES, LONG_NO, or NO_TRADE.
 *
 * Postconditions:
 *   - Returns NO_TRADE if consensusFailed is true.
 *   - Returns NO_TRADE if |edge| > MAX_ACTIONABLE_DIVERGENCE.
 *   - Edge threshold is 0.07 for low/medium, 0.105 for high liquidity risk.
 */
export function determineAction(
  consensusProbability: number,
  marketProbability: number,
  consensusFailed: boolean,
  liquidityRisk: 'low' | 'medium' | 'high',
): TradeAction {
  // When consensus failed, return NO_TRADE regardless of edge.
  if (consensusFailed) {
    return 'NO_TRADE';
  }

  const edge = consensusProbability - marketProbability;

  // A disagreement this large is not a signal - it is a warning that the
  // model or its inputs are wrong. Protect capital instead of fading the crowd.
  if (Math.abs(edge) > MAX_ACTIONABLE_DIVERGENCE) {
    return 'NO_TRADE';
  }

  // High liquidity risk increases the minimum edge threshold by 50%.
  const adjustedThreshold =
    liquidityRisk === 'high'
      ? MIN_EDGE_THRESHOLD * HIGH_LIQUIDITY_MULTIPLIER
      : MIN_EDGE_THRESHOLD;

  // Determine direction based on edge vs threshold.
  if (edge > adjustedThreshold) {
    return 'LONG_YES';
  }
  if (edge < -adjustedThreshold) {
    return 'LONG_NO';
  }

  return 'NO_TRADE';
}

/**
 * Run the full consensus engine stage.
 *
 * Combines calculateConsensus and determineAction into a single pipeline
 * that produces the complete ConsensusEngineOutput.
 */
export function runConsensusEngine(
  fusedSignal: FusedSignal,
  bullThesis: Thesis,
  bearThesis: Thesis,
  crossExam: CrossExamResult,
  marketProbability: number,
  liquidityRisk: 'low' | 'medium' | 'high',
): ConsensusEngineOutput {
  const consensusResult = calculateConsensus(
    bullThesis,
    bearThesis,
    crossExam,
    fusedSignal,
  );

  const edge = consensusResult.probability - marketProbability;
  const divergenceGuardTriggered =
    !consensusResult.failed &&
    Math.abs(edge) > MAX_ACTIONABLE_DIVERGENCE;

  const action = determineAction(
    consensusResult.probability,
    marketProbability,
    consensusResult.failed,
    liquidityRisk,
  );

  return {
    action,
    consensusResult,
    edge,
    divergenceGuardTriggered,
  };
}
