import { describe, expect, it } from 'vitest';
import {
  MIN_SAMPLES,
  calibrationFromMoments,
  deBiasProbability,
  fitAgentCalibration,
  mirrorCalibration,
  momentsFromSamples,
  type CalibrationSample,
} from './calibration';

/** Deterministic (market, fair) pairs following fair = intercept + slope*market. */
function samplesFor(
  agentName: string,
  intercept: number,
  slope: number,
  n = 200,
): CalibrationSample[] {
  return Array.from({ length: n }, (_, i) => {
    const market = 0.1 + (0.8 * i) / (n - 1);
    return {
      agentName,
      marketProbability: market,
      fairProbability: intercept + slope * market,
    };
  });
}

describe('fitAgentCalibration', () => {
  it('recovers a regressive agent (slope < 1, intercept > 0)', () => {
    // An agent that habitually emits 0.1 + 0.8*market: it under-reacts to
    // lopsided prices by 20% and sits at 0.5 on a 0.5 market.
    const calibration = fitAgentCalibration(samplesFor('mean_reversion', 0.1, 0.8));
    const fit = calibration.mean_reversion;

    expect(fit.samples).toBe(200);
    // Shrinkage toward the identity line (weight = 200/(200+24)) pulls the raw
    // OLS fit slightly toward 1/0, so assert against the shrunk expectation.
    expect(fit.slope).toBeCloseTo(200 / 224 * 0.8 + 24 / 224, 9);
    expect(fit.intercept).toBeCloseTo((200 / 224) * 0.1, 9);
    expect(fit.slope).toBeLessThan(1);
  });

  it('recovers an extrapolating agent (slope > 1)', () => {
    // An agent that produces genuine conviction on favourites.
    const calibration = fitAgentCalibration(samplesFor('market_microstructure', -0.1, 1.2));
    expect(calibration.market_microstructure.slope).toBeCloseTo(200 / 224 * 1.2 + 24 / 224, 9);
    expect(calibration.market_microstructure.intercept).toBeCloseTo((200 / 224) * -0.1, 9);
  });

  it('falls back to the identity line when there is not enough history', () => {
    const calibration = fitAgentCalibration(samplesFor('breaking_news', 0.2, 0.6, MIN_SAMPLES - 1));
    expect(calibration.breaking_news).toEqual({
      intercept: 0,
      slope: 1,
      samples: MIN_SAMPLES - 1,
    });
  });

  it('does not fit a slope when every observation came from the same price', () => {
    const flat: CalibrationSample[] = Array.from({ length: 100 }, () => ({
      agentName: 'media_sentiment',
      marketProbability: 0.5,
      fairProbability: 0.5,
    }));
    expect(calibrationFromMoments(momentsFromSamples(flat).media_sentiment)).toEqual({
      intercept: 0,
      slope: 1,
      samples: 100,
    });
  });

  it('fits each agent independently', () => {
    const calibration = fitAgentCalibration([
      ...samplesFor('momentum', 0.1, 0.8),
      ...samplesFor('mean_reversion', -0.1, 1.2),
    ]);
    expect(calibration.momentum.slope).toBeCloseTo(200 / 224 * 0.8 + 24 / 224, 9);
    expect(calibration.mean_reversion.slope).toBeCloseTo(200 / 224 * 1.2 + 24 / 224, 9);
  });
});

describe('deBiasProbability', () => {
  it('is a no-op for an uncalibrated agent', () => {
    expect(deBiasProbability(0.62, 0.8)).toBeCloseTo(0.62, 10);
    expect(deBiasProbability(0.62, 0.2)).toBeCloseTo(0.62, 10);
  });

  it('re-centres a habitual forecast on the market price', () => {
    // The agent habitually emits 0.74 at a 0.80 market. That is its null
    // output, not a bearish view, so de-biasing must resolve to the price.
    const cal = { intercept: 0.1, slope: 0.8, samples: 200 };
    expect(deBiasProbability(0.74, 0.8, cal)).toBeCloseTo(0.8, 6);

    // Same habit at a 0.20 market: 0.26 resolves to 0.20, not a bullish view.
    expect(deBiasProbability(0.26, 0.2, cal)).toBeCloseTo(0.2, 6);
  });

  it('preserves genuine deviation from the agent habit', () => {
    const cal = { intercept: 0.1, slope: 0.8, samples: 200 };
    // Genuine +8pt conviction on an 0.80 market.
    expect(deBiasProbability(0.82, 0.8, cal)).toBeCloseTo(0.88, 6);
    // Genuine -8pt conviction on an 0.80 market.
    expect(deBiasProbability(0.66, 0.8, cal)).toBeCloseTo(0.72, 6);
  });
});

describe('mirrorCalibration', () => {
  it('maps a calibration line into the opposite outcome space', () => {
    const cal = { intercept: 0.1, slope: 0.8, samples: 200 };
    const mirrored = mirrorCalibration(cal);
    // 1 - fair = (1 - a - b) + b*(1 - market)
    expect(mirrored.slope).toBeCloseTo(0.8, 10);
    expect(mirrored.intercept).toBeCloseTo(0.1, 10);
  });

  it('is an involution for symmetric lines', () => {
    const cal = { intercept: 0.05, slope: 0.7, samples: 50 };
    const twice = mirrorCalibration(mirrorCalibration(cal));
    expect(twice.intercept).toBeCloseTo(cal.intercept, 10);
    expect(twice.slope).toBeCloseTo(cal.slope, 10);
  });

  it('leaves the identity line untouched', () => {
    expect(mirrorCalibration({ intercept: 0, slope: 1, samples: 0 })).toEqual({
      intercept: 0,
      slope: 1,
      samples: 0,
    });
  });
});
