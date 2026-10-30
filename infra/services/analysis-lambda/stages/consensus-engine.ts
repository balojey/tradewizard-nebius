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

/**
 * Machine-readable account of why a run ended in NO_TRADE.
 *
 * Without this, the reason only exists as prose in the recommendation's
 * explanation, which makes "why is everything NO_TRADE?" impossible to answer
 * across runs. Persisted to `analysis_results.no_trade_reason`.
 */
export type NoTradeReason =
  /** Ensemble disagreement or confidence too low to act. */
  | 'consensus_failed'
  /** Model disagrees with the market by more than the credibility cap. */
  | 'divergence_cap'
  /** Edge survived anchoring and shrinkage but not the minimum edge floor. */
  | 'edge_below_threshold'
  /** Edge clears trading costs but is not distinguishable from ensemble noise. */
  | 'edge_below_significance'
  /** Cross-examination favoured the opposite case (or was a tie). */
  | 'thesis_veto';

/** Full output of the consensus engine stage */
export interface ConsensusEngineOutput {
  action: TradeAction;
  consensusResult: ConsensusResult;
  edge: number;
  /** Why the action is NO_TRADE. Undefined when a trade is recommended. */
  noTradeReason?: NoTradeReason;
  /** Edge actually required to act (cost-derived under the actionable profile). */
  edgeFloor?: number;
  /** Noise-based component of the edge requirement (0 under `strict`). */
  significanceFloor?: number;
  /** Profile that produced this decision. */
  gateProfile?: GateProfile;
  /** True when the winning thesis disagreed with the trade direction. */
  thesisVetoTriggered?: boolean;
  /**
   * Under the `actionable` profile the thesis disagreement discounts confidence
   * instead of vetoing; this records the confidence that was passed downstream.
   */
  thesisConfidenceFactor?: number;
  /** True when the edge was too large to be credible and action was blocked. */
  divergenceGuardTriggered?: boolean;
}

export interface ConsensusOptions {
  /** Observed bid-ask spread in probability points. Drives the edge floor. */
  spread?: number;
  /** Risk appetite. Defaults to GATE_PROFILE (actionable). */
  profile?: GateProfile;
  /**
   * Ensemble noise floor (standard error of the fused probability). Under the
   * actionable profile the edge must clear `MIN_EDGE_SIGMA` multiples of this.
   */
  fairValueStandardError?: number;
}

/** Minimum edge threshold for low/medium liquidity markets. */
const DEFAULT_MIN_ACTIONABLE_EDGE = 0.04;

function readMinActionableEdge(): number {
  const raw = process.env.MIN_ACTIONABLE_EDGE;
  if (raw === undefined || raw.trim() === '') return DEFAULT_MIN_ACTIONABLE_EDGE;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) return DEFAULT_MIN_ACTIONABLE_EDGE;
  return Math.max(0, Math.min(0.5, parsed));
}

export const MIN_ACTIONABLE_EDGE = readMinActionableEdge();

/**
 * How much risk the analysis layer is willing to price.
 *
 * - `strict`     : the original configuration. Flat 4c edge floor, hard thesis
 *                  veto. Trades ~3-5% of analyses; can only fire on markets
 *                  priced in the tails (see the edge-floor arithmetic below).
 * - `actionable` : the edge floor is the market's actual round-trip cost
 *                  instead of a fixed 4c, the thesis veto becomes a confidence
 *                  haircut instead of a veto, and the fusion pass-through is
 *                  set to 1.0 by the caller. Educated risks are taken and paid
 *                  for by the levels, rather than refused.
 *
 * Both profiles keep the divergence cap: that guardrail exists because a model
 * that disagrees with a liquid market by >15% is usually wrong, not early.
 */
export type GateProfile = 'strict' | 'actionable';

export function readGateProfile(): GateProfile {
  const raw = (process.env.GATE_PROFILE ?? '').trim().toLowerCase();
  return raw === 'strict' ? 'strict' : 'actionable';
}

/** Round-trip friction assumptions used by the actionable profile. */
const COST_SLIPPAGE_BUFFER = 0.005;
const MIN_COST_FLOOR = 0.015;
const MAX_COST_FLOOR = 0.08;
/** Used when the spread is unknown and the profile is actionable. */
const DEFAULT_COST_FLOOR = 0.025;

/**
 * Convert the observed spread into an edge requirement.
 *
 * A 4c floor on a 1c-spread market asks the model to find four times the cost
 * of trading; on a 6c-spread market it under-charges. Deriving the floor from
 * the market's own friction is both fairer and more actionable.
 */
