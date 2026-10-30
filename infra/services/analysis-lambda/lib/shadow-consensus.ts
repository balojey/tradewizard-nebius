/**
 * Shadow consensus - the agent-driven aggregation, run alongside the live one.
 *
 * This implements the config we want to move to, WITHOUT changing what users
 * see. The live pipeline (`signal-fusion` -> `consensus-engine`) anchors each
 * agent's absolute probability to the market prior, shrinks the ensemble's
 * deviation, and gates the result on a fixed probability edge. That design
 * cannot express two things:
 *
 *   1. A trade on the *favourite* side. Producing one requires the ensemble to
 *      be more extreme than the market, which agents that "treat the price as a
 *      strong prior" essentially never are. The favourite branch is therefore
 *      structurally unreachable and the pipeline is left choosing between the
 *      cheap token and NO_TRADE.
 *   2. A genuine majority. The agents' explicit `direction` vote is discarded,
 *      and their probabilities are averaged, so nine lazy 0.50s can drown out
 *      the three agents that actually found something.
 *
 * This module fixes both:
 *
 *   - Each agent's forecast is first re-centred on the market price using its
 *     own fitted calibration (`deBiasProbability`), so habitual/near-null
 *     output stops counting as a directional vote. Without this, "agent-driven"
 *     and "underdog-driven" are the same thing.
 *   - Direction is decided by a confidence-weighted vote against the current
 *     price (`voteScore`), so informed agents can outvote uninformed ones.
 *   - Magnitude comes from the de-biased ensemble edge, compared against the
 *     market's actual round-trip cost rather than a fixed 4 cents.
 *
 * Deterministic and pure: no IO, no clocks, no env access at call time.
 *
 * The result is recorded on `_analysisDetail.shadowConsensus` and persisted so
 * `recommendation-scorer` can grade both configs against realised price moves.
 * Nothing here affects the live recommendation until the shadow data says it
 * should.
 */

import type { AgentSignal } from './types';
import { NON_DIRECTIONAL_AGENTS, TYPE_WEIGHTS } from '../stages/signal-fusion';
import {
  deBiasProbability,
  mirrorCalibration,
  type CalibrationMap,
} from './calibration';

export type ShadowAction = 'LONG_YES' | 'LONG_NO' | 'NO_TRADE';

export interface ShadowConsensusInput {
  /** Intelligence-agent signals for this run. */
  signals: readonly AgentSignal[];
  /** Market P(YES) used as the reference price for every vote. */
  marketProbability: number;
  /** Per-agent calibration; missing agents fall back to the identity line. */
  calibration?: CalibrationMap;
  /** Historical Brier-derived agent weights (same map the live fusion uses). */
  agentPerformance?: Record<string, number>;
  /** Current bid-ask spread in probability points, when known. */
  spread?: number;
}

export interface ShadowConsensusResult {
  action: ShadowAction;
  /** Confidence-weighted agreement in [-1, 1]. +1 = every agent bullish. */
  voteScore: number;
  /** De-biased ensemble P(YES) minus the market price. */
  edge: number;
  /** De-biased ensemble P(YES). */
  fairProbability: number;
  /** Round-trip cost the edge had to clear (probability points). */
  costFloor: number;
  /** Agents that cast a non-abstaining vote. */
  participatingAgents: string[];
  /** Share of participating agents that abstained (no view). */
  abstainShare: number;
  /** Total calibration observations backing this run. */
  calibrationSamples: number;
  /** Agents with no calibration history (treated as identity). */
  uncalibratedAgents: string[];
  /** Human-readable account of the gate that decided the action. */
  reason: string;
}

export interface ShadowConsensusConfig {
  /** Minimum |voteScore| required to take a side. */
  quorum: number;
  /**
   * De-biased deviation (in probability points) that counts as a full-
   * conviction vote. Votes are continuous: `vote = deviation / fullVoteScale`,
   * clamped to +/-1. A hard sign() would let a 1e-17 difference in the inputs
   * flip a vote, and would throw away the difference between a 1-point and a
   * 20-point disagreement.
   */
  fullVoteScale: number;
  /** |vote| below this counts as "no view" for the abstention metric only. */
  abstainVoteThreshold: number;
  /** Fixed friction added to the observed spread. */
  slippageBuffer: number;
  minCostFloor: number;
  maxCostFloor: number;
  /** Used when the spread is unknown. */
  defaultCostFloor: number;
}

