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

  it('does not let a neutral-at-0.5 ensemble drag a favorite to 0.5', () => {
    const result = fuseSignals(
      [
        signal('market_microstructure', 'NEUTRAL', 0.5, 0.8),
        signal('breaking_news', 'NEUTRAL', 0.5, 0.8),
        signal('probability_baseline', 'NEUTRAL', 0.5, 0.8),
      ],
      {},
      0.8,
    );

    // The ensemble says 0.5 but the market prior dominates the shrunk view.
    expect(result.weightedFairProbability).toBeGreaterThan(0.74);
    expect(result.weightedFairProbability).toBeLessThan(0.8);
    expect(result.rawFairProbability).toBeCloseTo(0.5, 2);
  });

  it('keeps a bearish ensemble anchored to a favorite market', () => {
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

    // Unanchored this would be 0.20. The shrunk output stays close to 0.80.
    expect(result.rawFairProbability).toBeCloseTo(0.2, 1);
    expect(result.weightedFairProbability).toBeGreaterThan(0.7);
    expect(result.weightedFairProbability).toBeLessThan(0.8);
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