export function deriveEdgeFloor(spread: number | undefined): number {
  const observed = Number(spread);
  if (!Number.isFinite(observed) || observed < 0) return DEFAULT_COST_FLOOR;
  return Math.max(
    MIN_COST_FLOOR,
    Math.min(MAX_COST_FLOOR, observed + COST_SLIPPAGE_BUFFER),
  );
}

/** Multiplier applied to edge threshold when liquidity risk is high */
const HIGH_LIQUIDITY_MULTIPLIER = 1.5;

/** Disagreement index threshold above which consensus fails */
const DISAGREEMENT_THRESHOLD = 0.30;

/** Minimum fusion confidence required to act. */
const MIN_CONSENSUS_CONFIDENCE = 0.20;

/** Minimum cross-exam margin required for the winning thesis to confirm a trade. */
const MIN_THESIS_MARGIN = 1.0;

/**
 * Confidence retained by a trade whose winner-thesis disagreed with it, under
 * the `actionable` profile. The debate still informs sizing; it no longer has
 * absolute veto power over a measured edge.
 */
const THESIS_DISAGREEMENT_CONFIDENCE_FACTOR = 0.7;

/**
 * Maximum credible disagreement with the market. A larger edge is treated as
 * model risk, not opportunity. This is the single most important guardrail:
 * the previous pipeline recommended LONG_NO at a 0.48 edge on a 0.81 market.
 */
function readMaxActionableDivergence(): number {
  const raw = process.env.MAX_ACTIONABLE_DIVERGENCE;
  const parsed = Number(raw);
  if (raw === undefined || raw.trim() === '' || !Number.isFinite(parsed)) return 0.15;
  return Math.max(0.05, Math.min(0.5, parsed));
}

export const MAX_ACTIONABLE_DIVERGENCE = readMaxActionableDivergence();

/**
 * How many standard errors an edge must clear before it counts as signal.
 *
 * The cost floor answers "does this pay for the trade?". This answers "is this
 * distinguishable from noise?". Without it, a cheap market with a 1c spread
 * trades whenever the ensemble happens to drift 2c, which is roughly half the
 * time - you would be taking coin flips and paying fees for them.
 */
function readMinEdgeSigma(): number {
  const parsed = Number(process.env.MIN_EDGE_SIGMA);
  if (!Number.isFinite(parsed)) return 2;
  return Math.max(0, Math.min(4, parsed));
}

export const MIN_EDGE_SIGMA = readMinEdgeSigma();

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

export interface ThesisConfirmation {
  passes: boolean;
  winningDirection: 'bull' | 'bear' | null;
  margin: number;
}

/**
 * The bull/bear theses are role-play, not probability estimates. Their useful
 * signal is which case survived cross-examination more convincingly. A trade
 * is only confirmed when one thesis wins by a meaningful margin.
 */
