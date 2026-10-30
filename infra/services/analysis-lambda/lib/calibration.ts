/**
 * Per-agent market calibration for the intelligence ensemble.
 *
 * An agent's `fairProbability` is an estimate of P(YES), but LLM agents have a
 * systematic null point at 0.5: on a market priced at 0.80 they still tend to
 * emit values near the middle of the range. That regression is not a view on
 * *this* market, it is a property of the agent - and if it is left in the
 * signal it becomes a systematic trading bias. Every deviation from a lopsided
 * price then points toward the cheaper token, and a genuinely underpriced
 * favourite can never be expressed.
 *
 * We model an agent's habitual output as a line in the market price:
 *
 *     E[fair | market] = intercept + slope * market
 *
 * `slope` is how strongly the agent tracks the price (1 = fully anchored to the
 * current price, 0 = ignores the price entirely and restates a base rate). The
 * residual re-centres the agent on the price:
 *
 *     fair' = market + (fair - E[fair | market])
 *
 * so a habitual / near-null output becomes NO_VIEW instead of a directional
 * vote, while genuine per-market disagreement survives intact.
 *
 * Calibration is shrunk toward the identity line when samples are scarce, so an
 * agent with no history behaves exactly as it does today (identity is a no-op).
 *
 * Pure: no IO, no clocks, no env. Fits from moments so the DB can aggregate.
 */

import type { AgentSignal } from './types';

/** A single (market price, agent forecast) observation. */
export interface CalibrationSample {
  agentName: string;
  /** Market P(YES) at the time the agent produced its signal. */
  marketProbability: number;
  /** The agent's P(YES) forecast. */
  fairProbability: number;
}

/** Sufficient statistics for a one-variable least-squares fit. */
export interface CalibrationMoments {
  samples: number;
  meanMarket: number;
  meanFair: number;
  /** mean(market * fair) */
  meanMarketFair: number;
  /** mean(market^2) */
  meanMarketSq: number;
}

/** Fitted `E[fair | market] = intercept + slope * market`. */
export interface AgentCalibration {
  intercept: number;
  slope: number;
  samples: number;
}

export type CalibrationMap = Record<string, AgentCalibration>;

/**
 * No-op calibration: `E[fair | market] = market`.
 *
 * Using the identity for an uncalibrated agent means de-biasing is a no-op,
 * which keeps the shadow config honest when there is no history to fit.
 */
export const IDENTITY_CALIBRATION: AgentCalibration = {
  intercept: 0,
  slope: 1,
  samples: 0,
};

/** Below this many observations a per-agent fit is dominated by noise. */
export const MIN_SAMPLES = 12;

/** Pseudo-observations pulling the fit toward the identity line. */
export const PRIOR_SAMPLES = 24;

/**
 * A slope above 1 means the agent extrapolates past the price (it does produce
 * favourite-side conviction); 1.5 leaves room for that without letting a
 * handful of outliers produce an absurd fit.
 */
const MAX_SLOPE = 1.5;
const MIN_SLOPE = 0;

const MAX_INTERCEPT = 0.5;
const MIN_INTERCEPT = -0.5;

/** If market prices barely varied, the slope is not identifiable. */
const MIN_MARKET_VARIANCE = 1e-4;

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function clampProbability(value: number): number {
  return clamp(Number.isFinite(value) ? value : 0.5, 0.01, 0.99);
}

/**
 * Fit an agent's habitual output from raw (market, fair) pairs.
 */
export function momentsFromSamples(
  samples: readonly CalibrationSample[],
): Record<string, CalibrationMoments> {
  const acc: Record<string, CalibrationMoments & { sumFair: number; sumMarketFair: number; sumMarketSq: number; sumMarket: number }> = {};

  for (const sample of samples) {
    if (!sample || !sample.agentName) continue;
    const market = Number(sample.marketProbability);
    const fair = Number(sample.fairProbability);
    if (!Number.isFinite(market) || !Number.isFinite(fair)) continue;

    const bucket = acc[sample.agentName] ?? {
      samples: 0,
      meanMarket: 0,
      meanFair: 0,
      meanMarketFair: 0,
      meanMarketSq: 0,
      sumMarket: 0,
      sumFair: 0,
      sumMarketFair: 0,
      sumMarketSq: 0,
    };

    bucket.samples += 1;
    bucket.sumMarket += market;
    bucket.sumFair += fair;
    bucket.sumMarketFair += market * fair;
    bucket.sumMarketSq += market * market;
    acc[sample.agentName] = bucket;
  }

  const result: Record<string, CalibrationMoments> = {};
  for (const [agentName, bucket] of Object.entries(acc)) {
    const n = bucket.samples;
    result[agentName] = {
      samples: n,
      meanMarket: bucket.sumMarket / n,
      meanFair: bucket.sumFair / n,
      meanMarketFair: bucket.sumMarketFair / n,
      meanMarketSq: bucket.sumMarketSq / n,
    };
  }
  return result;
}