export const SHADOW_CONSENSUS_DEFAULTS: ShadowConsensusConfig = {
  quorum: 0.3,
  fullVoteScale: 0.05,
  abstainVoteThreshold: 0.1,
  slippageBuffer: 0.005,
  minCostFloor: 0.01,
  maxCostFloor: 0.1,
  defaultCostFloor: 0.02,
};

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function round(value: number, decimals = 4): number {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

/**
 * Round-trip friction in probability points.
 *
 * The live pipeline hard-codes a 4-cent edge floor for every market. That
 * over-charges tight markets (where 2 cents is already profitable) and
 * under-charges wide ones. Derive it from the actual spread instead.
 */
export function deriveCostFloor(
  spread: number | undefined,
  config: ShadowConsensusConfig = SHADOW_CONSENSUS_DEFAULTS,
): number {
  const observed = Number(spread);
  if (!Number.isFinite(observed) || observed < 0) {
    return config.defaultCostFloor;
  }
  return clamp(
    observed + config.slippageBuffer,
    config.minCostFloor,
    config.maxCostFloor,
  );
}

/**
 * Run the agent-driven consensus.
 *
 * Steps:
 *  1. Drop non-directional agents (risk/tail) - they inform uncertainty, not
 *     direction, exactly as in the live fusion.
 *  2. De-bias each forecast against its agent's own calibration.
 *  3. Vote against the current market price; magnitude sets the edge.
 *  4. Require a weighted majority AND an edge that clears round-trip cost.
 */
export function runShadowConsensus(
  input: ShadowConsensusInput,
  config: ShadowConsensusConfig = SHADOW_CONSENSUS_DEFAULTS,
): ShadowConsensusResult {
  const market = clamp(
    Number.isFinite(input.marketProbability) ? input.marketProbability : 0.5,
    0.01,
    0.99,
  );
  const calibration = input.calibration ?? {};
  const performance = input.agentPerformance ?? {};
  const costFloor = deriveCostFloor(input.spread, config);

  let weightSum = 0;
  let voteSum = 0;
  let fairSum = 0;
  let abstentions = 0;
  let considered = 0;
  let calibrationSamples = 0;

  const participatingAgents: string[] = [];
  const uncalibratedAgents: string[] = [];

  for (const signal of input.signals ?? []) {
    if (!signal || NON_DIRECTIONAL_AGENTS.has(signal.agentName)) continue;

    const confidence = clamp(
      Number.isFinite(signal.confidence) ? signal.confidence : 0,
      0,
      1,
    );
    const typeWeight = TYPE_WEIGHTS[signal.agentName] ?? 1;
    const perf =
      Number.isFinite(performance[signal.agentName]) && performance[signal.agentName] > 0
        ? performance[signal.agentName]
        : 1;

    const weight = typeWeight * confidence * perf;
    if (!(weight > 0)) continue;

    considered += 1;
    const calibrationForAgent = calibration[signal.agentName];
    if (!calibrationForAgent || calibrationForAgent.samples === 0) {
      uncalibratedAgents.push(signal.agentName);
    } else if (Number.isFinite(calibrationForAgent.samples)) {
      calibrationSamples += calibrationForAgent.samples;
    }

    const fair = deBiasProbability(
      signal.fairProbability,
      market,
      calibrationForAgent,
    );
    const deviation = fair - market;
    // Continuous, odd vote: exact mirror symmetry (vote(-d) == -vote(d)) and no
    // threshold cliff for borderline disagreements.
    const vote = clamp(deviation / config.fullVoteScale, -1, 1);

    weightSum += weight;
    voteSum += weight * vote;
    fairSum += weight * fair;

    if (Math.abs(vote) >= config.abstainVoteThreshold) {
      participatingAgents.push(signal.agentName);
    } else {
      abstentions += 1;
    }
  }

  if (!(weightSum > 0)) {
    return {
      action: 'NO_TRADE',
      voteScore: 0,
      edge: 0,
      fairProbability: round(market),
      costFloor: round(costFloor),
      participatingAgents: [],
      abstainShare: 1,
      calibrationSamples,
      uncalibratedAgents,
      reason: 'no directional agents produced a usable signal',
    };
  }

  const voteScore = voteSum / weightSum;
  const fair = fairSum / weightSum;
  const edge = fair - market;
  const abstainShare = considered > 0 ? abstentions / considered : 1;

  const bullish = voteScore >= config.quorum;
  const bearish = voteScore <= -config.quorum;

  let action: ShadowAction = 'NO_TRADE';
  let reason: string;

  if (!bullish && !bearish) {
    reason =
      `no majority: voteScore ${voteScore.toFixed(3)} is inside the ` +
      `+/-${config.quorum} quorum (${participatingAgents.length}/${considered} agents voted, ` +
      `${(abstainShare * 100).toFixed(0)}% abstained)`;
  } else if (bullish && edge < costFloor) {
    reason =
      `majority wants LONG_YES but edge ${edge.toFixed(4)} does not clear the ` +
      `${costFloor.toFixed(4)} round-trip cost floor`;
  } else if (bearish && edge > -costFloor) {
    reason =
      `majority wants LONG_NO but edge ${edge.toFixed(4)} does not clear the ` +
      `${costFloor.toFixed(4)} round-trip cost floor`;
  } else if (bullish) {
    action = 'LONG_YES';
    reason =
      `weighted majority bullish (voteScore ${voteScore.toFixed(3)}) with edge ` +
      `${edge.toFixed(4)} > cost floor ${costFloor.toFixed(4)}`;
  } else {
    action = 'LONG_NO';
    reason =
      `weighted majority bearish (voteScore ${voteScore.toFixed(3)}) with edge ` +
      `${edge.toFixed(4)} < -cost floor ${costFloor.toFixed(4)}`;
  }

  return {
    action,
    voteScore: round(voteScore),
    edge: round(edge),
    fairProbability: round(fair),
    costFloor: round(costFloor),
    participatingAgents,
    abstainShare: round(abstainShare),
    calibrationSamples,
    uncalibratedAgents,
    reason,
  };
}

/** Calibration map used by callers that have nothing fitted yet. */
export const EMPTY_CALIBRATION: CalibrationMap = {};

/**
 * Mirror a signal set into the opposite outcome's price space.
 *
 * Exposed for the symmetry property test: for any market, mirroring the market
 * price, every forecast and the calibration lines must mirror the resulting
 * action (LONG_YES <-> LONG_NO, NO_TRADE unchanged). A pipeline that violates
 * this is directionally biased by construction.
 */
export function mirrorSignals(signals: readonly AgentSignal[]): AgentSignal[] {
  return signals.map((signal) => ({
    ...signal,
    fairProbability: clamp(1 - signal.fairProbability, 0.01, 0.99),
  }));
}

export function mirrorCalibrationMap(calibration: CalibrationMap): CalibrationMap {
  const mirrored: CalibrationMap = {};
  for (const [agentName, value] of Object.entries(calibration)) {
    mirrored[agentName] = mirrorCalibration(value);
  }
  return mirrored;
}