export function evaluateThesisConfirmation(
  crossExam: CrossExamResult,
): ThesisConfirmation {
  const margin = crossExam.bullScore - crossExam.bearScore;
  if (Math.abs(margin) < MIN_THESIS_MARGIN) {
    return { passes: false, winningDirection: null, margin };
  }

  return {
    passes: true,
    winningDirection: margin > 0 ? 'bull' : 'bear',
    margin: Math.abs(margin),
  };
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
 *   - Edge threshold is MIN_ACTIONABLE_EDGE (default 0.04) for low/medium,
 *     and 1.5x that for high liquidity risk.
 */
export function determineAction(
  consensusProbability: number,
  marketProbability: number,
  consensusFailed: boolean,
  liquidityRisk: 'low' | 'medium' | 'high',
  options: ConsensusOptions = {},
): TradeAction {
  return evaluateAction(
    consensusProbability,
    marketProbability,
    consensusFailed,
    liquidityRisk,
    options,
  ).action;
}

/**
 * Same decision logic as `determineAction`, plus the gate that produced the
 * NO_TRADE verdict. Single source of truth: `determineAction` delegates here.
 *
 * The `strict` profile is the original behaviour (flat 4c floor). The
 * `actionable` profile derives the floor from the market's round-trip cost, so
 * a 1c-spread market is not required to offer four times its own friction.
 */
export function evaluateAction(
  consensusProbability: number,
  marketProbability: number,
  consensusFailed: boolean,
  liquidityRisk: 'low' | 'medium' | 'high',
  options: ConsensusOptions = {},
): {
  action: TradeAction;
  reason: NoTradeReason | null;
  edgeFloor: number;
  significanceFloor: number;
  profile: GateProfile;
} {
  const profile = options.profile ?? readGateProfile();
  const baseFloor =
    profile === 'actionable' ? deriveEdgeFloor(options.spread) : MIN_ACTIONABLE_EDGE;
  const costFloor =
    liquidityRisk === 'high' ? baseFloor * HIGH_LIQUIDITY_MULTIPLIER : baseFloor;

  // Noise floor: only under the actionable profile. `strict` keeps its original
  // semantics so the two profiles stay comparable.
  const significanceFloor =
    profile === 'actionable' &&
    Number.isFinite(options.fairValueStandardError) &&
    (options.fairValueStandardError ?? 0) > 0
      ? MIN_EDGE_SIGMA * (options.fairValueStandardError as number)
      : 0;

  const edgeFloor = Math.max(costFloor, significanceFloor);

  // When consensus failed, return NO_TRADE regardless of edge.
  if (consensusFailed) {
    return { action: 'NO_TRADE', reason: 'consensus_failed', edgeFloor, significanceFloor, profile };
  }

  const edge = consensusProbability - marketProbability;

  // A disagreement this large is not a signal - it is a warning that the
  // model or its inputs are wrong. Protect capital instead of fading the crowd.
  if (Math.abs(edge) > MAX_ACTIONABLE_DIVERGENCE) {
    return { action: 'NO_TRADE', reason: 'divergence_cap', edgeFloor, significanceFloor, profile };
  }

  // Determine direction based on edge vs threshold.
  if (edge > edgeFloor) {
    return { action: 'LONG_YES', reason: null, edgeFloor, significanceFloor, profile };
  }
  if (edge < -edgeFloor) {
    return { action: 'LONG_NO', reason: null, edgeFloor, significanceFloor, profile };
  }

  // Distinguish "does not pay for the trade" from "cannot be told apart from
  // noise" - they need completely different fixes.
  const reason: NoTradeReason =
    significanceFloor > costFloor && Math.abs(edge) <= significanceFloor
      ? 'edge_below_significance'
      : 'edge_below_threshold';

  return { action: 'NO_TRADE', reason, edgeFloor, significanceFloor, profile };
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
  options: ConsensusOptions = {},
): ConsensusEngineOutput {
  const profile = options.profile ?? readGateProfile();

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

  const evaluation = evaluateAction(
    consensusResult.probability,
    marketProbability,
    consensusResult.failed,
    liquidityRisk,
    { ...options, profile },
  );
  let action: TradeAction = evaluation.action;
  let noTradeReason: NoTradeReason | null = evaluation.reason;

  // Confirmation check: a directional trade should be supported by the thesis
  // that won cross-examination. This is the useful role for the bull/bear
  // debate.
  //
  // `strict` treats disagreement as an absolute veto. `actionable` treats it as
  // a confidence haircut: a role-play debate losing to the ensemble is
  // information about how much to trust the trade, not proof there is no trade.
  // Under `actionable` the disagreement must also be a genuine one - a tie in
  // the debate is not evidence against the ensemble.
  const confirmation = evaluateThesisConfirmation(crossExam);
  const thesisDisagrees =
    action !== 'NO_TRADE' &&
    ((action === 'LONG_YES' && confirmation.winningDirection === 'bear') ||
      (action === 'LONG_NO' && confirmation.winningDirection === 'bull'));
  const thesisVetoTriggered =
    action !== 'NO_TRADE' &&
    (thesisDisagrees || (!confirmation.passes && profile === 'strict'));

  let thesisConfidenceFactor = 1;
  if (thesisVetoTriggered) {
    if (profile === 'strict') {
      action = 'NO_TRADE';
      noTradeReason = 'thesis_veto';
    } else {
      thesisConfidenceFactor = THESIS_DISAGREEMENT_CONFIDENCE_FACTOR;
      consensusResult.confidence = clamp(
        consensusResult.confidence * thesisConfidenceFactor,
        0,
        1,
      );
    }
  }

  return {
    action,
    consensusResult,
    edge,
    noTradeReason: noTradeReason ?? undefined,
    edgeFloor: evaluation.edgeFloor,
    significanceFloor: evaluation.significanceFloor,
    gateProfile: profile,
    thesisVetoTriggered,
    thesisConfidenceFactor,
    divergenceGuardTriggered,
  };
}