/**
 * Turn sufficient statistics into a shrunk calibration line.
 *
 * Shrinkage: `weight = n / (n + PRIOR_SAMPLES)`, blending the fitted line with
 * the identity. With few samples the agent stays transparent to de-biasing;
 * with many samples the fitted regression dominates.
 */
export function calibrationFromMoments(moments: CalibrationMoments): AgentCalibration {
  if (!moments || !Number.isFinite(moments.samples) || moments.samples < MIN_SAMPLES) {
    return { ...IDENTITY_CALIBRATION, samples: Math.max(0, Math.floor(moments?.samples ?? 0)) };
  }

  const variance = moments.meanMarketSq - moments.meanMarket * moments.meanMarket;
  if (!(variance > MIN_MARKET_VARIANCE)) {
    // Every observation came from roughly the same price - no slope to fit.
    return { ...IDENTITY_CALIBRATION, samples: moments.samples };
  }

  const covariance = moments.meanMarketFair - moments.meanMarket * moments.meanFair;
  const rawSlope = covariance / variance;
  const rawIntercept = moments.meanFair - rawSlope * moments.meanMarket;

  const weight = moments.samples / (moments.samples + PRIOR_SAMPLES);
  const slope = clamp(
    weight * rawSlope + (1 - weight) * IDENTITY_CALIBRATION.slope,
    MIN_SLOPE,
    MAX_SLOPE,
  );
  const intercept = clamp(
    weight * rawIntercept + (1 - weight) * IDENTITY_CALIBRATION.intercept,
    MIN_INTERCEPT,
    MAX_INTERCEPT,
  );

  return { intercept, slope, samples: moments.samples };
}

/** Fit every agent present in the sample set. */
export function fitAgentCalibration(
  samples: readonly CalibrationSample[],
): CalibrationMap {
  const moments = momentsFromSamples(samples);
  const map: CalibrationMap = {};
  for (const [agentName, m] of Object.entries(moments)) {
    map[agentName] = calibrationFromMoments(m);
  }
  return map;
}

/**
 * Re-centre an agent forecast on the current market price.
 *
 * `fair' = market + residual`, where the residual is measured against the
 * agent's *own* habitual output at that price rather than against 0.5. An
 * uncalibrated agent (identity) passes through unchanged.
 */
export function deBiasProbability(
  fairProbability: number,
  marketProbability: number,
  calibration: AgentCalibration = IDENTITY_CALIBRATION,
): number {
  const market = clampProbability(marketProbability);
  const fair = clampProbability(fairProbability);
  const cal = calibration ?? IDENTITY_CALIBRATION;
  const expected = cal.intercept + cal.slope * market;
  return clampProbability(market + (fair - expected));
}

/**
 * The calibration line for the mirrored market (YES <-> NO).
 *
 * If `fair = a + b*market`, then `1 - fair = (1 - a - b) + b*(1 - market)`.
 * Used by symmetry tests and by any caller that evaluates a market in NO space.
 */
export function mirrorCalibration(calibration: AgentCalibration): AgentCalibration {
  const cal = calibration ?? IDENTITY_CALIBRATION;
  return {
    intercept: 1 - cal.intercept - cal.slope,
    slope: cal.slope,
    samples: cal.samples,
  };
}

/** Compact, log-friendly description of a fit. */
export function describeCalibration(calibration: AgentCalibration): string {
  return (
    `slope=${calibration.slope.toFixed(3)} ` +
    `intercept=${calibration.intercept.toFixed(3)} ` +
    `n=${calibration.samples}`
  );
}

/**
 * Convenience wrapper: de-bias a batch of signals.
 * Returns new objects; the inputs are not mutated.
 */
export function deBiasSignals(
  signals: readonly AgentSignal[],
  marketProbability: number,
  calibration: CalibrationMap = {},
): AgentSignal[] {
  return signals.map((signal) => ({
    ...signal,
    fairProbability: deBiasProbability(
      signal.fairProbability,
      marketProbability,
      calibration[signal.agentName],
    ),
  }));
}
