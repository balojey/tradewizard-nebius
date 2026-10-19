/**
 * Deterministic consensus engine stage - no LLM calls, fully pure.
 *
 * Calculates weighted consensus probability from bull/bear theses and
 * the fused signal, determines disagreement, and produces a trade action
 * based on edge vs liquidity-adjusted threshold.
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
}

/** Minimum edge threshold for low/medium liquidity markets */
const MIN_EDGE_THRESHOLD = 0.05;

/** Multiplier applied to edge threshold when liquidity risk is high */
const HIGH_LIQUIDITY_MULTIPLIER = 1.5;

/** Disagreement index threshold above which consensus fails */
const DISAGREEMENT_THRESHOLD = 0.30;

/**
 * Compute deterministic consensus from theses, cross-exam scores, and fused signal.
 *
 * Blends thesis-weighted probability (60%) with signal fusion probability (40%).
 * Marks consensus as failed when disagreement index exceeds 0.30.
 *
 * @param bullThesis - Bull thesis with fairProbability in [0, 1].
 * @param bearThesis - Bear thesis with fairProbability in [0, 1].
 * @param crossExam - Cross-examination result with bullScore and bearScore in [-5, 5].
 * @param fusedSignal - Valid output from fuseSignals().
 * @returns ConsensusResult with probability, confidence, disagreementIndex, and failed flag.
 *
 * Preconditions:
 *   - Both theses have fairProbability in [0, 1].
 *   - crossExam has bullScore and bearScore in [-5, 5].
 *   - fusedSignal is a valid FusedSignal from fuseSignals().
 *
 * Postconditions:
 *   - probability is in [0, 1].
 *   - failed = true if disagreementIndex > 0.30.
 *   - probability = 60% thesis-weighted + 40% signal fusion.
 *   - confidence decreases with disagreement.
 */
export function calculateConsensus(
  bullThesis: Thesis,
  bearThesis: Thesis,
  crossExam: CrossExamResult,
  fusedSignal: FusedSignal,
): ConsensusResult {
  // Weight theses by cross-examination scores.
  // Normalize scores from [-5, 5] to [0, 1].
  const bullWeight = Math.max(0.0, (crossExam.bullScore + 5) / 10);
  const bearWeight = Math.max(0.0, (crossExam.bearScore + 5) / 10);
  const totalThesisWeight = bullWeight + bearWeight;

  let thesisWeightedProb = 0.5;
  if (totalThesisWeight > 0) {
    thesisWeightedProb =
      (bullThesis.fairProbability * bullWeight +
        bearThesis.fairProbability * bearWeight) /
      totalThesisWeight;
  }

  // Blend thesis probability with fused signal (60% thesis, 40% signal fusion).
  const consensusProbability =
    thesisWeightedProb * 0.6 +
    fusedSignal.weightedFairProbability * 0.4;

  // Disagreement index: population standard deviation of all probability estimates.
  const allProbs = [
    bullThesis.fairProbability,
    bearThesis.fairProbability,
    fusedSignal.weightedFairProbability,
  ];
  const mean = allProbs.reduce((sum, p) => sum + p, 0) / allProbs.length;
  const variance =
    allProbs.reduce((sum, p) => sum + (p - mean) ** 2, 0) / allProbs.length;
  const disagreementIndex = Math.sqrt(variance);

  // When disagreement > 0.30, mark consensus as failed.
  const failed = disagreementIndex > DISAGREEMENT_THRESHOLD;

  // Confidence narrows with disagreement.
  const confidence = Math.max(
    0.0,
    fusedSignal.fusionConfidence * (1 - disagreementIndex),
  );

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
 * Preconditions:
 *   - Both probabilities in [0, 1].
 *   - liquidityRisk is one of "low", "medium", "high".
 *
 * Postconditions:
 *   - Returns NO_TRADE if consensusFailed is true.
 *   - Edge threshold is 0.05 for low/medium, 0.075 for high liquidity risk.
 *   - Returns LONG_YES when edge > threshold.
 *   - Returns LONG_NO when edge < -threshold.
 *   - Returns NO_TRADE otherwise.
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
 *
 * @param fusedSignal - Output from the signal fusion stage.
 * @param bullThesis - Bull thesis from thesis construction.
 * @param bearThesis - Bear thesis from thesis construction.
 * @param crossExam - Cross-examination scores.
 * @param marketProbability - Current market probability in [0, 1].
 * @param liquidityRisk - Liquidity risk level for this market.
 * @returns ConsensusEngineOutput with action, consensusResult, and edge.
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
  };
}
