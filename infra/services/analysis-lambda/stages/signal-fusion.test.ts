import { describe, expect, it } from 'vitest';
import { fuseSignals, NON_DIRECTIONAL_AGENTS } from './signal-fusion';
import type { AgentSignal } from '../lib/types';

function signal(
  agentName: string,
  direction: AgentSignal['direction'],
  fairProbability: number,
  confidence = 0.8,
): AgentSignal {
  return {
    agentName,
    direction,
    confidence,
    fairProbability,
    keyDrivers: [],
    riskFactors: [],
    timestamp: new Date().toISOString(),
  };
}

describe('fuseSignals', () => {
  it('falls back to the market prior when there is no directional information', () => {
    const result = fuseSignals([], {}, 0.8);

    expect(result.weightedFairProbability).toBeCloseTo(0.8, 4);
    expect(result.rawFairProbability).toBeCloseTo(0.8, 4);
    expect(result.fusionConfidence).toBe(0);
    expect(result.conflictMap).toHaveLength(0);
  });

  it('does not let a confident neutral-at-0.5 ensemble drag a favorite to 0.5', () => {
    const result = fuseSignals(
      [
        signal('market_microstructure', 'NEUTRAL', 0.5, 0.8),
        signal('breaking_news', 'NEUTRAL', 0.5, 0.8),
        signal('probability_baseline', 'NEUTRAL', 0.5, 0.8),
      ],
      {},
      0.8,
    );

    // The raw edge is 30%, so only the extreme pass-through applies.
    expect(result.rawFairProbability).toBeCloseTo(0.5, 2);
    expect(result.weightedFairProbability).toBeCloseTo(0.71, 2);
    expect(result.passThrough).toBeCloseTo(0.3, 4);
  });

  it('blocks a model-error-sized disagreement with the market', () => {
    const result = fuseSignals(
      [
        signal('market_microstructure', 'NO', 0.2, 0.9),
        signal('probability_baseline', 'NO', 0.2, 0.9),
        signal('breaking_news', 'NO', 0.2, 0.9),
        signal('mean_reversion', 'NO', 0.2, 0.9),
      ],
      {},
      0.8,
    );

    // Raw edge is -60%: treated as model error, so the market prior wins.
    expect(result.rawFairProbability).toBeCloseTo(0.2, 1);
    expect(result.weightedFairProbability).toBeCloseTo(0.8, 4);
    expect(result.passThrough).toBe(0);
  });

  it('ignores low-confidence no-view signals', () => {
    const confident = [
      signal('breaking_news', 'NO', 0.62, 0.8),
    ];
    const withNoView = [
      ...confident,
      signal('market_microstructure', 'NEUTRAL', 0.5, 0.3),
      signal('polling_intelligence', 'NEUTRAL', 0.5, 0.3),
      signal('mean_reversion', 'NEUTRAL', 0.5, 0.3),
    ];

    const withoutNoise = fuseSignals(confident, {}, 0.665);
    const withNoise = fuseSignals(withNoView, {}, 0.665);

    expect(withNoise.weightedFairProbability).toBeCloseTo(
      withoutNoise.weightedFairProbability,
      6,
    );
    expect(withNoise.weightedFairProbability).toBeGreaterThan(0.63);
    expect(withNoise.weightedFairProbability).toBeLessThan(0.65);
  });

  it('passes through most of a moderate aligned edge', () => {
    const result = fuseSignals(
      [
        signal('market_microstructure', 'YES', 0.66, 0.8),
        signal('polling_intelligence', 'YES', 0.66, 0.8),
      ],
      {},
      0.6,
    );

    // Raw edge is +6%; 60% pass-through gives +3.6%.
    expect(result.rawFairProbability).toBeCloseTo(0.66, 2);
    expect(result.weightedFairProbability).toBeCloseTo(0.636, 2);
    expect(result.passThrough).toBeCloseTo(0.6, 4);
  });

  it('still produces a directional view when the market is near 0.5', () => {
    const result = fuseSignals(
      [
        signal('market_microstructure', 'NO', 0.2, 0.9),
        signal('probability_baseline', 'NO', 0.2, 0.9),
        signal('breaking_news', 'NO', 0.2, 0.9),
      ],
      {},
      0.5,
    );

    expect(result.weightedFairProbability).toBeLessThan(0.5);
    expect(result.weightedFairProbability).toBeGreaterThan(0.2);
  });

  it('uses risk/tail signals as an uncertainty penalty, not a probability vote', () => {
    const base = [
      signal('market_microstructure', 'YES', 0.7, 0.8),
      signal('breaking_news', 'YES', 0.7, 0.8),
    ];
    const withRisk = [
      ...base,
      signal('risk_assessment', 'NO', 0.05, 1.0),
      signal('tail_risk', 'NO', 0.05, 1.0),
    ];

    const baseResult = fuseSignals(base, {}, 0.6);
    const riskResult = fuseSignals(withRisk, {}, 0.6);

    // Direction unchanged...
    expect(riskResult.weightedFairProbability).toBeCloseTo(
      baseResult.weightedFairProbability,
      6,
    );
    // ...but confidence is reduced by confident risk/tail signals.
    expect(riskResult.fusionConfidence).toBeLessThan(baseResult.fusionConfidence);
    expect(NON_DIRECTIONAL_AGENTS.has('risk_assessment')).toBe(true);
    expect(NON_DIRECTIONAL_AGENTS.has('tail_risk')).toBe(true);
  });

  it('gives calibrated high-performing agents more influence', () => {
    const signals = [
      signal('catalyst_identification', 'YES', 0.8, 0.8),
      signal('mean_reversion', 'NO', 0.2, 0.8),
    ];

    const equal = fuseSignals(signals, {}, 0.5);
    const favorYes = fuseSignals(
      signals,
      { catalyst_identification: 2.0, mean_reversion: 0.5 },
      0.5,
    );

    expect(equal.weightedFairProbability).toBeCloseTo(0.5, 2);
    expect(favorYes.weightedFairProbability).toBeGreaterThan(
      equal.weightedFairProbability,
    );
  });

  it('records conflicts for strongly divergent directional agents', () => {
    const result = fuseSignals(
      [
        signal('market_microstructure', 'YES', 0.8, 0.8),
        signal('breaking_news', 'NO', 0.2, 0.8),
      ],
      {},
      0.5,
    );

    expect(result.conflictMap).toHaveLength(1);
    expect(result.conflictMap[0].divergence).toBeCloseTo(0.6, 4);
  });

  it('penalizes confidence when directional agents are extremely split', () => {
    const result = fuseSignals(
      [
        signal('market_microstructure', 'YES', 0.95, 0.9),
        signal('breaking_news', 'NO', 0.05, 0.9),
      ],
      {},
      0.5,
    );

    expect(result.fusionConfidence).toBeLessThan(0.5);
    expect(result.signalDisagreement).toBeGreaterThan(0.5);
  });
});
